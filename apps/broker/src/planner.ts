import type {
  ModelQuotaSnapshot,
  ModelReservation,
  PlannerContext,
  PlannerResult,
  PlannerWarning,
  QuotaReservationWarningDetails,
  SubscriptionAccount,
  SwitchboardTask,
} from '@switchboard/core';
import {
  buildSnapshotBackedWarningDetail,
  buildSubscriptionSyncWarningDetail,
  formatSnapshotBackedPlannerMessage,
  formatSubscriptionSyncPlannerMessage,
} from '@switchboard/core';

type ReservationStatus = 'covered' | 'insufficient' | 'missing' | 'unavailable' | 'unknown';

interface ReservationEvaluation {
  reservation: ModelReservation;
  quota?: ModelQuotaSnapshot;
  status: ReservationStatus;
  reason: string;
}

function buildQuotaWarningDetails(taskId: string, evaluation: ReservationEvaluation): QuotaReservationWarningDetails {
  return {
    kind: 'quota_reservation',
    taskId,
    provider: evaluation.reservation.provider,
    modelId: evaluation.reservation.modelId,
    status: evaluation.status === 'covered' ? 'unknown' : evaluation.status,
    reservationUsageUnit: evaluation.reservation.usageUnit,
    reservationEstimatedCost: evaluation.reservation.estimatedCost,
    ...(evaluation.quota?.displayName ? { displayName: evaluation.quota.displayName } : {}),
    ...(evaluation.quota?.availability ? { quotaAvailability: evaluation.quota.availability } : {}),
    ...(evaluation.quota?.interpretation ? { quotaInterpretation: evaluation.quota.interpretation } : {}),
    ...(evaluation.quota?.usageUnit ? { quotaUsageUnit: evaluation.quota.usageUnit } : {}),
    ...(typeof evaluation.quota?.remaining === 'number' ? { quotaRemaining: evaluation.quota.remaining } : {}),
  };
}

function syncWarning(account: SubscriptionAccount): PlannerWarning | null {
  const message = formatSubscriptionSyncPlannerMessage(account);
  const details = buildSubscriptionSyncWarningDetail(account);
  if (message) {
    return {
      code: 'provider_sync_degraded',
      message,
      details: details ?? undefined,
    };
  }

  return null;
}

function snapshotWarning(account: SubscriptionAccount): PlannerWarning | null {
  const message = formatSnapshotBackedPlannerMessage(account);
  const details = buildSnapshotBackedWarningDetail(account);
  if (message) {
    return {
      code: 'provider_snapshot_only',
      message,
      details: details ?? undefined,
    };
  }

  return null;
}

function findQuota(reservation: ModelReservation, subscriptions: SubscriptionAccount[]): ModelQuotaSnapshot | undefined {
  return subscriptions
    .flatMap((account) => account.quotas)
    .find((snapshot) => snapshot.provider === reservation.provider && snapshot.modelId === reservation.modelId);
}

function isComparableQuota(quota: ModelQuotaSnapshot, reservation: ModelReservation): boolean {
  if (typeof quota.remaining !== 'number') {
    return false;
  }

  if (quota.interpretation === 'percentage_window' || quota.interpretation === 'informational') {
    return false;
  }

  if (quota.usageUnit === 'unknown' || quota.usageUnit !== reservation.usageUnit) {
    return false;
  }

  return true;
}

function formatReservationLabel(reservation: ModelReservation, quota?: ModelQuotaSnapshot): string {
  if (!quota) {
    return `${reservation.provider}/${reservation.modelId}`;
  }

  return `${quota.displayName} (${reservation.provider}/${reservation.modelId})`;
}

function evaluateReservation(
  reservation: ModelReservation,
  subscriptions: SubscriptionAccount[],
): ReservationEvaluation {
  const quota = findQuota(reservation, subscriptions);
  if (!quota) {
    return {
      reservation,
      status: 'missing',
      reason: `${formatReservationLabel(reservation)} has no quota row yet.`,
    };
  }

  if (quota.availability === 'unavailable') {
    return {
      reservation,
      quota,
      status: 'unavailable',
      reason: `${formatReservationLabel(reservation, quota)} is currently unavailable.`,
    };
  }

  if (quota.availability === 'unknown') {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} is reporting unknown availability.`,
    };
  }

  if (quota.interpretation === 'percentage_window') {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} only exposes percentage-window quota data.`,
    };
  }

  if (quota.interpretation === 'informational') {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} only exposes informational quota metadata.`,
    };
  }

  if (typeof quota.remaining !== 'number') {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} does not report remaining ${reservation.usageUnit}.`,
    };
  }

  if (quota.usageUnit === 'unknown') {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} has unknown quota units.`,
    };
  }

  if (quota.usageUnit !== reservation.usageUnit) {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} reports ${quota.usageUnit}, but the task reserves ${reservation.usageUnit}.`,
    };
  }

  if (!isComparableQuota(quota, reservation)) {
    return {
      reservation,
      quota,
      status: 'unknown',
      reason: `${formatReservationLabel(reservation, quota)} cannot be compared directly to the task reservation.`,
    };
  }

  if (quota.remaining >= reservation.estimatedCost) {
    return {
      reservation,
      quota,
      status: 'covered',
      reason: `${formatReservationLabel(reservation, quota)} is covered.`,
    };
  }

  return {
    reservation,
    quota,
    status: 'insufficient',
    reason: `${formatReservationLabel(reservation, quota)} has ${quota.remaining} ${quota.usageUnit} remaining, below the ${reservation.estimatedCost} ${reservation.usageUnit} reservation.`,
  };
}

function reservationEvaluations(task: SwitchboardTask, subscriptions: SubscriptionAccount[]): ReservationEvaluation[] {
  if (!task.reservations || task.reservations.length === 0) {
    return [];
  }

  return task.reservations.map((reservation) => evaluateReservation(reservation, subscriptions));
}

function needsApproval(task: SwitchboardTask): boolean {
  if (!task.approvalRequired || task.approvedAt) {
    return false;
  }

  return task.status === 'queued' || task.status === 'planned';
}

export function planTasks(context: PlannerContext): PlannerResult {
  const runnable: SwitchboardTask[] = [];
  const blocked: SwitchboardTask[] = [];
  const warnings: PlannerWarning[] = context.subscriptions.flatMap((account) => {
    const degraded = syncWarning(account);
    if (degraded) {
      return [degraded];
    }

    const snapshot = snapshotWarning(account);
    return snapshot ? [snapshot] : [];
  });

  for (const task of context.tasks) {
    if (needsApproval(task)) {
      blocked.push(task);
      warnings.push({
        code: 'approval_pending',
        message: `Task ${task.id} requires operator approval before it can move into execution.`,
      });
      continue;
    }

    const evaluations = reservationEvaluations(task, context.subscriptions);
    const statuses = evaluations.map((evaluation) => evaluation.status);

    if (!statuses.every((status) => status === 'covered' || status === 'unknown')) {
      const blockedReservation = evaluations.find((evaluation) => evaluation.status === 'unavailable')
        ?? evaluations.find((evaluation) => evaluation.status !== 'covered' && evaluation.status !== 'unknown');

      blocked.push(task);
      warnings.push({
        code: blockedReservation?.status === 'unavailable' ? 'model_unavailable' : 'quota_low',
        message: blockedReservation?.status === 'unavailable'
          ? `Task ${task.id} is blocked because ${blockedReservation.reason}`
          : `Task ${task.id} cannot be scheduled safely because ${blockedReservation?.reason ?? 'at least one reservation is not fully covered.'}`,
        details: blockedReservation ? buildQuotaWarningDetails(task.id, blockedReservation) : undefined,
      });
      continue;
    }

    if (statuses.includes('unknown')) {
      const advisoryReservation = evaluations.find((evaluation) => evaluation.status === 'unknown');
      warnings.push({
        code: 'quota_unknown',
        message: `Task ${task.id} is using non-comparable or unknown quota data because ${advisoryReservation?.reason ?? 'at least one reservation is not directly comparable.'}`,
        details: advisoryReservation ? buildQuotaWarningDetails(task.id, advisoryReservation) : undefined,
      });
    }

    runnable.push(task);
  }

  return { runnable, blocked, warnings };
}
