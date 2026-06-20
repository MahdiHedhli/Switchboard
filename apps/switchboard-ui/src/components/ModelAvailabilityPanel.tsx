/* "Model availability" panel: one card per subscription account with sync/coverage
 * warnings and per-quota budget windows. */
import { formatQuotaCoverageMessage } from '@switchboard/core';
import type { ProjectDashboardSnapshot } from '@switchboard/core';
import {
  formatAccountSyncWarning,
  formatQuotaBudget,
  formatQuotaPills,
  formatQuotaUsage,
  formatSignal,
  formatTimestamp,
  resolveQuotaWindows,
} from '../lib/format';

type ModelAvailabilityPanelProps = {
  subscriptions: ProjectDashboardSnapshot['subscriptions'];
  isLoading: boolean;
};

export function ModelAvailabilityPanel({ subscriptions, isLoading }: ModelAvailabilityPanelProps) {
  return (
    <section className="panel">
      <h2>Model availability</h2>
      <div className="stack">
        {isLoading ? <p className="muted">Loading broker-backed subscriptions…</p> : null}
        {!isLoading && subscriptions.length === 0 ? <p className="muted">No subscription snapshots available yet.</p> : null}
        {subscriptions.map((account) => {
          const syncWarning = formatAccountSyncWarning(account);
          const quotaCoverageMessage = formatQuotaCoverageMessage(account.quotas);

          return (
            <article className="card" key={account.id}>
              <h3>{account.displayName}</h3>
              <p className="muted">{account.provider} · {account.authMode}</p>
              <p className="muted">
                sync: {account.syncMethod ?? 'unknown'}
                {account.lastRefreshedAt ? ` · refreshed ${formatTimestamp(account.lastRefreshedAt)}` : ''}
              </p>
              {account.signals?.length ? (
                <div className="account-signals">
                  {account.signals.map((signal) => (
                    <span className="signal-pill" key={`${account.id}-${signal.id}`}>
                      {formatSignal(signal)}
                    </span>
                  ))}
                </div>
              ) : null}
              {syncWarning ? <p className="warning-text">{syncWarning}</p> : null}
              {quotaCoverageMessage ? <p className="warning-text">{quotaCoverageMessage}</p> : null}
              {account.quotas.map((quota) => {
                const quotaWindows = resolveQuotaWindows(quota);

                return (
                  <div className="quota-stack" key={`${quota.provider}-${quota.modelId}`}>
                    <div className="quota-row">
                      <span>{quota.displayName}</span>
                      <span>{quota.availability}</span>
                      <span>{formatQuotaBudget(quota)}</span>
                    </div>
                    <div className="account-signals quota-signals">
                      {formatQuotaPills(quota).map((pill) => (
                        <span className="signal-pill" key={`${quota.provider}-${quota.modelId}-${pill}`}>
                          {pill}
                        </span>
                      ))}
                    </div>
                    {quotaWindows.length > 0 ? (
                      <div className="quota-window-list">
                        {quotaWindows.map((window) => (
                          <div className="quota-window" key={`${quota.provider}-${quota.modelId}-${window.id}`}>
                            <div className="quota-row quota-window-row">
                              <span>{window.label}</span>
                              <span>{formatQuotaBudget({
                                remaining: window.remaining,
                                interpretation: window.interpretation,
                                usageUnit: quota.usageUnit,
                              })}</span>
                            </div>
                            <div className="quota-meta">
                              {formatQuotaUsage(window, window.label.toLowerCase()) ? (
                                <span>{formatQuotaUsage(window, window.label.toLowerCase())}</span>
                              ) : null}
                              {window.resetAt ? <span>resets {formatTimestamp(window.resetAt)}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="quota-meta">
                        {formatQuotaUsage(quota) ? <span>{formatQuotaUsage(quota)}</span> : null}
                        {quota.resetAt ? <span>resets {formatTimestamp(quota.resetAt)}</span> : null}
                      </div>
                    )}
                    {quota.notes ? <p className="muted quota-note">{quota.notes}</p> : null}
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
    </section>
  );
}
