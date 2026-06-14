import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { planTasks } = await import(path.join(repoRoot, 'apps/broker/dist/planner.js'));

const project = {
  id: 'threatpedia',
  name: 'Threatpedia',
  description: 'Smoke test project',
  repos: [],
  roles: [],
};

function buildTask(id, estimatedCost, usageUnit = 'credits') {
  return {
    id,
    title: id,
    description: `${id} smoke task`,
    status: 'planned',
    priority: 'p1',
    role: 'operator',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    reservations: [
      {
        provider: 'openai',
        modelId: 'codex',
        estimatedCost,
        usageUnit,
        reason: 'planner smoke test',
      },
    ],
  };
}

function buildApprovalTask(id) {
  return {
    id,
    title: id,
    description: `${id} approval smoke task`,
    status: 'planned',
    priority: 'p1',
    role: 'operator',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    approvalRequired: true,
    approvalRequestedAt: '2026-04-21T00:00:00.000Z',
  };
}

function buildAccount(quota) {
  return {
    id: 'openai-codex-chatgpt',
    provider: 'openai',
    displayName: 'Codex Supervisor',
    authMode: 'subscription',
    owner: 'operator',
    quotas: [quota],
  };
}

function buildSnapshotAccount() {
  return {
    id: 'anthropic-main',
    provider: 'anthropic',
    displayName: 'Claude Code',
    authMode: 'subscription',
    owner: 'operator',
    syncMethod: 'snapshot',
    quotas: [
      {
        provider: 'anthropic',
        modelId: 'claude-code',
        displayName: 'Claude Code',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'credits',
        source: 'manual',
        confidence: 'high',
        interpretation: 'absolute',
        remaining: 88,
      },
    ],
  };
}

function buildDegradedAccount(source, rateLimits, rateLimitsHost) {
  return {
    id: 'openai-codex-chatgpt',
    provider: 'openai',
    displayName: 'Codex Supervisor (Pro)',
    authMode: 'subscription',
    owner: 'operator',
    signals: [
      { id: 'source', label: 'source', value: source },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      ...(rateLimits ? [{ id: 'rate_limits', label: 'rate-limits', value: rateLimits }] : []),
      ...(rateLimitsHost ? [{ id: 'rate_limits_host', label: 'rate-limits-host', value: rateLimitsHost }] : []),
    ],
    quotas: [
      quota({
        usageUnit: 'unknown',
        interpretation: 'informational',
        remaining: undefined,
      }),
    ],
  };
}

function quota(overrides) {
  return {
    provider: 'openai',
    modelId: 'codex',
    displayName: 'Codex',
    availability: 'available',
    authMode: 'subscription',
    usageUnit: 'credits',
    source: 'cli',
    confidence: 'high',
    interpretation: 'absolute',
    remaining: 100,
    ...overrides,
  };
}

const advisoryResult = planTasks({
  project,
  subscriptions: [
    buildAccount(
      quota({
        usageUnit: 'unknown',
        interpretation: 'percentage_window',
        limit: 100,
        used: 10,
        remaining: 90,
      }),
    ),
  ],
  tasks: [buildTask('TASK-ADVISORY', 10)],
});

assert.equal(advisoryResult.runnable.length, 1);
assert.equal(advisoryResult.blocked.length, 0);
assert.deepEqual(advisoryResult.warnings, [
  {
    code: 'quota_unknown',
    message: 'Task TASK-ADVISORY is using non-comparable or unknown quota data because Codex (openai/codex) only exposes percentage-window quota data.',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-ADVISORY',
      provider: 'openai',
      modelId: 'codex',
      displayName: 'Codex',
      status: 'unknown',
      quotaAvailability: 'available',
      quotaInterpretation: 'percentage_window',
      quotaUsageUnit: 'unknown',
      reservationUsageUnit: 'credits',
      quotaRemaining: 90,
      reservationEstimatedCost: 10,
    },
  },
]);

const missingQuotaResult = planTasks({
  project,
  subscriptions: [],
  tasks: [buildTask('TASK-MISSING', 10)],
});

assert.equal(missingQuotaResult.runnable.length, 0);
assert.equal(missingQuotaResult.blocked.length, 1);
assert.deepEqual(missingQuotaResult.warnings, [
  {
    code: 'quota_low',
    message: 'Task TASK-MISSING cannot be scheduled safely because openai/codex has no quota row yet.',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-MISSING',
      provider: 'openai',
      modelId: 'codex',
      status: 'missing',
      reservationUsageUnit: 'credits',
      reservationEstimatedCost: 10,
    },
  },
]);

const lowQuotaResult = planTasks({
  project,
  subscriptions: [
    buildAccount(
      quota({
        remaining: 5,
      }),
    ),
  ],
  tasks: [buildTask('TASK-LOW', 10)],
});

assert.equal(lowQuotaResult.runnable.length, 0);
assert.equal(lowQuotaResult.blocked.length, 1);
assert.deepEqual(lowQuotaResult.warnings, [
  {
    code: 'quota_low',
    message: 'Task TASK-LOW cannot be scheduled safely because Codex (openai/codex) has 5 credits remaining, below the 10 credits reservation.',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-LOW',
      provider: 'openai',
      modelId: 'codex',
      displayName: 'Codex',
      status: 'insufficient',
      quotaAvailability: 'available',
      quotaInterpretation: 'absolute',
      quotaUsageUnit: 'credits',
      reservationUsageUnit: 'credits',
      quotaRemaining: 5,
      reservationEstimatedCost: 10,
    },
  },
]);

const unavailableResult = planTasks({
  project,
  subscriptions: [
    buildAccount(
      quota({
        availability: 'unavailable',
        remaining: 100,
      }),
    ),
  ],
  tasks: [buildTask('TASK-OFFLINE', 10)],
});

assert.equal(unavailableResult.runnable.length, 0);
assert.equal(unavailableResult.blocked.length, 1);
assert.deepEqual(unavailableResult.warnings, [
  {
    code: 'model_unavailable',
    message: 'Task TASK-OFFLINE is blocked because Codex (openai/codex) is currently unavailable.',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-OFFLINE',
      provider: 'openai',
      modelId: 'codex',
      displayName: 'Codex',
      status: 'unavailable',
      quotaAvailability: 'unavailable',
      quotaInterpretation: 'absolute',
      quotaUsageUnit: 'credits',
      reservationUsageUnit: 'credits',
      quotaRemaining: 100,
      reservationEstimatedCost: 10,
    },
  },
]);

const approvalResult = planTasks({
  project,
  subscriptions: [],
  tasks: [buildApprovalTask('TASK-APPROVAL')],
});

assert.equal(approvalResult.runnable.length, 0);
assert.equal(approvalResult.blocked.length, 1);
assert.deepEqual(approvalResult.warnings, [
  {
    code: 'approval_pending',
    message: 'Task TASK-APPROVAL requires operator approval before it can move into execution.',
  },
]);

const degradedSyncResult = planTasks({
  project,
  subscriptions: [
    buildDegradedAccount('app-server account', 'usage endpoint unavailable', 'chatgpt.com'),
  ],
  tasks: [],
});

assert.equal(degradedSyncResult.runnable.length, 0);
assert.equal(degradedSyncResult.blocked.length, 0);
assert.deepEqual(degradedSyncResult.warnings, [
  {
    code: 'provider_sync_degraded',
    message: 'Codex Supervisor (Pro) is running with partial app-server account context (usage endpoint unavailable via chatgpt.com); OpenAI auth required. Live rate-limit windows are unavailable in this launch context.',
    details: {
      kind: 'provider_sync',
      provider: 'openai',
      accountId: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor (Pro)',
      mode: 'app-server-account',
      source: 'app-server account',
      rateLimitsDetail: 'usage endpoint unavailable',
      rateLimitsHost: 'chatgpt.com',
      openaiAuthRequired: true,
    },
  },
]);

const snapshotSyncResult = planTasks({
  project,
  subscriptions: [
    buildSnapshotAccount(),
  ],
  tasks: [],
});

assert.equal(snapshotSyncResult.runnable.length, 0);
assert.equal(snapshotSyncResult.blocked.length, 0);
assert.deepEqual(snapshotSyncResult.warnings, [
  {
    code: 'provider_snapshot_only',
    message: 'Claude Code is currently using snapshot-backed provider state. Live trusted-command refresh has not been confirmed for this account.',
    details: {
      kind: 'provider_sync',
      provider: 'anthropic',
      accountId: 'anthropic-main',
      displayName: 'Claude Code',
      accountSyncMethods: ['snapshot'],
      source: 'snapshot',
      openaiAuthRequired: false,
    },
  },
]);

console.log('Planner smoke test passed.');
