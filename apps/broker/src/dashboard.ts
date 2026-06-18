import type {
  ModelCatalogEntry,
  ProjectDashboardSnapshot,
  ProjectStateSnapshot,
  ProviderId,
} from '@switchboard/core';
import { buildProviderDashboardSummaries } from '@switchboard/core';
import { planTasks } from './planner.js';
import { selectModels } from './selector.js';

/**
 * Routable catalog passed to the dashboard so the selector can resolve
 * task-classes before the planner validates coverage. `active` holds normalized
 * routable rows (`normalizeCatalog(file).active`); `placeholders` lists excluded
 * rows for the selector's `selection_placeholder_skipped` hint. Optional: when
 * omitted the selector runs over an empty catalog and is a structural no-op, so
 * tasks with no task-class/pin and tasks with explicit reservations pass through
 * to the planner byte-for-byte unchanged.
 */
export interface DashboardCatalog {
  active: ModelCatalogEntry[];
  placeholders?: Array<{ provider: ProviderId; modelId: string }>;
}

export function buildDashboardSnapshot(
  snapshot: ProjectStateSnapshot,
  catalog?: DashboardCatalog,
): ProjectDashboardSnapshot {
  // Selection runs as a discrete stage BEFORE planTasks: it resolves declared
  // task-classes / pins into reservations, then the existing planner validates
  // coverage on the resulting tasks, completely unchanged.
  const selection = selectModels({
    project: snapshot.profile,
    subscriptions: snapshot.subscriptions,
    tasks: snapshot.tasks,
    catalog: catalog?.active ?? [],
    placeholders: catalog?.placeholders ?? [],
  });

  return {
    ...snapshot,
    plan: planTasks({
      project: snapshot.profile,
      subscriptions: snapshot.subscriptions,
      tasks: selection.tasks,
    }),
    providerSummaries: buildProviderDashboardSummaries(snapshot.subscriptions),
    // Surface selection-stage warnings for operators. This is purely additive:
    // the planner above runs on selection.tasks exactly as before, so plan
    // output stays byte-for-byte identical.
    selectionWarnings: selection.warnings,
    // Surface the routable catalog (active + placeholder rows) read-only so the
    // dashboard UI can show provider/modelId, tier, and active|placeholder
    // status. Purely informational; selection above still routes only on
    // `active` rows.
    catalog: {
      active: catalog?.active ?? [],
      placeholders: catalog?.placeholders ?? [],
    },
  };
}
