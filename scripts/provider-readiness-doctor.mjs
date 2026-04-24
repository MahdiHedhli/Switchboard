import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import { applyLocalBrokerDefaults } from './local-broker-launch.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultSnapshotDir = path.join(repoRoot, '.switchboard', 'provider-snapshots');
const supportedProviders = ['openai', 'anthropic', 'google'];
const blockedStates = new Set(['command_invalid', 'snapshot_insecure', 'snapshot_invalid', 'snapshot_error']);
const readyStates = new Set(['trusted_command_ready', 'snapshot_ready']);
const failureCodeByState = {
  command_invalid: 'provider_command_invalid',
  snapshot_insecure: 'provider_snapshot_insecure',
  snapshot_invalid: 'provider_snapshot_invalid',
  snapshot_error: 'provider_snapshot_error',
};
const advisoryCodeByState = {
  snapshot_missing: 'provider_snapshot_missing',
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
      throw new Error(`Usage: node scripts/provider-readiness-doctor.mjs [openai|anthropic|google ...] [--json]`);
    }

    providers.push(arg);
  }

  return {
    json,
    providers: providers.length > 0 ? providers : supportedProviders,
  };
}

async function loadBrokerAdapterModules() {
  const importModule = async (relativePath) => {
    const url = pathToFileURL(path.join(repoRoot, relativePath)).href;
    return import(url);
  };

  const [{ openaiAdapter }, { anthropicAdapter }, { googleAdapter }, { AdapterRefreshError }] = await Promise.all([
    importModule('apps/broker/dist/adapters/openai.js'),
    importModule('apps/broker/dist/adapters/anthropic.js'),
    importModule('apps/broker/dist/adapters/google.js'),
    importModule('apps/broker/dist/adapters/types.js'),
  ]);

  return {
    AdapterRefreshError,
    adapters: {
      openai: openaiAdapter,
      anthropic: anthropicAdapter,
      google: googleAdapter,
    },
  };
}

async function evaluateProvider(provider, adapter, snapshotDir, AdapterRefreshError) {
  const status = await adapter.getStatus(snapshotDir);

  if (status.kind === 'trusted-command') {
    return {
      provider,
      kind: status.kind,
      state: status.configured && status.secure ? 'trusted_command_ready' : 'command_invalid',
      source: status.source,
      configured: status.configured,
      secure: status.secure,
      validated: false,
      problem: status.problem,
      lastModifiedAt: status.lastModifiedAt ?? null,
      accountCount: null,
    };
  }

  if (!status.configured) {
    return {
      provider,
      kind: status.kind,
      state: 'snapshot_missing',
      source: status.source,
      configured: false,
      secure: false,
      validated: false,
      problem: status.problem ?? 'No sanitized snapshot file found yet.',
      lastModifiedAt: null,
      accountCount: null,
    };
  }

  if (!status.secure) {
    return {
      provider,
      kind: status.kind,
      state: 'snapshot_insecure',
      source: status.source,
      configured: true,
      secure: false,
      validated: false,
      problem: status.problem ?? 'Snapshot file permissions are too open.',
      lastModifiedAt: status.lastModifiedAt ?? null,
      accountCount: null,
    };
  }

  try {
    const refresh = await adapter.refresh(snapshotDir);
    return {
      provider,
      kind: status.kind,
      state: 'snapshot_ready',
      source: status.source,
      configured: true,
      secure: true,
      validated: true,
      problem: undefined,
      lastModifiedAt: status.lastModifiedAt ?? null,
      accountCount: refresh.subscriptions.length,
    };
  } catch (error) {
    if (error instanceof AdapterRefreshError) {
      const state = error.code === 'invalid_snapshot' ? 'snapshot_invalid' : 'snapshot_error';
      return {
        provider,
        kind: status.kind,
        state,
        source: status.source,
        configured: true,
        secure: true,
        validated: true,
        problem: error.message,
        lastModifiedAt: status.lastModifiedAt ?? null,
        accountCount: null,
      };
    }

    throw error;
  }
}

function buildVerdict(items) {
  if (items.some((item) => blockedStates.has(item.state))) {
    return 'blocked';
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

function unique(values) {
  return [...new Set(values)];
}

function blockedProviders(items) {
  return items.filter((item) => blockedStates.has(item.state)).map((item) => item.provider);
}

function attentionProviders(items) {
  return items.filter((item) => !readyStates.has(item.state)).map((item) => item.provider);
}

function readyProviders(items) {
  return items.filter((item) => readyStates.has(item.state)).map((item) => item.provider);
}

function unvalidatedProviders(items) {
  return items.filter((item) => item.validated === false).map((item) => item.provider);
}

function failureCodes(items) {
  return unique(
    items
      .map((item) => failureCodeByState[item.state])
      .filter(Boolean),
  );
}

function advisoryCodes(items) {
  const codes = unique(
    items
      .map((item) => advisoryCodeByState[item.state])
      .filter(Boolean),
  );

  if (items.some((item) => item.state === 'trusted_command_ready' && item.validated === false)) {
    codes.push('provider_trusted_command_unvalidated');
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

function providerValidated(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.validated]));
}

function providerLastModifiedAt(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.lastModifiedAt]));
}

function providerAccountCounts(items) {
  return Object.fromEntries(items.map((item) => [item.provider, item.accountCount]));
}

function codesForProvider(item) {
  const codes = [];

  if (failureCodeByState[item.state]) {
    codes.push(failureCodeByState[item.state]);
  }
  if (advisoryCodeByState[item.state]) {
    codes.push(advisoryCodeByState[item.state]);
  }
  if (item.state === 'trusted_command_ready' && item.validated === false) {
    codes.push('provider_trusted_command_unvalidated');
  }

  return unique(codes);
}

function providerCodes(items) {
  return Object.fromEntries(items.map((item) => [item.provider, codesForProvider(item)]));
}

function messageForProvider(item) {
  if (item.state === 'trusted_command_ready' && item.validated === false) {
    return 'trusted_command_ready (unvalidated)';
  }

  if (item.problem) {
    return item.problem;
  }

  return item.state;
}

function providerMessages(items) {
  return Object.fromEntries(items.map((item) => [item.provider, messageForProvider(item)]));
}

function preferredProviderItem(items) {
  return items.find((item) => blockedStates.has(item.state))
    ?? items.find((item) => !readyStates.has(item.state))
    ?? items.find((item) => readyStates.has(item.state))
    ?? items[0]
    ?? null;
}

function summaryMessage(items) {
  const item = preferredProviderItem(items);
  return item ? messageForProvider(item) : 'attention_required';
}

function printSummary(summary) {
  console.log('Provider readiness:');
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
  if (summary.unvalidatedProviders.length > 0) {
    console.log(`  unvalidatedProviders: ${summary.unvalidatedProviders.join(', ')}`);
  }
  for (const item of summary.providers) {
    const message = summary.providerMessages?.[item.provider] ?? item.state;
    console.log(`  ${item.provider}: ${message} (${item.kind})`);
    console.log(`    source: ${item.source}`);
    console.log(`    configured: ${item.configured ? 'yes' : 'no'}`);
    console.log(`    secure: ${item.secure ? 'yes' : 'no'}`);
    console.log(`    validated: ${item.validated ? 'yes' : 'no'}`);
    if (message !== item.state) {
      console.log(`    state: ${item.state}`);
    }
    if (item.accountCount !== null) {
      console.log(`    accounts: ${item.accountCount}`);
    }
    if (item.lastModifiedAt) {
      console.log(`    lastModifiedAt: ${item.lastModifiedAt}`);
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
  const { adapters, AdapterRefreshError } = await loadBrokerAdapterModules();

  const items = [];
  for (const provider of providers) {
    items.push(await evaluateProvider(provider, adapters[provider], snapshotDir, AdapterRefreshError));
  }

  const summary = {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'provider-readiness',
    snapshotDir,
    verdict: buildVerdict(items),
    failureCodes: failureCodes(items),
    advisoryCodes: advisoryCodes(items),
    blockedProviders: blockedProviders(items),
    attentionProviders: attentionProviders(items),
    readyProviders: readyProviders(items),
    unvalidatedProviders: unvalidatedProviders(items),
    providerStates: providerStates(items),
    providerKinds: providerKinds(items),
    providerSources: providerSources(items),
    providerConfigured: providerConfigured(items),
    providerSecure: providerSecure(items),
    providerValidated: providerValidated(items),
    providerLastModifiedAt: providerLastModifiedAt(items),
    providerAccountCounts: providerAccountCounts(items),
    providerCodes: providerCodes(items),
    providerMessages: providerMessages(items),
    message: summaryMessage(items),
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
