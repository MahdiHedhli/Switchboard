import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { parseSanitizedProviderPayload } = await import(path.join(repoRoot, 'apps/broker/dist/adapters/sanitized-payload.js'));
const {
  refreshFromTrustedCommand,
  resolveTrustedCommand,
  trustedCommandStatus,
} = await import(path.join(repoRoot, 'apps/broker/dist/adapters/trusted-command-adapter.js'));
const { openaiAdapter } = await import(path.join(repoRoot, 'apps/broker/dist/adapters/openai.js'));
const { AdapterRefreshError } = await import(path.join(repoRoot, 'apps/broker/dist/adapters/types.js'));

const commandEnvKey = 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON';
const timeoutEnvKey = 'SWITCHBOARD_OPENAI_REFRESH_TIMEOUT_MS';
const scenarioEnvKey = 'FAKE_TRUSTED_COMMAND_SCENARIO';

function validPayload() {
  return {
    provider: 'openai',
    accounts: [
      {
        id: 'openai-codex-chatgpt',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-21T22:00:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: 'app-server rate-limits' },
          { id: 'plan', label: 'plan', value: 'Pro' },
        ],
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'high',
            interpretation: 'percentage_window',
            limit: 100,
            used: 10,
            remaining: 90,
            notes: 'Sanitized trusted-command snapshot.',
          },
        ],
      },
    ],
  };
}

async function expectAdapterError(action, code, messageFragment) {
  await assert.rejects(
    action,
    (error) => {
      assert(error instanceof AdapterRefreshError);
      assert.equal(error.code, code);
      if (messageFragment) {
        assert.match(error.message, new RegExp(messageFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
      return true;
    },
  );
}

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-adapter-boundary-smoke-'));
const snapshotDir = path.join(tempRoot, 'snapshots');
const fakeCommandPath = path.join(tempRoot, 'trusted-sync.mjs');

const previousCommand = process.env[commandEnvKey];
const previousTimeout = process.env[timeoutEnvKey];
const previousScenario = process.env[scenarioEnvKey];

await mkdir(snapshotDir, { recursive: true, mode: 0o700 });

await writeFile(
  fakeCommandPath,
  `#!/usr/bin/env node
const scenario = process.env.FAKE_TRUSTED_COMMAND_SCENARIO ?? 'success';

if (scenario === 'stderr-fail') {
  process.stderr.write('simulated trusted command failure\\n');
  process.exit(1);
}

if (scenario === 'invalid-json') {
  process.stdout.write('{not valid json');
  process.exit(0);
}

if (scenario === 'invalid-schema') {
  process.stdout.write(JSON.stringify({
    provider: 'openai',
    unexpected: true,
    accounts: []
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  provider: 'openai',
  accounts: [
    {
      id: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      lastRefreshedAt: '2026-04-21T22:00:00.000Z',
      signals: [
        { id: 'source', label: 'source', value: 'app-server rate-limits' },
        { id: 'plan', label: 'plan', value: 'Pro' }
      ],
      quotas: [
        {
          modelId: 'codex',
          displayName: 'Codex',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'unknown',
          source: 'cli',
          confidence: 'high',
          interpretation: 'percentage_window',
          limit: 100,
          used: 10,
          remaining: 90,
          notes: 'Sanitized trusted-command snapshot.'
        }
      ]
    }
  ]
}));
`,
  { mode: 0o700 },
);

try {
  const parsed = parseSanitizedProviderPayload(validPayload(), 'openai', 'provider', 'adapterSmoke');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].provider, 'openai');
  assert.equal(parsed[0].syncMethod, 'provider');
  assert.equal(parsed[0].signals?.[0]?.id, 'source');
  assert.equal(parsed[0].quotas[0]?.interpretation, 'percentage_window');

  assert.throws(
    () => parseSanitizedProviderPayload({ ...validPayload(), extra: true }, 'openai', 'provider', 'adapterSmoke'),
    (error) => error instanceof AdapterRefreshError && error.code === 'invalid_snapshot' && error.message.includes('.extra is not allowed.'),
  );

  delete process.env[commandEnvKey];
  delete process.env[timeoutEnvKey];
  delete process.env[scenarioEnvKey];
  assert.equal(resolveTrustedCommand('openai').state, 'absent');
  assert.equal(trustedCommandStatus('openai', 'OpenAI trusted sync'), null);

  process.env[commandEnvKey] = '{bad json';
  await expectAdapterError(
    refreshFromTrustedCommand('openai', 'OpenAI trusted sync'),
    'command_invalid',
    'must be valid JSON',
  );

  process.env[commandEnvKey] = JSON.stringify(['node', fakeCommandPath]);
  process.env[timeoutEnvKey] = 'bad-timeout';
  assert.equal(resolveTrustedCommand('openai').state, 'invalid');
  await expectAdapterError(
    refreshFromTrustedCommand('openai', 'OpenAI trusted sync'),
    'command_invalid',
    'must be a positive integer',
  );

  process.env[commandEnvKey] = JSON.stringify(['node', fakeCommandPath]);
  delete process.env[timeoutEnvKey];
  process.env[scenarioEnvKey] = 'success';
  const trustedStatus = trustedCommandStatus('openai', 'OpenAI trusted sync');
  assert.equal(trustedStatus?.status, 'ready_with_advisories');
  assert.equal(trustedStatus?.configured, true);
  assert.equal(trustedStatus?.secure, true);
  assert.deepEqual(trustedStatus?.advisoryCodes, ['provider_trusted_command_unvalidated']);
  assert.equal(
    trustedStatus?.statusMessage,
    'Trusted command is configured, but this view has not yet confirmed a live refresh.',
  );
  assert.match(trustedStatus?.source ?? '', /SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node/);
  assert.equal((trustedStatus?.source ?? '').includes(fakeCommandPath), false);
  const adapterStatus = await openaiAdapter.getStatus(snapshotDir);
  assert.equal(adapterStatus.status, 'ready_with_advisories');
  assert.deepEqual(adapterStatus.advisoryCodes, ['provider_trusted_command_unvalidated']);
  assert.equal(
    adapterStatus.statusMessage,
    'Trusted command is configured, but this view has not yet confirmed a live refresh.',
  );
  assert.equal((adapterStatus.source ?? '').includes(fakeCommandPath), false);

  const trustedRefresh = await refreshFromTrustedCommand('openai', 'OpenAI trusted sync');
  assert.equal(trustedRefresh.kind, 'trusted-command');
  assert.equal(trustedRefresh.subscriptions[0]?.provider, 'openai');
  assert.equal(trustedRefresh.subscriptions[0]?.signals?.[1]?.value, 'Pro');

  process.env[scenarioEnvKey] = 'invalid-schema';
  await expectAdapterError(
    refreshFromTrustedCommand('openai', 'OpenAI trusted sync'),
    'invalid_snapshot',
    'unexpected is not allowed',
  );

  process.env[scenarioEnvKey] = 'invalid-json';
  await expectAdapterError(
    refreshFromTrustedCommand('openai', 'OpenAI trusted sync'),
    'command_failed',
    'did not return valid JSON',
  );

  process.env[scenarioEnvKey] = 'stderr-fail';
  await expectAdapterError(
    refreshFromTrustedCommand('openai', 'OpenAI trusted sync'),
    'command_failed',
    'simulated trusted command failure',
  );

  delete process.env[commandEnvKey];
  delete process.env[timeoutEnvKey];
  delete process.env[scenarioEnvKey];

  await writeFile(path.join(snapshotDir, 'openai.json'), `${JSON.stringify(validPayload(), null, 2)}\n`, { mode: 0o600 });
  const snapshotRefresh = await openaiAdapter.refresh(snapshotDir);
  assert.equal(snapshotRefresh.kind, 'snapshot');
  assert.equal(snapshotRefresh.subscriptions[0]?.provider, 'openai');

  await chmod(path.join(snapshotDir, 'openai.json'), 0o666);
  await expectAdapterError(
    openaiAdapter.refresh(snapshotDir),
    'snapshot_insecure',
    'must not be group-writable or world-writable',
  );

  console.log('Adapter boundary smoke test passed.');
} finally {
  if (previousCommand === undefined) {
    delete process.env[commandEnvKey];
  } else {
    process.env[commandEnvKey] = previousCommand;
  }

  if (previousTimeout === undefined) {
    delete process.env[timeoutEnvKey];
  } else {
    process.env[timeoutEnvKey] = previousTimeout;
  }

  if (previousScenario === undefined) {
    delete process.env[scenarioEnvKey];
  } else {
    process.env[scenarioEnvKey] = previousScenario;
  }

  await rm(tempRoot, { recursive: true, force: true });
}
