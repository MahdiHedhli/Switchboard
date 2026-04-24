import { spawn } from 'node:child_process';
import readline from 'node:readline';
import {
  extractCodexAppServerHost,
  summarizeCodexAppServerError,
} from './codex-app-server-diagnostics.mjs';
import { sanitizeCodexSyncFailureDetail } from './codex-failure-details.mjs';

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

function toIsoFromEpochSeconds(seconds) {
  if (seconds == null) {
    return undefined;
  }

  return new Date(seconds * 1000).toISOString();
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

function normalizePercentWindow(window) {
  if (!window || typeof window.usedPercent !== 'number') {
    return null;
  }

  return {
    limit: 100,
    used: window.usedPercent,
    remaining: Math.max(0, 100 - window.usedPercent),
    resetAt: toIsoFromEpochSeconds(window.resetsAt),
    windowDurationMins: window.windowDurationMins ?? null,
  };
}

function formatQuotaWindowLabel(windowDurationMins, fallbackLabel) {
  if (windowDurationMins == null) {
    return fallbackLabel;
  }

  if (windowDurationMins === 300) {
    return '5-hour window';
  }

  if (windowDurationMins === 10080) {
    return 'Weekly window';
  }

  if (windowDurationMins % (60 * 24) === 0) {
    const days = windowDurationMins / (60 * 24);
    return `${days}-day window`;
  }

  if (windowDurationMins % 60 === 0) {
    const hours = windowDurationMins / 60;
    return `${hours}-hour window`;
  }

  return `${windowDurationMins}-minute window`;
}

function buildQuotaWindowSnapshot(window, fallbackId, fallbackLabel) {
  const normalized = normalizePercentWindow(window);
  if (!normalized) {
    return null;
  }

  return {
    id: normalized.windowDurationMins != null ? `${normalized.windowDurationMins}m` : fallbackId,
    label: formatQuotaWindowLabel(normalized.windowDurationMins, fallbackLabel),
    durationMinutes: normalized.windowDurationMins ?? undefined,
    limit: normalized.limit,
    used: normalized.used,
    remaining: normalized.remaining,
    interpretation: 'percentage_window',
    resetAt: normalized.resetAt,
  };
}

function availabilityFromSnapshot(accountType, snapshot) {
  if (!snapshot) {
    return accountType === 'chatgpt' ? 'unknown' : 'constrained';
  }

  if (snapshot.rateLimitReachedType) {
    return 'constrained';
  }

  if (accountType === 'apiKey') {
    return 'constrained';
  }

  return 'available';
}

function displayNameForLimit(snapshot) {
  if (snapshot.limitName) {
    return snapshot.limitName;
  }

  if (snapshot.limitId === 'codex') {
    return 'Codex';
  }

  return snapshot.limitId
    ? snapshot.limitId.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
    : 'Codex';
}

function buildQuotaNotes({ account }) {
  const parts = [];

  if (account?.type === 'apiKey') {
    parts.push('Codex is using API-key auth; Switchboard still prefers ChatGPT subscription-backed supervisor access.');
  }

  return parts.length > 0 ? parts.join('; ') : undefined;
}

function buildAppServerSignals(account, rateLimitsResponse, rateLimitsError, requiresOpenaiAuth) {
  const signals = [
    {
      id: 'source',
      label: 'source',
      value: rateLimitsResponse ? 'app-server rate-limits' : 'app-server account',
    },
  ];
  const primarySnapshot = rateLimitsResponse?.rateLimits ?? null;

  if (account?.type === 'chatgpt' && account.planType) {
    signals.push({
      id: 'plan',
      label: 'plan',
      value: humanizePlanType(account.planType),
    });
  }

  if (primarySnapshot?.credits) {
    if (primarySnapshot.credits.unlimited) {
      signals.push({
        id: 'credits',
        label: 'credits',
        value: 'unlimited',
      });
    } else if (primarySnapshot.credits.balance != null) {
      signals.push({
        id: 'credits',
        label: 'credits',
        value: String(primarySnapshot.credits.balance),
      });
    } else if (primarySnapshot.credits.hasCredits === false) {
      signals.push({
        id: 'credits',
        label: 'credits',
        value: 'unavailable',
      });
    }
  }

  if (requiresOpenaiAuth) {
    signals.push({
      id: 'openai_auth',
      label: 'openai-auth',
      value: 'required',
    });
  }

  if (rateLimitsError) {
    signals.push({
      id: 'rate_limits',
      label: 'rate-limits',
      value: summarizeCodexAppServerError(rateLimitsError),
    });

    const host = extractCodexAppServerHost(rateLimitsError);
    if (host) {
      signals.push({
        id: 'rate_limits_host',
        label: 'rate-limits-host',
        value: host,
      });
    }
  }

  return signals.length > 0 ? signals : undefined;
}

function buildFallbackSignals(appServerError) {
  const signals = [
    {
      id: 'source',
      label: 'source',
      value: 'login-status fallback',
    },
  ];

  if (appServerError) {
    signals.push({
      id: 'rate_limits',
      label: 'rate-limits',
      value: summarizeCodexAppServerError(appServerError),
    });

    const host = extractCodexAppServerHost(appServerError);
    if (host) {
      signals.push({
        id: 'rate_limits_host',
        label: 'rate-limits-host',
        value: host,
      });
    }
  }

  return signals;
}

function buildQuotaSnapshots(account, rateLimitsResponse, userAgent) {
  const snapshots = [];
  const seenLimitIds = new Set();
  const primarySnapshot = rateLimitsResponse?.rateLimits ?? null;

  if (primarySnapshot) {
    seenLimitIds.add(primarySnapshot.limitId ?? 'codex');
    snapshots.push(primarySnapshot);
  }

  const byLimitId = rateLimitsResponse?.rateLimitsByLimitId ?? {};
  for (const [limitId, snapshot] of Object.entries(byLimitId)) {
    if (seenLimitIds.has(limitId)) {
      continue;
    }

    snapshots.push(snapshot);
  }

  if (snapshots.length === 0) {
    return [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: account?.type === 'chatgpt' ? 'available' : 'unknown',
        authMode: account?.type === 'apiKey' ? 'api' : 'subscription',
        usageUnit: 'unknown',
        interpretation: 'informational',
        source: 'cli',
        confidence: 'medium',
        notes: userAgent
          ? `Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=${userAgent}`
          : 'Informational only: Codex app-server returned account metadata but no rate-limit snapshot.',
      },
    ];
  }

  return snapshots.map((snapshot) => {
    const primary = normalizePercentWindow(snapshot.primary);
    const windows = [
      buildQuotaWindowSnapshot(snapshot.primary, 'primary', 'Current window'),
      buildQuotaWindowSnapshot(snapshot.secondary, 'secondary', 'Secondary window'),
    ].filter(Boolean);

    return {
      modelId: snapshot.limitId ?? 'codex',
      displayName: displayNameForLimit(snapshot),
      availability: availabilityFromSnapshot(account?.type, snapshot),
      authMode: account?.type === 'apiKey' ? 'api' : 'subscription',
      usageUnit: 'unknown',
      interpretation: primary ? 'percentage_window' : 'informational',
      source: 'cli',
      confidence: 'high',
      limit: primary?.limit,
      used: primary?.used,
      remaining: primary?.remaining,
      resetAt: primary?.resetAt,
      windows: windows.length > 0 ? windows : undefined,
      notes: buildQuotaNotes({
        account,
      }),
    };
  });
}

function deriveAccountId(account) {
  if (account?.type === 'chatgpt') {
    return 'openai-codex-chatgpt';
  }

  if (account?.type === 'apiKey') {
    return 'openai-codex-api-key';
  }

  return 'openai-codex-unknown';
}

function deriveAccountDisplayName(account) {
  if (account?.type === 'chatgpt' && account.planType) {
    return `Codex Supervisor (${humanizePlanType(account.planType)})`;
  }

  return 'Codex Supervisor';
}

function runCodex(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexCliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Codex CLI timed out after ${timeoutMs}ms while running "${args.join(' ')}".`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.byteLength;
      if (stdoutBytes > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(new Error(`Codex CLI produced more than ${maxOutputBytes} bytes while running "${args.join(' ')}".`));
        return;
      }

      stdoutChunks.push(buffer);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to start Codex CLI: ${error.message}`));
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code !== 0) {
        reject(new Error(stderr || stdout || `Codex CLI exited with code ${code} while running "${args.join(' ')}".`));
        return;
      }

      resolve({
        stdout,
        stderr,
      });
    });
  });
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
            name: 'switchboard-codex-sync',
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

function deriveFallbackAccount(statusOutput, versionOutput) {
  const normalized = statusOutput.toLowerCase();
  const versionNote = versionOutput ? `codex=${versionOutput}` : 'codex version unavailable';

  if (normalized.includes('logged in using chatgpt') || normalized.includes('signed in with your chatgpt account')) {
    return {
      id: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor',
      authMode: 'subscription',
      availability: 'available',
      confidence: 'medium',
      notes: `${versionNote}; Codex CLI reports ChatGPT-backed login, but typed rate-limit data was unavailable locally.`,
    };
  }

  if (normalized.includes('api key configured') || normalized.includes('logged in using an api key')) {
    return {
      id: 'openai-codex-api-key',
      displayName: 'Codex Supervisor',
      authMode: 'api',
      availability: 'constrained',
      confidence: 'medium',
      notes: `${versionNote}; Codex CLI is using API-key auth. Switchboard currently prefers ChatGPT subscription-backed supervisor access.`,
    };
  }

  if (normalized.includes('not logged in')) {
    return {
      id: 'openai-codex-signed-out',
      displayName: 'Codex Supervisor',
      authMode: 'subscription',
      availability: 'unavailable',
      confidence: 'high',
      notes: `${versionNote}; Codex CLI is signed out, so the supervisor surface is unavailable until ChatGPT login is restored.`,
    };
  }

  return {
    id: 'openai-codex-unknown',
    displayName: 'Codex Supervisor',
    authMode: 'subscription',
    availability: 'unknown',
    confidence: 'low',
    notes: `${versionNote}; Codex CLI returned an unrecognized login status: "${statusOutput}".`,
  };
}

async function fallbackPayload(appServerError) {
  const [statusResult, versionResult] = await Promise.all([
    runCodex(['login', 'status']),
    runCodex(['--version']).catch(() => ({ stdout: '', stderr: '' })),
  ]);
  const statusOutput = statusResult.stdout || statusResult.stderr;
  const versionOutput = versionResult.stdout || versionResult.stderr;
  const account = deriveFallbackAccount(statusOutput, versionOutput);

  return {
    provider: 'openai',
    accounts: [
      {
        id: account.id,
        displayName: account.displayName,
        authMode: account.authMode,
        owner: 'operator',
        lastRefreshedAt: new Date().toISOString(),
        signals: buildFallbackSignals(appServerError),
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: account.availability,
            authMode: account.authMode,
            usageUnit: 'unknown',
            interpretation: 'informational',
            source: 'cli',
            confidence: account.confidence,
            notes: account.notes,
          },
        ],
      },
    ],
  };
}

async function appServerPayload() {
  const { initialize, account, rateLimits, rateLimitsError } = await queryCodexAppServer();
  const accountData = account?.account ?? null;
  const requiresOpenaiAuth = account?.requiresOpenaiAuth === true;
  const authMode = accountData?.type === 'apiKey' ? 'api' : 'subscription';

  return {
    provider: 'openai',
    accounts: [
      {
        id: deriveAccountId(accountData),
        displayName: deriveAccountDisplayName(accountData),
        authMode,
        owner: 'operator',
        lastRefreshedAt: new Date().toISOString(),
        signals: buildAppServerSignals(accountData, rateLimits, rateLimitsError, requiresOpenaiAuth),
        quotas: buildQuotaSnapshots(accountData, rateLimits, initialize?.userAgent),
      },
    ],
  };
}

async function main() {
  let payload;
  let appServerError;
  try {
    payload = await appServerPayload();
  } catch (error) {
    appServerError = error;
    payload = await fallbackPayload(appServerError);
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${sanitizeCodexSyncFailureDetail(message)}\n`);
  process.exitCode = 1;
});
