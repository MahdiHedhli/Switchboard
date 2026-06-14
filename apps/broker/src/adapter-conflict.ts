import { AdapterRefreshError } from './adapters/types.js';

const trustedCommandPrefix = /^Trusted provider sync command for "([^"]+)"/;

function extractTrustedCommandProvider(message: string): string | null {
  return trustedCommandPrefix.exec(message)?.[1] ?? null;
}

function trustedCommandLabel(provider: string | null): string {
  return provider
    ? `Trusted provider sync command for "${provider}"`
    : 'Trusted provider sync command';
}

function sanitizeCommandFailureDetail(message: string): string {
  const provider = extractTrustedCommandProvider(message);
  const label = trustedCommandLabel(provider);

  if (message.includes('did not return valid JSON')) {
    return `${label} did not return valid JSON.`;
  }

  if (message.includes('returned invalid data')) {
    return `${label} returned invalid data.`;
  }

  if (message.includes('could not start')) {
    return `${label} could not start.`;
  }

  if (message.includes('exceeded')) {
    return `${label} exceeded the broker output limit.`;
  }

  return `${label} failed. Review provider sync diagnostics for details.`;
}

export function buildAdapterRefreshConflictDetail(error: AdapterRefreshError): string {
  if (error.code === 'command_failed') {
    return sanitizeCommandFailureDetail(error.message);
  }

  return error.message;
}
