import type { ProjectRefreshSnapshot, ProjectStateSnapshot } from '@switchboard/core';
import type { ProviderRefreshResult } from './adapters/types.js';
import { buildDashboardSnapshot, type DashboardCatalog } from './dashboard.js';
import { buildProviderRefreshSummary } from './refresh.js';

export function buildProjectRefreshSnapshot(
  snapshot: ProjectStateSnapshot,
  results: ProviderRefreshResult[],
  catalog?: DashboardCatalog,
): ProjectRefreshSnapshot {
  return {
    dashboard: buildDashboardSnapshot(snapshot, catalog),
    refresh: results.map((result) => buildProviderRefreshSummary(result)),
  };
}
