import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quotaDisplayLines } from './codex-quota-display.mjs';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import { buildLocalBrokerEnvironment } from './local-broker-launch.mjs';
import {
  buildPreflightCheckLists,
  buildPreflightCheckCodes,
  buildPreflightCheckDetails,
  buildPreflightCheckMessages,
  buildPreflightCheckStates,
  buildPreflightCodes,
  buildPreflightSummary,
  preflightVerdict,
} from './preflight-contract.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const operatorDoctorEntry = path.join(repoRoot, 'scripts/operator-readiness-smoke.mjs');
const providerReadinessDoctorEntry = path.join(repoRoot, 'scripts/provider-readiness-doctor.mjs');
const providerSyncDoctorEntry = path.join(repoRoot, 'scripts/provider-sync-doctor.mjs');
const codexAppServerDoctorEntry = path.join(repoRoot, 'scripts/codex-app-server-doctor.mjs');
const codexDoctorEntry = path.join(repoRoot, 'scripts/codex-doctor.mjs');

function parseArgs(argv) {
  let profile = 'local-only';
  let codexMode = 'allow-fallback';
  let json = false;
  let profileSet = false;
  let modeSet = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (!profileSet && (arg === 'local-only' || arg === 'remote-trusted')) {
      profile = arg;
      profileSet = true;
      continue;
    }

    if (
      !modeSet
      && (
        arg === 'allow-fallback'
        || arg === '--allow-fallback'
        || arg === 'require-rate-limits'
        || arg === '--require-rate-limits'
      )
    ) {
      codexMode = arg.startsWith('--') ? arg.slice(2) : arg;
      modeSet = true;
      continue;
    }

    throw new Error(
      'Usage: node scripts/preflight-doctor.mjs <local-only|remote-trusted> [allow-fallback|require-rate-limits|--allow-fallback|--require-rate-limits] [--json]',
    );
  }

  return { profile, codexMode, json };
}

function runNodeScript(scriptPath, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
      });
    });
  });
}

async function runJsonNodeScript(scriptPath, args, env = process.env) {
  const result = await runNodeScript(scriptPath, [...args, '--json'], env);
  const detail = result.stdout.trim();
  if (!detail) {
    throw new Error(`Expected JSON output from ${path.basename(scriptPath)} but received none.`);
  }

  try {
    return {
      ...result,
      summary: JSON.parse(detail),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON output from ${path.basename(scriptPath)}: ${message}`);
  }
}

function printStep(title, result) {
  console.log(`${title}:`);
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function rawCodexMode(codexMode) {
  return codexMode === 'require-rate-limits' ? 'require-rate-limits' : 'allow-degraded';
}

function printCodexAppServerStep(result) {
  console.log('codex-app-server:');
  console.log('Codex app-server doctor:');
  if (result.summary.verdict) {
    console.log(`  verdict: ${result.summary.verdict}`);
  }
  if (result.summary.message) {
    console.log(`  message: ${result.summary.message}`);
  }
  if ((result.summary.failureCodes?.length ?? 0) > 0) {
    console.log(`  failureCodes: ${result.summary.failureCodes.join(', ')}`);
  }
  if ((result.summary.advisoryCodes?.length ?? 0) > 0) {
    console.log(`  advisoryCodes: ${result.summary.advisoryCodes.join(', ')}`);
  }
  console.log(`  user agent: ${result.summary.userAgent}`);
  console.log(`  account type: ${result.summary.accountType}`);
  console.log(`  plan: ${result.summary.plan}`);
  console.log(`  openai auth: ${result.summary.openaiAuth}`);
  console.log(`  rate limits: ${result.summary.rateLimitStatus}`);
  console.log(`  rate-limit coverage: ${result.summary.rateLimitCoverage}`);
  if ((result.summary.rateLimitBucketCount ?? 0) > 0) {
    console.log(
      `  typed rate-limit buckets: ${result.summary.typedRateLimitBucketCount}/${result.summary.rateLimitBucketCount}`,
    );
  }
  if (result.summary.rateLimitHost) {
    console.log(`  rate-limit host: ${result.summary.rateLimitHost}`);
  }
  if (result.summary.endpoint) {
    console.log(`  rate-limit endpoint: ${result.summary.endpoint}`);
  }
  if (result.summary.limitIds.length > 0) {
    console.log(`  limit ids: ${result.summary.limitIds.join(', ')}`);
  }
  for (const line of quotaDisplayLines(result.summary.rateLimitDetails ?? [], { headingLabel: 'rate-limit bucket' })) {
    console.log(`  ${line}`);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function printCodexStep(result) {
  console.log('codex:');
  console.log('Codex doctor:');
  if (result.summary.verdict) {
    console.log(`  verdict: ${result.summary.verdict}`);
  }
  if (result.summary.message) {
    console.log(`  message: ${result.summary.message}`);
  }
  if ((result.summary.failureCodes?.length ?? 0) > 0) {
    console.log(`  failureCodes: ${result.summary.failureCodes.join(', ')}`);
  }
  if ((result.summary.advisoryCodes?.length ?? 0) > 0) {
    console.log(`  advisoryCodes: ${result.summary.advisoryCodes.join(', ')}`);
  }
  console.log(`  account: ${result.summary.account}`);
  console.log(`  refreshed: ${result.summary.refreshedDisplay}`);
  console.log(`  source: ${result.summary.source}`);
  console.log(`  status: ${result.summary.status}`);
  console.log(`  plan: ${result.summary.plan}`);
  console.log(`  quota coverage: ${result.summary.quotaCoverage}`);
  if ((result.summary.quotaModelCount ?? 0) > 0) {
    console.log(`  typed quota models: ${result.summary.typedQuotaModelCount}/${result.summary.quotaModelCount}`);
  }
  if (result.summary.openaiAuth) {
    console.log(`  openai auth: ${result.summary.openaiAuth}`);
  }
  if (result.summary.credits) {
    console.log(`  credits: ${result.summary.credits}`);
  }
  const quotaLines = quotaDisplayLines(result.summary.quotaDetails);
  if (quotaLines.length > 0) {
    for (const line of quotaLines) {
      console.log(`  ${line}`);
    }
    return;
  }
  for (const quota of result.summary.quotas) {
    console.log(`  quota: ${quota}`);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function printOperatorStep(result) {
  console.log('operator:');
  console.log(`Operator readiness (${result.summary.profile}):`);
  if (result.summary.verdict) {
    console.log(`  verdict: ${result.summary.verdict}`);
  }
  if (result.summary.message) {
    console.log(`  message: ${result.summary.message}`);
  }
  if ((result.summary.failureCodes?.length ?? 0) > 0) {
    console.log(`  failureCodes: ${result.summary.failureCodes.join(', ')}`);
  }
  console.log(`  host: ${result.summary.host}`);
  console.log(`  localOnly: ${result.summary.localOnly ? 'yes' : 'no'}`);
  console.log(`  allowRemote: ${result.summary.allowRemote ? 'yes' : 'no'}`);
  console.log(`  operatorTokenConfigured: ${result.summary.operatorTokenConfigured ? 'yes' : 'no'}`);
  if (result.summary.operatorTokenSource) {
    console.log(`  operatorTokenSource: ${result.summary.operatorTokenSource}`);
  }
  if (result.summary.operatorTokenFile) {
    console.log(`  operatorTokenFile: ${result.summary.operatorTokenFile}`);
  }
  if (result.summary.operatorTokenProblem) {
    console.log(`  operatorTokenProblem: ${result.summary.operatorTokenProblem}`);
  }
  console.log(
    `  manualSubscriptionReplaceEnabled: ${result.summary.manualSubscriptionReplaceEnabled ? 'yes' : 'no'}`,
  );
  console.log(`  taskCreate: ${result.summary.scopes.taskCreate}`);
  console.log(`  taskUpdate: ${result.summary.scopes.taskUpdate}`);
  console.log(`  subscriptionRefresh: ${result.summary.scopes.subscriptionRefresh}`);
  console.log(`  subscriptionReplace: ${result.summary.scopes.subscriptionReplace}`);
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function printProviderReadinessStep(result) {
  console.log('provider-readiness:');
  console.log(`Provider readiness (${result.summary.providers.map((item) => item.provider).join(', ')}):`);
  console.log(`  verdict: ${result.summary.verdict}`);
  if (result.summary.message) {
    console.log(`  message: ${result.summary.message}`);
  }
  if (result.summary.failureCodes.length > 0) {
    console.log(`  failureCodes: ${result.summary.failureCodes.join(', ')}`);
  }
  if (result.summary.advisoryCodes.length > 0) {
    console.log(`  advisoryCodes: ${result.summary.advisoryCodes.join(', ')}`);
  }
  if (result.summary.blockedProviders.length > 0) {
    console.log(`  blockedProviders: ${result.summary.blockedProviders.join(', ')}`);
  }
  if (result.summary.attentionProviders.length > 0) {
    console.log(`  attentionProviders: ${result.summary.attentionProviders.join(', ')}`);
  }
  for (const item of result.summary.providers) {
    const message = result.summary.providerMessages?.[item.provider] ?? item.state;
    const codes = result.summary.providerCodes?.[item.provider] ?? [];
    console.log(`  ${item.provider}: ${message}`);
    if (message !== item.state) {
      console.log(`    state: ${item.state}`);
    }
    if (codes.length > 0) {
      console.log(`    codes: ${codes.join(', ')}`);
    }
    console.log(`    source: ${item.source}`);
    console.log(`    configured: ${item.configured ? 'yes' : 'no'}`);
    console.log(`    secure: ${item.secure ? 'yes' : 'no'}`);
    console.log(`    validated: ${item.validated ? 'yes' : 'no'}`);
    if (item.accountCount !== null) {
      console.log(`    accounts: ${item.accountCount}`);
    }
    if (item.lastModifiedAt) {
      console.log(`    lastModifiedAt: ${item.lastModifiedAt}`);
    }
    if (result.summary.providerQuotaCoverage?.[item.provider]) {
      console.log(`    quotaCoverage: ${result.summary.providerQuotaCoverage[item.provider]}`);
    }
    const quotaModelCount = result.summary.providerQuotaModelCounts?.[item.provider] ?? 0;
    if (quotaModelCount > 0) {
      const typedQuotaModelCount = result.summary.providerTypedQuotaModelCounts?.[item.provider] ?? 0;
      console.log(`    typedQuotaModels: ${typedQuotaModelCount}/${quotaModelCount}`);
    }
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

function printProviderSyncStep(result) {
  console.log('provider-sync:');
  console.log(`Provider sync (${result.summary.providers.map((item) => item.provider).join(', ')}):`);
  console.log(`  verdict: ${result.summary.verdict}`);
  if (result.summary.message) {
    console.log(`  message: ${result.summary.message}`);
  }
  if (result.summary.failureCodes.length > 0) {
    console.log(`  failureCodes: ${result.summary.failureCodes.join(', ')}`);
  }
  if (result.summary.advisoryCodes.length > 0) {
    console.log(`  advisoryCodes: ${result.summary.advisoryCodes.join(', ')}`);
  }
  if (result.summary.blockedProviders.length > 0) {
    console.log(`  blockedProviders: ${result.summary.blockedProviders.join(', ')}`);
  }
  if (result.summary.attentionProviders.length > 0) {
    console.log(`  attentionProviders: ${result.summary.attentionProviders.join(', ')}`);
  }
  for (const item of result.summary.providers) {
    const message = result.summary.providerMessages?.[item.provider] ?? item.state;
    const codes = result.summary.providerCodes?.[item.provider] ?? [];
    console.log(`  ${item.provider}: ${message}`);
    if (message !== item.state) {
      console.log(`    state: ${item.state}`);
    }
    if (codes.length > 0) {
      console.log(`    codes: ${codes.join(', ')}`);
    }
    console.log(`    source: ${item.source}`);
    console.log(`    configured: ${item.configured ? 'yes' : 'no'}`);
    console.log(`    secure: ${item.secure ? 'yes' : 'no'}`);
    if (item.accountCount !== null) {
      console.log(`    accounts: ${item.accountCount}`);
    }
    if (item.refreshedAt) {
      console.log(`    refreshedAt: ${item.refreshedAt}`);
    }
    if ((item.syncMethods?.length ?? 0) > 0) {
      console.log(`    syncMethods: ${item.syncMethods.join(', ')}`);
    }
    if ((item.syncModes?.length ?? 0) > 0) {
      console.log(`    syncModes: ${item.syncModes.join(', ')}`);
    }
    if ((item.syncBadges?.length ?? 0) > 0) {
      console.log(`    syncBadges: ${item.syncBadges.join(' | ')}`);
    }
    if ((item.rateLimitHosts?.length ?? 0) > 0) {
      console.log(`    rateLimitHosts: ${item.rateLimitHosts.join(', ')}`);
    }
    if ((item.openaiAuth?.length ?? 0) > 0) {
      console.log(`    openaiAuth: ${item.openaiAuth.join(', ')}`);
    }
    if (result.summary.providerQuotaCoverage?.[item.provider]) {
      console.log(`    quotaCoverage: ${result.summary.providerQuotaCoverage[item.provider]}`);
    }
    const quotaModelCount = result.summary.providerQuotaModelCounts?.[item.provider] ?? 0;
    if (quotaModelCount > 0) {
      const typedQuotaModelCount = result.summary.providerTypedQuotaModelCounts?.[item.provider] ?? 0;
      console.log(`    typedQuotaModels: ${typedQuotaModelCount}/${quotaModelCount}`);
    }
  }
  if (result.stderr) {
    console.error(result.stderr);
  }
}

async function main() {
  const { profile, codexMode, json } = parseArgs(process.argv);
  const failures = [];
  const launchEnv = profile === 'local-only'
    ? (await buildLocalBrokerEnvironment(process.env, { repoRootPath: repoRoot })).env
    : {
        ...process.env,
        SWITCHBOARD_SKIP_LOCAL_BROKER_DEFAULTS: '1',
      };

  if (!json) {
    console.log(`Switchboard preflight: profile=${profile} codexMode=${codexMode}`);
  }

  const operatorResult = await runJsonNodeScript(operatorDoctorEntry, ['from-env', profile], launchEnv);
  if (!json) {
    printOperatorStep(operatorResult);
  }
  if (operatorResult.code !== 0) {
    failures.push(`Operator readiness failed for ${profile}.`);
  }

  const providerReadinessResult = await runJsonNodeScript(providerReadinessDoctorEntry, ['openai'], launchEnv);
  if (!json) {
    printProviderReadinessStep(providerReadinessResult);
  }
  if (providerReadinessResult.code !== 0) {
    throw new Error('Provider readiness check failed for openai.');
  }
  if (providerReadinessResult.summary.verdict === 'blocked') {
    failures.push('Provider readiness blocked for openai.');
  }

  const providerSyncResult = await runJsonNodeScript(providerSyncDoctorEntry, ['openai'], launchEnv);
  if (!json) {
    printProviderSyncStep(providerSyncResult);
  }
  if (providerSyncResult.code !== 0) {
    throw new Error('Provider sync check failed for openai.');
  }
  if (providerSyncResult.summary.verdict === 'blocked') {
    failures.push('Provider sync blocked for openai.');
  }

  const appServerMode = rawCodexMode(codexMode);
  const appServerResult = await runJsonNodeScript(codexAppServerDoctorEntry, [appServerMode], launchEnv);
  if (!json) {
    printCodexAppServerStep(appServerResult);
  }
  if (appServerResult.code !== 0) {
    if (codexMode === 'require-rate-limits') {
      failures.push(`Raw Codex app-server doctor failed for mode ${appServerMode}.`);
    } else if (!json) {
      console.log(
        'preflight note: raw Codex app-server diagnostics degraded or unavailable; wrapper fallback is allowed in this mode.',
      );
    }
  }

  const codexResult = await runJsonNodeScript(codexDoctorEntry, [codexMode], launchEnv);
  if (!json) {
    printCodexStep(codexResult);
  }
  if (codexResult.code !== 0) {
    failures.push(`Codex doctor failed for mode ${codexMode}.`);
  }

  const { failureCodes, advisoryCodes } = buildPreflightCodes(
    codexMode,
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );
  const { readyChecks, attentionChecks, blockedChecks } = buildPreflightCheckLists(
    codexMode,
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );
  const checkStates = buildPreflightCheckStates(
    codexMode,
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );
  const checkCodes = buildPreflightCheckCodes(
    codexMode,
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );
  const checkMessages = buildPreflightCheckMessages(
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );
  const checkDetails = buildPreflightCheckDetails(
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
  );
  const summary = buildPreflightSummary(
    codexMode,
    operatorResult,
    providerReadinessResult,
    providerSyncResult,
    appServerResult,
    codexResult,
    failureCodes,
  );
  if (json) {
    console.log(
      JSON.stringify({
        schemaVersion: DOCTOR_SCHEMA_VERSION,
        kind: 'preflight-doctor',
        profile,
        codexMode,
        verdict: preflightVerdict(summary),
        summary,
        operator: operatorResult.summary,
        providerReadiness: providerReadinessResult.summary,
        providerSync: providerSyncResult.summary,
        codexAppServer: appServerResult.summary,
        codex: codexResult.summary,
        failureCodes,
        advisoryCodes,
        readyChecks,
        attentionChecks,
        blockedChecks,
        checkStates,
        checkCodes,
        checkMessages,
        checkDetails,
        failures,
      }),
    );
  } else {
    console.log(`preflight summary: ${summary}`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join(' '));
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
