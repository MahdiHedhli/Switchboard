import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { buildDashboardSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/dashboard.js'));
const { planTasks } = await import(path.join(repoRoot, 'apps/broker/dist/planner.js'));

const subPricing = () => ({ authMode: 'subscription', drawsFromQuota: true });
function entry(provider, modelId, tier, pricing = subPricing(), status = 'active') {
  return { provider, modelId, displayName: `${provider}/${modelId}`, tier, authMode: pricing.authMode, pricing, status };
}
function quota(provider, modelId, overrides = {}) {
  return {
    provider, modelId, displayName: `${provider}/${modelId}`,
    availability: 'available', authMode: 'subscription', usageUnit: 'credits',
    source: 'manual', confidence: 'high', interpretation: 'absolute',
    limit: 100, remaining: 100, ...overrides,
  };
}
const account = (quotas) => ({ id: 'acct', provider: quotas[0]?.provider ?? 'anthropic', displayName: 'acct', authMode: 'subscription', owner: 'op', quotas });
const profile = (o = {}) => ({ id: 'p', name: 'P', description: '', repos: [], roles: [], ...o });
const task = (id, f = {}) => ({ id, title: id, description: id, status: 'planned', priority: 'p1', role: 'op', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...f });

// ---- selector -> planner: covered => runnable -----------------------------
{
  const snapshot = {
    profile: profile({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('anthropic', 'claude-code', { remaining: 100 })])],
    tasks: [task('T-COV', { taskClass: 'work' })],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const catalog = { active: [entry('anthropic', 'claude-code', 'standard')], placeholders: [] };
  const dash = buildDashboardSnapshot(snapshot, catalog);
  assert.equal(dash.plan.runnable.length, 1, 'covered selected task should be runnable');
  assert.equal(dash.plan.runnable[0].id, 'T-COV');
  assert.equal(dash.plan.blocked.length, 0);
  // proves selection ran before the planner:
  assert.equal(dash.plan.runnable[0].reservations[0].source, 'selector');
  assert.equal(dash.plan.runnable[0].reservations[0].provider, 'anthropic');
}

// ---- selector -> planner: uncovered => blocked ----------------------------
{
  const snapshot = {
    profile: profile({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('anthropic', 'claude-code', { remaining: 0 })])],
    tasks: [task('T-UNCOV', { taskClass: 'work' })],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const catalog = { active: [entry('anthropic', 'claude-code', 'standard')], placeholders: [] };
  const dash = buildDashboardSnapshot(snapshot, catalog);
  assert.equal(dash.plan.runnable.length, 0);
  assert.equal(dash.plan.blocked.length, 1, 'selected-but-insufficient task should be blocked by the planner');
  assert.equal(dash.plan.blocked[0].id, 'T-UNCOV');
  assert.ok(dash.plan.warnings.some((w) => w.code === 'quota_low'));
}

// ---- byte-for-byte regression: explicit reservation + no task-class -------
// With a catalog present, tasks that carry an explicit reservation or declare no
// task-class must be passed through to the planner UNCHANGED. Compare against
// calling planTasks directly on the same context.
{
  const reserved = task('T-RES', {
    reservations: [{ provider: 'openai', modelId: 'codex', estimatedCost: 10, usageUnit: 'credits', reason: 'explicit' }],
  });
  const plain = task('T-PLAIN');
  const snapshot = {
    profile: profile({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('openai', 'codex', { remaining: 50 })])],
    tasks: [reserved, plain],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const catalog = { active: [entry('anthropic', 'claude-code', 'standard')], placeholders: [] };

  const directPlan = planTasks({ project: snapshot.profile, subscriptions: snapshot.subscriptions, tasks: snapshot.tasks });
  const dash = buildDashboardSnapshot(snapshot, catalog);
  assert.deepEqual(dash.plan, directPlan, 'planner output must be byte-for-byte identical for explicit-reservation / no-class tasks');

  // and with no catalog argument at all (live server call shape):
  const dashNoCatalog = buildDashboardSnapshot(snapshot);
  assert.deepEqual(dashNoCatalog.plan, directPlan, 'no-catalog path is a structural no-op for the planner');
}

console.log('Selection integration smoke test passed.');
