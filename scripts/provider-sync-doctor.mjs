import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import { applyLocalBrokerDefaults } from './local-broker-launch.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultSnapshotDir = path.join(repoRoot, '.switchboard', 'provider-snapshots');
const supportedProviders = ['openai', 'anthropic', 'google'];
const blockedStates = new Set([
  'snapshot_missing',
  'snapshot_insecure',
  'snapshot_invalid',
  'snapshot_error',
  'command_invalid',
  'command_failed',
  'command_timeout',
]);
const readyStates = new Set(['snapshot_succeeded', 'trusted_command_succeeded']);
const attentionStates = new Set(['trusted_command_degraded']);
const failureCodeByState = {
  snapshot_missing: 'provider_snapshot_missing',
  snapshot_insecure: 'provider_snapshot_insecure',
  snapshot_invalid: 'provider_snapshot_invalid',
  snapshot_error: 'provider_snapshot_error',
  command_invalid: 'provider_command_invalid',
  command_failed: 'provider_command_failed',
  command_timeout: 'provider_command_timeout',
};

function parseArgs(argv) {
  const providers = [];
  let json = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (!supportedProviders.includes(arg)) {
      throw new Error(`Usage: node scripts/provider-sync-doctor.mjs [openai|anthropic|google ...] [--json]`);
    }

    providers.push(arg);
  }

  return {
    json,
    providers: providers.length > 0 ? providers : supportedProviders,
  };
}

async function loadModules() {
  const importModule = async (relativePath) => {
    const url = pathToFileURL(path.join(repoRoot, relativePath)).href;
    return import(url);
  };

  const [
    { openaiAdapter },
    { anthropicAdapter },
    { googleAdapter },
    { AdapterRefreshError },
    { buildAdapterRefreshConflictDetail },
    { formatProviderSyncSummaryDisplayMessage, summarizeProviderSyncAccounts },
  ] = await Promise.all([
    importModule('apps/broker/dist/adapters/openai.js'),
    importModule('apps/broker/dist/adapters/anthropic.js'),
    importModule('apps/broker/dist/adapters/google.js'),
    importModule('apps/broker/dist/adapters/types.js'),
    importModule('apps/broker/dist/adapter-conflict.js'),
    importModule('packages/core/dist/index.js'),
  ]);

  return {
    AdapterRefreshError,
    buildAdapterRefreshConflictDetail,
    formatProviderSyncSummaryDisplayMessage,
    summarizeProviderSyncAccounts,
    adapters: {
      openai: openaiAdapter,
      anthropic: anthropicAdapter,
      google: googleAdapter,
    },
  };
}

function unique(values) {
  return [...new Set(values)];
}

async function evaluateProvider(
  provider,
  adapter,
  snapshotDir,
  AdapterRefreshError,
  buildAdapterRefreshConflictDetail,
  summarizeProviderSyncAccounts,
) {
  const status = await adapter.getStatus(snapshotDir);

  try {
    const refresh = await adapter.refresh(snapshotDir);
    const syncSummary = summarizeProviderSyncAccounts(refresh.subscriptions);

    return {
      provider,
      kind: refresh.kind,
      state: refresh.kind === 'trusted-command'
        ? (syncSummary.degraded ? 'trusted_command_degraded' : 'trusted_command_succeeded')
        : 'snapshot_succeeded',
      source: status.source,
      configured: status.configured,
      secure: status.secure,
      accountCount: refresh.subscriptions.length,
      refreshedAt: refresh.refreshedAt,
      syncMethods: unique(refresh.subscriptions.map((entry) => entry.syncMethod).filter(Boolean)),
      degraded: syncSummary.degraded,
      syncModes: syncSummary.syncModes,
      syncBadges: syncSummary.syncBadges,
      rateLimitHosts: syncSummary.rateLimitHosts,
      openaiAuth: syncSummary.openaiAuth,
      quotaCoverage: syncSummary.quotaCoverage,
      quotaModelCount: syncSummary.quotaModels,
      typedQuotaModelCount: syncSummary.typedQuotaModels,
    };
  } catch (error) {
    if (error instanceof AdapterRefreshError) {
      return {
        provider,
        kind: status.kind,
        state: error.code,
        source: status.source,
        configured: status.configured,
        secure: status.secure,
        accountCount: null,
        refreshedAt: null,
        syncMethods: [],
        degraded: false,
        syncModes: [],
        syncBadges: [],
        rateLimitHosts: [],
        openaiAuth: [],
        quotaCoverage: 'none',
        quotaModelCount: 0,
        typedQuotaModelCount: 0,
        problem: buildAdapterRefreshConflictDetail(error),
      };
    }

    throw error;
  }
}

function buildVerdict(items) {
  if (items.some((item) => blockedStates.has(item.state))) {
    return 'blocked';
  }

  if (items.some((item) => attentionStates.has(item.state))) {
    return 'attention_required';
  }

  if (items.every((item) => readyStates.has(item.state))) {
    return 'ready';
  }

  return 'attention_required';
}

function stateCounts(items) {
  return items.reduce((counts, item) => {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, {});
}

function blockedProviders(items) {
  return items.filter((item) => blockedStates.has(item.state)).map((item) => item.provider);
}

function attentionProviders(items) {
  return items.filter((item) => attentionStates.has(item.state)).map((item) => item.provider);
}

function readyProviders(items) {
  return items.filter((item) => readyStates.has(item.state)).map((item) => item.provider);
}

function failureCodes(items) {
  return unique(
    items
      .map((item) => failureCodeByState[item.state])
      .filter(Boolean),
  );
}

function advisoryCodes(items) {
  const codes = [];

  if (items.some((item) => item.state === 'trusted_command_degraded')) {
    codes.push('provider_sync_degraded');
  }
  if (items.some((item) => item.state === 'snapshot_succeeded')) {
    codes.push('provider_snapshot_only');
  }

  return unique(codes);
}

function providerStates(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.state]));
}

function providerKinds(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.kind]));
}

function providerSources(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.source]));
}

function providerConfigured(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.configured]));
}

function providerSecure(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.secure]));
}

function providerAccountCounts(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.accountCount]));
}

function providerRefreshedAt(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.refreshedAt]));
}

function codesForProvider(item) {
  const codes = [];

  if (failureCodeByState[item.state]) {
    codes.push(failureCodeByState[item.state]);
  }
  if (item.state === 'trusted_command_degraded') {
    codes.push('provider_sync_degraded');
  }
  if (item.state === 'snapshot_succeeded') {
    codes.push('provider_snapshot_only');
  }

  return unique(codes);
}

function providerCodes(items) {
  return Object.fromEntries(items.map((item) => [item.provider, codesForProvider(item)]));
}

function messageForProvider(item, formatProviderSyncSummaryDisplayMessage) {
  if (item.problem) {
    return item.problem;
  }

  return formatProviderSyncSummaryDisplayMessage({
    syncBadges: item.syncBadges,
    syncModes: item.syncModes,
    degraded: item.degraded,
    accountSyncMethods: item.syncMethods,
  }) ?? item.state;
}

function providerMessages(items, formatProviderSyncSummaryDisplayMessage) {
  return Object.fromEntries(
    items.map((item) => [item.provider, messageForProvider(item, formatProviderSyncSummaryDisplayMessage)]),
  );
}

function providerSyncModes(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.syncModes]));
}

function providerSyncBadges(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.syncBadges]));
}

function providerAccountSyncMethods(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.syncMethods]));
}

function providerRateLimitHosts(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.rateLimitHosts]));
}

function providerOpenaiAuth(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.openaiAuth]));
}

function providerQuotaCoverage(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.quotaCoverage]));
}

function providerQuotaModelCounts(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.quotaModelCount]));
}

function providerTypedQuotaModelCounts(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.typedQuotaModelCount]));
}

function quotaSummaryForProvider(item) {
  if (item.problem) {
    return null;
  }

  if (!item.quotaCoverage || item.quotaCoverage === 'typed' || item.quotaCoverage === 'none') {
    return null;
  }

  if (item.quotaModelCount <= 0) {
    return `quota ${item.quotaCoverage}`;
  }

  return `quota ${item.quotaCoverage}, typed ${item.typedQuotaModelCount}/${item.quotaModelCount}`;
}

function preferredProviderItem(items) {
  return items.find((item) => blockedStates.has(item.state))
    ?? items.find((item) => attentionStates.has(item.state))
    ?? items.find((item) => readyStates.has(item.state))
    ?? items[0]
    ?? null;
}

function summaryMessage(items, formatProviderSyncSummaryDisplayMessage) {
  const item = preferredProviderItem(items);
  if (!item) {
    return 'attention_required';
  }

  const message = messageForProvider(item, formatProviderSyncSummaryDisplayMessage);
  const quotaSummary = quotaSummaryForProvider(item);
  return quotaSummary ? `${message} [${quotaSummary}]` : message;
}

function printSummary(summary) {
  console.log('Provider sync:');
  console.log(`  snapshot dir: ${summary.snapshotDir}`);
  console.log(`  verdict: ${summary.verdict}`);
  if (summary.message) {
    console.log(`  message: ${summary.message}`);
  }
  if (summary.failureCodes.length > 0) {
    console.log(`  failureCodes: ${summary.failureCodes.join(', ')}`);
  }
  if (summary.advisoryCodes.length > 0) {
    console.log(`  advisoryCodes: ${summary.advisoryCodes.join(', ')}`);
  }
  if (summary.blockedProviders.length > 0) {
    console.log(`  blockedProviders: ${summary.blockedProviders.join(', ')}`);
  }
  if (summary.attentionProviders.length > 0) {
    console.log(`  attentionProviders: ${summary.attentionProviders.join(', ')}`);
  }
  for (const item of summary.providers) {
    const message = summary.providerMessages?.[item.provider] ?? item.state;
    console.log(`  ${item.provider}: ${message} (${item.kind})`);
    console.log(`    source: ${item.source}`);
    console.log(`    configured: ${item.configured ? 'yes' : 'no'}`);
    console.log(`    secure: ${item.secure ? 'yes' : 'no'}`);
    if (message !== item.state) {
      console.log(`    state: ${item.state}`);
    }
    if (item.accountCount !== null) {
      console.log(`    accounts: ${item.accountCount}`);
    }
    if (item.refreshedAt) {
      console.log(`    refreshedAt: ${item.refreshedAt}`);
    }
    if (item.syncMethods.length > 0) {
      console.log(`    syncMethods: ${item.syncMethods.join(', ')}`);
    }
    if (item.syncModes.length > 0) {
      console.log(`    syncModes: ${item.syncModes.join(', ')}`);
    }
    if (item.syncBadges.length > 0) {
      console.log(`    syncBadges: ${item.syncBadges.join(' | ')}`);
    }
    if (item.rateLimitHosts.length > 0) {
      console.log(`    rateLimitHosts: ${item.rateLimitHosts.join(', ')}`);
    }
    if (item.openaiAuth.length > 0) {
      console.log(`    openaiAuth: ${item.openaiAuth.join(', ')}`);
    }
    console.log(`    quotaCoverage: ${item.quotaCoverage}`);
    if (item.quotaModelCount > 0) {
      console.log(`    typedQuotaModels: ${item.typedQuotaModelCount}/${item.quotaModelCount}`);
    }
    if (item.problem && item.problem !== message) {
      console.log(`    problem: ${item.problem}`);
    }
  }
}

async function main() {
  const { providers, json } = parseArgs(process.argv);
  await applyLocalBrokerDefaults(process.env, { repoRootPath: repoRoot });
  const snapshotDir = process.env.SWITCHBOARD_SNAPSHOT_DIR ?? defaultSnapshotDir;
  const {
    adapters,
    AdapterRefreshError,
    buildAdapterRefreshConflictDetail,
    formatProviderSyncSummaryDisplayMessage,
    summarizeProviderSyncAccounts,
  } = await loadModules();

  const items = [];
  for (const provider of providers) {
    items.push(
      await evaluateProvider(
        provider,
        adapters[provider],
        snapshotDir,
        AdapterRefreshError,
        buildAdapterRefreshConflictDetail,
        summarizeProviderSyncAccounts,
      ),
    );
  }

  const summary = {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'provider-sync',
    snapshotDir,
    verdict: buildVerdict(items),
    failureCodes: failureCodes(items),
    advisoryCodes: advisoryCodes(items),
    blockedProviders: blockedProviders(items),
    attentionProviders: attentionProviders(items),
    readyProviders: readyProviders(items),
    providerStates: providerStates(items),
    providerKinds: providerKinds(items),
    providerSources: providerSources(items),
    providerConfigured: providerConfigured(items),
    providerSecure: providerSecure(items),
    providerAccountCounts: providerAccountCounts(items),
    providerRefreshedAt: providerRefreshedAt(items),
    providerCodes: providerCodes(items),
    providerMessages: providerMessages(items, formatProviderSyncSummaryDisplayMessage),
    providerAccountSyncMethods: providerAccountSyncMethods(items),
    providerSyncModes: providerSyncModes(items),
    providerSyncBadges: providerSyncBadges(items),
    providerRateLimitHosts: providerRateLimitHosts(items),
    providerOpenaiAuth: providerOpenaiAuth(items),
    providerQuotaCoverage: providerQuotaCoverage(items),
    providerQuotaModelCounts: providerQuotaModelCounts(items),
    providerTypedQuotaModelCounts: providerTypedQuotaModelCounts(items),
    message: summaryMessage(items, formatProviderSyncSummaryDisplayMessage),
    stateCounts: stateCounts(items),
    providers: items,
  };

  if (json) {
    console.log(JSON.stringify(summary));
  } else {
    printSummary(summary);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
