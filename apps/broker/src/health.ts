import type { BrokerHealthSnapshot } from '@switchboard/core';
import type { BrokerAuthPolicy } from './auth-policy.js';
import type { BrokerRuntimeSummary } from './runtime-config.js';

export function buildBrokerHealthSnapshot(
  authPolicy: BrokerAuthPolicy,
  runtime?: Pick<BrokerRuntimeSummary, 'protocol' | 'tlsEnabled' | 'operatorTokenSource' | 'operatorTokenFile' | 'operatorTokenProblem'>,
): BrokerHealthSnapshot {
  return {
    status: 'ok',
    service: 'switchboard-broker',
    localOnly: authPolicy.localOnly,
    operatorTokenRequired: authPolicy.operatorTokenConfigured,
    protocol: runtime?.protocol ?? 'http',
    tlsEnabled: runtime?.tlsEnabled ?? false,
    auth: {
      ...authPolicy.summary(),
      ...(runtime?.operatorTokenSource ? { operatorTokenSource: runtime.operatorTokenSource } : {}),
      ...(runtime?.operatorTokenFile ? { operatorTokenFile: runtime.operatorTokenFile } : {}),
      ...(runtime?.operatorTokenProblem ? { operatorTokenProblem: runtime.operatorTokenProblem } : {}),
    },
  };
}
