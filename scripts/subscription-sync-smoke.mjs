import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  buildProviderDashboardSummaries,
  describeSubscriptionSync,
  formatProviderAdapterLaunchDriftWarning,
  formatSubscriptionAccountWarning,
  formatProviderRefreshSummaryMessage,
  formatProviderSyncQuotaCoverageLabel,
  isProviderSyncSummaryAdvisory,
  formatProviderSyncQuotaCoverageMessage,
  formatProviderSyncSummaryDisplayMessage,
  formatProviderSyncSummaryMessage,
  formatProviderSyncSummaryPills,
  formatPlannerWarningPills,
  formatPlannerWarningTitle,
  formatSubscriptionSyncBadge,
  formatSubscriptionSyncPlannerMessage,
  plannerWarningKey,
  summarizeProviderAccountContext,
} = await import(path.join(repoRoot, 'packages/core/dist/index.js'));

function account(displayName, signals = []) {
  return { displayName, signals };
}

const healthy = account('Codex Supervisor (Pro)', [
  { id: 'source', label: 'source', value: 'app-server rate-limits' },
  { id: 'openai_auth', label: 'openai-auth', value: 'required' },
]);

assert.deepEqual(describeSubscriptionSync(healthy), {
  mode: 'app-server-rate-limits',
  source: 'app-server rate-limits',
  rateLimitsDetail: undefined,
  rateLimitsHost: undefined,
  openaiAuthRequired: true,
  degraded: false,
});
assert.equal(formatSubscriptionSyncBadge(healthy), null);
assert.equal(formatSubscriptionSyncPlannerMessage(healthy), null);

const partial = account('Codex Supervisor (Pro)', [
  { id: 'source', label: 'source', value: 'app-server account' },
  { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
  { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
  { id: 'openai_auth', label: 'openai-auth', value: 'required' },
]);

assert.deepEqual(describeSubscriptionSync(partial), {
  mode: 'app-server-account',
  source: 'app-server account',
  rateLimitsDetail: 'usage endpoint unavailable',
  rateLimitsHost: 'chatgpt.com',
  openaiAuthRequired: true,
  degraded: true,
});
assert.equal(
  formatSubscriptionSyncBadge(partial),
  'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required',
);
assert.equal(
  formatSubscriptionAccountWarning(partial),
  'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required',
);
assert.equal(
  formatSubscriptionSyncPlannerMessage(partial),
  'Codex Supervisor (Pro) is running with partial app-server account context (usage endpoint unavailable via chatgpt.com); OpenAI auth required. Live rate-limit windows are unavailable in this launch context.',
);
assert.deepEqual(
  formatPlannerWarningPills({
    code: 'provider_sync_degraded',
    message: 'ignored for smoke',
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
  }),
  ['openai · app-server-account', 'host: chatgpt.com', 'OpenAI auth required'],
);
assert.deepEqual(
  formatPlannerWarningPills({
    code: 'provider_snapshot_only',
    message: 'ignored for smoke',
    details: {
      kind: 'provider_sync',
      provider: 'anthropic',
      accountId: 'anthropic-main',
      displayName: 'Claude Code',
      accountSyncMethods: ['snapshot'],
      source: 'snapshot',
      openaiAuthRequired: false,
    },
  }),
  ['anthropic · snapshot', 'account sync: snapshot'],
);
assert.deepEqual(
  formatPlannerWarningPills({
    code: 'quota_unknown',
    message: 'ignored for smoke',
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
  }),
  ['task: TASK-ADVISORY', 'openai/codex', 'quota: unknown', 'interpretation: percentage_window', 'quota unit: unknown'],
);
assert.deepEqual(
  formatPlannerWarningPills({
    code: 'quota_low',
    message: 'ignored for smoke',
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
  }),
  ['task: TASK-LOW', 'openai/codex', 'quota: insufficient', 'remaining: 5 credits'],
);
assert.equal(
  formatPlannerWarningTitle({
    code: 'quota_unknown',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-ADVISORY',
      provider: 'openai',
      modelId: 'codex',
      status: 'unknown',
      reservationUsageUnit: 'credits',
      reservationEstimatedCost: 10,
    },
  }),
  'quota_unknown · TASK-ADVISORY',
);
assert.equal(
  plannerWarningKey({
    code: 'quota_unknown',
    message: 'ignored for smoke',
    details: {
      kind: 'quota_reservation',
      taskId: 'TASK-ADVISORY',
      provider: 'openai',
      modelId: 'codex',
      status: 'unknown',
      reservationUsageUnit: 'credits',
      reservationEstimatedCost: 10,
    },
  }),
  'quota_unknown-TASK-ADVISORY-openai-codex-unknown',
);
assert.equal(
  formatPlannerWarningTitle({
    code: 'provider_sync_degraded',
    details: {
      kind: 'provider_sync',
      provider: 'openai',
      accountId: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor (Pro)',
      openaiAuthRequired: true,
    },
  }),
  'provider_sync_degraded · openai',
);
assert.equal(
  plannerWarningKey({
    code: 'provider_sync_degraded',
    message: 'ignored for smoke',
    details: {
      kind: 'provider_sync',
      provider: 'openai',
      accountId: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor (Pro)',
      mode: 'app-server-account',
      openaiAuthRequired: true,
    },
  }),
  'provider_sync_degraded-openai-openai-codex-chatgpt-app-server-account',
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    syncModes: ['app-server-account'],
  }),
  'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required',
);
assert.deepEqual(
  formatProviderSyncSummaryPills({
    accountSyncMethods: ['provider'],
    syncModes: ['app-server-account'],
    rateLimitHosts: ['chatgpt.com'],
    openaiAuth: ['required'],
    quotaCoverage: 'informational_only',
    quotaModels: 1,
    typedQuotaModels: 0,
  }),
  [
    'account sync: provider',
    'mode: app-server-account',
    'host: chatgpt.com',
    'OpenAI auth required',
    'quota: informational_only',
    'typed quota models: 0/1',
  ],
);
assert.equal(
  formatProviderSyncQuotaCoverageMessage({
    quotaCoverage: 'informational_only',
    quotaModels: 1,
    typedQuotaModels: 0,
  }),
  'This provider refresh only has informational quota metadata (0/1 models with typed windows). Live typed quota windows are unavailable.',
);
assert.equal(
  formatProviderRefreshSummaryMessage({
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    accountSyncMethods: ['provider'],
    syncBadges: ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    syncModes: ['app-server-account'],
    degraded: true,
    quotaCoverage: 'informational_only',
    quotaModels: 1,
    typedQuotaModels: 0,
  }),
  'openai refreshed Codex Supervisor (Pro) · partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) · informational quota only',
);

const fallback = account('Codex Supervisor', [
  { id: 'source', label: 'source', value: 'login-status fallback' },
  { id: 'rate_limits', label: 'rate-limits', value: 'app-server unavailable' },
]);

assert.deepEqual(describeSubscriptionSync(fallback), {
  mode: 'login-status-fallback',
  source: 'login-status fallback',
  rateLimitsDetail: 'app-server unavailable',
  rateLimitsHost: undefined,
  openaiAuthRequired: false,
  degraded: true,
});
assert.equal(formatSubscriptionSyncBadge(fallback), 'login fallback: app-server unavailable');
assert.equal(formatSubscriptionAccountWarning(fallback), 'login fallback: app-server unavailable');
assert.equal(
  formatSubscriptionSyncPlannerMessage(fallback),
  'Codex Supervisor is running on login-status fallback (app-server unavailable). Typed rate-limit windows are unavailable in this launch context.',
);
assert.deepEqual(
  formatPlannerWarningPills({
    code: 'provider_sync_degraded',
    message: 'ignored for smoke',
    details: {
      kind: 'provider_sync',
      provider: 'openai',
      accountId: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor',
      mode: 'login-status-fallback',
      source: 'login-status fallback',
      rateLimitsDetail: 'app-server unavailable',
      openaiAuthRequired: false,
    },
  }),
  ['openai · login-status-fallback'],
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: ['login fallback: app-server unavailable'],
    syncModes: ['login-status-fallback'],
    accountSyncMethods: ['snapshot'],
  }),
  'login fallback: app-server unavailable',
);
assert.deepEqual(
  formatProviderSyncSummaryPills({
    accountSyncMethods: ['snapshot'],
    syncModes: ['login-status-fallback'],
    rateLimitHosts: [],
    openaiAuth: [],
    quotaCoverage: 'none',
    quotaModels: 0,
    typedQuotaModels: 0,
  }),
  ['account sync: snapshot', 'mode: login-status-fallback', 'quota: none'],
);
assert.equal(
  formatProviderSyncQuotaCoverageMessage({
    quotaCoverage: 'none',
    quotaModels: 0,
    typedQuotaModels: 0,
  }),
  'This provider refresh returned no quota rows yet.',
);

const unknown = account('Codex Supervisor', [
  { id: 'source', label: 'source', value: 'manual snapshot' },
  { id: 'openai_auth', label: 'openai-auth', value: 'required' },
]);

assert.deepEqual(describeSubscriptionSync(unknown), {
  mode: 'unknown',
  source: 'manual snapshot',
  rateLimitsDetail: undefined,
  rateLimitsHost: undefined,
  openaiAuthRequired: true,
  degraded: false,
});
assert.equal(formatSubscriptionSyncBadge(unknown), null);
assert.equal(
  formatSubscriptionAccountWarning({
    displayName: 'Claude Code',
    syncMethod: 'snapshot',
    signals: [],
  }),
  'Claude Code is currently using snapshot-backed provider state. Live trusted-command refresh has not been confirmed for this account.',
);
assert.equal(
  formatSubscriptionAccountWarning({
    displayName: 'Codex Supervisor',
    syncMethod: 'seed',
    signals: [],
  }),
  null,
);
assert.equal(formatSubscriptionSyncPlannerMessage(unknown), null);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: [],
    syncModes: ['app-server-rate-limits'],
    accountSyncMethods: ['provider'],
  }),
  'app-server rate-limits available',
);
assert.deepEqual(
  formatProviderSyncSummaryPills({
    accountSyncMethods: ['provider'],
    syncModes: ['app-server-rate-limits'],
    rateLimitHosts: [],
    openaiAuth: ['required'],
    quotaCoverage: 'typed',
    quotaModels: 2,
    typedQuotaModels: 2,
  }),
  ['account sync: provider', 'mode: app-server-rate-limits', 'OpenAI auth required'],
);
assert.equal(
  formatProviderSyncQuotaCoverageMessage({
    quotaCoverage: 'typed',
    quotaModels: 2,
    typedQuotaModels: 2,
  }),
  null,
);
assert.equal(
  formatProviderRefreshSummaryMessage({
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    accountSyncMethods: ['provider'],
    syncBadges: [],
    syncModes: ['app-server-rate-limits'],
    degraded: false,
    quotaCoverage: 'typed',
    quotaModels: 2,
    typedQuotaModels: 2,
  }),
  'openai refreshed Codex Supervisor (Pro) · app-server rate-limits available',
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: [],
    syncModes: [],
    accountSyncMethods: ['snapshot'],
  }),
  'snapshot-backed refresh',
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: [],
    syncModes: [],
    accountSyncMethods: ['provider'],
  }),
  'provider-backed refresh',
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: [],
    syncModes: [],
    accountSyncMethods: ['seed'],
  }),
  'seeded state only',
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: [],
    syncModes: [],
    accountSyncMethods: ['provider', 'snapshot'],
  }),
  'mixed account sync sources: provider, snapshot',
);
assert.equal(
  formatProviderSyncSummaryDisplayMessage({
    syncBadges: [],
    syncModes: [],
    degraded: false,
    accountSyncMethods: ['snapshot'],
  }),
  'snapshot-backed refresh (advisory)',
);
assert.equal(
  formatProviderSyncSummaryDisplayMessage({
    syncBadges: ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    syncModes: ['app-server-account'],
    degraded: true,
    accountSyncMethods: ['provider'],
  }),
  'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory)',
);
assert.equal(
  formatProviderSyncSummaryDisplayMessage({
    syncBadges: [],
    syncModes: [],
    degraded: false,
    accountSyncMethods: ['provider'],
  }),
  'provider-backed refresh',
);
assert.equal(
  isProviderSyncSummaryAdvisory({
    degraded: false,
    accountSyncMethods: ['provider'],
  }),
  false,
);
assert.equal(
  isProviderSyncSummaryAdvisory({
    degraded: false,
    accountSyncMethods: ['snapshot'],
  }),
  true,
);
assert.equal(
  isProviderSyncSummaryAdvisory({
    degraded: false,
    accountSyncMethods: ['seed'],
  }),
  true,
);
assert.equal(
  isProviderSyncSummaryAdvisory({
    degraded: false,
    accountSyncMethods: ['provider', 'snapshot'],
  }),
  true,
);
assert.equal(
  isProviderSyncSummaryAdvisory({
    degraded: true,
    accountSyncMethods: ['provider'],
  }),
  true,
);
assert.equal(
  formatProviderSyncSummaryMessage({
    syncBadges: [],
    syncModes: [],
    accountSyncMethods: [],
  }),
  null,
);
assert.equal(
  formatProviderAdapterLaunchDriftWarning(
    {
      accountSyncMethods: ['provider'],
    },
    {
      kind: 'snapshot',
      configured: false,
      secure: false,
    },
  ),
  'Persisted provider-backed state is present, but this broker launch is not configured for live provider refresh. Restart with the reviewed trusted-command adapter or provide a sanitized snapshot.',
);
assert.equal(
  formatProviderAdapterLaunchDriftWarning(
    {
      accountSyncMethods: ['provider'],
    },
    {
      kind: 'trusted-command',
      configured: true,
      secure: true,
    },
  ),
  null,
);
assert.deepEqual(
  formatProviderSyncSummaryPills({
    accountSyncMethods: ['snapshot'],
    syncModes: [],
    rateLimitHosts: [],
    openaiAuth: [],
    quotaCoverage: 'mixed',
    quotaModels: 2,
    typedQuotaModels: 1,
  }),
  ['account sync: snapshot', 'quota: mixed', 'typed quota models: 1/2'],
);
assert.equal(
  formatProviderSyncQuotaCoverageMessage({
    quotaCoverage: 'mixed',
    quotaModels: 2,
    typedQuotaModels: 1,
  }),
  'This provider refresh mixes typed quota windows with informational-only rows (1/2 models with typed windows). Prefer models with explicit window data for live quota tracking.',
);
assert.equal(
  formatProviderRefreshSummaryMessage({
    provider: 'anthropic',
    accounts: 2,
    accountDisplayNames: ['Claude Code', 'Claude Console'],
    accountSyncMethods: ['snapshot'],
    syncBadges: [],
    syncModes: [],
    degraded: false,
    quotaCoverage: 'mixed',
    quotaModels: 2,
    typedQuotaModels: 1,
  }),
  'anthropic refreshed 2 accounts · snapshot-backed refresh (advisory) · typed quota 1/2 models',
);
assert.equal(
  formatProviderSyncQuotaCoverageLabel({
    quotaCoverage: 'informational_only',
    quotaModels: 1,
    typedQuotaModels: 0,
  }),
  'informational quota only',
);
assert.equal(
  formatProviderSyncQuotaCoverageLabel({
    quotaCoverage: 'none',
    quotaModels: 0,
    typedQuotaModels: 0,
  }),
  'no quota rows yet',
);
assert.equal(
  formatProviderSyncQuotaCoverageLabel({
    quotaCoverage: 'mixed',
    quotaModels: 2,
    typedQuotaModels: 1,
  }),
  'typed quota 1/2 models',
);
assert.equal(
  formatProviderSyncQuotaCoverageLabel({
    quotaCoverage: 'typed',
    quotaModels: 2,
    typedQuotaModels: 2,
  }),
  null,
);
assert.deepEqual(
  summarizeProviderAccountContext([
    {
      displayName: 'Codex Supervisor (Pro)',
      lastRefreshedAt: '2026-04-22T06:10:00.000Z',
      syncMethod: 'provider',
    },
    {
      displayName: 'Codex Supervisor (Pro)',
      lastRefreshedAt: '2026-04-22T06:05:00.000Z',
      syncMethod: 'provider',
    },
    {
      displayName: 'Fallback Codex Session',
      lastRefreshedAt: '2026-04-22T06:20:00.000Z',
      syncMethod: 'snapshot',
    },
  ]),
  {
    accountDisplayNames: ['Codex Supervisor (Pro)', 'Fallback Codex Session'],
    latestAccountRefreshedAt: '2026-04-22T06:20:00.000Z',
    accountSyncMethods: ['provider', 'snapshot'],
  },
);
assert.deepEqual(
  buildProviderDashboardSummaries([
    {
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      lastRefreshedAt: '2026-04-22T06:10:00.000Z',
      syncMethod: 'provider',
      signals: [
        { id: 'source', label: 'source', value: 'app-server account' },
        { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
        { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
        { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      ],
    },
    {
      provider: 'openai',
      displayName: 'Fallback Codex Session',
      lastRefreshedAt: '2026-04-22T06:20:00.000Z',
      syncMethod: 'snapshot',
      signals: [
        { id: 'source', label: 'source', value: 'login-status fallback' },
        { id: 'rate_limits', label: 'rate-limits', value: 'app-server unavailable' },
      ],
    },
    {
      provider: 'anthropic',
      displayName: 'Claude Code',
      lastRefreshedAt: '2026-04-22T05:55:00.000Z',
      syncMethod: 'seed',
      signals: [],
    },
  ]),
  [
    {
      provider: 'anthropic',
      accounts: 1,
      accountDisplayNames: ['Claude Code'],
      latestAccountRefreshedAt: '2026-04-22T05:55:00.000Z',
      accountSyncMethods: ['seed'],
      degraded: false,
      syncModes: [],
      syncBadges: [],
      rateLimitHosts: [],
      openaiAuth: [],
      quotaCoverage: 'none',
      quotaModels: 0,
      typedQuotaModels: 0,
    },
    {
      provider: 'openai',
      accounts: 2,
      accountDisplayNames: ['Codex Supervisor (Pro)', 'Fallback Codex Session'],
      latestAccountRefreshedAt: '2026-04-22T06:20:00.000Z',
      accountSyncMethods: ['provider', 'snapshot'],
      degraded: true,
      syncModes: ['app-server-account', 'login-status-fallback'],
      syncBadges: [
        'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required',
        'login fallback: app-server unavailable',
      ],
      rateLimitHosts: ['chatgpt.com'],
      openaiAuth: ['required'],
      quotaCoverage: 'none',
      quotaModels: 0,
      typedQuotaModels: 0,
    },
  ],
);
const fullTypedProviderDashboardSummary = buildProviderDashboardSummaries([
  {
    provider: 'openai',
    displayName: 'Codex Supervisor (Pro)',
    lastRefreshedAt: '2026-04-22T06:25:00.000Z',
    syncMethod: 'provider',
    signals: [
      { id: 'source', label: 'source', value: 'app-server rate-limits' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ],
    quotas: [
      {
        modelId: 'codex',
        displayName: 'Codex',
        interpretation: 'percentage_window',
        limit: 100,
        used: 9,
        remaining: 91,
        resetAt: '2026-04-22T06:30:00.000Z',
      },
      {
        modelId: 'codex_bengalfox',
        displayName: 'GPT-5.3-Codex-Spark',
        interpretation: 'percentage_window',
        limit: 200,
        used: 40,
        remaining: 160,
        resetAt: '2026-04-22T06:45:00.000Z',
      },
    ],
  },
]);
assert.deepEqual(fullTypedProviderDashboardSummary, [
  {
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    latestAccountRefreshedAt: '2026-04-22T06:25:00.000Z',
    accountSyncMethods: ['provider'],
    degraded: false,
    syncModes: ['app-server-rate-limits'],
    syncBadges: [],
    rateLimitHosts: [],
    openaiAuth: ['required'],
    quotaCoverage: 'typed',
    quotaModels: 2,
    typedQuotaModels: 2,
  },
]);
assert.deepEqual(
  formatProviderSyncSummaryPills(fullTypedProviderDashboardSummary[0]),
  ['account sync: provider', 'mode: app-server-rate-limits', 'OpenAI auth required'],
);
assert.equal(
  formatProviderSyncSummaryDisplayMessage(fullTypedProviderDashboardSummary[0]),
  'app-server rate-limits available',
);
assert.equal(
  formatProviderRefreshSummaryMessage({
    provider: 'openai',
    accounts: fullTypedProviderDashboardSummary[0].accounts,
    accountDisplayNames: fullTypedProviderDashboardSummary[0].accountDisplayNames,
    accountSyncMethods: fullTypedProviderDashboardSummary[0].accountSyncMethods,
    syncBadges: fullTypedProviderDashboardSummary[0].syncBadges,
    syncModes: fullTypedProviderDashboardSummary[0].syncModes,
    degraded: fullTypedProviderDashboardSummary[0].degraded,
    quotaCoverage: fullTypedProviderDashboardSummary[0].quotaCoverage,
    quotaModels: fullTypedProviderDashboardSummary[0].quotaModels,
    typedQuotaModels: fullTypedProviderDashboardSummary[0].typedQuotaModels,
  }),
  'openai refreshed Codex Supervisor (Pro) · app-server rate-limits available',
);
const mixedProviderDashboardSummary = buildProviderDashboardSummaries([
  {
    provider: 'openai',
    displayName: 'Codex Supervisor (Pro)',
    lastRefreshedAt: '2026-04-22T06:30:00.000Z',
    syncMethod: 'provider',
    signals: [
      { id: 'source', label: 'source', value: 'app-server rate-limits' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ],
    quotas: [
      {
        modelId: 'codex',
        displayName: 'Codex',
        interpretation: 'percentage_window',
        limit: 100,
        used: 9,
        remaining: 91,
        resetAt: '2026-04-22T06:35:00.000Z',
      },
      {
        modelId: 'codex_bengalfox',
        displayName: 'GPT-5.3-Codex-Spark',
        interpretation: 'informational',
      },
    ],
  },
]);
assert.deepEqual(mixedProviderDashboardSummary, [
  {
    provider: 'openai',
    accounts: 1,
    accountDisplayNames: ['Codex Supervisor (Pro)'],
    latestAccountRefreshedAt: '2026-04-22T06:30:00.000Z',
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
assert.deepEqual(
  formatProviderSyncSummaryPills(mixedProviderDashboardSummary[0]),
  [
    'account sync: provider',
    'mode: app-server-rate-limits',
    'OpenAI auth required',
    'quota: mixed',
    'typed quota models: 1/2',
  ],
);
assert.equal(
  formatProviderSyncSummaryDisplayMessage(mixedProviderDashboardSummary[0]),
  'app-server rate-limits available',
);
assert.equal(
  formatProviderRefreshSummaryMessage({
    provider: 'openai',
    accounts: mixedProviderDashboardSummary[0].accounts,
    accountDisplayNames: mixedProviderDashboardSummary[0].accountDisplayNames,
    accountSyncMethods: mixedProviderDashboardSummary[0].accountSyncMethods,
    syncBadges: mixedProviderDashboardSummary[0].syncBadges,
    syncModes: mixedProviderDashboardSummary[0].syncModes,
    degraded: mixedProviderDashboardSummary[0].degraded,
    quotaCoverage: mixedProviderDashboardSummary[0].quotaCoverage,
    quotaModels: mixedProviderDashboardSummary[0].quotaModels,
    typedQuotaModels: mixedProviderDashboardSummary[0].typedQuotaModels,
  }),
  'openai refreshed Codex Supervisor (Pro) · app-server rate-limits available · typed quota 1/2 models',
);
assert.deepEqual(
  formatPlannerWarningPills({
    code: 'quota_unknown',
    message: 'ignored for smoke',
  }),
  [],
);

console.log('Subscription sync smoke test passed.');
