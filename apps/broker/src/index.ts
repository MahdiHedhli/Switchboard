import type { PlannerContext } from '@switchboard/core';
import { planTasks } from './planner';

const demoContext: PlannerContext = {
  project: {
    id: 'demo',
    name: 'Switchboard Demo',
    description: 'Bootstrap planner context',
    repos: [],
    roles: [],
  },
  subscriptions: [
    {
      id: 'openai-main',
      provider: 'openai',
      displayName: 'OpenAI Subscription',
      authMode: 'subscription',
      owner: 'operator',
      quotas: [
        {
          provider: 'openai',
          modelId: 'codex',
          displayName: 'Codex',
          availability: 'available',
          authMode: 'subscription',
          usageUnit: 'credits',
          source: 'manual',
          confidence: 'low',
          remaining: 100,
          notes: 'Replace with provider-backed or CLI-backed sync later.',
        },
      ],
    },
  ],
  tasks: [
    {
      id: 'TASK-0001',
      title: 'Bootstrap Switchboard',
      description: 'Create initial repo scaffold and Codex handoff docs.',
      status: 'planned',
      priority: 'p0',
      role: 'kernel-proxy',
      reservations: [
        {
          provider: 'openai',
          modelId: 'codex',
          estimatedCost: 10,
          usageUnit: 'credits',
          reason: 'Initial repository setup work',
        },
      ],
    },
  ],
};

const result = planTasks(demoContext);
console.log(JSON.stringify(result, null, 2));
