import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { loadDashboardCatalog, buildDashboardSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

// 1. the real on-disk catalog normalizes to all-placeholder (live broker no-op)
const real = await loadDashboardCatalog(path.join(repoRoot, 'config/model-catalog.json'));
assert.equal(real.active.length, 0, 'shipped catalog is intentionally all-placeholder -> no active routing');
assert.ok(real.placeholders.length >= 4, 'placeholder rows (incl. xai/grok-cli) are surfaced');
assert.ok(real.placeholders.some((p) => p.provider === 'xai' && p.modelId === 'grok-cli'));

// 2. a missing/malformed catalog degrades to empty (broker must still start)
const missing = await loadDashboardCatalog(path.join(repoRoot, 'config/does-not-exist.json'));
assert.deepEqual(missing, { active: [], placeholders: [] });

// 3. with an ACTIVE catalog + a task-class task, the wired dashboard runs selection
const subPricing = () => ({ authMode: 'subscription', drawsFromQuota: true });
const snapshot = {
  profile: {
    id: 'wiring', name: 'Wiring', description: '', repos: [], roles: [],
    taskClasses: [{ id: 'work', minimumTier: 'standard' }],
    selectionPolicy: 'subscription-first',
  },
  subscriptions: [{
    id: 'acct', provider: 'anthropic', displayName: 'acct', authMode: 'subscription', owner: 'op',
    quotas: [{ provider: 'anthropic', modelId: 'claude-code', displayName: 'Claude Code', availability: 'available', authMode: 'subscription', usageUnit: 'credits', source: 'manual', confidence: 'high', interpretation: 'absolute', limit: 100, remaining: 100 }],
  }],
  tasks: [{ id: 'T-WIRE', title: 'T', description: 'T', status: 'planned', priority: 'p1', role: 'op', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', taskClass: 'work' }],
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const activeCatalog = {
  active: [{ provider: 'anthropic', modelId: 'claude-code', displayName: 'Claude Code', tier: 'standard', authMode: 'subscription', pricing: subPricing(), status: 'active' }],
  placeholders: [],
};
const dash = buildDashboardSnapshot(snapshot, activeCatalog);
assert.equal(dash.plan.runnable.length, 1, 'selected + covered task is runnable via the wired dashboard');
assert.equal(dash.plan.runnable[0].id, 'T-WIRE');
assert.equal(dash.plan.runnable[0].reservations[0].source, 'selector', 'selection ran inside buildDashboardSnapshot');

console.log('Broker catalog wiring smoke test passed.');
