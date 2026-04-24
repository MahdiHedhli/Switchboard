import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const operatorDoctorEntry = path.join(repoRoot, 'scripts/operator-readiness-smoke.mjs');
const providerReadinessDoctorEntry = path.join(repoRoot, 'scripts/provider-readiness-doctor.mjs');
const providerSyncDoctorEntry = path.join(repoRoot, 'scripts/provider-sync-doctor.mjs');
const codexAppServerDoctorEntry = path.join(repoRoot, 'scripts/codex-app-server-doctor.mjs');
const codexDoctorEntry = path.join(repoRoot, 'scripts/codex-doctor.mjs');
const preflightDoctorEntry = path.join(repoRoot, 'scripts/preflight-doctor.mjs');

function buildDoctorEnv(fakeCodexPath, scenario, overrides = {}) {
  return {
    ...process.env,
    CODEX_CLI_PATH: fakeCodexPath,
    FAKE_CODEX_SCENARIO: scenario,
    ...overrides,
  };
}

async function runJsonScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args, '--json'], {
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
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      try {
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
          summary: JSON.parse(stdout),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reject(new Error(`Failed to parse JSON from ${path.basename(scriptPath)}: ${detail}`));
      }
    });
  });
}

function normalizeWrappedSummary(summary) {
  return {
    ...summary,
    refreshedAt: '<dynamic>',
    refreshedDisplay: '<dynamic>',
  };
}

function normalizeProviderSyncSummary(summary) {
  return {
    ...summary,
    providerRefreshedAt: Object.fromEntries(
      Object.entries(summary.providerRefreshedAt ?? {}).map(([provider, refreshedAt]) => [
        provider,
        refreshedAt ? '<dynamic>' : refreshedAt,
      ]),
    ),
    providers: summary.providers.map((item) => ({
      ...item,
      refreshedAt: item.refreshedAt ? '<dynamic>' : item.refreshedAt,
    })),
  };
}

function normalizeCheckDetails(details) {
  return {
    ...details,
    provider_sync: {
      ...details.provider_sync,
      refreshedAt: details.provider_sync?.refreshedAt ? '<dynamic>' : details.provider_sync?.refreshedAt,
    },
    codex_wrapper: {
      ...details.codex_wrapper,
      refreshedAt: details.codex_wrapper?.refreshedAt ? '<dynamic>' : details.codex_wrapper?.refreshedAt,
      refreshedDisplay: details.codex_wrapper?.refreshedDisplay ? '<dynamic>' : details.codex_wrapper?.refreshedDisplay,
    },
  };
}

function assertPreferredProviderReadinessAlignment(readinessDetail, readinessSummary) {
  const provider = readinessSummary.attentionProviders?.[0]
    ?? readinessSummary.blockedProviders?.[0]
    ?? readinessSummary.readyProviders?.[0]
    ?? readinessSummary.providers?.[0]?.provider
    ?? null;
  assert.equal(readinessDetail.provider ?? null, provider);
  assert.equal(readinessDetail.state ?? null, provider ? (readinessSummary.providerStates?.[provider] ?? null) : null);
  assert.equal(readinessDetail.kind ?? null, provider ? (readinessSummary.providerKinds?.[provider] ?? null) : null);
  assert.equal(readinessDetail.source ?? null, provider ? (readinessSummary.providerSources?.[provider] ?? null) : null);
  assert.equal(readinessDetail.configured ?? null, provider ? (readinessSummary.providerConfigured?.[provider] ?? null) : null);
  assert.equal(readinessDetail.secure ?? null, provider ? (readinessSummary.providerSecure?.[provider] ?? null) : null);
  assert.equal(readinessDetail.validated ?? null, provider ? (readinessSummary.providerValidated?.[provider] ?? null) : null);
  assert.equal(readinessDetail.accountCount ?? null, provider ? (readinessSummary.providerAccountCounts?.[provider] ?? null) : null);
  assert.deepEqual(readinessDetail.codes ?? [], provider ? (readinessSummary.providerCodes?.[provider] ?? []) : []);
  assert.equal(readinessDetail.message ?? null, provider ? (readinessSummary.providerMessages?.[provider] ?? null) : null);
  assert.equal(
    readinessDetail.unvalidated ?? false,
    provider ? (readinessSummary.unvalidatedProviders ?? []).includes(provider) : false,
  );
  assert.equal(
    readinessDetail.lastModifiedAt ?? null,
    provider ? (readinessSummary.providerLastModifiedAt?.[provider] ?? null) : null,
  );
}

function assertPreferredProviderSyncAlignment(syncDetail, syncSummary) {
  const provider = syncSummary.attentionProviders?.[0]
    ?? syncSummary.blockedProviders?.[0]
    ?? syncSummary.readyProviders?.[0]
    ?? syncSummary.providers?.[0]?.provider
    ?? null;
  assert.equal(syncDetail.provider ?? null, provider);
  assert.equal(syncDetail.state ?? null, provider ? (syncSummary.providerStates?.[provider] ?? null) : null);
  assert.equal(syncDetail.kind ?? null, provider ? (syncSummary.providerKinds?.[provider] ?? null) : null);
  assert.equal(syncDetail.source ?? null, provider ? (syncSummary.providerSources?.[provider] ?? null) : null);
  assert.equal(syncDetail.configured ?? null, provider ? (syncSummary.providerConfigured?.[provider] ?? null) : null);
  assert.equal(syncDetail.secure ?? null, provider ? (syncSummary.providerSecure?.[provider] ?? null) : null);
  assert.equal(syncDetail.refreshedAt ?? null, provider ? (syncSummary.providerRefreshedAt?.[provider] ?? null) : null);
  assert.equal(syncDetail.accountCount ?? null, provider ? (syncSummary.providerAccountCounts?.[provider] ?? null) : null);
  assert.deepEqual(syncDetail.codes ?? [], provider ? (syncSummary.providerCodes?.[provider] ?? []) : []);
  assert.equal(syncDetail.message ?? null, syncSummary.message ?? null);
  assert.deepEqual(syncDetail.syncMethods ?? [], provider ? (syncSummary.providerAccountSyncMethods?.[provider] ?? []) : []);
  assert.deepEqual(
    syncDetail.accountSyncMethods ?? [],
    provider ? (syncSummary.providerAccountSyncMethods?.[provider] ?? []) : [],
  );
  assert.deepEqual(syncDetail.syncModes ?? [], provider ? (syncSummary.providerSyncModes?.[provider] ?? []) : []);
  assert.deepEqual(syncDetail.syncBadges ?? [], provider ? (syncSummary.providerSyncBadges?.[provider] ?? []) : []);
  assert.deepEqual(syncDetail.rateLimitHosts ?? [], provider ? (syncSummary.providerRateLimitHosts?.[provider] ?? []) : []);
  assert.deepEqual(syncDetail.openaiAuth ?? [], provider ? (syncSummary.providerOpenaiAuth?.[provider] ?? []) : []);
  assert.equal(syncDetail.quotaCoverage ?? null, provider ? (syncSummary.providerQuotaCoverage?.[provider] ?? null) : null);
  assert.equal(syncDetail.quotaModelCount ?? null, provider ? (syncSummary.providerQuotaModelCounts?.[provider] ?? null) : null);
  assert.equal(
    syncDetail.typedQuotaModelCount ?? null,
    provider ? (syncSummary.providerTypedQuotaModelCounts?.[provider] ?? null) : null,
  );
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-doctor-contracts-smoke-'));
  const fakeCodexPath = path.join(tempRoot, 'codex');
  const fakeSyncPath = path.join(tempRoot, 'fake-openai-sync.mjs');
  const tlsCertPath = path.join(tempRoot, 'broker-cert.pem');
  const tlsKeyPath = path.join(tempRoot, 'broker-key.pem');
  const remoteOperatorTokenFile = path.join(tempRoot, 'operator-token');
  const remoteTlsEnv = {
    SWITCHBOARD_TLS_CERT_FILE: tlsCertPath,
    SWITCHBOARD_TLS_KEY_FILE: tlsKeyPath,
  };

  await writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_CODEX_SCENARIO ?? 'app-server';
const args = process.argv.slice(2).join(' ');

if (scenario === 'fallback' && args === 'app-server --listen stdio://') {
  process.stderr.write('Failed to start Codex app-server: simulated unavailable app-server\\n');
  process.exit(1);
}

if (args === 'app-server --listen stdio://') {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({
          id: message.id,
          result: {
            userAgent: 'Codex Desktop/0.122.0 (doctor contracts smoke)',
            codexHome: '/tmp/fake-codex',
            platformFamily: 'unix',
            platformOs: 'macos'
          }
        }) + '\\n');
      } else if (message.method === 'account/read') {
        process.stdout.write(JSON.stringify({
          id: message.id,
          result: {
            account: {
              type: 'chatgpt',
              email: 'operator@example.com',
              planType: 'pro'
            },
            requiresOpenaiAuth: true
          }
        }) + '\\n');
      } else if (message.method === 'account/rateLimits/read') {
        if (scenario === 'partial-app-server') {
          process.stdout.write(JSON.stringify({
            id: message.id,
            error: {
              code: -32603,
              message: 'failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)'
            }
          }) + '\\n');
        } else {
          process.stdout.write(JSON.stringify({
            id: message.id,
            result: {
              rateLimits: {
                limitId: 'codex',
                limitName: null,
                primary: {
                  usedPercent: 9,
                  windowDurationMins: 300,
                  resetsAt: 1776814663
                },
                secondary: {
                  usedPercent: 2,
                  windowDurationMins: 10080,
                  resetsAt: 1777401463
                },
                credits: {
                  hasCredits: false,
                  unlimited: false,
                  balance: '0'
                },
                planType: 'pro',
                rateLimitReachedType: null
              },
              rateLimitsByLimitId: scenario === 'mixed-app-server'
                ? {
                    codex_bengalfox: {
                      limitName: 'Codex Bengalfox'
                    }
                  }
                : {
                    codex_bengalfox: {
                      limitId: 'codex_bengalfox',
                      limitName: 'GPT-5.3-Codex-Spark',
                      primary: {
                        usedPercent: 0,
                        windowDurationMins: 300,
                        resetsAt: 1776826193
                      },
                      secondary: {
                        usedPercent: 0,
                        windowDurationMins: 10080,
                        resetsAt: 1777412993
                      }
                    }
                  }
            }
          }) + '\\n');
        }
      } else {
        process.stderr.write(\`Unexpected fake codex app-server method: \${message.method}\\n\`);
        process.exit(1);
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
  return;
}

if (args === 'login status') {
  process.stderr.write('Logged in using ChatGPT\\n');
  process.exit(0);
}

if (args === '--version') {
  process.stdout.write('codex-cli 0.122.0-alpha.1\\n');
  process.exit(0);
}

process.stderr.write(\`Unexpected fake codex invocation: \${args}\\n\`);
process.exit(1);
`,
    { mode: 0o700 },
  );

  await writeFile(
    fakeSyncPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_PROVIDER_SYNC_SCENARIO ?? 'app-server';

const payloads = {
  fallback: {
    provider: 'openai',
    accounts: [
      {
        id: 'openai-codex-chatgpt',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T03:45:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: 'login-status fallback' },
          { id: 'plan', label: 'plan', value: 'Pro' },
          { id: 'rate_limits', label: 'rate-limits', value: 'app-server unavailable' }
        ],
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'medium',
            interpretation: 'informational',
            notes: 'Informational only: app-server unavailable'
          }
        ]
      }
    ]
  },
  'partial-app-server': {
    provider: 'openai',
    accounts: [
      {
        id: 'openai-codex-chatgpt',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T03:45:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: 'app-server account' },
          { id: 'plan', label: 'plan', value: 'Pro' },
          { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
          { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
          { id: 'openai_auth', label: 'openai-auth', value: 'required' }
        ],
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'medium',
            interpretation: 'informational',
            notes: 'Informational only: usage endpoint unavailable via chatgpt.com'
          }
        ]
      }
    ]
  },
  'app-server': {
    provider: 'openai',
    accounts: [
      {
        id: 'openai-codex-chatgpt',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T03:45:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: 'app-server rate-limits' },
          { id: 'plan', label: 'plan', value: 'Pro' },
          { id: 'openai_auth', label: 'openai-auth', value: 'required' }
        ],
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'credits',
            source: 'cli',
            confidence: 'high',
            remaining: 90,
            interpretation: 'percentage_window'
          },
          {
            modelId: 'codex_bengalfox',
            displayName: 'GPT-5.3-Codex-Spark',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'credits',
            source: 'cli',
            confidence: 'high',
            remaining: 100,
            interpretation: 'percentage_window'
          }
        ]
      }
    ]
  },
  'mixed-provider-sync': {
    provider: 'openai',
    accounts: [
      {
        id: 'openai-codex-chatgpt',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T03:45:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: 'app-server rate-limits' },
          { id: 'plan', label: 'plan', value: 'Pro' },
          { id: 'openai_auth', label: 'openai-auth', value: 'required' }
        ],
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'credits',
            source: 'cli',
            confidence: 'high',
            remaining: 90,
            interpretation: 'percentage_window'
          },
          {
            modelId: 'codex_bengalfox',
            displayName: 'Codex Bengalfox',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'medium',
            interpretation: 'informational',
            notes: 'Additional quota row observed, but no window detail was returned.'
          }
        ]
      }
    ]
  }
};

process.stdout.write(JSON.stringify(payloads[scenario] ?? payloads['app-server']));
`,
    { mode: 0o700 },
  );
  await writeFile(tlsCertPath, '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n', { mode: 0o644 });
  await writeFile(tlsKeyPath, '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n', { mode: 0o600 });
  await writeFile(remoteOperatorTokenFile, 'reviewed-remote-token\n', { mode: 0o600 });

  try {
    const localEnv = buildDoctorEnv(fakeCodexPath, 'fallback', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'fallback',
    });

    const localOperator = await runJsonScript(operatorDoctorEntry, [operatorDoctorEntry, 'from-env', 'local-only'], localEnv);
    const localProviderReadiness = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      localEnv,
    );
    const localProviderSync = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      localEnv,
    );
    const localRaw = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'allow-degraded'],
      localEnv,
    );
    const localWrapped = await runJsonScript(codexDoctorEntry, [codexDoctorEntry, 'allow-fallback'], localEnv);
    const localPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localEnv,
    );

    assert.equal(localOperator.code, 0);
    assert.equal(localRaw.code, 1);
    assert.equal(localWrapped.code, 0);
    assert.equal(localPreflight.code, 0);
    assert.equal(localOperator.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localProviderReadiness.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localProviderSync.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localRaw.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localWrapped.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localPreflight.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localPreflight.summary.kind, 'preflight-doctor');
    assert.equal(localPreflight.summary.verdict, 'degraded_but_acceptable');
    assert.deepEqual(localPreflight.summary.failureCodes, []);
    assert.deepEqual(localPreflight.summary.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
      'raw_codex_app_server_degraded',
      'codex_wrapper_login_fallback',
    ]);
    assert.deepEqual(localPreflight.summary.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(localPreflight.summary.attentionChecks, ['provider_sync', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(localPreflight.summary.blockedChecks, []);
    assert.deepEqual(localPreflight.summary.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'attention_required',
      raw_codex_app_server: 'attention_required',
      codex_wrapper: 'attention_required',
    });
    assert.deepEqual(localPreflight.summary.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: ['provider_sync_degraded'],
      raw_codex_app_server: ['raw_codex_app_server_degraded'],
      codex_wrapper: ['codex_wrapper_login_fallback'],
    });
    assert.deepEqual(localPreflight.summary.checkMessages, {
      operator: 'local-only; host=127.0.0.1',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'login fallback: app-server unavailable (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'Codex app-server could not start.',
      codex_wrapper: 'login fallback (app-server unavailable) [quota informational_only, typed 0/1]',
    });
    assert.deepEqual(normalizeCheckDetails(localPreflight.summary.checkDetails), {
      operator: {
        profile: 'local-only',
        verdict: 'ready',
        host: '127.0.0.1',
        localOnly: true,
        allowRemote: false,
        operatorTokenConfigured: true,
        operatorTokenSource: 'env',
        manualSubscriptionReplaceEnabled: false,
        protocol: 'http',
        tlsEnabled: false,
        failureCodes: [],
        advisoryCodes: [],
        scopes: {
          taskCreate: 'operator_token',
          taskUpdate: 'operator_token',
          subscriptionRefresh: 'operator_token',
          subscriptionReplace: 'disabled',
        },
        problems: [],
        message: 'local-only; host=127.0.0.1',
      },
      provider_readiness: {
        provider: 'openai',
        state: 'trusted_command_ready',
        kind: 'trusted-command',
        source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
        configured: true,
        secure: true,
        validated: false,
        codes: ['provider_trusted_command_unvalidated'],
        message: 'trusted_command_ready (unvalidated)',
        unvalidated: true,
      },
      provider_sync: {
        provider: 'openai',
        state: 'trusted_command_degraded',
        kind: 'trusted-command',
        source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
        configured: true,
        secure: true,
        refreshedAt: '<dynamic>',
        accountCount: 1,
        codes: ['provider_sync_degraded'],
        message: 'login fallback: app-server unavailable (advisory) [quota informational_only, typed 0/1]',
        syncMethods: ['provider'],
        accountSyncMethods: ['provider'],
        syncModes: ['login-status-fallback'],
        syncBadges: ['login fallback: app-server unavailable'],
        rateLimitHosts: [],
        openaiAuth: [],
        quotaCoverage: 'informational_only',
        quotaModelCount: 1,
        typedQuotaModelCount: 0,
      },
      raw_codex_app_server: {
        verdict: 'blocked',
        failureCodes: ['raw_codex_app_server_failed'],
        advisoryCodes: [],
        message: 'Codex app-server could not start.',
        userAgent: localRaw.summary.userAgent,
        accountType: localRaw.summary.accountType,
        plan: localRaw.summary.plan,
        state: 'app_server_unavailable',
        rateLimitStatus: 'app-server unavailable',
        rateLimitHost: null,
        endpoint: localRaw.summary.endpoint,
        openaiAuth: 'not required',
        rateLimitCoverage: 'none',
        rateLimitBucketCount: 0,
        typedRateLimitBucketCount: 0,
        rateLimitDetails: [],
      },
      codex_wrapper: {
        verdict: 'attention_required',
        failureCodes: [],
        advisoryCodes: ['codex_wrapper_login_fallback'],
        message: 'login fallback (app-server unavailable) [quota informational_only, typed 0/1]',
        account: localWrapped.summary.account,
        refreshedAt: '<dynamic>',
        refreshedDisplay: '<dynamic>',
        state: 'login_fallback',
        source: 'login-status fallback',
        rateLimitsHost: null,
        openaiAuth: null,
        plan: localWrapped.summary.plan,
        credits: localWrapped.summary.credits,
        ok: false,
        quotaCoverage: 'informational_only',
        quotaModelCount: 1,
        typedQuotaModelCount: 0,
        quotaDetails: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'medium',
            interpretation: 'informational',
            notes: 'codex=codex-cli 0.122.0-alpha.1; Codex CLI reports ChatGPT-backed login, but typed rate-limit data was unavailable locally.',
          },
        ],
      },
    });
    assert.equal(localRaw.summary.state, 'app_server_unavailable');
    assert.equal(localWrapped.summary.state, 'login_fallback');
    assert.deepEqual(localPreflight.summary.operator, localOperator.summary);
    assert.deepEqual(localPreflight.summary.providerReadiness, localProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(localPreflight.summary.providerSync),
      normalizeProviderSyncSummary(localProviderSync.summary),
    );
    assert.deepEqual(localPreflight.summary.codexAppServer, localRaw.summary);
    assert.deepEqual(normalizeWrappedSummary(localPreflight.summary.codex), normalizeWrappedSummary(localWrapped.summary));
    assert.deepEqual(localPreflight.summary.providerReadiness.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(localPreflight.summary.providerSync.advisoryCodes, ['provider_sync_degraded']);
    assert.match(localPreflight.summary.summary, /operator=local-only, host=127\.0\.0\.1/);
    assert.match(localPreflight.summary.summary, /raw Codex status=app-server unavailable \[rate-limits none\]/);
    assert.match(localPreflight.summary.summary, /provider readiness=trusted_command_ready \(unvalidated\)/);
    assert.match(
      localPreflight.summary.summary,
      /provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      localPreflight.summary.summary,
      /wrapper status=login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );

    const localOperatorFileBacked = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'local-only'],
      buildDoctorEnv(fakeCodexPath, 'fallback', {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'fallback',
      }),
    );
    assert.equal(localOperatorFileBacked.summary.operatorTokenConfigured, true);
    assert.equal(localOperatorFileBacked.summary.operatorTokenSource, 'file');
    assert.equal(localOperatorFileBacked.summary.operatorTokenFile, 'operator-token');

    const localPreflightFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      buildDoctorEnv(fakeCodexPath, 'fallback', {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'fallback',
      }),
    );
    assert.equal(localPreflightFileBacked.summary.verdict, 'degraded_but_acceptable');
    assert.equal(localPreflightFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localPreflightFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localPreflightFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.deepEqual(localPreflightFileBacked.summary.checkMessages, localPreflight.summary.checkMessages);

    const localReadyEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
    });
    const localRawReady = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      localReadyEnv,
    );
    const localWrappedReady = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      localReadyEnv,
    );
    const localPreflightReady = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'require-rate-limits'],
      localReadyEnv,
    );
    assert.equal(localRawReady.code, 0);
    assert.equal(localWrappedReady.code, 0);
    assert.equal(localPreflightReady.code, 0);
    assert.deepEqual(localPreflightReady.summary.codexAppServer, localRawReady.summary);
    assert.deepEqual(
      normalizeWrappedSummary(localPreflightReady.summary.codex),
      normalizeWrappedSummary(localWrappedReady.summary),
    );
    assert.equal(localPreflightReady.summary.verdict, 'ready');
    assert.equal(localPreflightReady.summary.checkDetails.provider_readiness.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)');
    assertPreferredProviderReadinessAlignment(
      localPreflightReady.summary.checkDetails.provider_readiness,
      localPreflightReady.summary.providerReadiness,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_readiness.kind,
      localPreflightReady.summary.providerReadiness.providerKinds?.openai,
    );
    assert.equal(localPreflightReady.summary.checkDetails.provider_readiness.configured, true);
    assert.equal(localPreflightReady.summary.checkDetails.provider_readiness.secure, true);
    assert.equal(localPreflightReady.summary.checkDetails.provider_readiness.validated, false);
    assert.equal(localPreflightReady.summary.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      localPreflightReady.summary.checkDetails.provider_readiness.codes,
      localPreflightReady.summary.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_readiness.lastModifiedAt ?? null,
      localPreflightReady.summary.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_readiness.message,
      localPreflightReady.summary.providerReadiness.message,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_sync.source,
      localPreflightReady.summary.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      localPreflightReady.summary.checkDetails.provider_sync,
      localPreflightReady.summary.providerSync,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_sync.refreshedAt,
      localPreflightReady.summary.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      localPreflightReady.summary.checkDetails.provider_sync.syncMethods,
      localPreflightReady.summary.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_sync.accountCount,
      localPreflightReady.summary.providerSync.providers[0]?.accountCount,
    );
    assert.equal(localPreflightReady.summary.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(localPreflightReady.summary.checkDetails.provider_sync.typedQuotaModelCount, 2);
    assert.deepEqual(
      localPreflightReady.summary.checkDetails.provider_sync.syncModes,
      localPreflightReady.summary.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      localPreflightReady.summary.checkDetails.provider_sync.syncBadges,
      localPreflightReady.summary.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.provider_sync.message,
      localPreflightReady.summary.providerSync.message,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.raw_codex_app_server.userAgent,
      localPreflightReady.summary.codexAppServer.userAgent,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.raw_codex_app_server.accountType,
      localPreflightReady.summary.codexAppServer.accountType,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.raw_codex_app_server.plan,
      localPreflightReady.summary.codexAppServer.plan,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.raw_codex_app_server.endpoint,
      localPreflightReady.summary.codexAppServer.endpoint,
    );
    assert.equal(localPreflightReady.summary.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(localPreflightReady.summary.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 2);
    assert.equal(localPreflightReady.summary.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      localPreflightReady.summary.checkDetails.codex_wrapper.source,
      localPreflightReady.summary.codex.source,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.codex_wrapper.account,
      localPreflightReady.summary.codex.account,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.codex_wrapper.refreshedAt,
      localPreflightReady.summary.codex.refreshedAt,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.codex_wrapper.refreshedDisplay,
      localPreflightReady.summary.codex.refreshedDisplay,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.codex_wrapper.plan,
      localPreflightReady.summary.codex.plan,
    );
    assert.equal(
      localPreflightReady.summary.checkDetails.codex_wrapper.credits,
      localPreflightReady.summary.codex.credits,
    );
    assert.equal(localPreflightReady.summary.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(localPreflightReady.summary.checkDetails.codex_wrapper.typedQuotaModelCount, 2);
    assert.equal(localPreflightReady.summary.checkMessages.raw_codex_app_server, 'available');
    assert.equal(localPreflightReady.summary.checkMessages.codex_wrapper, 'full rate-limits available');
    assert.match(localPreflightReady.summary.summary, /operator=local-only, host=127\.0\.0\.1/);
    assert.match(localPreflightReady.summary.summary, /raw Codex status=available/);
    assert.match(localPreflightReady.summary.summary, /wrapper status=full rate-limits available/);

    const localReadyFileBackedEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
    });
    const localPreflightReadyFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'require-rate-limits'],
      localReadyFileBackedEnv,
    );
    assert.equal(localPreflightReadyFileBacked.summary.verdict, 'ready');
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)');
    assertPreferredProviderReadinessAlignment(
      localPreflightReadyFileBacked.summary.checkDetails.provider_readiness,
      localPreflightReadyFileBacked.summary.providerReadiness,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.kind,
      localPreflightReadyFileBacked.summary.providerReadiness.providerKinds?.openai,
    );
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.configured, true);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.secure, true);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.validated, false);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.codes,
      localPreflightReadyFileBacked.summary.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.lastModifiedAt ?? null,
      localPreflightReadyFileBacked.summary.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_readiness.message,
      localPreflightReadyFileBacked.summary.providerReadiness.message,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.source,
      localPreflightReadyFileBacked.summary.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync,
      localPreflightReadyFileBacked.summary.providerSync,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.refreshedAt,
      localPreflightReadyFileBacked.summary.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.syncMethods,
      localPreflightReadyFileBacked.summary.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.accountCount,
      localPreflightReadyFileBacked.summary.providerSync.providers[0]?.accountCount,
    );
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.provider_sync.typedQuotaModelCount, 2);
    assert.deepEqual(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.syncModes,
      localPreflightReadyFileBacked.summary.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.syncBadges,
      localPreflightReadyFileBacked.summary.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.provider_sync.message,
      localPreflightReadyFileBacked.summary.providerSync.message,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.raw_codex_app_server.userAgent,
      localPreflightReadyFileBacked.summary.codexAppServer.userAgent,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.raw_codex_app_server.accountType,
      localPreflightReadyFileBacked.summary.codexAppServer.accountType,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.raw_codex_app_server.plan,
      localPreflightReadyFileBacked.summary.codexAppServer.plan,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.raw_codex_app_server.endpoint,
      localPreflightReadyFileBacked.summary.codexAppServer.endpoint,
    );
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 2);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.source,
      localPreflightReadyFileBacked.summary.codex.source,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.account,
      localPreflightReadyFileBacked.summary.codex.account,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.refreshedAt,
      localPreflightReadyFileBacked.summary.codex.refreshedAt,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.refreshedDisplay,
      localPreflightReadyFileBacked.summary.codex.refreshedDisplay,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.plan,
      localPreflightReadyFileBacked.summary.codex.plan,
    );
    assert.equal(
      localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.credits,
      localPreflightReadyFileBacked.summary.codex.credits,
    );
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(localPreflightReadyFileBacked.summary.checkDetails.codex_wrapper.typedQuotaModelCount, 2);
    assert.deepEqual(localPreflightReadyFileBacked.summary.checkMessages, localPreflightReady.summary.checkMessages);

    const localProviderMixedFileBackedEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
    });
    const localProviderSyncMixedFileBacked = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      localProviderMixedFileBackedEnv,
    );
    const localPreflightProviderMixedFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'require-rate-limits'],
      localProviderMixedFileBackedEnv,
    );
    assert.equal(localProviderSyncMixedFileBacked.code, 0);
    assert.equal(localPreflightProviderMixedFileBacked.code, 0);
    assert.equal(localProviderSyncMixedFileBacked.summary.providerQuotaCoverage.openai, 'mixed');
    assert.equal(localProviderSyncMixedFileBacked.summary.providerQuotaModelCounts.openai, 2);
    assert.equal(localProviderSyncMixedFileBacked.summary.providerTypedQuotaModelCounts.openai, 1);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assertPreferredProviderReadinessAlignment(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness,
      localPreflightProviderMixedFileBacked.summary.providerReadiness,
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.kind,
      localPreflightProviderMixedFileBacked.summary.providerReadiness.providerKinds?.openai,
    );
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.configured, true);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.secure, true);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.validated, false);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.codes,
      localPreflightProviderMixedFileBacked.summary.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.lastModifiedAt ?? null,
      localPreflightProviderMixedFileBacked.summary.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.message,
      localPreflightProviderMixedFileBacked.summary.providerReadiness.message,
    );
    assert.deepEqual(
      normalizeProviderSyncSummary(localPreflightProviderMixedFileBacked.summary.providerSync),
      normalizeProviderSyncSummary(localProviderSyncMixedFileBacked.summary),
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.source,
      localPreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync,
      localPreflightProviderMixedFileBacked.summary.providerSync,
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.refreshedAt,
      localPreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.syncMethods,
      localPreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.accountCount,
      localPreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.syncModes,
      localPreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.syncBadges,
      localPreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.message,
      localPreflightProviderMixedFileBacked.summary.providerSync.message,
    );
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.quotaCoverage, 'mixed');
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.typedQuotaModelCount, 1);
    assert.equal(localPreflightProviderMixedFileBacked.summary.checkMessages.provider_sync, 'app-server rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      localPreflightProviderMixedFileBacked.summary.summary,
      /operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const localMixedFileBackedEnv = buildDoctorEnv(fakeCodexPath, 'mixed-app-server', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
    });
    const localRawMixedFileBacked = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      localMixedFileBackedEnv,
    );
    const localWrappedMixedFileBacked = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      localMixedFileBackedEnv,
    );
    const localPreflightMixedFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'require-rate-limits'],
      localMixedFileBackedEnv,
    );
    assert.equal(localRawMixedFileBacked.code, 0);
    assert.equal(localWrappedMixedFileBacked.code, 0);
    assert.equal(localPreflightMixedFileBacked.code, 0);
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.deepEqual(localPreflightMixedFileBacked.summary.codexAppServer, localRawMixedFileBacked.summary);
    assert.deepEqual(
      normalizeWrappedSummary(localPreflightMixedFileBacked.summary.codex),
      normalizeWrappedSummary(localWrappedMixedFileBacked.summary),
    );
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.rateLimitCoverage, 'mixed');
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 1);
    assert.match(localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.userAgent ?? '', /^Codex Desktop\/0\.122\.0/);
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.accountType,
      localPreflightMixedFileBacked.summary.codexAppServer.accountType,
    );
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.plan,
      localPreflightMixedFileBacked.summary.codexAppServer.plan,
    );
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.endpoint,
      localPreflightMixedFileBacked.summary.codexAppServer.endpoint,
    );
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.quotaCoverage, 'mixed');
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.typedQuotaModelCount, 1);
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.source,
      localPreflightMixedFileBacked.summary.codex.source,
    );
    assert.equal(localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.account, 'Codex Supervisor (Pro)');
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.refreshedAt,
      localPreflightMixedFileBacked.summary.codex.refreshedAt,
    );
    assert.match(localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.refreshedDisplay ?? '', /2026/);
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.plan,
      localPreflightMixedFileBacked.summary.codex.plan,
    );
    assert.equal(
      localPreflightMixedFileBacked.summary.checkDetails.codex_wrapper.credits,
      localPreflightMixedFileBacked.summary.codex.credits,
    );
    assert.equal(localPreflightMixedFileBacked.summary.checkMessages.raw_codex_app_server, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(localPreflightMixedFileBacked.summary.checkMessages.codex_wrapper, 'full rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      localPreflightMixedFileBacked.summary.summary,
      /operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available \[rate-limits mixed, typed 1\/2\]; wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const localInferredEnv = buildDoctorEnv(fakeCodexPath, 'fallback', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'fallback',
    });

    const localInferredProviderReadiness = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      localInferredEnv,
    );
    const localInferredProviderSync = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      localInferredEnv,
    );
    const localInferredPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localInferredEnv,
    );

    assert.equal(localInferredProviderReadiness.code, 0);
    assert.equal(localInferredProviderSync.code, 0);
    assert.equal(localInferredPreflight.code, 0);
    assert.deepEqual(localInferredProviderReadiness.summary, localProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(localInferredProviderSync.summary),
      normalizeProviderSyncSummary(localProviderSync.summary),
    );
    assert.deepEqual(localInferredPreflight.summary.checkMessages, localPreflight.summary.checkMessages);
    assert.equal(
      localInferredPreflight.summary.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(
      localInferredPreflight.summary.checkDetails.provider_sync.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(localInferredPreflight.summary.checkDetails.codex_wrapper.account, 'Codex Supervisor');
    assert.match(localInferredPreflight.summary.checkDetails.codex_wrapper.refreshedDisplay ?? '', /2026/);
    assert.deepEqual(localInferredPreflight.summary.providerReadiness, localProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(localInferredPreflight.summary.providerSync),
      normalizeProviderSyncSummary(localProviderSync.summary),
    );
    assert.deepEqual(localInferredPreflight.summary.codexAppServer, localRaw.summary);
    assert.deepEqual(
      normalizeWrappedSummary(localInferredPreflight.summary.codex),
      normalizeWrappedSummary(localWrapped.summary),
    );
    assert.match(
      localInferredPreflight.summary.summary,
      /provider readiness=trusted_command_ready \(unvalidated\)/,
    );
    assert.match(
      localInferredPreflight.summary.summary,
      /provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );

    const localPartialInferredEnv = buildDoctorEnv(fakeCodexPath, 'partial-app-server', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'partial-app-server',
    });

    const localPartialInferredProviderReadiness = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      localPartialInferredEnv,
    );
    const localPartialInferredProviderSync = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      localPartialInferredEnv,
    );
    const localPartialInferredRaw = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'allow-degraded'],
      localPartialInferredEnv,
    );
    const localPartialInferredWrapped = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'allow-fallback'],
      localPartialInferredEnv,
    );
    const localPartialInferredPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localPartialInferredEnv,
    );

    assert.equal(localPartialInferredProviderReadiness.code, 0);
    assert.equal(localPartialInferredProviderSync.code, 0);
    assert.equal(localPartialInferredRaw.code, 0);
    assert.equal(localPartialInferredWrapped.code, 0);
    assert.equal(localPartialInferredPreflight.code, 0);
    assert.equal(localPartialInferredProviderReadiness.summary.verdict, 'ready');
    assert.equal(localPartialInferredProviderReadiness.summary.message, 'trusted_command_ready (unvalidated)');
    assert.equal(localPartialInferredProviderSync.summary.verdict, 'attention_required');
    assert.equal(
      localPartialInferredProviderSync.summary.message,
      'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
    );
    assert.equal(localPartialInferredRaw.summary.verdict, 'attention_required');
    assert.equal(localPartialInferredRaw.summary.state, 'usage_endpoint_unavailable');
    assert.equal(localPartialInferredRaw.summary.message, 'usage endpoint unavailable via chatgpt.com [rate-limits none]');
    assert.equal(localPartialInferredWrapped.summary.verdict, 'attention_required');
    assert.equal(localPartialInferredWrapped.summary.state, 'partial_app_server');
    assert.equal(
      localPartialInferredWrapped.summary.message,
      'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    );
    assert.equal(localPartialInferredPreflight.summary.verdict, 'degraded_but_acceptable');
    assert.deepEqual(localPartialInferredPreflight.summary.checkMessages, {
      operator: 'local-only; host=127.0.0.1',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'usage endpoint unavailable via chatgpt.com [rate-limits none]',
      codex_wrapper: 'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    });
    assert.equal(
      localPartialInferredPreflight.summary.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(
      localPartialInferredPreflight.summary.checkDetails.provider_sync.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.deepEqual(localPartialInferredPreflight.summary.providerReadiness, localPartialInferredProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(localPartialInferredPreflight.summary.providerSync),
      normalizeProviderSyncSummary(localPartialInferredProviderSync.summary),
    );
    assert.deepEqual(localPartialInferredPreflight.summary.codexAppServer, localPartialInferredRaw.summary);
    assert.deepEqual(
      normalizeWrappedSummary(localPartialInferredPreflight.summary.codex),
      normalizeWrappedSummary(localPartialInferredWrapped.summary),
    );
    assert.match(
      localPartialInferredPreflight.summary.summary,
      /provider sync=partial app-server context: usage endpoint unavailable via chatgpt.com, OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      localPartialInferredPreflight.summary.summary,
      /wrapper status=partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );

    const localMissingTokenEnv = buildDoctorEnv(fakeCodexPath, 'fallback', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'fallback',
    });

    const localMissingTokenOperator = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'local-only'],
      localMissingTokenEnv,
    );
    const localMissingTokenPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localMissingTokenEnv,
    );

    assert.equal(localMissingTokenOperator.code, 1);
    assert.equal(localMissingTokenOperator.summary.verdict, 'blocked');
    assert.equal(localMissingTokenOperator.summary.message, 'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.');
    assert.equal(localMissingTokenOperator.summary.operatorTokenConfigured, false);
    assert.equal(localMissingTokenOperator.summary.operatorTokenSource, 'unset');
    assert.deepEqual(localMissingTokenOperator.summary.scopes, {
      taskCreate: 'open',
      taskUpdate: 'open',
      subscriptionRefresh: 'open',
      subscriptionReplace: 'disabled',
    });

    assert.equal(localMissingTokenPreflight.code, 1);
    assert.equal(localMissingTokenPreflight.summary.verdict, 'blocked');
    assert.deepEqual(localMissingTokenPreflight.summary.failureCodes, ['operator_readiness_failed']);
    assert.deepEqual(localMissingTokenPreflight.summary.blockedChecks, ['operator']);
    assert.equal(
      localMissingTokenPreflight.summary.checkMessages.operator,
      'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.',
    );
    const {
      schemaVersion: _localMissingTokenSchemaVersion,
      kind: _localMissingTokenKind,
      ...expectedNestedLocalMissingToken
    } = localMissingTokenOperator.summary;
    assert.deepEqual(localMissingTokenPreflight.summary.checkDetails.operator, expectedNestedLocalMissingToken);
    assert.deepEqual(localMissingTokenPreflight.summary.operator, localMissingTokenOperator.summary);
    assert.deepEqual(localMissingTokenPreflight.summary.providerReadiness, localProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(localMissingTokenPreflight.summary.providerSync),
      normalizeProviderSyncSummary(localProviderSync.summary),
    );
    assert.deepEqual(localMissingTokenPreflight.summary.codexAppServer, localRaw.summary);
    assert.deepEqual(
      normalizeWrappedSummary(localMissingTokenPreflight.summary.codex),
      normalizeWrappedSummary(localWrapped.summary),
    );
    assert.match(
      localMissingTokenPreflight.summary.summary,
      /operator=Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN\./,
    );
    assert.match(
      localMissingTokenPreflight.summary.summary,
      /provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      localMissingTokenPreflight.summary.summary,
      /wrapper status=login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );

    const missingCodexPath = path.join(tempRoot, 'missing-codex');
    const localMissingCliEnv = buildDoctorEnv(missingCodexPath, 'fallback', {
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'fallback',
    });

    const localMissingRaw = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'allow-degraded'],
      localMissingCliEnv,
    );
    const localMissingWrapped = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'allow-fallback'],
      localMissingCliEnv,
    );
    const localMissingPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localMissingCliEnv,
    );

    assert.notEqual(localMissingRaw.code, 0);
    assert.notEqual(localMissingWrapped.code, 0);
    assert.notEqual(localMissingPreflight.code, 0);
    assert.equal(localMissingRaw.summary.state, 'app_server_unavailable');
    assert.equal(localMissingWrapped.summary.state, 'cli_unavailable');
    assert.equal(localMissingPreflight.summary.verdict, 'blocked');
    assert.deepEqual(localMissingPreflight.summary.failureCodes, ['codex_wrapper_failed']);
    assert.deepEqual(localMissingPreflight.summary.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
      'raw_codex_app_server_degraded',
    ]);
    assert.deepEqual(localMissingPreflight.summary.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(localMissingPreflight.summary.attentionChecks, ['provider_sync', 'raw_codex_app_server']);
    assert.deepEqual(localMissingPreflight.summary.blockedChecks, ['codex_wrapper']);
    assert.deepEqual(localMissingPreflight.summary.checkMessages, {
      operator: 'local-only; host=127.0.0.1',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'login fallback: app-server unavailable (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'Codex app-server could not start.',
      codex_wrapper: 'Codex CLI could not start.',
    });
    assert.equal(localMissingPreflight.summary.checkDetails.raw_codex_app_server.message, 'Codex app-server could not start.');
    assert.equal(localMissingPreflight.summary.checkDetails.codex_wrapper.message, 'Codex CLI could not start.');
    assert.equal(localMissingPreflight.summary.checkDetails.codex_wrapper.state, 'cli_unavailable');
    assert.deepEqual(localMissingPreflight.summary.operator, localOperator.summary);
    assert.deepEqual(localMissingPreflight.summary.providerReadiness, localProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(localMissingPreflight.summary.providerSync),
      normalizeProviderSyncSummary(localProviderSync.summary),
    );
    assert.deepEqual(localMissingPreflight.summary.codexAppServer, localMissingRaw.summary);
    assert.deepEqual(
      normalizeWrappedSummary(localMissingPreflight.summary.codex),
      normalizeWrappedSummary(localMissingWrapped.summary),
    );
    assert.match(localMissingPreflight.summary.summary, /operator=local-only, host=127\.0\.0\.1/);
    assert.match(localMissingPreflight.summary.summary, /raw Codex status=app-server unavailable \[rate-limits none\]/);
    assert.match(
      localMissingPreflight.summary.summary,
      /provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localMissingPreflight.summary.summary, /wrapper status=Codex CLI could not start\./);

    const localOperatorConflictEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fakeSyncPath,
    });

    const localOperatorConflict = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'local-only'],
      localOperatorConflictEnv,
    );
    const localOperatorConflictPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localOperatorConflictEnv,
    );

    assert.equal(localOperatorConflict.code, 1);
    assert.equal(localOperatorConflict.summary.verdict, 'blocked');
    assert.equal(
      localOperatorConflict.summary.message,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );
    assert.equal(localOperatorConflict.summary.operatorTokenSource, 'env');
    assert.equal(localOperatorConflict.summary.operatorTokenFile, 'fake-openai-sync.mjs');
    assert.equal(localOperatorConflict.summary.operatorTokenConfigured, false);
    assert.deepEqual(localOperatorConflict.summary.failureCodes, ['operator_readiness_failed']);

    assert.equal(localOperatorConflictPreflight.code, 1);
    assert.equal(localOperatorConflictPreflight.summary.verdict, 'blocked');
    assert.equal(
      localOperatorConflictPreflight.summary.checkMessages.operator,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );
    const {
      schemaVersion: _operatorSchemaVersion,
      kind: _operatorKind,
      ...expectedNestedOperatorConflict
    } = localOperatorConflict.summary;
    assert.deepEqual(localOperatorConflictPreflight.summary.checkDetails.operator, expectedNestedOperatorConflict);
    assert.deepEqual(localOperatorConflictPreflight.summary.operator, localOperatorConflict.summary);
    assert.match(
      localOperatorConflictPreflight.summary.summary,
      /operator=Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );

    const insecureDefaultTokenDir = path.join(tempRoot, 'local-home', '.switchboard');
    const insecureDefaultTokenFile = path.join(insecureDefaultTokenDir, 'operator-token');
    await mkdir(insecureDefaultTokenDir, { recursive: true, mode: 0o700 });
    await writeFile(insecureDefaultTokenFile, 'reviewed-default-token\n', { mode: 0o600 });
    await chmod(insecureDefaultTokenDir, 0o755);

    const localInsecureDefaultTokenEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_OPERATOR_TOKEN_FILE: insecureDefaultTokenFile,
    });

    const localInsecureDefaultToken = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'local-only'],
      localInsecureDefaultTokenEnv,
    );
    const localInsecureDefaultTokenPreflight = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'local-only', 'allow-fallback'],
      localInsecureDefaultTokenEnv,
    );

    assert.equal(localInsecureDefaultToken.code, 1);
    assert.equal(localInsecureDefaultToken.summary.verdict, 'blocked');
    assert.equal(
      localInsecureDefaultToken.summary.message,
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    );
    assert.equal(localInsecureDefaultToken.summary.operatorTokenSource, 'file');
    assert.equal(localInsecureDefaultToken.summary.operatorTokenFile, 'operator-token');
    assert.equal(localInsecureDefaultToken.summary.operatorTokenConfigured, false);
    assert.deepEqual(localInsecureDefaultToken.summary.failureCodes, ['operator_readiness_failed']);

    assert.equal(localInsecureDefaultTokenPreflight.code, 1);
    assert.equal(localInsecureDefaultTokenPreflight.summary.verdict, 'blocked');
    assert.equal(
      localInsecureDefaultTokenPreflight.summary.checkMessages.operator,
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    );
    const {
      schemaVersion: _insecureDefaultOperatorSchemaVersion,
      kind: _insecureDefaultOperatorKind,
      ...expectedNestedInsecureDefaultOperator
    } = localInsecureDefaultToken.summary;
    assert.deepEqual(localInsecureDefaultTokenPreflight.summary.checkDetails.operator, expectedNestedInsecureDefaultOperator);
    assert.deepEqual(localInsecureDefaultTokenPreflight.summary.operator, localInsecureDefaultToken.summary);
    assert.match(
      localInsecureDefaultTokenPreflight.summary.summary,
      /operator=Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others\. Use chmod 700\./,
    );

    const remoteEnv = buildDoctorEnv(fakeCodexPath, 'partial-app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'partial-app-server',
    });

    const remoteOperator = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'remote-trusted'],
      remoteEnv,
    );
    const remoteProviderReadiness = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      remoteEnv,
    );
    const remoteProviderSync = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      remoteEnv,
    );
    const remoteRawBlocked = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      remoteEnv,
    );
    const remoteWrappedBlocked = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      remoteEnv,
    );
    const remotePreflightBlocked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      remoteEnv,
    );

    assert.equal(remoteOperator.code, 0);
    assert.equal(remoteRawBlocked.code, 1);
    assert.equal(remoteWrappedBlocked.code, 1);
    assert.equal(remotePreflightBlocked.code, 1);
    assert.equal(remoteOperator.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteProviderReadiness.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteProviderSync.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteRawBlocked.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteWrappedBlocked.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remotePreflightBlocked.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remotePreflightBlocked.summary.verdict, 'blocked');
    assert.deepEqual(remotePreflightBlocked.summary.failureCodes, [
      'raw_codex_app_server_failed',
      'codex_wrapper_failed',
    ]);
    assert.deepEqual(remotePreflightBlocked.summary.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
    ]);
    assert.deepEqual(remotePreflightBlocked.summary.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(remotePreflightBlocked.summary.attentionChecks, ['provider_sync']);
    assert.deepEqual(remotePreflightBlocked.summary.blockedChecks, ['raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(remotePreflightBlocked.summary.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'attention_required',
      raw_codex_app_server: 'blocked',
      codex_wrapper: 'blocked',
    });
    assert.deepEqual(remotePreflightBlocked.summary.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: ['provider_sync_degraded'],
      raw_codex_app_server: ['raw_codex_app_server_failed'],
      codex_wrapper: ['codex_wrapper_failed'],
    });
    assert.deepEqual(remotePreflightBlocked.summary.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'usage endpoint unavailable via chatgpt.com [rate-limits none]',
      codex_wrapper: 'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    });
    assert.deepEqual(normalizeCheckDetails(remotePreflightBlocked.summary.checkDetails), {
      operator: {
        profile: 'remote-trusted',
        verdict: 'ready',
        host: '0.0.0.0',
        localOnly: false,
        allowRemote: true,
        operatorTokenConfigured: true,
        operatorTokenSource: 'env',
        manualSubscriptionReplaceEnabled: false,
        protocol: 'https',
        tlsEnabled: true,
        tlsCertFile: 'broker-cert.pem',
        tlsKeyFile: 'broker-key.pem',
        failureCodes: [],
        advisoryCodes: [],
        scopes: {
          taskCreate: 'operator_token',
          taskUpdate: 'operator_token',
          subscriptionRefresh: 'operator_token',
          subscriptionReplace: 'disabled',
        },
        problems: [],
        message: 'remote-trusted; host=0.0.0.0',
      },
      provider_readiness: {
        provider: 'openai',
        state: 'trusted_command_ready',
        kind: 'trusted-command',
        source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
        configured: true,
        secure: true,
        validated: false,
        codes: ['provider_trusted_command_unvalidated'],
        message: 'trusted_command_ready (unvalidated)',
        unvalidated: true,
      },
      provider_sync: {
        provider: 'openai',
        state: 'trusted_command_degraded',
        kind: 'trusted-command',
        source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
        configured: true,
        secure: true,
        refreshedAt: '<dynamic>',
        accountCount: 1,
        codes: ['provider_sync_degraded'],
        message: 'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
        syncMethods: ['provider'],
        accountSyncMethods: ['provider'],
        syncModes: ['app-server-account'],
        syncBadges: ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
        rateLimitHosts: ['chatgpt.com'],
        openaiAuth: ['required'],
        quotaCoverage: 'informational_only',
        quotaModelCount: 1,
        typedQuotaModelCount: 0,
      },
      raw_codex_app_server: {
        verdict: 'blocked',
        failureCodes: ['raw_codex_app_server_failed'],
        advisoryCodes: [],
        message: 'usage endpoint unavailable via chatgpt.com [rate-limits none]',
        userAgent: remoteRawBlocked.summary.userAgent,
        accountType: remoteRawBlocked.summary.accountType,
        plan: remoteRawBlocked.summary.plan,
        state: 'usage_endpoint_unavailable',
        rateLimitStatus: 'usage endpoint unavailable',
        rateLimitHost: 'chatgpt.com',
        endpoint: remoteRawBlocked.summary.endpoint,
        openaiAuth: 'required',
        rateLimitCoverage: 'none',
        rateLimitBucketCount: 0,
        typedRateLimitBucketCount: 0,
        rateLimitDetails: [],
      },
      codex_wrapper: {
        verdict: 'blocked',
        failureCodes: ['codex_wrapper_failed'],
        advisoryCodes: [],
        message: 'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
        account: remoteWrappedBlocked.summary.account,
        refreshedAt: '<dynamic>',
        refreshedDisplay: '<dynamic>',
        state: 'partial_app_server',
        source: 'app-server account',
        rateLimitsHost: 'chatgpt.com',
        openaiAuth: 'required',
        plan: remoteWrappedBlocked.summary.plan,
        credits: remoteWrappedBlocked.summary.credits,
        ok: false,
        quotaCoverage: 'informational_only',
        quotaModelCount: 1,
        typedQuotaModelCount: 0,
        quotaDetails: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'medium',
            interpretation: 'informational',
            notes: 'Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop/0.122.0 (doctor contracts smoke)',
          },
        ],
      },
    });
    assert.equal(remoteRawBlocked.summary.state, 'usage_endpoint_unavailable');
    assert.equal(remoteWrappedBlocked.summary.state, 'partial_app_server');
    assert.deepEqual(remotePreflightBlocked.summary.operator, remoteOperator.summary);
    assert.deepEqual(remotePreflightBlocked.summary.providerReadiness, remoteProviderReadiness.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(remotePreflightBlocked.summary.providerSync),
      normalizeProviderSyncSummary(remoteProviderSync.summary),
    );
    assert.deepEqual(remotePreflightBlocked.summary.codexAppServer, remoteRawBlocked.summary);
    assert.deepEqual(
      normalizeWrappedSummary(remotePreflightBlocked.summary.codex),
      normalizeWrappedSummary(remoteWrappedBlocked.summary),
    );
    assert.deepEqual(remotePreflightBlocked.summary.failures, [
      'Raw Codex app-server doctor failed for mode require-rate-limits.',
      'Codex doctor failed for mode require-rate-limits.',
    ]);
    assert.equal(remotePreflightBlocked.summary.codexAppServer.rateLimitHost, 'chatgpt.com');
    assert.equal(remotePreflightBlocked.summary.codex.rateLimitsHost, 'chatgpt.com');
    assert.match(remotePreflightBlocked.summary.summary, /operator=remote-trusted, host=0\.0\.0\.0/);
    assert.match(remotePreflightBlocked.summary.summary, /provider readiness=trusted_command_ready \(unvalidated\)/);
    assert.match(
      remotePreflightBlocked.summary.summary,
      /provider sync=partial app-server context: usage endpoint unavailable via chatgpt.com, OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      remotePreflightBlocked.summary.summary,
      /raw Codex status=usage endpoint unavailable via chatgpt.com \[rate-limits none\]/,
    );
    assert.match(
      remotePreflightBlocked.summary.summary,
      /wrapper status=partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );

    const remoteReadyEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
    });

    const remoteProviderReadinessReady = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      remoteReadyEnv,
    );
    const remoteProviderSyncReady = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      remoteReadyEnv,
    );
    const remoteRawReady = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      remoteReadyEnv,
    );
    const remoteWrappedReady = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      remoteReadyEnv,
    );
    const remotePreflightReady = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      remoteReadyEnv,
    );

    assert.equal(remoteRawReady.code, 0);
    assert.equal(remoteWrappedReady.code, 0);
    assert.equal(remotePreflightReady.code, 0);
    assert.equal(remoteRawReady.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteWrappedReady.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remotePreflightReady.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteProviderSyncReady.summary.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remotePreflightReady.summary.verdict, 'ready');
    assert.equal(remotePreflightReady.summary.failures.length, 0);
    assert.deepEqual(remotePreflightReady.summary.failureCodes, []);
    assert.deepEqual(remotePreflightReady.summary.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(remotePreflightReady.summary.readyChecks, [
      'operator',
      'provider_readiness',
      'provider_sync',
      'raw_codex_app_server',
      'codex_wrapper',
    ]);
    assert.deepEqual(remotePreflightReady.summary.attentionChecks, []);
    assert.deepEqual(remotePreflightReady.summary.blockedChecks, []);
    assert.deepEqual(remotePreflightReady.summary.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'ready',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(remotePreflightReady.summary.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: [],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(remotePreflightReady.summary.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'app-server rate-limits available',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.deepEqual(normalizeCheckDetails(remotePreflightReady.summary.checkDetails), {
      operator: {
        profile: 'remote-trusted',
        verdict: 'ready',
        host: '0.0.0.0',
        localOnly: false,
        allowRemote: true,
        operatorTokenConfigured: true,
        operatorTokenSource: 'env',
        manualSubscriptionReplaceEnabled: false,
        protocol: 'https',
        tlsEnabled: true,
        tlsCertFile: 'broker-cert.pem',
        tlsKeyFile: 'broker-key.pem',
        failureCodes: [],
        advisoryCodes: [],
        scopes: {
          taskCreate: 'operator_token',
          taskUpdate: 'operator_token',
          subscriptionRefresh: 'operator_token',
          subscriptionReplace: 'disabled',
        },
        problems: [],
        message: 'remote-trusted; host=0.0.0.0',
      },
      provider_readiness: {
        provider: 'openai',
        state: 'trusted_command_ready',
        kind: 'trusted-command',
        source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
        configured: true,
        secure: true,
        validated: false,
        codes: ['provider_trusted_command_unvalidated'],
        message: 'trusted_command_ready (unvalidated)',
        unvalidated: true,
      },
      provider_sync: {
        provider: 'openai',
        state: 'trusted_command_succeeded',
        kind: 'trusted-command',
        source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
        configured: true,
        secure: true,
        refreshedAt: '<dynamic>',
        accountCount: 1,
        codes: [],
        message: 'app-server rate-limits available',
        syncMethods: ['provider'],
        accountSyncMethods: ['provider'],
        syncModes: ['app-server-rate-limits'],
        syncBadges: [],
        rateLimitHosts: [],
        openaiAuth: ['required'],
        quotaCoverage: 'typed',
        quotaModelCount: 2,
        typedQuotaModelCount: 2,
      },
      raw_codex_app_server: {
        verdict: 'ready',
        failureCodes: [],
        advisoryCodes: [],
        message: 'available',
        userAgent: remoteRawReady.summary.userAgent,
        accountType: remoteRawReady.summary.accountType,
        plan: remoteRawReady.summary.plan,
        state: 'available',
        rateLimitStatus: 'available',
        rateLimitHost: null,
        endpoint: remoteRawReady.summary.endpoint,
        openaiAuth: 'required',
        rateLimitCoverage: 'typed',
        rateLimitBucketCount: 2,
        typedRateLimitBucketCount: 2,
        rateLimitDetails: [
          {
            limitId: 'codex',
            displayName: 'Codex',
            interpretation: 'percentage_window',
            windows: [
              {
                id: '300m',
                label: '5-hour window',
                durationMinutes: 300,
                limit: 100,
                used: 9,
                remaining: 91,
                interpretation: 'percentage_window',
                resetAt: '2026-04-21T23:37:43.000Z',
              },
              {
                id: '10080m',
                label: 'Weekly window',
                durationMinutes: 10080,
                limit: 100,
                used: 2,
                remaining: 98,
                interpretation: 'percentage_window',
                resetAt: '2026-04-28T18:37:43.000Z',
              },
            ],
          },
          {
            limitId: 'codex_bengalfox',
            displayName: 'GPT-5.3-Codex-Spark',
            interpretation: 'percentage_window',
            windows: [
              {
                id: '300m',
                label: '5-hour window',
                durationMinutes: 300,
                limit: 100,
                used: 0,
                remaining: 100,
                interpretation: 'percentage_window',
                resetAt: '2026-04-22T02:49:53.000Z',
              },
              {
                id: '10080m',
                label: 'Weekly window',
                durationMinutes: 10080,
                limit: 100,
                used: 0,
                remaining: 100,
                interpretation: 'percentage_window',
                resetAt: '2026-04-28T21:49:53.000Z',
              },
            ],
          },
        ],
      },
      codex_wrapper: {
        verdict: 'ready',
        failureCodes: [],
        advisoryCodes: [],
        message: 'full rate-limits available',
        account: remoteWrappedReady.summary.account,
        refreshedAt: '<dynamic>',
        refreshedDisplay: '<dynamic>',
        state: 'full_rate_limits',
        source: 'app-server rate-limits',
        rateLimitsHost: null,
        openaiAuth: 'required',
        plan: remoteWrappedReady.summary.plan,
        credits: remoteWrappedReady.summary.credits,
        ok: true,
        quotaCoverage: 'typed',
        quotaModelCount: 2,
        typedQuotaModelCount: 2,
        quotaDetails: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'high',
            limit: 100,
            used: 9,
            remaining: 91,
            interpretation: 'percentage_window',
            resetAt: '2026-04-21T23:37:43.000Z',
            windows: [
              {
                id: '300m',
                label: '5-hour window',
                durationMinutes: 300,
                limit: 100,
                used: 9,
                remaining: 91,
                interpretation: 'percentage_window',
                resetAt: '2026-04-21T23:37:43.000Z',
              },
              {
                id: '10080m',
                label: 'Weekly window',
                durationMinutes: 10080,
                limit: 100,
                used: 2,
                remaining: 98,
                interpretation: 'percentage_window',
                resetAt: '2026-04-28T18:37:43.000Z',
              },
            ],
          },
          {
            modelId: 'codex_bengalfox',
            displayName: 'GPT-5.3-Codex-Spark',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'unknown',
            source: 'cli',
            confidence: 'high',
            limit: 100,
            used: 0,
            remaining: 100,
            interpretation: 'percentage_window',
            resetAt: '2026-04-22T02:49:53.000Z',
            windows: [
              {
                id: '300m',
                label: '5-hour window',
                durationMinutes: 300,
                limit: 100,
                used: 0,
                remaining: 100,
                interpretation: 'percentage_window',
                resetAt: '2026-04-22T02:49:53.000Z',
              },
              {
                id: '10080m',
                label: 'Weekly window',
                durationMinutes: 10080,
                limit: 100,
                used: 0,
                remaining: 100,
                interpretation: 'percentage_window',
                resetAt: '2026-04-28T21:49:53.000Z',
              },
            ],
          },
        ],
      },
    });
    assert.equal(remoteRawReady.summary.state, 'available');
    assert.equal(remoteWrappedReady.summary.state, 'full_rate_limits');
    assert.deepEqual(remotePreflightReady.summary.operator, remoteOperator.summary);
    assert.deepEqual(remotePreflightReady.summary.providerReadiness, remoteProviderReadinessReady.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(remotePreflightReady.summary.providerSync),
      normalizeProviderSyncSummary(remoteProviderSyncReady.summary),
    );
    assert.deepEqual(remotePreflightReady.summary.codexAppServer, remoteRawReady.summary);
    assert.deepEqual(
      normalizeWrappedSummary(remotePreflightReady.summary.codex),
      normalizeWrappedSummary(remoteWrappedReady.summary),
    );
    assert.match(remotePreflightReady.summary.summary, /ready for strict rollout/);
    assert.match(remotePreflightReady.summary.summary, /operator=remote-trusted, host=0\.0\.0\.0/);
    assert.match(remotePreflightReady.summary.summary, /provider readiness=trusted_command_ready \(unvalidated\)/);
    assert.match(remotePreflightReady.summary.summary, /provider sync=app-server rate-limits available/);
    assert.match(remotePreflightReady.summary.summary, /raw Codex status=available/);
    assert.match(remotePreflightReady.summary.summary, /wrapper status=full rate-limits available/);

    const remoteOperatorFileBacked = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'remote-trusted'],
      buildDoctorEnv(fakeCodexPath, 'app-server', {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
      }),
    );
    assert.equal(remoteOperatorFileBacked.summary.operatorTokenConfigured, true);
    assert.equal(remoteOperatorFileBacked.summary.operatorTokenSource, 'file');
    assert.equal(remoteOperatorFileBacked.summary.operatorTokenFile, 'operator-token');

    const remotePreflightFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      buildDoctorEnv(fakeCodexPath, 'app-server', {
        FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      }),
    );
    assert.equal(remotePreflightFileBacked.summary.verdict, 'ready');
    assert.equal(remotePreflightFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(remotePreflightFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(remotePreflightFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(remotePreflightFileBacked.summary.checkDetails.provider_readiness.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)');
    assertPreferredProviderReadinessAlignment(
      remotePreflightFileBacked.summary.checkDetails.provider_readiness,
      remotePreflightFileBacked.summary.providerReadiness,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_readiness.kind,
      remotePreflightFileBacked.summary.providerReadiness.providerKinds?.openai,
    );
    assert.equal(remotePreflightFileBacked.summary.checkDetails.provider_readiness.configured, true);
    assert.equal(remotePreflightFileBacked.summary.checkDetails.provider_readiness.secure, true);
    assert.equal(remotePreflightFileBacked.summary.checkDetails.provider_readiness.validated, false);
    assert.equal(remotePreflightFileBacked.summary.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      remotePreflightFileBacked.summary.checkDetails.provider_readiness.codes,
      remotePreflightFileBacked.summary.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_readiness.lastModifiedAt ?? null,
      remotePreflightFileBacked.summary.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_readiness.message,
      remotePreflightFileBacked.summary.providerReadiness.message,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.source,
      remotePreflightFileBacked.summary.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      remotePreflightFileBacked.summary.checkDetails.provider_sync,
      remotePreflightFileBacked.summary.providerSync,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.refreshedAt,
      remotePreflightFileBacked.summary.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.syncMethods,
      remotePreflightFileBacked.summary.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.accountCount,
      remotePreflightFileBacked.summary.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.syncModes,
      remotePreflightFileBacked.summary.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.syncBadges,
      remotePreflightFileBacked.summary.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.provider_sync.message,
      remotePreflightFileBacked.summary.providerSync.message,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.raw_codex_app_server.userAgent,
      remotePreflightFileBacked.summary.codexAppServer.userAgent,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.raw_codex_app_server.accountType,
      remotePreflightFileBacked.summary.codexAppServer.accountType,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.raw_codex_app_server.plan,
      remotePreflightFileBacked.summary.codexAppServer.plan,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.raw_codex_app_server.endpoint,
      remotePreflightFileBacked.summary.codexAppServer.endpoint,
    );
    assert.equal(remotePreflightFileBacked.summary.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.codex_wrapper.source,
      remotePreflightFileBacked.summary.codex.source,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.codex_wrapper.account,
      remotePreflightFileBacked.summary.codex.account,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.codex_wrapper.refreshedAt,
      remotePreflightFileBacked.summary.codex.refreshedAt,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.codex_wrapper.refreshedDisplay,
      remotePreflightFileBacked.summary.codex.refreshedDisplay,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.codex_wrapper.plan,
      remotePreflightFileBacked.summary.codex.plan,
    );
    assert.equal(
      remotePreflightFileBacked.summary.checkDetails.codex_wrapper.credits,
      remotePreflightFileBacked.summary.codex.credits,
    );
    assert.deepEqual(remotePreflightFileBacked.summary.checkMessages, remotePreflightReady.summary.checkMessages);

    const remoteProviderMixedEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
    });
    const remoteProviderSyncMixed = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      remoteProviderMixedEnv,
    );
    const remotePreflightProviderMixed = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      remoteProviderMixedEnv,
    );
    assert.equal(remoteProviderSyncMixed.code, 0);
    assert.equal(remotePreflightProviderMixed.code, 0);
    assert.equal(remoteProviderSyncMixed.summary.providerQuotaCoverage.openai, 'mixed');
    assert.equal(remoteProviderSyncMixed.summary.providerQuotaModelCounts.openai, 2);
    assert.equal(remoteProviderSyncMixed.summary.providerTypedQuotaModelCounts.openai, 1);
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assertPreferredProviderReadinessAlignment(
      remotePreflightProviderMixed.summary.checkDetails.provider_readiness,
      remotePreflightProviderMixed.summary.providerReadiness,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_readiness.kind,
      remotePreflightProviderMixed.summary.providerReadiness.providerKinds?.openai,
    );
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_readiness.configured, true);
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_readiness.secure, true);
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_readiness.validated, false);
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      remotePreflightProviderMixed.summary.checkDetails.provider_readiness.codes,
      remotePreflightProviderMixed.summary.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_readiness.lastModifiedAt ?? null,
      remotePreflightProviderMixed.summary.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_readiness.message,
      remotePreflightProviderMixed.summary.providerReadiness.message,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.source,
      remotePreflightProviderMixed.summary.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync,
      remotePreflightProviderMixed.summary.providerSync,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.refreshedAt,
      remotePreflightProviderMixed.summary.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.syncMethods,
      remotePreflightProviderMixed.summary.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.accountCount,
      remotePreflightProviderMixed.summary.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.syncModes,
      remotePreflightProviderMixed.summary.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.syncBadges,
      remotePreflightProviderMixed.summary.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      remotePreflightProviderMixed.summary.checkDetails.provider_sync.message,
      remotePreflightProviderMixed.summary.providerSync.message,
    );
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_sync.quotaCoverage, 'mixed');
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(remotePreflightProviderMixed.summary.checkDetails.provider_sync.typedQuotaModelCount, 1);
    assert.equal(remotePreflightProviderMixed.summary.checkMessages.provider_sync, 'app-server rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      remotePreflightProviderMixed.summary.summary,
      /provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );
    assert.match(remotePreflightProviderMixed.summary.summary, /raw Codex status=available/);
    assert.match(remotePreflightProviderMixed.summary.summary, /wrapper status=full rate-limits available/);

    const remoteProviderMixedFileBackedEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
    });
    const remotePreflightProviderMixedFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      remoteProviderMixedFileBackedEnv,
    );
    assert.equal(remotePreflightProviderMixedFileBacked.code, 0);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assertPreferredProviderReadinessAlignment(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness,
      remotePreflightProviderMixedFileBacked.summary.providerReadiness,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.kind,
      remotePreflightProviderMixedFileBacked.summary.providerReadiness.providerKinds?.openai,
    );
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.configured, true);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.secure, true);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.validated, false);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.codes,
      remotePreflightProviderMixedFileBacked.summary.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.lastModifiedAt ?? null,
      remotePreflightProviderMixedFileBacked.summary.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_readiness.message,
      remotePreflightProviderMixedFileBacked.summary.providerReadiness.message,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.source,
      remotePreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync,
      remotePreflightProviderMixedFileBacked.summary.providerSync,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.refreshedAt,
      remotePreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.syncMethods,
      remotePreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.accountCount,
      remotePreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.syncModes,
      remotePreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.syncBadges,
      remotePreflightProviderMixedFileBacked.summary.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.message,
      remotePreflightProviderMixedFileBacked.summary.providerSync.message,
    );
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.quotaCoverage, 'mixed');
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkDetails.provider_sync.typedQuotaModelCount, 1);
    assert.equal(remotePreflightProviderMixedFileBacked.summary.checkMessages.provider_sync, 'app-server rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      remotePreflightProviderMixedFileBacked.summary.summary,
      /operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const remoteMixedEnv = buildDoctorEnv(fakeCodexPath, 'mixed-app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
    });
    const remoteRawMixed = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      remoteMixedEnv,
    );
    const remotePreflightMixed = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      remoteMixedEnv,
    );
    assert.equal(remoteRawMixed.code, 0);
    assert.equal(remotePreflightMixed.code, 0);
    assert.equal(remoteRawMixed.summary.rateLimitCoverage, 'mixed');
    assert.equal(remoteRawMixed.summary.rateLimitBucketCount, 2);
    assert.equal(remoteRawMixed.summary.typedRateLimitBucketCount, 1);
    assert.equal(remotePreflightMixed.summary.checkDetails.raw_codex_app_server.rateLimitCoverage, 'mixed');
    assert.equal(remotePreflightMixed.summary.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(remotePreflightMixed.summary.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 1);
    assert.match(remotePreflightMixed.summary.checkDetails.raw_codex_app_server.userAgent ?? '', /^Codex Desktop\/0\.122\.0/);
    assert.equal(
      remotePreflightMixed.summary.checkDetails.raw_codex_app_server.accountType,
      remotePreflightMixed.summary.codexAppServer.accountType,
    );
    assert.equal(
      remotePreflightMixed.summary.checkDetails.raw_codex_app_server.plan,
      remotePreflightMixed.summary.codexAppServer.plan,
    );
    assert.equal(
      remotePreflightMixed.summary.checkDetails.raw_codex_app_server.endpoint,
      remotePreflightMixed.summary.codexAppServer.endpoint,
    );
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.quotaCoverage, 'mixed');
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.typedQuotaModelCount, 1);
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      remotePreflightMixed.summary.checkDetails.codex_wrapper.source,
      remotePreflightMixed.summary.codex.source,
    );
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.account, 'Codex Supervisor (Pro)');
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.refreshedAt, remotePreflightMixed.summary.codex.refreshedAt);
    assert.match(remotePreflightMixed.summary.checkDetails.codex_wrapper.refreshedDisplay ?? '', /2026/);
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.plan, remotePreflightMixed.summary.codex.plan);
    assert.equal(remotePreflightMixed.summary.checkDetails.codex_wrapper.credits, remotePreflightMixed.summary.codex.credits);
    assert.equal(remotePreflightMixed.summary.checkMessages.raw_codex_app_server, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(remotePreflightMixed.summary.checkMessages.codex_wrapper, 'full rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      remotePreflightMixed.summary.summary,
      /raw Codex status=available \[rate-limits mixed, typed 1\/2\]/,
    );
    assert.match(
      remotePreflightMixed.summary.summary,
      /wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const remoteMixedFileBackedEnv = buildDoctorEnv(fakeCodexPath, 'mixed-app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      FAKE_PROVIDER_SYNC_SCENARIO: 'app-server',
    });
    const remotePreflightMixedFileBacked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      remoteMixedFileBackedEnv,
    );
    assert.equal(remotePreflightMixedFileBacked.code, 0);
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.rateLimitCoverage, 'mixed');
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 1);
    assert.match(remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.userAgent ?? '', /^Codex Desktop\/0\.122\.0/);
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.accountType,
      remotePreflightMixedFileBacked.summary.codexAppServer.accountType,
    );
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.plan,
      remotePreflightMixedFileBacked.summary.codexAppServer.plan,
    );
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.raw_codex_app_server.endpoint,
      remotePreflightMixedFileBacked.summary.codexAppServer.endpoint,
    );
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.quotaCoverage, 'mixed');
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.typedQuotaModelCount, 1);
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.source,
      remotePreflightMixedFileBacked.summary.codex.source,
    );
    assert.equal(remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.account, 'Codex Supervisor (Pro)');
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.refreshedAt,
      remotePreflightMixedFileBacked.summary.codex.refreshedAt,
    );
    assert.match(remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.refreshedDisplay ?? '', /2026/);
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.plan,
      remotePreflightMixedFileBacked.summary.codex.plan,
    );
    assert.equal(
      remotePreflightMixedFileBacked.summary.checkDetails.codex_wrapper.credits,
      remotePreflightMixedFileBacked.summary.codex.credits,
    );
    assert.equal(remotePreflightMixedFileBacked.summary.checkMessages.raw_codex_app_server, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(remotePreflightMixedFileBacked.summary.checkMessages.codex_wrapper, 'full rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      remotePreflightMixedFileBacked.summary.summary,
      /operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available \[rate-limits mixed, typed 1\/2\]; wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const providerWiringBlockedEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
      SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":"/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs"}',
    });

    const providerReadinessBlocked = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      providerWiringBlockedEnv,
    );
    const providerSyncBlocked = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      providerWiringBlockedEnv,
    );
    const rawReadyWithBadProvider = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      providerWiringBlockedEnv,
    );
    const wrappedReadyWithBadProvider = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      providerWiringBlockedEnv,
    );
    const preflightProviderBlocked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      providerWiringBlockedEnv,
    );

    assert.equal(providerReadinessBlocked.code, 0);
    assert.equal(providerSyncBlocked.code, 0);
    assert.equal(rawReadyWithBadProvider.code, 0);
    assert.equal(wrappedReadyWithBadProvider.code, 0);
    assert.equal(preflightProviderBlocked.code, 1);
    assert.equal(preflightProviderBlocked.summary.verdict, 'blocked');
    assert.deepEqual(preflightProviderBlocked.summary.failureCodes, ['provider_command_invalid', 'provider_readiness_blocked']);
    assert.deepEqual(preflightProviderBlocked.summary.advisoryCodes, []);
    assert.deepEqual(preflightProviderBlocked.summary.readyChecks, ['operator', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(preflightProviderBlocked.summary.attentionChecks, []);
    assert.deepEqual(preflightProviderBlocked.summary.blockedChecks, ['provider_readiness', 'provider_sync']);
    assert.deepEqual(preflightProviderBlocked.summary.checkStates, {
      operator: 'ready',
      provider_readiness: 'blocked',
      provider_sync: 'blocked',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(preflightProviderBlocked.summary.checkCodes, {
      operator: [],
      provider_readiness: ['provider_command_invalid', 'provider_readiness_blocked'],
      provider_sync: ['provider_command_invalid'],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(preflightProviderBlocked.summary.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
      provider_sync: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.deepEqual(preflightProviderBlocked.summary.providerReadiness, providerReadinessBlocked.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(preflightProviderBlocked.summary.providerSync),
      normalizeProviderSyncSummary(providerSyncBlocked.summary),
    );
    assert.deepEqual(preflightProviderBlocked.summary.codexAppServer, rawReadyWithBadProvider.summary);
    assert.deepEqual(
      normalizeWrappedSummary(preflightProviderBlocked.summary.codex),
      normalizeWrappedSummary(wrappedReadyWithBadProvider.summary),
    );
    assert.deepEqual(preflightProviderBlocked.summary.failures, [
      'Provider readiness blocked for openai.',
      'Provider sync blocked for openai.',
    ]);
    assert.match(
      preflightProviderBlocked.summary.summary,
      /operator=remote-trusted, host=0\.0\.0\.0/,
    );
    assert.match(
      preflightProviderBlocked.summary.summary,
      /provider readiness=SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    assert.match(
      preflightProviderBlocked.summary.summary,
      /provider sync=SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    assert.equal(
      preflightProviderBlocked.stdout.includes('/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs'),
      false,
    );

    const providerSnapshotMissingEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      ...remoteTlsEnv,
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
    });

    const providerReadinessSnapshotMissing = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      providerSnapshotMissingEnv,
    );
    const providerSyncSnapshotMissing = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      providerSnapshotMissingEnv,
    );
    const rawReadyWithMissingSnapshot = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      providerSnapshotMissingEnv,
    );
    const wrappedReadyWithMissingSnapshot = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      providerSnapshotMissingEnv,
    );
    const preflightSnapshotMissing = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      providerSnapshotMissingEnv,
    );

    assert.equal(providerReadinessSnapshotMissing.code, 0);
    assert.equal(providerSyncSnapshotMissing.code, 0);
    assert.equal(rawReadyWithMissingSnapshot.code, 0);
    assert.equal(wrappedReadyWithMissingSnapshot.code, 0);
    assert.equal(preflightSnapshotMissing.code, 1);
    assert.equal(preflightSnapshotMissing.summary.verdict, 'blocked');
    assert.deepEqual(preflightSnapshotMissing.summary.failureCodes, ['provider_snapshot_missing']);
    assert.deepEqual(preflightSnapshotMissing.summary.advisoryCodes, [
      'provider_snapshot_missing',
      'provider_readiness_attention_required',
    ]);
    assert.deepEqual(preflightSnapshotMissing.summary.readyChecks, ['operator', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(preflightSnapshotMissing.summary.attentionChecks, ['provider_readiness']);
    assert.deepEqual(preflightSnapshotMissing.summary.blockedChecks, ['provider_sync']);
    assert.deepEqual(preflightSnapshotMissing.summary.checkStates, {
      operator: 'ready',
      provider_readiness: 'attention_required',
      provider_sync: 'blocked',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(preflightSnapshotMissing.summary.checkCodes, {
      operator: [],
      provider_readiness: ['provider_snapshot_missing', 'provider_readiness_attention_required'],
      provider_sync: ['provider_snapshot_missing'],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(preflightSnapshotMissing.summary.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'No sanitized snapshot file found yet.',
      provider_sync: 'No sanitized snapshot was found for provider "openai" at openai.json.',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.deepEqual(preflightSnapshotMissing.summary.providerReadiness, providerReadinessSnapshotMissing.summary);
    assert.deepEqual(
      normalizeProviderSyncSummary(preflightSnapshotMissing.summary.providerSync),
      normalizeProviderSyncSummary(providerSyncSnapshotMissing.summary),
    );
    assert.deepEqual(preflightSnapshotMissing.summary.codexAppServer, rawReadyWithMissingSnapshot.summary);
    assert.deepEqual(
      normalizeWrappedSummary(preflightSnapshotMissing.summary.codex),
      normalizeWrappedSummary(wrappedReadyWithMissingSnapshot.summary),
    );
    assert.match(
      preflightSnapshotMissing.summary.summary,
      /operator=remote-trusted, host=0\.0\.0\.0/,
    );
    assert.match(
      preflightSnapshotMissing.summary.summary,
      /provider readiness=No sanitized snapshot file found yet\./,
    );
    assert.match(
      preflightSnapshotMissing.summary.summary,
      /provider sync=No sanitized snapshot was found for provider "openai" at openai\.json\./,
    );

    const operatorBlockedEnv = buildDoctorEnv(fakeCodexPath, 'app-server', {
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_ALLOW_REMOTE: '0',
      SWITCHBOARD_OPERATOR_TOKEN: '',
    });

    const operatorBlocked = await runJsonScript(
      operatorDoctorEntry,
      [operatorDoctorEntry, 'from-env', 'remote-trusted'],
      operatorBlockedEnv,
    );
    const providerReadinessWithOperatorBlocked = await runJsonScript(
      providerReadinessDoctorEntry,
      [providerReadinessDoctorEntry, 'openai'],
      operatorBlockedEnv,
    );
    const providerSyncWithOperatorBlocked = await runJsonScript(
      providerSyncDoctorEntry,
      [providerSyncDoctorEntry, 'openai'],
      operatorBlockedEnv,
    );
    const rawReadyWithOperatorBlocked = await runJsonScript(
      codexAppServerDoctorEntry,
      [codexAppServerDoctorEntry, 'require-rate-limits'],
      operatorBlockedEnv,
    );
    const wrappedReadyWithOperatorBlocked = await runJsonScript(
      codexDoctorEntry,
      [codexDoctorEntry, 'require-rate-limits'],
      operatorBlockedEnv,
    );
    const preflightOperatorBlocked = await runJsonScript(
      preflightDoctorEntry,
      [preflightDoctorEntry, 'remote-trusted', 'require-rate-limits'],
      operatorBlockedEnv,
    );

    assert.equal(operatorBlocked.code, 1);
    assert.equal(operatorBlocked.stderr.includes('AssertionError [ERR_ASSERTION]'), false);
    assert.match(operatorBlocked.stderr, /Remote-trusted mode must bind to a non-loopback host\./);
    assert.equal(providerReadinessWithOperatorBlocked.code, 0);
    assert.equal(providerSyncWithOperatorBlocked.code, 0);
    assert.equal(providerReadinessWithOperatorBlocked.summary.verdict, 'ready');
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.failureCodes, []);
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.advisoryCodes, [
      'provider_trusted_command_unvalidated',
    ]);
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerStates, {
      openai: 'trusted_command_ready',
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerKinds, {
      openai: 'trusted-command',
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerConfigured, {
      openai: true,
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerSecure, {
      openai: true,
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerValidated, {
      openai: false,
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerCodes, {
      openai: ['provider_trusted_command_unvalidated'],
    });
    assert.deepEqual(providerReadinessWithOperatorBlocked.summary.providerMessages, {
      openai: 'trusted_command_ready (unvalidated)',
    });
    assert.equal(providerReadinessWithOperatorBlocked.summary.message, 'trusted_command_ready (unvalidated)');
    assert.equal(providerSyncWithOperatorBlocked.summary.verdict, 'ready');
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.failureCodes, []);
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.advisoryCodes, []);
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerStates, {
      openai: 'trusted_command_succeeded',
    });
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerKinds, {
      openai: 'trusted-command',
    });
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerConfigured, {
      openai: true,
    });
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerSecure, {
      openai: true,
    });
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerCodes, {
      openai: [],
    });
    assert.deepEqual(providerSyncWithOperatorBlocked.summary.providerMessages, {
      openai: 'app-server rate-limits available',
    });
    assert.equal(providerSyncWithOperatorBlocked.summary.message, 'app-server rate-limits available');
    assert.equal(rawReadyWithOperatorBlocked.code, 0);
    assert.equal(wrappedReadyWithOperatorBlocked.code, 0);
    assert.equal(preflightOperatorBlocked.code, 1);
    assert.equal(preflightOperatorBlocked.summary.verdict, 'blocked');
    assert.deepEqual(preflightOperatorBlocked.summary.failureCodes, ['operator_readiness_failed', 'provider_snapshot_missing']);
    assert.deepEqual(preflightOperatorBlocked.summary.advisoryCodes, [
      'provider_snapshot_missing',
      'provider_readiness_attention_required',
    ]);
    assert.deepEqual(preflightOperatorBlocked.summary.readyChecks, ['raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(preflightOperatorBlocked.summary.attentionChecks, ['provider_readiness']);
    assert.deepEqual(preflightOperatorBlocked.summary.blockedChecks, ['operator', 'provider_sync']);
    assert.deepEqual(preflightOperatorBlocked.summary.checkStates, {
      operator: 'blocked',
      provider_readiness: 'attention_required',
      provider_sync: 'blocked',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(preflightOperatorBlocked.summary.checkCodes, {
      operator: ['operator_readiness_failed'],
      provider_readiness: ['provider_snapshot_missing', 'provider_readiness_attention_required'],
      provider_sync: ['provider_snapshot_missing'],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(preflightOperatorBlocked.summary.checkMessages, {
      operator: 'Remote-trusted mode must bind to a non-loopback host.',
      provider_readiness: 'No sanitized snapshot file found yet.',
      provider_sync: 'No sanitized snapshot was found for provider "openai" at openai.json.',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.deepEqual(preflightOperatorBlocked.summary.checkDetails.operator, {
      profile: 'remote-trusted',
      verdict: 'blocked',
      host: '127.0.0.1',
      localOnly: true,
      allowRemote: false,
      operatorTokenConfigured: false,
      operatorTokenSource: 'unset',
      manualSubscriptionReplaceEnabled: false,
      protocol: 'http',
      tlsEnabled: false,
      failureCodes: ['operator_readiness_failed'],
      advisoryCodes: [],
      scopes: {
        taskCreate: 'open',
        taskUpdate: 'open',
        subscriptionRefresh: 'open',
        subscriptionReplace: 'disabled',
      },
      problems: [
        'Remote-trusted mode must bind to a non-loopback host.',
        'Remote-trusted mode must set SWITCHBOARD_ALLOW_REMOTE=1.',
        'Remote-trusted mode must set SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE.',
        'Remote-trusted mode must set SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE.',
        'Remote-trusted mode must token-gate task creation.',
        'Remote-trusted mode must token-gate task updates.',
        'Remote-trusted mode must token-gate provider refresh.',
      ],
      message: 'Remote-trusted mode must bind to a non-loopback host.',
    });
    assert.deepEqual(preflightOperatorBlocked.summary.operator, operatorBlocked.summary);
    assert.deepEqual(preflightOperatorBlocked.summary.providerReadiness, {
      ...providerReadinessWithOperatorBlocked.summary,
      verdict: 'attention_required',
      advisoryCodes: ['provider_snapshot_missing'],
      attentionProviders: ['openai'],
      readyProviders: [],
      message: 'No sanitized snapshot file found yet.',
      providerStates: { openai: 'snapshot_missing' },
      providerKinds: { openai: 'snapshot' },
      providerSources: { openai: 'openai.json' },
      providerConfigured: { openai: false },
      providerSecure: { openai: false },
      providerLastModifiedAt: { openai: null },
      providerAccountCounts: { openai: null },
      providerCodes: { openai: ['provider_snapshot_missing'] },
      providerMessages: { openai: 'No sanitized snapshot file found yet.' },
      stateCounts: { snapshot_missing: 1 },
      providers: [
        {
          provider: 'openai',
          kind: 'snapshot',
          state: 'snapshot_missing',
          source: 'openai.json',
          configured: false,
          secure: false,
          validated: false,
          problem: 'No sanitized snapshot file found yet.',
          lastModifiedAt: null,
          accountCount: null,
        },
      ],
    });
    assert.deepEqual(preflightOperatorBlocked.summary.providerSync, {
      ...providerSyncWithOperatorBlocked.summary,
      verdict: 'blocked',
      failureCodes: ['provider_snapshot_missing'],
      advisoryCodes: [],
      blockedProviders: ['openai'],
      attentionProviders: [],
      readyProviders: [],
      message: 'No sanitized snapshot was found for provider "openai" at openai.json.',
      providerStates: { openai: 'snapshot_missing' },
      providerKinds: { openai: 'snapshot' },
      providerSources: { openai: 'openai.json' },
      providerConfigured: { openai: false },
      providerSecure: { openai: false },
      providerAccountCounts: { openai: null },
      providerRefreshedAt: { openai: null },
      providerCodes: { openai: ['provider_snapshot_missing'] },
      providerMessages: {
        openai: 'No sanitized snapshot was found for provider "openai" at openai.json.',
      },
      providerAccountSyncMethods: { openai: [] },
      providerSyncModes: { openai: [] },
      providerSyncBadges: { openai: [] },
      providerRateLimitHosts: { openai: [] },
      providerOpenaiAuth: { openai: [] },
      providerQuotaCoverage: { openai: 'none' },
      providerQuotaModelCounts: { openai: 0 },
      providerTypedQuotaModelCounts: { openai: 0 },
      stateCounts: { snapshot_missing: 1 },
      providers: [
        {
          provider: 'openai',
          kind: 'snapshot',
          state: 'snapshot_missing',
          source: 'openai.json',
          configured: false,
          secure: false,
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
          problem: 'No sanitized snapshot was found for provider "openai" at openai.json.',
        },
      ],
    });
    assert.deepEqual(preflightOperatorBlocked.summary.codexAppServer, rawReadyWithOperatorBlocked.summary);
    assert.deepEqual(
      normalizeWrappedSummary(preflightOperatorBlocked.summary.codex),
      normalizeWrappedSummary(wrappedReadyWithOperatorBlocked.summary),
    );
    assert.deepEqual(preflightOperatorBlocked.summary.failures, [
      'Operator readiness failed for remote-trusted.',
      'Provider sync blocked for openai.',
    ]);
    assert.match(
      preflightOperatorBlocked.summary.summary,
      /operator=Remote-trusted mode must bind to a non-loopback host\./,
    );

    console.log('Doctor contracts smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Doctor contracts smoke test failed: ${message}`);
  process.exitCode = 1;
});
