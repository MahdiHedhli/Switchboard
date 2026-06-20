/*
 * Task form + draft shapes and their builders. The dashboard holds an editable
 * draft per task (status/assignee/approval) plus the create-task form; these pure
 * builders seed both from broker state without touching React.
 */
import type { SwitchboardTask, TaskPriority, TaskStatus } from '@switchboard/core';

export type CreateTaskFormState = {
  title: string;
  description: string;
  priority: TaskPriority;
  role: string;
  approvalRequired: boolean;
  approvalNote: string;
};

export type TaskDraft = {
  status: TaskStatus;
  assignee: string;
  blockedReason: string;
  approvalRequired: boolean;
  approvedBy: string;
  approvalNote: string;
};

export type TaskDraftMap = Record<string, TaskDraft>;

export function buildTaskDrafts(tasks: SwitchboardTask[]): TaskDraftMap {
  return Object.fromEntries(
    tasks.map((task) => [
      task.id,
      {
        status: task.status,
        assignee: task.assignee ?? '',
        blockedReason: task.blockedReason ?? '',
        approvalRequired: task.approvalRequired ?? false,
        approvedBy: task.approvedBy ?? '',
        approvalNote: task.approvalNote ?? '',
      },
    ]),
  );
}

export function createEmptyTaskForm(role: string): CreateTaskFormState {
  return {
    title: '',
    description: '',
    priority: 'p1',
    role,
    approvalRequired: false,
    approvalNote: '',
  };
}
