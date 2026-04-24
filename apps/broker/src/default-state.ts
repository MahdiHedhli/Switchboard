import type { ProjectProfile, ProjectStateSnapshot, ProviderId, SubscriptionAccount, SwitchboardTask } from '@switchboard/core';

function titleCase(input: string): string {
  return input
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function providerDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI Subscription';
    case 'anthropic':
      return 'Claude Code Subscription';
    case 'google':
      return 'Gemini Subscription';
    default:
      return `${titleCase(provider)} Subscription`;
  }
}

function seedSubscriptions(profile: ProjectProfile): SubscriptionAccount[] {
  const providers = new Map<ProviderId, string>();

  for (const role of profile.roles) {
    if (!providers.has(role.provider)) {
      providers.set(role.provider, role.defaultModelId);
    }
  }

  if (providers.size === 0) {
    providers.set('openai', 'codex');
  }

  return [...providers.entries()].map(([provider, modelId], index) => ({
    id: `${provider}-main`,
    provider,
    displayName: providerDisplayName(provider),
    authMode: 'subscription',
    owner: 'operator',
    syncMethod: 'seed',
    lastRefreshedAt: new Date().toISOString(),
    quotas: [
      {
        provider,
        modelId,
        displayName: titleCase(modelId),
        availability: index === 0 ? 'available' : 'unknown',
        authMode: 'subscription',
        usageUnit: 'credits',
        source: 'manual',
        confidence: 'low',
        remaining: index === 0 ? 100 : undefined,
        notes: index === 0 ? 'Seeded operator snapshot until provider-backed sync is implemented.' : undefined,
      },
    ],
  }));
}

function seedTasks(profile: ProjectProfile): SwitchboardTask[] {
  const primaryRole = profile.roles[0]?.id ?? 'operator';
  const secondaryRole = profile.roles[1]?.id ?? primaryRole;
  const tertiaryRole = profile.roles[2]?.id ?? secondaryRole;
  const now = new Date().toISOString();

  return [
    {
      id: 'TASK-0001',
      title: 'Stand up broker control surface',
      description: 'Replace scaffold-only planning with a local broker API and durable state.',
      status: 'running',
      priority: 'p0',
      role: primaryRole,
      createdAt: now,
      updatedAt: now,
      assignee: 'codex',
      reservations: [
        {
          provider: profile.roles[0]?.provider ?? 'openai',
          modelId: profile.roles[0]?.defaultModelId ?? 'codex',
          estimatedCost: 10,
          usageUnit: 'credits',
          reason: 'Initial broker and persistence implementation',
        },
      ],
    },
    {
      id: 'TASK-0002',
      title: 'Validate repo boundaries and operator policy',
      description: `Confirm ${profile.name} repos, role assignments, and publish-versus-working boundaries before adapter work.`,
      status: 'planned',
      priority: 'p1',
      role: secondaryRole,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'TASK-0003',
      title: 'Define quota sync and adapter rollout',
      description: 'Choose how subscription-backed provider state will be refreshed without persisting raw secrets.',
      status: 'queued',
      priority: 'p1',
      role: tertiaryRole,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createSeedState(profile: ProjectProfile): ProjectStateSnapshot {
  return {
    profile,
    subscriptions: seedSubscriptions(profile),
    tasks: seedTasks(profile),
    updatedAt: new Date().toISOString(),
  };
}
