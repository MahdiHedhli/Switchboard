import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { selectModels } = await import(path.join(repoRoot, 'apps/broker/dist/selector.js'));

// ---- builders -------------------------------------------------------------
const subPricing = () => ({ authMode: 'subscription', drawsFromQuota: true });
const apiPricing = (costPerUnit, unit = 'credits') => ({ authMode: 'api', unit, costPerUnit });

function entry(provider, modelId, tier, pricing, status = 'active') {
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
const account = (quotas) => ({ id: 'acct', provider: quotas[0]?.provider ?? 'openai', displayName: 'acct', authMode: 'subscription', owner: 'op', quotas });
const project = (o = {}) => ({ id: 'p', name: 'P', description: '', repos: [], roles: [], ...o });
const task = (id, f = {}) => ({ id, title: id, description: id, status: 'planned', priority: 'p1', role: 'op', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...f });
const only = (res) => { assert.equal(res.tasks.length, 1); return res.tasks[0].reservations; };

// ---- 1. cheapest-capable --------------------------------------------------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }], selectionPolicy: 'subscription-first' }),
    subscriptions: [account([quota('openai', 'pricey'), quota('anthropic', 'cheap')])],
    catalog: [entry('openai', 'pricey', 'standard', apiPricing(0.5)), entry('anthropic', 'cheap', 'standard', apiPricing(0.1))],
    tasks: [task('T1', { taskClass: 'work' })],
  };
  const r = only(selectModels(ctx));
  assert.equal(r.length, 1);
  assert.equal(r[0].provider, 'anthropic');
  assert.equal(r[0].modelId, 'cheap');
  assert.equal(r[0].source, 'selector');
  assert.equal(r[0].usageUnit, 'credits');
  assert.equal(r[0].estimatedCost, 1);
}

// ---- 2. tier-floor enforcement (cheap-but-too-weak excluded) --------------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'judge', minimumTier: 'heavy' }] }),
    subscriptions: [account([quota('openai', 'light-cheap'), quota('anthropic', 'heavy-pricey')])],
    catalog: [entry('openai', 'light-cheap', 'light', apiPricing(0.01)), entry('anthropic', 'heavy-pricey', 'heavy', apiPricing(0.5))],
    tasks: [task('T2', { taskClass: 'judge' })],
  };
  const r = only(selectModels(ctx));
  assert.equal(r[0].provider, 'anthropic');
  assert.equal(r[0].modelId, 'heavy-pricey');
}

// ---- 3. failover via unavailable ------------------------------------------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('openai', 'cheap', { availability: 'unavailable' }), quota('anthropic', 'pricier')])],
    catalog: [entry('openai', 'cheap', 'standard', apiPricing(0.1)), entry('anthropic', 'pricier', 'standard', apiPricing(0.3))],
    tasks: [task('T3', { taskClass: 'work' })],
  };
  const r = only(selectModels(ctx));
  assert.equal(r[0].provider, 'anthropic');
  assert.equal(r[0].modelId, 'pricier');
}

// ---- 4. unresolved (floor no active model clears; no placeholders) --------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'judge', minimumTier: 'heavy' }] }),
    subscriptions: [account([quota('openai', 'std')])],
    catalog: [entry('openai', 'std', 'standard', apiPricing(0.1))],
    tasks: [task('T4', { taskClass: 'judge' })],
  };
  const res = selectModels(ctx);
  assert.equal(res.tasks[0].reservations, undefined);
  assert.equal(res.warnings.length, 1);
  assert.equal(res.warnings[0].code, 'selection_unresolved');
  assert.equal(res.warnings[0].taskId, 'T4');
}

// ---- 4b. placeholder-skipped warning (no active candidate, placeholders) --
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'judge', minimumTier: 'heavy' }] }),
    subscriptions: [],
    catalog: [],
    placeholders: [{ provider: 'openai', modelId: 'codex' }, { provider: 'google', modelId: 'gemini-cli' }],
    tasks: [task('T4b', { taskClass: 'judge' })],
  };
  const res = selectModels(ctx);
  assert.equal(res.tasks[0].reservations, undefined);
  assert.equal(res.warnings[0].code, 'selection_placeholder_skipped');
  assert.equal(res.warnings[0].excluded.length, 2);
}

// ---- 5. subscription-first vs scarcity-preserving -------------------------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([
      quota('anthropic', 'premium', { limit: 100, remaining: 5 }),  // near-exhausted subscription
      quota('openai', 'api-cheap', { authMode: 'api' }),
    ])],
    catalog: [
      entry('anthropic', 'premium', 'standard', subPricing()),
      entry('openai', 'api-cheap', 'standard', apiPricing(0.1)),
    ],
    tasks: [task('T5', { taskClass: 'work' })],
  };
  const subFirst = only(selectModels(ctx, 'subscription-first'));
  assert.equal(subFirst[0].provider, 'anthropic', 'subscription-first should keep the subscription');
  const scarcity = only(selectModels(ctx, 'subscription-first-scarcity-preserving'));
  assert.equal(scarcity[0].provider, 'openai', 'scarcity-preserving should fail over to the cheaper API model');
}

// ---- 6. per-class selectionPolicyOverride ---------------------------------
{
  const ctx = {
    project: project({
      selectionPolicy: 'subscription-first',
      taskClasses: [
        { id: 'classA', minimumTier: 'standard' },
        { id: 'classB', minimumTier: 'standard', selectionPolicyOverride: 'subscription-first-scarcity-preserving' },
      ],
    }),
    subscriptions: [account([
      quota('anthropic', 'premium', { limit: 100, remaining: 5 }),
      quota('openai', 'api-cheap', { authMode: 'api' }),
    ])],
    catalog: [
      entry('anthropic', 'premium', 'standard', subPricing()),
      entry('openai', 'api-cheap', 'standard', apiPricing(0.1)),
    ],
    tasks: [task('TA', { taskClass: 'classA' }), task('TB', { taskClass: 'classB' })],
  };
  const res = selectModels(ctx);
  assert.equal(res.tasks[0].reservations[0].provider, 'anthropic', 'classA uses profile subscription-first');
  assert.equal(res.tasks[1].reservations[0].provider, 'openai', 'classB override -> scarcity-preserving');
}

// ---- 7. modelPin bypasses selection ---------------------------------------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('google', 'gemini-x')])],
    catalog: [entry('openai', 'std', 'standard', apiPricing(0.1))],
    tasks: [task('T7', { modelPin: { provider: 'google', modelId: 'gemini-x' } })],
  };
  const r = only(selectModels(ctx));
  assert.equal(r[0].provider, 'google');
  assert.equal(r[0].modelId, 'gemini-x');
  assert.equal(r[0].source, 'pin');
}

// ---- 8. placeholder rows are never candidates -----------------------------
{
  const ctx = {
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('openai', 'cheap-ph'), quota('anthropic', 'active-std')])],
    catalog: [
      entry('openai', 'cheap-ph', 'standard', apiPricing(0.01), 'placeholder'), // cheapest, but placeholder
      entry('anthropic', 'active-std', 'standard', apiPricing(0.2), 'active'),
    ],
    tasks: [task('T8', { taskClass: 'work' })],
  };
  const r = only(selectModels(ctx));
  assert.equal(r[0].provider, 'anthropic', 'placeholder must be excluded even though cheaper');
  assert.equal(r[0].modelId, 'active-std');
}

// ---- 9. deterministic tie-break (effectiveCost tie -> provider, modelId) --
{
  const mk = (catalog) => ({
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }], selectionPolicy: 'subscription-first' }),
    subscriptions: [account([quota('openai', 'm'), quota('anthropic', 'm')])],
    catalog,
    tasks: [task('T9', { taskClass: 'work' })],
  });
  const a = entry('openai', 'm', 'standard', subPricing());
  const b = entry('anthropic', 'm', 'standard', subPricing());
  const r1 = only(selectModels(mk([a, b])));
  const r2 = only(selectModels(mk([b, a])));
  assert.equal(r1[0].provider, 'anthropic', 'tie-break picks provider asc regardless of order');
  assert.equal(r2[0].provider, 'anthropic', 'tie-break is order-independent');
}

// ---- byte-for-byte passthrough: existing reservation & no-class -----------
{
  const reserved = task('TR', { reservations: [{ provider: 'openai', modelId: 'codex', estimatedCost: 9, usageUnit: 'credits', reason: 'explicit' }] });
  const plain = task('TP');
  const ctx = {
    project: project({ taskClasses: [{ id: 'work', minimumTier: 'standard' }] }),
    subscriptions: [account([quota('openai', 'std')])],
    catalog: [entry('openai', 'std', 'standard', apiPricing(0.1))],
    tasks: [reserved, plain],
  };
  const res = selectModels(ctx);
  assert.equal(res.tasks[0], reserved, 'task with explicit reservation passes through by reference');
  assert.equal(res.tasks[1], plain, 'task with no class/pin passes through by reference');
  assert.equal(res.warnings.length, 0);
}

console.log('Selector smoke test passed.');
