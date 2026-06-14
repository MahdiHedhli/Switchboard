import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  formatPlannerWarningPills,
  formatProviderSyncSummaryDisplayMessage,
  formatProviderSyncSummaryPills,
  formatQuotaCoverageMessage,
} = await import(path.join(repoRoot, 'packages/core/dist/index.js'));
const { buildDashboardSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const snapshot = {
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Dashboard smoke test project',
    repos: [],
    roles: [],
  },
  subscriptions: [
    {
      id: 'openai-codex-chatgpt',
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'provider',
      signals: [
        { id: 'source', label: 'source', value: 'app-server account' },
        { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
        { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
        { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      ],
      quotas: [
        {
          provider: 'openai',
          modelId: 'codex',
          displayName: 'Codex',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'unknown',
          source: 'cli',
          confidence: 'medium',
          interpretation: 'informational',
        },
      ],
    },
  ],
  tasks: [
    {
      id: 'TASK-APPROVAL',
      title: 'Review live wrapper output',
      description: 'Approval-gated smoke task',
      status: 'planned',
      priority: 'p1',
      role: 'operator',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
      approvalRequired: true,
      approvalRequestedAt: '2026-04-22T00:00:00.000Z',
    },
    {
      id: 'TASK-QUOTA',
      title: 'Check quota warning detail',
      description: 'Planner should expose machine-readable quota warning detail',
      status: 'planned',
      priority: 'p1',
      role: 'operator',
      createdAt: '2026-04-22T00:00:00.000Z',
      updatedAt: '2026-04-22T00:00:00.000Z',
      reservations: [
        {
          provider: 'openai',
          modelId: 'codex',
          estimatedCost: 10,
          usageUnit: 'credits',
          reason: 'dashboard smoke quota warning',
        },
      ],
    },
  ],
  updatedAt: '2026-04-22T00:00:00.000Z',
};

const dashboard = buildDashboardSnapshot(snapshot);

assert.equal(dashboard.updatedAt, snapshot.updatedAt);
assert.equal(dashboard.tasks.length, 2);
assert.equal(dashboard.subscriptions.length, 1);
assert.deepEqual(dashboard.providerSummaries, [
  {
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    latestAccountRefreshedAt: undefined,
    accountSyncMethods: ['provider'],
    degraded: true,
    syncModes: ['app-server-account'],
    syncBadges: ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    rateLimitHosts: ['chatgpt.com'],
    openaiAuth: ['required'],
    quotaCoverage: 'informational_only',
    quotaModels: 1,
    typedQuotaModels: 0,
  },
]);
assert.equal(
  formatProviderSyncSummaryDisplayMessage(dashboard.providerSummaries[0]),
  'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory)',
);
assert.deepEqual(
  formatProviderSyncSummaryPills(dashboard.providerSummaries[0]),
  [
    'account sync: provider',
    'mode: app-server-account',
    'host: chatgpt.com',
    'OpenAI auth required',
    'quota: informational_only',
    'typed quota models: 0/1',
  ],
);
assert.equal(dashboard.plan.runnable.length, 1);
assert.equal(dashboard.plan.runnable[0]?.id, 'TASK-QUOTA');
assert.equal(dashboard.plan.blocked.length, 1);
assert.equal(dashboard.plan.blocked[0]?.id, 'TASK-APPROVAL');
assert.equal(
  formatQuotaCoverageMessage(dashboard.subscriptions[0]?.quotas ?? []),
  'Live typed quota windows are unavailable in this launch context. Showing informational account metadata only.',
);
assert.equal(
  formatQuotaCoverageMessage([
    dashboard.subscriptions[0]?.quotas[0],
    {
      provider: 'openai',
      modelId: 'gpt-5.3-codex-spark',
      displayName: 'GPT-5.3-Codex-Spark',
      availability: 'available',
      authMode: 'subscription',
      usageUnit: 'unknown',
      source: 'cli',
      confidence: 'high',
      interpretation: 'percentage_window',
      remaining: 100,
      used: 0,
      limit: 100,
      windows: [
        {
          id: '300m',
          label: '5-hour window',
          durationMinutes: 300,
          limit: 100,
          used: 0,
          remaining: 100,
          interpretation: 'percentage_window',
        },
      ],
    },
  ].filter(Boolean)),
  'Some models only have informational metadata in this launch context. Prefer rows with explicit window data for live quota tracking.',
);
assert.deepEqual(dashboard.plan.warnings, [
  {
    code: 'provider_sync_degraded',
    message:
      'Codex Supervisor (Pro) is running with partial app-server account context (usage endpoint unavailable via chatgpt.com); OpenAI auth required. Live rate-limit windows are unavailable in this launch context.',
    details: {
      kind: 'provider_sync',
      provider: 'openai',
      accountId: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor (Pro)',
      mode: 'app-server-account',
      accountSyncMethods: ['provider'],
      source: 'app-server account',
      rateLimitsDetail: 'usage endpoint unavailable',
      rateLimitsHost: 'chatgpt.com',
      openaiAuthRequired: true,
    },
  },
  {
    code: 'approval_pending',
    message: 'Task TASK-APPROVAL requires operator approval before it can move into execution.',
  },
  {
    code: 'quota_unknown',
    message:
      'Task TASK-QUOTA is using non-comparable or unknown quota data because Codex (openai/codex) only exposes informational quota metadata.',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-QUOTA',
      provider: 'openai',
      modelId: 'codex',
      displayName: 'Codex',
      status: 'unknown',
      quotaAvailability: 'available',
      quotaInterpretation: 'informational',
      quotaUsageUnit: 'unknown',
      reservationUsageUnit: 'credits',
      reservationEstimatedCost: 10,
    },
  },
]);
assert.deepEqual(
  formatPlannerWarningPills(dashboard.plan.warnings[2]),
  ['task: TASK-QUOTA', 'openai/codex', 'quota: unknown', 'interpretation: informational', 'quota unit: unknown'],
);

const mixedSnapshot = {
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Dashboard smoke test project',
    repos: [],
    roles: [],
  },
  subscriptions: [
    {
      id: 'openai-codex-chatgpt',
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'provider',
      signals: [
        { id: 'source', label: 'source', value: 'app-server rate-limits' },
        { id: 'plan', label: 'plan', value: 'Pro' },
        { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      ],
      quotas: [
        {
          provider: 'openai',
          modelId: 'codex',
          displayName: 'Codex',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'unknown',
          source: 'cli',
          confidence: 'medium',
          interpretation: 'informational',
        },
        {
          provider: 'openai',
          modelId: 'gpt-5.3-codex-spark',
          displayName: 'GPT-5.3-Codex-Spark',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'unknown',
          source: 'cli',
          confidence: 'high',
          interpretation: 'percentage_window',
          remaining: 100,
          used: 0,
          limit: 100,
          windows: [
            {
              id: '300m',
              label: '5-hour window',
              durationMinutes: 300,
              limit: 100,
              used: 0,
              remaining: 100,
              interpretation: 'percentage_window',
            },
          ],
        },
      ],
    },
  ],
  tasks: [],
  updatedAt: '2026-04-22T01:00:00.000Z',
};

const mixedDashboard = buildDashboardSnapshot(mixedSnapshot);

assert.deepEqual(mixedDashboard.providerSummaries, [
  {
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    latestAccountRefreshedAt: undefined,
    accountSyncMethods: ['provider'],
    degraded: false,
    syncModes: ['app-server-rate-limits'],
    syncBadges: [],
    rateLimitHosts: [],
    openaiAuth: ['required'],
    quotaCoverage: 'mixed',
    quotaModels: 2,
    typedQuotaModels: 1,
  },
]);
assert.equal(
  formatProviderSyncSummaryDisplayMessage(mixedDashboard.providerSummaries[0]),
  'app-server rate-limits available',
);
assert.deepEqual(
  formatProviderSyncSummaryPills(mixedDashboard.providerSummaries[0]),
  [
    'account sync: provider',
    'mode: app-server-rate-limits',
    'OpenAI auth required',
    'quota: mixed',
    'typed quota models: 1/2',
  ],
);
assert.deepEqual(mixedDashboard.plan.warnings, []);
assert.equal(
  formatQuotaCoverageMessage(mixedDashboard.subscriptions[0]?.quotas ?? []),
  'Some models only have informational metadata in this launch context. Prefer rows with explicit window data for live quota tracking.',
);

const typedSnapshot = {
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Dashboard smoke test project',
    repos: [],
    roles: [],
  },
  subscriptions: [
    {
      id: 'openai-codex-chatgpt-typed',
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'provider',
      signals: [
        { id: 'source', label: 'source', value: 'app-server rate-limits' },
        { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      ],
      quotas: [
        {
          provider: 'openai',
          modelId: 'codex',
          displayName: 'Codex',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'unknown',
          source: 'cli',
          confidence: 'high',
          interpretation: 'percentage_window',
          remaining: 91,
          used: 9,
          limit: 100,
          windows: [
            {
              id: '300m',
              label: '5-hour window',
              durationMinutes: 300,
              limit: 100,
              used: 9,
              remaining: 91,
              interpretation: 'percentage_window',
            },
          ],
        },
      ],
    },
  ],
  tasks: [],
  updatedAt: '2026-04-22T02:00:00.000Z',
};

const typedDashboard = buildDashboardSnapshot(typedSnapshot);

assert.deepEqual(typedDashboard.providerSummaries, [
  {
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    latestAccountRefreshedAt: undefined,
    accountSyncMethods: ['provider'],
    degraded: false,
    syncModes: ['app-server-rate-limits'],
    syncBadges: [],
    rateLimitHosts: [],
    openaiAuth: ['required'],
    quotaCoverage: 'typed',
    quotaModels: 1,
    typedQuotaModels: 1,
  },
]);
assert.equal(
  formatProviderSyncSummaryDisplayMessage(typedDashboard.providerSummaries[0]),
  'app-server rate-limits available',
);
assert.deepEqual(
  formatProviderSyncSummaryPills(typedDashboard.providerSummaries[0]),
  [
    'account sync: provider',
    'mode: app-server-rate-limits',
    'OpenAI auth required',
  ],
);
assert.deepEqual(typedDashboard.plan.warnings, []);
assert.equal(formatQuotaCoverageMessage(typedDashboard.subscriptions[0]?.quotas ?? []), null);

console.log('Dashboard smoke test passed.');
