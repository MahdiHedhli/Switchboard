import type { SubscriptionAccount, SwitchboardTask } from '@switchboard/core';

const subscriptions: SubscriptionAccount[] = [
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
      },
    ],
  },
  {
    id: 'anthropic-main',
    provider: 'anthropic',
    displayName: 'Claude Code Subscription',
    authMode: 'subscription',
    owner: 'operator',
    quotas: [
      {
        provider: 'anthropic',
        modelId: 'claude-code',
        displayName: 'Claude Code',
        availability: 'unknown',
        authMode: 'subscription',
        usageUnit: 'credits',
        source: 'manual',
        confidence: 'low',
      },
    ],
  },
];

const tasks: SwitchboardTask[] = [
  {
    id: 'TASK-0001',
    title: 'Initialize repository skeleton',
    description: 'Create the root workspace, packages, and docs.',
    status: 'running',
    priority: 'p0',
    role: 'kernel-proxy',
    assignee: 'codex',
    reservations: [
      {
        provider: 'openai',
        modelId: 'codex',
        estimatedCost: 10,
        usageUnit: 'credits',
        reason: 'Scaffold build work',
      },
    ],
  },
  {
    id: 'TASK-0002',
    title: 'Design quota sync strategy',
    description: 'Decide how subscription usage snapshots will be updated.',
    status: 'queued',
    priority: 'p1',
    role: 'planner',
  },
  {
    id: 'TASK-0003',
    title: 'Prepare Threatpedia profile',
    description: 'Map public and private repos into a project pack.',
    status: 'planned',
    priority: 'p1',
    role: 'project-pack',
  },
];

const lanes: Array<SwitchboardTask['status']> = ['queued', 'planned', 'running', 'review', 'blocked', 'completed'];

export function App() {
  return (
    <main className="page">
      <header className="hero">
        <div>
          <h1>Switchboard</h1>
          <p>Local control plane for supervised multi-agent workflows.</p>
        </div>
      </header>

      <section className="panel-grid">
        <section className="panel">
          <h2>Model availability</h2>
          <div className="stack">
            {subscriptions.map((account) => (
              <article className="card" key={account.id}>
                <h3>{account.displayName}</h3>
                <p className="muted">{account.provider} · {account.authMode}</p>
                {account.quotas.map((quota) => (
                  <div className="quota-row" key={`${quota.provider}-${quota.modelId}`}>
                    <span>{quota.displayName}</span>
                    <span>{quota.availability}</span>
                    <span>{quota.remaining ?? 'unknown'} {quota.usageUnit}</span>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Planning notes</h2>
          <ul>
            <li>Quota and credit snapshots should be visible before task assignment.</li>
            <li>Tasks can reserve expected model usage before execution begins.</li>
            <li>Unknown usage states should surface as planning warnings, not silent assumptions.</li>
          </ul>
        </section>
      </section>

      <section className="panel">
        <h2>Switchboard lanes</h2>
        <div className="lanes">
          {lanes.map((lane) => (
            <section className="lane" key={lane}>
              <h3>{lane}</h3>
              <div className="stack">
                {tasks.filter((task) => task.status === lane).map((task) => (
                  <article className="card" key={task.id}>
                    <strong>{task.id}</strong>
                    <h4>{task.title}</h4>
                    <p>{task.description}</p>
                    <p className="muted">role: {task.role}{task.assignee ? ` · assignee: ${task.assignee}` : ''}</p>
                    {task.reservations?.map((reservation, index) => (
                      <div className="reservation" key={index}>
                        reserves {reservation.estimatedCost} {reservation.usageUnit} on {reservation.provider}/{reservation.modelId}
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
