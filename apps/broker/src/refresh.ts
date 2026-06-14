import type { ProviderRefreshSummary } from '@switchboard/core';
import { summarizeProviderAccountContext, summarizeProviderSyncAccounts } from '@switchboard/core';
import type { ProviderRefreshResult } from './adapters/types.js';

export function buildProviderRefreshSummary(result: ProviderRefreshResult): ProviderRefreshSummary {
  const accountContext = summarizeProviderAccountContext(result.subscriptions);
  const syncSummary = summarizeProviderSyncAccounts(result.subscriptions);

  return {
    provider: result.provider,
    kind: result.kind,
    refreshedAt: result.refreshedAt,
    accounts: result.subscriptions.length,
    ...accountContext,
    ...syncSummary,
  };
}
