/* A single task card within a lane: metadata (class/pin/approval), approval
 * history, reservations, and the inline editor (status/assignee/approval/blocked
 * reason) with a token-gated save. */
import type { SwitchboardTask, TaskStatus } from '@switchboard/core';
import { taskStatuses } from '../lib/constants';
import { formatApprovalEvent, formatTaskApproval, formatTimestamp } from '../lib/format';
import type { TaskDraft } from '../lib/tasks';

type TaskCardProps = {
  task: SwitchboardTask;
  draft: TaskDraft;
  savingTaskId: string | null;
  canUpdateTasks: boolean;
  onUpdateTaskDraft: (taskId: string, patch: Partial<TaskDraft>) => void;
  onSaveTask: (task: SwitchboardTask) => void;
};

export function TaskCard({
  task,
  draft,
  savingTaskId,
  canUpdateTasks,
  onUpdateTaskDraft,
  onSaveTask,
}: TaskCardProps) {
  return (
    <article className="card" key={task.id}>
      <strong>{task.id}</strong>
      <h4>{task.title}</h4>
      <p>{task.description}</p>
      <div className="task-meta">
        <span>priority: {task.priority} · role: {task.role}</span>
        {task.taskClass ? <span>task class: {task.taskClass}</span> : null}
        {task.modelPin ? (
          <span>model pin: {task.modelPin.provider}/{task.modelPin.modelId}</span>
        ) : null}
        <span>created: {formatTimestamp(task.createdAt)}</span>
        <span>updated: {formatTimestamp(task.updatedAt)}</span>
        {task.assignee ? <span>current assignee: {task.assignee}</span> : null}
        {task.blockedReason ? <span>blocked reason: {task.blockedReason}</span> : null}
        {formatTaskApproval(task) ? <span>{formatTaskApproval(task)}</span> : null}
        {task.approvalNote ? <span>approval note: {task.approvalNote}</span> : null}
      </div>
      {task.approvalEvents?.length ? (
        <div className="approval-history">
          <strong>Approval history</strong>
          <div className="approval-history-list">
            {[...task.approvalEvents].reverse().map((event) => (
              <div className="approval-history-item" key={event.id}>
                <span>{formatApprovalEvent(event)}</span>
                {event.note ? <span className="muted">note: {event.note}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {task.reservations?.map((reservation, index) => (
        <div className="reservation" key={index}>
          <span>reserves {reservation.estimatedCost} {reservation.usageUnit}</span>
          <span>{reservation.provider}/{reservation.modelId}</span>
          {reservation.source ? <span>source: {reservation.source}</span> : null}
        </div>
      ))}
      <div className="card-actions">
        <div className="field-grid">
          <label className="field">
            <span>Status</span>
            <select
              className="input"
              value={draft.status}
              onChange={(event) => onUpdateTaskDraft(task.id, {
                status: event.target.value as TaskStatus,
              })}
            >
              {taskStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Assignee</span>
            <input
              className="input"
              value={draft.assignee}
              onChange={(event) => onUpdateTaskDraft(task.id, {
                assignee: event.target.value,
              })}
              placeholder="Leave blank to clear"
            />
          </label>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={draft.approvalRequired}
            onChange={(event) => onUpdateTaskDraft(task.id, {
              approvalRequired: event.target.checked,
              approvedBy: event.target.checked ? draft.approvedBy : '',
              approvalNote: event.target.checked ? draft.approvalNote : '',
            })}
          />
          <span>Requires operator approval before execution</span>
        </label>
        {draft.approvalRequired ? (
          <div className="field-grid">
            <label className="field">
              <span>Approved by</span>
              <input
                className="input"
                value={draft.approvedBy}
                onChange={(event) => onUpdateTaskDraft(task.id, {
                  approvedBy: event.target.value,
                })}
                placeholder="Leave blank to keep approval pending"
              />
            </label>
            <label className="field">
              <span>Approval note</span>
              <textarea
                className="input textarea"
                value={draft.approvalNote}
                onChange={(event) => onUpdateTaskDraft(task.id, {
                  approvalNote: event.target.value,
                })}
                placeholder="Why does this task require approval?"
              />
            </label>
          </div>
        ) : null}
        {draft.status === 'blocked' ? (
          <label className="field">
            <span>Blocked reason</span>
            <textarea
              className="input textarea"
              value={draft.blockedReason}
              onChange={(event) => onUpdateTaskDraft(task.id, {
                blockedReason: event.target.value,
              })}
              placeholder="Explain why the task is blocked"
            />
          </label>
        ) : null}
        <div className="button-row">
          <button
            className="button secondary-button"
            disabled={savingTaskId === task.id || !canUpdateTasks}
            type="button"
            onClick={() => onSaveTask(task)}
          >
            {savingTaskId === task.id ? 'Saving…' : 'Save task changes'}
          </button>
        </div>
      </div>
    </article>
  );
}
