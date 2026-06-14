import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const wrapperEntry = path.join(repoRoot, 'scripts/provider-sync/google-gemini-sync.mjs');
const { parseSanitizedProviderPayload } = await import(path.join(repoRoot, 'apps/broker/dist/adapters/sanitized-payload.js'));

async function runWrapper(envOverrides = {}) {
  return await new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...envOverrides,
    };

    const child = spawn(process.execPath, [wrapperEntry], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
      });
    });
  });
}

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-google-sync-smoke-'));
const fakeGeminiPath = path.join(tempRoot, 'fake-gemini.mjs');

await writeFile(
  fakeGeminiPath,
  `#!/usr/bin/env node
const scenario = process.env.FAKE_GEMINI_SCENARIO ?? 'probe-ok';
const args = process.argv.slice(2);

if (args.join(' ') === '--version') {
  process.stdout.write('0.38.2\\n');
  process.exit(0);
}

if (args.includes('--prompt') || args.includes('-p')) {
  if (scenario === 'probe-fail') {
    process.stdout.write(JSON.stringify({
      session_id: 'secret-session-id',
      response: 'unexpected',
      stats: {}
    }));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    session_id: 'secret-session-id',
    response: 'SWITCHBOARD_GEMINI_STATUS_OK',
    stats: {
      models: {
        'gemini-3.1-pro-preview': {
          api: { totalRequests: 1, totalErrors: 0 },
          tokens: { total: 123 }
        }
      }
    }
  }));
  process.exit(0);
}

process.stderr.write('unexpected fake gemini invocation\\n');
process.exit(2);
`,
  { mode: 0o700 },
);
await chmod(fakeGeminiPath, 0o700);

try {
  const defaultStatus = await runWrapper({
    GEMINI_CLI_PATH: fakeGeminiPath,
  });
  assert.equal(defaultStatus.code, 0);
  assert.equal(defaultStatus.stderr, '');
  const defaultAccounts = parseSanitizedProviderPayload(JSON.parse(defaultStatus.stdout), 'google', 'provider', 'googleSmoke');
  assert.equal(defaultAccounts[0]?.id, 'google-gemini-cli');
  assert.equal(defaultAccounts[0]?.signals?.find((signal) => signal.id === 'source')?.value, 'gemini version');
  assert.equal(defaultAccounts[0]?.quotas[0]?.availability, 'unknown');
  assert.equal(defaultAccounts[0]?.quotas[0]?.interpretation, 'informational');

  const probe = await runWrapper({
    GEMINI_CLI_PATH: fakeGeminiPath,
    SWITCHBOARD_GOOGLE_LIVE_PROBE: '1',
    FAKE_GEMINI_SCENARIO: 'probe-ok',
  });
  assert.equal(probe.code, 0);
  assert.equal(probe.stdout.includes('secret-session-id'), false);
  const probeAccounts = parseSanitizedProviderPayload(JSON.parse(probe.stdout), 'google', 'provider', 'googleSmoke');
  assert.equal(probeAccounts[0]?.signals?.find((signal) => signal.id === 'source')?.value, 'gemini live probe');
  assert.equal(probeAccounts[0]?.signals?.find((signal) => signal.id === 'probe')?.value, 'ok');
  assert.equal(probeAccounts[0]?.signals?.find((signal) => signal.id === 'model')?.value, 'gemini-3.1-pro-preview');
  assert.equal(probeAccounts[0]?.quotas[0]?.modelId, 'gemini-3.1-pro-preview');
  assert.equal(probeAccounts[0]?.quotas[0]?.availability, 'available');

  const probeFail = await runWrapper({
    GEMINI_CLI_PATH: fakeGeminiPath,
    SWITCHBOARD_GOOGLE_LIVE_PROBE: '1',
    FAKE_GEMINI_SCENARIO: 'probe-fail',
  });
  assert.equal(probeFail.code, 0);
  assert.equal(probeFail.stdout.includes('secret-session-id'), false);
  const probeFailAccounts = parseSanitizedProviderPayload(JSON.parse(probeFail.stdout), 'google', 'provider', 'googleSmoke');
  assert.equal(probeFailAccounts[0]?.id, 'google-gemini-probe-unavailable');
  assert.equal(probeFailAccounts[0]?.signals?.find((signal) => signal.id === 'source')?.value, 'gemini cli unavailable');
  assert.equal(probeFailAccounts[0]?.quotas[0]?.availability, 'unavailable');

  const missingCli = await runWrapper({
    GEMINI_CLI_PATH: path.join(tempRoot, 'missing-gemini'),
  });
  assert.equal(missingCli.code, 0);
  const missingAccounts = parseSanitizedProviderPayload(JSON.parse(missingCli.stdout), 'google', 'provider', 'googleSmoke');
  assert.equal(missingAccounts[0]?.id, 'google-gemini-unavailable');
  assert.equal(missingAccounts[0]?.signals?.find((signal) => signal.id === 'source')?.value, 'gemini cli unavailable');
  assert.equal(missingAccounts[0]?.quotas[0]?.availability, 'unavailable');

  console.log('Google Gemini sync smoke test passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
