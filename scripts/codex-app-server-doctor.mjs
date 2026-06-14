import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { quotaCoverage, quotaCoverageCounts, quotaDisplayLines } from './codex-quota-display.mjs';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import {
  codexAppServerErrorState,
  extractCodexAppServerEndpoint,
  extractCodexAppServerHost,
  summarizeCodexAppServerError,
} from './provider-sync/codex-app-server-diagnostics.mjs';
import { sanitizeCodexAppServerFailureDetail } from './provider-sync/codex-failure-details.mjs';

const codexCliPath = process.env.CODEX_CLI_PATH ?? 'codex';
const timeoutMs = parsePositiveInteger(process.env.SWITCHBOARD_CODEX_STATUS_TIMEOUT_MS, 10_000);
const maxOutputBytes = 64 * 1024;

function parsePositiveInteger(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('SWITCHBOARD_CODEX_STATUS_TIMEOUT_MS must be a positive integer when configured.');
  }

  return parsed;
}

function humanizePlanType(planType) {
  if (!planType) {
    return 'Unknown';
  }

  return planType
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function humanizeLimitId(limitId) {
  if (!limitId) {
    return 'Unknown';
  }

  return limitId
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatWindowLabel(durationMinutes) {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return 'current window';
  }

  if (durationMinutes === 300) {
    return '5-hour window';
  }

  if (durationMinutes === 10080) {
    return 'Weekly window';
  }

  if (durationMinutes % 1440 === 0) {
    const days = durationMinutes / 1440;
    return `${days}-day window`;
  }

  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;
    return `${hours}-hour window`;
  }

  return `${durationMinutes}-minute window`;
}

function toIsoReset(resetAt) {
  if (!Number.isFinite(resetAt)) {
    return null;
  }

  return new Date(resetAt * 1000).toISOString();
}

function buildWindowDetail(durationMinutes, usedPercent, resetAt) {
  if (!Number.isFinite(usedPercent)) {
    return null;
  }

  const used = Math.max(0, Math.min(100, usedPercent));

  return {
    id: Number.isInteger(durationMinutes) && durationMinutes > 0 ? `${durationMinutes}m` : 'current',
    label: formatWindowLabel(durationMinutes),
    durationMinutes: Number.isInteger(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
    limit: 100,
    used,
    remaining: Math.max(0, 100 - used),
    interpretation: 'percentage_window',
    resetAt: toIsoReset(resetAt),
  };
}

function buildRateLimitDetails(rateLimitsPayload) {
  const details = [];
  const primaryBucket = rateLimitsPayload?.rateLimits ?? null;

  if (primaryBucket) {
    const windows = [
      buildWindowDetail(
        primaryBucket.primary?.windowDurationMins,
        primaryBucket.primary?.usedPercent,
        primaryBucket.primary?.resetsAt,
      ),
      buildWindowDetail(
        primaryBucket.secondary?.windowDurationMins,
        primaryBucket.secondary?.usedPercent,
        primaryBucket.secondary?.resetsAt,
      ),
    ].filter(Boolean);

    details.push({
      limitId: primaryBucket.limitId ?? 'unknown',
      displayName: primaryBucket.limitName ?? humanizeLimitId(primaryBucket.limitId),
      interpretation: windows.length > 0 ? 'percentage_window' : 'informational',
      windows,
      notes: windows.length === 0 ? 'Rate-limit bucket returned without window detail.' : undefined,
    });
  }

  for (const [limitId, detail] of Object.entries(rateLimitsPayload?.rateLimitsByLimitId ?? {})) {
    if (limitId === primaryBucket?.limitId) {
      continue;
    }

    const windows = [
      buildWindowDetail(
        detail?.primary?.windowDurationMins,
        detail?.primary?.usedPercent,
        detail?.primary?.resetsAt,
      ),
      buildWindowDetail(
        detail?.secondary?.windowDurationMins,
        detail?.secondary?.usedPercent,
        detail?.secondary?.resetsAt,
      ),
    ].filter(Boolean);

    details.push({
      limitId,
      displayName: detail?.limitName ?? humanizeLimitId(limitId),
      interpretation: windows.length > 0 ? 'percentage_window' : 'informational',
      windows,
      notes: windows.length === 0 ? 'Additional rate-limit bucket observed, but no window detail was returned.' : undefined,
    });
  }

  return details;
}

function rateLimitCoverageSummary(coverage, counts, state) {
  if (!coverage || coverage === 'typed') {
    return null;
  }

  if (coverage === 'none' && state === 'available') {
    return null;
  }

  if ((counts?.total ?? 0) <= 0) {
    return `rate-limits ${coverage}`;
  }

  return `rate-limits ${coverage}, typed ${counts?.typed ?? 0}/${counts.total}`;
}

function parseMode(argv) {
  let mode = 'allow-degraded';
  let json = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--json') {
      json = true;
      continue;
    }

    if (
      arg === 'allow-degraded'
      || arg === '--allow-degraded'
      || arg === 'require-rate-limits'
      || arg === '--require-rate-limits'
    ) {
      mode = arg.startsWith('--') ? arg.slice(2) : arg;
      continue;
    }

    throw new Error(
      'Usage: node scripts/codex-app-server-doctor.mjs [allow-degraded|require-rate-limits|--allow-degraded|--require-rate-limits] [--json]',
    );
  }

  return { mode, json };
}

async function queryCodexAppServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(codexCliPath, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const stderrChunks = [];
    let stdoutBytes = 0;
    let settled = false;
    let nextId = 1;
    const pending = new Map();
    const jsonLines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      jsonLines.close();
      child.kill('SIGTERM');
      reject(new Error(`Codex app-server timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      jsonLines.close();
      child.kill('SIGTERM');
    }

    function rejectPending(error) {
      for (const pendingRequest of pending.values()) {
        pendingRequest.reject(error);
      }
      pending.clear();
    }

    function sendRequest(method, params) {
      return new Promise((requestResolve, requestReject) => {
        const id = nextId++;
        pending.set(id, {
          resolve: requestResolve,
          reject: requestReject,
        });

        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    }

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new Error(`Failed to start Codex app-server: ${error.message}`));
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }

      if (pending.size === 0) {
        settled = true;
        cleanup();
        return;
      }

      settled = true;
      cleanup();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      rejectPending(new Error(stderr || `Codex app-server exited with code ${code}.`));
      reject(new Error(stderr || `Codex app-server exited with code ${code}.`));
    });

    jsonLines.on('line', (line) => {
      stdoutBytes += Buffer.byteLength(line, 'utf8');
      if (stdoutBytes > maxOutputBytes && !settled) {
        settled = true;
        cleanup();
        const error = new Error(`Codex app-server returned more than ${maxOutputBytes} bytes.`);
        rejectPending(error);
        reject(error);
        return;
      }

      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        const detail = error instanceof Error ? error.message : String(error);
        const wrapped = new Error(`Codex app-server returned invalid JSON: ${detail}`);
        rejectPending(wrapped);
        reject(wrapped);
        return;
      }

      if (Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);

        if (Object.prototype.hasOwnProperty.call(message, 'error')) {
          request.reject(new Error(`Codex app-server request failed: ${JSON.stringify(message.error)}`));
          return;
        }

        request.resolve(message.result);
      }
    });

    (async () => {
      try {
        const initialize = await sendRequest('initialize', {
          clientInfo: {
            name: 'switchboard-codex-app-server-doctor',
            version: '0.1.0',
          },
        });
        const account = await sendRequest('account/read', {});
        let rateLimits = null;
        let rateLimitsError;

        try {
          rateLimits = await sendRequest('account/rateLimits/read', null);
        } catch (error) {
          rateLimitsError = error;
        }

        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve({
          initialize,
          account,
          rateLimits,
          rateLimitsError,
          stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
        });
      } catch (error) {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      }
    })();
  });
}

function buildSummary(result, mode) {
  const account = result.account?.account ?? null;
  const rateLimitIds = [
    result.rateLimits?.rateLimits?.limitId,
    ...Object.keys(result.rateLimits?.rateLimitsByLimitId ?? {}),
  ].filter(Boolean);
  const openaiAuth = result.account?.requiresOpenaiAuth === true ? 'required' : 'not required';
  const rateLimitStatus = result.rateLimitsError
    ? summarizeCodexAppServerError(result.rateLimitsError)
    : 'available';
  const state = result.rateLimitsError ? codexAppServerErrorState(result.rateLimitsError) : 'available';
  const endpoint = result.rateLimitsError
    ? extractCodexAppServerEndpoint(result.rateLimitsError)
    : undefined;
  const rateLimitHost = result.rateLimitsError
    ? extractCodexAppServerHost(result.rateLimitsError)
    : undefined;
  const rateLimitDetails = buildRateLimitDetails(result.rateLimits);
  const coverageCounts = quotaCoverageCounts(rateLimitDetails);
  const baseMessage = rateLimitHost ? `${rateLimitStatus} via ${rateLimitHost}` : rateLimitStatus;
  const coverageSummary = rateLimitCoverageSummary(quotaCoverage(rateLimitDetails), coverageCounts, state);
  const message = coverageSummary ? `${baseMessage} [${coverageSummary}]` : baseMessage;
  const verdict = result.rateLimitsError
    ? (mode === 'require-rate-limits' ? 'blocked' : 'attention_required')
    : 'ready';

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'codex-app-server-doctor',
    mode,
    verdict,
    failureCodes: verdict === 'blocked' ? ['raw_codex_app_server_failed'] : [],
    advisoryCodes: verdict === 'attention_required' ? ['raw_codex_app_server_degraded'] : [],
    message,
    userAgent: result.initialize?.userAgent ?? 'unknown',
    accountType: account?.type ?? 'unknown',
    plan: account?.planType ? humanizePlanType(account.planType) : 'unknown',
    openaiAuth,
    state,
    rateLimitsAvailable: !result.rateLimitsError,
    rateLimitStatus,
    rateLimitHost: rateLimitHost ?? null,
    endpoint: endpoint ?? null,
    limitIds: rateLimitIds,
    rateLimitDetails,
    rateLimitCoverage: quotaCoverage(rateLimitDetails),
    rateLimitBucketCount: coverageCounts.total,
    typedRateLimitBucketCount: coverageCounts.typed,
  };
}

function printSummary(summary) {
  console.log('Codex app-server doctor:');
  console.log(`  verdict: ${summary.verdict}`);
  console.log(`  message: ${summary.message}`);
  if (summary.failureCodes.length > 0) {
    console.log(`  failureCodes: ${summary.failureCodes.join(', ')}`);
  }
  if (summary.advisoryCodes.length > 0) {
    console.log(`  advisoryCodes: ${summary.advisoryCodes.join(', ')}`);
  }
  console.log(`  user agent: ${summary.userAgent}`);
  console.log(`  account type: ${summary.accountType}`);
  console.log(`  plan: ${summary.plan}`);
  console.log(`  openai auth: ${summary.openaiAuth}`);
  console.log(`  rate limits: ${summary.rateLimitStatus}`);
  console.log(`  rate-limit coverage: ${summary.rateLimitCoverage}`);
  if ((summary.rateLimitBucketCount ?? 0) > 0) {
    console.log(`  typed rate-limit buckets: ${summary.typedRateLimitBucketCount}/${summary.rateLimitBucketCount}`);
  }
  if (summary.rateLimitHost) {
    console.log(`  rate-limit host: ${summary.rateLimitHost}`);
  }
  if (summary.endpoint) {
    console.log(`  rate-limit endpoint: ${summary.endpoint}`);
  }
  if (summary.limitIds.length > 0) {
    console.log(`  limit ids: ${summary.limitIds.join(', ')}`);
  }
  for (const line of quotaDisplayLines(summary.rateLimitDetails, { headingLabel: 'rate-limit bucket' })) {
    console.log(`  ${line}`);
  }
}

let summaryJsonPrinted = false;

function buildFailureSummary(mode, message) {
  const sanitizedDetail = sanitizeCodexAppServerFailureDetail(message);

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'codex-app-server-doctor',
    mode,
    verdict: 'blocked',
    failureCodes: ['raw_codex_app_server_failed'],
    advisoryCodes: [],
    message: sanitizedDetail,
    userAgent: 'unknown',
    accountType: 'unknown',
    plan: 'unknown',
    openaiAuth: 'not required',
    state: codexAppServerErrorState(message),
    rateLimitsAvailable: false,
    rateLimitStatus: summarizeCodexAppServerError(message),
    rateLimitHost: extractCodexAppServerHost(message) ?? null,
    endpoint: extractCodexAppServerEndpoint(message) ?? null,
    limitIds: [],
    rateLimitDetails: [],
    rateLimitCoverage: 'none',
    rateLimitBucketCount: 0,
    typedRateLimitBucketCount: 0,
    error: sanitizedDetail,
  };
}

async function main(options) {
  const { mode, json } = options;
  const result = await queryCodexAppServer();
  const summary = buildSummary(result, mode);

  if (json) {
    console.log(JSON.stringify(summary));
    summaryJsonPrinted = true;
  } else {
    printSummary(summary);
  }

  if (mode === 'require-rate-limits' && !summary.rateLimitsAvailable) {
    throw new Error(`Codex app-server doctor expected rate limits but found ${summary.rateLimitStatus}.`);
  }
}

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
