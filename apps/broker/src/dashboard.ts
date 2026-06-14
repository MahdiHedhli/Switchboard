import type { ProjectDashboardSnapshot, ProjectStateSnapshot } from '@switchboard/core';
import { buildProviderDashboardSummaries } from '@switchboard/core';
import { planTasks } from './planner.js';

export function buildDashboardSnapshot(snapshot: ProjectStateSnapshot): ProjectDashboardSnapshot {
  return {
    ...snapshot,
    plan: planTasks({
      project: snapshot.profile,
      subscriptions: snapshot.subscriptions,
      tasks: snapshot.tasks,
    }),
    providerSummaries: buildProviderDashboardSummaries(snapshot.subscriptions),
  };
}
