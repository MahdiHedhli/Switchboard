export function summarizeCodexAppServerError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('failed to fetch codex rate limits')) {
    return 'usage endpoint unavailable';
  }

  if (message.includes('timed out')) {
    return 'timed out';
  }

  if (message.includes('Failed to start Codex app-server')) {
    return 'app-server unavailable';
  }

  if (message.includes('invalid JSON')) {
    return 'invalid app-server response';
  }

  return 'unavailable';
}

export function codexAppServerErrorState(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('failed to fetch codex rate limits')) {
    return 'usage_endpoint_unavailable';
  }

  if (message.includes('timed out')) {
    return 'timed_out';
  }

  if (message.includes('Failed to start Codex app-server')) {
    return 'app_server_unavailable';
  }

  if (message.includes('invalid JSON')) {
    return 'invalid_response';
  }

  return 'unavailable';
}

export function extractCodexAppServerEndpoint(error) {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\((https:\/\/[^)]+)\)/.exec(message);
  return match?.[1];
}

export function extractCodexAppServerHost(error) {
  const endpoint = extractCodexAppServerEndpoint(error);
  if (!endpoint) {
    return undefined;
  }

  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}
