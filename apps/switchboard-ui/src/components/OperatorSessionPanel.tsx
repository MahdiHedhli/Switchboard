/* "Operator session" panel: broker transport/exposure posture, the operator
 * token field (+ remember-for-24h), token source/problems, and the per-scope
 * mutation policy grid. */
import type { BrokerAuthSummary } from '@switchboard/core';
import { authScopeLabels } from '../lib/constants';
import { formatBrokerTokenSource, formatRequirement, formatTimestamp } from '../lib/format';

type OperatorSessionPanelProps = {
  authSummary: BrokerAuthSummary | null;
  operatorTokenRequired: boolean;
  brokerTlsEnabled: boolean;
  brokerTransportLabel: string;
  operatorToken: string;
  operatorTokenExpiresAt: string | null;
  operatorTokenRemembered: boolean;
  onTokenChange: (value: string) => void;
  onRememberedChange: (remembered: boolean) => void;
};

export function OperatorSessionPanel({
  authSummary,
  operatorTokenRequired,
  brokerTlsEnabled,
  brokerTransportLabel,
  operatorToken,
  operatorTokenExpiresAt,
  operatorTokenRemembered,
  onTokenChange,
  onRememberedChange,
}: OperatorSessionPanelProps) {
  return (
    <section className="panel">
      <h2>Operator session</h2>
      <div className="stack">
        <p className="muted">
          {authSummary
            ? authSummary.localOnly
              ? brokerTlsEnabled
                ? 'This broker is loopback-only and serving HTTPS. Mutation routes require an operator token unless the explicit dev-only open-loopback escape hatch is enabled.'
                : 'This broker is loopback-only over HTTP. Mutation routes require an operator token unless the explicit dev-only open-loopback escape hatch is enabled.'
              : brokerTlsEnabled
                ? 'This broker is prepared for non-local exposure over HTTPS. Keep it behind trusted network controls and token-gated mutation routes.'
                : 'This broker is prepared for non-local exposure but is not serving HTTPS. Fix transport security before trusting remote access.'
            : operatorTokenRequired
              ? 'This broker currently requires an operator token for task and quota mutations.'
              : 'Operator token policy is not available yet.'}
        </p>
        {authSummary ? (
          <div className="account-signals">
            <span className="signal-pill">{brokerTransportLabel}</span>
            <span className="signal-pill">{brokerTlsEnabled ? 'TLS enabled' : 'no TLS'}</span>
            <span className="signal-pill">
              {authSummary.localOnly ? 'loopback-only' : 'remote-capable'}
            </span>
          </div>
        ) : null}
        <label className="field">
          <span>Operator token</span>
          <input
            className="input"
            type="password"
            value={operatorToken}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder={
              authSummary?.operatorTokenConfigured
                ? `Required in ${authSummary.operatorTokenHeader}`
                : 'Optional until token enforcement is enabled'
            }
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={operatorTokenRemembered}
            onChange={(event) => onRememberedChange(event.target.checked)}
          />
          <span>Remember token in this browser for 24 hours</span>
        </label>
        {operatorTokenExpiresAt ? (
          <p className="muted">
            Saved in this browser until {formatTimestamp(operatorTokenExpiresAt)}.
          </p>
        ) : operatorToken ? (
          <p className="muted">
            Token is held in this session only.
          </p>
        ) : null}
        {authSummary && formatBrokerTokenSource(authSummary) ? (
          <p className="muted">
            Broker token source: {formatBrokerTokenSource(authSummary)}.
          </p>
        ) : null}
        {authSummary?.operatorTokenProblem ? (
          <p className="warning-text">
            Broker token wiring: {authSummary.operatorTokenProblem}
          </p>
        ) : null}
        {operatorToken ? (
          <p className="muted">
            This UI token only affects browser mutations. Shell-based `doctor:*` and `preflight` checks still read
            `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE`.
          </p>
        ) : null}
        {authSummary ? (
          <div className="policy-grid">
            {authScopeLabels.map((scope) => (
              <article className="policy-row" key={scope.key}>
                <div className="policy-heading">
                  <strong>{scope.label}</strong>
                  <span className={`policy-chip policy-${authSummary.scopes[scope.key].requirement}`}>
                    {formatRequirement(authSummary.scopes[scope.key].requirement)}
                  </span>
                </div>
                <p className="muted policy-detail">{authSummary.scopes[scope.key].detail}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
