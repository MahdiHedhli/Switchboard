import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const preflightDoctorEntry = path.join(repoRoot, 'scripts/preflight-doctor.mjs');

async function runPreflight(fakeCodexPath, scenario, profile, codexMode, envOverrides = {}, json = false) {
  return new Promise((resolve, reject) => {
    const args = json ? [preflightDoctorEntry, profile, codexMode, '--json'] : [preflightDoctorEntry, profile, codexMode];
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_CLI_PATH: fakeCodexPath,
        FAKE_CODEX_SCENARIO: scenario,
        FAKE_PROVIDER_SYNC_SCENARIO: scenario,
        ...envOverrides,
      },
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

function extractSection(output, heading, nextHeading) {
  const startMarker = `${heading}:`;
  const endMarker = `${nextHeading}:`;
  const start = output.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section "${startMarker}" in output`);
  const end = output.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing section "${endMarker}" after "${startMarker}" in output`);
  return output.slice(start, end);
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-preflight-doctor-smoke-'));
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
            userAgent: 'Codex Desktop/0.122.0 (preflight smoke)',
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

if (scenario === 'command-failed') {
  process.stderr.write('simulated trusted command failure from /Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs\\n');
  process.exit(1);
}

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
    const localAllow = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localAllow.code, 0);
    assert.match(localAllow.stdout, /Switchboard preflight: profile=local-only codexMode=allow-fallback/);
    assert.match(localAllow.stdout, /Operator readiness \(local-only\):/);
    assert.match(localAllow.stdout, /Operator readiness \(local-only\):[\s\S]*?message: local-only; host=127\.0\.0\.1/);
    assert.match(localAllow.stdout, /operatorTokenSource: env/);
    assert.match(localAllow.stdout, /Provider readiness \(openai\):/);
    assert.match(localAllow.stdout, /verdict: ready/);
    assert.match(localAllow.stdout, /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/);
    assert.match(localAllow.stdout, /advisoryCodes: provider_trusted_command_unvalidated/);
    assert.match(localAllow.stdout, /openai: trusted_command_ready \(unvalidated\)/);
    assert.match(localAllow.stdout, /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(localAllow.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(localAllow.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(localAllow.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):/);
    assert.match(
      localAllow.stdout,
      /Provider sync \(openai\):[\s\S]*?message: login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localAllow.stdout, /attentionProviders: openai/);
    assert.match(localAllow.stdout, /openai: login fallback: app-server unavailable \(advisory\)/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: login-status-fallback/);
    assert.match(localAllow.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges: login fallback: app-server unavailable/);
    assert.match(localAllow.stdout, /quotaCoverage: informational_only/);
    assert.match(localAllow.stdout, /typedQuotaModels: 0\/1/);
    assert.match(localAllow.stdout, /codex-app-server:/);
    assert.match(localAllow.stdout, /Codex app-server doctor:[\s\S]*?verdict: blocked/);
    assert.match(localAllow.stdout, /Codex app-server doctor:[\s\S]*?message: Codex app-server could not start\./);
    assert.match(localAllow.stdout, /failureCodes: raw_codex_app_server_failed/);
    assert.match(localAllow.stdout, /rate-limit coverage: none/);
    assert.match(
      localAllow.stdout,
      /preflight note: raw Codex app-server diagnostics degraded or unavailable; wrapper fallback is allowed in this mode\./,
    );
    assert.match(localAllow.stdout, /Codex doctor:/);
    assert.match(localAllow.stdout, /Codex doctor:[\s\S]*?verdict: attention_required/);
    assert.match(
      localAllow.stdout,
      /Codex doctor:[\s\S]*?message: login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localAllow.stdout, /advisoryCodes: codex_wrapper_login_fallback/);
    assert.match(localAllow.stdout, /Codex doctor:[\s\S]*?account: Codex Supervisor/);
    assert.match(localAllow.stdout, /Codex doctor:[\s\S]*?refreshed: /);
    assert.match(localAllow.stdout, /Codex doctor:[\s\S]*?source: login-status fallback/);
    assert.match(localAllow.stdout, /Codex doctor:[\s\S]*?plan: unknown/);
    assert.match(localAllow.stdout, /login fallback \(app-server unavailable\)/);
    assert.match(localAllow.stdout, /quota coverage: informational_only/);
    assert.match(localAllow.stdout, /typed quota models: 0\/1/);
    assert.match(localAllow.stdout, /quota model: Codex/);
    assert.match(
      localAllow.stdout,
      /note: codex=codex-cli 0\.122\.0-alpha\.1; Codex CLI reports ChatGPT-backed login, but typed rate-limit data was unavailable locally\./,
    );
    assert.match(
      localAllow.stdout,
      /preflight summary: degraded but acceptable; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=app-server unavailable \[rate-limits none\]; wrapper status=login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localAllow.stderr, /Codex app-server could not start\./);

    const localAllowFileBacked = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localAllowFileBacked.code, 0);
    assert.match(localAllowFileBacked.stdout, /Operator readiness \(local-only\):/);
    assert.match(localAllowFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?message: local-only; host=127\.0\.0\.1/);
    assert.match(localAllowFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenConfigured: yes/);
    assert.match(localAllowFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenSource: file/);
    assert.match(localAllowFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(
      localAllowFileBacked.stdout,
      /preflight summary: degraded but acceptable; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=app-server unavailable \[rate-limits none\]; wrapper status=login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );

    const localMissingToken = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.notEqual(localMissingToken.code, 0);
    assert.match(localMissingToken.stdout, /Operator readiness \(local-only\):/);
    assert.match(
      localMissingToken.stdout,
      /Operator readiness \(local-only\):[\s\S]*?message: Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN\./,
    );
    assert.match(localMissingToken.stdout, /operatorTokenConfigured: no/);
    assert.match(localMissingToken.stdout, /operatorTokenSource: unset/);
    assert.match(localMissingToken.stdout, /taskCreate: disabled/);
    assert.match(localMissingToken.stdout, /taskUpdate: disabled/);
    assert.match(localMissingToken.stdout, /subscriptionRefresh: disabled/);
    assert.match(
      localMissingToken.stdout,
      /preflight summary: blocked; operator=Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN\.; provider readiness=trusted_command_ready \(unvalidated\); provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=app-server unavailable \[rate-limits none\]; wrapper status=login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );

    const localMissingTokenJson = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.notEqual(localMissingTokenJson.code, 0);
    const localMissingTokenPayload = JSON.parse(localMissingTokenJson.stdout);
    assert.equal(localMissingTokenPayload.verdict, 'blocked');
    assert.deepEqual(localMissingTokenPayload.failureCodes, ['operator_readiness_failed']);
    assert.deepEqual(localMissingTokenPayload.blockedChecks, ['operator']);
    assert.equal(localMissingTokenPayload.checkMessages.operator, 'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.');
    assert.equal(localMissingTokenPayload.checkDetails.operator.message, 'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.');
    assert.equal(localMissingTokenPayload.checkDetails.operator.operatorTokenConfigured, false);
    assert.equal(localMissingTokenPayload.checkDetails.operator.operatorTokenSource, 'unset');
    assert.deepEqual(localMissingTokenPayload.checkDetails.operator.scopes, {
      taskCreate: 'disabled',
      taskUpdate: 'disabled',
      subscriptionRefresh: 'disabled',
      subscriptionReplace: 'disabled',
    });

    const localAllowJson = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localAllowJson.code, 0);
    const localAllowPayload = JSON.parse(localAllowJson.stdout);
    assert.equal(localAllowPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localAllowPayload.verdict, 'degraded_but_acceptable');
    assert.deepEqual(localAllowPayload.failureCodes, []);
    assert.deepEqual(localAllowPayload.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
      'raw_codex_app_server_degraded',
      'codex_wrapper_login_fallback',
    ]);
    assert.deepEqual(localAllowPayload.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(localAllowPayload.attentionChecks, ['provider_sync', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(localAllowPayload.blockedChecks, []);
    assert.deepEqual(localAllowPayload.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'attention_required',
      raw_codex_app_server: 'attention_required',
      codex_wrapper: 'attention_required',
    });
    assert.deepEqual(localAllowPayload.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: ['provider_sync_degraded'],
      raw_codex_app_server: ['raw_codex_app_server_degraded'],
      codex_wrapper: ['codex_wrapper_login_fallback'],
    });
    assert.deepEqual(localAllowPayload.checkMessages, {
      operator: 'local-only; host=127.0.0.1',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'login fallback: app-server unavailable (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'Codex app-server could not start.',
      codex_wrapper: 'login fallback (app-server unavailable) [quota informational_only, typed 0/1]',
    });
    assert.deepEqual(localAllowPayload.checkDetails, {
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
        refreshedAt: localAllowPayload.providerSync.providers[0]?.refreshedAt,
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
        userAgent: localAllowPayload.codexAppServer.userAgent,
        accountType: localAllowPayload.codexAppServer.accountType,
        plan: localAllowPayload.codexAppServer.plan,
        state: 'app_server_unavailable',
        rateLimitStatus: 'app-server unavailable',
        rateLimitHost: null,
        endpoint: localAllowPayload.codexAppServer.endpoint,
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
        account: localAllowPayload.codex.account,
        refreshedAt: localAllowPayload.codex.refreshedAt,
        refreshedDisplay: localAllowPayload.codex.refreshedDisplay,
        state: 'login_fallback',
        source: 'login-status fallback',
        rateLimitsHost: null,
        openaiAuth: null,
        plan: localAllowPayload.codex.plan,
        credits: localAllowPayload.codex.credits,
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

    const localAllowFileBackedJson = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localAllowFileBackedJson.code, 0);
    const localAllowFileBackedPayload = JSON.parse(localAllowFileBackedJson.stdout);
    assert.equal(localAllowFileBackedPayload.verdict, 'degraded_but_acceptable');
    assert.equal(localAllowFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localAllowFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localAllowFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.deepEqual(localAllowFileBackedPayload.checkMessages, localAllowPayload.checkMessages);

    const localStrictPass = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localStrictPass.code, 0);
    assert.match(localStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(localStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(localStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(localStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(localStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/);
    const localStrictPassReadinessSection = extractSection(
      localStrictPass.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(localStrictPassReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(localStrictPassReadinessSection, /accounts:/);
    assert.doesNotMatch(localStrictPassReadinessSection, /lastModifiedAt:/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts:/);
    assert.doesNotMatch(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: typed/);
    assert.match(localStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 2\/2/);
    assert.match(localStrictPass.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 2\/2/);
    assert.match(localStrictPass.stdout, /Codex app-server doctor:[\s\S]*?rate-limit bucket: GPT-5\.3-Codex-Spark/);
    assert.match(localStrictPass.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(localStrictPass.stdout, /Codex doctor:[\s\S]*?typed quota models: 2\/2/);
    assert.match(localStrictPass.stdout, /Codex doctor:[\s\S]*?quota model: GPT-5\.3-Codex-Spark/);
    assert.match(
      localStrictPass.stdout,
      /preflight summary: ready for strict rollout; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const localStrictPassJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localStrictPassJson.code, 0);
    const localStrictPassPayload = JSON.parse(localStrictPassJson.stdout);
    assert.equal(localStrictPassPayload.verdict, 'ready');
    assert.equal(localStrictPassPayload.checkDetails.provider_readiness.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)');
    assertPreferredProviderReadinessAlignment(
      localStrictPassPayload.checkDetails.provider_readiness,
      localStrictPassPayload.providerReadiness,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.provider_readiness.kind,
      localStrictPassPayload.providerReadiness.providerKinds?.openai,
    );
    assert.equal(localStrictPassPayload.checkDetails.provider_readiness.configured, true);
    assert.equal(localStrictPassPayload.checkDetails.provider_readiness.secure, true);
    assert.equal(localStrictPassPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(localStrictPassPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      localStrictPassPayload.checkDetails.provider_readiness.codes,
      localStrictPassPayload.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.provider_readiness.lastModifiedAt ?? null,
      localStrictPassPayload.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.provider_sync.source,
      localStrictPassPayload.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      localStrictPassPayload.checkDetails.provider_sync,
      localStrictPassPayload.providerSync,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.provider_sync.refreshedAt,
      localStrictPassPayload.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      localStrictPassPayload.checkDetails.provider_sync.syncMethods,
      localStrictPassPayload.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.provider_sync.accountCount,
      localStrictPassPayload.providerSync.providers[0]?.accountCount,
    );
    assert.equal(localStrictPassPayload.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(localStrictPassPayload.checkDetails.provider_sync.typedQuotaModelCount, 2);
    assert.deepEqual(
      localStrictPassPayload.checkDetails.provider_sync.syncModes,
      localStrictPassPayload.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      localStrictPassPayload.checkDetails.provider_sync.syncBadges,
      localStrictPassPayload.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.raw_codex_app_server.userAgent,
      localStrictPassPayload.codexAppServer.userAgent,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.raw_codex_app_server.accountType,
      localStrictPassPayload.codexAppServer.accountType,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.raw_codex_app_server.plan,
      localStrictPassPayload.codexAppServer.plan,
    );
    assert.equal(
      localStrictPassPayload.checkDetails.raw_codex_app_server.endpoint,
      localStrictPassPayload.codexAppServer.endpoint,
    );
    assert.equal(localStrictPassPayload.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(localStrictPassPayload.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 2);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.source, localStrictPassPayload.codex.source);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.account, localStrictPassPayload.codex.account);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.refreshedAt, localStrictPassPayload.codex.refreshedAt);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.refreshedDisplay, localStrictPassPayload.codex.refreshedDisplay);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.plan, localStrictPassPayload.codex.plan);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.credits, localStrictPassPayload.codex.credits);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(localStrictPassPayload.checkDetails.codex_wrapper.typedQuotaModelCount, 2);

    const localStrictPassFileBacked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localStrictPassFileBacked.code, 0);
    assert.match(localStrictPassFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenSource: file/);
    assert.match(localStrictPassFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(
      localStrictPassFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/,
    );
    assert.match(
      localStrictPassFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(localStrictPassFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(localStrictPassFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(localStrictPassFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    const localStrictPassFileBackedReadinessSection = extractSection(
      localStrictPassFileBacked.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(localStrictPassFileBackedReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(localStrictPassFileBackedReadinessSection, /accounts:/);
    assert.doesNotMatch(localStrictPassFileBackedReadinessSection, /lastModifiedAt:/);
    assert.match(
      localStrictPassFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available/,
    );
    assert.match(
      localStrictPassFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts:/);
    assert.doesNotMatch(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: typed/);
    assert.match(localStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 2\/2/);
    assert.match(localStrictPassFileBacked.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 2\/2/);
    assert.match(localStrictPassFileBacked.stdout, /Codex app-server doctor:[\s\S]*?rate-limit bucket: GPT-5\.3-Codex-Spark/);
    assert.match(localStrictPassFileBacked.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(localStrictPassFileBacked.stdout, /Codex doctor:[\s\S]*?typed quota models: 2\/2/);
    assert.match(localStrictPassFileBacked.stdout, /Codex doctor:[\s\S]*?quota model: GPT-5\.3-Codex-Spark/);
    assert.match(
      localStrictPassFileBacked.stdout,
      /preflight summary: ready for strict rollout; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const localStrictPassFileBackedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localStrictPassFileBackedJson.code, 0);
    const localStrictPassFileBackedPayload = JSON.parse(localStrictPassFileBackedJson.stdout);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localStrictPassFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_readiness.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)');
    assertPreferredProviderReadinessAlignment(
      localStrictPassFileBackedPayload.checkDetails.provider_readiness,
      localStrictPassFileBackedPayload.providerReadiness,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.provider_readiness.kind,
      localStrictPassFileBackedPayload.providerReadiness.providerKinds?.openai,
    );
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_readiness.configured, true);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_readiness.secure, true);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      localStrictPassFileBackedPayload.checkDetails.provider_readiness.codes,
      localStrictPassFileBackedPayload.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.provider_readiness.lastModifiedAt ?? null,
      localStrictPassFileBackedPayload.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.provider_sync.source,
      localStrictPassFileBackedPayload.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      localStrictPassFileBackedPayload.checkDetails.provider_sync,
      localStrictPassFileBackedPayload.providerSync,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.provider_sync.refreshedAt,
      localStrictPassFileBackedPayload.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      localStrictPassFileBackedPayload.checkDetails.provider_sync.syncMethods,
      localStrictPassFileBackedPayload.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.provider_sync.accountCount,
      localStrictPassFileBackedPayload.providerSync.providers[0]?.accountCount,
    );
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.provider_sync.typedQuotaModelCount, 2);
    assert.deepEqual(
      localStrictPassFileBackedPayload.checkDetails.provider_sync.syncModes,
      localStrictPassFileBackedPayload.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      localStrictPassFileBackedPayload.checkDetails.provider_sync.syncBadges,
      localStrictPassFileBackedPayload.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.userAgent,
      localStrictPassFileBackedPayload.codexAppServer.userAgent,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.accountType,
      localStrictPassFileBackedPayload.codexAppServer.accountType,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.plan,
      localStrictPassFileBackedPayload.codexAppServer.plan,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.endpoint,
      localStrictPassFileBackedPayload.codexAppServer.endpoint,
    );
    assert.equal(localStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 2);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.codex_wrapper.source,
      localStrictPassFileBackedPayload.codex.source,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.codex_wrapper.account,
      localStrictPassFileBackedPayload.codex.account,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.codex_wrapper.refreshedAt,
      localStrictPassFileBackedPayload.codex.refreshedAt,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.codex_wrapper.refreshedDisplay,
      localStrictPassFileBackedPayload.codex.refreshedDisplay,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.codex_wrapper.plan,
      localStrictPassFileBackedPayload.codex.plan,
    );
    assert.equal(
      localStrictPassFileBackedPayload.checkDetails.codex_wrapper.credits,
      localStrictPassFileBackedPayload.codex.credits,
    );
    assert.equal(localStrictPassFileBackedPayload.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(localStrictPassFileBackedPayload.checkDetails.codex_wrapper.typedQuotaModelCount, 2);

    const localStrictProviderMixedFileBacked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
      },
    );
    assert.equal(localStrictProviderMixedFileBacked.code, 0);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenSource: file/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(
      localStrictProviderMixedFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(
      localStrictProviderMixedFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/,
    );
    const localStrictProviderMixedFileBackedReadinessSection = extractSection(
      localStrictProviderMixedFileBacked.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(localStrictProviderMixedFileBackedReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(localStrictProviderMixedFileBackedReadinessSection, /accounts:/);
    assert.doesNotMatch(localStrictProviderMixedFileBackedReadinessSection, /lastModifiedAt:/);
    assert.match(
      localStrictProviderMixedFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );
    assert.match(
      localStrictProviderMixedFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: mixed/);
    assert.match(localStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 1\/2/);
    assert.match(
      localStrictProviderMixedFileBacked.stdout,
      /preflight summary: ready for strict rollout; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const localStrictProviderMixedFileBackedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
      },
      true,
    );
    assert.equal(localStrictProviderMixedFileBackedJson.code, 0);
    const localStrictProviderMixedFileBackedPayload = JSON.parse(localStrictProviderMixedFileBackedJson.stdout);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assertPreferredProviderReadinessAlignment(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness,
      localStrictProviderMixedFileBackedPayload.providerReadiness,
    );
    assert.equal(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.kind,
      localStrictProviderMixedFileBackedPayload.providerReadiness.providerKinds?.openai,
    );
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.configured, true);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.secure, true);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.codes,
      localStrictProviderMixedFileBackedPayload.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.lastModifiedAt ?? null,
      localStrictProviderMixedFileBackedPayload.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.source,
      localStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync,
      localStrictProviderMixedFileBackedPayload.providerSync,
    );
    assert.equal(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.refreshedAt,
      localStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.syncMethods,
      localStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.accountCount,
      localStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.syncModes,
      localStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.syncBadges,
      localStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.quotaCoverage, 'mixed');
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.typedQuotaModelCount, 1);
    assert.equal(localStrictProviderMixedFileBackedPayload.checkMessages.provider_sync, 'app-server rate-limits available [quota mixed, typed 1/2]');

    const localStrictMixedFileBacked = await runPreflight(
      fakeCodexPath,
      'mixed-app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localStrictMixedFileBacked.code, 0);
    assert.match(localStrictMixedFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenSource: file/);
    assert.match(localStrictMixedFileBacked.stdout, /Operator readiness \(local-only\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?account type: chatgpt/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?user agent: Codex Desktop\/0\.122\.0/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?plan: Pro/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?openai auth: required/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?rate-limit coverage: mixed/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 1\/2/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?account: Codex Supervisor \(Pro\)/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?refreshed: /);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?plan: Pro/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?openai auth: required/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?credits: 0/);
    assert.match(localStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?typed quota models: 1\/2/);
    assert.match(
      localStrictMixedFileBacked.stdout,
      /preflight summary: ready for strict rollout; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available \[rate-limits mixed, typed 1\/2\]; wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]\./,
    );

    const localStrictMixedFileBackedJson = await runPreflight(
      fakeCodexPath,
      'mixed-app-server',
      'local-only',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localStrictMixedFileBackedJson.code, 0);
    const localStrictMixedFileBackedPayload = JSON.parse(localStrictMixedFileBackedJson.stdout);
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.rateLimitCoverage, 'mixed');
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 1);
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.userAgent,
      localStrictMixedFileBackedPayload.codexAppServer.userAgent,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.accountType,
      localStrictMixedFileBackedPayload.codexAppServer.accountType,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.plan,
      localStrictMixedFileBackedPayload.codexAppServer.plan,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.endpoint,
      localStrictMixedFileBackedPayload.codexAppServer.endpoint,
    );
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.quotaCoverage, 'mixed');
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.typedQuotaModelCount, 1);
    assert.equal(localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.source,
      localStrictMixedFileBackedPayload.codex.source,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.account,
      localStrictMixedFileBackedPayload.codex.account,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.refreshedAt,
      localStrictMixedFileBackedPayload.codex.refreshedAt,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.refreshedDisplay,
      localStrictMixedFileBackedPayload.codex.refreshedDisplay,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.plan,
      localStrictMixedFileBackedPayload.codex.plan,
    );
    assert.equal(
      localStrictMixedFileBackedPayload.checkDetails.codex_wrapper.credits,
      localStrictMixedFileBackedPayload.codex.credits,
    );
    assert.equal(localStrictMixedFileBackedPayload.checkMessages.raw_codex_app_server, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(localStrictMixedFileBackedPayload.checkMessages.codex_wrapper, 'full rate-limits available [quota mixed, typed 1/2]');

    const localAllowJsonDashed = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      '--allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localAllowJsonDashed.code, 0);
    const localAllowJsonDashedPayload = JSON.parse(localAllowJsonDashed.stdout);
    assert.equal(localAllowJsonDashedPayload.codexMode, 'allow-fallback');
    assert.equal(localAllowJsonDashedPayload.verdict, 'degraded_but_acceptable');
    assert.equal(localAllowPayload.providerReadiness.verdict, 'ready');
    assert.deepEqual(localAllowPayload.providerReadiness.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.equal(localAllowPayload.providerSync.verdict, 'attention_required');
    assert.deepEqual(localAllowPayload.providerSync.advisoryCodes, ['provider_sync_degraded']);
    assert.equal(localAllowPayload.providerSync.providers[0]?.state, 'trusted_command_degraded');

    const missingCodexPath = path.join(tempRoot, 'missing-codex');
    const localMissingCli = await runPreflight(
      missingCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.notEqual(localMissingCli.code, 0);
    assert.match(localMissingCli.stdout, /Codex app-server doctor:[\s\S]*?message: Codex app-server could not start\./);
    assert.match(localMissingCli.stdout, /Codex doctor:[\s\S]*?verdict: blocked/);
    assert.match(localMissingCli.stdout, /Codex doctor:[\s\S]*?message: Codex CLI could not start\./);
    assert.match(
      localMissingCli.stdout,
      /preflight summary: blocked; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=app-server unavailable \[rate-limits none\]; wrapper status=Codex CLI could not start\./,
    );
    assert.match(localMissingCli.stderr, /Codex app-server could not start\./);
    assert.match(localMissingCli.stderr, /Codex CLI could not start\./);
    assert.match(localMissingCli.stderr, /Codex doctor failed for mode allow-fallback\./);

    const localMissingCliJson = await runPreflight(
      missingCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.notEqual(localMissingCliJson.code, 0);
    const localMissingCliPayload = JSON.parse(localMissingCliJson.stdout);
    assert.equal(localMissingCliPayload.verdict, 'blocked');
    assert.deepEqual(localMissingCliPayload.failureCodes, ['codex_wrapper_failed']);
    assert.deepEqual(localMissingCliPayload.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
      'raw_codex_app_server_degraded',
    ]);
    assert.deepEqual(localMissingCliPayload.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(localMissingCliPayload.attentionChecks, ['provider_sync', 'raw_codex_app_server']);
    assert.deepEqual(localMissingCliPayload.blockedChecks, ['codex_wrapper']);
    assert.deepEqual(localMissingCliPayload.checkMessages, {
      operator: 'local-only; host=127.0.0.1',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'login fallback: app-server unavailable (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'Codex app-server could not start.',
      codex_wrapper: 'Codex CLI could not start.',
    });
    assert.equal(localMissingCliPayload.checkDetails.raw_codex_app_server.message, 'Codex app-server could not start.');
    assert.equal(localMissingCliPayload.checkDetails.raw_codex_app_server.state, 'app_server_unavailable');
    assert.deepEqual(localMissingCliPayload.checkDetails.raw_codex_app_server.failureCodes, ['raw_codex_app_server_failed']);
    assert.deepEqual(localMissingCliPayload.checkDetails.raw_codex_app_server.advisoryCodes, []);
    assert.equal(localMissingCliPayload.checkDetails.codex_wrapper.message, 'Codex CLI could not start.');
    assert.equal(localMissingCliPayload.checkDetails.codex_wrapper.state, 'cli_unavailable');
    assert.match(
      localMissingCliPayload.summary,
      /blocked; operator=local-only, host=127\.0\.0\.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=app-server unavailable \[rate-limits none\]; wrapper status=Codex CLI could not start\./,
    );

    const localAllowInferred = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localAllowInferred.code, 0);
    assert.match(localAllowInferred.stdout, /Switchboard preflight: profile=local-only codexMode=allow-fallback/);
    assert.match(localAllowInferred.stdout, /Provider readiness \(openai\):/);
    assert.match(localAllowInferred.stdout, /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/);
    assert.match(localAllowInferred.stdout, /advisoryCodes: provider_trusted_command_unvalidated/);
    assert.match(localAllowInferred.stdout, /openai: trusted_command_ready \(unvalidated\)/);
    assert.match(localAllowInferred.stdout, /Provider sync \(openai\):/);
    assert.match(
      localAllowInferred.stdout,
      /Provider sync \(openai\):[\s\S]*?message: login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localAllowInferred.stdout, /attentionProviders: openai/);
    assert.match(localAllowInferred.stdout, /openai: login fallback: app-server unavailable \(advisory\)/);
    assert.match(
      localAllowInferred.stdout,
      /preflight summary: degraded but acceptable; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=login fallback: app-server unavailable \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=app-server unavailable \[rate-limits none\]; wrapper status=login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );

    const localAllowInferredJson = await runPreflight(
      fakeCodexPath,
      'fallback',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localAllowInferredJson.code, 0);
    const localAllowInferredPayload = JSON.parse(localAllowInferredJson.stdout);
    assert.equal(localAllowInferredPayload.verdict, 'degraded_but_acceptable');
    assert.deepEqual(localAllowInferredPayload.checkMessages, localAllowPayload.checkMessages);
    assert.equal(
      localAllowInferredPayload.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(
      localAllowInferredPayload.checkDetails.provider_sync.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );

    const localPartialAllow = await runPreflight(
      fakeCodexPath,
      'partial-app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localPartialAllow.code, 0);
    assert.match(localPartialAllow.stdout, /Switchboard preflight: profile=local-only codexMode=allow-fallback/);
    assert.match(
      localPartialAllow.stdout,
      /Provider sync \(openai\):[\s\S]*?message: partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      localPartialAllow.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_degraded/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-account/);
    assert.match(
      localPartialAllow.stdout,
      /Provider sync \(openai\):[\s\S]*?syncBadges: partial app-server context: usage endpoint unavailable via chatgpt\.com; OpenAI auth required/,
    );
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts: chatgpt\.com/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: informational_only/);
    assert.match(localPartialAllow.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 0\/1/);
    assert.match(localPartialAllow.stdout, /Codex doctor:[\s\S]*?source: app-server account/);
    assert.match(
      localPartialAllow.stdout,
      /preflight summary: degraded but acceptable; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=partial app-server context: usage endpoint unavailable via chatgpt.com, OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=usage endpoint unavailable via chatgpt.com \[rate-limits none\]; wrapper status=partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );

    const localPartialAllowJson = await runPreflight(
      fakeCodexPath,
      'partial-app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localPartialAllowJson.code, 0);
    const localPartialAllowPayload = JSON.parse(localPartialAllowJson.stdout);
    assert.equal(localPartialAllowPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localPartialAllowPayload.verdict, 'degraded_but_acceptable');
    assert.deepEqual(localPartialAllowPayload.failureCodes, []);
    assert.deepEqual(localPartialAllowPayload.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
      'raw_codex_app_server_degraded',
      'codex_wrapper_partial_app_server',
    ]);
    assert.deepEqual(localPartialAllowPayload.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(localPartialAllowPayload.attentionChecks, ['provider_sync', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(localPartialAllowPayload.blockedChecks, []);
    assert.deepEqual(localPartialAllowPayload.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'attention_required',
      raw_codex_app_server: 'attention_required',
      codex_wrapper: 'attention_required',
    });
    assert.deepEqual(localPartialAllowPayload.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: ['provider_sync_degraded'],
      raw_codex_app_server: ['raw_codex_app_server_degraded'],
      codex_wrapper: ['codex_wrapper_partial_app_server'],
    });
    assert.deepEqual(localPartialAllowPayload.checkMessages, {
      operator: 'local-only; host=127.0.0.1',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'usage endpoint unavailable via chatgpt.com [rate-limits none]',
      codex_wrapper: 'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    });
    assert.deepEqual(localPartialAllowPayload.checkDetails, {
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
        refreshedAt: localPartialAllowPayload.providerSync.providers[0]?.refreshedAt,
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
        verdict: 'attention_required',
        failureCodes: [],
        advisoryCodes: ['raw_codex_app_server_degraded'],
        message: 'usage endpoint unavailable via chatgpt.com [rate-limits none]',
        userAgent: localPartialAllowPayload.codexAppServer.userAgent,
        accountType: localPartialAllowPayload.codexAppServer.accountType,
        plan: localPartialAllowPayload.codexAppServer.plan,
        state: 'usage_endpoint_unavailable',
        rateLimitStatus: 'usage endpoint unavailable',
        rateLimitHost: 'chatgpt.com',
        endpoint: localPartialAllowPayload.codexAppServer.endpoint,
        openaiAuth: 'required',
        rateLimitCoverage: 'none',
        rateLimitBucketCount: 0,
        typedRateLimitBucketCount: 0,
        rateLimitDetails: [],
      },
      codex_wrapper: {
        verdict: 'attention_required',
        failureCodes: [],
        advisoryCodes: ['codex_wrapper_partial_app_server'],
        message: 'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
        account: localPartialAllowPayload.codex.account,
        refreshedAt: localPartialAllowPayload.codex.refreshedAt,
        refreshedDisplay: localPartialAllowPayload.codex.refreshedDisplay,
        state: 'partial_app_server',
        source: 'app-server account',
        rateLimitsHost: 'chatgpt.com',
        openaiAuth: 'required',
        plan: localPartialAllowPayload.codex.plan,
        credits: localPartialAllowPayload.codex.credits,
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
            notes: 'Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop/0.122.0 (preflight smoke)',
          },
        ],
      },
    });
    assert.equal(localPartialAllowPayload.providerSync.verdict, 'attention_required');
    assert.equal(localPartialAllowPayload.providerSync.providers[0]?.state, 'trusted_command_degraded');
    assert.equal(localPartialAllowPayload.codexAppServer.state, 'usage_endpoint_unavailable');
    assert.equal(localPartialAllowPayload.codexAppServer.rateLimitHost, 'chatgpt.com');
    assert.equal(localPartialAllowPayload.codex.state, 'partial_app_server');
    assert.match(
      localPartialAllowPayload.summary,
      /provider sync=partial app-server context: usage endpoint unavailable via chatgpt.com, OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localPartialAllowPayload.summary, /raw Codex status=usage endpoint unavailable via chatgpt.com \[rate-limits none\]/);

    const localPartialAllowInferred = await runPreflight(
      fakeCodexPath,
      'partial-app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(localPartialAllowInferred.code, 0);
    assert.match(localPartialAllowInferred.stdout, /Switchboard preflight: profile=local-only codexMode=allow-fallback/);
    assert.match(localPartialAllowInferred.stdout, /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/);
    assert.match(
      localPartialAllowInferred.stdout,
      /Provider sync \(openai\):[\s\S]*?message: partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(localPartialAllowInferred.stdout, /Codex doctor:[\s\S]*?source: app-server account/);
    assert.match(localPartialAllowInferred.stdout, /openai: partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required \(advisory\)/);
    assert.match(
      localPartialAllowInferred.stdout,
      /preflight summary: degraded but acceptable; operator=local-only, host=127.0.0.1; provider readiness=trusted_command_ready \(unvalidated\); provider sync=partial app-server context: usage endpoint unavailable via chatgpt.com, OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=usage endpoint unavailable via chatgpt.com \[rate-limits none\]; wrapper status=partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );

    const localPartialAllowInferredJson = await runPreflight(
      fakeCodexPath,
      'partial-app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(localPartialAllowInferredJson.code, 0);
    const localPartialAllowInferredPayload = JSON.parse(localPartialAllowInferredJson.stdout);
    assert.equal(localPartialAllowInferredPayload.verdict, 'degraded_but_acceptable');
    assert.deepEqual(localPartialAllowInferredPayload.checkMessages, localPartialAllowPayload.checkMessages);
    assert.equal(
      localPartialAllowInferredPayload.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(
      localPartialAllowInferredPayload.checkDetails.provider_sync.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(localPartialAllowInferredPayload.checkDetails.provider_sync.state, 'trusted_command_degraded');
    assert.equal(localPartialAllowInferredPayload.checkDetails.raw_codex_app_server.state, 'usage_endpoint_unavailable');
    assert.equal(localPartialAllowInferredPayload.checkDetails.codex_wrapper.state, 'partial_app_server');

    const remoteStrictFail = await runPreflight(
      fakeCodexPath,
      'partial-app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.notEqual(remoteStrictFail.code, 0);
    assert.match(remoteStrictFail.stdout, /Operator readiness \(remote-trusted\):/);
    assert.match(remoteStrictFail.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?message: remote-trusted; host=0\.0\.0\.0/);
    assert.match(remoteStrictFail.stdout, /Provider readiness \(openai\):/);
    assert.match(
      remoteStrictFail.stdout,
      /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/,
    );
    assert.match(remoteStrictFail.stdout, /advisoryCodes: provider_trusted_command_unvalidated/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):/);
    assert.match(
      remoteStrictFail.stdout,
      /Provider sync \(openai\):[\s\S]*?message: partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      remoteStrictFail.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_degraded/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-account/);
    assert.match(
      remoteStrictFail.stdout,
      /Provider sync \(openai\):[\s\S]*?syncBadges: partial app-server context: usage endpoint unavailable via chatgpt\.com; OpenAI auth required/,
    );
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts: chatgpt\.com/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: informational_only/);
    assert.match(remoteStrictFail.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 0\/1/);
    assert.match(remoteStrictFail.stdout, /attentionProviders: openai/);
    assert.match(remoteStrictFail.stdout, /codex-app-server:/);
    assert.match(remoteStrictFail.stdout, /Codex app-server doctor:[\s\S]*?verdict: blocked/);
    assert.match(
      remoteStrictFail.stdout,
      /Codex app-server doctor:[\s\S]*?message: usage endpoint unavailable via chatgpt.com \[rate-limits none\]/,
    );
    assert.match(remoteStrictFail.stdout, /failureCodes: raw_codex_app_server_failed/);
    assert.match(remoteStrictFail.stdout, /rate-limit coverage: none/);
    assert.match(remoteStrictFail.stdout, /rate-limit host: chatgpt.com/);
    assert.match(remoteStrictFail.stdout, /Codex doctor:/);
    assert.match(remoteStrictFail.stdout, /Codex doctor:[\s\S]*?verdict: blocked/);
    assert.match(
      remoteStrictFail.stdout,
      /Codex doctor:[\s\S]*?message: partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(remoteStrictFail.stdout, /Codex doctor:[\s\S]*?source: app-server account/);
    assert.match(remoteStrictFail.stdout, /failureCodes: codex_wrapper_failed/);
    assert.match(remoteStrictFail.stdout, /quota coverage: informational_only/);
    assert.match(remoteStrictFail.stdout, /quota model: Codex/);
    assert.match(
      remoteStrictFail.stdout,
      /note: Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop\/0\.122\.0 \(preflight smoke\)/,
    );
    assert.match(
      remoteStrictFail.stdout,
      /preflight summary: blocked; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=partial app-server context: usage endpoint unavailable via chatgpt.com, OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]; raw Codex status=usage endpoint unavailable via chatgpt.com \[rate-limits none\]; wrapper status=partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(remoteStrictFail.stderr, /Raw Codex app-server doctor failed for mode require-rate-limits\./);
    assert.match(remoteStrictFail.stderr, /Codex doctor failed for mode require-rate-limits\./);

    const remoteStrictFailJson = await runPreflight(
      fakeCodexPath,
      'partial-app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.notEqual(remoteStrictFailJson.code, 0);
    const remoteStrictFailPayload = JSON.parse(remoteStrictFailJson.stdout);
    assert.equal(remoteStrictFailPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteStrictFailPayload.verdict, 'blocked');
    assert.deepEqual(remoteStrictFailPayload.failureCodes, [
      'raw_codex_app_server_failed',
      'codex_wrapper_failed',
    ]);
    assert.deepEqual(remoteStrictFailPayload.advisoryCodes, [
      'provider_trusted_command_unvalidated',
      'provider_sync_degraded',
    ]);
    assert.deepEqual(remoteStrictFailPayload.readyChecks, ['operator', 'provider_readiness']);
    assert.deepEqual(remoteStrictFailPayload.attentionChecks, ['provider_sync']);
    assert.deepEqual(remoteStrictFailPayload.blockedChecks, ['raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(remoteStrictFailPayload.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'attention_required',
      raw_codex_app_server: 'blocked',
      codex_wrapper: 'blocked',
    });
    assert.deepEqual(remoteStrictFailPayload.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: ['provider_sync_degraded'],
      raw_codex_app_server: ['raw_codex_app_server_failed'],
      codex_wrapper: ['codex_wrapper_failed'],
    });
    assert.deepEqual(remoteStrictFailPayload.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
      raw_codex_app_server: 'usage endpoint unavailable via chatgpt.com [rate-limits none]',
      codex_wrapper: 'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    });
    assert.deepEqual(remoteStrictFailPayload.checkDetails, {
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
        refreshedAt: remoteStrictFailPayload.providerSync.providers[0]?.refreshedAt,
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
        userAgent: remoteStrictFailPayload.codexAppServer.userAgent,
        accountType: remoteStrictFailPayload.codexAppServer.accountType,
        plan: remoteStrictFailPayload.codexAppServer.plan,
        state: 'usage_endpoint_unavailable',
        rateLimitStatus: 'usage endpoint unavailable',
        rateLimitHost: 'chatgpt.com',
        endpoint: remoteStrictFailPayload.codexAppServer.endpoint,
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
        account: remoteStrictFailPayload.codex.account,
        refreshedAt: remoteStrictFailPayload.codex.refreshedAt,
        refreshedDisplay: remoteStrictFailPayload.codex.refreshedDisplay,
        state: 'partial_app_server',
        source: 'app-server account',
        rateLimitsHost: 'chatgpt.com',
        openaiAuth: 'required',
        plan: remoteStrictFailPayload.codex.plan,
        credits: remoteStrictFailPayload.codex.credits,
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
            notes: 'Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop/0.122.0 (preflight smoke)',
          },
        ],
      },
    });
    assert.equal(remoteStrictFailPayload.providerReadiness.verdict, 'ready');
    assert.deepEqual(remoteStrictFailPayload.providerReadiness.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.equal(remoteStrictFailPayload.providerSync.verdict, 'attention_required');
    assert.deepEqual(remoteStrictFailPayload.providerSync.advisoryCodes, ['provider_sync_degraded']);
    assert.equal(remoteStrictFailPayload.codexAppServer.rateLimitStatus, 'usage endpoint unavailable');
    assert.equal(remoteStrictFailPayload.codexAppServer.rateLimitHost, 'chatgpt.com');
    assert.equal(remoteStrictFailPayload.codex.status, 'partial app-server context (usage endpoint unavailable via chatgpt.com)');
    assert.equal(remoteStrictFailPayload.codex.rateLimitsHost, 'chatgpt.com');

    const remoteStrictPass = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(remoteStrictPass.code, 0);
    assert.match(remoteStrictPass.stdout, /Provider readiness \(openai\):/);
    assert.match(remoteStrictPass.stdout, /advisoryCodes: provider_trusted_command_unvalidated/);
    assert.match(remoteStrictPass.stdout, /openai: trusted_command_ready \(unvalidated\)/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):/);
    assert.match(remoteStrictPass.stdout, /verdict: ready/);
    assert.match(remoteStrictPass.stdout, /openai: app-server rate-limits available/);
    assert.match(remoteStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(remoteStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(remoteStrictPass.stdout, /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/);
    const remoteStrictPassReadinessSection = extractSection(
      remoteStrictPass.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(remoteStrictPassReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(remoteStrictPassReadinessSection, /accounts:/);
    assert.doesNotMatch(remoteStrictPassReadinessSection, /lastModifiedAt:/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts:/);
    assert.doesNotMatch(remoteStrictPass.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(remoteStrictPass.stdout, /quotaCoverage: typed/);
    assert.match(remoteStrictPass.stdout, /typedQuotaModels: 2\/2/);
    assert.match(remoteStrictPass.stdout, /codex-app-server:/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?verdict: ready/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?message: available/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?user agent: Codex Desktop\/0\.122\.0/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?rate-limit coverage: typed/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 2\/2/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?rate-limit bucket: Codex/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?5-hour window: 91% remaining, 9% used, resets 4\/21\/2026, 7:37:43 PM/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?Weekly window: 98% remaining, 2% used, resets 4\/28\/2026, 2:37:43 PM/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?rate-limit bucket: GPT-5\.3-Codex-Spark/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?5-hour window: 100% remaining, 0% used, resets 4\/21\/2026, 10:49:53 PM/);
    assert.match(remoteStrictPass.stdout, /Codex app-server doctor:[\s\S]*?Weekly window: 100% remaining, 0% used, resets 4\/28\/2026, 5:49:53 PM/);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?message: full rate-limits available/);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?verdict: ready/);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?account: Codex Supervisor \(Pro\)/);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?refreshed: /);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?quota coverage: typed/);
    assert.match(remoteStrictPass.stdout, /Codex doctor:[\s\S]*?typed quota models: 2\/2/);
    assert.match(remoteStrictPass.stdout, /full rate-limits available/);
    assert.match(remoteStrictPass.stdout, /quota model: Codex/);
    assert.match(remoteStrictPass.stdout, /5-hour window: 91% remaining, 9% used, resets 4\/21\/2026, 7:37:43 PM/);
    assert.match(remoteStrictPass.stdout, /Weekly window: 98% remaining, 2% used, resets 4\/28\/2026, 2:37:43 PM/);
    assert.match(remoteStrictPass.stdout, /quota model: GPT-5\.3-Codex-Spark/);
    assert.match(remoteStrictPass.stdout, /5-hour window: 100% remaining, 0% used, resets 4\/21\/2026, 10:49:53 PM/);
    assert.match(remoteStrictPass.stdout, /Weekly window: 100% remaining, 0% used, resets 4\/28\/2026, 5:49:53 PM/);
    assert.match(
      remoteStrictPass.stdout,
      /preflight summary: ready for strict rollout; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const remoteStrictPassJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(remoteStrictPassJson.code, 0);
    const remoteStrictPassPayload = JSON.parse(remoteStrictPassJson.stdout);
    assert.equal(remoteStrictPassPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(remoteStrictPassPayload.verdict, 'ready');
    assert.deepEqual(remoteStrictPassPayload.failureCodes, []);
    assert.deepEqual(remoteStrictPassPayload.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(remoteStrictPassPayload.readyChecks, [
      'operator',
      'provider_readiness',
      'provider_sync',
      'raw_codex_app_server',
      'codex_wrapper',
    ]);
    assert.deepEqual(remoteStrictPassPayload.attentionChecks, []);
    assert.deepEqual(remoteStrictPassPayload.blockedChecks, []);
    assert.deepEqual(remoteStrictPassPayload.checkStates, {
      operator: 'ready',
      provider_readiness: 'ready',
      provider_sync: 'ready',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(remoteStrictPassPayload.checkCodes, {
      operator: [],
      provider_readiness: ['provider_trusted_command_unvalidated'],
      provider_sync: [],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(remoteStrictPassPayload.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'app-server rate-limits available',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.deepEqual(remoteStrictPassPayload.checkDetails, {
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
        refreshedAt: remoteStrictPassPayload.providerSync.providers[0]?.refreshedAt,
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
        userAgent: remoteStrictPassPayload.codexAppServer.userAgent,
        accountType: remoteStrictPassPayload.codexAppServer.accountType,
        plan: remoteStrictPassPayload.codexAppServer.plan,
        state: 'available',
        rateLimitStatus: 'available',
        rateLimitHost: null,
        endpoint: remoteStrictPassPayload.codexAppServer.endpoint,
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
        account: remoteStrictPassPayload.codex.account,
        refreshedAt: remoteStrictPassPayload.codex.refreshedAt,
        refreshedDisplay: remoteStrictPassPayload.codex.refreshedDisplay,
        state: 'full_rate_limits',
        source: 'app-server rate-limits',
        rateLimitsHost: null,
        openaiAuth: 'required',
        plan: remoteStrictPassPayload.codex.plan,
        credits: remoteStrictPassPayload.codex.credits,
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
    assert.equal(remoteStrictPassPayload.operator.profile, 'remote-trusted');
    assert.equal(remoteStrictPassPayload.providerReadiness.verdict, 'ready');
    assert.deepEqual(remoteStrictPassPayload.providerReadiness.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.equal(remoteStrictPassPayload.providerSync.verdict, 'ready');
    assert.deepEqual(remoteStrictPassPayload.providerSync.advisoryCodes, []);
    assert.equal(remoteStrictPassPayload.providerSync.providers[0]?.state, 'trusted_command_succeeded');
    assert.equal(remoteStrictPassPayload.codexAppServer.rateLimitsAvailable, true);
    assert.equal(remoteStrictPassPayload.codex.ok, true);

    const remoteStrictPassFileBacked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(remoteStrictPassFileBacked.code, 0);
    assert.match(remoteStrictPassFileBacked.stdout, /Operator readiness \(remote-trusted\):/);
    assert.match(remoteStrictPassFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenConfigured: yes/);
    assert.match(remoteStrictPassFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenSource: file/);
    assert.match(remoteStrictPassFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(
      remoteStrictPassFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/,
    );
    assert.match(
      remoteStrictPassFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictPassFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    const remoteStrictPassFileBackedReadinessSection = extractSection(
      remoteStrictPassFileBacked.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(remoteStrictPassFileBackedReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(remoteStrictPassFileBackedReadinessSection, /accounts:/);
    assert.doesNotMatch(remoteStrictPassFileBackedReadinessSection, /lastModifiedAt:/);
    assert.match(
      remoteStrictPassFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available/,
    );
    assert.match(
      remoteStrictPassFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts:/);
    assert.doesNotMatch(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: typed/);
    assert.match(remoteStrictPassFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 2\/2/);
    assert.match(remoteStrictPassFileBacked.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 2\/2/);
    assert.match(remoteStrictPassFileBacked.stdout, /Codex app-server doctor:[\s\S]*?rate-limit bucket: GPT-5\.3-Codex-Spark/);
    assert.match(remoteStrictPassFileBacked.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(remoteStrictPassFileBacked.stdout, /Codex doctor:[\s\S]*?typed quota models: 2\/2/);
    assert.match(remoteStrictPassFileBacked.stdout, /Codex doctor:[\s\S]*?quota model: GPT-5\.3-Codex-Spark/);
    assert.match(
      remoteStrictPassFileBacked.stdout,
      /preflight summary: ready for strict rollout; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const remoteStrictPassFileBackedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(remoteStrictPassFileBackedJson.code, 0);
    const remoteStrictPassFileBackedPayload = JSON.parse(remoteStrictPassFileBackedJson.stdout);
    assert.equal(remoteStrictPassFileBackedPayload.verdict, 'ready');
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)');
    assertPreferredProviderReadinessAlignment(
      remoteStrictPassFileBackedPayload.checkDetails.provider_readiness,
      remoteStrictPassFileBackedPayload.providerReadiness,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.kind,
      remoteStrictPassFileBackedPayload.providerReadiness.providerKinds?.openai,
    );
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.configured, true);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.secure, true);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.codes,
      remoteStrictPassFileBackedPayload.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.provider_readiness.lastModifiedAt ?? null,
      remoteStrictPassFileBackedPayload.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync.source,
      remoteStrictPassFileBackedPayload.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync,
      remoteStrictPassFileBackedPayload.providerSync,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync.refreshedAt,
      remoteStrictPassFileBackedPayload.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync.syncMethods,
      remoteStrictPassFileBackedPayload.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync.accountCount,
      remoteStrictPassFileBackedPayload.providerSync.providers[0]?.accountCount,
    );
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.provider_sync.typedQuotaModelCount, 2);
    assert.deepEqual(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync.syncModes,
      remoteStrictPassFileBackedPayload.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      remoteStrictPassFileBackedPayload.checkDetails.provider_sync.syncBadges,
      remoteStrictPassFileBackedPayload.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.userAgent,
      remoteStrictPassFileBackedPayload.codexAppServer.userAgent,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.accountType,
      remoteStrictPassFileBackedPayload.codexAppServer.accountType,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.plan,
      remoteStrictPassFileBackedPayload.codexAppServer.plan,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.endpoint,
      remoteStrictPassFileBackedPayload.codexAppServer.endpoint,
    );
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 2);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.source,
      remoteStrictPassFileBackedPayload.codex.source,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.account,
      remoteStrictPassFileBackedPayload.codex.account,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.refreshedAt,
      remoteStrictPassFileBackedPayload.codex.refreshedAt,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.refreshedDisplay,
      remoteStrictPassFileBackedPayload.codex.refreshedDisplay,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.plan,
      remoteStrictPassFileBackedPayload.codex.plan,
    );
    assert.equal(
      remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.credits,
      remoteStrictPassFileBackedPayload.codex.credits,
    );
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(remoteStrictPassFileBackedPayload.checkDetails.codex_wrapper.typedQuotaModelCount, 2);
    assert.deepEqual(remoteStrictPassFileBackedPayload.checkMessages, remoteStrictPassPayload.checkMessages);

    const remoteStrictProviderMixed = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
      },
    );
    assert.equal(remoteStrictProviderMixed.code, 0);
    assert.match(
      remoteStrictProviderMixed.stdout,
      /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictProviderMixed.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(
      remoteStrictProviderMixed.stdout,
      /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/,
    );
    const remoteStrictProviderMixedReadinessSection = extractSection(
      remoteStrictProviderMixed.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(remoteStrictProviderMixedReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(remoteStrictProviderMixedReadinessSection, /accounts:/);
    assert.doesNotMatch(remoteStrictProviderMixedReadinessSection, /lastModifiedAt:/);
    assert.match(
      remoteStrictProviderMixed.stdout,
      /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );
    assert.match(
      remoteStrictProviderMixed.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts:/);
    assert.doesNotMatch(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: mixed/);
    assert.match(remoteStrictProviderMixed.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 1\/2/);
    assert.match(
      remoteStrictProviderMixed.stdout,
      /preflight summary: ready for strict rollout; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const remoteStrictProviderMixedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
      },
      true,
    );
    assert.equal(remoteStrictProviderMixedJson.code, 0);
    const remoteStrictProviderMixedPayload = JSON.parse(remoteStrictProviderMixedJson.stdout);
    assert.equal(remoteStrictProviderMixedPayload.verdict, 'ready');
    assert.equal(
      remoteStrictProviderMixedPayload.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assertPreferredProviderReadinessAlignment(
      remoteStrictProviderMixedPayload.checkDetails.provider_readiness,
      remoteStrictProviderMixedPayload.providerReadiness,
    );
    assert.equal(
      remoteStrictProviderMixedPayload.checkDetails.provider_readiness.kind,
      remoteStrictProviderMixedPayload.providerReadiness.providerKinds?.openai,
    );
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_readiness.configured, true);
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_readiness.secure, true);
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      remoteStrictProviderMixedPayload.checkDetails.provider_readiness.codes,
      remoteStrictProviderMixedPayload.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      remoteStrictProviderMixedPayload.checkDetails.provider_readiness.lastModifiedAt ?? null,
      remoteStrictProviderMixedPayload.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync.source,
      remoteStrictProviderMixedPayload.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync,
      remoteStrictProviderMixedPayload.providerSync,
    );
    assert.equal(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync.refreshedAt,
      remoteStrictProviderMixedPayload.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync.syncMethods,
      remoteStrictProviderMixedPayload.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync.accountCount,
      remoteStrictProviderMixedPayload.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync.syncModes,
      remoteStrictProviderMixedPayload.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      remoteStrictProviderMixedPayload.checkDetails.provider_sync.syncBadges,
      remoteStrictProviderMixedPayload.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_sync.quotaCoverage, 'mixed');
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(remoteStrictProviderMixedPayload.checkDetails.provider_sync.typedQuotaModelCount, 1);
    assert.equal(remoteStrictProviderMixedPayload.checkMessages.provider_sync, 'app-server rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      remoteStrictProviderMixedPayload.summary,
      /provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const remoteStrictProviderMixedFileBacked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
      },
    );
    assert.equal(remoteStrictProviderMixedFileBacked.code, 0);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenSource: file/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(
      remoteStrictProviderMixedFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(
      remoteStrictProviderMixedFileBacked.stdout,
      /Provider readiness \(openai\):[\s\S]*?message: trusted_command_ready \(unvalidated\)/,
    );
    const remoteStrictProviderMixedFileBackedReadinessSection = extractSection(
      remoteStrictProviderMixedFileBacked.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(remoteStrictProviderMixedFileBackedReadinessSection, /state: trusted_command_ready/);
    assert.doesNotMatch(remoteStrictProviderMixedFileBackedReadinessSection, /accounts:/);
    assert.doesNotMatch(remoteStrictProviderMixedFileBackedReadinessSection, /lastModifiedAt:/);
    assert.match(
      remoteStrictProviderMixedFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?message: app-server rate-limits available \[quota mixed, typed 1\/2\]/,
    );
    assert.match(
      remoteStrictProviderMixedFileBacked.stdout,
      /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/,
    );
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?state: trusted_command_succeeded/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?openaiAuth: required/);
    assert.doesNotMatch(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?rateLimitHosts:/);
    assert.doesNotMatch(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?syncBadges:/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?quotaCoverage: mixed/);
    assert.match(remoteStrictProviderMixedFileBacked.stdout, /Provider sync \(openai\):[\s\S]*?typedQuotaModels: 1\/2/);
    assert.match(
      remoteStrictProviderMixedFileBacked.stdout,
      /preflight summary: ready for strict rollout; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available \[quota mixed, typed 1\/2\]; raw Codex status=available; wrapper status=full rate-limits available\./,
    );

    const remoteStrictProviderMixedFileBackedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-provider-sync',
      },
      true,
    );
    assert.equal(remoteStrictProviderMixedFileBackedJson.code, 0);
    const remoteStrictProviderMixedFileBackedPayload = JSON.parse(remoteStrictProviderMixedFileBackedJson.stdout);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assertPreferredProviderReadinessAlignment(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness,
      remoteStrictProviderMixedFileBackedPayload.providerReadiness,
    );
    assert.equal(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.kind,
      remoteStrictProviderMixedFileBackedPayload.providerReadiness.providerKinds?.openai,
    );
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.configured, true);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.secure, true);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.codes,
      remoteStrictProviderMixedFileBackedPayload.providerReadiness.providerCodes?.openai,
    );
    assert.equal(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_readiness.lastModifiedAt ?? null,
      remoteStrictProviderMixedFileBackedPayload.providerReadiness.providerLastModifiedAt?.openai ?? null,
    );
    assert.equal(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.source,
      remoteStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.source,
    );
    assertPreferredProviderSyncAlignment(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync,
      remoteStrictProviderMixedFileBackedPayload.providerSync,
    );
    assert.equal(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.refreshedAt,
      remoteStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.refreshedAt,
    );
    assert.deepEqual(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.syncMethods,
      remoteStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.syncMethods,
    );
    assert.equal(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.accountCount,
      remoteStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.accountCount,
    );
    assert.deepEqual(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.syncModes,
      remoteStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.syncModes,
    );
    assert.deepEqual(
      remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.syncBadges,
      remoteStrictProviderMixedFileBackedPayload.providerSync.providers[0]?.syncBadges,
    );
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.quotaCoverage, 'mixed');
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.quotaModelCount, 2);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkDetails.provider_sync.typedQuotaModelCount, 1);
    assert.equal(remoteStrictProviderMixedFileBackedPayload.checkMessages.provider_sync, 'app-server rate-limits available [quota mixed, typed 1/2]');

    const remoteStrictMixed = await runPreflight(
      fakeCodexPath,
      'mixed-app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(remoteStrictMixed.code, 0);
    assert.match(remoteStrictMixed.stdout, /Provider readiness \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(remoteStrictMixed.stdout, /Provider readiness \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictMixed.stdout, /Provider readiness \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictMixed.stdout, /Provider readiness \(openai\):[\s\S]*?validated: no/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?configured: yes/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?secure: yes/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?accounts: 1/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?refreshedAt: 2026-/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?syncMethods: provider/);
    assert.match(remoteStrictMixed.stdout, /Provider sync \(openai\):[\s\S]*?syncModes: app-server-rate-limits/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?account type: chatgpt/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?user agent: Codex Desktop\/0\.122\.0/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?plan: Pro/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?openai auth: required/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?rate-limit coverage: mixed/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 1\/2/);
    assert.match(remoteStrictMixed.stdout, /Codex app-server doctor:[\s\S]*?rate-limit bucket: Codex Bengalfox/);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?account: Codex Supervisor \(Pro\)/);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?refreshed: /);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?plan: Pro/);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?openai auth: required/);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?credits: 0/);
    assert.match(remoteStrictMixed.stdout, /Codex doctor:[\s\S]*?typed quota models: 1\/2/);
    assert.match(
      remoteStrictMixed.stdout,
      /preflight summary: ready for strict rollout; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available \[rate-limits mixed, typed 1\/2\]; wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]\./,
    );

    const remoteStrictMixedJson = await runPreflight(
      fakeCodexPath,
      'mixed-app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(remoteStrictMixedJson.code, 0);
    const remoteStrictMixedPayload = JSON.parse(remoteStrictMixedJson.stdout);
    assert.equal(remoteStrictMixedPayload.verdict, 'ready');
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.rateLimitCoverage, 'mixed');
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 1);
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.userAgent, remoteStrictMixedPayload.codexAppServer.userAgent);
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.accountType, remoteStrictMixedPayload.codexAppServer.accountType);
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.plan, remoteStrictMixedPayload.codexAppServer.plan);
    assert.equal(remoteStrictMixedPayload.checkDetails.raw_codex_app_server.endpoint, remoteStrictMixedPayload.codexAppServer.endpoint);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.quotaCoverage, 'mixed');
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.typedQuotaModelCount, 1);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      remoteStrictMixedPayload.checkDetails.codex_wrapper.source,
      remoteStrictMixedPayload.codex.source,
    );
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.account, remoteStrictMixedPayload.codex.account);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.refreshedAt, remoteStrictMixedPayload.codex.refreshedAt);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.refreshedDisplay, remoteStrictMixedPayload.codex.refreshedDisplay);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.plan, remoteStrictMixedPayload.codex.plan);
    assert.equal(remoteStrictMixedPayload.checkDetails.codex_wrapper.credits, remoteStrictMixedPayload.codex.credits);
    assert.equal(remoteStrictMixedPayload.checkMessages.raw_codex_app_server, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(remoteStrictMixedPayload.checkMessages.codex_wrapper, 'full rate-limits available [quota mixed, typed 1/2]');
    assert.match(
      remoteStrictMixedPayload.summary,
      /raw Codex status=available \[rate-limits mixed, typed 1\/2\].*wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]/,
    );

    const remoteStrictMixedFileBacked = await runPreflight(
      fakeCodexPath,
      'mixed-app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
    );
    assert.equal(remoteStrictMixedFileBacked.code, 0);
    assert.match(remoteStrictMixedFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenSource: file/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Operator readiness \(remote-trusted\):[\s\S]*?operatorTokenFile: operator-token/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?account type: chatgpt/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?user agent: Codex Desktop\/0\.122\.0/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?plan: Pro/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?openai auth: required/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?rate-limit coverage: mixed/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex app-server doctor:[\s\S]*?typed rate-limit buckets: 1\/2/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?source: app-server rate-limits/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?account: Codex Supervisor \(Pro\)/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?refreshed: /);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?plan: Pro/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?openai auth: required/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?credits: 0/);
    assert.match(remoteStrictMixedFileBacked.stdout, /Codex doctor:[\s\S]*?typed quota models: 1\/2/);
    assert.match(
      remoteStrictMixedFileBacked.stdout,
      /preflight summary: ready for strict rollout; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=app-server rate-limits available; raw Codex status=available \[rate-limits mixed, typed 1\/2\]; wrapper status=full rate-limits available \[quota mixed, typed 1\/2\]\./,
    );

    const remoteStrictMixedFileBackedJson = await runPreflight(
      fakeCodexPath,
      'mixed-app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteOperatorTokenFile,
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
      },
      true,
    );
    assert.equal(remoteStrictMixedFileBackedJson.code, 0);
    const remoteStrictMixedFileBackedPayload = JSON.parse(remoteStrictMixedFileBackedJson.stdout);
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.operator.operatorTokenConfigured, true);
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.rateLimitCoverage, 'mixed');
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.rateLimitBucketCount, 2);
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.typedRateLimitBucketCount, 1);
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.userAgent,
      remoteStrictMixedFileBackedPayload.codexAppServer.userAgent,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.accountType,
      remoteStrictMixedFileBackedPayload.codexAppServer.accountType,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.plan,
      remoteStrictMixedFileBackedPayload.codexAppServer.plan,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.raw_codex_app_server.endpoint,
      remoteStrictMixedFileBackedPayload.codexAppServer.endpoint,
    );
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.quotaCoverage, 'mixed');
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.quotaModelCount, 2);
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.typedQuotaModelCount, 1);
    assert.equal(remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.source, 'app-server rate-limits');
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.source,
      remoteStrictMixedFileBackedPayload.codex.source,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.account,
      remoteStrictMixedFileBackedPayload.codex.account,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.refreshedAt,
      remoteStrictMixedFileBackedPayload.codex.refreshedAt,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.refreshedDisplay,
      remoteStrictMixedFileBackedPayload.codex.refreshedDisplay,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.plan,
      remoteStrictMixedFileBackedPayload.codex.plan,
    );
    assert.equal(
      remoteStrictMixedFileBackedPayload.checkDetails.codex_wrapper.credits,
      remoteStrictMixedFileBackedPayload.codex.credits,
    );
    assert.equal(remoteStrictMixedFileBackedPayload.checkMessages.raw_codex_app_server, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(remoteStrictMixedFileBackedPayload.checkMessages.codex_wrapper, 'full rate-limits available [quota mixed, typed 1/2]');

    const providerSyncBlocked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'command-failed',
      },
    );
    assert.notEqual(providerSyncBlocked.code, 0);
    assert.match(providerSyncBlocked.stdout, /Provider sync \(openai\):/);
    assert.match(
      providerSyncBlocked.stdout,
      /openai: Trusted provider sync command for "openai" failed\. Review provider sync diagnostics for details\./,
    );
    assert.match(
      providerSyncBlocked.stdout,
      /preflight summary: blocked; operator=remote-trusted, host=0.0.0.0; provider readiness=trusted_command_ready \(unvalidated\); provider sync=Trusted provider sync command for "openai" failed\. Review provider sync diagnostics for details\.; raw Codex status=available; wrapper status=full rate-limits available/,
    );
    assert.match(providerSyncBlocked.stderr, /Provider sync blocked for openai\./);
    assert.equal(providerSyncBlocked.stdout.includes('simulated trusted command failure'), false);
    assert.equal(providerSyncBlocked.stdout.includes(fakeSyncPath), false);
    assert.equal(providerSyncBlocked.stderr.includes('simulated trusted command failure'), false);
    assert.equal(providerSyncBlocked.stderr.includes(fakeSyncPath), false);

    const providerSyncBlockedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeSyncPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'command-failed',
      },
      true,
    );
    assert.notEqual(providerSyncBlockedJson.code, 0);
    const providerSyncBlockedPayload = JSON.parse(providerSyncBlockedJson.stdout);
    assert.equal(providerSyncBlockedPayload.verdict, 'blocked');
    assert.deepEqual(providerSyncBlockedPayload.failureCodes, ['provider_command_failed']);
    assert.deepEqual(providerSyncBlockedPayload.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(providerSyncBlockedPayload.blockedChecks, ['provider_sync']);
    assert.deepEqual(providerSyncBlockedPayload.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'trusted_command_ready (unvalidated)',
      provider_sync: 'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.equal(
      providerSyncBlockedPayload.checkDetails.provider_sync.message,
      'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
    );
    assert.equal(providerSyncBlockedPayload.checkDetails.provider_sync.kind, 'trusted-command');
    assert.equal(
      providerSyncBlockedPayload.checkDetails.provider_sync.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(providerSyncBlockedPayload.checkDetails.provider_sync.configured, true);
    assert.equal(providerSyncBlockedPayload.checkDetails.provider_sync.secure, true);
    assert.equal(providerSyncBlockedJson.stderr.includes('simulated trusted command failure'), false);
    assert.equal(providerSyncBlockedJson.stderr.includes(fakeSyncPath), false);

    const providerWiringBlocked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":"/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs"}',
      },
    );
    assert.notEqual(providerWiringBlocked.code, 0);
    assert.match(providerWiringBlocked.stdout, /Provider readiness \(openai\):/);
    assert.match(
      providerWiringBlocked.stdout,
      /openai: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    const providerWiringBlockedReadinessSection = extractSection(
      providerWiringBlocked.stdout,
      'Provider readiness (openai)',
      'Provider sync (openai)',
    );
    assert.match(
      providerWiringBlockedReadinessSection,
      /message: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    assert.match(providerWiringBlockedReadinessSection, /failureCodes: provider_command_invalid/);
    assert.match(providerWiringBlockedReadinessSection, /blockedProviders: openai/);
    assert.match(providerWiringBlockedReadinessSection, /attentionProviders: openai/);
    assert.match(providerWiringBlockedReadinessSection, /state: command_invalid/);
    assert.match(providerWiringBlockedReadinessSection, /codes: provider_command_invalid/);
    assert.match(providerWiringBlockedReadinessSection, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON/);
    assert.match(providerWiringBlockedReadinessSection, /configured: no/);
    assert.match(providerWiringBlockedReadinessSection, /secure: no/);
    assert.match(providerWiringBlockedReadinessSection, /validated: no/);
    assert.doesNotMatch(providerWiringBlockedReadinessSection, /accounts:/);
    assert.doesNotMatch(providerWiringBlockedReadinessSection, /lastModifiedAt:/);
    assert.doesNotMatch(providerWiringBlockedReadinessSection, /problem:/);
    assert.match(providerWiringBlocked.stdout, /Provider sync \(openai\):/);
    const providerWiringBlockedSyncSection = extractSection(
      providerWiringBlocked.stdout,
      'Provider sync (openai)',
      'Codex app-server doctor',
    );
    assert.match(
      providerWiringBlockedSyncSection,
      /message: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    assert.match(providerWiringBlockedSyncSection, /failureCodes: provider_command_invalid/);
    assert.match(providerWiringBlockedSyncSection, /blockedProviders: openai/);
    assert.match(providerWiringBlockedSyncSection, /state: command_invalid/);
    assert.match(providerWiringBlockedSyncSection, /codes: provider_command_invalid/);
    assert.match(providerWiringBlockedSyncSection, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON/);
    assert.match(providerWiringBlockedSyncSection, /configured: no/);
    assert.match(providerWiringBlockedSyncSection, /secure: no/);
    assert.match(providerWiringBlockedSyncSection, /quotaCoverage: none/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /accounts:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /refreshedAt:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /syncMethods:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /syncModes:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /syncBadges:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /rateLimitHosts:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /openaiAuth:/);
    assert.doesNotMatch(providerWiringBlockedSyncSection, /problem:/);
    assert.match(
      providerWiringBlocked.stdout,
      /preflight summary: blocked; operator=remote-trusted, host=0.0.0.0; provider readiness=SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\.; provider sync=SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\.; raw Codex status=available; wrapper status=full rate-limits available/,
    );
    assert.match(providerWiringBlocked.stderr, /Provider readiness blocked for openai\./);
    assert.match(providerWiringBlocked.stderr, /Provider sync blocked for openai\./);
    assert.equal(
      providerWiringBlocked.stdout.includes('/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs'),
      false,
    );
    assert.equal(
      providerWiringBlocked.stderr.includes('/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs'),
      false,
    );

    const providerWiringBlockedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":"/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs"}',
      },
      true,
    );
    assert.notEqual(providerWiringBlockedJson.code, 0);
    const providerWiringBlockedPayload = JSON.parse(providerWiringBlockedJson.stdout);
    assert.equal(providerWiringBlockedPayload.verdict, 'blocked');
    assert.deepEqual(providerWiringBlockedPayload.failureCodes, ['provider_command_invalid', 'provider_readiness_blocked']);
    assert.deepEqual(providerWiringBlockedPayload.advisoryCodes, []);
    assert.deepEqual(providerWiringBlockedPayload.readyChecks, ['operator', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(providerWiringBlockedPayload.attentionChecks, []);
    assert.deepEqual(providerWiringBlockedPayload.blockedChecks, ['provider_readiness', 'provider_sync']);
    assert.deepEqual(providerWiringBlockedPayload.checkStates, {
      operator: 'ready',
      provider_readiness: 'blocked',
      provider_sync: 'blocked',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(providerWiringBlockedPayload.checkCodes, {
      operator: [],
      provider_readiness: ['provider_command_invalid', 'provider_readiness_blocked'],
      provider_sync: ['provider_command_invalid'],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(providerWiringBlockedPayload.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
      provider_sync: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.equal(
      providerWiringBlockedPayload.checkDetails.provider_readiness.message,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
    );
    assertPreferredProviderReadinessAlignment(
      providerWiringBlockedPayload.checkDetails.provider_readiness,
      providerWiringBlockedPayload.providerReadiness,
    );
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.state, 'command_invalid');
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.kind, 'trusted-command');
    assert.equal(
      providerWiringBlockedPayload.checkDetails.provider_readiness.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON',
    );
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.configured, false);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.secure, false);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.unvalidated, true);
    assert.deepEqual(providerWiringBlockedPayload.checkDetails.provider_readiness.codes, ['provider_command_invalid']);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.accountCount ?? null, null);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_readiness.lastModifiedAt ?? null, null);
    assert.equal(
      providerWiringBlockedPayload.checkDetails.provider_sync.message,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
    );
    assertPreferredProviderSyncAlignment(
      providerWiringBlockedPayload.checkDetails.provider_sync,
      providerWiringBlockedPayload.providerSync,
    );
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.state, 'command_invalid');
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.kind, 'trusted-command');
    assert.equal(
      providerWiringBlockedPayload.checkDetails.provider_sync.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON',
    );
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.configured, false);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.secure, false);
    assert.deepEqual(providerWiringBlockedPayload.checkDetails.provider_sync.codes, ['provider_command_invalid']);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.accountCount ?? null, null);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.refreshedAt ?? null, null);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.quotaCoverage, 'none');
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.quotaModelCount, 0);
    assert.equal(providerWiringBlockedPayload.checkDetails.provider_sync.typedQuotaModelCount, 0);
    assert.equal(
      providerWiringBlockedPayload.providerReadiness.providerMessages.openai,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
    );
    assert.equal(
      providerWiringBlockedPayload.providerSync.providerMessages.openai,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
    );
    assert.equal(
      providerWiringBlockedJson.stderr.includes('/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs'),
      false,
    );

    const providerSnapshotMissing = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
      },
    );
    assert.notEqual(providerSnapshotMissing.code, 0);
    assert.match(providerSnapshotMissing.stdout, /Provider readiness \(openai\):/);
    assert.match(providerSnapshotMissing.stdout, /openai: No sanitized snapshot file found yet\./);
    assert.match(providerSnapshotMissing.stdout, /Provider sync \(openai\):/);
    assert.match(
      providerSnapshotMissing.stdout,
      /preflight summary: blocked; operator=remote-trusted, host=0.0.0.0; provider readiness=No sanitized snapshot file found yet\.; provider sync=No sanitized snapshot was found for provider "openai" at openai\.json\.; raw Codex status=available; wrapper status=full rate-limits available/,
    );
    assert.match(providerSnapshotMissing.stderr, /Provider sync blocked for openai\./);

    const providerSnapshotMissingJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-remote-token',
        SWITCHBOARD_BROKER_HOST: '0.0.0.0',
        SWITCHBOARD_ALLOW_REMOTE: '1',
        ...remoteTlsEnv,
      },
      true,
    );
    assert.notEqual(providerSnapshotMissingJson.code, 0);
    const providerSnapshotMissingPayload = JSON.parse(providerSnapshotMissingJson.stdout);
    assert.equal(providerSnapshotMissingPayload.verdict, 'blocked');
    assert.deepEqual(providerSnapshotMissingPayload.failureCodes, ['provider_snapshot_missing']);
    assert.deepEqual(providerSnapshotMissingPayload.advisoryCodes, [
      'provider_snapshot_missing',
      'provider_readiness_attention_required',
    ]);
    assert.deepEqual(providerSnapshotMissingPayload.readyChecks, ['operator', 'raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(providerSnapshotMissingPayload.attentionChecks, ['provider_readiness']);
    assert.deepEqual(providerSnapshotMissingPayload.blockedChecks, ['provider_sync']);
    assert.deepEqual(providerSnapshotMissingPayload.checkMessages, {
      operator: 'remote-trusted; host=0.0.0.0',
      provider_readiness: 'No sanitized snapshot file found yet.',
      provider_sync: 'No sanitized snapshot was found for provider "openai" at openai.json.',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.equal(
      providerSnapshotMissingPayload.checkDetails.provider_readiness.message,
      'No sanitized snapshot file found yet.',
    );
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_readiness.kind, 'snapshot');
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_readiness.source, 'openai.json');
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_readiness.configured, false);
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_readiness.secure, false);
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_readiness.validated, false);
    assert.equal(
      providerSnapshotMissingPayload.checkDetails.provider_sync.message,
      'No sanitized snapshot was found for provider "openai" at openai.json.',
    );
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_sync.kind, 'snapshot');
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_sync.source, 'openai.json');
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_sync.configured, false);
    assert.equal(providerSnapshotMissingPayload.checkDetails.provider_sync.secure, false);

    const operatorBlocked = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPERATOR_TOKEN: '',
      },
    );
    assert.notEqual(operatorBlocked.code, 0);
    assert.match(operatorBlocked.stdout, /Operator readiness \(remote-trusted\):/);
    assert.match(
      operatorBlocked.stdout,
      /Operator readiness \(remote-trusted\):[\s\S]*?message: Remote-trusted mode must bind to a non-loopback host\./,
    );
    assert.match(
      operatorBlocked.stdout,
      /preflight summary: blocked; operator=Remote-trusted mode must bind to a non-loopback host\.; provider readiness=No sanitized snapshot file found yet\.; provider sync=No sanitized snapshot was found for provider "openai" at openai\.json\.; raw Codex status=available; wrapper status=full rate-limits available/,
    );
    assert.match(operatorBlocked.stderr, /Operator readiness failed for remote-trusted\./);
    assert.match(operatorBlocked.stderr, /Provider sync blocked for openai\./);
    assert.match(operatorBlocked.stdout, /operatorTokenSource: unset/);

    const operatorBlockedJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'remote-trusted',
      'require-rate-limits',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_ALLOW_REMOTE: '0',
        SWITCHBOARD_OPERATOR_TOKEN: '',
      },
      true,
    );
    assert.notEqual(operatorBlockedJson.code, 0);
    const operatorBlockedPayload = JSON.parse(operatorBlockedJson.stdout);
    assert.equal(operatorBlockedPayload.verdict, 'blocked');
    assert.deepEqual(operatorBlockedPayload.failureCodes, ['operator_readiness_failed', 'provider_snapshot_missing']);
    assert.deepEqual(operatorBlockedPayload.advisoryCodes, [
      'provider_snapshot_missing',
      'provider_readiness_attention_required',
    ]);
    assert.deepEqual(operatorBlockedPayload.readyChecks, ['raw_codex_app_server', 'codex_wrapper']);
    assert.deepEqual(operatorBlockedPayload.attentionChecks, ['provider_readiness']);
    assert.deepEqual(operatorBlockedPayload.blockedChecks, ['operator', 'provider_sync']);
    assert.deepEqual(operatorBlockedPayload.checkStates, {
      operator: 'blocked',
      provider_readiness: 'attention_required',
      provider_sync: 'blocked',
      raw_codex_app_server: 'ready',
      codex_wrapper: 'ready',
    });
    assert.deepEqual(operatorBlockedPayload.checkCodes, {
      operator: ['operator_readiness_failed'],
      provider_readiness: ['provider_snapshot_missing', 'provider_readiness_attention_required'],
      provider_sync: ['provider_snapshot_missing'],
      raw_codex_app_server: [],
      codex_wrapper: [],
    });
    assert.deepEqual(operatorBlockedPayload.checkMessages, {
      operator: 'Remote-trusted mode must bind to a non-loopback host.',
      provider_readiness: 'No sanitized snapshot file found yet.',
      provider_sync: 'No sanitized snapshot was found for provider "openai" at openai.json.',
      raw_codex_app_server: 'available',
      codex_wrapper: 'full rate-limits available',
    });
    assert.equal(
      operatorBlockedPayload.checkDetails.provider_readiness.message,
      'No sanitized snapshot file found yet.',
    );
    assert.equal(
      operatorBlockedPayload.checkDetails.provider_sync.message,
      'No sanitized snapshot was found for provider "openai" at openai.json.',
    );
    assert.deepEqual(operatorBlockedPayload.checkDetails.operator, {
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
        taskCreate: 'disabled',
        taskUpdate: 'disabled',
        subscriptionRefresh: 'disabled',
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
    assert.equal(operatorBlockedJson.stderr.includes('AssertionError [ERR_ASSERTION]'), false);

    const operatorTokenConflict = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fakeSyncPath,
      },
    );
    assert.notEqual(operatorTokenConflict.code, 0);
    assert.match(operatorTokenConflict.stdout, /Operator readiness \(local-only\):/);
    assert.match(
      operatorTokenConflict.stdout,
      /Operator readiness \(local-only\):[\s\S]*?message: Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );
    assert.match(operatorTokenConflict.stdout, /operatorTokenSource: env/);
    assert.match(operatorTokenConflict.stdout, /operatorTokenFile: fake-openai-sync\.mjs/);
    assert.match(
      operatorTokenConflict.stdout,
      /operatorTokenProblem: Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );
    assert.match(operatorTokenConflict.stdout, /operatorTokenConfigured: no/);
    assert.match(operatorTokenConflict.stdout, /taskCreate: disabled/);
    assert.match(operatorTokenConflict.stdout, /taskUpdate: disabled/);
    assert.match(operatorTokenConflict.stdout, /subscriptionRefresh: disabled/);
    assert.match(
      operatorTokenConflict.stdout,
      /preflight summary: blocked; operator=Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );

    const operatorTokenConflictJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fakeSyncPath,
      },
      true,
    );
    assert.notEqual(operatorTokenConflictJson.code, 0);
    const operatorTokenConflictPayload = JSON.parse(operatorTokenConflictJson.stdout);
    assert.equal(
      operatorTokenConflictPayload.checkDetails.operator.operatorTokenProblem,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );
    assert.equal(operatorTokenConflictPayload.checkDetails.operator.operatorTokenConfigured, false);
    assert.equal(operatorTokenConflictPayload.checkDetails.operator.operatorTokenSource, 'env');
    assert.equal(operatorTokenConflictPayload.checkDetails.operator.operatorTokenFile, 'fake-openai-sync.mjs');
    assert.deepEqual(operatorTokenConflictPayload.checkDetails.operator.scopes, {
      taskCreate: 'disabled',
      taskUpdate: 'disabled',
      subscriptionRefresh: 'disabled',
      subscriptionReplace: 'disabled',
    });

    const insecureDefaultTokenDir = path.join(tempRoot, 'local-home', '.switchboard');
    const insecureDefaultTokenFile = path.join(insecureDefaultTokenDir, 'operator-token');
    await mkdir(insecureDefaultTokenDir, { recursive: true, mode: 0o700 });
    await writeFile(insecureDefaultTokenFile, 'reviewed-default-token\n', { mode: 0o600 });
    await chmod(insecureDefaultTokenDir, 0o755);

    const operatorDefaultDirInsecure = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: insecureDefaultTokenFile,
      },
    );
    assert.notEqual(operatorDefaultDirInsecure.code, 0);
    assert.match(operatorDefaultDirInsecure.stdout, /Operator readiness \(local-only\):/);
    assert.match(
      operatorDefaultDirInsecure.stdout,
      /Operator readiness \(local-only\):[\s\S]*?message: Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others\. Use chmod 700\./,
    );
    assert.match(operatorDefaultDirInsecure.stdout, /operatorTokenSource: file/);
    assert.match(operatorDefaultDirInsecure.stdout, /operatorTokenFile: operator-token/);
    assert.match(
      operatorDefaultDirInsecure.stdout,
      /operatorTokenProblem: Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others\. Use chmod 700\./,
    );
    assert.match(operatorDefaultDirInsecure.stdout, /operatorTokenConfigured: no/);
    assert.match(operatorDefaultDirInsecure.stdout, /taskCreate: disabled/);
    assert.match(operatorDefaultDirInsecure.stdout, /taskUpdate: disabled/);
    assert.match(operatorDefaultDirInsecure.stdout, /subscriptionRefresh: disabled/);
    assert.match(
      operatorDefaultDirInsecure.stdout,
      /preflight summary: blocked; operator=Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others\. Use chmod 700\./,
    );

    const operatorDefaultDirInsecureJson = await runPreflight(
      fakeCodexPath,
      'app-server',
      'local-only',
      'allow-fallback',
      {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: insecureDefaultTokenFile,
      },
      true,
    );
    assert.notEqual(operatorDefaultDirInsecureJson.code, 0);
    const operatorDefaultDirInsecurePayload = JSON.parse(operatorDefaultDirInsecureJson.stdout);
    assert.equal(
      operatorDefaultDirInsecurePayload.checkDetails.operator.operatorTokenProblem,
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    );
    assert.equal(operatorDefaultDirInsecurePayload.checkDetails.operator.operatorTokenConfigured, false);
    assert.equal(operatorDefaultDirInsecurePayload.checkDetails.operator.operatorTokenSource, 'file');
    assert.equal(operatorDefaultDirInsecurePayload.checkDetails.operator.operatorTokenFile, 'operator-token');
    assert.deepEqual(operatorDefaultDirInsecurePayload.checkDetails.operator.scopes, {
      taskCreate: 'disabled',
      taskUpdate: 'disabled',
      subscriptionRefresh: 'disabled',
      subscriptionReplace: 'disabled',
    });

    console.log('Preflight doctor smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Preflight doctor smoke test failed: ${message}`);
  process.exitCode = 1;
});
