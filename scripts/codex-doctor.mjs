import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quotaCoverage, quotaCoverageCounts, quotaDisplayLines } from './codex-quota-display.mjs';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import { codexSyncFailureState, sanitizeCodexSyncFailureDetail } from './provider-sync/codex-failure-details.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const codexSyncEntry = path.join(repoRoot, 'scripts/provider-sync/openai-codex-sync.mjs');

function runCodexSync() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [codexSyncEntry], {
      cwd: repoRoot,
      env: process.env,
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
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code !== 0) {
        reject(new Error(stderr || stdout || `Codex sync exited with code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to parse Codex sync JSON output: ${detail}`));
      }
    });
  });
}

function signalValue(account, id) {
  return account.signals?.find((signal) => signal.id === id)?.value;
}

function formatRateLimitDetail(detail, host) {
  if (!detail) {
    return undefined;
  }

  return host ? `${detail} via ${host}` : detail;
}

function summarizeQuota(quota) {
  const parts = [quota.displayName, quota.availability];

  if (quota.interpretation === 'percentage_window' && typeof quota.remaining === 'number') {
    parts.push(`${quota.remaining}% budget`);
  } else if (typeof quota.remaining === 'number') {
    parts.push(`${quota.remaining} ${quota.usageUnit}`);
  } else {
    parts.push(`unknown ${quota.usageUnit === 'unknown' ? 'budget' : quota.usageUnit}`);
  }

  if (quota.resetAt) {
    parts.push(`resets ${new Date(quota.resetAt).toLocaleString()}`);
  }

  return parts.join(' · ');
}

function quotaDetails(quotas) {
  return (quotas ?? []).map((quota) => ({
    modelId: quota.modelId,
    displayName: quota.displayName,
    availability: quota.availability,
    authMode: quota.authMode,
    usageUnit: quota.usageUnit,
    source: quota.source,
    confidence: quota.confidence,
    ...(quota.limit !== undefined ? { limit: quota.limit } : {}),
    ...(quota.used !== undefined ? { used: quota.used } : {}),
    ...(quota.remaining !== undefined ? { remaining: quota.remaining } : {}),
    ...(quota.interpretation !== undefined ? { interpretation: quota.interpretation } : {}),
    ...(quota.resetAt ? { resetAt: quota.resetAt } : {}),
    ...(quota.windows?.length ? { windows: quota.windows } : {}),
    ...(quota.notes ? { notes: quota.notes } : {}),
  }));
}

function quotaCoverageSummary(coverage, counts) {
  if (!coverage || coverage === 'typed' || coverage === 'none') {
    return null;
  }

  if ((counts?.total ?? 0) <= 0) {
    return `quota ${coverage}`;
  }

  return `quota ${coverage}, typed ${counts?.typed ?? 0}/${counts.total}`;
}

export function summarizeSource(account) {
  const source = signalValue(account, 'source') ?? 'unknown';
  const rateLimits = signalValue(account, 'rate_limits');
  const rateLimitsHost = signalValue(account, 'rate_limits_host');
  const detail = formatRateLimitDetail(rateLimits, rateLimitsHost);

  if (source === 'app-server rate-limits') {
    return {
      state: 'full_rate_limits',
      source,
      status: 'full rate-limits available',
      ok: true,
      rateLimitsHost: rateLimitsHost ?? null,
    };
  }

  if (source === 'app-server account') {
    return {
      state: 'partial_app_server',
      source,
      status: detail ? `partial app-server context (${detail})` : 'partial app-server context',
      ok: false,
      rateLimitsHost: rateLimitsHost ?? null,
    };
  }

  if (source === 'login-status fallback') {
    return {
      state: 'login_fallback',
      source,
      status: detail ? `login fallback (${detail})` : 'login fallback',
      ok: false,
      rateLimitsHost: rateLimitsHost ?? null,
    };
  }

  return {
    state: 'unknown_source',
    source,
    status: 'unknown source',
    ok: false,
    rateLimitsHost: rateLimitsHost ?? null,
  };
}

function codexAdvisoryCode(summary) {
  if (summary.state === 'login_fallback') {
    return 'codex_wrapper_login_fallback';
  }

  if (summary.state === 'partial_app_server') {
    return 'codex_wrapper_partial_app_server';
  }

  return 'codex_wrapper_degraded';
}

export function buildSummary(payload, mode) {
  const account = payload.accounts?.[0];
  if (!account) {
    throw new Error('Codex sync returned no OpenAI accounts.');
  }

  const sourceSummary = summarizeSource(account);
  const plan = signalValue(account, 'plan') ?? 'unknown';
  const credits = signalValue(account, 'credits');
  const openaiAuth = signalValue(account, 'openai_auth');
  const refreshedDisplay = account.lastRefreshedAt ? new Date(account.lastRefreshedAt).toLocaleString() : 'unknown';
  const verdict = sourceSummary.ok
    ? 'ready'
    : (mode === 'require-rate-limits' ? 'blocked' : 'attention_required');
  const details = quotaDetails(account.quotas);
  const coverageCounts = quotaCoverageCounts(details);
  const quotaSummary = quotaCoverageSummary(quotaCoverage(details), coverageCounts);

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'codex-doctor',
    mode,
    verdict,
    failureCodes: verdict === 'blocked' ? ['codex_wrapper_failed'] : [],
    advisoryCodes: verdict === 'attention_required' ? [codexAdvisoryCode(sourceSummary)] : [],
    message: quotaSummary ? `${sourceSummary.status} [${quotaSummary}]` : sourceSummary.status,
    account: account.displayName,
    refreshedAt: account.lastRefreshedAt ?? null,
    refreshedDisplay,
    state: sourceSummary.state,
    source: sourceSummary.source,
    status: sourceSummary.status,
    ok: sourceSummary.ok,
    rateLimitsHost: sourceSummary.rateLimitsHost,
    plan,
    openaiAuth: openaiAuth ?? null,
    credits: credits ?? null,
    quotas: (account.quotas ?? []).map((quota) => summarizeQuota(quota)),
    quotaDetails: details,
    quotaCoverage: quotaCoverage(details),
    quotaModelCount: coverageCounts.total,
    typedQuotaModelCount: coverageCounts.typed,
  };
}

function printSummary(summary) {
  console.log('Codex doctor:');
  console.log(`  verdict: ${summary.verdict}`);
  console.log(`  message: ${summary.message}`);
  if (summary.failureCodes.length > 0) {
    console.log(`  failureCodes: ${summary.failureCodes.join(', ')}`);
  }
  if (summary.advisoryCodes.length > 0) {
    console.log(`  advisoryCodes: ${summary.advisoryCodes.join(', ')}`);
  }
  console.log(`  account: ${summary.account}`);
  console.log(`  refreshed: ${summary.refreshedDisplay}`);
  console.log(`  source: ${summary.source}`);
  console.log(`  status: ${summary.status}`);
  console.log(`  plan: ${summary.plan}`);
  console.log(`  quota coverage: ${summary.quotaCoverage}`);
  if ((summary.quotaModelCount ?? 0) > 0) {
    console.log(`  typed quota models: ${summary.typedQuotaModelCount}/${summary.quotaModelCount}`);
  }
  if (summary.openaiAuth) {
    console.log(`  openai auth: ${summary.openaiAuth}`);
  }
  if (summary.credits) {
    console.log(`  credits: ${summary.credits}`);
  }
  const quotaLines = quotaDisplayLines(summary.quotaDetails);
  if (quotaLines.length > 0) {
    for (const line of quotaLines) {
      console.log(`  ${line}`);
    }
    return;
  }
  for (const quota of summary.quotas) {
    console.log(`  quota: ${quota}`);
  }
}

export function buildFailureSummary(mode, message) {
  const sanitizedDetail = sanitizeCodexSyncFailureDetail(message);

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'codex-doctor',
    mode,
    verdict: 'blocked',
    failureCodes: ['codex_wrapper_failed'],
    advisoryCodes: [],
    message: sanitizedDetail,
    account: 'unknown',
    refreshedAt: null,
    refreshedDisplay: 'unknown',
    state: codexSyncFailureState(message),
    source: 'unknown',
    status: sanitizedDetail,
    ok: false,
    rateLimitsHost: null,
    plan: 'unknown',
    openaiAuth: null,
    credits: null,
    quotas: [],
    quotaDetails: [],
    quotaCoverage: 'none',
    quotaModelCount: 0,
    typedQuotaModelCount: 0,
    error: sanitizedDetail,
  };
}

function parseMode(argv) {
  let mode = 'allow-fallback';
  let json = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (
      arg === 'allow-fallback'
      || arg === '--allow-fallback'
      || arg === 'require-rate-limits'
      || arg === '--require-rate-limits'
    ) {
      mode = arg.startsWith('--') ? arg.slice(2) : arg;
      continue;
    }

    throw new Error(
      'Usage: node scripts/codex-doctor.mjs [allow-fallback|require-rate-limits|--allow-fallback|--require-rate-limits] [--json]',
    );
  }

  return { mode, json };
}

let summaryJsonPrinted = false;

async function main(options) {
  const { mode, json } = options;
  const payload = await runCodexSync();
  const summary = buildSummary(payload, mode);

  if (json) {
    console.log(JSON.stringify(summary));
    summaryJsonPrinted = true;
  } else {
    printSummary(summary);
  }

  if (mode === 'require-rate-limits' && !summary.ok) {
    throw new Error(`Codex doctor expected full app-server rate limits but found ${summary.status}.`);
  }
}

const isDirectExecution = process.argv[1] != null
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const options = parseMode(process.argv);

  main(options).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const summary = buildFailureSummary(options.mode, message);
    if (options.json && !summaryJsonPrinted) {
      console.log(JSON.stringify(summary));
    } else if (!options.json) {
      printSummary(summary);
    }
    process.stderr.write(`${summary.message}\n`);
    process.exitCode = 1;
  });
}
