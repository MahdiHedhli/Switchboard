/*
 * Copyright 2026 Mahdi Hedhli
 *
 * Licensed under the Apache License, Version 2.0.
 */

import type {
  CostBasisStrategy,
  ModelCatalogEntry,
  ModelQuotaSnapshot,
  ModelReservation,
  ProviderId,
  SelectionContext,
  SelectionResult,
  SelectionWarning,
  SubscriptionAccount,
  SwitchboardTask,
  TaskClass,
  UsageUnit,
} from '@switchboard/core';
import { DEFAULT_SELECTION_POLICY, TIER_RANK, tierClearsFloor } from '@switchboard/core';

/**
 * Units a freshly-stamped reservation claims against the chosen model's quota.
 * The selector answers "who should do this", not "how much will it consume":
 * the spec carries no per-task consumption estimate, so a selector/pin
 * reservation claims a single unit in the model's own usage unit. This is an
 * operational default, NOT a catalog cost — no tier or price is ever fabricated.
 */
export const DEFAULT_SELECTION_UNITS = 1;

/**
 * Weight applied to a subscription's fill ratio under the scarcity-preserving
 * policy. With weight 1, a fully-spent premium subscription (remaining -> 0) is
 * penalised by ~1 cost unit — enough for a cheaper capable API model to win
 * before the subscription is exhausted. `subscription-first` ignores scarcity.
 */
export const SCARCITY_WEIGHT = 1;

interface Candidate {
  entry: ModelCatalogEntry;
  quota: ModelQuotaSnapshot;
  effectiveCost: number;
}

function findQuota(
  provider: ProviderId,
  modelId: string,
  subscriptions: SubscriptionAccount[],
): ModelQuotaSnapshot | undefined {
  return subscriptions
    .flatMap((account) => account.quotas)
    .find((q) => q.provider === provider && q.modelId === modelId);
}

function reservationUsageUnit(
  quota: ModelQuotaSnapshot | undefined,
  entry?: ModelCatalogEntry,
): UsageUnit {
  if (quota && quota.usageUnit !== 'unknown') {
    return quota.usageUnit;
  }
  if (entry && entry.pricing.authMode === 'api') {
    return entry.pricing.unit;
  }
  if (quota) {
    return quota.usageUnit;
  }
  return 'requests';
}

/** Marginal cost basis for ranking: subscription rows are 0, API rows cost per unit. */
function baseCost(entry: ModelCatalogEntry): number {
  return entry.pricing.authMode === 'api' ? entry.pricing.costPerUnit : 0;
}

/**
 * Progressive deprioritisation of a near-exhausted subscription. Applies ONLY
 * under the scarcity-preserving policy, only to subscription rows, and only
 * when the quota exposes a comparable numeric limit + remaining. Range
 * [0, SCARCITY_WEIGHT].
 */
function scarcityPenalty(
  entry: ModelCatalogEntry,
  quota: ModelQuotaSnapshot,
  strategy: CostBasisStrategy,
): number {
  if (strategy !== 'subscription-first-scarcity-preserving') {
    return 0;
  }
  if (entry.pricing.authMode !== 'subscription') {
    return 0;
  }
  if (typeof quota.limit !== 'number' || typeof quota.remaining !== 'number' || quota.limit <= 0) {
    return 0;
  }
  const fill = Math.min(Math.max(quota.remaining / quota.limit, 0), 1);
  return (1 - fill) * SCARCITY_WEIGHT;
}

/**
 * Deterministic ordering when effectiveCost ties: more-capable tier first, then
 * provider, then modelId. Guarantees a stable pick regardless of input order.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.effectiveCost !== b.effectiveCost) {
    return a.effectiveCost - b.effectiveCost;
  }
  const tierDelta = TIER_RANK[a.entry.tier] - TIER_RANK[b.entry.tier];
  if (tierDelta !== 0) {
    return tierDelta;
  }
  if (a.entry.provider !== b.entry.provider) {
    return a.entry.provider < b.entry.provider ? -1 : 1;
  }
  if (a.entry.modelId !== b.entry.modelId) {
    return a.entry.modelId < b.entry.modelId ? -1 : 1;
  }
  return 0;
}

function pinReservation(
  pin: { provider: ProviderId; modelId: string },
  subscriptions: SubscriptionAccount[],
  catalog: ModelCatalogEntry[],
): ModelReservation {
  const quota = findQuota(pin.provider, pin.modelId, subscriptions);
  const entry = catalog.find((e) => e.provider === pin.provider && e.modelId === pin.modelId);
  return {
    provider: pin.provider,
    modelId: pin.modelId,
    estimatedCost: DEFAULT_SELECTION_UNITS,
    usageUnit: reservationUsageUnit(quota, entry),
    reason: `Pinned by operator (modelPin) to ${pin.provider}/${pin.modelId}; selection bypassed.`,
    source: 'pin',
  };
}

/**
 * Resolve each task's declared class (or pin) into a concrete ModelReservation,
 * BEFORE the planner validates coverage. The selector never mutates its inputs
 * and never touches a task that already carries a reservation, has no pin, and
 * declares no task-class — that task passes through byte-for-byte.
 *
 * Per-task precedence: existing reservation -> modelPin (source:'pin') ->
 * task-class selection (source:'selector') -> untouched.
 */
export function selectModels(
  context: SelectionContext,
  policyOverride?: CostBasisStrategy,
): SelectionResult {
  const profilePolicy: CostBasisStrategy =
    policyOverride ?? context.project.selectionPolicy ?? DEFAULT_SELECTION_POLICY;
  const taskClasses = new Map<string, TaskClass>(
    (context.project.taskClasses ?? []).map((tc) => [tc.id, tc]),
  );
  const activeCatalog = context.catalog.filter((entry) => entry.status === 'active');
  const placeholders = context.placeholders ?? [];

  const warnings: SelectionWarning[] = [];
  const tasks: SwitchboardTask[] = context.tasks.map((task) => {
    // Precedence 1: an existing reservation is authoritative — untouched.
    if (task.reservations && task.reservations.length > 0) {
      return task;
    }

    // Precedence 2: an explicit pin bypasses selection.
    if (task.modelPin) {
      return {
        ...task,
        reservations: [pinReservation(task.modelPin, context.subscriptions, activeCatalog)],
      };
    }

    // Precedence 3: resolve a declared task-class.
    if (task.taskClass) {
      const taskClass = taskClasses.get(task.taskClass);
      if (!taskClass) {
        warnings.push({
          code: 'selection_unresolved',
          taskId: task.id,
          taskClass: task.taskClass,
          message: `Task ${task.id} declares unknown task-class "${task.taskClass}"; left unresolved.`,
        });
        return task;
      }

      // A class with no minimumTier needs no model — skipped entirely.
      if (!taskClass.minimumTier) {
        return task;
      }

      const floor = taskClass.minimumTier;
      const strategy = taskClass.selectionPolicyOverride ?? profilePolicy;

      const candidates: Candidate[] = [];
      for (const entry of activeCatalog) {
        if (!tierClearsFloor(entry.tier, floor)) {
          continue;
        }
        const quota = findQuota(entry.provider, entry.modelId, context.subscriptions);
        if (!quota || quota.availability === 'unavailable') {
          continue;
        }
        candidates.push({
          entry,
          quota,
          effectiveCost: baseCost(entry) + scarcityPenalty(entry, quota, strategy),
        });
      }

      if (candidates.length === 0) {
        if (placeholders.length > 0) {
          warnings.push({
            code: 'selection_placeholder_skipped',
            taskId: task.id,
            taskClass: task.taskClass,
            excluded: placeholders.map((p) => ({ provider: p.provider, modelId: p.modelId })),
            message: `Task ${task.id} (class "${task.taskClass}", floor ${floor}) has no active candidate; ${placeholders.length} placeholder row(s) were skipped. Activate a capable row to route it.`,
          });
        } else {
          warnings.push({
            code: 'selection_unresolved',
            taskId: task.id,
            taskClass: task.taskClass,
            message: `Task ${task.id} (class "${task.taskClass}", floor ${floor}) has no active model that clears the tier floor and is available.`,
          });
        }
        return task;
      }

      candidates.sort(compareCandidates);
      const winner = candidates[0];
      const reservation: ModelReservation = {
        provider: winner.entry.provider,
        modelId: winner.entry.modelId,
        estimatedCost: DEFAULT_SELECTION_UNITS,
        usageUnit: reservationUsageUnit(winner.quota, winner.entry),
        reason: `Selected for task-class "${task.taskClass}" (floor ${floor}, policy ${strategy}): cheapest capable available model.`,
        source: 'selector',
      };
      return { ...task, reservations: [reservation] };
    }

    // Precedence 4: nothing declared — untouched.
    return task;
  });

  return { tasks, warnings };
}
