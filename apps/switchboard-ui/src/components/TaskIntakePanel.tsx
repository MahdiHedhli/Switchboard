/* "Task intake" panel: the create-task form (title/description/priority/role and
 * optional operator-approval gate). */
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { ProjectDashboardSnapshot, TaskPriority } from '@switchboard/core';
import { taskPriorities } from '../lib/constants';
import type { CreateTaskFormState } from '../lib/tasks';

type TaskIntakePanelProps = {
  createTaskForm: CreateTaskFormState;
  setCreateTaskForm: Dispatch<SetStateAction<CreateTaskFormState>>;
  roleOptions: ProjectDashboardSnapshot['profile']['roles'];
  isCreatingTask: boolean;
  isLoading: boolean;
  canCreateTasks: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function TaskIntakePanel({
  createTaskForm,
  setCreateTaskForm,
  roleOptions,
  isCreatingTask,
  isLoading,
  canCreateTasks,
  onSubmit,
}: TaskIntakePanelProps) {
  return (
    <section className="panel">
      <h2>Task intake</h2>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>Title</span>
          <input
            className="input"
            name="title"
            value={createTaskForm.title}
            onChange={(event) => setCreateTaskForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Add the next production task"
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            className="input textarea"
            name="description"
            value={createTaskForm.description}
            onChange={(event) => setCreateTaskForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="What should the operator or agent actually do?"
          />
        </label>
        <div className="field-grid">
          <label className="field">
            <span>Priority</span>
            <select
              className="input"
              value={createTaskForm.priority}
              onChange={(event) => setCreateTaskForm((current) => ({
                ...current,
                priority: event.target.value as TaskPriority,
              }))}
            >
              {taskPriorities.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Role</span>
            <select
              className="input"
              value={createTaskForm.role}
              onChange={(event) => setCreateTaskForm((current) => ({
                ...current,
                role: event.target.value,
              }))}
            >
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={createTaskForm.approvalRequired}
            onChange={(event) => setCreateTaskForm((current) => ({
              ...current,
              approvalRequired: event.target.checked,
              approvalNote: event.target.checked ? current.approvalNote : '',
            }))}
          />
          <span>Requires operator approval before execution</span>
        </label>
        {createTaskForm.approvalRequired ? (
          <label className="field">
            <span>Approval note</span>
            <textarea
              className="input textarea"
              name="approvalNote"
              value={createTaskForm.approvalNote}
              onChange={(event) => setCreateTaskForm((current) => ({
                ...current,
                approvalNote: event.target.value,
              }))}
              placeholder="What should the operator confirm before this task can run?"
            />
          </label>
        ) : null}
        <div className="button-row">
          <button
            className="button"
            disabled={isCreatingTask || isLoading || !canCreateTasks}
            type="submit"
          >
            {isCreatingTask ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </form>
    </section>
  );
}
