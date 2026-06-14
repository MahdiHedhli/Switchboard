import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { buildTaskSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const snapshot = buildTaskSnapshot({
  id: 'TASK-0004',
  title: 'Verify task snapshot contract',
  description: 'Keep the task detail route distinct from dashboard and state payloads.',
  status: 'blocked',
  priority: 'p1',
  role: 'kernel-proxy',
  createdAt: '2026-04-22T09:05:00.000Z',
  updatedAt: '2026-04-22T09:12:00.000Z',
  assignee: 'operator',
  blockedReason: 'Waiting for reviewed quota input.',
  approvalRequired: true,
  approvalRequestedAt: '2026-04-22T09:06:00.000Z',
  approvalNote: 'Operator sign-off is required.',
  approvalEvents: [
    {
      id: 'approval-requested',
      kind: 'requested',
      at: '2026-04-22T09:06:00.000Z',
      note: 'Human review required.',
    },
  ],
});

assert.deepEqual(snapshot, {
  task: {
    id: 'TASK-0004',
    title: 'Verify task snapshot contract',
    description: 'Keep the task detail route distinct from dashboard and state payloads.',
    status: 'blocked',
    priority: 'p1',
    role: 'kernel-proxy',
    createdAt: '2026-04-22T09:05:00.000Z',
    updatedAt: '2026-04-22T09:12:00.000Z',
    assignee: 'operator',
    blockedReason: 'Waiting for reviewed quota input.',
    approvalRequired: true,
    approvalRequestedAt: '2026-04-22T09:06:00.000Z',
    approvalNote: 'Operator sign-off is required.',
    approvalEvents: [
      {
        id: 'approval-requested',
        kind: 'requested',
        at: '2026-04-22T09:06:00.000Z',
        note: 'Human review required.',
      },
    ],
  },
});

assert.equal('profile' in snapshot, false);
assert.equal('subscriptions' in snapshot, false);
assert.equal('tasks' in snapshot, false);
assert.equal('plan' in snapshot, false);
assert.equal('providerSummaries' in snapshot, false);

console.log('Task snapshot smoke test passed.');
