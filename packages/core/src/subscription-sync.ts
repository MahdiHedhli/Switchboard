import type {
  ProviderAccountContextSummary,
  ProviderAdapterStatusSnapshot,
  ProviderDashboardSummary,
  PlannerWarning,
  ProviderRefreshSummary,
  ProviderSyncSummary,
  ProviderSyncWarningDetails,
  SubscriptionAccount,
  SubscriptionSyncMethod,
  SubscriptionSyncMode,
  QuotaCoverageState,
} from './types.js';
import { hasTypedQuotaCoverage } from './quota-display.js';

const subscriptionSyncMethodOrder: SubscriptionSyncMethod[] = ['provider', 'snapshot', 'seed'];

export interface SubscriptionSyncState {
  mode: SubscriptionSyncMode;
  source?: string;
  rateLimitsDetail?: string;
  rateLimitsHost?: string;
  openaiAuthRequired: boolean;
  degraded: boolean;
}

export function getSubscriptionSignal(account: Pick<SubscriptionAccount, 'signals'>, id: string): string | undefined {
  return account.signals?.find((signal) => signal.id === id)?.value;
}

export function describeSubscriptionSync(account: Pick<SubscriptionAccount, 'signals'>): SubscriptionSyncState {
  const source = getSubscriptionSignal(account, 'source');
  const rateLimitsDetail = getSubscriptionSignal(account, 'rate_limits');
  const rateLimitsHost = getSubscriptionSignal(account, 'rate_limits_host');
  const openaiAuthRequired = getSubscriptionSignal(account, 'openai_auth') === 'required';

  if (source === 'app-server rate-limits') {
    return {
      mode: 'app-server-rate-limits',
      source,
      rateLimitsDetail,
      rateLimitsHost,
      openaiAuthRequired,
      degraded: false,
    };
  }

  if (source === 'app-server account') {
    return {
      mode: 'app-server-account',
      source,
      rateLimitsDetail,
      rateLimitsHost,
      openaiAuthRequired,
      degraded: true,
    };
  }

  if (source === 'login-status fallback') {
    return {
      mode: 'login-status-fallback',
      source,
      rateLimitsDetail,
      rateLimitsHost,
      openaiAuthRequired,
      degraded: true,
    };
  }

  return {
    mode: 'unknown',
    source,
    rateLimitsDetail,
    rateLimitsHost,
    openaiAuthRequired,
    degraded: false,
  };
}

export function formatSubscriptionSyncBadge(account: Pick<SubscriptionAccount, 'signals'>): string | null {
  const state = describeSubscriptionSync(account);
  const authSuffix = state.openaiAuthRequired ? '; OpenAI auth required' : '';
  const hostSuffix = state.rateLimitsHost ? ` via ${state.rateLimitsHost}` : '';

  if (state.mode === 'app-server-account') {
    return `partial app-server context${state.rateLimitsDetail ? `: ${state.rateLimitsDetail}` : ''}${hostSuffix}${authSuffix}`;
  }

  if (state.mode === 'login-status-fallback') {
    return `login fallback${state.rateLimitsDetail ? `: ${state.rateLimitsDetail}` : ''}${hostSuffix}${authSuffix}`;
  }

  return null;
}

export function formatSubscriptionSyncPlannerMessage(
  account: Pick<SubscriptionAccount, 'displayName' | 'signals'>,
): string | null {
  const state = describeSubscriptionSync(account);
  const authSuffix = state.openaiAuthRequired ? '; OpenAI auth required' : '';
  const hostSuffix = state.rateLimitsHost ? ` via ${state.rateLimitsHost}` : '';

  if (state.mode === 'app-server-account') {
    return `${account.displayName} is running with partial app-server account context${state.rateLimitsDetail ? ` (${state.rateLimitsDetail}${hostSuffix})` : hostSuffix ? ` (${hostSuffix.trim()})` : ''}${authSuffix}. Live rate-limit windows are unavailable in this launch context.`;
  }

  if (state.mode === 'login-status-fallback') {
    return `${account.displayName} is running on login-status fallback${state.rateLimitsDetail ? ` (${state.rateLimitsDetail}${hostSuffix})` : hostSuffix ? ` (${hostSuffix.trim()})` : ''}${authSuffix}. Typed rate-limit windows are unavailable in this launch context.`;
  }

  return null;
}

export function buildSubscriptionSyncWarningDetail(
  account: Pick<SubscriptionAccount, 'id' | 'provider' | 'displayName' | 'signals' | 'syncMethod'>,
): ProviderSyncWarningDetails | null {
  const state = describeSubscriptionSync(account);
  const accountSyncMethods = account.syncMethod ? [account.syncMethod] : undefined;

  if (state.mode === 'app-server-account' || state.mode === 'login-status-fallback') {
    return {
      kind: 'provider_sync',
      provider: account.provider,
      accountId: account.id,
      displayName: account.displayName,
      mode: state.mode,
      ...(accountSyncMethods ? { accountSyncMethods } : {}),
      source: state.source,
      rateLimitsDetail: state.rateLimitsDetail,
      rateLimitsHost: state.rateLimitsHost,
      openaiAuthRequired: state.openaiAuthRequired,
    };
  }

  return null;
}

export function formatSnapshotBackedPlannerMessage(
  account: Pick<SubscriptionAccount, 'displayName' | 'syncMethod'>,
): string | null {
  if (account.syncMethod === 'snapshot') {
    return `${account.displayName} is currently using snapshot-backed provider state. Live trusted-command refresh has not been confirmed for this account.`;
  }

  return null;
}

export function formatSubscriptionAccountWarning(
  account: Pick<SubscriptionAccount, 'displayName' | 'signals' | 'syncMethod'>,
): string | null {
  const degraded = formatSubscriptionSyncBadge(account);
  if (degraded) {
    return degraded;
  }

  return formatSnapshotBackedPlannerMessage(account);
}

export function formatProviderAdapterLaunchDriftWarning(
  summary: Pick<ProviderDashboardSummary, 'accountSyncMethods'> | null | undefined,
  adapter: Pick<ProviderAdapterStatusSnapshot, 'kind' | 'configured' | 'secure'> | null | undefined,
): string | null {
  if (!summary?.accountSyncMethods.includes('provider') || !adapter) {
    return null;
  }

  if (adapter.kind === 'trusted-command' && adapter.configured && adapter.secure) {
    return null;
  }

  return 'Persisted provider-backed state is present, but this broker launch is not configured for live provider refresh. Restart with the reviewed trusted-command adapter or provide a sanitized snapshot.';
}

export function buildSnapshotBackedWarningDetail(
  account: Pick<SubscriptionAccount, 'id' | 'provider' | 'displayName' | 'syncMethod'>,
): ProviderSyncWarningDetails | null {
  if (account.syncMethod !== 'snapshot') {
    return null;
  }

  return {
    kind: 'provider_sync',
    provider: account.provider,
    accountId: account.id,
    displayName: account.displayName,
    accountSyncMethods: ['snapshot'],
    source: 'snapshot',
    openaiAuthRequired: false,
  };
}

export function summarizeProviderSyncAccounts(
  accounts: Array<Pick<SubscriptionAccount, 'signals' | 'quotas'>>,
): ProviderSyncSummary {
  const accountsWithSignals = accounts.filter((account) =>
    Boolean(
      getSubscriptionSignal(account, 'source')
      || getSubscriptionSignal(account, 'rate_limits')
      || getSubscriptionSignal(account, 'rate_limits_host')
      || getSubscriptionSignal(account, 'openai_auth'),
    ),
  );

  const syncStates = accountsWithSignals.map((account) => describeSubscriptionSync(account));
  const syncModes = [...new Set(syncStates.map((state) => state.mode))];
  const syncBadges = [
    ...new Set(
      accountsWithSignals
        .map((account) => formatSubscriptionSyncBadge(account))
        .filter((badge): badge is string => Boolean(badge)),
    ),
  ];
  const rateLimitHosts = [
    ...new Set(
      accountsWithSignals
        .map((account) => getSubscriptionSignal(account, 'rate_limits_host'))
        .filter((host): host is string => Boolean(host)),
    ),
  ];
  const openaiAuth = [
    ...new Set(
      accountsWithSignals
        .map((account) => getSubscriptionSignal(account, 'openai_auth'))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const quotas = accounts.flatMap((account) => account.quotas ?? []);
  const quotaModels = quotas.length;
  const typedQuotaModels = quotas.filter((quota) => hasTypedQuotaCoverage(quota)).length;
  let quotaCoverage: QuotaCoverageState = 'none';

  if (quotaModels > 0) {
    if (typedQuotaModels === 0) {
      quotaCoverage = 'informational_only';
    } else if (typedQuotaModels < quotaModels) {
      quotaCoverage = 'mixed';
    } else {
      quotaCoverage = 'typed';
    }
  }

  return {
    degraded: syncStates.some((state) => state.degraded),
    syncModes,
    syncBadges,
    rateLimitHosts,
    openaiAuth,
    quotaCoverage,
    quotaModels,
    typedQuotaModels,
  };
}

export function summarizeProviderAccountContext(
  accounts: Array<Pick<SubscriptionAccount, 'displayName' | 'lastRefreshedAt' | 'syncMethod'>>,
): ProviderAccountContextSummary {
  const accountDisplayNames = [...new Set(accounts.map((account) => account.displayName).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  const accountSyncMethods = [
    ...new Set(
      accounts
        .map((account) => account.syncMethod)
        .filter((syncMethod): syncMethod is SubscriptionSyncMethod => Boolean(syncMethod)),
    ),
  ].sort((left, right) => subscriptionSyncMethodOrder.indexOf(left) - subscriptionSyncMethodOrder.indexOf(right));
  const latestTimestamp = accounts.reduce<number | undefined>((latest, account) => {
    if (!account.lastRefreshedAt) {
      return latest;
    }

    const parsed = Date.parse(account.lastRefreshedAt);
    if (Number.isNaN(parsed)) {
      return latest;
    }

    if (latest === undefined || parsed > latest) {
      return parsed;
    }

    return latest;
  }, undefined);

  return {
    accountDisplayNames,
    latestAccountRefreshedAt: latestTimestamp === undefined ? undefined : new Date(latestTimestamp).toISOString(),
    accountSyncMethods,
  };
}

export function buildProviderDashboardSummaries(
  accounts: Array<Pick<SubscriptionAccount, 'provider' | 'displayName' | 'lastRefreshedAt' | 'signals' | 'syncMethod' | 'quotas'>>,
): ProviderDashboardSummary[] {
  const grouped = new Map<string, typeof accounts>();

  for (const account of accounts) {
    const existing = grouped.get(account.provider);
    if (existing) {
      existing.push(account);
      continue;
    }

    grouped.set(account.provider, [account]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, providerAccounts]) => ({
      provider,
      accounts: providerAccounts.length,
      ...summarizeProviderAccountContext(providerAccounts),
      ...summarizeProviderSyncAccounts(providerAccounts),
    }));
}

export function formatProviderSyncSummaryMessage(
  summary: Pick<ProviderSyncSummary, 'syncBadges' | 'syncModes'>
    & Partial<Pick<ProviderAccountContextSummary, 'accountSyncMethods'>>,
): string | null {
  if (summary.syncBadges.length > 0) {
    return summary.syncBadges.join(' | ');
  }

  if (summary.syncModes.includes('app-server-rate-limits')) {
    return 'app-server rate-limits available';
  }

  if (summary.syncModes.length > 0) {
    return summary.syncModes.join(', ');
  }

  const accountSyncMethods = summary.accountSyncMethods ?? [];

  if (accountSyncMethods.length === 1) {
    if (accountSyncMethods[0] === 'provider') {
      return 'provider-backed refresh';
    }

    if (accountSyncMethods[0] === 'snapshot') {
      return 'snapshot-backed refresh';
    }

    if (accountSyncMethods[0] === 'seed') {
      return 'seeded state only';
    }
  }

  if (accountSyncMethods.length > 1) {
    return `mixed account sync sources: ${accountSyncMethods.join(', ')}`;
  }

  return null;
}

export function formatProviderSyncSummaryDisplayMessage(
  summary: Pick<ProviderSyncSummary, 'syncBadges' | 'syncModes' | 'degraded'>
    & Partial<Pick<ProviderAccountContextSummary, 'accountSyncMethods'>>,
): string | null {
  const detail = formatProviderSyncSummaryMessage(summary);

  if (!detail) {
    return isProviderSyncSummaryAdvisory(summary) ? 'advisory' : null;
  }

  return isProviderSyncSummaryAdvisory(summary) ? `${detail} (advisory)` : detail;
}

export function formatProviderRefreshSummaryMessage(
  summary: Pick<ProviderRefreshSummary, 'provider' | 'accounts' | 'accountDisplayNames' | 'syncBadges' | 'syncModes' | 'accountSyncMethods'>
    & Partial<Pick<ProviderSyncSummary, 'degraded' | 'quotaCoverage' | 'quotaModels' | 'typedQuotaModels'>>,
): string {
  const base = summary.accountDisplayNames.length === 1
    ? `${summary.provider} refreshed ${summary.accountDisplayNames[0]}`
    : `${summary.provider} refreshed ${summary.accounts} account${summary.accounts === 1 ? '' : 's'}`;
  const detail = formatProviderSyncSummaryMessage(summary);
  const quotaLabel = formatProviderSyncQuotaCoverageLabel({
    quotaCoverage: summary.quotaCoverage ?? 'none',
    quotaModels: summary.quotaModels ?? 0,
    typedQuotaModels: summary.typedQuotaModels ?? 0,
  });
  const advisory = isProviderSyncSummaryAdvisory({
    degraded: summary.degraded ?? false,
    accountSyncMethods: summary.accountSyncMethods,
  });

  if (detail) {
    return `${base} · ${detail}${advisory ? ' (advisory)' : ''}${quotaLabel ? ` · ${quotaLabel}` : ''}`;
  }

  if (advisory) {
    return `${base} · advisory${quotaLabel ? ` · ${quotaLabel}` : ''}`;
  }

  return quotaLabel ? `${base} · ${quotaLabel}` : base;
}

export function formatProviderSyncQuotaCoverageMessage(
  summary: Pick<ProviderSyncSummary, 'quotaCoverage' | 'quotaModels' | 'typedQuotaModels'>,
): string | null {
  if (summary.quotaCoverage === 'typed') {
    return null;
  }

  if (summary.quotaCoverage === 'none') {
    return 'This provider refresh returned no quota rows yet.';
  }

  if (summary.quotaCoverage === 'informational_only') {
    return `This provider refresh only has informational quota metadata (${summary.typedQuotaModels}/${summary.quotaModels} models with typed windows). Live typed quota windows are unavailable.`;
  }

  if (summary.quotaCoverage === 'mixed') {
    return `This provider refresh mixes typed quota windows with informational-only rows (${summary.typedQuotaModels}/${summary.quotaModels} models with typed windows). Prefer models with explicit window data for live quota tracking.`;
  }

  return null;
}

export function formatProviderSyncQuotaCoverageLabel(
  summary: Pick<ProviderSyncSummary, 'quotaCoverage' | 'quotaModels' | 'typedQuotaModels'>,
): string | null {
  if (summary.quotaCoverage === 'typed') {
    return null;
  }

  if (summary.quotaCoverage === 'none') {
    return 'no quota rows yet';
  }

  if (summary.quotaCoverage === 'informational_only') {
    return 'informational quota only';
  }

  if (summary.quotaCoverage === 'mixed') {
    return `typed quota ${summary.typedQuotaModels}/${summary.quotaModels} models`;
  }

  return null;
}

export function isProviderSyncSummaryAdvisory(
  summary: Pick<ProviderSyncSummary, 'degraded'>
    & Partial<Pick<ProviderAccountContextSummary, 'accountSyncMethods'>>,
): boolean {
  if (summary.degraded) {
    return true;
  }

  return (summary.accountSyncMethods ?? []).some((method) => method !== 'provider');
}

export function formatProviderSyncSummaryPills(
  summary: Pick<ProviderSyncSummary, 'syncModes' | 'rateLimitHosts' | 'openaiAuth'>
    & Partial<Pick<ProviderSyncSummary, 'quotaCoverage' | 'quotaModels' | 'typedQuotaModels'>>
    & Partial<Pick<ProviderAccountContextSummary, 'accountSyncMethods'>>,
): string[] {
  const pills = (summary.accountSyncMethods ?? []).map((method) => `account sync: ${method}`);

  for (const mode of summary.syncModes) {
    pills.push(`mode: ${mode}`);
  }

  for (const host of summary.rateLimitHosts) {
    pills.push(`host: ${host}`);
  }

  if (summary.openaiAuth.includes('required')) {
    pills.push('OpenAI auth required');
  }

  if (summary.quotaCoverage && summary.quotaCoverage !== 'typed') {
    pills.push(`quota: ${summary.quotaCoverage}`);
  }

  if ((summary.quotaModels ?? 0) > 0 && (summary.quotaCoverage ?? 'none') !== 'typed') {
    pills.push(`typed quota models: ${summary.typedQuotaModels ?? 0}/${summary.quotaModels}`);
  }

  return pills;
}

export function formatPlannerWarningPills(warning: Pick<PlannerWarning, 'code' | 'details'>): string[] {
  if (warning.details?.kind === 'provider_sync') {
    const pills = [];

    if (warning.details.mode) {
      pills.push(`${warning.details.provider} · ${warning.details.mode}`);
    } else if ((warning.details.accountSyncMethods?.length ?? 0) > 0) {
      pills.push(`${warning.details.provider} · ${warning.details.accountSyncMethods?.join('/')}`);
    }

    for (const method of warning.details.accountSyncMethods ?? []) {
      pills.push(`account sync: ${method}`);
    }

    if (warning.details.rateLimitsHost) {
      pills.push(`host: ${warning.details.rateLimitsHost}`);
    }

    if (warning.details.openaiAuthRequired) {
      pills.push('OpenAI auth required');
    }

    return pills;
  }

  if (warning.details?.kind === 'quota_reservation') {
    const pills = [`task: ${warning.details.taskId}`, `${warning.details.provider}/${warning.details.modelId}`, `quota: ${warning.details.status}`];

    if (warning.details.quotaInterpretation && warning.details.quotaInterpretation !== 'absolute') {
      pills.push(`interpretation: ${warning.details.quotaInterpretation}`);
    }

    if (
      warning.details.quotaUsageUnit
      && warning.details.quotaUsageUnit !== 'unknown'
      && warning.details.quotaUsageUnit !== warning.details.reservationUsageUnit
    ) {
      pills.push(`units: ${warning.details.quotaUsageUnit}/${warning.details.reservationUsageUnit}`);
    }

    if (warning.details.quotaUsageUnit === 'unknown') {
      pills.push('quota unit: unknown');
    }

    if (warning.details.quotaAvailability === 'unknown') {
      pills.push('availability: unknown');
    }

    if (typeof warning.details.quotaRemaining === 'number' && warning.details.status === 'insufficient') {
      pills.push(`remaining: ${warning.details.quotaRemaining} ${warning.details.quotaUsageUnit ?? warning.details.reservationUsageUnit}`);
    }

    return pills;
  }

  return [];
}

export function formatPlannerWarningTitle(warning: Pick<PlannerWarning, 'code' | 'details'>): string {
  if (warning.details?.kind === 'quota_reservation') {
    return `${warning.code} · ${warning.details.taskId}`;
  }

  if (warning.details?.kind === 'provider_sync') {
    return `${warning.code} · ${warning.details.provider}`;
  }

  return warning.code;
}

export function plannerWarningKey(warning: Pick<PlannerWarning, 'code' | 'message' | 'details'>): string {
  if (warning.details?.kind === 'quota_reservation') {
    return [
      warning.code,
      warning.details.taskId,
      warning.details.provider,
      warning.details.modelId,
      warning.details.status,
    ].join('-');
  }

  if (warning.details?.kind === 'provider_sync') {
    return [
      warning.code,
      warning.details.provider,
      warning.details.accountId,
      warning.details.mode ?? warning.details.source ?? warning.details.accountSyncMethods?.join('/') ?? 'warning',
    ].join('-');
  }

  return `${warning.code}-${warning.message}`;
}
