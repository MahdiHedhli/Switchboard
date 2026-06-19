// Headless UI end-to-end smoke (UI-hardening backlog item 3).
//
// Boots the real broker, serves the production-built dashboard from
// `apps/switchboard-ui/dist` behind an `/api` proxy, and drives the operator
// flow with a headless Chromium: load the dashboard, see the plan / providers /
// selection sections render from broker-backed state, enter an operator token,
// create a task, and confirm it lands in a lane. Finishes with an axe-core
// accessibility scan of the main view and fails on any serious/critical issue.
//
// Designed for CI (`npx playwright install --with-deps chromium`), so no desktop
// browser is required. Kept out of `verify:control-plane`: it needs browser
// binaries and runs as its own CI job.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const brokerEntry = path.join(repoRoot, 'apps/broker/dist/index.js');
const profilesDir = path.join(repoRoot, 'profiles');
const uiDist = path.join(repoRoot, 'apps/switchboard-ui/dist');
const projectId = 'threatpedia';
const operatorToken = 'switchboard-e2e-token';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a TCP port.')));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForBroker(baseUrl, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // broker not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Broker did not become healthy before timeout.');
}

async function startBroker({ port, stateDir, snapshotDir }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const broker = spawn(process.execPath, [brokerEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_BROKER_PORT: String(port),
      SWITCHBOARD_PROFILES_DIR: profilesDir,
      SWITCHBOARD_STATE_DIR: stateDir,
      SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
      SWITCHBOARD_OPERATOR_TOKEN: operatorToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  broker.stderr.on('data', (chunk) => (stderr += chunk.toString()));

  try {
    await waitForBroker(baseUrl, 15_000);
  } catch (error) {
    broker.kill('SIGTERM');
    await new Promise((resolve) => broker.once('exit', resolve));
    const detail = stderr.trim() ? ` stderr: ${stderr.trim()}` : '';
    throw new Error(`${(error instanceof Error ? error.message : String(error))}${detail}`);
  }

  return {
    baseUrl,
    async stop() {
      broker.kill('SIGTERM');
      await new Promise((resolve) => broker.once('exit', resolve));
      if (stderr.trim()) console.error(stderr.trim());
    },
  };
}

// Serves the built UI and proxies `/api/*` to the broker (mirrors the dev
// `vite` proxy: strips the `/api` prefix). SPA fallback to index.html.
function startUiServer({ uiPort, brokerPort }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${uiPort}`);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const targetPath = `${url.pathname.replace(/^\/api/, '') || '/'}${url.search}`;
      const proxyReq = http.request(
        { host: '127.0.0.1', port: brokerPort, method: req.method, path: targetPath, headers: { ...req.headers, host: `127.0.0.1:${brokerPort}` } },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', () => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('broker proxy error');
      });
      req.pipe(proxyReq);
      return;
    }

    let filePath = path.join(uiDist, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    if (!filePath.startsWith(uiDist) || !existsSync(filePath)) {
      filePath = path.join(uiDist, 'index.html');
    }

    readFile(filePath)
      .then((body) => {
        res.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream' });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      });
  });

  return new Promise((resolve) => {
    server.listen(uiPort, '127.0.0.1', () => resolve({ server, async stop() { await new Promise((r) => server.close(r)); } }));
  });
}

async function main() {
  if (!existsSync(uiDist) || !existsSync(path.join(uiDist, 'index.html'))) {
    throw new Error(`Built UI not found at ${uiDist}. Run \`npm run build\` first.`);
  }
  if (!existsSync(brokerEntry)) {
    throw new Error(`Built broker not found at ${brokerEntry}. Run \`npm run build\` first.`);
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-ui-e2e-'));
  const brokerPort = await reservePort();
  const uiPort = await reservePort();
  const stateDir = path.join(tempRoot, 'state');
  const snapshotDir = path.join(tempRoot, 'snapshots');

  const broker = await startBroker({ port: brokerPort, stateDir, snapshotDir });
  const ui = await startUiServer({ uiPort, brokerPort });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });

    // --- load dashboard: broker-backed state rendered ---
    await page.getByText('Stand up broker control surface').waitFor();
    assert.equal(await page.getByText(/Broker load error/).count(), 0, 'dashboard surfaced a broker load error');

    // --- see plan / providers / selection sections ---
    for (const heading of ['Operator session', 'Task intake', 'Model availability', 'Planning notes', 'Model selection', 'Switchboard lanes']) {
      assert.equal(await page.getByRole('heading', { name: heading }).count() > 0, true, `missing section heading: ${heading}`);
    }
    // providers
    await page.getByRole('heading', { name: 'OpenAI Subscription' }).waitFor();
    for (const provider of ['OpenAI Subscription', 'Claude Code Subscription', 'Gemini Subscription', 'Xai Subscription']) {
      assert.equal(await page.getByRole('heading', { name: provider }).count() > 0, true, `missing provider card: ${provider}`);
    }
    // selection section renders broker-backed catalog + its resolved/empty state
    await page.getByRole('heading', { name: 'Model catalog' }).waitFor();
    assert.equal(await page.getByText('No selection warnings — declared task-classes resolved cleanly.').count(), 1, 'selection section did not render its resolved state');
    assert.equal((await page.getByText('placeholder', { exact: true }).count()) > 0, true, 'catalog placeholders did not render');

    // --- enter operator token, create a task ---
    const taskTitle = `E2E smoke task ${Date.now()}`;
    await page.locator('input[type="password"]').fill(operatorToken);
    await page.locator('input[name="title"]').fill(taskTitle);
    await page.locator('textarea[name="description"]').fill('Created by the headless UI e2e smoke to confirm the operator create-task flow.');
    const createButton = page.getByRole('button', { name: 'Create task' });
    await createButton.waitFor();
    assert.equal(await createButton.isEnabled(), true, 'Create task button stayed disabled after entering an operator token');
    await createButton.click();

    // --- see it appear ---
    await page.getByRole('heading', { level: 4, name: taskTitle }).waitFor();
    assert.equal(await page.getByText(/Broker mutation error/).count(), 0, 'task creation surfaced a mutation error');

    // --- accessibility scan of the main view ---
    const axe = await new AxeBuilder({ page }).analyze();
    const blocking = axe.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    if (blocking.length > 0) {
      const summary = blocking
        .map((violation) => `  - [${violation.impact}] ${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`)
        .join('\n');
      throw new Error(`axe-core found ${blocking.length} serious/critical accessibility violation(s):\n${summary}`);
    }

    console.log(`ui-e2e-smoke: PASS (operator flow + ${axe.passes.length} axe checks passed, 0 serious/critical violations)`);
  } finally {
    await context.close();
    await browser.close();
    await ui.stop();
    await broker.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`ui-e2e-smoke: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
