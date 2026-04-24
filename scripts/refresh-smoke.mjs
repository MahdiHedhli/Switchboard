import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  formatProviderRefreshSummaryMessage,
  formatProviderSyncQuotaCoverageMessage,
  formatProviderSyncSummaryDisplayMessage,
  formatProviderSyncSummaryPills,
} = await import(path.join(repoRoot, 'packages/core/dist/index.js'));
const { buildProviderRefreshSummary } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const degradedSummary = buildProviderRefreshSummary({
  provider: 'openai',
  kind: 'trusted-command',
  refreshedAt: '2026-04-22T06:00:00.000Z',
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
});

assert.deepEqual(degradedSummary, {
  provider: 'openai',
  kind: 'trusted-command',
  refreshedAt: '2026-04-22T06:00:00.000Z',
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
});
assert.equal(
  formatProviderSyncSummaryDisplayMessage(degradedSummary),
  'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory)',
);
assert.deepEqual(
  formatProviderSyncSummaryPills(degradedSummary),
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
  formatProviderSyncQuotaCoverageMessage(degradedSummary),
  'This provider refresh only has informational quota metadata (0/1 models with typed windows). Live typed quota windows are unavailable.',
);
assert.equal(
  formatProviderRefreshSummaryMessage(degradedSummary),
  'openai refreshed Codex Supervisor (Pro) · partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) · informational quota only',
);

const healthySummary = buildProviderRefreshSummary({
  provider: 'anthropic',
  kind: 'snapshot',
  refreshedAt: '2026-04-22T06:00:00.000Z',
  subscriptions: [
    {
      id: 'anthropic-main',
      provider: 'anthropic',
      displayName: 'Claude Code',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'snapshot',
      quotas: [],
    },
  ],
});

assert.deepEqual(healthySummary, {
  provider: 'anthropic',
  kind: 'snapshot',
  refreshedAt: '2026-04-22T06:00:00.000Z',
  accounts: 1,
  accountDisplayNames: ['Claude Code'],
  latestAccountRefreshedAt: undefined,
  accountSyncMethods: ['snapshot'],
  degraded: false,
  syncModes: [],
  syncBadges: [],
  rateLimitHosts: [],
  openaiAuth: [],
  quotaCoverage: 'none',
  quotaModels: 0,
  typedQuotaModels: 0,
});

const mixedSummary = buildProviderRefreshSummary({
  provider: 'openai',
  kind: 'trusted-command',
  refreshedAt: '2026-04-22T06:30:00.000Z',
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
});

assert.deepEqual(mixedSummary, {
  provider: 'openai',
  kind: 'trusted-command',
  refreshedAt: '2026-04-22T06:30:00.000Z',
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
});
assert.equal(
  formatProviderSyncSummaryDisplayMessage(mixedSummary),
  'app-server rate-limits available',
);
assert.deepEqual(
  formatProviderSyncSummaryPills(mixedSummary),
  [
    'account sync: provider',
    'mode: app-server-rate-limits',
    'OpenAI auth required',
    'quota: mixed',
    'typed quota models: 1/2',
  ],
);
assert.equal(
  formatProviderSyncQuotaCoverageMessage(mixedSummary),
  'This provider refresh mixes typed quota windows with informational-only rows (1/2 models with typed windows). Prefer models with explicit window data for live quota tracking.',
);
assert.equal(
  formatProviderRefreshSummaryMessage(mixedSummary),
  'openai refreshed Codex Supervisor (Pro) · app-server rate-limits available · typed quota 1/2 models',
);

const typedSummary = buildProviderRefreshSummary({
  provider: 'openai',
  kind: 'trusted-command',
  refreshedAt: '2026-04-22T07:00:00.000Z',
  subscriptions: [
    {
      id: 'openai-codex-chatgpt-fully-typed',
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
});

assert.deepEqual(typedSummary, {
  provider: 'openai',
  kind: 'trusted-command',
  refreshedAt: '2026-04-22T07:00:00.000Z',
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
});
assert.equal(
  formatProviderSyncSummaryDisplayMessage(typedSummary),
  'app-server rate-limits available',
);
assert.deepEqual(
  formatProviderSyncSummaryPills(typedSummary),
  [
    'account sync: provider',
    'mode: app-server-rate-limits',
    'OpenAI auth required',
  ],
);
assert.equal(formatProviderSyncQuotaCoverageMessage(typedSummary), null);
assert.equal(
  formatProviderRefreshSummaryMessage(typedSummary),
  'openai refreshed Codex Supervisor (Pro) · app-server rate-limits available',
);

console.log('Refresh smoke test passed.');
