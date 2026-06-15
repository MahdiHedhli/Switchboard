/*
 * Copyright 2026 Mahdi Hedhli
 *
 * Licensed under the Apache License, Version 2.0.
 */

import type {
  AuthMode,
  CostBasisStrategy,
  ModelCapabilityTier,
  ModelCatalogEntry,
  ModelPricing,
  ProviderId,
  UsageUnit,
} from './types.js';

// ---------------------------------------------------------------------------
// Selection constants shared by the selector and profile-defaulting.
// ---------------------------------------------------------------------------

export const TIER_VALUES = ['heavy', 'standard', 'light'] as const;

/**
 * Capability rank: a lower number is MORE capable. Used both for tier-floor
 * checks and as the first key of the selector's deterministic tie-break.
 */
export const TIER_RANK: Record<ModelCapabilityTier, number> = {
  heavy: 0,
  standard: 1,
  light: 2,
};

/** Profile-wide default when a profile declares no `selectionPolicy`. */
export const DEFAULT_SELECTION_POLICY: CostBasisStrategy = 'subscription-first-scarcity-preserving';

export function isCapabilityTier(value: unknown): value is ModelCapabilityTier {
  return value === 'heavy' || value === 'standard' || value === 'light';
}

export function isUsageUnit(value: unknown): value is UsageUnit {
  return (
    value === 'requests' ||
    value === 'messages' ||
    value === 'minutes' ||
    value === 'credits' ||
    value === 'tokens' ||
    value === 'unknown'
  );
}

/**
 * A model clears the floor iff it is at least as capable as the minimum tier
 * (i.e. its rank is <= the floor's rank). `heavy` clears every floor; `light`
 * clears only a `light` floor.
 */
export function tierClearsFloor(tier: ModelCapabilityTier, floor: ModelCapabilityTier): boolean {
  return TIER_RANK[tier] <= TIER_RANK[floor];
}

// ---------------------------------------------------------------------------
// Raw catalog shape (config/model-catalog.json)
//
// The on-disk file is intentionally LOOSE: placeholder rows leave `tier` and
// the cost field as explicit `null` so unverified values can never be mistaken
// for real ones. `normalizeCatalog` is the only path that promotes a raw row to
// a routable `ModelCatalogEntry`, and it refuses to do so for any row that is
// not fully filled, consistent, and `status: "active"`.
// ---------------------------------------------------------------------------

export interface RawModelPricingApi {
  authMode: 'api';
  unit?: UsageUnit;
  costPerUnit?: number | null;
}

export interface RawModelPricingSubscription {
  authMode: 'subscription';
  drawsFromQuota?: boolean;
}

export type RawModelPricing = RawModelPricingApi | RawModelPricingSubscription;

export interface RawModelCatalogEntry {
  provider?: string;
  modelId?: string;
  displayName?: string;
  tier?: ModelCapabilityTier | null;
  authMode?: AuthMode;
  pricing?: RawModelPricing;
  status?: 'active' | 'placeholder';
  /** Free-form operator hint describing what must be verified before activation. */
  operatorNote?: string;
}

export interface RawModelCatalogFile {
  version: number;
  entries: RawModelCatalogEntry[];
}

export type CatalogIssueKind = 'placeholder' | 'missing-field' | 'malformed';

export interface CatalogIssue {
  index: number;
  kind: CatalogIssueKind;
  message: string;
  provider?: string;
  modelId?: string;
  field?: string;
}

export interface CatalogCounts {
  total: number;
  active: number;
  placeholder: number;
  malformed: number;
}

export interface NormalizedCatalog {
  version: number;
  /** Routable, fully-typed entries. The selector ranks only these. */
  active: ModelCatalogEntry[];
  /** Rows intentionally left unfilled; reported, never routed on. */
  placeholders: RawModelCatalogEntry[];
  issues: CatalogIssue[];
  counts: CatalogCounts;
  /** No structural problems (missing-field / malformed). Placeholders do NOT flip this false. */
  structurallyValid: boolean;
  /** structurallyValid AND >= 1 active row AND zero placeholders/malformed: safe to route on. */
  routable: boolean;
}

// ---------------------------------------------------------------------------
// Load + validate
// ---------------------------------------------------------------------------

/** Validate the top-level file shape. Throws on a structurally invalid file. */
export function parseCatalog(data: unknown): RawModelCatalogFile {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Model catalog must be a JSON object.');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number' || !Number.isFinite(obj.version)) {
    throw new Error('Model catalog "version" must be a finite number.');
  }

  if (!Array.isArray(obj.entries)) {
    throw new Error('Model catalog "entries" must be an array.');
  }

  return { version: obj.version, entries: obj.entries as RawModelCatalogEntry[] };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validatePricingShape(pricing: RawModelPricing | undefined): string | null {
  if (typeof pricing !== 'object' || pricing === null) {
    return 'has no pricing object.';
  }

  if (pricing.authMode === 'api') {
    if (pricing.unit !== undefined && !isUsageUnit(pricing.unit)) {
      return `has invalid pricing.unit "${String(pricing.unit)}".`;
    }
    if (
      pricing.costPerUnit !== undefined &&
      pricing.costPerUnit !== null &&
      (typeof pricing.costPerUnit !== 'number' || !Number.isFinite(pricing.costPerUnit) || pricing.costPerUnit < 0)
    ) {
      return 'has invalid pricing.costPerUnit (must be a non-negative number or null).';
    }
    return null;
  }

  if (pricing.authMode === 'subscription') {
    if (pricing.drawsFromQuota !== undefined && pricing.drawsFromQuota !== true) {
      return 'subscription pricing.drawsFromQuota must be true.';
    }
    return null;
  }

  return `has invalid pricing.authMode "${String((pricing as { authMode?: unknown }).authMode)}".`;
}

function isPricingComplete(pricing: RawModelPricing): boolean {
  if (pricing.authMode === 'api') {
    return isUsageUnit(pricing.unit) && typeof pricing.costPerUnit === 'number' && Number.isFinite(pricing.costPerUnit);
  }
  return pricing.drawsFromQuota === true;
}

function pricingConsistencyError(authMode: AuthMode, pricing: RawModelPricing): string | null {
  // hybrid rows may declare either cost basis; non-hybrid rows must match.
  if (authMode === 'hybrid') {
    return null;
  }
  if (authMode !== pricing.authMode) {
    return `pricing.authMode "${pricing.authMode}" must match entry authMode "${authMode}" (only hybrid rows may differ)`;
  }
  return null;
}

function toActiveEntry(entry: RawModelCatalogEntry): ModelCatalogEntry {
  // Safe: every field below has already been validated by normalizeCatalog.
  const raw = entry.pricing as RawModelPricing;
  const pricing: ModelPricing =
    raw.authMode === 'api'
      ? { authMode: 'api', unit: raw.unit as UsageUnit, costPerUnit: raw.costPerUnit as number }
      : { authMode: 'subscription', drawsFromQuota: true };

  return {
    provider: entry.provider as ProviderId,
    modelId: entry.modelId as string,
    displayName: entry.displayName as string,
    tier: entry.tier as ModelCapabilityTier,
    authMode: entry.authMode as AuthMode,
    pricing,
    status: 'active',
  };
}

/**
 * Partition a raw catalog into routable `active` entries, intentional
 * `placeholders`, and structural `issues`. A row is promoted to active ONLY
 * when it is `status: "active"`, has a valid tier, complete + consistent
 * pricing, and a valid provider/modelId/displayName. Anything else is reported
 * and excluded — the selector therefore can never route on a fabricated or
 * half-filled row.
 */
export function normalizeCatalog(file: RawModelCatalogFile): NormalizedCatalog {
  const active: ModelCatalogEntry[] = [];
  const placeholders: RawModelCatalogEntry[] = [];
  const issues: CatalogIssue[] = [];
  let malformed = 0;

  file.entries.forEach((entry, index) => {
    const ref = { index, provider: entry.provider, modelId: entry.modelId };
    const label = `${entry.provider ?? '?'}/${entry.modelId ?? '?'}`;

    const missing: string[] = [];
    if (!nonEmptyString(entry.provider)) missing.push('provider');
    if (!nonEmptyString(entry.modelId)) missing.push('modelId');
    if (!nonEmptyString(entry.displayName)) missing.push('displayName');
    if (entry.status !== 'active' && entry.status !== 'placeholder') missing.push('status');

    if (missing.length > 0) {
      malformed += 1;
      issues.push({
        ...ref,
        kind: 'missing-field',
        field: missing.join(', '),
        message: `Row ${index} is missing required field(s): ${missing.join(', ')}.`,
      });
      return;
    }

    if (entry.authMode !== 'api' && entry.authMode !== 'subscription' && entry.authMode !== 'hybrid') {
      malformed += 1;
      issues.push({
        ...ref,
        kind: 'malformed',
        field: 'authMode',
        message: `Row ${index} (${label}) has invalid authMode "${String(entry.authMode)}".`,
      });
      return;
    }

    const shapeError = validatePricingShape(entry.pricing);
    if (shapeError) {
      malformed += 1;
      issues.push({
        ...ref,
        kind: 'malformed',
        field: 'pricing',
        message: `Row ${index} (${label}) ${shapeError}`,
      });
      return;
    }

    const pricing = entry.pricing as RawModelPricing;
    const tierOk = isCapabilityTier(entry.tier);
    const pricingComplete = isPricingComplete(pricing);
    const consistencyError = pricingConsistencyError(entry.authMode, pricing);

    if (entry.status === 'placeholder') {
      placeholders.push(entry);
      const reasons: string[] = [];
      if (!tierOk) reasons.push('tier unset');
      if (!pricingComplete) reasons.push('cost unset');
      if (consistencyError) reasons.push(consistencyError);
      issues.push({
        ...ref,
        kind: 'placeholder',
        message:
          `Row ${index} (${label}) is a placeholder` +
          (reasons.length > 0 ? `: ${reasons.join('; ')}` : '') +
          '. Fill real values and set status=active to route on it.',
      });
      return;
    }

    // status === 'active' => must be complete and consistent, else it is an
    // operator mistake (claimed routable but not), reported as malformed.
    const problems: string[] = [];
    if (!tierOk) problems.push('tier must be heavy|standard|light');
    if (!pricingComplete) problems.push('pricing cost/unit must be set');
    if (consistencyError) problems.push(consistencyError);
    if (problems.length > 0) {
      malformed += 1;
      issues.push({
        ...ref,
        kind: 'malformed',
        field: 'tier/pricing',
        message: `Row ${index} (${label}) is marked active but incomplete: ${problems.join('; ')}.`,
      });
      return;
    }

    active.push(toActiveEntry(entry));
  });

  const counts: CatalogCounts = {
    total: file.entries.length,
    active: active.length,
    placeholder: placeholders.length,
    malformed,
  };
  const structurallyValid = malformed === 0;
  const routable = structurallyValid && active.length > 0 && placeholders.length === 0;

  return { version: file.version, active, placeholders, issues, counts, structurallyValid, routable };
}

/** Reporter: the raw rows that are not (yet) routable. */
export function placeholderEntries(file: RawModelCatalogFile): RawModelCatalogEntry[] {
  return normalizeCatalog(file).placeholders;
}

/** Convenience: just the routable entries. */
export function activeEntries(file: RawModelCatalogFile): ModelCatalogEntry[] {
  return normalizeCatalog(file).active;
}
