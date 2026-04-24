import { startTransition, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  formatPlannerWarningPills,
  formatPlannerWarningTitle,
  formatQuotaCoverageMessage,
  plannerWarningKey,
  formatProviderAdapterLaunchDriftWarning,
  formatProviderRefreshSummaryMessage,
  formatProviderSyncQuotaCoverageMessage,
  isProviderSyncSummaryAdvisory,
  formatProviderSyncSummaryDisplayMessage,
  formatProviderSyncSummaryPills,
  resolveBrokerProtocol,
  resolveBrokerTlsEnabled,
  formatSubscriptionAccountWarning,
} from '@switchboard/core';
import type {
  ProjectAdaptersSnapshot,
  BrokerAuthSummary,
  BrokerHealthSnapshot,
  BrokerMutationAccess,
  ModelQuotaSnapshot,
  ModelQuotaWindowSnapshot,
  ProviderAdapterStatusSnapshot,
  ProjectDashboardSnapshot,
  ProjectRefreshSnapshot,
  SubscriptionSignal,
  TaskApprovalEvent,
  SwitchboardTask,
  TaskPriority,
  TaskStatus,
} from '@switchboard/core';

type CreateTaskFormState = {
  title: string;
  description: string;
  priority: TaskPriority;
  role: string;
  approvalRequired: boolean;
  approvalNote: string;
};

type TaskDraft = {
  status: TaskStatus;
  assignee: string;
  blockedReason: string;
  approvalRequired: boolean;
  approvedBy: string;
  approvalNote: string;
};

type TaskDraftMap = Record<string, TaskDraft>;

type AdapterStatus = ProviderAdapterStatusSnapshot;
type AdapterStatusResponse = ProjectAdaptersSnapshot;

const projectId = 'threatpedia';
const lanes: TaskStatus[] = ['queued', 'planned', 'running', 'review', 'blocked', 'completed'];
const taskPriorities: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];
const taskStatuses: TaskStatus[] = ['queued', 'planned', 'running', 'review', 'blocked', 'completed', 'failed'];
const authScopeLabels: Array<{
  key: keyof BrokerAuthSummary['scopes'];
  label: string;
}> = [
  { key: 'taskCreate', label: 'Task creation' },
  { key: 'taskUpdate', label: 'Task updates' },
  { key: 'subscriptionRefresh', label: 'Quota refresh' },
  { key: 'subscriptionReplace', label: 'Direct subscription replace' },
];
const planningNotes = [
  'Quota and credit snapshots should be visible before task assignment.',
  'Tasks can reserve expected model usage before execution begins.',
  'Approval-required tasks should be held before execution, not silently advanced.',
  'Unknown usage states should surface as planning warnings, not silent assumptions.',
];
const operatorTokenStorageKey = 'switchboard.operatorToken';
const operatorTokenTtlMs = 24 * 60 * 60 * 1000;

type StoredOperatorTokenState = {
  value: string;
  expiresAt: string | null;
};

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function clearStoredOperatorToken(): void {
  if (!hasBrowserStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(operatorTokenStorageKey);
  } catch {
    // Ignore storage errors and fall back to in-memory state.
  }
}

function readStoredOperatorToken(nowMs = Date.now()): StoredOperatorTokenState {
  if (!hasBrowserStorage()) {
    return {
      value: '',
      expiresAt: null,
    };
  }

  try {
    const rawValue = window.localStorage.getItem(operatorTokenStorageKey);
    if (!rawValue) {
      return {
        value: '',
        expiresAt: null,
      };
    }

    const parsed = JSON.parse(rawValue) as { value?: unknown; expiresAt?: unknown };
    if (typeof parsed.value !== 'string' || typeof parsed.expiresAt !== 'string') {
      clearStoredOperatorToken();
      return {
        value: '',
        expiresAt: null,
      };
    }

    const expiresAtMs = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      clearStoredOperatorToken();
      return {
        value: '',
        expiresAt: null,
      };
    }

    return {
      value: parsed.value,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    clearStoredOperatorToken();
    return {
      value: '',
      expiresAt: null,
    };
  }
}

function persistStoredOperatorToken(value: string, nowMs = Date.now()): string | null {
  if (!hasBrowserStorage()) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    clearStoredOperatorToken();
    return null;
  }

  const expiresAt = new Date(nowMs + operatorTokenTtlMs).toISOString();

  try {
    window.localStorage.setItem(operatorTokenStorageKey, JSON.stringify({
      value,
      expiresAt,
    }));
    return expiresAt;
  } catch {
    return null;
  }
}

function buildTaskDrafts(tasks: SwitchboardTask[]): TaskDraftMap {
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

function createEmptyTaskForm(role: string): CreateTaskFormState {
  return {
    title: '',
    description: '',
    priority: 'p1',
    role,
    approvalRequired: false,
    approvalNote: '',
  };
}

async function parseBrokerResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let detail = `Broker request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload.detail) {
      detail = payload.detail;
    }
  } catch {
    // Keep the default error when the body is not JSON.
  }

  throw new Error(detail);
}

function buildMutationHeaders(operatorToken: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (operatorToken.trim()) {
    headers['X-Switchboard-Operator-Token'] = operatorToken.trim();
  }

  return headers;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatQuotaBudget(quota: Pick<ModelQuotaSnapshot, 'remaining' | 'interpretation' | 'usageUnit'>): string {
  if (quota.remaining === undefined) {
    if (quota.interpretation === 'percentage_window' || quota.usageUnit === 'unknown' || quota.usageUnit === undefined) {
      return 'unknown budget';
    }

    return `unknown ${quota.usageUnit}`;
  }

  if (quota.interpretation === 'percentage_window') {
    return `${quota.remaining}% remaining`;
  }

  return `${quota.remaining} ${quota.usageUnit}`;
}

function formatQuotaUsage(
  quota: Pick<ModelQuotaSnapshot, 'used' | 'limit' | 'interpretation'>,
  label = 'current window',
): string | null {
  if (quota.used === undefined || quota.limit === undefined) {
    return null;
  }

  if (quota.interpretation === 'percentage_window') {
    return `used ${quota.used}% of ${label}`;
  }

  return `used ${quota.used}/${quota.limit}`;
}

function resolveQuotaWindows(quota: ModelQuotaSnapshot): ModelQuotaWindowSnapshot[] {
  if (quota.windows?.length) {
    return quota.windows;
  }

  if (
    quota.limit === undefined
    && quota.used === undefined
    && quota.remaining === undefined
    && quota.resetAt === undefined
  ) {
    return [];
  }

  return [
    {
      id: 'current',
      label: 'Current window',
      limit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
      interpretation: quota.interpretation,
      resetAt: quota.resetAt,
    },
  ];
}

function formatSignal(signal: SubscriptionSignal): string {
  return `${signal.label}: ${signal.value}`;
}

function formatQuotaPills(quota: Pick<ModelQuotaSnapshot, 'source' | 'confidence' | 'interpretation' | 'usageUnit'>): string[] {
  const pills = [
    `source: ${quota.source}`,
    `confidence: ${quota.confidence}`,
  ];

  if (quota.interpretation === 'percentage_window') {
    pills.push('windowed %');
  } else if (quota.interpretation === 'informational') {
    pills.push('informational');
  } else if (quota.interpretation) {
    pills.push(quota.interpretation);
  }

  if (quota.usageUnit && quota.usageUnit !== 'unknown' && quota.interpretation !== 'percentage_window') {
    pills.push(`unit: ${quota.usageUnit}`);
  }

  return pills;
}

function formatAccountSyncWarning(account: ProjectDashboardSnapshot['subscriptions'][number]): string | null {
  return formatSubscriptionAccountWarning(account);
}

function formatTaskApproval(task: SwitchboardTask): string | null {
  if (!task.approvalRequired) {
    return null;
  }

  if (task.approvedAt) {
    return `approval: approved by ${task.approvedBy ?? 'operator'} at ${formatTimestamp(task.approvedAt)}`;
  }

  return task.approvalRequestedAt
    ? `approval: pending since ${formatTimestamp(task.approvalRequestedAt)}`
    : 'approval: pending';
}

function formatApprovalEvent(event: TaskApprovalEvent): string {
  switch (event.kind) {
    case 'requested':
      return `Approval requested ${formatTimestamp(event.at)}`;
    case 'approved':
      return `Approved by ${event.actor ?? 'operator'} ${formatTimestamp(event.at)}`;
    case 'reset':
      return `Returned to pending ${formatTimestamp(event.at)}`;
    default:
      return `${event.kind} ${formatTimestamp(event.at)}`;
  }
}

function canUseScope(scope: BrokerAuthSummary['scopes'][keyof BrokerAuthSummary['scopes']] | undefined, operatorToken: string): boolean {
  if (!scope) {
    return false;
  }

  return scope.requirement === 'open' || (scope.requirement === 'operator_token' && operatorToken.trim().length > 0);
}

function formatRequirement(requirement: BrokerMutationAccess): string {
  switch (requirement) {
    case 'open':
      return 'open';
    case 'operator_token':
      return 'token';
    case 'disabled':
      return 'disabled';
    default:
      return requirement;
  }
}

function formatBrokerTokenSource(authSummary: BrokerAuthSummary): string | null {
  switch (authSummary.operatorTokenSource) {
    case 'env':
      return 'env';
    case 'file':
      return authSummary.operatorTokenFile
        ? `file (${authSummary.operatorTokenFile})`
        : 'file';
    case 'direct':
      return 'direct override';
    case 'unset':
      return 'unset';
    default:
      return null;
  }
}

function getAdapterStatus(adapter: Partial<AdapterStatus>): NonNullable<AdapterStatus['status']> {
  if (adapter.status) {
    return adapter.status;
  }

  if (adapter.configured === false) {
    return 'missing';
  }

  if (adapter.secure === false) {
    return 'insecure';
  }

  if ((adapter.advisoryCodes?.length ?? 0) > 0) {
    return 'ready_with_advisories';
  }

  return 'ready';
}

function formatAdapterStatus(adapter: Partial<AdapterStatus>): string {
  return getAdapterStatus(adapter).replace(/_/g, ' ');
}

function isAdapterAdvisory(adapter: Partial<AdapterStatus>): boolean {
  return getAdapterStatus(adapter) === 'ready_with_advisories' || (adapter.advisoryCodes?.length ?? 0) > 0;
}

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
  const providerSummaries = dashboard?.providerSummaries ?? [];
  const operatorToken = storedOperatorToken.value;
  const operatorTokenExpiresAt = storedOperatorToken.expiresAt;
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
    setStoredOperatorToken({
      value: nextValue,
      expiresAt: persistStoredOperatorToken(nextValue),
    });
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
        <section className="panel">
          <h2>Operator session</h2>
          <div className="stack">
            <p className="muted">
              {authSummary
                ? authSummary.localOnly
                  ? brokerTlsEnabled
                    ? 'This broker is loopback-only and serving HTTPS. Mutation routes may stay open locally or require a token when one is configured.'
                    : 'This broker is loopback-only over HTTP. Mutation routes may stay open locally or require a token when one is configured.'
                  : brokerTlsEnabled
                    ? 'This broker is prepared for non-local exposure over HTTPS. Keep it behind trusted network controls and token-gated mutation routes.'
                    : 'This broker is prepared for non-local exposure but is not serving HTTPS. Fix transport security before trusting remote access.'
                : operatorTokenRequired
                  ? 'This broker currently requires an operator token for task and quota mutations.'
                  : 'Operator token is optional while the broker stays loopback-only.'}
            </p>
            {authSummary ? (
              <div className="account-signals">
                <span className="signal-pill">{brokerTransportLabel}</span>
                <span className="signal-pill">{brokerTlsEnabled ? 'TLS enabled' : 'no TLS'}</span>
                <span className="signal-pill">
                  {authSummary.localOnly ? 'loopback-only' : 'remote-capable'}
                </span>
              </div>
            ) : null}
            <label className="field">
              <span>Operator token</span>
              <input
                className="input"
                type="password"
                value={operatorToken}
                onChange={(event) => updateOperatorToken(event.target.value)}
                placeholder={
                  authSummary?.operatorTokenConfigured
                    ? `Required in ${authSummary.operatorTokenHeader}`
                    : 'Optional until token enforcement is enabled'
                }
              />
            </label>
            {operatorTokenExpiresAt ? (
              <p className="muted">
                Saved in this browser until {formatTimestamp(operatorTokenExpiresAt)}.
              </p>
            ) : null}
            {authSummary && formatBrokerTokenSource(authSummary) ? (
              <p className="muted">
                Broker token source: {formatBrokerTokenSource(authSummary)}.
              </p>
            ) : null}
            {authSummary?.operatorTokenProblem ? (
              <p className="warning-text">
                Broker token wiring: {authSummary.operatorTokenProblem}
              </p>
            ) : null}
            {operatorToken ? (
              <p className="muted">
                This browser cache only affects UI mutations. Shell-based `doctor:*` and `preflight` checks still read
                `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE`.
              </p>
            ) : null}
            {authSummary ? (
              <div className="policy-grid">
                {authScopeLabels.map((scope) => (
                  <article className="policy-row" key={scope.key}>
                    <div className="policy-heading">
                      <strong>{scope.label}</strong>
                      <span className={`policy-chip policy-${authSummary.scopes[scope.key].requirement}`}>
                        {formatRequirement(authSummary.scopes[scope.key].requirement)}
                      </span>
                    </div>
                    <p className="muted policy-detail">{authSummary.scopes[scope.key].detail}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <h2>Quota refresh</h2>
          <div className="stack">
            {adapterStatuses.length === 0 && !isLoading ? <p className="muted">No provider adapters are configured for this profile yet.</p> : null}
            {adapterStatuses.map((adapter) => (
              (() => {
                const providerSummary = providerSummaries.find((entry) => entry.provider === adapter.provider);
                const providerSyncMessage = providerSummary
                  ? formatProviderSyncSummaryDisplayMessage(providerSummary)
                  : null;
                const providerQuotaCoverageMessage = providerSummary
                  ? formatProviderSyncQuotaCoverageMessage(providerSummary)
                  : null;
                const adapterLaunchDrift = providerSummary
                  ? formatProviderAdapterLaunchDriftWarning(providerSummary, adapter)
                  : null;
                const providerSyncPills = providerSummary
                  ? formatProviderSyncSummaryPills(providerSummary)
                  : [];

                return (
                  <article className="card" key={adapter.provider}>
                    <div className="task-meta">
                      <span>{adapter.provider} · {adapter.kind}</span>
                      <span>{adapter.description}</span>
                      <span>source: {adapter.source}</span>
                      <span>
                        status: {formatAdapterStatus(adapter)}
                      </span>
                      {adapter.lastModifiedAt ? <span>last modified: {formatTimestamp(adapter.lastModifiedAt)}</span> : null}
                      {adapter.problem ? <span>{adapter.problem}</span> : null}
                    </div>
                    {adapter.statusMessage ? (
                      <p className={isAdapterAdvisory(adapter) ? 'warning-text' : 'muted'}>
                        {adapter.statusMessage}
                      </p>
                    ) : null}
                    {adapterLaunchDrift ? (
                      <p className="warning-text">{adapterLaunchDrift}</p>
                    ) : null}
                    {providerSyncMessage ? (
                      <p className={providerSummary && isProviderSyncSummaryAdvisory(providerSummary) ? 'warning-text' : 'success-text'}>
                        last sync: {providerSyncMessage}
                      </p>
                    ) : null}
                    {providerQuotaCoverageMessage ? (
                      <p className="warning-text">{providerQuotaCoverageMessage}</p>
                    ) : null}
                    {providerSummary?.accountDisplayNames?.length ? (
                      <p className="muted">
                        accounts: {providerSummary.accountDisplayNames.join(', ')}
                        {providerSummary.latestAccountRefreshedAt
                          ? ` · latest account refresh ${formatTimestamp(providerSummary.latestAccountRefreshedAt)}`
                          : ''}
                      </p>
                    ) : null}
                    {providerSyncPills.length > 0 ? (
                      <div className="account-signals">
                        {providerSyncPills.map((pill) => (
                          <span className="signal-pill" key={`${adapter.provider}-${pill}`}>
                            {pill}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="button-row">
                      <button
                        className="button secondary-button"
                        disabled={
                          refreshingProvider === adapter.provider
                          || !adapter.configured
                          || !adapter.secure
                          || !canRefreshSubscriptions
                        }
                        type="button"
                        onClick={() => void handleRefreshProvider(adapter.provider)}
                      >
                        {refreshingProvider === adapter.provider ? 'Refreshing…' : `Refresh ${adapter.provider}`}
                      </button>
                    </div>
                  </article>
                );
              })()
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Task intake</h2>
          <form className="stack" onSubmit={(event) => void handleCreateTask(event)}>
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

        <section className="panel">
          <h2>Model availability</h2>
          <div className="stack">
            {isLoading ? <p className="muted">Loading broker-backed subscriptions…</p> : null}
            {!isLoading && subscriptions.length === 0 ? <p className="muted">No subscription snapshots available yet.</p> : null}
            {subscriptions.map((account) => (
              (() => {
                const syncWarning = formatAccountSyncWarning(account);
                const quotaCoverageMessage = formatQuotaCoverageMessage(account.quotas);

                return (
                  <article className="card" key={account.id}>
                    <h3>{account.displayName}</h3>
                    <p className="muted">{account.provider} · {account.authMode}</p>
                    <p className="muted">
                      sync: {account.syncMethod ?? 'unknown'}
                      {account.lastRefreshedAt ? ` · refreshed ${formatTimestamp(account.lastRefreshedAt)}` : ''}
                    </p>
                    {account.signals?.length ? (
                      <div className="account-signals">
                        {account.signals.map((signal) => (
                          <span className="signal-pill" key={`${account.id}-${signal.id}`}>
                            {formatSignal(signal)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {syncWarning ? <p className="warning-text">{syncWarning}</p> : null}
                    {quotaCoverageMessage ? <p className="warning-text">{quotaCoverageMessage}</p> : null}
                    {account.quotas.map((quota) => (
                      (() => {
                        const quotaWindows = resolveQuotaWindows(quota);

                        return (
                          <div className="quota-stack" key={`${quota.provider}-${quota.modelId}`}>
                            <div className="quota-row">
                              <span>{quota.displayName}</span>
                              <span>{quota.availability}</span>
                              <span>{formatQuotaBudget(quota)}</span>
                            </div>
                            <div className="account-signals quota-signals">
                              {formatQuotaPills(quota).map((pill) => (
                                <span className="signal-pill" key={`${quota.provider}-${quota.modelId}-${pill}`}>
                                  {pill}
                                </span>
                              ))}
                            </div>
                            {quotaWindows.length > 0 ? (
                              <div className="quota-window-list">
                                {quotaWindows.map((window) => (
                                  <div className="quota-window" key={`${quota.provider}-${quota.modelId}-${window.id}`}>
                                    <div className="quota-row quota-window-row">
                                      <span>{window.label}</span>
                                      <span>{formatQuotaBudget({
                                        remaining: window.remaining,
                                        interpretation: window.interpretation,
                                        usageUnit: quota.usageUnit,
                                      })}</span>
                                    </div>
                                    <div className="quota-meta">
                                      {formatQuotaUsage(window, window.label.toLowerCase()) ? (
                                        <span>{formatQuotaUsage(window, window.label.toLowerCase())}</span>
                                      ) : null}
                                      {window.resetAt ? <span>resets {formatTimestamp(window.resetAt)}</span> : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="quota-meta">
                                {formatQuotaUsage(quota) ? <span>{formatQuotaUsage(quota)}</span> : null}
                                {quota.resetAt ? <span>resets {formatTimestamp(quota.resetAt)}</span> : null}
                              </div>
                            )}
                            {quota.notes ? <p className="muted quota-note">{quota.notes}</p> : null}
                          </div>
                        );
                      })()
                    ))}
                  </article>
                );
              })()
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Planning notes</h2>
          <ul>
            {planningNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
          {warnings.length > 0 ? (
            <div className="stack">
              {warnings.map((warning) => (
                <article className="card warning-card" key={plannerWarningKey(warning)}>
                  <strong>{formatPlannerWarningTitle(warning)}</strong>
                  <p>{warning.message}</p>
                  {formatPlannerWarningPills(warning).length > 0 ? (
                    <div className="account-signals">
                      {formatPlannerWarningPills(warning).map((pill) => (
                        <span className="signal-pill" key={`${warning.code}-${pill}`}>
                          {pill}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
          {refreshMessage ? <p className={refreshMessageAdvisory ? 'warning-text' : 'success-text'}>{refreshMessage}</p> : null}
          {loadError ? <p className="error-text">Broker load error: {loadError}</p> : null}
          {mutationError ? <p className="error-text">Broker mutation error: {mutationError}</p> : null}
        </section>
      </section>

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
                      <article className="card" key={task.id}>
                        <strong>{task.id}</strong>
                        <h4>{task.title}</h4>
                        <p>{task.description}</p>
                        <div className="task-meta">
                          <span>priority: {task.priority} · role: {task.role}</span>
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
                          </div>
                        ))}
                        <div className="card-actions">
                          <div className="field-grid">
                            <label className="field">
                              <span>Status</span>
                              <select
                                className="input"
                                value={draft.status}
                                onChange={(event) => updateTaskDraft(task.id, {
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
                                onChange={(event) => updateTaskDraft(task.id, {
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
                              onChange={(event) => updateTaskDraft(task.id, {
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
                                  onChange={(event) => updateTaskDraft(task.id, {
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
                                  onChange={(event) => updateTaskDraft(task.id, {
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
                                onChange={(event) => updateTaskDraft(task.id, {
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
                              onClick={() => void handleSaveTask(task)}
                            >
                              {savingTaskId === task.id ? 'Saving…' : 'Save task changes'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
