import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ApprovalEventKind,
  CreateTaskInput,
  ModelQuotaSnapshot,
  ModelQuotaWindowSnapshot,
  ModelReservation,
  ProjectProfile,
  ProjectStateSnapshot,
  SubscriptionAccount,
  SubscriptionSyncMethod,
  TaskApprovalEvent,
  TaskStatus,
  UpdateTaskInput,
  SwitchboardTask,
  TaskArtifact,
} from '@switchboard/core';
import { createSeedState } from './default-state.js';
import {
  expectArray,
  expectBoolean,
  expectEnum,
  expectIdentifier,
  expectOptionalNumber,
  expectOptionalString,
  expectRecord,
  expectString,
  expectStringArray,
} from './validation.js';

const availabilityStates = ['available', 'constrained', 'unavailable', 'unknown'] as const;
const authModes = ['subscription', 'api', 'hybrid'] as const;
const subscriptionSyncMethods = ['seed', 'snapshot', 'provider'] as const;
const usageUnits = ['requests', 'messages', 'minutes', 'credits', 'tokens', 'unknown'] as const;
const usageSources = ['manual', 'cli', 'provider-ui', 'api', 'inferred'] as const;
const confidenceLevels = ['low', 'medium', 'high'] as const;
const quotaInterpretations = ['absolute', 'percentage_window', 'informational'] as const;
const taskStatuses = ['queued', 'planned', 'running', 'review', 'blocked', 'completed', 'failed'] as const;
const taskPriorities = ['p0', 'p1', 'p2', 'p3'] as const;
const artifactTypes = ['spec', 'diff', 'doc', 'log', 'result', 'other'] as const;
const approvalEventKinds = ['requested', 'approved', 'reset'] as const;
const allowedStatusTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['planned', 'running', 'blocked', 'failed'],
  planned: ['queued', 'running', 'blocked', 'failed'],
  running: ['review', 'blocked', 'completed', 'failed'],
  review: ['planned', 'running', 'blocked', 'completed', 'failed'],
  blocked: ['planned', 'running', 'failed'],
  completed: ['planned'],
  failed: ['planned', 'running', 'blocked'],
};

interface PersistedProjectState {
  updatedAt: string;
  subscriptions: SubscriptionAccount[];
  tasks: SwitchboardTask[];
}

export class TaskNotFoundError extends Error {}
export class TaskConflictError extends Error {}

function parseQuotaWindowSnapshot(value: unknown, context: string): ModelQuotaWindowSnapshot {
  const record = expectRecord(value, context);

  return {
    id: expectString(record.id, `${context}.id`),
    label: expectString(record.label, `${context}.label`),
    durationMinutes: expectOptionalNumber(record.durationMinutes, `${context}.durationMinutes`),
    limit: expectOptionalNumber(record.limit, `${context}.limit`),
    used: expectOptionalNumber(record.used, `${context}.used`),
    remaining: expectOptionalNumber(record.remaining, `${context}.remaining`),
    interpretation: record.interpretation === undefined
      ? undefined
      : expectEnum(record.interpretation, quotaInterpretations, `${context}.interpretation`),
    resetAt: expectOptionalString(record.resetAt, `${context}.resetAt`),
  };
}

function parseQuotaSnapshot(value: unknown, context: string): ModelQuotaSnapshot {
  const record = expectRecord(value, context);

  return {
    provider: expectString(record.provider, `${context}.provider`),
    modelId: expectString(record.modelId, `${context}.modelId`),
    displayName: expectString(record.displayName, `${context}.displayName`),
    availability: expectEnum(record.availability, availabilityStates, `${context}.availability`),
    authMode: expectEnum(record.authMode, authModes, `${context}.authMode`),
    usageUnit: expectEnum(record.usageUnit, usageUnits, `${context}.usageUnit`),
    source: expectEnum(record.source, usageSources, `${context}.source`),
    confidence: expectEnum(record.confidence, confidenceLevels, `${context}.confidence`),
    limit: expectOptionalNumber(record.limit, `${context}.limit`),
    used: expectOptionalNumber(record.used, `${context}.used`),
    remaining: expectOptionalNumber(record.remaining, `${context}.remaining`),
    interpretation: record.interpretation === undefined
      ? undefined
      : expectEnum(record.interpretation, quotaInterpretations, `${context}.interpretation`),
    resetAt: expectOptionalString(record.resetAt, `${context}.resetAt`),
    windows: record.windows === undefined
      ? undefined
      : expectArray(record.windows, `${context}.windows`).map((entry, index) =>
          parseQuotaWindowSnapshot(entry, `${context}.windows[${index}]`),
        ),
    notes: expectOptionalString(record.notes, `${context}.notes`),
  };
}

function parseSubscriptionSignal(value: unknown, context: string): NonNullable<SubscriptionAccount['signals']>[number] {
  const record = expectRecord(value, context);

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    label: expectString(record.label, `${context}.label`),
    value: expectString(record.value, `${context}.value`),
  };
}

function parseSubscriptionAccount(value: unknown, context: string): SubscriptionAccount {
  const record = expectRecord(value, context);

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    provider: expectString(record.provider, `${context}.provider`),
    displayName: expectString(record.displayName, `${context}.displayName`),
    authMode: expectEnum(record.authMode, authModes, `${context}.authMode`),
    owner: expectString(record.owner, `${context}.owner`),
    syncMethod: record.syncMethod === undefined
      ? undefined
      : expectEnum(record.syncMethod, subscriptionSyncMethods, `${context}.syncMethod`) as SubscriptionSyncMethod,
    lastRefreshedAt: expectOptionalString(record.lastRefreshedAt, `${context}.lastRefreshedAt`),
    signals: record.signals === undefined
      ? undefined
      : expectArray(record.signals, `${context}.signals`).map((entry, index) =>
          parseSubscriptionSignal(entry, `${context}.signals[${index}]`),
        ),
    quotas: expectArray(record.quotas, `${context}.quotas`).map((entry, index) =>
      parseQuotaSnapshot(entry, `${context}.quotas[${index}]`),
    ),
  };
}

function parseReservation(value: unknown, context: string): ModelReservation {
  const record = expectRecord(value, context);

  return {
    provider: expectString(record.provider, `${context}.provider`),
    modelId: expectString(record.modelId, `${context}.modelId`),
    estimatedCost: expectOptionalNumber(record.estimatedCost, `${context}.estimatedCost`) ?? 0,
    usageUnit: expectEnum(record.usageUnit, usageUnits, `${context}.usageUnit`),
    reason: expectString(record.reason, `${context}.reason`),
  };
}

function parseArtifact(value: unknown, context: string): TaskArtifact {
  const record = expectRecord(value, context);

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    type: expectEnum(record.type, artifactTypes, `${context}.type`),
    uri: expectString(record.uri, `${context}.uri`),
    summary: expectString(record.summary, `${context}.summary`),
  };
}

function parseApprovalEvent(value: unknown, context: string): TaskApprovalEvent {
  const record = expectRecord(value, context);

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    kind: expectEnum(record.kind, approvalEventKinds, `${context}.kind`),
    at: expectString(record.at, `${context}.at`),
    actor: expectOptionalString(record.actor, `${context}.actor`),
    note: expectOptionalString(record.note, `${context}.note`),
  };
}

function parseTask(value: unknown, context: string, fallbackTimestamp: string): SwitchboardTask {
  const record = expectRecord(value, context);
  const createdAt = expectOptionalString(record.createdAt, `${context}.createdAt`) ?? fallbackTimestamp;
  const updatedAt = expectOptionalString(record.updatedAt, `${context}.updatedAt`) ?? createdAt;
  const approvalRequired = record.approvalRequired === undefined ? undefined : expectBoolean(record.approvalRequired, `${context}.approvalRequired`);

  return {
    id: expectIdentifier(record.id, `${context}.id`),
    title: expectString(record.title, `${context}.title`),
    description: expectString(record.description, `${context}.description`),
    status: expectEnum(record.status, taskStatuses, `${context}.status`),
    priority: expectEnum(record.priority, taskPriorities, `${context}.priority`),
    role: expectString(record.role, `${context}.role`),
    createdAt,
    updatedAt,
    assignee: expectOptionalString(record.assignee, `${context}.assignee`),
    blockedReason: expectOptionalString(record.blockedReason, `${context}.blockedReason`),
    approvalRequired,
    approvalRequestedAt: expectOptionalString(record.approvalRequestedAt, `${context}.approvalRequestedAt`),
    approvedAt: expectOptionalString(record.approvedAt, `${context}.approvedAt`),
    approvedBy: expectOptionalString(record.approvedBy, `${context}.approvedBy`),
    approvalNote: expectOptionalString(record.approvalNote, `${context}.approvalNote`),
    approvalEvents: record.approvalEvents === undefined
      ? undefined
      : expectArray(record.approvalEvents, `${context}.approvalEvents`).map((entry, index) =>
          parseApprovalEvent(entry, `${context}.approvalEvents[${index}]`),
        ),
    reservations: record.reservations === undefined
      ? undefined
      : expectArray(record.reservations, `${context}.reservations`).map((entry, index) =>
          parseReservation(entry, `${context}.reservations[${index}]`),
        ),
    artifacts: record.artifacts === undefined
      ? undefined
      : expectArray(record.artifacts, `${context}.artifacts`).map((entry, index) =>
          parseArtifact(entry, `${context}.artifacts[${index}]`),
        ),
    dependsOn: record.dependsOn === undefined ? undefined : expectStringArray(record.dependsOn, `${context}.dependsOn`),
  };
}

function parsePersistedState(raw: unknown, profile: ProjectProfile, context: string): ProjectStateSnapshot {
  const record = expectRecord(raw, context);

  return {
    profile,
    updatedAt: expectString(record.updatedAt, `${context}.updatedAt`),
    subscriptions: expectArray(record.subscriptions, `${context}.subscriptions`).map((entry, index) =>
      parseSubscriptionAccount(entry, `${context}.subscriptions[${index}]`),
    ),
    tasks: expectArray(record.tasks, `${context}.tasks`).map((entry, index) =>
      parseTask(entry, `${context}.tasks[${index}]`, expectString(record.updatedAt, `${context}.updatedAt`)),
    ),
  };
}

function toPersistedState(snapshot: ProjectStateSnapshot): PersistedProjectState {
  return {
    updatedAt: snapshot.updatedAt,
    subscriptions: snapshot.subscriptions,
    tasks: snapshot.tasks,
  };
}

function nextTaskId(tasks: SwitchboardTask[]): string {
  const max = tasks.reduce((currentMax, task) => {
    const match = /^TASK-(\d+)$/.exec(task.id);
    if (!match) {
      return currentMax;
    }

    return Math.max(currentMax, Number(match[1]));
  }, 0);

  return `TASK-${String(max + 1).padStart(4, '0')}`;
}

function canTransition(current: TaskStatus, next: TaskStatus): boolean {
  return current === next || allowedStatusTransitions[current].includes(next);
}

function requiresApprovalBeforeExecution(status: TaskStatus): boolean {
  return status === 'running' || status === 'review' || status === 'completed';
}

function nextApprovalEventId(events: TaskApprovalEvent[]): string {
  const max = events.reduce((currentMax, event) => {
    const match = /^approval-(\d+)$/.exec(event.id);
    if (!match) {
      return currentMax;
    }

    return Math.max(currentMax, Number(match[1]));
  }, 0);

  return `approval-${String(max + 1).padStart(4, '0')}`;
}

function appendApprovalEvent(
  events: TaskApprovalEvent[] | undefined,
  kind: ApprovalEventKind,
  at: string,
  actor?: string,
  note?: string,
): TaskApprovalEvent[] {
  const current = events ?? [];

  return [
    ...current,
    {
      id: nextApprovalEventId(current),
      kind,
      at,
      actor,
      note,
    },
  ];
}

function applyTaskUpdate(task: SwitchboardTask, input: UpdateTaskInput, updatedAt: string): SwitchboardTask {
  const nextStatus = input.status ?? task.status;
  const hasAssigneePatch = Object.prototype.hasOwnProperty.call(input, 'assignee');
  const hasBlockedReasonPatch = Object.prototype.hasOwnProperty.call(input, 'blockedReason');
  const hasApprovalRequiredPatch = Object.prototype.hasOwnProperty.call(input, 'approvalRequired');
  const hasApprovedByPatch = Object.prototype.hasOwnProperty.call(input, 'approvedBy');
  const hasApprovalNotePatch = Object.prototype.hasOwnProperty.call(input, 'approvalNote');

  if (!canTransition(task.status, nextStatus)) {
    throw new TaskConflictError(`Task ${task.id} cannot move from ${task.status} to ${nextStatus}.`);
  }

  const nextAssignee = hasAssigneePatch
    ? input.assignee ?? undefined
    : task.assignee;
  const nextBlockedReason = nextStatus === 'blocked'
    ? (hasBlockedReasonPatch ? input.blockedReason ?? undefined : task.blockedReason)
    : undefined;

  if (nextStatus === 'blocked' && !nextBlockedReason) {
    throw new TaskConflictError(`Task ${task.id} needs a blockedReason while status is blocked.`);
  }

  if (nextStatus !== 'blocked' && hasBlockedReasonPatch && input.blockedReason) {
    throw new TaskConflictError(`Task ${task.id} may only set blockedReason when status is blocked.`);
  }

  const nextApprovalRequired = hasApprovalRequiredPatch ? Boolean(input.approvalRequired) : Boolean(task.approvalRequired);

  if (!nextApprovalRequired && hasApprovedByPatch && input.approvedBy) {
    throw new TaskConflictError(`Task ${task.id} must require approval before approvedBy may be set.`);
  }

  if (!nextApprovalRequired && hasApprovalNotePatch && input.approvalNote) {
    throw new TaskConflictError(`Task ${task.id} must require approval before approvalNote may be set.`);
  }

  let nextApprovalRequestedAt: string | undefined;
  let nextApprovedAt: string | undefined;
  let nextApprovedBy: string | undefined;
  let nextApprovalNote: string | undefined;
  let nextApprovalEvents = task.approvalEvents;

  if (nextApprovalRequired) {
    nextApprovalRequestedAt = task.approvalRequestedAt;
    nextApprovedAt = task.approvedAt;
    nextApprovedBy = task.approvedBy;
    nextApprovalNote = hasApprovalNotePatch ? input.approvalNote ?? undefined : task.approvalNote;

    if (!task.approvalRequired && hasApprovalRequiredPatch) {
      nextApprovalRequestedAt = updatedAt;
      nextApprovedAt = undefined;
      nextApprovedBy = undefined;
      nextApprovalEvents = appendApprovalEvent(nextApprovalEvents, 'requested', updatedAt, undefined, nextApprovalNote);
    }

    if (hasApprovedByPatch) {
      nextApprovedBy = input.approvedBy ?? undefined;
      if (nextApprovedBy) {
        nextApprovedAt = updatedAt;
        nextApprovalRequestedAt = nextApprovalRequestedAt ?? updatedAt;
        nextApprovalEvents = appendApprovalEvent(nextApprovalEvents, 'approved', updatedAt, nextApprovedBy, nextApprovalNote);
      } else {
        if (task.approvedAt || task.approvedBy) {
          nextApprovalEvents = appendApprovalEvent(
            nextApprovalEvents,
            'reset',
            updatedAt,
            task.approvedBy,
            nextApprovalNote,
          );
          nextApprovalRequestedAt = updatedAt;
        }
        nextApprovedAt = undefined;
        nextApprovedBy = undefined;
        nextApprovalRequestedAt = nextApprovalRequestedAt ?? updatedAt;
      }
    }
  }

  if (nextApprovalRequired && requiresApprovalBeforeExecution(nextStatus) && !nextApprovedAt) {
    throw new TaskConflictError(`Task ${task.id} needs operator approval before it can move to ${nextStatus}.`);
  }

  return {
    ...task,
    title: input.title ?? task.title,
    description: input.description ?? task.description,
    priority: input.priority ?? task.priority,
    role: input.role ?? task.role,
    status: nextStatus,
    assignee: nextAssignee,
    blockedReason: nextBlockedReason,
    approvalRequired: nextApprovalRequired || undefined,
    approvalRequestedAt: nextApprovalRequired ? nextApprovalRequestedAt ?? updatedAt : undefined,
    approvedAt: nextApprovalRequired ? nextApprovedAt : undefined,
    approvedBy: nextApprovalRequired ? nextApprovedBy : undefined,
    approvalNote: nextApprovalRequired ? nextApprovalNote : undefined,
    approvalEvents: nextApprovalEvents,
    updatedAt,
  };
}

export class FileStateStore {
  constructor(private readonly stateDir: string) {}

  private filePath(profileId: string): string {
    return path.join(this.stateDir, `${profileId}.json`);
  }

  private async ensurePrivateDirectory(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.stateDir, 0o700).catch(() => undefined);
  }

  private async writeSnapshot(snapshot: ProjectStateSnapshot): Promise<void> {
    await this.ensurePrivateDirectory();
    const filePath = this.filePath(snapshot.profile.id);
    await fs.writeFile(filePath, `${JSON.stringify(toPersistedState(snapshot), null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(filePath, 0o600).catch(() => undefined);
  }

  async load(profile: ProjectProfile): Promise<ProjectStateSnapshot> {
    await this.ensurePrivateDirectory();
    const filePath = this.filePath(profile.id);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return parsePersistedState(JSON.parse(raw), profile, `state snapshot ${profile.id}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const seed = createSeedState(profile);
    await this.writeSnapshot(seed);
    return seed;
  }

  async createTask(profile: ProjectProfile, input: CreateTaskInput): Promise<ProjectStateSnapshot> {
    const current = await this.load(profile);
    const updatedAt = new Date().toISOString();
    const next: ProjectStateSnapshot = {
      ...current,
      updatedAt,
      tasks: [
        ...current.tasks,
        {
          id: nextTaskId(current.tasks),
          title: input.title,
          description: input.description,
          status: input.status ?? 'queued',
          priority: input.priority,
          role: input.role,
          createdAt: updatedAt,
          updatedAt,
          assignee: input.assignee,
          approvalRequired: input.approvalRequired || undefined,
          approvalRequestedAt: input.approvalRequired ? updatedAt : undefined,
          approvalNote: input.approvalRequired ? input.approvalNote : undefined,
          approvalEvents: input.approvalRequired
            ? appendApprovalEvent(undefined, 'requested', updatedAt, undefined, input.approvalNote)
            : undefined,
          reservations: input.reservations,
          artifacts: input.artifacts,
          dependsOn: input.dependsOn,
        },
      ],
    };

    const createdTask = next.tasks[next.tasks.length - 1];
    if (createdTask.approvalRequired && requiresApprovalBeforeExecution(createdTask.status)) {
      throw new TaskConflictError(`Task ${createdTask.id} needs operator approval before it can start in status ${createdTask.status}.`);
    }

    await this.writeSnapshot(next);
    return next;
  }

  async getTask(profile: ProjectProfile, taskId: string): Promise<SwitchboardTask> {
    const current = await this.load(profile);
    const task = current.tasks.find((entry) => entry.id === taskId);

    if (!task) {
      throw new TaskNotFoundError(`Task ${taskId} does not exist for profile ${profile.id}.`);
    }

    return task;
  }

  async updateTask(profile: ProjectProfile, taskId: string, input: UpdateTaskInput): Promise<ProjectStateSnapshot> {
    const current = await this.load(profile);
    const updatedAt = new Date().toISOString();
    let found = false;

    const tasks = current.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }

      found = true;
      return applyTaskUpdate(task, input, updatedAt);
    });

    if (!found) {
      throw new TaskNotFoundError(`Task ${taskId} does not exist for profile ${profile.id}.`);
    }

    const next: ProjectStateSnapshot = {
      ...current,
      updatedAt,
      tasks,
    };

    await this.writeSnapshot(next);
    return next;
  }

  async replaceSubscriptions(profile: ProjectProfile, subscriptions: SubscriptionAccount[]): Promise<ProjectStateSnapshot> {
    const current = await this.load(profile);
    const next: ProjectStateSnapshot = {
      ...current,
      updatedAt: new Date().toISOString(),
      subscriptions,
    };

    await this.writeSnapshot(next);
    return next;
  }

  async replaceSubscriptionsForProviders(
    profile: ProjectProfile,
    providers: string[],
    subscriptions: SubscriptionAccount[],
  ): Promise<ProjectStateSnapshot> {
    const current = await this.load(profile);
    const replaceSet = new Set(providers);
    const next: ProjectStateSnapshot = {
      ...current,
      updatedAt: new Date().toISOString(),
      subscriptions: [
        ...current.subscriptions.filter((account) => !replaceSet.has(account.provider)),
        ...subscriptions,
      ].sort((left, right) => `${left.provider}:${left.id}`.localeCompare(`${right.provider}:${right.id}`)),
    };

    await this.writeSnapshot(next);
    return next;
  }
}
