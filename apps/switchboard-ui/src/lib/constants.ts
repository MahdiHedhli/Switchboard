/*
 * Static dashboard configuration: the project under control, the lane order, the
 * task enums offered in the UI, the auth-scope row labels, and the planning-note
 * copy. Kept declarative and side-effect-free so panels can import them directly.
 */
import type { BrokerAuthSummary, TaskPriority, TaskStatus } from '@switchboard/core';

export const projectId = 'threatpedia';

export const lanes: TaskStatus[] = ['queued', 'planned', 'running', 'review', 'blocked', 'completed'];

export const taskPriorities: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];

export const taskStatuses: TaskStatus[] = ['queued', 'planned', 'running', 'review', 'blocked', 'completed', 'failed'];

export const authScopeLabels: Array<{
  key: keyof BrokerAuthSummary['scopes'];
  label: string;
}> = [
  { key: 'taskCreate', label: 'Task creation' },
  { key: 'taskUpdate', label: 'Task updates' },
  { key: 'subscriptionRefresh', label: 'Quota refresh' },
  { key: 'subscriptionReplace', label: 'Direct subscription replace' },
];

export const planningNotes = [
  'Quota and credit snapshots should be visible before task assignment.',
  'Tasks can reserve expected model usage before execution begins.',
  'Approval-required tasks should be held before execution, not silently advanced.',
  'Unknown usage states should surface as planning warnings, not silent assumptions.',
];
