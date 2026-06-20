import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildOperatorTokenState,
  operatorTokenTtlMs,
  readStoredOperatorToken,
} from '../src/lib/operator-token';
import {
  canUseScope,
  formatQuotaBudget,
  formatRequirement,
  getAdapterStatus,
} from '../src/lib/format';

// These pure modules were extracted from the App monolith so they could be
// unit-tested in isolation (jsdom supplies localStorage for the token module).

describe('operator-token storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('treats a blank token as cleared, not remembered', () => {
    const state = buildOperatorTokenState('   ', true);
    expect(state).toEqual({ value: '', expiresAt: null, remembered: false });
    expect(window.localStorage.getItem('switchboard.operatorToken')).toBeNull();
  });

  it('keeps a token in-session only when remember is off', () => {
    const state = buildOperatorTokenState('tok', false);
    expect(state.value).toBe('tok');
    expect(state.expiresAt).toBeNull();
    expect(state.remembered).toBe(false);
    expect(window.localStorage.getItem('switchboard.operatorToken')).toBeNull();
  });

  it('persists a remembered token with a 24h expiry and reads it back before expiry', () => {
    const base = 1_000_000;
    const saved = buildOperatorTokenState('tok', true, base);
    expect(saved.remembered).toBe(true);
    expect(saved.expiresAt).toBe(new Date(base + operatorTokenTtlMs).toISOString());

    const justBefore = readStoredOperatorToken(base + operatorTokenTtlMs - 1);
    expect(justBefore).toEqual({ value: 'tok', expiresAt: saved.expiresAt, remembered: true });
  });

  it('drops and clears a remembered token once it has expired', () => {
    const base = 1_000_000;
    buildOperatorTokenState('tok', true, base);

    const afterExpiry = readStoredOperatorToken(base + operatorTokenTtlMs + 1);
    expect(afterExpiry).toEqual({ value: '', expiresAt: null, remembered: false });
    expect(window.localStorage.getItem('switchboard.operatorToken')).toBeNull();
  });
});

describe('formatQuotaBudget', () => {
  it('reports an unknown budget when remaining is absent and the unit is unusable', () => {
    expect(formatQuotaBudget({ remaining: undefined, interpretation: 'percentage_window' })).toBe('unknown budget');
    expect(formatQuotaBudget({ remaining: undefined, usageUnit: 'unknown' })).toBe('unknown budget');
  });

  it('names the unit when remaining is absent but the unit is known', () => {
    expect(formatQuotaBudget({ remaining: undefined, usageUnit: 'credits' })).toBe('unknown credits');
  });

  it('formats percentage windows and absolute budgets', () => {
    expect(formatQuotaBudget({ remaining: 50, interpretation: 'percentage_window' })).toBe('50% remaining');
    expect(formatQuotaBudget({ remaining: 50, usageUnit: 'credits' })).toBe('50 credits');
  });
});

describe('getAdapterStatus', () => {
  it('prefers an explicit status', () => {
    expect(getAdapterStatus({ status: 'ready_with_advisories' })).toBe('ready_with_advisories');
  });

  it('derives status from configuration / security / advisories', () => {
    expect(getAdapterStatus({ configured: false })).toBe('missing');
    expect(getAdapterStatus({ secure: false })).toBe('insecure');
    expect(getAdapterStatus({ advisoryCodes: ['x'] })).toBe('ready_with_advisories');
    expect(getAdapterStatus({})).toBe('ready');
  });
});

describe('formatRequirement', () => {
  it('maps requirements to short labels', () => {
    expect(formatRequirement('open')).toBe('open');
    expect(formatRequirement('operator_token')).toBe('token');
    expect(formatRequirement('disabled')).toBe('disabled');
  });
});

describe('canUseScope', () => {
  it('gates token-required scopes on a non-empty token', () => {
    expect(canUseScope(undefined, 'tok')).toBe(false);
    expect(canUseScope({ requirement: 'open', detail: '' }, '')).toBe(true);
    expect(canUseScope({ requirement: 'operator_token', detail: '' }, '')).toBe(false);
    expect(canUseScope({ requirement: 'operator_token', detail: '' }, 'tok')).toBe(true);
    expect(canUseScope({ requirement: 'disabled', detail: '' }, 'tok')).toBe(false);
  });
});
