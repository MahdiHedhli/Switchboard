import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const wrapperEntry = path.join(repoRoot, 'scripts/provider-sync/anthropic-claude-sync.mjs');
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

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-anthropic-sync-smoke-'));
const fakeClaudePath = path.join(tempRoot, 'fake-claude.mjs');

await writeFile(
  fakeClaudePath,
  `#!/usr/bin/env node
const scenario = process.env.FAKE_CLAUDE_SCENARIO ?? 'logged-in';
const args = process.argv.slice(2);

if (args.join(' ') === '--version') {
  process.stdout.write('2.1.118 (Claude Code)\\n');
  process.exit(0);
}

if (args.join(' ') === 'auth status --json') {
  if (scenario === 'signed-out') {
    process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: 'none' }));
    process.exit(0);
  }

  if (scenario === 'bad-json') {
    process.stdout.write('{not json');
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    email: 'operator@example.invalid',
    orgId: 'secret-org-id',
    orgName: 'Operator Private Org',
    subscriptionType: 'max'
  }));
  process.exit(0);
}

process.stderr.write('unexpected fake claude invocation\\n');
process.exit(2);
`,
  { mode: 0o700 },
);
await chmod(fakeClaudePath, 0o700);

try {
  const loggedIn = await runWrapper({
    CLAUDE_CLI_PATH: fakeClaudePath,
    FAKE_CLAUDE_SCENARIO: 'logged-in',
  });
  assert.equal(loggedIn.code, 0);
  assert.equal(loggedIn.stderr, '');
  assert.equal(loggedIn.stdout.includes('operator@example.invalid'), false);
  assert.equal(loggedIn.stdout.includes('secret-org-id'), false);
  assert.equal(loggedIn.stdout.includes('Operator Private Org'), false);
  const loggedInPayload = JSON.parse(loggedIn.stdout);
  const loggedInAccounts = parseSanitizedProviderPayload(loggedInPayload, 'anthropic', 'provider', 'anthropicSmoke');
  assert.equal(loggedInAccounts.length, 1);
  assert.equal(loggedInAccounts[0]?.id, 'anthropic-claude-subscription');
  assert.equal(loggedInAccounts[0]?.displayName, 'Claude Code (Max)');
  assert.equal(loggedInAccounts[0]?.syncMethod, 'provider');
  assert.equal(loggedInAccounts[0]?.signals?.find((signal) => signal.id === 'source')?.value, 'claude auth status');
  assert.equal(loggedInAccounts[0]?.signals?.find((signal) => signal.id === 'auth_method')?.value, 'claude.ai');
  assert.equal(loggedInAccounts[0]?.quotas[0]?.availability, 'available');
  assert.equal(loggedInAccounts[0]?.quotas[0]?.interpretation, 'informational');

  const signedOut = await runWrapper({
    CLAUDE_CLI_PATH: fakeClaudePath,
    FAKE_CLAUDE_SCENARIO: 'signed-out',
  });
  assert.equal(signedOut.code, 0);
  const signedOutAccounts = parseSanitizedProviderPayload(JSON.parse(signedOut.stdout), 'anthropic', 'provider', 'anthropicSmoke');
  assert.equal(signedOutAccounts[0]?.id, 'anthropic-claude-signed-out');
  assert.equal(signedOutAccounts[0]?.quotas[0]?.availability, 'unavailable');

  const badJson = await runWrapper({
    CLAUDE_CLI_PATH: fakeClaudePath,
    FAKE_CLAUDE_SCENARIO: 'bad-json',
  });
  assert.equal(badJson.code, 0);
  const badJsonAccounts = parseSanitizedProviderPayload(JSON.parse(badJson.stdout), 'anthropic', 'provider', 'anthropicSmoke');
  assert.equal(badJsonAccounts[0]?.id, 'anthropic-claude-status-unavailable');
  assert.equal(badJsonAccounts[0]?.signals?.find((signal) => signal.id === 'source')?.value, 'claude cli unavailable');

  const missingCli = await runWrapper({
    CLAUDE_CLI_PATH: path.join(tempRoot, 'missing-claude'),
  });
  assert.equal(missingCli.code, 0);
  const missingAccounts = parseSanitizedProviderPayload(JSON.parse(missingCli.stdout), 'anthropic', 'provider', 'anthropicSmoke');
  assert.equal(missingAccounts[0]?.id, 'anthropic-claude-unavailable');
  assert.equal(missingAccounts[0]?.quotas[0]?.availability, 'unavailable');

  console.log('Anthropic Claude sync smoke test passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
