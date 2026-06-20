/* "Quota refresh" panel: one card per provider adapter with its sync summary,
 * drift/coverage warnings, and a token-gated refresh button. */
import {
  formatProviderAdapterLaunchDriftWarning,
  formatProviderSyncQuotaCoverageMessage,
  formatProviderSyncSummaryDisplayMessage,
  formatProviderSyncSummaryPills,
  isProviderSyncSummaryAdvisory,
} from '@switchboard/core';
import type { ProjectDashboardSnapshot } from '@switchboard/core';
import type { AdapterStatus } from '../lib/format';
import { formatAdapterStatus, formatTimestamp, isAdapterAdvisory } from '../lib/format';

type QuotaRefreshPanelProps = {
  adapterStatuses: AdapterStatus[];
  providerSummaries: ProjectDashboardSnapshot['providerSummaries'];
  isLoading: boolean;
  refreshingProvider: string | null;
  canRefreshSubscriptions: boolean;
  onRefreshProvider: (provider: string) => void;
};

export function QuotaRefreshPanel({
  adapterStatuses,
  providerSummaries,
  isLoading,
  refreshingProvider,
  canRefreshSubscriptions,
  onRefreshProvider,
}: QuotaRefreshPanelProps) {
  return (
    <section className="panel">
      <h2>Quota refresh</h2>
      <div className="stack">
        {adapterStatuses.length === 0 && !isLoading ? <p className="muted">No provider adapters are configured for this profile yet.</p> : null}
        {adapterStatuses.map((adapter) => {
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
                  onClick={() => onRefreshProvider(adapter.provider)}
                >
                  {refreshingProvider === adapter.provider ? 'Refreshing…' : `Refresh ${adapter.provider}`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
