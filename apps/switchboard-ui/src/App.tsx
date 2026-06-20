import { startTransition, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  formatProviderRefreshSummaryMessage,
  isProviderSyncSummaryAdvisory,
  resolveBrokerProtocol,
  resolveBrokerTlsEnabled,
} from '@switchboard/core';
import type {
  BrokerAuthSummary,
  BrokerHealthSnapshot,
  ProjectDashboardSnapshot,
  ProjectRefreshSnapshot,
  SwitchboardTask,
} from '@switchboard/core';
import { projectId } from './lib/constants';
import { buildMutationHeaders, parseBrokerResponse } from './lib/broker-client';
import { canUseScope, formatTimestamp } from './lib/format';
import type { AdapterStatus, AdapterStatusResponse } from './lib/format';
import {
  buildOperatorTokenState,
  readStoredOperatorToken,
} from './lib/operator-token';
import type { StoredOperatorTokenState } from './lib/operator-token';
import {
  buildTaskDrafts,
  createEmptyTaskForm,
} from './lib/tasks';
import type { CreateTaskFormState, TaskDraft, TaskDraftMap } from './lib/tasks';
import { ModelAvailabilityPanel } from './components/ModelAvailabilityPanel';
import { ModelSelectionPanel } from './components/ModelSelectionPanel';
import { OperatorSessionPanel } from './components/OperatorSessionPanel';
import { PlanningNotesPanel } from './components/PlanningNotesPanel';
import { QuotaRefreshPanel } from './components/QuotaRefreshPanel';
import { SwitchboardLanes } from './components/SwitchboardLanes';
import { TaskIntakePanel } from './components/TaskIntakePanel';

export function App() {
  const [dashboard, setDashboard] = useState<ProjectDashboardSnapshot | null>(null);
  const [adapterStatuses, setAdapterStatuses] = useState<AdapterStatus[]>([]);
  const [authSummary, setAuthSummary] = useState<BrokerAuthSummary | null>(null);
  const [operatorTokenRequired, setOperatorTokenRequired] = useState(false);
  const [brokerProtocol, setBrokerProtocol] = useState<BrokerHealthSnapshot['protocol']>('http');
  const [brokerTlsEnabled, setBrokerTlsEnabled] = useState(false);
  const [storedOperatorToken, setStoredOperatorToken] = useState<StoredOperatorTokenState>(() => readStoredOperatorToken());
  const [taskDrafts, setTaskDrafts] = useState<TaskDraftMap>({});
  const [createTaskForm, setCreateTaskForm] = useState<CreateTaskFormState>(createEmptyTaskForm('kernel-proxy'));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshMessageAdvisory, setRefreshMessageAdvisory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadControlPlane(): Promise<void> {
      try {
        setIsLoading(true);
        setLoadError(null);

        const [dashboardResponse, adaptersResponse, healthResponse] = await Promise.all([
          fetch(`/api/v1/projects/${projectId}/dashboard`, { signal: controller.signal }),
          fetch(`/api/v1/projects/${projectId}/adapters`, { signal: controller.signal }),
          fetch('/api/healthz', { signal: controller.signal }),
        ]);

        const [nextDashboard, nextAdapters, nextHealth] = await Promise.all([
          parseBrokerResponse<ProjectDashboardSnapshot>(dashboardResponse),
          parseBrokerResponse<AdapterStatusResponse>(adaptersResponse),
          parseBrokerResponse<BrokerHealthSnapshot>(healthResponse),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const nextBrokerProtocol = resolveBrokerProtocol(nextHealth);
        const nextBrokerTlsEnabled = resolveBrokerTlsEnabled(nextHealth);

        startTransition(() => {
          setDashboard(nextDashboard);
          setAdapterStatuses(nextAdapters.adapters);
          setAuthSummary(nextHealth.auth);
          setOperatorTokenRequired(nextHealth.operatorTokenRequired);
          setBrokerProtocol(nextBrokerProtocol);
          setBrokerTlsEnabled(nextBrokerTlsEnabled);
          setTaskDrafts(buildTaskDrafts(nextDashboard.tasks));
          setCreateTaskForm((current) => {
            const nextRole = current.role && nextDashboard.profile.roles.some((role) => role.id === current.role)
              ? current.role
              : (nextDashboard.profile.roles[0]?.id ?? 'kernel-proxy');

            return {
              ...current,
              role: nextRole,
            };
          });
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Unknown broker error.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadControlPlane();
    return () => controller.abort();
  }, []);

  const subscriptions = dashboard?.subscriptions ?? [];
  const tasks = dashboard?.tasks ?? [];
  const warnings = dashboard?.plan.warnings ?? [];
  const selectionWarnings = dashboard?.selectionWarnings ?? [];
  const modelCatalog = dashboard?.catalog ?? { active: [], placeholders: [] };
  const providerSummaries = dashboard?.providerSummaries ?? [];
  const operatorToken = storedOperatorToken.value;
  const operatorTokenExpiresAt = storedOperatorToken.expiresAt;
  const operatorTokenRemembered = storedOperatorToken.remembered;
  const roleOptions = dashboard?.profile.roles ?? [];
  const taskCreateScope = authSummary?.scopes.taskCreate;
  const taskUpdateScope = authSummary?.scopes.taskUpdate;
  const subscriptionRefreshScope = authSummary?.scopes.subscriptionRefresh;
  const canCreateTasks = canUseScope(taskCreateScope, operatorToken);
  const canUpdateTasks = canUseScope(taskUpdateScope, operatorToken);
  const canRefreshSubscriptions = canUseScope(subscriptionRefreshScope, operatorToken);
  const brokerTransportLabel = resolveBrokerProtocol({
    protocol: brokerProtocol,
    tlsEnabled: brokerTlsEnabled,
  }).toUpperCase();

  function applyDashboard(nextDashboard: ProjectDashboardSnapshot): void {
    startTransition(() => {
      setDashboard(nextDashboard);
      setTaskDrafts(buildTaskDrafts(nextDashboard.tasks));
      setCreateTaskForm((current) => {
        const nextRole = current.role && nextDashboard.profile.roles.some((role) => role.id === current.role)
          ? current.role
          : (nextDashboard.profile.roles[0]?.id ?? 'kernel-proxy');

        return {
          ...current,
          role: nextRole,
        };
      });
    });
  }

  function updateOperatorToken(nextValue: string): void {
    setStoredOperatorToken((current) => buildOperatorTokenState(nextValue, current.remembered));
  }

  function updateOperatorTokenRemembered(remembered: boolean): void {
    setStoredOperatorToken((current) => buildOperatorTokenState(current.value, remembered));
  }

  async function refreshAdapters(): Promise<void> {
    const response = await fetch(`/api/v1/projects/${projectId}/adapters`);
    const payload = await parseBrokerResponse<AdapterStatusResponse>(response);
    setAdapterStatuses(payload.adapters);
  }

  function updateTaskDraft(taskId: string, patch: Partial<TaskDraft>): void {
    setTaskDrafts((current) => ({
      ...current,
      [taskId]: {
        ...(current[taskId] ?? {
          status: 'queued',
          assignee: '',
          blockedReason: '',
          approvalRequired: false,
          approvedBy: '',
          approvalNote: '',
        }),
        ...patch,
      },
    }));
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!createTaskForm.title.trim() || !createTaskForm.description.trim() || !createTaskForm.role.trim()) {
      setMutationError('New tasks need a title, description, and role.');
      return;
    }

    try {
      setMutationError(null);
      setRefreshMessage(null);
      setRefreshMessageAdvisory(false);
      setIsCreatingTask(true);

      const response = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: buildMutationHeaders(operatorToken),
        body: JSON.stringify({
          title: createTaskForm.title.trim(),
          description: createTaskForm.description.trim(),
          priority: createTaskForm.priority,
          role: createTaskForm.role,
          approvalRequired: createTaskForm.approvalRequired,
          approvalNote: createTaskForm.approvalRequired && createTaskForm.approvalNote.trim()
            ? createTaskForm.approvalNote.trim()
            : undefined,
        }),
      });
      const nextDashboard = await parseBrokerResponse<ProjectDashboardSnapshot>(response);

      applyDashboard(nextDashboard);
      setCreateTaskForm(createEmptyTaskForm(nextDashboard.profile.roles[0]?.id ?? createTaskForm.role));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unknown task creation error.');
    } finally {
      setIsCreatingTask(false);
    }
  }

  async function handleSaveTask(task: SwitchboardTask): Promise<void> {
    const draft = taskDrafts[task.id] ?? buildTaskDrafts([task])[task.id];

    if (draft.status === 'blocked' && !draft.blockedReason.trim()) {
      setMutationError(`Task ${task.id} needs a blocked reason before it can stay blocked.`);
      return;
    }

    try {
      setMutationError(null);
      setRefreshMessage(null);
      setRefreshMessageAdvisory(false);
      setSavingTaskId(task.id);

      const response = await fetch(`/api/v1/projects/${projectId}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: buildMutationHeaders(operatorToken),
        body: JSON.stringify({
          status: draft.status,
          assignee: draft.assignee.trim() ? draft.assignee.trim() : null,
          blockedReason: draft.status === 'blocked'
            ? (draft.blockedReason.trim() ? draft.blockedReason.trim() : null)
            : null,
          approvalRequired: draft.approvalRequired,
          approvedBy: draft.approvalRequired
            ? (draft.approvedBy.trim() ? draft.approvedBy.trim() : null)
            : null,
          approvalNote: draft.approvalRequired
            ? (draft.approvalNote.trim() ? draft.approvalNote.trim() : null)
            : null,
        }),
      });
      const nextDashboard = await parseBrokerResponse<ProjectDashboardSnapshot>(response);
      applyDashboard(nextDashboard);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : `Unknown task update error for ${task.id}.`);
    } finally {
      setSavingTaskId(null);
    }
  }

  async function handleRefreshProvider(provider: string): Promise<void> {
    try {
      setMutationError(null);
      setRefreshMessage(null);
      setRefreshMessageAdvisory(false);
      setRefreshingProvider(provider);

      const response = await fetch(`/api/v1/projects/${projectId}/subscriptions/refresh`, {
        method: 'POST',
        headers: buildMutationHeaders(operatorToken),
        body: JSON.stringify({ provider }),
      });
      const payload = await parseBrokerResponse<ProjectRefreshSnapshot>(response);

      applyDashboard(payload.dashboard);
      await refreshAdapters();
      setRefreshMessageAdvisory(payload.refresh.some((entry) => isProviderSyncSummaryAdvisory(entry)));
      setRefreshMessage(payload.refresh.map((entry) => formatProviderRefreshSummaryMessage(entry)).join(', '));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : `Unknown refresh error for ${provider}.`);
    } finally {
      setRefreshingProvider(null);
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <h1>Switchboard</h1>
          <p>Local control plane for supervised multi-agent workflows.</p>
          <p className="muted">
            {dashboard
              ? `${dashboard.profile.name} profile · updated ${formatTimestamp(dashboard.updatedAt)}`
              : 'Waiting for broker state'}
          </p>
        </div>
      </header>

      <section className="panel-grid">
        <OperatorSessionPanel
          authSummary={authSummary}
          operatorTokenRequired={operatorTokenRequired}
          brokerTlsEnabled={brokerTlsEnabled}
          brokerTransportLabel={brokerTransportLabel}
          operatorToken={operatorToken}
          operatorTokenExpiresAt={operatorTokenExpiresAt}
          operatorTokenRemembered={operatorTokenRemembered}
          onTokenChange={updateOperatorToken}
          onRememberedChange={updateOperatorTokenRemembered}
        />

        <QuotaRefreshPanel
          adapterStatuses={adapterStatuses}
          providerSummaries={providerSummaries}
          isLoading={isLoading}
          refreshingProvider={refreshingProvider}
          canRefreshSubscriptions={canRefreshSubscriptions}
          onRefreshProvider={(provider) => void handleRefreshProvider(provider)}
        />

        <TaskIntakePanel
          createTaskForm={createTaskForm}
          setCreateTaskForm={setCreateTaskForm}
          roleOptions={roleOptions}
          isCreatingTask={isCreatingTask}
          isLoading={isLoading}
          canCreateTasks={canCreateTasks}
          onSubmit={(event) => void handleCreateTask(event)}
        />

        <ModelAvailabilityPanel subscriptions={subscriptions} isLoading={isLoading} />

        <PlanningNotesPanel
          warnings={warnings}
          refreshMessage={refreshMessage}
          refreshMessageAdvisory={refreshMessageAdvisory}
          loadError={loadError}
          mutationError={mutationError}
        />

        <ModelSelectionPanel
          isLoading={isLoading}
          selectionWarnings={selectionWarnings}
          modelCatalog={modelCatalog}
        />
      </section>

      <SwitchboardLanes
        tasks={tasks}
        taskDrafts={taskDrafts}
        isLoading={isLoading}
        savingTaskId={savingTaskId}
        canUpdateTasks={canUpdateTasks}
        onUpdateTaskDraft={updateTaskDraft}
        onSaveTask={(task) => void handleSaveTask(task)}
      />
    </main>
  );
}
