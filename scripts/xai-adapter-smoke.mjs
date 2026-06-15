import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { AdapterRegistry } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

// ensure the snapshot path (not a trusted command) is exercised
delete process.env.SWITCHBOARD_XAI_REFRESH_COMMAND_JSON;

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-xai-adapter-smoke-'));
const registry = new AdapterRegistry(tempRoot);

function xaiProfile() {
  return {
    id: 'xai-smoke', name: 'xAI Smoke', description: 'xai adapter smoke', repos: [],
    roles: [{ id: 'grok', name: 'Grok failover', provider: 'xai', defaultModelId: 'grok-cli', responsibilities: ['failover'], canWrite: true, canReview: true, canApprove: false }],
  };
}

try {
  // 1. registration
  const adapter = registry.getAdapter('xai');
  assert.ok(adapter, 'xai adapter must be registered in the registry');
  assert.equal(adapter.provider, 'xai');

  // 2. missing snapshot
  const missing = await adapter.getStatus(tempRoot);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.source, 'xai.json');
  assert.equal(missing.configured, false);

  // 3. valid, secure snapshot -> ready + refresh parses as provider 'xai'
  const snapshotPath = path.join(tempRoot, 'xai.json');
  await writeFile(snapshotPath, JSON.stringify({
    provider: 'xai',
    accounts: [{
      id: 'xai-grok-cli', displayName: 'Grok CLI', authMode: 'subscription', owner: 'operator',
      lastRefreshedAt: '2026-06-15T00:00:00.000Z',
      quotas: [{ modelId: 'grok-cli', displayName: 'Grok CLI', availability: 'available', authMode: 'subscription', usageUnit: 'unknown', source: 'cli', confidence: 'high', interpretation: 'informational' }],
    }],
  }), { mode: 0o600 });
  await chmod(snapshotPath, 0o600);

  const ready = await adapter.getStatus(tempRoot);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.secure, true);

  const refresh = await adapter.refresh(tempRoot);
  assert.equal(refresh.provider, 'xai');
  assert.equal(refresh.kind, 'snapshot');
  assert.equal(refresh.subscriptions[0]?.provider, 'xai');
  assert.equal(refresh.subscriptions[0]?.quotas[0]?.modelId, 'grok-cli');

  // 4. registration wired through profile resolution
  const statuses = await registry.listForProfile(xaiProfile());
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.provider, 'xai');
  assert.equal(statuses[0]?.status, 'ready');

  const refreshed = await registry.refreshProviders(xaiProfile());
  assert.equal(refreshed[0]?.provider, 'xai');
  assert.equal(refreshed[0]?.subscriptions[0]?.quotas[0]?.modelId, 'grok-cli');

  // 5. insecure file mode -> insecure status
  await chmod(snapshotPath, 0o666);
  const insecure = await adapter.getStatus(tempRoot);
  assert.equal(insecure.status, 'insecure');
  assert.equal(insecure.secure, false);

  console.log('xAI adapter smoke test passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
