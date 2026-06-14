import type { ProjectRefreshSnapshot, ProjectStateSnapshot } from '@switchboard/core';
import type { ProviderRefreshResult } from './adapters/types.js';
import { buildDashboardSnapshot } from './dashboard.js';
import { buildProviderRefreshSummary } from './refresh.js';

export function buildProjectRefreshSnapshot(
  snapshot: ProjectStateSnapshot,
  results: ProviderRefreshResult[],
): ProjectRefreshSnapshot {
  return {
    dashboard: buildDashboardSnapshot(snapshot),
    refresh: results.map((result) => buildProviderRefreshSummary(result)),
  };
}
