import type { ModelQuotaSnapshot, ModelQuotaWindowSnapshot } from './types.js';

function quotaWindows(quota: ModelQuotaSnapshot): ModelQuotaWindowSnapshot[] {
  if (quota.windows?.length) {
    return quota.windows;
  }

  if (
    quota.limit === undefined
    && quota.used === undefined
    && quota.remaining === undefined
    && quota.resetAt === undefined
  ) {
    return [];
  }

  return [
    {
      id: 'current',
      label: 'Current window',
      limit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
      interpretation: quota.interpretation,
      resetAt: quota.resetAt,
    },
  ];
}

function hasTypedQuotaWindow(window: ModelQuotaWindowSnapshot): boolean {
  if (window.interpretation && window.interpretation !== 'informational') {
    return true;
  }

  return (
    window.limit !== undefined
    || window.used !== undefined
    || window.remaining !== undefined
    || window.resetAt !== undefined
  );
}

export function hasTypedQuotaCoverage(quota: ModelQuotaSnapshot): boolean {
  return quotaWindows(quota).some((window) => hasTypedQuotaWindow(window));
}

export function formatQuotaCoverageMessage(quotas: ModelQuotaSnapshot[]): string | null {
  if (quotas.length === 0) {
    return null;
  }

  const typedCount = quotas.filter((quota) => hasTypedQuotaCoverage(quota)).length;

  if (typedCount === 0) {
    return 'Live typed quota windows are unavailable in this launch context. Showing informational account metadata only.';
  }

  if (typedCount < quotas.length) {
    return 'Some models only have informational metadata in this launch context. Prefer rows with explicit window data for live quota tracking.';
  }

  return null;
}
