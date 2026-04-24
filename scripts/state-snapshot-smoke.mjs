import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { buildProjectStateSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const snapshot = buildProjectStateSnapshot({
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Raw state snapshot smoke test project',
    repos: [
      {
        id: 'main',
        path: '/workspace/threatpedia',
        visibility: 'private',
        role: 'working',
      },
    ],
    roles: [
      {
        id: 'kernel-proxy',
        name: 'Kernel Proxy',
        provider: 'openai',
        defaultModelId: 'codex',
        responsibilities: ['Plan work', 'Review diffs'],
        canWrite: true,
        canReview: true,
        canApprove: true,
      },
    ],
  },
  subscriptions: [
    {
      id: 'openai-codex-chatgpt',
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'provider',
      lastRefreshedAt: '2026-04-22T08:55:00.000Z',
      signals: [
        { id: 'source', label: 'source', value: 'app-server account' },
        { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
        { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
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
      id: 'TASK-0004',
      title: 'Verify raw state contract',
      description: 'Preserve approval history and provider signals on the raw route.',
      status: 'running',
      priority: 'p1',
      role: 'kernel-proxy',
      createdAt: '2026-04-22T08:30:00.000Z',
      updatedAt: '2026-04-22T08:55:00.000Z',
      assignee: 'operator',
      approvalRequired: true,
      approvalRequestedAt: '2026-04-22T08:31:00.000Z',
      approvedAt: '2026-04-22T08:40:00.000Z',
      approvedBy: 'operator',
      approvalNote: 'Reviewed before execution.',
      approvalEvents: [
        {
          id: 'approval-requested',
          kind: 'requested',
          at: '2026-04-22T08:31:00.000Z',
          note: 'Human review required.',
        },
        {
          id: 'approval-granted',
          kind: 'approved',
          at: '2026-04-22T08:40:00.000Z',
          actor: 'operator',
        },
      ],
    },
  ],
  updatedAt: '2026-04-22T08:55:00.000Z',
});

assert.deepEqual(snapshot, {
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Raw state snapshot smoke test project',
    repos: [
      {
        id: 'main',
        path: '/workspace/threatpedia',
        visibility: 'private',
        role: 'working',
      },
    ],
    roles: [
      {
        id: 'kernel-proxy',
        name: 'Kernel Proxy',
        provider: 'openai',
        defaultModelId: 'codex',
        responsibilities: ['Plan work', 'Review diffs'],
        canWrite: true,
        canReview: true,
        canApprove: true,
      },
    ],
  },
  subscriptions: [
    {
      id: 'openai-codex-chatgpt',
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'provider',
      lastRefreshedAt: '2026-04-22T08:55:00.000Z',
      signals: [
        { id: 'source', label: 'source', value: 'app-server account' },
        { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
        { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
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
      id: 'TASK-0004',
      title: 'Verify raw state contract',
      description: 'Preserve approval history and provider signals on the raw route.',
      status: 'running',
      priority: 'p1',
      role: 'kernel-proxy',
      createdAt: '2026-04-22T08:30:00.000Z',
      updatedAt: '2026-04-22T08:55:00.000Z',
      assignee: 'operator',
      approvalRequired: true,
      approvalRequestedAt: '2026-04-22T08:31:00.000Z',
      approvedAt: '2026-04-22T08:40:00.000Z',
      approvedBy: 'operator',
      approvalNote: 'Reviewed before execution.',
      approvalEvents: [
        {
          id: 'approval-requested',
          kind: 'requested',
          at: '2026-04-22T08:31:00.000Z',
          note: 'Human review required.',
        },
        {
          id: 'approval-granted',
          kind: 'approved',
          at: '2026-04-22T08:40:00.000Z',
          actor: 'operator',
        },
      ],
    },
  ],
  updatedAt: '2026-04-22T08:55:00.000Z',
});

assert.equal('plan' in snapshot, false);
assert.equal('providerSummaries' in snapshot, false);

const mixedSnapshot = buildProjectStateSnapshot({
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Raw state snapshot mixed quota project',
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
      lastRefreshedAt: '2026-04-22T10:05:00.000Z',
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
              resetAt: '2026-04-22T13:57:43.000Z',
            },
            {
              id: '10080m',
              label: 'Weekly window',
              durationMinutes: 10080,
              limit: 100,
              used: 2,
              remaining: 98,
              interpretation: 'percentage_window',
              resetAt: '2026-04-29T08:57:43.000Z',
            },
          ],
        },
        {
          provider: 'openai',
          modelId: 'codex_bengalfox',
          displayName: 'GPT-5.3-Codex-Spark',
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
  tasks: [],
  updatedAt: '2026-04-22T10:05:00.000Z',
});

assert.deepEqual(mixedSnapshot, {
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'Raw state snapshot mixed quota project',
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
      lastRefreshedAt: '2026-04-22T10:05:00.000Z',
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
              resetAt: '2026-04-22T13:57:43.000Z',
            },
            {
              id: '10080m',
              label: 'Weekly window',
              durationMinutes: 10080,
              limit: 100,
              used: 2,
              remaining: 98,
              interpretation: 'percentage_window',
              resetAt: '2026-04-29T08:57:43.000Z',
            },
          ],
        },
        {
          provider: 'openai',
          modelId: 'codex_bengalfox',
          displayName: 'GPT-5.3-Codex-Spark',
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
  tasks: [],
  updatedAt: '2026-04-22T10:05:00.000Z',
});

assert.equal('plan' in mixedSnapshot, false);
assert.equal('providerSummaries' in mixedSnapshot, false);

console.log('State snapshot smoke test passed.');
