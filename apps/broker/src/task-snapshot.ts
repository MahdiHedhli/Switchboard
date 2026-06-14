import type { SwitchboardTask, TaskSnapshot } from '@switchboard/core';

export function buildTaskSnapshot(
  task: SwitchboardTask,
): TaskSnapshot {
  return {
    task,
  };
}
