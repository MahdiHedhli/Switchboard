import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const codexSyncEntry = path.join(repoRoot, 'scripts/provider-sync/openai-codex-sync.mjs');

async function runWrapper(fakeCodexPath, scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [codexSyncEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_CLI_PATH: fakeCodexPath,
        FAKE_CODEX_SCENARIO: scenario,
      },
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

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code !== 0) {
        reject(new Error(stderr || stdout || `Codex wrapper exited with code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to parse wrapper JSON output: ${detail}`));
      }
    });
  });
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-codex-wrapper-smoke-'));
  const fakeCodexPath = path.join(tempRoot, 'codex');

  await writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_CODEX_SCENARIO ?? 'app-server';
const args = process.argv.slice(2).join(' ');

if (scenario === 'fallback' && args === 'app-server --listen stdio://') {
  process.stderr.write('Failed to start Codex app-server: simulated unavailable app-server\\n');
  process.exit(1);
}

if (args === 'app-server --listen stdio://') {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          id: message.id,
          result: {
            userAgent: 'Codex Desktop/0.122.0 (wrapper smoke)',
            codexHome: '/tmp/fake-codex',
            platformFamily: 'unix',
            platformOs: 'macos'
          }
        }) + '\\n');
      } else if (message.method === 'account/read') {
        process.stdout.write(JSON.stringify({
          id: message.id,
          result: {
            account: {
              type: 'chatgpt',
              email: 'operator@example.com',
              planType: 'pro'
            },
            requiresOpenaiAuth: true
          }
        }) + '\\n');
      } else if (message.method === 'account/rateLimits/read') {
        if (scenario === 'partial-app-server') {
          process.stdout.write(JSON.stringify({
            id: message.id,
            error: {
              code: -32603,
              message: 'failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)'
            }
          }) + '\\n');
        } else if (scenario === 'mixed-app-server') {
          process.stdout.write(JSON.stringify({
            id: message.id,
            result: {
              rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: {
                  usedPercent: 9,
                  windowDurationMins: 300,
                  resetsAt: 1776814663
                },
                secondary: {
                  usedPercent: 2,
                  windowDurationMins: 10080,
                  resetsAt: 1777401463
                },
                credits: {
                  hasCredits: false,
                  unlimited: false,
                  balance: '0'
                },
                planType: 'pro',
                rateLimitReachedType: null
              },
              rateLimitsByLimitId: {
                codex_bengalfox: {
                  limitId: 'codex_bengalfox',
                  limitName: 'GPT-5.3-Codex-Spark',
                  primary: null,
                  secondary: null,
                  credits: null,
                  planType: 'pro',
                  rateLimitReachedType: null
                }
              }
            }
          }) + '\\n');
        } else {
          process.stdout.write(JSON.stringify({
            id: message.id,
            result: {
              rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: {
                  usedPercent: 9,
                  windowDurationMins: 300,
                  resetsAt: 1776814663
                },
                secondary: {
                  usedPercent: 2,
                  windowDurationMins: 10080,
                  resetsAt: 1777401463
                },
                credits: {
                  hasCredits: false,
                  unlimited: false,
                  balance: '0'
                },
                planType: 'pro',
                rateLimitReachedType: null
              },
              rateLimitsByLimitId: {
                codex_bengalfox: {
                  limitId: 'codex_bengalfox',
                  limitName: 'GPT-5.3-Codex-Spark',
                  primary: {
                    usedPercent: 0,
                    windowDurationMins: 300,
                    resetsAt: 1776826193
                  },
                  secondary: {
                    usedPercent: 0,
                    windowDurationMins: 10080,
                    resetsAt: 1777412993
                  },
                  credits: null,
                  planType: 'pro',
                  rateLimitReachedType: null
                }
              }
            }
          }) + '\\n');
        }
      } else {
        process.stderr.write(\`Unexpected fake codex app-server method: \${message.method}\\n\`);
        process.exit(1);
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
  return;
}

if (args === 'login status') {
  process.stderr.write('Logged in using ChatGPT\\n');
  process.exit(0);
}

if (args === '--version') {
  process.stdout.write('codex-cli 0.122.0-alpha.1\\n');
  process.exit(0);
}

process.stderr.write(\`Unexpected fake codex invocation: \${args}\\n\`);
process.exit(1);
`,
    { mode: 0o700 },
  );

  try {
    const appServerPayload = await runWrapper(fakeCodexPath, 'app-server');
    const appServerAccount = appServerPayload.accounts[0];
    assert.equal(appServerAccount.id, 'openai-codex-chatgpt');
    assert.deepEqual(appServerAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server rate-limits' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'credits', label: 'credits', value: '0' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ]);
    const codexQuota = appServerAccount.quotas.find((quota) => quota.modelId === 'codex');
    assert.notEqual(codexQuota, undefined);
    assert.equal(codexQuota.remaining, 91);
    assert.equal(codexQuota.limit, 100);
    assert.equal(codexQuota.used, 9);
    assert.equal(codexQuota.interpretation, 'percentage_window');
    assert.deepEqual(codexQuota.windows, [
      {
        id: '300m',
        label: '5-hour window',
        durationMinutes: 300,
        limit: 100,
        used: 9,
        remaining: 91,
        interpretation: 'percentage_window',
        resetAt: '2026-04-21T23:37:43.000Z',
      },
      {
        id: '10080m',
        label: 'Weekly window',
        durationMinutes: 10080,
        limit: 100,
        used: 2,
        remaining: 98,
        interpretation: 'percentage_window',
        resetAt: '2026-04-28T18:37:43.000Z',
      },
    ]);
    assert.equal(codexQuota.notes, undefined);
    const sparkQuota = appServerAccount.quotas.find((quota) => quota.modelId === 'codex_bengalfox');
    assert.notEqual(sparkQuota, undefined);
    assert.equal(sparkQuota.displayName, 'GPT-5.3-Codex-Spark');
    assert.equal(sparkQuota.interpretation, 'percentage_window');
    assert.deepEqual(sparkQuota.windows, [
      {
        id: '300m',
        label: '5-hour window',
        durationMinutes: 300,
        limit: 100,
        used: 0,
        remaining: 100,
        interpretation: 'percentage_window',
        resetAt: '2026-04-22T02:49:53.000Z',
      },
      {
        id: '10080m',
        label: 'Weekly window',
        durationMinutes: 10080,
        limit: 100,
        used: 0,
        remaining: 100,
        interpretation: 'percentage_window',
        resetAt: '2026-04-28T21:49:53.000Z',
      },
    ]);

    const mixedPayload = await runWrapper(fakeCodexPath, 'mixed-app-server');
    const mixedAccount = mixedPayload.accounts[0];
    assert.equal(mixedAccount.id, 'openai-codex-chatgpt');
    assert.deepEqual(mixedAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server rate-limits' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'credits', label: 'credits', value: '0' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ]);
    assert.equal(mixedAccount.quotas.length, 2);
    const mixedCodexQuota = mixedAccount.quotas.find((quota) => quota.modelId === 'codex');
    assert.notEqual(mixedCodexQuota, undefined);
    assert.equal(mixedCodexQuota.interpretation, 'percentage_window');
    assert.deepEqual(mixedCodexQuota.windows, [
      {
        id: '300m',
        label: '5-hour window',
        durationMinutes: 300,
        limit: 100,
        used: 9,
        remaining: 91,
        interpretation: 'percentage_window',
        resetAt: '2026-04-21T23:37:43.000Z',
      },
      {
        id: '10080m',
        label: 'Weekly window',
        durationMinutes: 10080,
        limit: 100,
        used: 2,
        remaining: 98,
        interpretation: 'percentage_window',
        resetAt: '2026-04-28T18:37:43.000Z',
      },
    ]);
    const mixedSparkQuota = mixedAccount.quotas.find((quota) => quota.modelId === 'codex_bengalfox');
    assert.notEqual(mixedSparkQuota, undefined);
    assert.equal(mixedSparkQuota.displayName, 'GPT-5.3-Codex-Spark');
    assert.equal(mixedSparkQuota.availability, 'available');
    assert.equal(mixedSparkQuota.interpretation, 'informational');
    assert.equal(mixedSparkQuota.limit, undefined);
    assert.equal(mixedSparkQuota.used, undefined);
    assert.equal(mixedSparkQuota.remaining, undefined);
    assert.equal(mixedSparkQuota.windows, undefined);
    assert.equal(mixedSparkQuota.notes, undefined);

    const partialPayload = await runWrapper(fakeCodexPath, 'partial-app-server');
    const partialAccount = partialPayload.accounts[0];
    assert.equal(partialAccount.id, 'openai-codex-chatgpt');
    assert.equal(partialAccount.displayName, 'Codex Supervisor (Pro)');
    assert.deepEqual(partialAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server account' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
      { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
    ]);
    assert.deepEqual(partialAccount.quotas, [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'unknown',
        interpretation: 'informational',
        source: 'cli',
        confidence: 'medium',
        notes: 'Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop/0.122.0 (wrapper smoke)',
      },
    ]);

    const fallbackPayload = await runWrapper(fakeCodexPath, 'fallback');
    const fallbackAccount = fallbackPayload.accounts[0];
    assert.equal(fallbackAccount.id, 'openai-codex-chatgpt');
    assert.deepEqual(fallbackAccount.signals, [
      { id: 'source', label: 'source', value: 'login-status fallback' },
      { id: 'rate_limits', label: 'rate-limits', value: 'app-server unavailable' },
    ]);
    assert.deepEqual(fallbackAccount.quotas, [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'unknown',
        interpretation: 'informational',
        source: 'cli',
        confidence: 'medium',
        notes: 'codex=codex-cli 0.122.0-alpha.1; Codex CLI reports ChatGPT-backed login, but typed rate-limit data was unavailable locally.',
      },
    ]);

    console.log('Codex wrapper smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Codex wrapper smoke test failed: ${message}`);
  process.exitCode = 1;
});
