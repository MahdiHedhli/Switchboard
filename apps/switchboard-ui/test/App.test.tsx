import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type {
  BrokerHealthSnapshot,
  ProjectAdaptersSnapshot,
  ProjectDashboardSnapshot,
} from '@switchboard/core';
import { App } from '../src/App';

// Representative broker payloads. These mirror the three endpoints `<App/>`
// fetches on mount (`/dashboard`, `/adapters`, `/healthz`) and deliberately
// exercise the model-selection fields surfaced in UI-hardening item 1:
// selection warnings, a reservation `source`, a task `taskClass` + `modelPin`,
// and the read-only catalog (active + placeholder rows).
const dashboard: ProjectDashboardSnapshot = {
  profile: {
    id: 'threatpedia',
    name: 'Threatpedia',
    description: 'UI smoke test project',
    repos: [],
    roles: [
      {
        id: 'kernel-proxy',
        name: 'Kernel Proxy',
        provider: 'openai',
        defaultModelId: 'codex',
        responsibilities: ['routing'],
        canWrite: true,
        canReview: false,
        canApprove: false,
      },
    ],
  },
  subscriptions: [
    {
      id: 'openai-codex',
      provider: 'openai',
      displayName: 'Codex Supervisor (Pro)',
      authMode: 'subscription',
      owner: 'operator',
      syncMethod: 'provider',
      signals: [{ id: 'source', label: 'source', value: 'app-server account' }],
      quotas: [
        {
          provider: 'openai',
          modelId: 'codex',
          displayName: 'Codex',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'credits',
          source: 'cli',
          confidence: 'medium',
          interpretation: 'informational',
          remaining: 100,
        },
      ],
    },
  ],
  tasks: [
    {
      id: 'TASK-ROUTED',
      title: 'Route attribution write-up',
      description: 'Heavy task routed by the selector',
      status: 'planned',
      priority: 'p1',
      role: 'kernel-proxy',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      taskClass: 'attribution',
      modelPin: { provider: 'anthropic', modelId: 'claude-opus' },
      reservations: [
        {
          provider: 'anthropic',
          modelId: 'claude-opus',
          estimatedCost: 12,
          usageUnit: 'credits',
          reason: 'selector pick',
          source: 'selector',
        },
      ],
    },
  ],
  updatedAt: '2026-06-01T00:00:00.000Z',
  plan: {
    runnable: [],
    blocked: [],
    warnings: [
      { code: 'approval_pending', message: 'Task TASK-ROUTED is awaiting operator approval.' },
    ],
  },
  providerSummaries: [],
  selectionWarnings: [
    {
      code: 'selection_unresolved',
      taskId: 'TASK-UNRESOLVED',
      message: 'No active model clears the required tier.',
      taskClass: 'attribution',
    },
    {
      code: 'selection_placeholder_skipped',
      taskId: 'TASK-PLACEHOLDER',
      message: 'A placeholder row would have matched this class.',
      taskClass: 'drafting',
      excluded: [{ provider: 'google', modelId: 'gemini-pro' }],
    },
  ],
  catalog: {
    active: [
      {
        provider: 'anthropic',
        modelId: 'claude-opus',
        displayName: 'Claude Opus',
        tier: 'heavy',
        authMode: 'subscription',
        pricing: { authMode: 'subscription', drawsFromQuota: true },
        status: 'active',
      },
    ],
    placeholders: [{ provider: 'google', modelId: 'gemini-pro' }],
  },
};

const adapters: ProjectAdaptersSnapshot = {
  adapters: [
    {
      provider: 'openai',
      kind: 'snapshot',
      description: 'Codex app-server snapshot',
      source: 'cli',
      status: 'ready',
      configured: true,
      secure: true,
    },
  ],
};

const health: BrokerHealthSnapshot = {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: true,
  operatorTokenRequired: true,
  protocol: 'http',
  tlsEnabled: false,
  auth: {
    localOnly: true,
    remoteExposureAllowed: false,
    operatorTokenConfigured: true,
    operatorTokenSource: 'env',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: 'x-switchboard-operator-token',
    scopes: {
      taskCreate: { requirement: 'operator_token', detail: 'requires operator token' },
      taskUpdate: { requirement: 'operator_token', detail: 'requires operator token' },
      subscriptionRefresh: { requirement: 'operator_token', detail: 'requires operator token' },
      subscriptionReplace: { requirement: 'disabled', detail: 'manual replace disabled' },
    },
  },
};

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

function mockBrokerFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/dashboard')) return jsonResponse(dashboard);
      if (url.includes('/adapters')) return jsonResponse(adapters);
      if (url.includes('/healthz')) return jsonResponse(health);
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
}

describe('<App/> dashboard smoke', () => {
  beforeEach(() => {
    mockBrokerFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the core control-plane sections from a broker snapshot', async () => {
    render(<App />);

    // Anchor on broker-backed content so we assert after the async load settles
    // (static headings render before fetch resolves and would race the data).
    expect(await screen.findByText('Codex Supervisor (Pro)')).toBeTruthy();

    for (const heading of [
      'Operator session',
      'Quota refresh',
      'Task intake',
      'Model availability',
      'Planning notes',
      'Model selection',
      'Switchboard lanes',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }

    // Broker-backed content rendered without error.
    expect(screen.getByText('Route attribution write-up')).toBeTruthy();
    expect(screen.queryByText(/Broker load error/)).toBeNull();
  });

  it('surfaces the model-selection fields from UI-hardening item 1', async () => {
    render(<App />);

    // Selection warnings (both codes) render.
    expect(await screen.findByText('Unresolved selection')).toBeTruthy();
    expect(screen.getByText('Placeholder skipped')).toBeTruthy();

    // A task's taskClass + modelPin render in its lane card.
    expect(screen.getByText('task class: attribution')).toBeTruthy();
    expect(screen.getByText('model pin: anthropic/claude-opus')).toBeTruthy();

    // A reservation's source (selector / pin / explicit) renders.
    expect(screen.getByText('source: selector')).toBeTruthy();

    // The read-only catalog panel renders active + placeholder rows.
    expect(screen.getByRole('heading', { name: 'Model catalog' })).toBeTruthy();
    expect(screen.getByText('tier: heavy')).toBeTruthy();
    expect(screen.getByText('placeholder')).toBeTruthy();
  });
});
