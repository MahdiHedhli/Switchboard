/*
 * Operator-token persistence for the dashboard. The token only gates browser
 * mutations; it is optionally remembered in localStorage with a 24h TTL and is
 * cleared on expiry or malformed storage. Pure module — no React, no DOM beyond
 * the guarded `window.localStorage` access — so it is unit-testable in isolation.
 */
export const operatorTokenStorageKey = 'switchboard.operatorToken';
export const operatorTokenTtlMs = 24 * 60 * 60 * 1000;

export type StoredOperatorTokenState = {
  value: string;
  expiresAt: string | null;
  remembered: boolean;
};

export function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function clearStoredOperatorToken(): void {
  if (!hasBrowserStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(operatorTokenStorageKey);
  } catch {
    // Ignore storage errors and fall back to in-memory state.
  }
}

export function readStoredOperatorToken(nowMs = Date.now()): StoredOperatorTokenState {
  if (!hasBrowserStorage()) {
    return {
      value: '',
      expiresAt: null,
      remembered: false,
    };
  }

  try {
    const rawValue = window.localStorage.getItem(operatorTokenStorageKey);
    if (!rawValue) {
      return {
        value: '',
        expiresAt: null,
        remembered: false,
      };
    }

    const parsed = JSON.parse(rawValue) as { value?: unknown; expiresAt?: unknown };
    if (typeof parsed.value !== 'string' || typeof parsed.expiresAt !== 'string') {
      clearStoredOperatorToken();
      return {
        value: '',
        expiresAt: null,
        remembered: false,
      };
    }

    const expiresAtMs = Date.parse(parsed.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      clearStoredOperatorToken();
      return {
        value: '',
        expiresAt: null,
        remembered: false,
      };
    }

    return {
      value: parsed.value,
      expiresAt: parsed.expiresAt,
      remembered: true,
    };
  } catch {
    clearStoredOperatorToken();
    return {
      value: '',
      expiresAt: null,
      remembered: false,
    };
  }
}

export function buildOperatorTokenState(value: string, remember: boolean, nowMs = Date.now()): StoredOperatorTokenState {
  const normalized = value.trim();
  if (!normalized) {
    clearStoredOperatorToken();
    return {
      value: '',
      expiresAt: null,
      remembered: false,
    };
  }

  if (!remember || !hasBrowserStorage()) {
    clearStoredOperatorToken();
    return {
      value,
      expiresAt: null,
      remembered: false,
    };
  }

  const expiresAt = new Date(nowMs + operatorTokenTtlMs).toISOString();

  try {
    window.localStorage.setItem(operatorTokenStorageKey, JSON.stringify({
      value,
      expiresAt,
    }));
    return {
      value,
      expiresAt,
      remembered: true,
    };
  } catch {
    return {
      value,
      expiresAt: null,
      remembered: false,
    };
  }
}
