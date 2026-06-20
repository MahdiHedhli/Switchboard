/* "Switchboard lanes": the kanban-style board grouping tasks by status, each
 * rendered as an editable TaskCard. */
import type { SwitchboardTask } from '@switchboard/core';
import { lanes } from '../lib/constants';
import type { TaskDraft, TaskDraftMap } from '../lib/tasks';
import { TaskCard } from './TaskCard';

type SwitchboardLanesProps = {
  tasks: SwitchboardTask[];
  taskDrafts: TaskDraftMap;
  isLoading: boolean;
  savingTaskId: string | null;
  canUpdateTasks: boolean;
  onUpdateTaskDraft: (taskId: string, patch: Partial<TaskDraft>) => void;
  onSaveTask: (task: SwitchboardTask) => void;
};

export function SwitchboardLanes({
  tasks,
  taskDrafts,
  isLoading,
  savingTaskId,
  canUpdateTasks,
  onUpdateTaskDraft,
  onSaveTask,
}: SwitchboardLanesProps) {
  return (
    <section className="panel">
      <h2>Switchboard lanes</h2>
      <div className="lanes">
        {lanes.map((lane) => {
          const laneTasks = tasks.filter((task) => task.status === lane);

          return (
            <section className="lane" key={lane}>
              <h3>{lane}</h3>
              <div className="stack">
                {!isLoading && laneTasks.length === 0 ? <p className="muted">No tasks in this lane.</p> : null}
                {laneTasks.map((task) => {
                  const draft = taskDrafts[task.id] ?? {
                    status: task.status,
                    assignee: task.assignee ?? '',
                    blockedReason: task.blockedReason ?? '',
                    approvalRequired: task.approvalRequired ?? false,
                    approvedBy: task.approvedBy ?? '',
                    approvalNote: task.approvalNote ?? '',
                  };

                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      draft={draft}
                      savingTaskId={savingTaskId}
                      canUpdateTasks={canUpdateTasks}
                      onUpdateTaskDraft={onUpdateTaskDraft}
                      onSaveTask={onSaveTask}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
