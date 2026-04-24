import { summarizeCodexAppServerError } from './provider-sync/codex-app-server-diagnostics.mjs';

function formatRawStatus(appServerResult) {
  const rawStatusBase = appServerResult.summary.rateLimitStatus ?? summarizeCodexAppServerError(appServerResult.stderr);
  return appServerResult.summary.rateLimitHost ? `${rawStatusBase} via ${appServerResult.summary.rateLimitHost}` : rawStatusBase;
}

function summarizeOperatorReadinessError(stderr, profile) {
  const detail = stderr?.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1]?.trim();
  if (detail) {
    return detail;
  }

  return `Operator readiness failed for ${profile}.`;
}

function operatorCheckMessage(operatorResult) {
  if (operatorResult.summary.message) {
    return operatorResult.summary.message;
  }

  if (operatorResult.code === 0) {
    return `${operatorResult.summary.profile}; host=${operatorResult.summary.host}`;
  }

  return summarizeOperatorReadinessError(operatorResult.stderr, operatorResult.summary.profile);
}

function operatorFailureCodes(operatorResult) {
  if ((operatorResult.summary.failureCodes?.length ?? 0) > 0) {
    return operatorResult.summary.failureCodes;
  }

  return operatorResult.code !== 0 ? ['operator_readiness_failed'] : [];
}

function codexWrapperCheckState(codexResult) {
  if (codexResult.code !== 0 || codexResult.summary.verdict === 'blocked') {
    return 'blocked';
  }

  if (codexResult.summary.verdict === 'attention_required' || codexResult.summary.ok === false) {
    return 'attention_required';
  }

  return 'ready';
}

function codexWrapperFailureCodes(codexResult) {
  if ((codexResult.summary.failureCodes?.length ?? 0) > 0) {
    return codexResult.summary.failureCodes;
  }

  return codexResult.code !== 0 ? ['codex_wrapper_failed'] : [];
}

function codexWrapperAdvisoryCodes(codexResult) {
  if ((codexResult.summary.advisoryCodes?.length ?? 0) > 0) {
    return codexResult.summary.advisoryCodes;
  }

  return codexResult.summary.ok === false ? ['codex_wrapper_degraded'] : [];
}

function operatorCheckDetail(operatorResult) {
  return {
    profile: operatorResult.summary.profile,
    ...(operatorResult.summary.verdict ? { verdict: operatorResult.summary.verdict } : {}),
    host: operatorResult.summary.host,
    ...(operatorResult.summary.localOnly !== undefined ? { localOnly: operatorResult.summary.localOnly } : {}),
    ...(operatorResult.summary.allowRemote !== undefined ? { allowRemote: operatorResult.summary.allowRemote } : {}),
    ...(operatorResult.summary.protocol ? { protocol: operatorResult.summary.protocol } : {}),
    ...(operatorResult.summary.tlsEnabled !== undefined ? { tlsEnabled: operatorResult.summary.tlsEnabled } : {}),
    ...(operatorResult.summary.tlsCertFile ? { tlsCertFile: operatorResult.summary.tlsCertFile } : {}),
    ...(operatorResult.summary.tlsKeyFile ? { tlsKeyFile: operatorResult.summary.tlsKeyFile } : {}),
    ...(operatorResult.summary.tlsCaFile ? { tlsCaFile: operatorResult.summary.tlsCaFile } : {}),
    ...(operatorResult.summary.operatorTokenConfigured !== undefined
      ? { operatorTokenConfigured: operatorResult.summary.operatorTokenConfigured }
      : {}),
    ...(operatorResult.summary.operatorTokenSource
      ? { operatorTokenSource: operatorResult.summary.operatorTokenSource }
      : {}),
    ...(operatorResult.summary.operatorTokenFile
      ? { operatorTokenFile: operatorResult.summary.operatorTokenFile }
      : {}),
    ...(operatorResult.summary.operatorTokenProblem
      ? { operatorTokenProblem: operatorResult.summary.operatorTokenProblem }
      : {}),
    ...(operatorResult.summary.manualSubscriptionReplaceEnabled !== undefined
      ? { manualSubscriptionReplaceEnabled: operatorResult.summary.manualSubscriptionReplaceEnabled }
      : {}),
    ...(operatorResult.summary.failureCodes ? { failureCodes: operatorResult.summary.failureCodes } : {}),
    ...(operatorResult.summary.advisoryCodes ? { advisoryCodes: operatorResult.summary.advisoryCodes } : {}),
    ...(operatorResult.summary.scopes ? { scopes: operatorResult.summary.scopes } : {}),
    ...(operatorResult.summary.problems ? { problems: operatorResult.summary.problems } : {}),
    message: operatorCheckMessage(operatorResult),
  };
}

function providerSyncCheckMessage(providerSyncResult) {
  if (providerSyncResult.summary.message) {
    return providerSyncResult.summary.message;
  }

  const preferredProvider = preferredProviderName(providerSyncResult);

  if (preferredProvider && providerSyncResult.summary.providerMessages?.[preferredProvider]) {
    return providerSyncResult.summary.providerMessages[preferredProvider];
  }

  if (preferredProvider) {
    const matchingProvider = providerSyncResult.summary.providers?.find((item) => item.provider === preferredProvider);
    if (matchingProvider?.state) {
      return matchingProvider.state;
    }
  }

  return providerSyncResult.summary.providers?.[0]?.state ?? providerSyncResult.summary.verdict;
}

function preferredProviderName(result) {
  return result.summary.attentionProviders?.[0]
    ?? result.summary.blockedProviders?.[0]
    ?? result.summary.readyProviders?.[0]
    ?? result.summary.providers?.[0]?.provider;
}

function providerReadinessCheckMessage(providerReadinessResult) {
  if (providerReadinessResult.summary.message) {
    return providerReadinessResult.summary.message;
  }

  const preferredProvider = preferredProviderName(providerReadinessResult);

  if (preferredProvider && providerReadinessResult.summary.providerMessages?.[preferredProvider]) {
    return providerReadinessResult.summary.providerMessages[preferredProvider];
  }

  if (preferredProvider) {
    const matchingProvider = providerReadinessResult.summary.providers?.find((item) => item.provider === preferredProvider);
    if (matchingProvider?.state) {
      return matchingProvider.state;
    }
  }

  return providerReadinessResult.summary.verdict;
}

function advisoryAwareCheckMessage(result, message) {
  const advisories = result.summary.advisoryCodes ?? [];

  if (result.summary.verdict !== 'ready' || advisories.length === 0) {
    return message;
  }

  if (message && message !== 'ready' && message !== result.summary.verdict) {
    return message;
  }

  return `ready with advisories (${advisories.join(', ')})`;
}

function providerSyncQuotaSummary(providerSyncResult) {
  const preferredProvider = preferredProviderName(providerSyncResult);

  if (!preferredProvider) {
    return null;
  }

  const quotaCoverage = providerSyncResult.summary.providerQuotaCoverage?.[preferredProvider];
  if (!quotaCoverage || quotaCoverage === 'typed') {
    return null;
  }

  const quotaModelCount = providerSyncResult.summary.providerQuotaModelCounts?.[preferredProvider] ?? 0;
  if (quotaModelCount <= 0) {
    return `quota ${quotaCoverage}`;
  }

  const typedQuotaModelCount = providerSyncResult.summary.providerTypedQuotaModelCounts?.[preferredProvider] ?? 0;
  return `quota ${quotaCoverage}, typed ${typedQuotaModelCount}/${quotaModelCount}`;
}

function codexWrapperQuotaSummary(codexResult) {
  const quotaCoverage = codexResult.summary.quotaCoverage;
  if (!quotaCoverage || quotaCoverage === 'typed' || quotaCoverage === 'none') {
    return null;
  }

  const quotaModelCount = codexResult.summary.quotaModelCount ?? codexResult.summary.quotaDetails?.length ?? 0;
  if (quotaModelCount <= 0) {
    return `quota ${quotaCoverage}`;
  }

  const typedQuotaModelCount = codexResult.summary.typedQuotaModelCount ?? 0;
  return `quota ${quotaCoverage}, typed ${typedQuotaModelCount}/${quotaModelCount}`;
}

function rawCodexRateLimitSummary(appServerResult) {
  const rateLimitCoverage = appServerResult.summary.rateLimitCoverage;
  if (!rateLimitCoverage || rateLimitCoverage === 'typed') {
    return null;
  }

  if (rateLimitCoverage === 'none' && appServerResult.summary.state === 'available') {
    return null;
  }

  const rateLimitBucketCount = appServerResult.summary.rateLimitBucketCount ?? appServerResult.summary.rateLimitDetails?.length ?? 0;
  if (rateLimitBucketCount <= 0) {
    return `rate-limits ${rateLimitCoverage}`;
  }

  const typedRateLimitBucketCount = appServerResult.summary.typedRateLimitBucketCount ?? 0;
  return `rate-limits ${rateLimitCoverage}, typed ${typedRateLimitBucketCount}/${rateLimitBucketCount}`;
}

function preferredProviderDetail(summary) {
  const provider = summary.attentionProviders?.[0]
    ?? summary.blockedProviders?.[0]
    ?? summary.readyProviders?.[0]
    ?? summary.providers?.[0]?.provider;

  if (!provider) {
    return {
      provider: null,
      state: null,
      codes: [],
      message: summary.verdict,
    };
  }

  const providerItem = summary.providers?.find((item) => item.provider === provider);
  const kind = summary.providerKinds?.[provider] ?? providerItem?.kind ?? null;
  const source = summary.providerSources?.[provider] ?? providerItem?.source ?? null;
  const configured = summary.providerConfigured?.[provider] ?? providerItem?.configured;
  const secure = summary.providerSecure?.[provider] ?? providerItem?.secure;
  const validated = summary.providerValidated?.[provider] ?? providerItem?.validated;
  const lastModifiedAt = summary.providerLastModifiedAt?.[provider] ?? providerItem?.lastModifiedAt ?? null;
  const refreshedAt = summary.providerRefreshedAt?.[provider] ?? providerItem?.refreshedAt ?? null;
  const accountCount = summary.providerAccountCounts?.[provider] ?? providerItem?.accountCount ?? null;

  return {
    provider,
    state: summary.providerStates?.[provider] ?? null,
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(configured !== undefined ? { configured } : {}),
    ...(secure !== undefined ? { secure } : {}),
    ...(validated !== undefined ? { validated } : {}),
    ...(lastModifiedAt !== null ? { lastModifiedAt } : {}),
    ...(refreshedAt !== null ? { refreshedAt } : {}),
    ...(accountCount !== null ? { accountCount } : {}),
    codes: summary.providerCodes?.[provider] ?? [],
    message: summary.message
      ?? summary.providerMessages?.[provider]
      ?? summary.providers?.find((item) => item.provider === provider)?.state
      ?? summary.verdict,
  };
}

export function buildPreflightCheckDetails(
  operatorResult,
  providerReadinessResult,
  providerSyncResult,
  appServerResult,
  codexResult,
) {
  const readinessDetail = preferredProviderDetail(providerReadinessResult.summary);
  const syncDetail = preferredProviderDetail(providerSyncResult.summary);

  return {
    operator: operatorCheckDetail(operatorResult),
    provider_readiness: {
      ...readinessDetail,
      unvalidated: readinessDetail.provider
        ? (providerReadinessResult.summary.unvalidatedProviders ?? []).includes(readinessDetail.provider)
        : false,
    },
    provider_sync: {
      ...syncDetail,
      syncMethods: syncDetail.provider
        ? (providerSyncResult.summary.providerAccountSyncMethods?.[syncDetail.provider] ?? [])
        : [],
      accountSyncMethods: syncDetail.provider
        ? (providerSyncResult.summary.providerAccountSyncMethods?.[syncDetail.provider] ?? [])
      : [],
      syncModes: syncDetail.provider
        ? (providerSyncResult.summary.providerSyncModes?.[syncDetail.provider] ?? [])
        : [],
      syncBadges: syncDetail.provider
        ? (providerSyncResult.summary.providerSyncBadges?.[syncDetail.provider] ?? [])
        : [],
      rateLimitHosts: syncDetail.provider
        ? (providerSyncResult.summary.providerRateLimitHosts?.[syncDetail.provider] ?? [])
        : [],
      openaiAuth: syncDetail.provider
        ? (providerSyncResult.summary.providerOpenaiAuth?.[syncDetail.provider] ?? [])
        : [],
      quotaCoverage: syncDetail.provider
        ? (providerSyncResult.summary.providerQuotaCoverage?.[syncDetail.provider] ?? 'none')
        : 'none',
      quotaModelCount: syncDetail.provider
        ? (providerSyncResult.summary.providerQuotaModelCounts?.[syncDetail.provider] ?? 0)
        : 0,
      typedQuotaModelCount: syncDetail.provider
        ? (providerSyncResult.summary.providerTypedQuotaModelCounts?.[syncDetail.provider] ?? 0)
        : 0,
    },
    raw_codex_app_server: {
      verdict: appServerResult.summary.verdict ?? null,
      failureCodes: appServerResult.summary.failureCodes ?? [],
      advisoryCodes: appServerResult.summary.advisoryCodes ?? [],
      message: appServerResult.summary.message ?? formatRawStatus(appServerResult),
      userAgent: appServerResult.summary.userAgent ?? null,
      accountType: appServerResult.summary.accountType ?? null,
      plan: appServerResult.summary.plan ?? null,
      state: appServerResult.summary.state ?? null,
      rateLimitStatus: appServerResult.summary.rateLimitStatus ?? summarizeCodexAppServerError(appServerResult.stderr),
      rateLimitHost: appServerResult.summary.rateLimitHost ?? null,
      endpoint: appServerResult.summary.endpoint ?? null,
      openaiAuth: appServerResult.summary.openaiAuth ?? null,
      rateLimitDetails: appServerResult.summary.rateLimitDetails ?? [],
      rateLimitCoverage: appServerResult.summary.rateLimitCoverage ?? 'none',
      rateLimitBucketCount: appServerResult.summary.rateLimitBucketCount ?? 0,
      typedRateLimitBucketCount: appServerResult.summary.typedRateLimitBucketCount ?? 0,
    },
    codex_wrapper: {
      verdict: codexResult.summary.verdict ?? null,
      failureCodes: codexResult.summary.failureCodes ?? [],
      advisoryCodes: codexResult.summary.advisoryCodes ?? [],
      message: codexResult.summary.message ?? codexResult.summary.status ?? 'failed',
      account: codexResult.summary.account ?? null,
      refreshedAt: codexResult.summary.refreshedAt ?? null,
      refreshedDisplay: codexResult.summary.refreshedDisplay ?? null,
      state: codexResult.summary.state ?? null,
      source: codexResult.summary.source ?? null,
      rateLimitsHost: codexResult.summary.rateLimitsHost ?? null,
      openaiAuth: codexResult.summary.openaiAuth ?? null,
      plan: codexResult.summary.plan ?? null,
      credits: codexResult.summary.credits ?? null,
      ok: codexResult.summary.ok ?? false,
      quotaDetails: codexResult.summary.quotaDetails ?? [],
      quotaCoverage: codexResult.summary.quotaCoverage ?? 'none',
      quotaModelCount: codexResult.summary.quotaModelCount ?? 0,
      typedQuotaModelCount: codexResult.summary.typedQuotaModelCount ?? 0,
    },
  };
}

function providerClause(providerReadinessResult, providerSyncResult) {
  const parts = [];
  const readinessVerdict = providerReadinessResult.summary.verdict;
  const syncVerdict = providerSyncResult.summary.verdict;
  const syncAdvisories = providerSyncResult.summary.advisoryCodes ?? [];
  const readinessMessage = providerReadinessCheckMessage(providerReadinessResult);
  const readinessAdvisories = providerReadinessResult.summary.advisoryCodes ?? [];
  const syncMessage = providerSyncCheckMessage(providerSyncResult);
  const syncQuotaSummary = providerSyncQuotaSummary(providerSyncResult);
  const syncMessageHasQuotaSummary = Boolean(
    syncQuotaSummary
    && syncMessage
    && syncMessage.includes(`[${syncQuotaSummary}]`),
  );
  const readinessInformativeMessage = readinessMessage && readinessMessage !== 'ready' && readinessMessage !== readinessVerdict;
  const syncInformativeMessage = syncMessage && syncMessage !== 'ready' && syncMessage !== syncVerdict;
  const syncSummaryMessage = syncInformativeMessage ? syncMessage.replaceAll('; ', ', ') : syncMessage;
  const syncSummaryValue = syncInformativeMessage
    ? `${syncSummaryMessage}${syncQuotaSummary && !syncMessageHasQuotaSummary ? ` [${syncQuotaSummary}]` : ''}`
    : (syncQuotaSummary && !syncMessageHasQuotaSummary ? `${syncVerdict} [${syncQuotaSummary}]` : syncVerdict);

  if (readinessVerdict === 'ready' && readinessAdvisories.length > 0) {
    parts.push(
      readinessInformativeMessage
        ? `provider readiness=${readinessMessage}`
        : 'provider readiness=ready with advisories',
    );
  } else if (readinessVerdict === 'blocked' && readinessMessage && readinessMessage !== readinessVerdict) {
    parts.push(`provider readiness=${readinessMessage}`);
  } else if (readinessVerdict === 'attention_required' && readinessMessage && readinessMessage !== readinessVerdict) {
    parts.push(`provider readiness=${readinessMessage}`);
  } else if (readinessVerdict !== 'ready') {
    parts.push(`provider readiness=${readinessVerdict}`);
  }

  if (syncVerdict === 'ready' && syncAdvisories.length > 0) {
    parts.push(
      syncInformativeMessage
        ? `provider sync=${syncSummaryValue}`
        : 'provider sync=ready with advisories',
    );
  } else if (syncVerdict === 'ready' && (syncInformativeMessage || syncQuotaSummary)) {
    parts.push(`provider sync=${syncSummaryValue}`);
  } else if (syncVerdict === 'blocked' && syncMessage && syncMessage !== syncVerdict) {
    parts.push(`provider sync=${syncMessage}`);
  } else if (syncVerdict !== 'ready') {
    parts.push(`provider sync=${syncSummaryValue}`);
  }

  return parts.length > 0 ? `${parts.join('; ')}; ` : '';
}

export function buildPreflightCheckLists(codexMode, operatorResult, providerReadinessResult, providerSyncResult, appServerResult, codexResult) {
  const readyChecks = [];
  const attentionChecks = [];
  const blockedChecks = [];
  const rawDegraded = appServerResult.summary.rateLimitsAvailable === false
    || (appServerResult.summary.state !== undefined && appServerResult.summary.state !== 'available');

  if (operatorResult.code !== 0) {
    blockedChecks.push('operator');
  } else {
    readyChecks.push('operator');
  }

  if (providerReadinessResult.summary.verdict === 'blocked') {
    blockedChecks.push('provider_readiness');
  } else if (providerReadinessResult.summary.verdict === 'attention_required') {
    attentionChecks.push('provider_readiness');
  } else {
    readyChecks.push('provider_readiness');
  }

  if (providerSyncResult.summary.verdict === 'blocked') {
    blockedChecks.push('provider_sync');
  } else if (providerSyncResult.summary.verdict === 'attention_required') {
    attentionChecks.push('provider_sync');
  } else {
    readyChecks.push('provider_sync');
  }

  if (rawDegraded) {
    if (codexMode === 'require-rate-limits') {
      blockedChecks.push('raw_codex_app_server');
    } else {
      attentionChecks.push('raw_codex_app_server');
    }
  } else {
    readyChecks.push('raw_codex_app_server');
  }

  const wrapperState = codexWrapperCheckState(codexResult);
  if (wrapperState === 'blocked') {
    blockedChecks.push('codex_wrapper');
  } else if (wrapperState === 'attention_required') {
    attentionChecks.push('codex_wrapper');
  } else {
    readyChecks.push('codex_wrapper');
  }

  return {
    readyChecks,
    attentionChecks,
    blockedChecks,
  };
}

export function buildPreflightCheckStates(codexMode, operatorResult, providerReadinessResult, providerSyncResult, appServerResult, codexResult) {
  const { readyChecks, attentionChecks, blockedChecks } = buildPreflightCheckLists(
    codexMode,
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );

  const states = {};
  for (const check of readyChecks) {
    states[check] = 'ready';
  }
  for (const check of attentionChecks) {
    states[check] = 'attention_required';
  }
  for (const check of blockedChecks) {
    states[check] = 'blocked';
  }

  return states;
}

export function buildPreflightCheckCodes(codexMode, operatorResult, providerReadinessResult, providerSyncResult, appServerResult, codexResult) {
  const rawDegraded = appServerResult.summary.rateLimitsAvailable === false
    || (appServerResult.summary.state !== undefined && appServerResult.summary.state !== 'available');
  const operatorCodes = [...operatorFailureCodes(operatorResult)];
  const providerReadinessCodes = [
    ...(providerReadinessResult.summary.failureCodes ?? []),
    ...(providerReadinessResult.summary.advisoryCodes ?? []),
  ];
  const providerSyncCodes = [
    ...(providerSyncResult.summary.failureCodes ?? []),
    ...(providerSyncResult.summary.advisoryCodes ?? []),
  ];
  const rawCodes = [];
  const wrapperCodes = [];

  if (providerReadinessResult.summary.verdict === 'blocked') {
    providerReadinessCodes.push('provider_readiness_blocked');
  } else if (providerReadinessResult.summary.verdict === 'attention_required') {
    providerReadinessCodes.push('provider_readiness_attention_required');
  }

  if (rawDegraded) {
    rawCodes.push(codexMode === 'require-rate-limits' ? 'raw_codex_app_server_failed' : 'raw_codex_app_server_degraded');
  }

  const wrapperState = codexWrapperCheckState(codexResult);
  if (wrapperState === 'blocked') {
    wrapperCodes.push(...codexWrapperFailureCodes(codexResult));
  } else if (wrapperState === 'attention_required') {
    wrapperCodes.push(...codexWrapperAdvisoryCodes(codexResult));
  }

  return {
    operator: [...new Set(operatorCodes)],
    provider_readiness: [...new Set(providerReadinessCodes)],
    provider_sync: [...new Set(providerSyncCodes)],
    raw_codex_app_server: [...new Set(rawCodes)],
    codex_wrapper: [...new Set(wrapperCodes)],
  };
}

export function buildPreflightCheckMessages(
  operatorResult,
  providerReadinessResult,
  providerSyncResult,
  appServerResult,
  codexResult,
) {
  const providerReadinessMessage = advisoryAwareCheckMessage(
    providerReadinessResult,
    providerReadinessCheckMessage(providerReadinessResult),
  );
  const providerSyncBaseMessage = advisoryAwareCheckMessage(
    providerSyncResult,
    providerSyncCheckMessage(providerSyncResult),
  );
  const providerSyncSummary = providerSyncQuotaSummary(providerSyncResult);
  const providerSyncMessage = providerSyncResult.summary.message
    ? providerSyncBaseMessage
    : (providerSyncSummary
      && providerSyncBaseMessage
      && !providerSyncBaseMessage.includes(`[${providerSyncSummary}]`)
        ? `${providerSyncBaseMessage} [${providerSyncSummary}]`
        : providerSyncBaseMessage);
  const rawStatusBase = appServerResult.summary.message ?? formatRawStatus(appServerResult);
  const rawSummary = rawCodexRateLimitSummary(appServerResult);
  const rawStatus = appServerResult.summary.message
    ? rawStatusBase
    : (rawSummary
      && rawStatusBase
      && !rawStatusBase.includes(`[${rawSummary}]`)
        ? `${rawStatusBase} [${rawSummary}]`
        : rawStatusBase);
  const wrapperStatusBase = codexResult.summary.message ?? codexResult.summary.status ?? 'failed';
  const wrapperSummary = codexWrapperQuotaSummary(codexResult);
  const wrapperStatus = codexResult.summary.message
    ? wrapperStatusBase
    : (wrapperSummary
      && wrapperStatusBase
      && !wrapperStatusBase.includes(`[${wrapperSummary}]`)
        ? `${wrapperStatusBase} [${wrapperSummary}]`
        : wrapperStatusBase);

  return {
    operator: operatorCheckMessage(operatorResult),
    provider_readiness: providerReadinessMessage,
    provider_sync: providerSyncMessage,
    raw_codex_app_server: rawStatus,
    codex_wrapper: wrapperStatus,
  };
}

export function buildPreflightCodes(codexMode, operatorResult, providerReadinessResult, providerSyncResult, appServerResult, codexResult) {
  const failureCodes = [
    ...operatorFailureCodes(operatorResult),
    ...(providerReadinessResult.summary.failureCodes ?? []),
    ...(providerSyncResult.summary.failureCodes ?? []),
  ];
  const advisoryCodes = [
    ...(providerReadinessResult.summary.advisoryCodes ?? []),
    ...(providerSyncResult.summary.advisoryCodes ?? []),
  ];
  const rawDegraded = appServerResult.summary.rateLimitsAvailable === false
    || (appServerResult.summary.state !== undefined && appServerResult.summary.state !== 'available');

  if (providerReadinessResult.summary.verdict === 'blocked') {
    failureCodes.push('provider_readiness_blocked');
  } else if (providerReadinessResult.summary.verdict === 'attention_required') {
    advisoryCodes.push('provider_readiness_attention_required');
  }

  if (rawDegraded) {
    if (codexMode === 'require-rate-limits') {
      failureCodes.push('raw_codex_app_server_failed');
    } else {
      advisoryCodes.push('raw_codex_app_server_degraded');
    }
  }

  const wrapperState = codexWrapperCheckState(codexResult);
  if (wrapperState === 'blocked') {
    failureCodes.push(...codexWrapperFailureCodes(codexResult));
  } else if (wrapperState === 'attention_required') {
    advisoryCodes.push(...codexWrapperAdvisoryCodes(codexResult));
  }

  return {
    failureCodes: [...new Set(failureCodes)],
    advisoryCodes: [...new Set(advisoryCodes)],
  };
}

export function buildPreflightSummary(
  codexMode,
  operatorResult,
  providerReadinessResult,
  providerSyncResult,
  appServerResult,
  codexResult,
  failureCodes,
) {
  const rawStatus = formatRawStatus(appServerResult);
  const rawRateLimitSummary = rawCodexRateLimitSummary(appServerResult);
  const rawSummaryValue = rawRateLimitSummary ? `${rawStatus} [${rawRateLimitSummary}]` : rawStatus;
  const wrapperStatus = codexResult.summary.status ?? 'failed';
  const wrapperQuotaSummary = codexWrapperQuotaSummary(codexResult);
  const wrapperSummaryValue = wrapperQuotaSummary ? `${wrapperStatus} [${wrapperQuotaSummary}]` : wrapperStatus;
  const operatorMessage = operatorCheckMessage(operatorResult);
  const operatorSummaryMessage = operatorMessage.replaceAll('; ', ', ');
  const providerPrefix = providerClause(providerReadinessResult, providerSyncResult);
  const operatorPrefix = `operator=${operatorSummaryMessage}; `;

  if (failureCodes.length > 0) {
    return `blocked; ${operatorPrefix}${providerPrefix}raw Codex status=${rawSummaryValue}; wrapper status=${wrapperSummaryValue}`;
  }

  if (
    providerReadinessResult.summary.verdict === 'ready'
    && providerSyncResult.summary.verdict === 'ready'
    && rawStatus === 'available'
    && wrapperStatus === 'full rate-limits available'
  ) {
    return codexMode === 'require-rate-limits'
      ? `ready for strict rollout; ${operatorPrefix}${providerPrefix}raw Codex status=${rawSummaryValue}; wrapper status=${wrapperSummaryValue}.`
      : `ready; ${operatorPrefix}${providerPrefix}raw Codex status=${rawSummaryValue}; wrapper status=${wrapperSummaryValue}.`;
  }

  return `degraded but acceptable; ${operatorPrefix}${providerPrefix}raw Codex status=${rawSummaryValue}; wrapper status=${wrapperSummaryValue}`;
}

export function preflightVerdict(summary) {
  if (summary.startsWith('ready')) {
    return 'ready';
  }

  if (summary.startsWith('degraded but acceptable')) {
    return 'degraded_but_acceptable';
  }

  return 'blocked';
}
