import type {
  AuthMode,
  ConfidenceLevel,
  ModelQuotaSnapshot,
  ModelQuotaWindowSnapshot,
  ProviderId,
  QuotaInterpretation,
  SubscriptionAccount,
  SubscriptionSignal,
  SubscriptionSyncMethod,
  UsageSource,
  UsageUnit,
} from '@switchboard/core';
import {
  assertKnownKeys,
  expectArray,
  expectEnum,
  expectOptionalNumber,
  expectOptionalString,
  expectRecord,
  expectString,
} from '../validation.js';
import { AdapterRefreshError } from './types.js';

const availabilityStates = ['available', 'constrained', 'unavailable', 'unknown'] as const;
const authModes = ['subscription', 'api', 'hybrid'] as const;
const usageUnits = ['requests', 'messages', 'minutes', 'credits', 'tokens', 'unknown'] as const;
const usageSources = ['manual', 'cli', 'provider-ui', 'api', 'inferred'] as const;
const confidenceLevels = ['low', 'medium', 'high'] as const;
const quotaInterpretations = ['absolute', 'percentage_window', 'informational'] as const;

function parseQuotaWindow(raw: unknown, context: string): ModelQuotaWindowSnapshot {
  const record = expectRecord(raw, context);
  assertKnownKeys(
    record,
    ['id', 'label', 'durationMinutes', 'limit', 'used', 'remaining', 'interpretation', 'resetAt'],
    context,
  );

  return {
    id: expectString(record.id, `${context}.id`),
    label: expectString(record.label, `${context}.label`),
    durationMinutes: expectOptionalNumber(record.durationMinutes, `${context}.durationMinutes`),
    limit: expectOptionalNumber(record.limit, `${context}.limit`),
    used: expectOptionalNumber(record.used, `${context}.used`),
    remaining: expectOptionalNumber(record.remaining, `${context}.remaining`),
    interpretation: record.interpretation === undefined
      ? undefined
      : expectEnum(record.interpretation, quotaInterpretations, `${context}.interpretation`) as QuotaInterpretation,
    resetAt: expectOptionalString(record.resetAt, `${context}.resetAt`),
  };
}

function parseQuota(raw: unknown, context: string, provider: ProviderId): ModelQuotaSnapshot {
  const record = expectRecord(raw, context);
  assertKnownKeys(
    record,
    [
      'modelId',
      'displayName',
      'availability',
      'authMode',
      'usageUnit',
      'source',
      'confidence',
      'limit',
      'used',
      'remaining',
      'interpretation',
      'resetAt',
      'windows',
      'notes',
    ],
    context,
  );

  return {
    provider,
    modelId: expectString(record.modelId, `${context}.modelId`),
    displayName: expectString(record.displayName, `${context}.displayName`),
    availability: expectEnum(record.availability, availabilityStates, `${context}.availability`),
    authMode: expectEnum(record.authMode, authModes, `${context}.authMode`) as AuthMode,
    usageUnit: expectEnum(record.usageUnit, usageUnits, `${context}.usageUnit`) as UsageUnit,
    source: expectEnum(record.source, usageSources, `${context}.source`) as UsageSource,
    confidence: expectEnum(record.confidence, confidenceLevels, `${context}.confidence`) as ConfidenceLevel,
    limit: expectOptionalNumber(record.limit, `${context}.limit`),
    used: expectOptionalNumber(record.used, `${context}.used`),
    remaining: expectOptionalNumber(record.remaining, `${context}.remaining`),
    interpretation: record.interpretation === undefined
      ? undefined
      : expectEnum(record.interpretation, quotaInterpretations, `${context}.interpretation`) as QuotaInterpretation,
    resetAt: expectOptionalString(record.resetAt, `${context}.resetAt`),
    windows: record.windows === undefined
      ? undefined
      : expectArray(record.windows, `${context}.windows`).map((entry, index) =>
          parseQuotaWindow(entry, `${context}.windows[${index}]`),
        ),
    notes: expectOptionalString(record.notes, `${context}.notes`),
  };
}

function parseSignal(raw: unknown, context: string): SubscriptionSignal {
  const record = expectRecord(raw, context);
  assertKnownKeys(record, ['id', 'label', 'value'], context);

  return {
    id: expectString(record.id, `${context}.id`),
    label: expectString(record.label, `${context}.label`),
    value: expectString(record.value, `${context}.value`),
  };
}

function parseAccount(
  raw: unknown,
  context: string,
  provider: ProviderId,
  syncMethod: SubscriptionSyncMethod,
): SubscriptionAccount {
  const record = expectRecord(raw, context);
  assertKnownKeys(record, ['id', 'displayName', 'authMode', 'owner', 'lastRefreshedAt', 'signals', 'quotas'], context);

  return {
    id: expectString(record.id, `${context}.id`),
    provider,
    displayName: expectString(record.displayName, `${context}.displayName`),
    authMode: expectEnum(record.authMode, authModes, `${context}.authMode`) as AuthMode,
    owner: expectString(record.owner, `${context}.owner`),
    syncMethod,
    lastRefreshedAt: expectOptionalString(record.lastRefreshedAt, `${context}.lastRefreshedAt`) ?? new Date().toISOString(),
    signals: record.signals === undefined
      ? undefined
      : expectArray(record.signals, `${context}.signals`).map((entry, index) =>
          parseSignal(entry, `${context}.signals[${index}]`),
        ),
    quotas: expectArray(record.quotas, `${context}.quotas`).map((entry, index) =>
      parseQuota(entry, `${context}.quotas[${index}]`, provider),
    ),
  };
}

export function parseSanitizedProviderPayload(
  payload: unknown,
  provider: ProviderId,
  syncMethod: SubscriptionSyncMethod,
  context: string,
): SubscriptionAccount[] {
  try {
    const record = expectRecord(payload, context);
    assertKnownKeys(record, ['provider', 'accounts'], context);

    if (expectString(record.provider, `${context}.provider`) !== provider) {
      throw new AdapterRefreshError(
        'invalid_snapshot',
        `${context} declared provider "${String(record.provider)}" but expected "${provider}".`,
      );
    }

    return expectArray(record.accounts, `${context}.accounts`).map((entry, index) =>
      parseAccount(entry, `${context}.accounts[${index}]`, provider, syncMethod),
    );
  } catch (error) {
    if (error instanceof AdapterRefreshError) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new AdapterRefreshError('invalid_snapshot', detail);
  }
}
