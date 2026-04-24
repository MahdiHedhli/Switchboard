import type { BrokerHealthSnapshot } from './types.js';

type BrokerHealthTransport = Pick<BrokerHealthSnapshot, 'protocol' | 'tlsEnabled'>;

export function resolveBrokerProtocol(
  health: Partial<BrokerHealthTransport> | null | undefined,
): BrokerHealthSnapshot['protocol'] {
  if (health?.protocol === 'https') {
    return 'https';
  }

  if (health?.protocol === 'http') {
    return 'http';
  }

  return health?.tlsEnabled ? 'https' : 'http';
}

export function resolveBrokerTlsEnabled(
  health: Partial<BrokerHealthTransport> | null | undefined,
): boolean {
  if (typeof health?.tlsEnabled === 'boolean') {
    return health.tlsEnabled;
  }

  return resolveBrokerProtocol(health) === 'https';
}
