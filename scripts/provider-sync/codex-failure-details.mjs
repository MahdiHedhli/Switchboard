import {
  extractCodexAppServerHost,
  summarizeCodexAppServerError,
} from './codex-app-server-diagnostics.mjs';

function asMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function sanitizeCodexAppServerFailureDetail(error) {
  const message = asMessage(error);
  const status = summarizeCodexAppServerError(message);
  const host = extractCodexAppServerHost(message);

  if (message.includes('Codex app-server doctor expected rate limits but found ')) {
    return message;
  }

  if (host) {
    return `${status} via ${host}`;
  }

  if (message.includes('Codex app-server could not start.')) {
    return 'Codex app-server could not start.';
  }

  if (message.includes('timed out')) {
    return 'Codex app-server timed out.';
  }

  if (message.includes('invalid JSON')) {
    return 'Codex app-server returned invalid JSON.';
  }

  if (message.includes('Failed to start Codex app-server')) {
    return 'Codex app-server could not start.';
  }

  return 'Codex app-server unavailable.';
}

export function sanitizeCodexSyncFailureDetail(error) {
  const message = asMessage(error);

  if (message.includes('Codex doctor expected full app-server rate limits but found ')) {
    return message;
  }

  if (message.includes('Codex CLI could not start.')) {
    return 'Codex CLI could not start.';
  }

  if (message.includes('timed out')) {
    return 'Codex CLI timed out.';
  }

  if (message.includes('Failed to parse Codex sync JSON output') || message.includes('Codex sync returned invalid JSON.')) {
    return 'Codex sync returned invalid JSON.';
  }

  if (message.includes('Codex sync returned no OpenAI accounts.')) {
    return 'Codex sync returned no OpenAI accounts.';
  }

  if (message.includes('Failed to start Codex CLI')) {
    return 'Codex CLI could not start.';
  }

  return 'Codex sync failed. Review Codex sync diagnostics for details.';
}

export function codexSyncFailureState(error) {
  const message = asMessage(error);

  if (message.includes('Codex CLI could not start.') || message.includes('Failed to start Codex CLI')) {
    return 'cli_unavailable';
  }

  if (message.includes('timed out')) {
    return 'timed_out';
  }

  if (message.includes('Failed to parse Codex sync JSON output') || message.includes('Codex sync returned invalid JSON.')) {
    return 'invalid_sync_output';
  }

  if (message.includes('Codex sync returned no OpenAI accounts.')) {
    return 'no_accounts';
  }

  return 'failed';
}
