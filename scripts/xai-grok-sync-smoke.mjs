import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const wrapperEntry = path.join(repoRoot, 'scripts/provider-sync/xai-grok-sync.mjs');
const { parseSanitizedProviderPayload } = await import(path.join(repoRoot, 'apps/broker/dist/adapters/sanitized-payload.js'));

async function runWrapper(envOverrides = {}) {
  return await new Promise((resolve, reject) => {
    const env = { ...process.env, ...envOverrides };
    const child = spawn(process.execPath, [wrapperEntry], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    child.stderr.on('data', (c) => err.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    child.once('error', reject);
    child.once('close', (code) => resolve({
      code: code ?? 1,
      stdout: Buffer.concat(out).toString('utf8').trim(),
      stderr: Buffer.concat(err).toString('utf8').trim(),
    }));
  });
}

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-xai-sync-smoke-'));
const fakeGrokPath = path.join(tempRoot, 'fake-grok.mjs');

await writeFile(
  fakeGrokPath,
  `#!/usr/bin/env node
const scenario = process.env.FAKE_GROK_SCENARIO ?? 'probe-ok';
const args = process.argv.slice(2);

if (args.join(' ') === '--version') {
  process.stdout.write('1.2.0\\n');
  process.exit(0);
}

if (args.includes('--prompt') || args.includes('-p')) {
  if (scenario === 'probe-fail') {
    process.stdout.write(JSON.stringify({ session_id: 'secret-session-id', response: 'unexpected', stats: {} }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    session_id: 'secret-session-id',
    response: 'SWITCHBOARD_GROK_STATUS_OK',
    stats: { models: { 'grok-4-fast': { api: { totalRequests: 1, totalErrors: 0 }, tokens: { total: 42 } } } }
  }));
  process.exit(0);
}

process.stderr.write('unexpected fake grok invocation\\n');
process.exit(2);
`,
  { mode: 0o700 },
);
await chmod(fakeGrokPath, 0o700);

try {
  const defaultStatus = await runWrapper({ GROK_CLI_PATH: fakeGrokPath });
  assert.equal(defaultStatus.code, 0);
  assert.equal(defaultStatus.stderr, '');
  const defaultAccounts = parseSanitizedProviderPayload(JSON.parse(defaultStatus.stdout), 'xai', 'provider', 'xaiSmoke');
  assert.equal(defaultAccounts[0]?.id, 'xai-grok-cli');
  assert.equal(defaultAccounts[0]?.signals?.find((s) => s.id === 'source')?.value, 'grok version');
  assert.equal(defaultAccounts[0]?.quotas[0]?.availability, 'unknown');
  assert.equal(defaultAccounts[0]?.quotas[0]?.interpretation, 'informational');

  const probe = await runWrapper({ GROK_CLI_PATH: fakeGrokPath, SWITCHBOARD_XAI_LIVE_PROBE: '1', FAKE_GROK_SCENARIO: 'probe-ok' });
  assert.equal(probe.code, 0);
  assert.equal(probe.stdout.includes('secret-session-id'), false, 'must not leak raw session material');
  const probeAccounts = parseSanitizedProviderPayload(JSON.parse(probe.stdout), 'xai', 'provider', 'xaiSmoke');
  assert.equal(probeAccounts[0]?.signals?.find((s) => s.id === 'source')?.value, 'grok live probe');
  assert.equal(probeAccounts[0]?.signals?.find((s) => s.id === 'probe')?.value, 'ok');
  assert.equal(probeAccounts[0]?.signals?.find((s) => s.id === 'model')?.value, 'grok-4-fast');
  assert.equal(probeAccounts[0]?.quotas[0]?.modelId, 'grok-4-fast');
  assert.equal(probeAccounts[0]?.quotas[0]?.availability, 'available');

  const probeFail = await runWrapper({ GROK_CLI_PATH: fakeGrokPath, SWITCHBOARD_XAI_LIVE_PROBE: '1', FAKE_GROK_SCENARIO: 'probe-fail' });
  assert.equal(probeFail.code, 0);
  assert.equal(probeFail.stdout.includes('secret-session-id'), false);
  const probeFailAccounts = parseSanitizedProviderPayload(JSON.parse(probeFail.stdout), 'xai', 'provider', 'xaiSmoke');
  assert.equal(probeFailAccounts[0]?.id, 'xai-grok-probe-unavailable');
  assert.equal(probeFailAccounts[0]?.quotas[0]?.availability, 'unavailable');

  // degrade-to-unavailableAccount on a missing CLI (probe failure path)
  const missingCli = await runWrapper({ GROK_CLI_PATH: path.join(tempRoot, 'missing-grok') });
  assert.equal(missingCli.code, 0);
  const missingAccounts = parseSanitizedProviderPayload(JSON.parse(missingCli.stdout), 'xai', 'provider', 'xaiSmoke');
  assert.equal(missingAccounts[0]?.id, 'xai-grok-unavailable');
  assert.equal(missingAccounts[0]?.signals?.find((s) => s.id === 'source')?.value, 'grok cli unavailable');
  assert.equal(missingAccounts[0]?.quotas[0]?.availability, 'unavailable');

  console.log('xAI Grok sync smoke test passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
