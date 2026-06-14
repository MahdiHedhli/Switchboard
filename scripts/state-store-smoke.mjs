import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { loadProjectProfile } = await import(path.join(repoRoot, 'apps/broker/dist/profile-loader.js'));
const {
  FileStateStore,
  TaskConflictError,
  TaskNotFoundError,
} = await import(path.join(repoRoot, 'apps/broker/dist/state-store.js'));

const profile = await loadProjectProfile(path.join(repoRoot, 'profiles'), 'threatpedia');
assert.notEqual(profile, null);

const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-state-store-smoke-'));
const stateDir = path.join(tempRoot, 'state');

try {
  const store = new FileStateStore(stateDir);
  const seeded = await store.load(profile);

  assert.equal(seeded.profile.id, 'threatpedia');
  assert.equal(seeded.tasks.length, 3);
  assert.equal(seeded.subscriptions.length, 3);

  const stateDirStat = await stat(stateDir);
  assert.equal(stateDirStat.mode & 0o777, 0o700);

  const stateFile = path.join(stateDir, 'threatpedia.json');
  const stateFileStat = await stat(stateFile);
  assert.equal(stateFileStat.mode & 0o777, 0o600);

  const created = await store.createTask(profile, {
    title: 'Smoke task',
    description: 'Verify direct state-store persistence without a broker listener.',
    priority: 'p1',
    role: 'kernel-proxy',
    approvalRequired: true,
    approvalNote: 'Human review is required before execution.',
  });
  const smokeTask = created.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(smokeTask, undefined);
  assert.equal(smokeTask.status, 'queued');
  assert.equal(smokeTask.approvalRequired, true);
  assert.equal(smokeTask.approvalNote, 'Human review is required before execution.');
  assert.notEqual(smokeTask.approvalRequestedAt, undefined);
  assert.deepEqual(smokeTask.approvalEvents?.map((event) => event.kind), ['requested']);

  await assert.rejects(
    store.getTask(profile, 'TASK-9999'),
    (error) => error instanceof TaskNotFoundError,
  );

  await assert.rejects(
    store.updateTask(profile, 'TASK-0004', { status: 'blocked' }),
    (error) => error instanceof TaskConflictError && error.message.includes('needs a blockedReason'),
  );

  await assert.rejects(
    store.updateTask(profile, 'TASK-0004', { status: 'running' }),
    (error) => error instanceof TaskConflictError && error.message.includes('needs operator approval'),
  );

  const blocked = await store.updateTask(profile, 'TASK-0004', {
    status: 'blocked',
    blockedReason: 'Waiting for reviewed quota input.',
    assignee: 'operator',
  });
  const blockedTask = blocked.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(blockedTask, undefined);
  assert.equal(blockedTask.status, 'blocked');
  assert.equal(blockedTask.blockedReason, 'Waiting for reviewed quota input.');
  assert.equal(blockedTask.assignee, 'operator');

  await assert.rejects(
    store.updateTask(profile, 'TASK-0004', { status: 'completed' }),
    (error) => error instanceof TaskConflictError && error.message.includes('cannot move from blocked to completed'),
  );

  const reopened = await store.updateTask(profile, 'TASK-0004', { status: 'planned' });
  const reopenedTask = reopened.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(reopenedTask, undefined);
  assert.equal(reopenedTask.status, 'planned');
  assert.equal(reopenedTask.blockedReason, undefined);
  assert.equal(reopenedTask.approvalRequired, true);
  assert.equal(reopenedTask.approvedAt, undefined);
  assert.equal(reopenedTask.approvalRequestedAt, smokeTask.approvalRequestedAt);
  assert.deepEqual(reopenedTask.approvalEvents?.map((event) => event.kind), ['requested']);

  const approved = await store.updateTask(profile, 'TASK-0004', {
    approvedBy: 'operator',
  });
  const approvedTask = approved.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(approvedTask, undefined);
  assert.equal(approvedTask.approvedBy, 'operator');
  assert.notEqual(approvedTask.approvedAt, undefined);
  assert.deepEqual(approvedTask.approvalEvents?.map((event) => event.kind), ['requested', 'approved']);

  const resetApproval = await store.updateTask(profile, 'TASK-0004', {
    approvedBy: null,
  });
  const resetApprovalTask = resetApproval.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(resetApprovalTask, undefined);
  assert.equal(resetApprovalTask.approvedBy, undefined);
  assert.equal(resetApprovalTask.approvedAt, undefined);
  assert.notEqual(resetApprovalTask.approvalRequestedAt, undefined);
  assert.deepEqual(resetApprovalTask.approvalEvents?.map((event) => event.kind), ['requested', 'approved', 'reset']);

  const reapproved = await store.updateTask(profile, 'TASK-0004', {
    approvedBy: 'operator',
  });
  const reapprovedTask = reapproved.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(reapprovedTask, undefined);
  assert.equal(reapprovedTask.approvedBy, 'operator');
  assert.notEqual(reapprovedTask.approvedAt, undefined);
  assert.deepEqual(reapprovedTask.approvalEvents?.map((event) => event.kind), ['requested', 'approved', 'reset', 'approved']);

  const running = await store.updateTask(profile, 'TASK-0004', { status: 'running' });
  const runningTask = running.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(runningTask, undefined);
  assert.equal(runningTask.status, 'running');
  assert.equal(runningTask.approvedBy, 'operator');
  assert.deepEqual(runningTask.approvalEvents?.map((event) => event.kind), ['requested', 'approved', 'reset', 'approved']);

  const providerRefresh = await store.replaceSubscriptionsForProviders(
    profile,
    ['openai'],
    [
      {
        id: 'openai-codex-chatgpt',
        provider: 'openai',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        syncMethod: 'provider',
        lastRefreshedAt: '2026-04-21T22:00:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: 'app-server account' },
          { id: 'plan', label: 'plan', value: 'Pro' },
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
            limit: 100,
            used: 9,
            remaining: 91,
            interpretation: 'percentage_window',
            resetAt: '2026-04-21T23:37:43.000Z',
            windows: [
              {
                id: '300m',
                label: '5-hour window',
                durationMinutes: 300,
                limit: 100,
                used: 9,
                remaining: 91,
                interpretation: 'percentage_window',
                resetAt: '2026-04-21T23:37:43.000Z',
              },
              {
                id: '10080m',
                label: 'Weekly window',
                durationMinutes: 10080,
                limit: 100,
                used: 2,
                remaining: 98,
                interpretation: 'percentage_window',
                resetAt: '2026-04-28T18:37:43.000Z',
              },
            ],
          },
        ],
      },
    ],
  );

  assert.deepEqual(
    providerRefresh.subscriptions.map((account) => account.provider),
    ['anthropic', 'google', 'openai'],
  );
  const refreshedOpenAI = providerRefresh.subscriptions.find((account) => account.provider === 'openai');
  assert.equal(refreshedOpenAI?.id, 'openai-codex-chatgpt');
  assert.equal(refreshedOpenAI?.syncMethod, 'provider');
  assert.deepEqual(refreshedOpenAI?.signals, [
    { id: 'source', label: 'source', value: 'app-server account' },
    { id: 'plan', label: 'plan', value: 'Pro' },
  ]);

  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  const persistedTask = persisted.tasks.find((task) => task.id === 'TASK-0004');
  assert.notEqual(persistedTask, undefined);
  assert.equal(persistedTask.status, 'running');
  assert.equal(persistedTask.blockedReason, undefined);
  assert.equal(persistedTask.approvedBy, 'operator');
  assert.deepEqual(persistedTask.approvalEvents.map((event) => event.kind), ['requested', 'approved', 'reset', 'approved']);
  const persistedOpenAI = persisted.subscriptions.find((account) => account.provider === 'openai');
  assert.equal(persistedOpenAI.id, 'openai-codex-chatgpt');
  assert.equal(persistedOpenAI.syncMethod, 'provider');
  assert.deepEqual(persistedOpenAI.quotas[0].windows, [
    {
      id: '300m',
      label: '5-hour window',
      durationMinutes: 300,
      limit: 100,
      used: 9,
      remaining: 91,
      interpretation: 'percentage_window',
      resetAt: '2026-04-21T23:37:43.000Z',
    },
    {
      id: '10080m',
      label: 'Weekly window',
      durationMinutes: 10080,
      limit: 100,
      used: 2,
      remaining: 98,
      interpretation: 'percentage_window',
      resetAt: '2026-04-28T18:37:43.000Z',
    },
  ]);

  await writeFile(
    stateFile,
    `${JSON.stringify({
      updatedAt: 42,
      subscriptions: [],
      tasks: [],
    }, null, 2)}\n`,
    { mode: 0o600 },
  );

  await assert.rejects(
    store.load(profile),
    (error) => {
      assert(error instanceof Error);
      assert.match(error.message, /state snapshot threatpedia\.updatedAt must be a string\./);
      assert.equal(error.message.includes(stateFile), false);
      assert.equal(error.message.includes(tempRoot), false);
      assert.equal(error.message.includes('/Users/'), false);
      return true;
    },
  );

  console.log('State store smoke test passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
