import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { AdapterRegistry } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));
const { applyLocalBrokerDefaults } = await import(path.join(repoRoot, 'scripts/local-broker-launch.mjs'));

const commandEnvKey = 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON';
const defaultCommandEnvKey = 'SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON';
const brokerHostEnvKey = 'SWITCHBOARD_BROKER_HOST';
const previousCommand = process.env[commandEnvKey];
const previousDefaultCommand = process.env[defaultCommandEnvKey];
const previousBrokerHost = process.env[brokerHostEnvKey];

function profileWithProviders(providers) {
  return {
    id: 'adapter-status-smoke',
    name: 'Adapter Status Smoke',
    description: 'Adapter status contract smoke profile',
    repos: [],
    roles: providers.map((provider) => ({
      id: `${provider}-role`,
      name: `${provider} role`,
      provider,
      defaultModelId: `${provider}-model`,
      responsibilities: ['smoke'],
      canWrite: true,
      canReview: true,
      canApprove: false,
    })),
  };
}

function validPayload(provider, displayName) {
  return {
    provider,
    accounts: [
      {
        id: `${provider}-account`,
        displayName,
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T08:00:00.000Z',
        quotas: [
          {
            modelId: `${provider}-model`,
            displayName,
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'high',
            interpretation: 'informational',
          },
        ],
      },
    ],
  };
}

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-adapter-status-smoke-'));
const snapshotDir = path.join(tempRoot, 'snapshots');

try {
  await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(snapshotDir, 'anthropic.json'),
    `${JSON.stringify(validPayload('anthropic', 'Claude Code'), null, 2)}\n`,
    { mode: 0o600 },
  );

  delete process.env[commandEnvKey];
  process.env[defaultCommandEnvKey] = JSON.stringify(['node', '/tmp/inferred-openai-sync.mjs']);
  process.env[brokerHostEnvKey] = '127.0.0.1';
  await applyLocalBrokerDefaults(process.env, { repoRootPath: repoRoot });

  const registry = new AdapterRegistry(snapshotDir);
  const inferredStatuses = await registry.listForProfile(profileWithProviders(['openai']));
  assert.equal(inferredStatuses[0]?.status, 'ready_with_advisories');
  assert.match(inferredStatuses[0]?.source ?? '', /SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node/);
  assert.equal((inferredStatuses[0]?.source ?? '').includes('/tmp'), false);
  assert.equal((inferredStatuses[0]?.source ?? '').includes('inferred-openai-sync.mjs'), false);
  assert.deepEqual(inferredStatuses[0]?.advisoryCodes, ['provider_trusted_command_unvalidated']);
  assert.equal(
    inferredStatuses[0]?.statusMessage,
    'Trusted command is configured, but this view has not yet confirmed a live refresh.',
  );

  delete process.env[defaultCommandEnvKey];
  process.env[commandEnvKey] = JSON.stringify(['node', '/tmp/fake-openai-sync.mjs']);
  const readyStatuses = await registry.listForProfile(profileWithProviders(['openai', 'anthropic', 'google']));
  const readyByProvider = Object.fromEntries(readyStatuses.map((entry) => [entry.provider, entry]));

  assert.equal(readyByProvider.openai.status, 'ready_with_advisories');
  assert.match(readyByProvider.openai.source, /SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node/);
  assert.equal(readyByProvider.openai.source.includes('/tmp'), false);
  assert.equal(readyByProvider.openai.source.includes('fake-openai-sync.mjs'), false);
  assert.deepEqual(readyByProvider.openai.advisoryCodes, ['provider_trusted_command_unvalidated']);
  assert.equal(
    readyByProvider.openai.statusMessage,
    'Trusted command is configured, but this view has not yet confirmed a live refresh.',
  );
  assert.equal(readyByProvider.anthropic.status, 'ready');
  assert.equal(readyByProvider.anthropic.source, 'anthropic.json');
  assert.equal(readyByProvider.anthropic.source.includes(snapshotDir), false);
  assert.equal(readyByProvider.anthropic.configured, true);
  assert.equal(readyByProvider.anthropic.secure, true);
  assert.match(readyByProvider.anthropic.lastModifiedAt ?? '', /^2026-/);
  assert.equal(readyByProvider.google.status, 'missing');
  assert.equal(readyByProvider.google.source, 'google.json');
  assert.equal(readyByProvider.google.problem, 'No sanitized snapshot file found yet.');

  await chmod(path.join(snapshotDir, 'anthropic.json'), 0o666);
  const insecureStatuses = await registry.listForProfile(profileWithProviders(['anthropic']));
  assert.equal(insecureStatuses[0]?.status, 'insecure');
  assert.equal(insecureStatuses[0]?.problem, 'Snapshot file permissions are too open.');

  process.env[commandEnvKey] = '{bad json';
  const invalidStatuses = await registry.listForProfile(profileWithProviders(['openai']));
  assert.equal(invalidStatuses[0]?.status, 'invalid');
  assert.equal(invalidStatuses[0]?.configured, false);
  assert.equal(invalidStatuses[0]?.secure, false);
  assert.equal(invalidStatuses[0]?.source, commandEnvKey);
  assert.match(invalidStatuses[0]?.problem ?? '', /must be valid JSON/);
  assert.equal((invalidStatuses[0]?.problem ?? '').includes('{bad json'), false);

  console.log('Adapter status smoke test passed.');
} finally {
  if (previousCommand === undefined) {
    delete process.env[commandEnvKey];
  } else {
    process.env[commandEnvKey] = previousCommand;
  }

  if (previousDefaultCommand === undefined) {
    delete process.env[defaultCommandEnvKey];
  } else {
    process.env[defaultCommandEnvKey] = previousDefaultCommand;
  }

  if (previousBrokerHost === undefined) {
    delete process.env[brokerHostEnvKey];
  } else {
    process.env[brokerHostEnvKey] = previousBrokerHost;
  }

  await rm(tempRoot, { recursive: true, force: true });
}
