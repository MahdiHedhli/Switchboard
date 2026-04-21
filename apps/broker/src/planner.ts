import type { PlannerContext, SubscriptionAccount, SwitchboardTask } from '@switchboard/core';

export interface PlannerWarning {
  code: 'quota_unknown' | 'quota_low' | 'model_unavailable';
  message: string;
}

export interface PlannerResult {
  runnable: SwitchboardTask[];
  blocked: SwitchboardTask[];
  warnings: PlannerWarning[];
}

function hasReservationCoverage(task: SwitchboardTask, subscriptions: SubscriptionAccount[]): boolean {
  if (!task.reservations || task.reservations.length === 0) return true;

  return task.reservations.every((reservation) => {
    const quota = subscriptions
      .flatMap((account) => account.quotas)
      .find((snapshot) => snapshot.provider === reservation.provider && snapshot.modelId === reservation.modelId);

    if (!quota) return false;
    if (quota.availability === 'unavailable') return false;
    if (typeof quota.remaining !== 'number') return true;

    return quota.remaining >= reservation.estimatedCost;
  });
}

export function planTasks(context: PlannerContext): PlannerResult {
  const runnable: SwitchboardTask[] = [];
  const blocked: SwitchboardTask[] = [];
  const warnings: PlannerWarning[] = [];

  for (const task of context.tasks) {
    if (!hasReservationCoverage(task, context.subscriptions)) {
      blocked.push(task);
      warnings.push({
        code: 'quota_low',
        message: `Task ${task.id} cannot be scheduled safely with current model reservations.`,
      });
      continue;
    }

    if (task.reservations?.some((reservation) => {
      const quota = context.subscriptions
        .flatMap((account) => account.quotas)
        .find((snapshot) => snapshot.provider === reservation.provider && snapshot.modelId === reservation.modelId);
      return !quota || quota.availability === 'unknown';
    })) {
      warnings.push({
        code: 'quota_unknown',
        message: `Task ${task.id} is using at least one model with unknown or manually entered quota data.`,
      });
    }

    runnable.push(task);
  }

  return { runnable, blocked, warnings };
}
