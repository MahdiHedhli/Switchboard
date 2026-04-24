import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createSelfSignedTlsFixture } from './runtime-security-fixtures.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const brokerEntry = path.join(repoRoot, 'apps/broker/dist/index.js');
const codexSyncEntry = path.join(repoRoot, 'scripts/provider-sync/openai-codex-sync.mjs');
const profilesDir = path.join(repoRoot, 'profiles');

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a TCP port for broker smoke.')));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function fetchBroker(url, options = {}, insecureTls = false) {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    return await fetch(url, options);
  } finally {
    if (insecureTls) {
      if (previous === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      }
    }
  }
}

async function waitForBroker(baseUrl, deadlineMs, insecureTls = false) {
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetchBroker(`${baseUrl}/healthz`, {}, insecureTls);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error('Broker did not become healthy before timeout.');
}

function assertSanitizedBrokerJson(payload) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('.switchboard'), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('/private/'), false);
}

async function assertPersistedMixedOpenAiState(stateDir, taskTitle) {
  const stateFile = path.join(stateDir, 'threatpedia.json');
  const stateStat = await stat(stateFile);
  assert.equal((stateStat.mode & 0o777), 0o600);

  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  const persistedTask = persisted.tasks.find((task) => task.title === taskTitle);
  assert.notEqual(persistedTask, undefined);

  const persistedOpenAI = persisted.subscriptions.find((account) => account.provider === 'openai');
  assert.notEqual(persistedOpenAI, undefined);
  assert.equal(persistedOpenAI.syncMethod, 'provider');
  assert.equal(persistedOpenAI.id, 'openai-codex-chatgpt');
  assert.deepEqual(persistedOpenAI.signals, [
    { id: 'source', label: 'source', value: 'app-server rate-limits' },
    { id: 'plan', label: 'plan', value: 'Pro' },
    { id: 'openai_auth', label: 'openai-auth', value: 'required' },
  ]);

  const persistedCodexQuota = persistedOpenAI.quotas.find((quota) => quota.modelId === 'codex');
  assert.notEqual(persistedCodexQuota, undefined);
  assert.equal(persistedCodexQuota.interpretation, 'percentage_window');
  assert.equal(persistedCodexQuota.remaining, 91);
  assert.equal(persistedCodexQuota.used, 9);
  assert.equal(persistedCodexQuota.limit, 100);
  assert.equal(persistedCodexQuota.windows?.length, 2);

  const persistedSparkQuota = persistedOpenAI.quotas.find((quota) => quota.modelId === 'codex_bengalfox');
  assert.notEqual(persistedSparkQuota, undefined);
  assert.equal(persistedSparkQuota.interpretation, 'informational');
  assert.equal(persistedSparkQuota.windows, undefined);
}

function assertHealthyTypedOpenAiRefreshEntry(entry) {
  assert.equal(entry.provider, 'openai');
  assert.equal(entry.kind, 'trusted-command');
  assert.equal(entry.degraded, false);
  assert.deepEqual(entry.accountDisplayNames, ['Codex Supervisor (Pro)']);
  assert.deepEqual(entry.accountSyncMethods, ['provider']);
  assert.deepEqual(entry.syncModes, ['app-server-rate-limits']);
  assert.deepEqual(entry.syncBadges, []);
  assert.deepEqual(entry.rateLimitHosts, []);
  assert.deepEqual(entry.openaiAuth, ['required']);
  assert.equal(entry.quotaCoverage, 'typed');
  assert.equal(entry.quotaModels, 2);
  assert.equal(entry.typedQuotaModels, 2);
}

function assertHealthyTypedOpenAiProviderSummary(summary) {
  assert.equal(summary.degraded, false);
  assert.deepEqual(summary.syncModes, ['app-server-rate-limits']);
  assert.deepEqual(summary.syncBadges, []);
  assert.deepEqual(summary.rateLimitHosts, []);
  assert.deepEqual(summary.openaiAuth, ['required']);
  assert.equal(summary.quotaCoverage, 'typed');
  assert.equal(summary.quotaModels, 2);
  assert.equal(summary.typedQuotaModels, 2);
}

function assertHealthyTypedOpenAiAccount(account) {
  assert.notEqual(account, undefined);
  assert.equal(account.syncMethod, 'provider');
  assert.equal(account.id, 'openai-codex-chatgpt');
  assert.deepEqual(account.signals, [
    { id: 'source', label: 'source', value: 'app-server rate-limits' },
    { id: 'plan', label: 'plan', value: 'Pro' },
    { id: 'credits', label: 'credits', value: '0' },
    { id: 'openai_auth', label: 'openai-auth', value: 'required' },
  ]);
  assert.equal(account.quotas.length, 2);

  const codexQuota = account.quotas.find((quota) => quota.modelId === 'codex');
  assert.notEqual(codexQuota, undefined);
  assert.equal(codexQuota.interpretation, 'percentage_window');
  assert.equal(codexQuota.remaining, 91);
  assert.equal(codexQuota.used, 9);
  assert.equal(codexQuota.limit, 100);
  assert.equal(codexQuota.source, 'cli');
  assert.equal(codexQuota.windows?.length, 2);

  const sparkQuota = account.quotas.find((quota) => quota.modelId === 'codex_bengalfox');
  assert.notEqual(sparkQuota, undefined);
  assert.equal(sparkQuota.displayName, 'GPT-5.3-Codex-Spark');
  assert.equal(sparkQuota.interpretation, 'percentage_window');
  assert.equal(sparkQuota.remaining, 100);
  assert.equal(sparkQuota.limit, 100);
  assert.equal(sparkQuota.used, 0);
  assert.equal(sparkQuota.source, 'cli');
  assert.equal(sparkQuota.windows?.length, 2);
}

async function assertPersistedTypedOpenAiState(stateDir) {
  const stateFile = path.join(stateDir, 'threatpedia.json');
  const stateStat = await stat(stateFile);
  assert.equal((stateStat.mode & 0o777), 0o600);

  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(persisted.tasks.length, 0);

  const persistedOpenAI = persisted.subscriptions.find((account) => account.provider === 'openai');
  assertHealthyTypedOpenAiAccount(persistedOpenAI);
}

async function assertPersistedDegradedOpenAiState(stateDir) {
  const stateFile = path.join(stateDir, 'threatpedia.json');
  const stateStat = await stat(stateFile);
  assert.equal((stateStat.mode & 0o777), 0o600);

  const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(persisted.tasks.length, 0);

  const persistedOpenAI = persisted.subscriptions.find((account) => account.provider === 'openai');
  assert.notEqual(persistedOpenAI, undefined);
  assert.equal(persistedOpenAI.syncMethod, 'provider');
  assert.equal(persistedOpenAI.id, 'openai-codex-chatgpt');
  assert.deepEqual(persistedOpenAI.signals, [
    { id: 'source', label: 'source', value: 'app-server account' },
    { id: 'plan', label: 'plan', value: 'Pro' },
    { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
    { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
  ]);
  assert.equal(persistedOpenAI.quotas.length, 1);

  const persistedCodexQuota = persistedOpenAI.quotas.find((quota) => quota.modelId === 'codex');
  assert.notEqual(persistedCodexQuota, undefined);
  assert.equal(persistedCodexQuota.interpretation, 'informational');
  assert.equal(persistedCodexQuota.source, 'cli');
  assert.equal(persistedCodexQuota.usageUnit, 'unknown');
  assert.equal(persistedCodexQuota.windows, undefined);
  assert.match(
    persistedCodexQuota.notes ?? '',
    /Informational only: Codex app-server returned account metadata but no rate-limit snapshot/,
  );
}

async function startBroker({
  port,
  host,
  profilesDir,
  stateDir,
  snapshotDir,
  operatorToken,
  allowRemote = false,
  protocol = 'http',
  tlsCertFile,
  tlsKeyFile,
  extraEnv = {},
}) {
  const baseUrl = `${protocol}://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    ...extraEnv,
    SWITCHBOARD_BROKER_HOST: host,
    SWITCHBOARD_BROKER_PORT: String(port),
    SWITCHBOARD_PROFILES_DIR: profilesDir,
    SWITCHBOARD_STATE_DIR: stateDir,
    SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
  };

  if (allowRemote) {
    env.SWITCHBOARD_ALLOW_REMOTE = '1';
  }

  if (tlsCertFile) {
    env.SWITCHBOARD_TLS_CERT_FILE = tlsCertFile;
  }

  if (tlsKeyFile) {
    env.SWITCHBOARD_TLS_KEY_FILE = tlsKeyFile;
  }

  if (operatorToken) {
    env.SWITCHBOARD_OPERATOR_TOKEN = operatorToken;
  } else {
    delete env.SWITCHBOARD_OPERATOR_TOKEN;
  }

  const broker = spawn(process.execPath, [brokerEntry], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  broker.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForBroker(baseUrl, 10_000, protocol === 'https');
  } catch (error) {
    broker.kill('SIGTERM');
    await new Promise((resolve) => broker.once('exit', resolve));
    const detail = stderr.trim() ? ` stderr: ${stderr.trim()}` : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${detail}`);
  }

  return {
    baseUrl,
    insecureTls: protocol === 'https',
    async stop() {
      broker.kill('SIGTERM');
      await new Promise((resolve) => broker.once('exit', resolve));

      if (stderr.trim()) {
        console.error(stderr.trim());
      }
    },
  };
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-broker-smoke-'));
  const port = await reservePort();
  const degradedPort = await reservePort();
  const localTokenFilePort = await reservePort();
  const localTokenFileTypedPort = await reservePort();
  const localTokenFileDegradedPort = await reservePort();
  const insecureDefaultTokenPort = await reservePort();
  const remoteTokenFilePort = await reservePort();
  const remoteTokenFileTypedPort = await reservePort();
  const remoteTokenFileDegradedPort = await reservePort();
  const remotePort = await reservePort();
  const localStateDir = path.join(tempRoot, 'local-state');
  const degradedStateDir = path.join(tempRoot, 'degraded-state');
  const localTokenFileStateDir = path.join(tempRoot, 'local-token-file-state');
  const localTokenFileTypedStateDir = path.join(tempRoot, 'local-token-file-typed-state');
  const localTokenFileDegradedStateDir = path.join(tempRoot, 'local-token-file-degraded-state');
  const insecureDefaultTokenStateDir = path.join(tempRoot, 'insecure-default-token-state');
  const remoteTokenFileStateDir = path.join(tempRoot, 'remote-token-file-state');
  const remoteTokenFileTypedStateDir = path.join(tempRoot, 'remote-token-file-typed-state');
  const remoteTokenFileDegradedStateDir = path.join(tempRoot, 'remote-token-file-degraded-state');
  const remoteStateDir = path.join(tempRoot, 'remote-state');
  const snapshotDir = path.join(tempRoot, 'provider-snapshots');
  const fakeCodexPath = path.join(tempRoot, 'codex');
  const operatorToken = 'smoke-token';
  const localTokenDir = path.join(tempRoot, 'local-token-dir');
  const localTokenFile = path.join(localTokenDir, 'operator-token');
  const localFileOperatorToken = 'reviewed-local-file-token';
  const insecureDefaultTokenDir = path.join(tempRoot, '.switchboard');
  const insecureDefaultTokenFile = path.join(insecureDefaultTokenDir, 'operator-token');
  const remoteTokenDir = path.join(tempRoot, 'remote-token-dir');
  const remoteTokenFile = path.join(remoteTokenDir, 'operator-token');
  const remoteOperatorToken = 'reviewed-remote-token';
  const remoteTls = await createSelfSignedTlsFixture('switchboard-broker-smoke-tls-');

  await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
  await mkdir(localTokenDir, { recursive: true, mode: 0o700 });
  await mkdir(insecureDefaultTokenDir, { recursive: true, mode: 0o755 });
  await mkdir(remoteTokenDir, { recursive: true, mode: 0o700 });
  await writeFile(localTokenFile, `${localFileOperatorToken}\n`, { mode: 0o600 });
  await writeFile(insecureDefaultTokenFile, 'reviewed-local-token\n', { mode: 0o600 });
  await writeFile(remoteTokenFile, `${remoteOperatorToken}\n`, { mode: 0o600 });
  await writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
const scenario = process.env.SWITCHBOARD_FAKE_CODEX_SCENARIO ?? 'full-rate-limits';
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
            userAgent: 'Codex Desktop/0.122.0 (switchboard smoke)',
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
        } else if (scenario === 'mixed-rate-limits') {
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
              rateLimitsByLimitId: {
                codex_bengalfox: {
                  limitId: 'codex_bengalfox',
                  limitName: 'GPT-5.3-Codex-Spark',
                  primary: null,
                  secondary: null,
                  credits: null,
                  planType: 'pro',
                  rateLimitReachedType: null
                }
              }
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
              rateLimitsByLimitId: {
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
                  },
                  credits: null,
                  planType: 'pro',
                  rateLimitReachedType: null
                },
                codex: {
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
    path.join(snapshotDir, 'openai.json'),
    `${JSON.stringify({
      provider: 'openai',
      accounts: [
        {
          id: 'openai-main',
          displayName: 'OpenAI Subscription',
          authMode: 'subscription',
          owner: 'operator',
          lastRefreshedAt: '2026-04-21T18:15:00.000Z',
          quotas: [
            {
              modelId: 'codex',
              displayName: 'Codex',
              availability: 'available',
              authMode: 'subscription',
              usageUnit: 'credits',
              source: 'provider-ui',
              confidence: 'high',
              remaining: 88,
              notes: 'Sanitized OpenAI usage snapshot.',
            },
          ],
        },
      ],
    }, null, 2)}\n`,
    { mode: 0o600 },
  );

  let localBroker;
  let degradedBroker;
  let localTokenFileBroker;
  let insecureDefaultTokenBroker;
  let remoteTokenFileBroker;
  let remoteBroker;
  try {
    localBroker = await startBroker({
      port,
      host: '127.0.0.1',
      profilesDir,
      stateDir: localStateDir,
      snapshotDir,
      operatorToken,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
      },
    });

    const health = await fetchBroker(`${localBroker.baseUrl}/healthz`).then((response) => response.json());
    assert.equal(health.status, 'ok');
    assert.equal(health.localOnly, true);
    assert.equal(health.operatorTokenRequired, true);
    assert.equal(health.protocol, 'http');
    assert.equal(health.tlsEnabled, false);
    assert.equal('profilesDir' in health, false);
    assert.equal(health.auth.operatorTokenConfigured, true);
    assert.equal(health.auth.scopes.taskCreate.requirement, 'operator_token');
    assert.equal(health.auth.scopes.taskUpdate.requirement, 'operator_token');
    assert.equal(health.auth.scopes.subscriptionRefresh.requirement, 'operator_token');
    assert.equal(health.auth.scopes.subscriptionReplace.requirement, 'disabled');
    assertSanitizedBrokerJson(health);

    const profiles = await fetchBroker(`${localBroker.baseUrl}/v1/profiles`).then((response) => response.json());
    assert.equal(profiles.profiles.length >= 1, true);
    assert.equal(typeof profiles.profiles[0].repoCount, 'number');
    assert.equal(typeof profiles.profiles[0].roleCount, 'number');
    assert.equal('repos' in profiles.profiles[0], false);
    assert.equal('roles' in profiles.profiles[0], false);
    assert.equal(JSON.stringify(profiles).includes(profilesDir), false);

    const profilesMethodNotAllowed = await fetchBroker(`${localBroker.baseUrl}/v1/profiles`, {
      method: 'POST',
    });
    assert.equal(profilesMethodNotAllowed.status, 405);
    assert.equal(profilesMethodNotAllowed.headers.get('allow'), 'GET');
    const profilesMethodNotAllowedBody = await profilesMethodNotAllowed.json();
    assert.equal(profilesMethodNotAllowedBody.error, 'method_not_allowed');
    assert.equal(profilesMethodNotAllowedBody.detail, 'Allowed methods: GET');

    const dashboard = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/dashboard`).then((response) => response.json());
    assert.equal(dashboard.profile.id, 'threatpedia');
    assert.equal(Array.isArray(dashboard.tasks), true);
    assert.equal(Array.isArray(dashboard.providerSummaries), true);

    const state = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/state`).then((response) => response.json());
    assert.equal(state.profile.id, 'threatpedia');
    assert.equal(Array.isArray(state.tasks), true);
    assert.equal(Array.isArray(state.subscriptions), true);
    assert.equal(typeof state.updatedAt, 'string');
    assert.equal('plan' in state, false);
    assert.equal('providerSummaries' in state, false);

    const adapters = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/adapters`).then((response) => response.json());
    const openaiAdapter = adapters.adapters.find((entry) => entry.provider === 'openai');
    assert.equal(openaiAdapter.kind, 'trusted-command');
    assert.equal(openaiAdapter.status, 'ready_with_advisories');
    assert.equal(openaiAdapter.configured, true);
    assert.equal(openaiAdapter.secure, true);
    assert.deepEqual(openaiAdapter.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.equal(
      openaiAdapter.statusMessage,
      'Trusted command is configured, but this view has not yet confirmed a live refresh.',
    );

    const unauthorizedCreate = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Unauthorized task',
        description: 'This should be rejected.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    });
    assert.equal(unauthorizedCreate.status, 401);
    const unauthorizedCreateBody = await unauthorizedCreate.json();
    assert.equal(unauthorizedCreateBody.error, 'unauthorized');
    assert.match(unauthorizedCreateBody.detail, /X-Switchboard-Operator-Token|operator token/i);
    assert.equal(JSON.stringify(unauthorizedCreateBody).includes('/Users/'), false);

    const malformedCreate = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': operatorToken,
      },
      body: '{"title":',
    });
    assert.equal(malformedCreate.status, 400);
    const malformedCreateBody = await malformedCreate.json();
    assert.equal(malformedCreateBody.error, 'bad_request');
    assert.equal(malformedCreateBody.detail, 'Request body must contain valid JSON.');
    assert.equal(JSON.stringify(malformedCreateBody).includes('/Users/'), false);

    const created = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': operatorToken,
      },
      body: JSON.stringify({
        title: 'Smoke task',
        description: 'Created by the broker smoke test.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    }).then((response) => response.json());

    assert.equal(created.tasks.some((task) => task.title === 'Smoke task'), true);
    const smokeTask = created.tasks.find((task) => task.title === 'Smoke task');
    assert.notEqual(smokeTask, undefined);

    const fetchedTask = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/tasks/${smokeTask.id}`).then((response) => response.json());
    assert.equal(fetchedTask.task.id, smokeTask.id);
    assert.equal(fetchedTask.task.title, 'Smoke task');
    assert.equal('profile' in fetchedTask, false);
    assert.equal('subscriptions' in fetchedTask, false);
    assert.equal('tasks' in fetchedTask, false);
    assert.equal('plan' in fetchedTask, false);
    assert.equal('providerSummaries' in fetchedTask, false);

    const taskExtraPath = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/tasks/${smokeTask.id}/extra`);
    assert.equal(taskExtraPath.status, 404);
    const taskExtraPathBody = await taskExtraPath.json();
    assert.equal(taskExtraPathBody.error, 'not_found');
    assert.equal(taskExtraPathBody.detail, `No route for GET /v1/projects/threatpedia/tasks/${smokeTask.id}/extra.`);

    const patched = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/tasks/${smokeTask.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': operatorToken,
      },
      body: JSON.stringify({
        status: 'blocked',
        assignee: 'operator',
        blockedReason: 'Waiting for quota sync implementation.',
      }),
    }).then((response) => response.json());

    const blockedTask = patched.tasks.find((task) => task.id === smokeTask.id);
    assert.equal(blockedTask.status, 'blocked');
    assert.equal(blockedTask.assignee, 'operator');
    assert.equal(blockedTask.blockedReason, 'Waiting for quota sync implementation.');

    const disabledReplace = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/subscriptions`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': operatorToken,
      },
      body: JSON.stringify({
        subscriptions: [],
      }),
    });
    assert.equal(disabledReplace.status, 403);
    const disabledReplaceBody = await disabledReplace.json();
    assert.equal(disabledReplaceBody.error, 'forbidden');
    assert.match(disabledReplaceBody.detail, /disabled|prefer provider refresh/i);

    const subscriptionsMethodNotAllowed = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/subscriptions`);
    assert.equal(subscriptionsMethodNotAllowed.status, 405);
    assert.equal(subscriptionsMethodNotAllowed.headers.get('allow'), 'PUT');
    const subscriptionsMethodNotAllowedBody = await subscriptionsMethodNotAllowed.json();
    assert.equal(subscriptionsMethodNotAllowedBody.error, 'method_not_allowed');
    assert.equal(subscriptionsMethodNotAllowedBody.detail, 'Allowed methods: PUT');

    const unauthorizedRefresh = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    });
    assert.equal(unauthorizedRefresh.status, 401);
    const unauthorizedRefreshBody = await unauthorizedRefresh.json();
    assert.equal(unauthorizedRefreshBody.error, 'unauthorized');
    assert.match(unauthorizedRefreshBody.detail, /X-Switchboard-Operator-Token|operator token/i);

    const refreshMethodNotAllowed = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`);
    assert.equal(refreshMethodNotAllowed.status, 405);
    assert.equal(refreshMethodNotAllowed.headers.get('allow'), 'POST');
    const refreshMethodNotAllowedBody = await refreshMethodNotAllowed.json();
    assert.equal(refreshMethodNotAllowedBody.error, 'method_not_allowed');
    assert.equal(refreshMethodNotAllowedBody.detail, 'Allowed methods: POST');

    const refreshExtraPath = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh/extra`);
    assert.equal(refreshExtraPath.status, 404);
    const refreshExtraPathBody = await refreshExtraPath.json();
    assert.equal(refreshExtraPathBody.error, 'not_found');
    assert.equal(refreshExtraPathBody.detail, 'No route for GET /v1/projects/threatpedia/subscriptions/refresh/extra.');

    const refreshed = await fetchBroker(`${localBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': operatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }).then((response) => response.json());

    assert.equal(refreshed.refresh[0].provider, 'openai');
    assert.equal(refreshed.refresh[0].kind, 'trusted-command');
    assert.equal(refreshed.refresh[0].degraded, false);
    assert.deepEqual(refreshed.refresh[0].accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.deepEqual(refreshed.refresh[0].accountSyncMethods, ['provider']);
    assert.deepEqual(refreshed.refresh[0].syncModes, ['app-server-rate-limits']);
    assert.deepEqual(refreshed.refresh[0].syncBadges, []);
    assert.deepEqual(refreshed.refresh[0].rateLimitHosts, []);
    assert.deepEqual(refreshed.refresh[0].openaiAuth, ['required']);
    const openaiAccount = refreshed.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const openaiProviderSummary = refreshed.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');
    assert.equal(openaiAccount.syncMethod, 'provider');
    assert.equal(openaiAccount.id, 'openai-codex-chatgpt');
    assert.match(refreshed.refresh[0].latestAccountRefreshedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(refreshed.refresh[0].latestAccountRefreshedAt, openaiAccount.lastRefreshedAt);
    assert.deepEqual(openaiProviderSummary.accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.equal(openaiProviderSummary.latestAccountRefreshedAt, refreshed.refresh[0].latestAccountRefreshedAt);
    assert.deepEqual(openaiProviderSummary.accountSyncMethods, ['provider']);
    assert.equal(openaiProviderSummary.degraded, false);
    assert.deepEqual(openaiProviderSummary.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(openaiProviderSummary.openaiAuth, ['required']);
    assert.deepEqual(openaiAccount.signals, [
      {
        id: 'source',
        label: 'source',
        value: 'app-server rate-limits',
      },
      {
        id: 'plan',
        label: 'plan',
        value: 'Pro',
      },
      {
        id: 'credits',
        label: 'credits',
        value: '0',
      },
      {
        id: 'openai_auth',
        label: 'openai-auth',
        value: 'required',
      },
    ]);
    const codexQuota = openaiAccount.quotas.find((quota) => quota.modelId === 'codex');
    assert.notEqual(codexQuota, undefined);
    assert.equal(codexQuota.remaining, 91);
    assert.equal(codexQuota.limit, 100);
    assert.equal(codexQuota.used, 9);
    assert.equal(codexQuota.interpretation, 'percentage_window');
    assert.equal(codexQuota.source, 'cli');
    assert.deepEqual(codexQuota.windows, [
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
    ]);
    assert.equal(codexQuota.notes, undefined);
    const sparkQuota = openaiAccount.quotas.find((quota) => quota.modelId === 'codex_bengalfox');
    assert.notEqual(sparkQuota, undefined);
    assert.equal(sparkQuota.remaining, 100);
    assert.equal(sparkQuota.displayName, 'GPT-5.3-Codex-Spark');
    assert.equal(sparkQuota.interpretation, 'percentage_window');
    assert.deepEqual(sparkQuota.windows, [
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
    ]);
    assert(refreshed.dashboard.plan.warnings.some((warning) =>
      warning.code === 'quota_unknown' && warning.message.includes('TASK-0001')
    ));

    const stateFile = path.join(localStateDir, 'threatpedia.json');
    const stateStat = await stat(stateFile);
    assert.equal((stateStat.mode & 0o777), 0o600);

    const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
    const persistedTask = persisted.tasks.find((task) => task.id === smokeTask.id);
    assert.notEqual(persistedTask, undefined);
    assert.equal(persistedTask.status, 'blocked');
    assert.equal(persistedTask.blockedReason, 'Waiting for quota sync implementation.');
    const persistedOpenAI = persisted.subscriptions.find((account) => account.provider === 'openai');
    assert.equal(persistedOpenAI.syncMethod, 'provider');
    assert.equal(persistedOpenAI.id, 'openai-codex-chatgpt');
    assert.deepEqual(persistedOpenAI.signals, openaiAccount.signals);
    const persistedCodexQuota = persistedOpenAI.quotas.find((quota) => quota.modelId === 'codex');
    assert.equal(persistedCodexQuota.remaining, 91);
    assert.equal(persistedCodexQuota.source, 'cli');
    assert.equal(persistedCodexQuota.interpretation, 'percentage_window');
    assert.equal(persistedCodexQuota.windows?.length, 2);

    const unknownProfile = await fetchBroker(`${localBroker.baseUrl}/v1/projects/unknown/dashboard`);
    assert.equal(unknownProfile.status, 404);
    const unknownProfileBody = await unknownProfile.json();
    assert.equal(unknownProfileBody.error, 'not_found');
    assert.equal(unknownProfileBody.detail, 'Unknown project profile "unknown".');

    await localBroker.stop();
    localBroker = undefined;

    degradedBroker = await startBroker({
      port: degradedPort,
      host: '127.0.0.1',
      profilesDir,
      stateDir: degradedStateDir,
      snapshotDir,
      operatorToken,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'partial-app-server',
      },
    });

    const degradedRefresh = await fetchBroker(`${degradedBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': operatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }).then((response) => response.json());

    assert.equal(degradedRefresh.refresh[0].provider, 'openai');
    assert.equal(degradedRefresh.refresh[0].kind, 'trusted-command');
    assert.equal(degradedRefresh.refresh[0].degraded, true);
    assert.deepEqual(degradedRefresh.refresh[0].accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.deepEqual(degradedRefresh.refresh[0].accountSyncMethods, ['provider']);
    assert.deepEqual(degradedRefresh.refresh[0].syncModes, ['app-server-account']);
    assert.deepEqual(
      degradedRefresh.refresh[0].syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(degradedRefresh.refresh[0].rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(degradedRefresh.refresh[0].openaiAuth, ['required']);
    assert.equal(degradedRefresh.refresh[0].quotaCoverage, 'informational_only');
    assert.equal(degradedRefresh.refresh[0].quotaModels, 1);
    assert.equal(degradedRefresh.refresh[0].typedQuotaModels, 0);

    const degradedAccount = degradedRefresh.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const degradedProviderSummary = degradedRefresh.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(degradedAccount, undefined);
    assert.notEqual(degradedProviderSummary, undefined);
    assert.equal(degradedAccount.syncMethod, 'provider');
    assert.equal(degradedAccount.id, 'openai-codex-chatgpt');
    assert.deepEqual(degradedAccount.signals, [
      {
        id: 'source',
        label: 'source',
        value: 'app-server account',
      },
      {
        id: 'plan',
        label: 'plan',
        value: 'Pro',
      },
      {
        id: 'openai_auth',
        label: 'openai-auth',
        value: 'required',
      },
      {
        id: 'rate_limits',
        label: 'rate-limits',
        value: 'usage endpoint unavailable',
      },
      {
        id: 'rate_limits_host',
        label: 'rate-limits-host',
        value: 'chatgpt.com',
      },
    ]);
    assert.equal(degradedAccount.quotas.length, 1);
    assert.equal(degradedAccount.quotas[0].modelId, 'codex');
    assert.equal(degradedAccount.quotas[0].interpretation, 'informational');
    assert.equal(degradedAccount.quotas[0].source, 'cli');
    assert.equal(degradedAccount.quotas[0].usageUnit, 'unknown');
    assert.equal(degradedAccount.quotas[0].windows, undefined);
    assert.match(degradedAccount.quotas[0].notes ?? '', /Informational only: Codex app-server returned account metadata but no rate-limit snapshot/);
    assert.equal(degradedProviderSummary.degraded, true);
    assert.deepEqual(degradedProviderSummary.syncModes, ['app-server-account']);
    assert.deepEqual(
      degradedProviderSummary.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(degradedProviderSummary.rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(degradedProviderSummary.openaiAuth, ['required']);
    assert.equal(degradedProviderSummary.quotaCoverage, 'informational_only');
    assert.equal(degradedProviderSummary.quotaModels, 1);
    assert.equal(degradedProviderSummary.typedQuotaModels, 0);
    const degradedDashboard = await fetchBroker(`${degradedBroker.baseUrl}/v1/projects/threatpedia/dashboard`).then((response) => response.json());
    const degradedDashboardAccount = degradedDashboard.subscriptions.find((account) => account.provider === 'openai');
    const degradedDashboardProviderSummary = degradedDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(degradedDashboardAccount, undefined);
    assert.notEqual(degradedDashboardProviderSummary, undefined);
    assert.equal(degradedDashboardAccount.syncMethod, 'provider');
    assert.deepEqual(degradedDashboardAccount.signals, degradedAccount.signals);
    assert.equal(degradedDashboardAccount.quotas.length, 1);
    assert.equal(degradedDashboardAccount.quotas[0].modelId, 'codex');
    assert.equal(degradedDashboardAccount.quotas[0].interpretation, 'informational');
    assert.equal(degradedDashboardAccount.quotas[0].windows, undefined);
    assert.equal(degradedDashboardProviderSummary.degraded, true);
    assert.deepEqual(degradedDashboardProviderSummary.syncModes, ['app-server-account']);
    assert.deepEqual(
      degradedDashboardProviderSummary.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(degradedDashboardProviderSummary.rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(degradedDashboardProviderSummary.openaiAuth, ['required']);
    assert.equal(degradedDashboardProviderSummary.quotaCoverage, 'informational_only');
    assert.equal(degradedDashboardProviderSummary.quotaModels, 1);
    assert.equal(degradedDashboardProviderSummary.typedQuotaModels, 0);
    assertSanitizedBrokerJson(degradedDashboard);

    const degradedState = await fetchBroker(`${degradedBroker.baseUrl}/v1/projects/threatpedia/state`).then((response) => response.json());
    const degradedStateAccount = degradedState.subscriptions.find((account) => account.provider === 'openai');

    assert.notEqual(degradedStateAccount, undefined);
    assert.equal(degradedStateAccount.syncMethod, 'provider');
    assert.deepEqual(degradedStateAccount.signals, degradedAccount.signals);
    assert.equal(degradedStateAccount.quotas.length, 1);
    assert.equal(degradedStateAccount.quotas[0].modelId, 'codex');
    assert.equal(degradedStateAccount.quotas[0].interpretation, 'informational');
    assert.equal(degradedStateAccount.quotas[0].windows, undefined);
    assert.equal(typeof degradedState.updatedAt, 'string');
    assert.equal('plan' in degradedState, false);
    assert.equal('providerSummaries' in degradedState, false);
    assertSanitizedBrokerJson(degradedState);
    await assertPersistedDegradedOpenAiState(degradedStateDir);

    await degradedBroker.stop();
    degradedBroker = undefined;

    localTokenFileBroker = await startBroker({
      port: localTokenFilePort,
      host: '127.0.0.1',
      profilesDir,
      stateDir: localTokenFileStateDir,
      snapshotDir,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'mixed-rate-limits',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: localTokenFile,
      },
    });

    const localTokenFileHealth = await fetchBroker(`${localTokenFileBroker.baseUrl}/healthz`).then((response) => response.json());
    assert.equal(localTokenFileHealth.status, 'ok');
    assert.equal(localTokenFileHealth.localOnly, true);
    assert.equal(localTokenFileHealth.operatorTokenRequired, true);
    assert.equal(localTokenFileHealth.protocol, 'http');
    assert.equal(localTokenFileHealth.tlsEnabled, false);
    assert.equal(localTokenFileHealth.auth.operatorTokenConfigured, true);
    assert.equal(localTokenFileHealth.auth.operatorTokenSource, 'file');
    assert.equal(localTokenFileHealth.auth.operatorTokenFile, 'operator-token');
    assert.equal(localTokenFileHealth.auth.scopes.taskCreate.requirement, 'operator_token');
    assert.equal(localTokenFileHealth.auth.scopes.taskUpdate.requirement, 'operator_token');
    assert.equal(localTokenFileHealth.auth.scopes.subscriptionRefresh.requirement, 'operator_token');
    assert.equal(localTokenFileHealth.auth.scopes.subscriptionReplace.requirement, 'disabled');
    assertSanitizedBrokerJson(localTokenFileHealth);

    const localTokenFileCreateUnauthorized = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Local token-file unauthorized task',
        description: 'This should be rejected without the operator token header.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    });
    assert.equal(localTokenFileCreateUnauthorized.status, 401);

    const localTokenFileCreated = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': localFileOperatorToken,
      },
      body: JSON.stringify({
        title: 'Local token-file smoke task',
        description: 'Created by the local file-backed operator-token broker smoke path.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    }).then((response) => response.json());
    assert.equal(localTokenFileCreated.tasks.some((task) => task.title === 'Local token-file smoke task'), true);

    const localTokenFileRefreshUnauthorized = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    });
    assert.equal(localTokenFileRefreshUnauthorized.status, 401);

    const localTokenFileRefreshAuthorized = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': localFileOperatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }).then((response) => response.json());
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].provider, 'openai');
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].kind, 'trusted-command');
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].degraded, false);
    assert.deepEqual(localTokenFileRefreshAuthorized.refresh[0].accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.deepEqual(localTokenFileRefreshAuthorized.refresh[0].accountSyncMethods, ['provider']);
    assert.deepEqual(localTokenFileRefreshAuthorized.refresh[0].syncModes, ['app-server-rate-limits']);
    assert.deepEqual(localTokenFileRefreshAuthorized.refresh[0].syncBadges, []);
    assert.deepEqual(localTokenFileRefreshAuthorized.refresh[0].rateLimitHosts, []);
    assert.deepEqual(localTokenFileRefreshAuthorized.refresh[0].openaiAuth, ['required']);
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].quotaCoverage, 'mixed');
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].quotaModels, 2);
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].typedQuotaModels, 1);

    const localTokenFileAccount = localTokenFileRefreshAuthorized.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const localTokenFileProviderSummary = localTokenFileRefreshAuthorized.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(localTokenFileAccount, undefined);
    assert.notEqual(localTokenFileProviderSummary, undefined);
    assert.equal(localTokenFileAccount.syncMethod, 'provider');
    assert.match(localTokenFileRefreshAuthorized.refresh[0].latestAccountRefreshedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(localTokenFileRefreshAuthorized.refresh[0].latestAccountRefreshedAt, localTokenFileAccount.lastRefreshedAt);
    assert.deepEqual(localTokenFileProviderSummary.accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.equal(
      localTokenFileProviderSummary.latestAccountRefreshedAt,
      localTokenFileRefreshAuthorized.refresh[0].latestAccountRefreshedAt,
    );
    assert.deepEqual(localTokenFileProviderSummary.accountSyncMethods, ['provider']);
    assert.equal(localTokenFileAccount.quotas.length, 2);
    assert.equal(localTokenFileAccount.quotas[0].modelId, 'codex');
    assert.equal(localTokenFileAccount.quotas[0].interpretation, 'percentage_window');
    assert.equal(localTokenFileAccount.quotas[0].windows?.length, 2);
    assert.equal(localTokenFileAccount.quotas[1].modelId, 'codex_bengalfox');
    assert.equal(localTokenFileAccount.quotas[1].interpretation, 'informational');
    assert.equal(localTokenFileAccount.quotas[1].windows, undefined);
    assert.equal(localTokenFileProviderSummary.degraded, false);
    assert.deepEqual(localTokenFileProviderSummary.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(localTokenFileProviderSummary.syncBadges, []);
    assert.deepEqual(localTokenFileProviderSummary.rateLimitHosts, []);
    assert.deepEqual(localTokenFileProviderSummary.openaiAuth, ['required']);
    assert.equal(localTokenFileProviderSummary.quotaCoverage, 'mixed');
    assert.equal(localTokenFileProviderSummary.quotaModels, 2);
    assert.equal(localTokenFileProviderSummary.typedQuotaModels, 1);

    const localTokenFileDashboard = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/dashboard`)
      .then((response) => response.json());
    const localTokenFileDashboardAccount = localTokenFileDashboard.subscriptions.find((account) => account.provider === 'openai');
    const localTokenFileDashboardProviderSummary = localTokenFileDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(localTokenFileDashboardAccount, undefined);
    assert.notEqual(localTokenFileDashboardProviderSummary, undefined);
    assert.equal(localTokenFileDashboardAccount.syncMethod, 'provider');
    assert.deepEqual(localTokenFileDashboardProviderSummary.accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.equal(
      localTokenFileDashboardProviderSummary.latestAccountRefreshedAt,
      localTokenFileDashboardAccount.lastRefreshedAt,
    );
    assert.deepEqual(localTokenFileDashboardProviderSummary.accountSyncMethods, ['provider']);
    assert.equal(localTokenFileDashboardAccount.quotas.length, 2);
    assert.equal(localTokenFileDashboardAccount.quotas[0].modelId, 'codex');
    assert.equal(localTokenFileDashboardAccount.quotas[0].interpretation, 'percentage_window');
    assert.equal(localTokenFileDashboardAccount.quotas[1].modelId, 'codex_bengalfox');
    assert.equal(localTokenFileDashboardAccount.quotas[1].interpretation, 'informational');
    assert.equal(localTokenFileDashboardProviderSummary.degraded, false);
    assert.deepEqual(localTokenFileDashboardProviderSummary.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(localTokenFileDashboardProviderSummary.syncBadges, []);
    assert.deepEqual(localTokenFileDashboardProviderSummary.rateLimitHosts, []);
    assert.deepEqual(localTokenFileDashboardProviderSummary.openaiAuth, ['required']);
    assert.equal(localTokenFileDashboardProviderSummary.quotaCoverage, 'mixed');
    assert.equal(localTokenFileDashboardProviderSummary.quotaModels, 2);
    assert.equal(localTokenFileDashboardProviderSummary.typedQuotaModels, 1);
    assertSanitizedBrokerJson(localTokenFileDashboard);

    const localTokenFileState = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/state`)
      .then((response) => response.json());
    const localTokenFileStateAccount = localTokenFileState.subscriptions.find((account) => account.provider === 'openai');

    assert.notEqual(localTokenFileStateAccount, undefined);
    assert.equal(localTokenFileStateAccount.syncMethod, 'provider');
    assert.equal(localTokenFileStateAccount.quotas.length, 2);
    assert.equal(localTokenFileStateAccount.quotas[0].modelId, 'codex');
    assert.equal(localTokenFileStateAccount.quotas[0].interpretation, 'percentage_window');
    assert.equal(localTokenFileStateAccount.quotas[0].windows?.length, 2);
    assert.equal(localTokenFileStateAccount.quotas[1].modelId, 'codex_bengalfox');
    assert.equal(localTokenFileStateAccount.quotas[1].interpretation, 'informational');
    assert.equal(localTokenFileStateAccount.quotas[1].windows, undefined);
    assert.deepEqual(localTokenFileStateAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server rate-limits' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ]);
    assert.equal(typeof localTokenFileState.updatedAt, 'string');
    assert.equal('plan' in localTokenFileState, false);
    assert.equal('providerSummaries' in localTokenFileState, false);
    assertSanitizedBrokerJson(localTokenFileState);
    await assertPersistedMixedOpenAiState(localTokenFileStateDir, 'Local token-file smoke task');

    await localTokenFileBroker.stop();
    localTokenFileBroker = undefined;

    localTokenFileBroker = await startBroker({
      port: localTokenFileTypedPort,
      host: '127.0.0.1',
      profilesDir,
      stateDir: localTokenFileTypedStateDir,
      snapshotDir,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'full-rate-limits',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: localTokenFile,
      },
    });

    const localTokenFileTypedRefreshAuthorized = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': localFileOperatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }).then((response) => response.json());
    assertHealthyTypedOpenAiRefreshEntry(localTokenFileTypedRefreshAuthorized.refresh[0]);

    const localTokenFileTypedAccount = localTokenFileTypedRefreshAuthorized.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const localTokenFileTypedProviderSummary = localTokenFileTypedRefreshAuthorized.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assertHealthyTypedOpenAiAccount(localTokenFileTypedAccount);
    assert.notEqual(localTokenFileTypedProviderSummary, undefined);
    assertHealthyTypedOpenAiProviderSummary(localTokenFileTypedProviderSummary);

    const localTokenFileTypedDashboard = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/dashboard`)
      .then((response) => response.json());
    const localTokenFileTypedDashboardAccount = localTokenFileTypedDashboard.subscriptions.find((account) => account.provider === 'openai');
    const localTokenFileTypedDashboardProviderSummary = localTokenFileTypedDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assertHealthyTypedOpenAiAccount(localTokenFileTypedDashboardAccount);
    assert.notEqual(localTokenFileTypedDashboardProviderSummary, undefined);
    assertHealthyTypedOpenAiProviderSummary(localTokenFileTypedDashboardProviderSummary);
    assertSanitizedBrokerJson(localTokenFileTypedDashboard);

    const localTokenFileTypedState = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/state`)
      .then((response) => response.json());
    const localTokenFileTypedStateAccount = localTokenFileTypedState.subscriptions.find((account) => account.provider === 'openai');

    assertHealthyTypedOpenAiAccount(localTokenFileTypedStateAccount);
    assert.equal(typeof localTokenFileTypedState.updatedAt, 'string');
    assert.equal('plan' in localTokenFileTypedState, false);
    assert.equal('providerSummaries' in localTokenFileTypedState, false);
    assertSanitizedBrokerJson(localTokenFileTypedState);
    await assertPersistedTypedOpenAiState(localTokenFileTypedStateDir);

    await localTokenFileBroker.stop();
    localTokenFileBroker = undefined;

    localTokenFileBroker = await startBroker({
      port: localTokenFileDegradedPort,
      host: '127.0.0.1',
      profilesDir,
      stateDir: localTokenFileDegradedStateDir,
      snapshotDir,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'partial-app-server',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: localTokenFile,
      },
    });

    const localTokenFileDegradedHealth = await fetchBroker(`${localTokenFileBroker.baseUrl}/healthz`).then((response) => response.json());
    assert.equal(localTokenFileDegradedHealth.localOnly, true);
    assert.equal(localTokenFileDegradedHealth.auth.operatorTokenConfigured, true);
    assert.equal(localTokenFileDegradedHealth.auth.operatorTokenSource, 'file');
    assert.equal(localTokenFileDegradedHealth.auth.operatorTokenFile, 'operator-token');
    assert.equal(localTokenFileDegradedHealth.auth.scopes.subscriptionRefresh.requirement, 'operator_token');
    assertSanitizedBrokerJson(localTokenFileDegradedHealth);

    const localTokenFileDegradedRefreshUnauthorized = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    });
    assert.equal(localTokenFileDegradedRefreshUnauthorized.status, 401);

    const localTokenFileDegradedRefreshAuthorized = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': localFileOperatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }).then((response) => response.json());
    assert.equal(localTokenFileDegradedRefreshAuthorized.refresh[0].provider, 'openai');
    assert.equal(localTokenFileDegradedRefreshAuthorized.refresh[0].kind, 'trusted-command');
    assert.equal(localTokenFileDegradedRefreshAuthorized.refresh[0].degraded, true);
    assert.deepEqual(localTokenFileDegradedRefreshAuthorized.refresh[0].accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.deepEqual(localTokenFileDegradedRefreshAuthorized.refresh[0].accountSyncMethods, ['provider']);
    assert.deepEqual(localTokenFileDegradedRefreshAuthorized.refresh[0].syncModes, ['app-server-account']);
    assert.deepEqual(
      localTokenFileDegradedRefreshAuthorized.refresh[0].syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(localTokenFileDegradedRefreshAuthorized.refresh[0].rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(localTokenFileDegradedRefreshAuthorized.refresh[0].openaiAuth, ['required']);
    assert.equal(localTokenFileDegradedRefreshAuthorized.refresh[0].quotaCoverage, 'informational_only');
    assert.equal(localTokenFileDegradedRefreshAuthorized.refresh[0].quotaModels, 1);
    assert.equal(localTokenFileDegradedRefreshAuthorized.refresh[0].typedQuotaModels, 0);

    const localTokenFileDegradedAccount = localTokenFileDegradedRefreshAuthorized.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const localTokenFileDegradedProviderSummary = localTokenFileDegradedRefreshAuthorized.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(localTokenFileDegradedAccount, undefined);
    assert.notEqual(localTokenFileDegradedProviderSummary, undefined);
    assert.equal(localTokenFileDegradedAccount.syncMethod, 'provider');
    assert.deepEqual(localTokenFileDegradedAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server account' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
      { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
    ]);
    assert.equal(localTokenFileDegradedAccount.quotas.length, 1);
    assert.equal(localTokenFileDegradedAccount.quotas[0].modelId, 'codex');
    assert.equal(localTokenFileDegradedAccount.quotas[0].interpretation, 'informational');
    assert.equal(localTokenFileDegradedAccount.quotas[0].windows, undefined);
    assert.equal(localTokenFileDegradedProviderSummary.degraded, true);
    assert.deepEqual(localTokenFileDegradedProviderSummary.syncModes, ['app-server-account']);
    assert.deepEqual(
      localTokenFileDegradedProviderSummary.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(localTokenFileDegradedProviderSummary.rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(localTokenFileDegradedProviderSummary.openaiAuth, ['required']);
    assert.equal(localTokenFileDegradedProviderSummary.quotaCoverage, 'informational_only');
    assert.equal(localTokenFileDegradedProviderSummary.quotaModels, 1);
    assert.equal(localTokenFileDegradedProviderSummary.typedQuotaModels, 0);

    const localTokenFileDegradedDashboard = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/dashboard`)
      .then((response) => response.json());
    const localTokenFileDegradedDashboardAccount = localTokenFileDegradedDashboard.subscriptions.find((account) => account.provider === 'openai');
    const localTokenFileDegradedDashboardProviderSummary = localTokenFileDegradedDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(localTokenFileDegradedDashboardAccount, undefined);
    assert.notEqual(localTokenFileDegradedDashboardProviderSummary, undefined);
    assert.equal(localTokenFileDegradedDashboardAccount.syncMethod, 'provider');
    assert.deepEqual(localTokenFileDegradedDashboardAccount.signals, localTokenFileDegradedAccount.signals);
    assert.equal(localTokenFileDegradedDashboardAccount.quotas.length, 1);
    assert.equal(localTokenFileDegradedDashboardAccount.quotas[0].modelId, 'codex');
    assert.equal(localTokenFileDegradedDashboardAccount.quotas[0].interpretation, 'informational');
    assert.equal(localTokenFileDegradedDashboardAccount.quotas[0].windows, undefined);
    assert.equal(localTokenFileDegradedDashboardProviderSummary.degraded, true);
    assert.deepEqual(localTokenFileDegradedDashboardProviderSummary.syncModes, ['app-server-account']);
    assert.deepEqual(
      localTokenFileDegradedDashboardProviderSummary.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(localTokenFileDegradedDashboardProviderSummary.rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(localTokenFileDegradedDashboardProviderSummary.openaiAuth, ['required']);
    assert.equal(localTokenFileDegradedDashboardProviderSummary.quotaCoverage, 'informational_only');
    assert.equal(localTokenFileDegradedDashboardProviderSummary.quotaModels, 1);
    assert.equal(localTokenFileDegradedDashboardProviderSummary.typedQuotaModels, 0);
    assertSanitizedBrokerJson(localTokenFileDegradedDashboard);

    const localTokenFileDegradedState = await fetchBroker(`${localTokenFileBroker.baseUrl}/v1/projects/threatpedia/state`)
      .then((response) => response.json());
    const localTokenFileDegradedStateAccount = localTokenFileDegradedState.subscriptions.find((account) => account.provider === 'openai');

    assert.notEqual(localTokenFileDegradedStateAccount, undefined);
    assert.equal(localTokenFileDegradedStateAccount.syncMethod, 'provider');
    assert.deepEqual(localTokenFileDegradedStateAccount.signals, localTokenFileDegradedAccount.signals);
    assert.equal(localTokenFileDegradedStateAccount.quotas.length, 1);
    assert.equal(localTokenFileDegradedStateAccount.quotas[0].modelId, 'codex');
    assert.equal(localTokenFileDegradedStateAccount.quotas[0].interpretation, 'informational');
    assert.equal(localTokenFileDegradedStateAccount.quotas[0].windows, undefined);
    assert.equal(typeof localTokenFileDegradedState.updatedAt, 'string');
    assert.equal('plan' in localTokenFileDegradedState, false);
    assert.equal('providerSummaries' in localTokenFileDegradedState, false);
    assertSanitizedBrokerJson(localTokenFileDegradedState);
    await assertPersistedDegradedOpenAiState(localTokenFileDegradedStateDir);

    await localTokenFileBroker.stop();
    localTokenFileBroker = undefined;

    insecureDefaultTokenBroker = await startBroker({
      port: insecureDefaultTokenPort,
      host: '127.0.0.1',
      profilesDir,
      stateDir: insecureDefaultTokenStateDir,
      snapshotDir,
      extraEnv: {
        SWITCHBOARD_OPERATOR_TOKEN_FILE: insecureDefaultTokenFile,
      },
    });

    const insecureDefaultTokenHealth = await fetchBroker(`${insecureDefaultTokenBroker.baseUrl}/healthz`).then((response) => response.json());
    assert.equal(insecureDefaultTokenHealth.localOnly, true);
    assert.equal(insecureDefaultTokenHealth.operatorTokenRequired, false);
    assert.equal(insecureDefaultTokenHealth.auth.operatorTokenConfigured, false);
    assert.equal(insecureDefaultTokenHealth.auth.operatorTokenSource, 'file');
    assert.equal(insecureDefaultTokenHealth.auth.operatorTokenFile, 'operator-token');
    assert.equal(
      insecureDefaultTokenHealth.auth.operatorTokenProblem,
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    );
    assert.equal(insecureDefaultTokenHealth.auth.scopes.taskCreate.requirement, 'open');
    assert.equal(insecureDefaultTokenHealth.auth.scopes.taskUpdate.requirement, 'open');
    assert.equal(insecureDefaultTokenHealth.auth.scopes.subscriptionRefresh.requirement, 'open');
    assert.equal(insecureDefaultTokenHealth.auth.scopes.subscriptionReplace.requirement, 'disabled');
    assertSanitizedBrokerJson(insecureDefaultTokenHealth);

    await insecureDefaultTokenBroker.stop();
    insecureDefaultTokenBroker = undefined;

    remoteTokenFileBroker = await startBroker({
      port: remoteTokenFilePort,
      host: '0.0.0.0',
      profilesDir,
      stateDir: remoteTokenFileStateDir,
      snapshotDir,
      allowRemote: true,
      protocol: 'https',
      tlsCertFile: remoteTls.certFile,
      tlsKeyFile: remoteTls.keyFile,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteTokenFile,
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'mixed-rate-limits',
      },
    });

    const remoteTokenFileHealth = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/healthz`, {}, remoteTokenFileBroker.insecureTls).then((response) => response.json());
    assert.equal(remoteTokenFileHealth.localOnly, false);
    assert.equal(remoteTokenFileHealth.protocol, 'https');
    assert.equal(remoteTokenFileHealth.tlsEnabled, true);
    assert.equal(remoteTokenFileHealth.auth.remoteExposureAllowed, true);
    assert.equal(remoteTokenFileHealth.auth.operatorTokenConfigured, true);
    assert.equal(remoteTokenFileHealth.auth.operatorTokenSource, 'file');
    assert.equal(remoteTokenFileHealth.auth.operatorTokenFile, 'operator-token');
    assert.equal(remoteTokenFileHealth.auth.scopes.taskCreate.requirement, 'operator_token');
    assert.equal(remoteTokenFileHealth.auth.scopes.subscriptionRefresh.requirement, 'operator_token');
    assertSanitizedBrokerJson(remoteTokenFileHealth);

    const remoteTokenFileCreateUnauthorized = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Remote token task',
        description: 'This should be rejected without the operator token header.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    }, remoteTokenFileBroker.insecureTls);
    assert.equal(remoteTokenFileCreateUnauthorized.status, 401);

    const remoteTokenFileCreated = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': remoteOperatorToken,
      },
      body: JSON.stringify({
        title: 'Remote token task',
        description: 'Created by the remote token-file broker smoke path.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    }, remoteTokenFileBroker.insecureTls).then((response) => response.json());
    assert.equal(remoteTokenFileCreated.tasks.some((task) => task.title === 'Remote token task'), true);

    const remoteTokenFileRefreshUnauthorized = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }, remoteTokenFileBroker.insecureTls);
    assert.equal(remoteTokenFileRefreshUnauthorized.status, 401);

    const remoteTokenFileRefreshAuthorized = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': remoteOperatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }, remoteTokenFileBroker.insecureTls).then((response) => response.json());
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].provider, 'openai');
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].kind, 'trusted-command');
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].degraded, false);
    assert.deepEqual(remoteTokenFileRefreshAuthorized.refresh[0].accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.deepEqual(remoteTokenFileRefreshAuthorized.refresh[0].accountSyncMethods, ['provider']);
    assert.deepEqual(remoteTokenFileRefreshAuthorized.refresh[0].syncModes, ['app-server-rate-limits']);
    assert.deepEqual(remoteTokenFileRefreshAuthorized.refresh[0].syncBadges, []);
    assert.deepEqual(remoteTokenFileRefreshAuthorized.refresh[0].rateLimitHosts, []);
    assert.deepEqual(remoteTokenFileRefreshAuthorized.refresh[0].openaiAuth, ['required']);
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].quotaCoverage, 'mixed');
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].quotaModels, 2);
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].typedQuotaModels, 1);

    const remoteTokenFileAccount = remoteTokenFileRefreshAuthorized.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const remoteTokenFileProviderSummary = remoteTokenFileRefreshAuthorized.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(remoteTokenFileAccount, undefined);
    assert.notEqual(remoteTokenFileProviderSummary, undefined);
    assert.equal(remoteTokenFileAccount.syncMethod, 'provider');
    assert.match(remoteTokenFileRefreshAuthorized.refresh[0].latestAccountRefreshedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(remoteTokenFileRefreshAuthorized.refresh[0].latestAccountRefreshedAt, remoteTokenFileAccount.lastRefreshedAt);
    assert.deepEqual(remoteTokenFileProviderSummary.accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.equal(
      remoteTokenFileProviderSummary.latestAccountRefreshedAt,
      remoteTokenFileRefreshAuthorized.refresh[0].latestAccountRefreshedAt,
    );
    assert.deepEqual(remoteTokenFileProviderSummary.accountSyncMethods, ['provider']);
    assert.equal(remoteTokenFileAccount.quotas.length, 2);
    assert.equal(remoteTokenFileAccount.quotas[0].modelId, 'codex');
    assert.equal(remoteTokenFileAccount.quotas[0].interpretation, 'percentage_window');
    assert.equal(remoteTokenFileAccount.quotas[0].windows?.length, 2);
    assert.equal(remoteTokenFileAccount.quotas[1].modelId, 'codex_bengalfox');
    assert.equal(remoteTokenFileAccount.quotas[1].interpretation, 'informational');
    assert.equal(remoteTokenFileAccount.quotas[1].windows, undefined);
    assert.equal(remoteTokenFileProviderSummary.degraded, false);
    assert.deepEqual(remoteTokenFileProviderSummary.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(remoteTokenFileProviderSummary.syncBadges, []);
    assert.deepEqual(remoteTokenFileProviderSummary.rateLimitHosts, []);
    assert.deepEqual(remoteTokenFileProviderSummary.openaiAuth, ['required']);
    assert.equal(remoteTokenFileProviderSummary.quotaCoverage, 'mixed');
    assert.equal(remoteTokenFileProviderSummary.quotaModels, 2);
    assert.equal(remoteTokenFileProviderSummary.typedQuotaModels, 1);

    const remoteTokenFileDashboard = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/dashboard`, {}, remoteTokenFileBroker.insecureTls)
      .then((response) => response.json());
    const remoteTokenFileDashboardAccount = remoteTokenFileDashboard.subscriptions.find((account) => account.provider === 'openai');
    const remoteTokenFileDashboardProviderSummary = remoteTokenFileDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(remoteTokenFileDashboardAccount, undefined);
    assert.notEqual(remoteTokenFileDashboardProviderSummary, undefined);
    assert.equal(remoteTokenFileDashboardAccount.syncMethod, 'provider');
    assert.deepEqual(remoteTokenFileDashboardProviderSummary.accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.equal(
      remoteTokenFileDashboardProviderSummary.latestAccountRefreshedAt,
      remoteTokenFileDashboardAccount.lastRefreshedAt,
    );
    assert.deepEqual(remoteTokenFileDashboardProviderSummary.accountSyncMethods, ['provider']);
    assert.equal(remoteTokenFileDashboardAccount.quotas.length, 2);
    assert.equal(remoteTokenFileDashboardAccount.quotas[0].modelId, 'codex');
    assert.equal(remoteTokenFileDashboardAccount.quotas[0].interpretation, 'percentage_window');
    assert.equal(remoteTokenFileDashboardAccount.quotas[1].modelId, 'codex_bengalfox');
    assert.equal(remoteTokenFileDashboardAccount.quotas[1].interpretation, 'informational');
    assert.equal(remoteTokenFileDashboardProviderSummary.degraded, false);
    assert.deepEqual(remoteTokenFileDashboardProviderSummary.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(remoteTokenFileDashboardProviderSummary.syncBadges, []);
    assert.deepEqual(remoteTokenFileDashboardProviderSummary.rateLimitHosts, []);
    assert.deepEqual(remoteTokenFileDashboardProviderSummary.openaiAuth, ['required']);
    assert.equal(remoteTokenFileDashboardProviderSummary.quotaCoverage, 'mixed');
    assert.equal(remoteTokenFileDashboardProviderSummary.quotaModels, 2);
    assert.equal(remoteTokenFileDashboardProviderSummary.typedQuotaModels, 1);
    assertSanitizedBrokerJson(remoteTokenFileDashboard);

    const remoteTokenFileState = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/state`, {}, remoteTokenFileBroker.insecureTls)
      .then((response) => response.json());
    const remoteTokenFileStateAccount = remoteTokenFileState.subscriptions.find((account) => account.provider === 'openai');

    assert.notEqual(remoteTokenFileStateAccount, undefined);
    assert.equal(remoteTokenFileStateAccount.syncMethod, 'provider');
    assert.equal(remoteTokenFileStateAccount.quotas.length, 2);
    assert.equal(remoteTokenFileStateAccount.quotas[0].modelId, 'codex');
    assert.equal(remoteTokenFileStateAccount.quotas[0].interpretation, 'percentage_window');
    assert.equal(remoteTokenFileStateAccount.quotas[0].windows?.length, 2);
    assert.equal(remoteTokenFileStateAccount.quotas[1].modelId, 'codex_bengalfox');
    assert.equal(remoteTokenFileStateAccount.quotas[1].interpretation, 'informational');
    assert.equal(remoteTokenFileStateAccount.quotas[1].windows, undefined);
    assert.deepEqual(remoteTokenFileStateAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server rate-limits' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ]);
    assert.equal(typeof remoteTokenFileState.updatedAt, 'string');
    assert.equal('plan' in remoteTokenFileState, false);
    assert.equal('providerSummaries' in remoteTokenFileState, false);
    assertSanitizedBrokerJson(remoteTokenFileState);
    await assertPersistedMixedOpenAiState(remoteTokenFileStateDir, 'Remote token task');

    await remoteTokenFileBroker.stop();
    remoteTokenFileBroker = undefined;

    remoteTokenFileBroker = await startBroker({
      port: remoteTokenFileTypedPort,
      host: '0.0.0.0',
      profilesDir,
      stateDir: remoteTokenFileTypedStateDir,
      snapshotDir,
      allowRemote: true,
      protocol: 'https',
      tlsCertFile: remoteTls.certFile,
      tlsKeyFile: remoteTls.keyFile,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteTokenFile,
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'full-rate-limits',
      },
    });

    const remoteTokenFileTypedRefreshAuthorized = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': remoteOperatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }, remoteTokenFileBroker.insecureTls).then((response) => response.json());
    assertHealthyTypedOpenAiRefreshEntry(remoteTokenFileTypedRefreshAuthorized.refresh[0]);

    const remoteTokenFileTypedAccount = remoteTokenFileTypedRefreshAuthorized.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const remoteTokenFileTypedProviderSummary = remoteTokenFileTypedRefreshAuthorized.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assertHealthyTypedOpenAiAccount(remoteTokenFileTypedAccount);
    assert.notEqual(remoteTokenFileTypedProviderSummary, undefined);
    assertHealthyTypedOpenAiProviderSummary(remoteTokenFileTypedProviderSummary);

    const remoteTokenFileTypedDashboard = await fetchBroker(
      `${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/dashboard`,
      {},
      remoteTokenFileBroker.insecureTls,
    ).then((response) => response.json());
    const remoteTokenFileTypedDashboardAccount = remoteTokenFileTypedDashboard.subscriptions.find((account) => account.provider === 'openai');
    const remoteTokenFileTypedDashboardProviderSummary = remoteTokenFileTypedDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assertHealthyTypedOpenAiAccount(remoteTokenFileTypedDashboardAccount);
    assert.notEqual(remoteTokenFileTypedDashboardProviderSummary, undefined);
    assertHealthyTypedOpenAiProviderSummary(remoteTokenFileTypedDashboardProviderSummary);
    assertSanitizedBrokerJson(remoteTokenFileTypedDashboard);

    const remoteTokenFileTypedState = await fetchBroker(
      `${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/state`,
      {},
      remoteTokenFileBroker.insecureTls,
    ).then((response) => response.json());
    const remoteTokenFileTypedStateAccount = remoteTokenFileTypedState.subscriptions.find((account) => account.provider === 'openai');

    assertHealthyTypedOpenAiAccount(remoteTokenFileTypedStateAccount);
    assert.equal(typeof remoteTokenFileTypedState.updatedAt, 'string');
    assert.equal('plan' in remoteTokenFileTypedState, false);
    assert.equal('providerSummaries' in remoteTokenFileTypedState, false);
    assertSanitizedBrokerJson(remoteTokenFileTypedState);
    await assertPersistedTypedOpenAiState(remoteTokenFileTypedStateDir);

    await remoteTokenFileBroker.stop();
    remoteTokenFileBroker = undefined;

    remoteTokenFileBroker = await startBroker({
      port: remoteTokenFileDegradedPort,
      host: '0.0.0.0',
      profilesDir,
      stateDir: remoteTokenFileDegradedStateDir,
      snapshotDir,
      allowRemote: true,
      protocol: 'https',
      tlsCertFile: remoteTls.certFile,
      tlsKeyFile: remoteTls.keyFile,
      extraEnv: {
        CODEX_CLI_PATH: fakeCodexPath,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify([process.execPath, codexSyncEntry]),
        SWITCHBOARD_OPERATOR_TOKEN_FILE: remoteTokenFile,
        SWITCHBOARD_FAKE_CODEX_SCENARIO: 'partial-app-server',
      },
    });

    const remoteTokenFileDegradedHealth = await fetchBroker(
      `${remoteTokenFileBroker.baseUrl}/healthz`,
      {},
      remoteTokenFileBroker.insecureTls,
    ).then((response) => response.json());
    assert.equal(remoteTokenFileDegradedHealth.localOnly, false);
    assert.equal(remoteTokenFileDegradedHealth.protocol, 'https');
    assert.equal(remoteTokenFileDegradedHealth.tlsEnabled, true);
    assert.equal(remoteTokenFileDegradedHealth.auth.remoteExposureAllowed, true);
    assert.equal(remoteTokenFileDegradedHealth.auth.operatorTokenConfigured, true);
    assert.equal(remoteTokenFileDegradedHealth.auth.operatorTokenSource, 'file');
    assert.equal(remoteTokenFileDegradedHealth.auth.operatorTokenFile, 'operator-token');
    assert.equal(remoteTokenFileDegradedHealth.auth.scopes.taskCreate.requirement, 'operator_token');
    assert.equal(remoteTokenFileDegradedHealth.auth.scopes.subscriptionRefresh.requirement, 'operator_token');
    assertSanitizedBrokerJson(remoteTokenFileDegradedHealth);

    const remoteTokenFileDegradedRefreshUnauthorized = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }, remoteTokenFileBroker.insecureTls);
    assert.equal(remoteTokenFileDegradedRefreshUnauthorized.status, 401);

    const remoteTokenFileDegradedRefreshAuthorized = await fetchBroker(`${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Switchboard-Operator-Token': remoteOperatorToken,
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }, remoteTokenFileBroker.insecureTls).then((response) => response.json());
    assert.equal(remoteTokenFileDegradedRefreshAuthorized.refresh[0].provider, 'openai');
    assert.equal(remoteTokenFileDegradedRefreshAuthorized.refresh[0].kind, 'trusted-command');
    assert.equal(remoteTokenFileDegradedRefreshAuthorized.refresh[0].degraded, true);
    assert.deepEqual(remoteTokenFileDegradedRefreshAuthorized.refresh[0].accountDisplayNames, ['Codex Supervisor (Pro)']);
    assert.deepEqual(remoteTokenFileDegradedRefreshAuthorized.refresh[0].accountSyncMethods, ['provider']);
    assert.deepEqual(remoteTokenFileDegradedRefreshAuthorized.refresh[0].syncModes, ['app-server-account']);
    assert.deepEqual(
      remoteTokenFileDegradedRefreshAuthorized.refresh[0].syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(remoteTokenFileDegradedRefreshAuthorized.refresh[0].rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(remoteTokenFileDegradedRefreshAuthorized.refresh[0].openaiAuth, ['required']);
    assert.equal(remoteTokenFileDegradedRefreshAuthorized.refresh[0].quotaCoverage, 'informational_only');
    assert.equal(remoteTokenFileDegradedRefreshAuthorized.refresh[0].quotaModels, 1);
    assert.equal(remoteTokenFileDegradedRefreshAuthorized.refresh[0].typedQuotaModels, 0);

    const remoteTokenFileDegradedAccount = remoteTokenFileDegradedRefreshAuthorized.dashboard.subscriptions.find((account) => account.provider === 'openai');
    const remoteTokenFileDegradedProviderSummary = remoteTokenFileDegradedRefreshAuthorized.dashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(remoteTokenFileDegradedAccount, undefined);
    assert.notEqual(remoteTokenFileDegradedProviderSummary, undefined);
    assert.equal(remoteTokenFileDegradedAccount.syncMethod, 'provider');
    assert.deepEqual(remoteTokenFileDegradedAccount.signals, [
      { id: 'source', label: 'source', value: 'app-server account' },
      { id: 'plan', label: 'plan', value: 'Pro' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
      { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
      { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
    ]);
    assert.equal(remoteTokenFileDegradedAccount.quotas.length, 1);
    assert.equal(remoteTokenFileDegradedAccount.quotas[0].modelId, 'codex');
    assert.equal(remoteTokenFileDegradedAccount.quotas[0].interpretation, 'informational');
    assert.equal(remoteTokenFileDegradedAccount.quotas[0].windows, undefined);
    assert.equal(remoteTokenFileDegradedProviderSummary.degraded, true);
    assert.deepEqual(remoteTokenFileDegradedProviderSummary.syncModes, ['app-server-account']);
    assert.deepEqual(
      remoteTokenFileDegradedProviderSummary.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(remoteTokenFileDegradedProviderSummary.rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(remoteTokenFileDegradedProviderSummary.openaiAuth, ['required']);
    assert.equal(remoteTokenFileDegradedProviderSummary.quotaCoverage, 'informational_only');
    assert.equal(remoteTokenFileDegradedProviderSummary.quotaModels, 1);
    assert.equal(remoteTokenFileDegradedProviderSummary.typedQuotaModels, 0);

    const remoteTokenFileDegradedDashboard = await fetchBroker(
      `${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/dashboard`,
      {},
      remoteTokenFileBroker.insecureTls,
    ).then((response) => response.json());
    const remoteTokenFileDegradedDashboardAccount = remoteTokenFileDegradedDashboard.subscriptions.find((account) => account.provider === 'openai');
    const remoteTokenFileDegradedDashboardProviderSummary = remoteTokenFileDegradedDashboard.providerSummaries.find((entry) => entry.provider === 'openai');

    assert.notEqual(remoteTokenFileDegradedDashboardAccount, undefined);
    assert.notEqual(remoteTokenFileDegradedDashboardProviderSummary, undefined);
    assert.equal(remoteTokenFileDegradedDashboardAccount.syncMethod, 'provider');
    assert.deepEqual(remoteTokenFileDegradedDashboardAccount.signals, remoteTokenFileDegradedAccount.signals);
    assert.equal(remoteTokenFileDegradedDashboardAccount.quotas.length, 1);
    assert.equal(remoteTokenFileDegradedDashboardAccount.quotas[0].modelId, 'codex');
    assert.equal(remoteTokenFileDegradedDashboardAccount.quotas[0].interpretation, 'informational');
    assert.equal(remoteTokenFileDegradedDashboardAccount.quotas[0].windows, undefined);
    assert.equal(remoteTokenFileDegradedDashboardProviderSummary.degraded, true);
    assert.deepEqual(remoteTokenFileDegradedDashboardProviderSummary.syncModes, ['app-server-account']);
    assert.deepEqual(
      remoteTokenFileDegradedDashboardProviderSummary.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.deepEqual(remoteTokenFileDegradedDashboardProviderSummary.rateLimitHosts, ['chatgpt.com']);
    assert.deepEqual(remoteTokenFileDegradedDashboardProviderSummary.openaiAuth, ['required']);
    assert.equal(remoteTokenFileDegradedDashboardProviderSummary.quotaCoverage, 'informational_only');
    assert.equal(remoteTokenFileDegradedDashboardProviderSummary.quotaModels, 1);
    assert.equal(remoteTokenFileDegradedDashboardProviderSummary.typedQuotaModels, 0);
    assertSanitizedBrokerJson(remoteTokenFileDegradedDashboard);

    const remoteTokenFileDegradedState = await fetchBroker(
      `${remoteTokenFileBroker.baseUrl}/v1/projects/threatpedia/state`,
      {},
      remoteTokenFileBroker.insecureTls,
    ).then((response) => response.json());
    const remoteTokenFileDegradedStateAccount = remoteTokenFileDegradedState.subscriptions.find((account) => account.provider === 'openai');

    assert.notEqual(remoteTokenFileDegradedStateAccount, undefined);
    assert.equal(remoteTokenFileDegradedStateAccount.syncMethod, 'provider');
    assert.deepEqual(remoteTokenFileDegradedStateAccount.signals, remoteTokenFileDegradedAccount.signals);
    assert.equal(remoteTokenFileDegradedStateAccount.quotas.length, 1);
    assert.equal(remoteTokenFileDegradedStateAccount.quotas[0].modelId, 'codex');
    assert.equal(remoteTokenFileDegradedStateAccount.quotas[0].interpretation, 'informational');
    assert.equal(remoteTokenFileDegradedStateAccount.quotas[0].windows, undefined);
    assert.equal(typeof remoteTokenFileDegradedState.updatedAt, 'string');
    assert.equal('plan' in remoteTokenFileDegradedState, false);
    assert.equal('providerSummaries' in remoteTokenFileDegradedState, false);
    assertSanitizedBrokerJson(remoteTokenFileDegradedState);
    await assertPersistedDegradedOpenAiState(remoteTokenFileDegradedStateDir);

    await remoteTokenFileBroker.stop();
    remoteTokenFileBroker = undefined;

    remoteBroker = await startBroker({
      port: remotePort,
      host: '0.0.0.0',
      profilesDir,
      stateDir: remoteStateDir,
      snapshotDir,
      allowRemote: true,
      protocol: 'https',
      tlsCertFile: remoteTls.certFile,
      tlsKeyFile: remoteTls.keyFile,
    });

    const remoteHealth = await fetchBroker(`${remoteBroker.baseUrl}/healthz`, {}, remoteBroker.insecureTls).then((response) => response.json());
    assert.equal(remoteHealth.localOnly, false);
    assert.equal(remoteHealth.protocol, 'https');
    assert.equal(remoteHealth.tlsEnabled, true);
    assert.equal(remoteHealth.auth.remoteExposureAllowed, true);
    assert.equal(remoteHealth.auth.operatorTokenConfigured, false);
    assert.equal(remoteHealth.auth.scopes.taskCreate.requirement, 'disabled');
    assert.equal(remoteHealth.auth.scopes.subscriptionRefresh.requirement, 'disabled');
    assertSanitizedBrokerJson(remoteHealth);

    const remoteCreate = await fetchBroker(`${remoteBroker.baseUrl}/v1/projects/threatpedia/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Remote task',
        description: 'This should be rejected without a remote operator token policy.',
        priority: 'p1',
        role: 'kernel-proxy',
      }),
    }, remoteBroker.insecureTls);
    assert.equal(remoteCreate.status, 403);

    const remoteRefresh = await fetchBroker(`${remoteBroker.baseUrl}/v1/projects/threatpedia/subscriptions/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
      }),
    }, remoteBroker.insecureTls);
    assert.equal(remoteRefresh.status, 403);

    console.log('Broker smoke test passed.');
  } finally {
    if (localBroker) {
      await localBroker.stop();
    }

    if (localTokenFileBroker) {
      await localTokenFileBroker.stop();
    }

    if (degradedBroker) {
      await degradedBroker.stop();
    }

    if (insecureDefaultTokenBroker) {
      await insecureDefaultTokenBroker.stop();
    }

    if (remoteTokenFileBroker) {
      await remoteTokenFileBroker.stop();
    }

    if (remoteBroker) {
      await remoteBroker.stop();
    }

    await remoteTls.cleanup();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Broker smoke test failed: ${message}`);
  process.exitCode = 1;
});
