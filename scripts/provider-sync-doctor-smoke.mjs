import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const doctorEntry = path.join(repoRoot, 'scripts/provider-sync-doctor.mjs');

async function runDoctor(args, envOverrides = {}, json = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, json ? [doctorEntry, ...args, '--json'] : [doctorEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
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

function openaiPayload(syncSource, extraSignals = [], quotas = [
  {
    modelId: 'codex',
    displayName: 'Codex',
    availability: 'available',
    authMode: 'subscription',
    usageUnit: 'credits',
    source: 'cli',
    confidence: 'high',
    remaining: 90,
    interpretation: 'percentage_window',
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
    interpretation: 'percentage_window',
  },
]) {
  return {
    provider: 'openai',
    accounts: [
      {
        id: 'openai-codex-chatgpt',
        displayName: 'Codex Supervisor (Pro)',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T03:45:00.000Z',
        signals: [
          { id: 'source', label: 'source', value: syncSource },
          { id: 'plan', label: 'plan', value: 'Pro' },
          ...extraSignals,
        ],
        quotas,
      },
    ],
  };
}

function anthropicPayload() {
  return {
    provider: 'anthropic',
    accounts: [
      {
        id: 'anthropic-main',
        displayName: 'Claude Code',
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-22T03:45:00.000Z',
        quotas: [
          {
            modelId: 'claude-code',
            displayName: 'Claude Code',
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'credits',
            source: 'manual',
            confidence: 'high',
            remaining: 88,
            interpretation: 'absolute',
          },
        ],
      },
    ],
  };
}

const openaiAuthRequiredSignal = {
  id: 'openai_auth',
  label: 'openai-auth',
  value: 'required',
};

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-provider-sync-doctor-smoke-'));
  const snapshotDir = path.join(tempRoot, 'provider-snapshots');
  const fakeWrapperPath = path.join(tempRoot, 'fake-openai-sync.mjs');

  await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
  await writeFile(
    fakeWrapperPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_PROVIDER_SYNC_SCENARIO ?? 'full-rate-limits';

if (scenario === 'command-failed') {
  process.stderr.write('simulated trusted command failure\\n');
  process.exit(9);
}

const payloads = {
  'full-rate-limits': ${JSON.stringify(openaiPayload('app-server rate-limits', [openaiAuthRequiredSignal]))},
  'mixed-rate-limits': ${JSON.stringify(
    openaiPayload('app-server rate-limits', [openaiAuthRequiredSignal], [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'credits',
        source: 'cli',
        confidence: 'high',
        remaining: 90,
        interpretation: 'percentage_window',
      },
      {
        modelId: 'codex_bengalfox',
        displayName: 'GPT-5.3-Codex-Spark',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'unknown',
        source: 'cli',
        confidence: 'medium',
        interpretation: 'informational',
        notes: 'Informational only: usage endpoint unavailable for this model window',
      },
    ]),
  )},
  'partial-app-server': ${JSON.stringify(
    openaiPayload('app-server account', [
      { id: 'rate_limits', label: 'rate-limits', value: 'usage endpoint unavailable' },
      { id: 'rate_limits_host', label: 'rate-limits-host', value: 'chatgpt.com' },
      { id: 'openai_auth', label: 'openai-auth', value: 'required' },
    ], [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'unknown',
        source: 'cli',
        confidence: 'medium',
        interpretation: 'informational',
        notes: 'Informational only: usage endpoint unavailable via chatgpt.com',
      },
    ]),
  )},
};

process.stdout.write(JSON.stringify(payloads[scenario] ?? payloads['full-rate-limits']));
`,
    { mode: 0o700 },
  );

  try {
    const inferredLocalOpenai = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'full-rate-limits',
      },
      true,
    );
    assert.equal(inferredLocalOpenai.code, 0);
    const inferredLocalOpenaiPayload = JSON.parse(inferredLocalOpenai.stdout);
    assert.equal(inferredLocalOpenaiPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(inferredLocalOpenaiPayload.verdict, 'ready');
    assert.deepEqual(inferredLocalOpenaiPayload.failureCodes, []);
    assert.deepEqual(inferredLocalOpenaiPayload.advisoryCodes, []);
    assert.deepEqual(inferredLocalOpenaiPayload.blockedProviders, []);
    assert.deepEqual(inferredLocalOpenaiPayload.attentionProviders, []);
    assert.deepEqual(inferredLocalOpenaiPayload.readyProviders, ['openai']);
    assert.deepEqual(inferredLocalOpenaiPayload.providerStates, { openai: 'trusted_command_succeeded' });
    assert.deepEqual(inferredLocalOpenaiPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(inferredLocalOpenaiPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerConfigured, { openai: true });
    assert.deepEqual(inferredLocalOpenaiPayload.providerSecure, { openai: true });
    assert.deepEqual(inferredLocalOpenaiPayload.providerAccountCounts, { openai: 1 });
    assert.match(inferredLocalOpenaiPayload.providerRefreshedAt.openai ?? '', /^2026-/);
    assert.deepEqual(inferredLocalOpenaiPayload.providerCodes, { openai: [] });
    assert.deepEqual(inferredLocalOpenaiPayload.providerQuotaCoverage, { openai: 'typed' });
    assert.deepEqual(inferredLocalOpenaiPayload.providerQuotaModelCounts, { openai: 2 });
    assert.deepEqual(inferredLocalOpenaiPayload.providerTypedQuotaModelCounts, { openai: 2 });
    assert.deepEqual(inferredLocalOpenaiPayload.providerMessages, {
      openai: 'app-server rate-limits available',
    });
    assert.equal(inferredLocalOpenaiPayload.message, 'app-server rate-limits available');
    assert.deepEqual(inferredLocalOpenaiPayload.providerAccountSyncMethods, {
      openai: ['provider'],
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerSyncModes, {
      openai: ['app-server-rate-limits'],
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerSyncBadges, {
      openai: [],
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerRateLimitHosts, {
      openai: [],
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerOpenaiAuth, {
      openai: ['required'],
    });
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.provider, 'openai');
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(
      inferredLocalOpenaiPayload.providers[0]?.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.configured, true);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.secure, true);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.accountCount, 1);
    assert.match(inferredLocalOpenaiPayload.providers[0]?.refreshedAt ?? '', /^2026-/);
    assert.deepEqual(inferredLocalOpenaiPayload.providers[0]?.syncMethods, ['provider']);

    const inferredLocalOpenaiText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'full-rate-limits',
      },
      false,
    );
    assert.equal(inferredLocalOpenaiText.code, 0);
    assert.match(inferredLocalOpenaiText.stdout, /Provider sync:/);
    assert.match(inferredLocalOpenaiText.stdout, /verdict: ready/);
    assert.match(inferredLocalOpenaiText.stdout, /message: app-server rate-limits available/);
    assert.match(
      inferredLocalOpenaiText.stdout,
      /openai: app-server rate-limits available \(trusted-command\)/,
    );
    assert.match(inferredLocalOpenaiText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(inferredLocalOpenaiText.stdout, /configured: yes/);
    assert.match(inferredLocalOpenaiText.stdout, /secure: yes/);
    assert.match(inferredLocalOpenaiText.stdout, /state: trusted_command_succeeded/);
    assert.match(inferredLocalOpenaiText.stdout, /accounts: 1/);
    assert.match(inferredLocalOpenaiText.stdout, /refreshedAt: 2026-/);
    assert.match(inferredLocalOpenaiText.stdout, /syncMethods: provider/);
    assert.match(inferredLocalOpenaiText.stdout, /syncModes: app-server-rate-limits/);
    assert.match(inferredLocalOpenaiText.stdout, /openaiAuth: required/);
    assert.doesNotMatch(inferredLocalOpenaiText.stdout, /rateLimitHosts:/);
    assert.doesNotMatch(inferredLocalOpenaiText.stdout, /syncBadges:/);
    assert.match(inferredLocalOpenaiText.stdout, /quotaCoverage: typed/);
    assert.match(inferredLocalOpenaiText.stdout, /typedQuotaModels: 2\/2/);

    await writeFile(path.join(snapshotDir, 'anthropic.json'), `${JSON.stringify(anthropicPayload(), null, 2)}\n`, {
      mode: 0o600,
    });

    const openaiReady = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'full-rate-limits',
      },
      true,
    );
    assert.equal(openaiReady.code, 0);
    const openaiReadyPayload = JSON.parse(openaiReady.stdout);
    assert.equal(openaiReadyPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(openaiReadyPayload.verdict, 'ready');
    assert.deepEqual(openaiReadyPayload.failureCodes, []);
    assert.deepEqual(openaiReadyPayload.advisoryCodes, []);
    assert.deepEqual(openaiReadyPayload.blockedProviders, []);
    assert.deepEqual(openaiReadyPayload.attentionProviders, []);
    assert.deepEqual(openaiReadyPayload.readyProviders, ['openai']);
    assert.deepEqual(openaiReadyPayload.providerStates, { openai: 'trusted_command_succeeded' });
    assert.deepEqual(openaiReadyPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(openaiReadyPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(openaiReadyPayload.providerConfigured, { openai: true });
    assert.deepEqual(openaiReadyPayload.providerSecure, { openai: true });
    assert.deepEqual(openaiReadyPayload.providerAccountCounts, { openai: 1 });
    assert.deepEqual(openaiReadyPayload.providerQuotaCoverage, { openai: 'typed' });
    assert.deepEqual(openaiReadyPayload.providerQuotaModelCounts, { openai: 2 });
    assert.deepEqual(openaiReadyPayload.providerTypedQuotaModelCounts, { openai: 2 });
    assert.match(openaiReadyPayload.providerRefreshedAt.openai ?? '', /^2026-/);
    assert.deepEqual(openaiReadyPayload.providerCodes, { openai: [] });
    assert.deepEqual(openaiReadyPayload.providerMessages, { openai: 'app-server rate-limits available' });
    assert.equal(openaiReadyPayload.message, 'app-server rate-limits available');
    assert.deepEqual(openaiReadyPayload.providerAccountSyncMethods, { openai: ['provider'] });
    assert.deepEqual(openaiReadyPayload.providerSyncModes, { openai: ['app-server-rate-limits'] });
    assert.deepEqual(openaiReadyPayload.providerSyncBadges, { openai: [] });
    assert.deepEqual(openaiReadyPayload.providerRateLimitHosts, { openai: [] });
    assert.deepEqual(openaiReadyPayload.providerOpenaiAuth, { openai: ['required'] });
    assert.equal(openaiReadyPayload.providers[0]?.provider, 'openai');
    assert.equal(openaiReadyPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(
      openaiReadyPayload.providers[0]?.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(openaiReadyPayload.providers[0]?.configured, true);
    assert.equal(openaiReadyPayload.providers[0]?.secure, true);
    assert.equal(openaiReadyPayload.providers[0]?.accountCount, 1);
    assert.match(openaiReadyPayload.providers[0]?.refreshedAt ?? '', /^2026-/);
    assert.deepEqual(openaiReadyPayload.providers[0]?.syncMethods, ['provider']);
    assert.equal(openaiReadyPayload.providers[0]?.state, 'trusted_command_succeeded');
    assert.equal(openaiReadyPayload.providers[0]?.degraded, false);
    assert.equal(openaiReadyPayload.providers[0]?.quotaCoverage, 'typed');
    assert.equal(openaiReadyPayload.providers[0]?.quotaModelCount, 2);
    assert.equal(openaiReadyPayload.providers[0]?.typedQuotaModelCount, 2);
    assert.deepEqual(openaiReadyPayload.providers[0]?.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(openaiReadyPayload.providers[0]?.syncBadges, []);
    assert.deepEqual(openaiReadyPayload.providers[0]?.rateLimitHosts, []);
    assert.deepEqual(openaiReadyPayload.providers[0]?.openaiAuth, ['required']);

    const openaiReadyText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'full-rate-limits',
      },
      false,
    );
    assert.equal(openaiReadyText.code, 0);
    assert.match(openaiReadyText.stdout, /Provider sync:/);
    assert.match(openaiReadyText.stdout, /verdict: ready/);
    assert.match(openaiReadyText.stdout, /message: app-server rate-limits available/);
    assert.match(
      openaiReadyText.stdout,
      /openai: app-server rate-limits available \(trusted-command\)/,
    );
    assert.match(openaiReadyText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(openaiReadyText.stdout, /configured: yes/);
    assert.match(openaiReadyText.stdout, /secure: yes/);
    assert.match(openaiReadyText.stdout, /state: trusted_command_succeeded/);
    assert.match(openaiReadyText.stdout, /accounts: 1/);
    assert.match(openaiReadyText.stdout, /refreshedAt: 2026-/);
    assert.match(openaiReadyText.stdout, /syncMethods: provider/);
    assert.match(openaiReadyText.stdout, /syncModes: app-server-rate-limits/);
    assert.match(openaiReadyText.stdout, /openaiAuth: required/);
    assert.doesNotMatch(openaiReadyText.stdout, /rateLimitHosts:/);
    assert.doesNotMatch(openaiReadyText.stdout, /syncBadges:/);
    assert.match(openaiReadyText.stdout, /quotaCoverage: typed/);
    assert.match(openaiReadyText.stdout, /typedQuotaModels: 2\/2/);

    const openaiMixed = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-rate-limits',
      },
      true,
    );
    assert.equal(openaiMixed.code, 0);
    const openaiMixedPayload = JSON.parse(openaiMixed.stdout);
    assert.equal(openaiMixedPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(openaiMixedPayload.verdict, 'ready');
    assert.deepEqual(openaiMixedPayload.failureCodes, []);
    assert.deepEqual(openaiMixedPayload.advisoryCodes, []);
    assert.deepEqual(openaiMixedPayload.blockedProviders, []);
    assert.deepEqual(openaiMixedPayload.attentionProviders, []);
    assert.deepEqual(openaiMixedPayload.readyProviders, ['openai']);
    assert.deepEqual(openaiMixedPayload.providerStates, { openai: 'trusted_command_succeeded' });
    assert.deepEqual(openaiMixedPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(openaiMixedPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(openaiMixedPayload.providerConfigured, { openai: true });
    assert.deepEqual(openaiMixedPayload.providerSecure, { openai: true });
    assert.deepEqual(openaiMixedPayload.providerAccountCounts, { openai: 1 });
    assert.match(openaiMixedPayload.providerRefreshedAt.openai ?? '', /^2026-/);
    assert.deepEqual(openaiMixedPayload.providerCodes, { openai: [] });
    assert.deepEqual(openaiMixedPayload.providerQuotaCoverage, { openai: 'mixed' });
    assert.deepEqual(openaiMixedPayload.providerQuotaModelCounts, { openai: 2 });
    assert.deepEqual(openaiMixedPayload.providerTypedQuotaModelCounts, { openai: 1 });
    assert.deepEqual(openaiMixedPayload.providerMessages, {
      openai: 'app-server rate-limits available',
    });
    assert.equal(openaiMixedPayload.message, 'app-server rate-limits available [quota mixed, typed 1/2]');
    assert.deepEqual(openaiMixedPayload.providerAccountSyncMethods, {
      openai: ['provider'],
    });
    assert.deepEqual(openaiMixedPayload.providerSyncModes, {
      openai: ['app-server-rate-limits'],
    });
    assert.deepEqual(openaiMixedPayload.providerSyncBadges, {
      openai: [],
    });
    assert.deepEqual(openaiMixedPayload.providerRateLimitHosts, {
      openai: [],
    });
    assert.deepEqual(openaiMixedPayload.providerOpenaiAuth, {
      openai: ['required'],
    });
    assert.equal(openaiMixedPayload.providers[0]?.provider, 'openai');
    assert.equal(openaiMixedPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(
      openaiMixedPayload.providers[0]?.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(openaiMixedPayload.providers[0]?.configured, true);
    assert.equal(openaiMixedPayload.providers[0]?.secure, true);
    assert.equal(openaiMixedPayload.providers[0]?.accountCount, 1);
    assert.match(openaiMixedPayload.providers[0]?.refreshedAt ?? '', /^2026-/);
    assert.deepEqual(openaiMixedPayload.providers[0]?.syncMethods, ['provider']);
    assert.equal(openaiMixedPayload.providers[0]?.state, 'trusted_command_succeeded');
    assert.equal(openaiMixedPayload.providers[0]?.degraded, false);
    assert.equal(openaiMixedPayload.providers[0]?.quotaCoverage, 'mixed');
    assert.equal(openaiMixedPayload.providers[0]?.quotaModelCount, 2);
    assert.equal(openaiMixedPayload.providers[0]?.typedQuotaModelCount, 1);
    assert.deepEqual(openaiMixedPayload.providers[0]?.syncModes, ['app-server-rate-limits']);
    assert.deepEqual(openaiMixedPayload.providers[0]?.syncBadges, []);
    assert.deepEqual(openaiMixedPayload.providers[0]?.rateLimitHosts, []);
    assert.deepEqual(openaiMixedPayload.providers[0]?.openaiAuth, ['required']);

    const openaiMixedText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'mixed-rate-limits',
      },
      false,
    );
    assert.equal(openaiMixedText.code, 0);
    assert.match(openaiMixedText.stdout, /message: app-server rate-limits available \[quota mixed, typed 1\/2\]/);
    assert.match(
      openaiMixedText.stdout,
      /openai: app-server rate-limits available \(trusted-command\)/,
    );
    assert.match(openaiMixedText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(openaiMixedText.stdout, /configured: yes/);
    assert.match(openaiMixedText.stdout, /secure: yes/);
    assert.match(openaiMixedText.stdout, /state: trusted_command_succeeded/);
    assert.match(openaiMixedText.stdout, /accounts: 1/);
    assert.match(openaiMixedText.stdout, /refreshedAt: 2026-/);
    assert.match(openaiMixedText.stdout, /syncMethods: provider/);
    assert.match(openaiMixedText.stdout, /syncModes: app-server-rate-limits/);
    assert.match(openaiMixedText.stdout, /openaiAuth: required/);
    assert.doesNotMatch(openaiMixedText.stdout, /rateLimitHosts:/);
    assert.doesNotMatch(openaiMixedText.stdout, /syncBadges:/);
    assert.match(openaiMixedText.stdout, /quotaCoverage: mixed/);
    assert.match(openaiMixedText.stdout, /typedQuotaModels: 1\/2/);

    const mixedAttention = await runDoctor(
      ['openai', 'anthropic'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'partial-app-server',
      },
      true,
    );
    assert.equal(mixedAttention.code, 0);
    const mixedAttentionPayload = JSON.parse(mixedAttention.stdout);
    assert.equal(mixedAttentionPayload.verdict, 'attention_required');
    assert.deepEqual(mixedAttentionPayload.failureCodes, []);
    assert.deepEqual(mixedAttentionPayload.advisoryCodes, ['provider_sync_degraded', 'provider_snapshot_only']);
    assert.deepEqual(mixedAttentionPayload.blockedProviders, []);
    assert.deepEqual(mixedAttentionPayload.attentionProviders, ['openai']);
    assert.deepEqual(mixedAttentionPayload.readyProviders, ['anthropic']);
    assert.deepEqual(mixedAttentionPayload.providerStates, {
      openai: 'trusted_command_degraded',
      anthropic: 'snapshot_succeeded',
    });
    assert.deepEqual(mixedAttentionPayload.providerKinds, {
      openai: 'trusted-command',
      anthropic: 'snapshot',
    });
    assert.deepEqual(mixedAttentionPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
      anthropic: 'anthropic.json',
    });
    assert.deepEqual(mixedAttentionPayload.providerConfigured, {
      openai: true,
      anthropic: true,
    });
    assert.deepEqual(mixedAttentionPayload.providerSecure, {
      openai: true,
      anthropic: true,
    });
    assert.deepEqual(mixedAttentionPayload.providerAccountCounts, {
      openai: 1,
      anthropic: 1,
    });
    assert.deepEqual(mixedAttentionPayload.providerQuotaCoverage, {
      openai: 'informational_only',
      anthropic: 'typed',
    });
    assert.deepEqual(mixedAttentionPayload.providerQuotaModelCounts, {
      openai: 1,
      anthropic: 1,
    });
    assert.deepEqual(mixedAttentionPayload.providerTypedQuotaModelCounts, {
      openai: 0,
      anthropic: 1,
    });
    assert.match(mixedAttentionPayload.providerRefreshedAt.openai ?? '', /^2026-/);
    assert.match(mixedAttentionPayload.providerRefreshedAt.anthropic ?? '', /^2026-/);
    assert.deepEqual(mixedAttentionPayload.providerCodes, {
      openai: ['provider_sync_degraded'],
      anthropic: ['provider_snapshot_only'],
    });
    assert.deepEqual(mixedAttentionPayload.providerMessages, {
      openai: 'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory)',
      anthropic: 'snapshot-backed refresh (advisory)',
    });
    assert.equal(
      mixedAttentionPayload.message,
      'partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required (advisory) [quota informational_only, typed 0/1]',
    );
    assert.deepEqual(mixedAttentionPayload.providerAccountSyncMethods, {
      openai: ['provider'],
      anthropic: ['snapshot'],
    });
    assert.deepEqual(mixedAttentionPayload.providerSyncModes, {
      openai: ['app-server-account'],
      anthropic: [],
    });
    assert.deepEqual(mixedAttentionPayload.providerSyncBadges, {
      openai: ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
      anthropic: [],
    });
    assert.deepEqual(mixedAttentionPayload.providerRateLimitHosts, {
      openai: ['chatgpt.com'],
      anthropic: [],
    });
    assert.deepEqual(mixedAttentionPayload.providerOpenaiAuth, {
      openai: ['required'],
      anthropic: [],
    });
    assert.equal(mixedAttentionPayload.providers.find((item) => item.provider === 'openai')?.state, 'trusted_command_degraded');
    assert.equal(mixedAttentionPayload.providers.find((item) => item.provider === 'openai')?.quotaCoverage, 'informational_only');
    assert.equal(mixedAttentionPayload.providers.find((item) => item.provider === 'openai')?.quotaModelCount, 1);
    assert.equal(mixedAttentionPayload.providers.find((item) => item.provider === 'openai')?.typedQuotaModelCount, 0);
    assert.deepEqual(
      mixedAttentionPayload.providers.find((item) => item.provider === 'openai')?.syncModes,
      ['app-server-account'],
    );
    assert.deepEqual(
      mixedAttentionPayload.providers.find((item) => item.provider === 'openai')?.syncBadges,
      ['partial app-server context: usage endpoint unavailable via chatgpt.com; OpenAI auth required'],
    );
    assert.equal(mixedAttentionPayload.providers.find((item) => item.provider === 'anthropic')?.state, 'snapshot_succeeded');

    const mixedAttentionText = await runDoctor(
      ['openai', 'anthropic'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'partial-app-server',
      },
      false,
    );
    assert.equal(mixedAttentionText.code, 0);
    assert.match(
      mixedAttentionText.stdout,
      /message: partial app-server context: usage endpoint unavailable via chatgpt\.com; OpenAI auth required \(advisory\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(
      mixedAttentionText.stdout,
      /openai: partial app-server context: usage endpoint unavailable via chatgpt\.com; OpenAI auth required \(advisory\) \(trusted-command\)/,
    );
    assert.match(mixedAttentionText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(mixedAttentionText.stdout, /configured: yes/);
    assert.match(mixedAttentionText.stdout, /secure: yes/);
    assert.match(mixedAttentionText.stdout, /state: trusted_command_degraded/);
    assert.match(mixedAttentionText.stdout, /accounts: 1/);
    assert.match(mixedAttentionText.stdout, /refreshedAt: 2026-/);
    assert.match(mixedAttentionText.stdout, /syncMethods: provider/);
    assert.match(mixedAttentionText.stdout, /syncModes: app-server-account/);
    assert.match(
      mixedAttentionText.stdout,
      /syncBadges: partial app-server context: usage endpoint unavailable via chatgpt\.com; OpenAI auth required/,
    );
    assert.match(mixedAttentionText.stdout, /rateLimitHosts: chatgpt\.com/);
    assert.match(mixedAttentionText.stdout, /openaiAuth: required/);
    assert.match(mixedAttentionText.stdout, /quotaCoverage: informational_only/);
    assert.match(mixedAttentionText.stdout, /typedQuotaModels: 0\/1/);
    assert.match(mixedAttentionText.stdout, /anthropic: snapshot-backed refresh \(advisory\) \(snapshot\)/);
    assert.match(mixedAttentionText.stdout, /syncMethods: snapshot/);
    assert.match(mixedAttentionText.stdout, /typedQuotaModels: 1\/1/);

    const anthropicSnapshot = await runDoctor(
      ['anthropic'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
      },
      true,
    );
    assert.equal(anthropicSnapshot.code, 0);
    const anthropicSnapshotPayload = JSON.parse(anthropicSnapshot.stdout);
    assert.equal(anthropicSnapshotPayload.verdict, 'ready');
    assert.deepEqual(anthropicSnapshotPayload.failureCodes, []);
    assert.deepEqual(anthropicSnapshotPayload.advisoryCodes, ['provider_snapshot_only']);
    assert.deepEqual(anthropicSnapshotPayload.blockedProviders, []);
    assert.deepEqual(anthropicSnapshotPayload.attentionProviders, []);
    assert.deepEqual(anthropicSnapshotPayload.readyProviders, ['anthropic']);
    assert.deepEqual(anthropicSnapshotPayload.providerStates, { anthropic: 'snapshot_succeeded' });
    assert.deepEqual(anthropicSnapshotPayload.providerKinds, { anthropic: 'snapshot' });
    assert.deepEqual(anthropicSnapshotPayload.providerSources, { anthropic: 'anthropic.json' });
    assert.deepEqual(anthropicSnapshotPayload.providerConfigured, { anthropic: true });
    assert.deepEqual(anthropicSnapshotPayload.providerSecure, { anthropic: true });
    assert.deepEqual(anthropicSnapshotPayload.providerAccountCounts, { anthropic: 1 });
    assert.deepEqual(anthropicSnapshotPayload.providerQuotaCoverage, { anthropic: 'typed' });
    assert.deepEqual(anthropicSnapshotPayload.providerQuotaModelCounts, { anthropic: 1 });
    assert.deepEqual(anthropicSnapshotPayload.providerTypedQuotaModelCounts, { anthropic: 1 });
    assert.match(anthropicSnapshotPayload.providerRefreshedAt.anthropic ?? '', /^2026-/);
    assert.deepEqual(anthropicSnapshotPayload.providerCodes, { anthropic: ['provider_snapshot_only'] });
    assert.deepEqual(anthropicSnapshotPayload.providerMessages, { anthropic: 'snapshot-backed refresh (advisory)' });
    assert.equal(anthropicSnapshotPayload.message, 'snapshot-backed refresh (advisory)');
    assert.deepEqual(anthropicSnapshotPayload.providerAccountSyncMethods, { anthropic: ['snapshot'] });
    assert.deepEqual(anthropicSnapshotPayload.providerSyncModes, { anthropic: [] });
    assert.deepEqual(anthropicSnapshotPayload.providerSyncBadges, { anthropic: [] });
    assert.deepEqual(anthropicSnapshotPayload.providerRateLimitHosts, { anthropic: [] });
    assert.deepEqual(anthropicSnapshotPayload.providerOpenaiAuth, { anthropic: [] });
    assert.equal(anthropicSnapshotPayload.providers[0]?.state, 'snapshot_succeeded');

    const anthropicSnapshotText = await runDoctor(
      ['anthropic'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
      },
      false,
    );
    assert.equal(anthropicSnapshotText.code, 0);
    assert.match(anthropicSnapshotText.stdout, /message: snapshot-backed refresh \(advisory\)/);
    assert.match(anthropicSnapshotText.stdout, /anthropic: snapshot-backed refresh \(advisory\) \(snapshot\)/);
    assert.match(anthropicSnapshotText.stdout, /source: anthropic\.json/);
    assert.match(anthropicSnapshotText.stdout, /configured: yes/);
    assert.match(anthropicSnapshotText.stdout, /secure: yes/);
    assert.match(anthropicSnapshotText.stdout, /accounts: 1/);
    assert.match(anthropicSnapshotText.stdout, /refreshedAt: 2026-/);
    assert.match(anthropicSnapshotText.stdout, /syncMethods: snapshot/);
    assert.match(anthropicSnapshotText.stdout, /quotaCoverage: typed/);
    assert.match(anthropicSnapshotText.stdout, /typedQuotaModels: 1\/1/);

    const invalidOpenaiCommandMessage =
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].';
    const blockedInvalidConfig = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":true}',
      },
      true,
    );
    assert.equal(blockedInvalidConfig.code, 0);
    const blockedInvalidConfigPayload = JSON.parse(blockedInvalidConfig.stdout);
    assert.equal(blockedInvalidConfigPayload.verdict, 'blocked');
    assert.deepEqual(blockedInvalidConfigPayload.failureCodes, ['provider_command_invalid']);
    assert.deepEqual(blockedInvalidConfigPayload.advisoryCodes, []);
    assert.deepEqual(blockedInvalidConfigPayload.blockedProviders, ['openai']);
    assert.deepEqual(blockedInvalidConfigPayload.attentionProviders, []);
    assert.deepEqual(blockedInvalidConfigPayload.readyProviders, []);
    assert.deepEqual(blockedInvalidConfigPayload.providerStates, { openai: 'command_invalid' });
    assert.deepEqual(blockedInvalidConfigPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(blockedInvalidConfigPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON',
    });
    assert.deepEqual(blockedInvalidConfigPayload.providerConfigured, { openai: false });
    assert.deepEqual(blockedInvalidConfigPayload.providerSecure, { openai: false });
    assert.deepEqual(blockedInvalidConfigPayload.providerAccountCounts, { openai: null });
    assert.deepEqual(blockedInvalidConfigPayload.providerRefreshedAt, { openai: null });
    assert.deepEqual(blockedInvalidConfigPayload.providerCodes, { openai: ['provider_command_invalid'] });
    assert.deepEqual(blockedInvalidConfigPayload.providerMessages, { openai: invalidOpenaiCommandMessage });
    assert.deepEqual(blockedInvalidConfigPayload.providerAccountSyncMethods, { openai: [] });
    assert.deepEqual(blockedInvalidConfigPayload.providerSyncModes, { openai: [] });
    assert.deepEqual(blockedInvalidConfigPayload.providerSyncBadges, { openai: [] });
    assert.deepEqual(blockedInvalidConfigPayload.providerRateLimitHosts, { openai: [] });
    assert.deepEqual(blockedInvalidConfigPayload.providerOpenaiAuth, { openai: [] });
    assert.deepEqual(blockedInvalidConfigPayload.providerQuotaCoverage, { openai: 'none' });
    assert.deepEqual(blockedInvalidConfigPayload.providerQuotaModelCounts, { openai: 0 });
    assert.deepEqual(blockedInvalidConfigPayload.providerTypedQuotaModelCounts, { openai: 0 });
    assert.equal(blockedInvalidConfigPayload.message, invalidOpenaiCommandMessage);
    assert.equal(blockedInvalidConfigPayload.stateCounts.command_invalid, 1);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.provider, 'openai');
    assert.equal(blockedInvalidConfigPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(blockedInvalidConfigPayload.providers[0]?.state, 'command_invalid');
    assert.equal(blockedInvalidConfigPayload.providers[0]?.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON');
    assert.equal(blockedInvalidConfigPayload.providers[0]?.configured, false);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.secure, false);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.accountCount ?? null, null);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.refreshedAt ?? null, null);
    assert.deepEqual(blockedInvalidConfigPayload.providers[0]?.syncMethods, []);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.degraded, false);
    assert.deepEqual(blockedInvalidConfigPayload.providers[0]?.syncModes, []);
    assert.deepEqual(blockedInvalidConfigPayload.providers[0]?.syncBadges, []);
    assert.deepEqual(blockedInvalidConfigPayload.providers[0]?.rateLimitHosts, []);
    assert.deepEqual(blockedInvalidConfigPayload.providers[0]?.openaiAuth, []);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.quotaCoverage, 'none');
    assert.equal(blockedInvalidConfigPayload.providers[0]?.quotaModelCount, 0);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.typedQuotaModelCount, 0);
    assert.equal(blockedInvalidConfigPayload.providers[0]?.problem, invalidOpenaiCommandMessage);

    const blockedInvalidConfigText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":true}',
      },
      false,
    );
    assert.equal(blockedInvalidConfigText.code, 0);
    assert.match(blockedInvalidConfigText.stdout, /Provider sync:/);
    assert.match(blockedInvalidConfigText.stdout, /verdict: blocked/);
    assert.match(
      blockedInvalidConfigText.stdout,
      /message: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    assert.match(blockedInvalidConfigText.stdout, /failureCodes: provider_command_invalid/);
    assert.match(blockedInvalidConfigText.stdout, /blockedProviders: openai/);
    assert.match(
      blockedInvalidConfigText.stdout,
      /openai: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\. \(trusted-command\)/,
    );
    assert.match(blockedInvalidConfigText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON/);
    assert.match(blockedInvalidConfigText.stdout, /configured: no/);
    assert.match(blockedInvalidConfigText.stdout, /secure: no/);
    assert.match(blockedInvalidConfigText.stdout, /state: command_invalid/);
    assert.match(blockedInvalidConfigText.stdout, /quotaCoverage: none/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /accounts:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /refreshedAt:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /syncMethods:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /syncModes:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /syncBadges:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /rateLimitHosts:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /openaiAuth:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /typedQuotaModels:/);
    assert.doesNotMatch(blockedInvalidConfigText.stdout, /problem:/);

    const blocked = await runDoctor(
      ['openai', 'google'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'command-failed',
      },
      true,
    );
    assert.equal(blocked.code, 0);
    const blockedPayload = JSON.parse(blocked.stdout);
    assert.equal(blockedPayload.verdict, 'blocked');
    assert.deepEqual(blockedPayload.failureCodes.sort(), ['provider_command_failed', 'provider_snapshot_missing']);
    assert.deepEqual(blockedPayload.advisoryCodes, []);
    assert.deepEqual(blockedPayload.blockedProviders.sort(), ['google', 'openai']);
    assert.deepEqual(blockedPayload.attentionProviders, []);
    assert.deepEqual(blockedPayload.readyProviders, []);
    assert.deepEqual(blockedPayload.providerStates, {
      openai: 'command_failed',
      google: 'snapshot_missing',
    });
    assert.deepEqual(blockedPayload.providerKinds, {
      openai: 'trusted-command',
      google: 'snapshot',
    });
    assert.deepEqual(blockedPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
      google: 'google.json',
    });
    assert.deepEqual(blockedPayload.providerConfigured, {
      openai: true,
      google: false,
    });
    assert.deepEqual(blockedPayload.providerSecure, {
      openai: true,
      google: false,
    });
    assert.deepEqual(blockedPayload.providerAccountCounts, {
      openai: null,
      google: null,
    });
    assert.deepEqual(blockedPayload.providerQuotaCoverage, {
      openai: 'none',
      google: 'none',
    });
    assert.deepEqual(blockedPayload.providerQuotaModelCounts, {
      openai: 0,
      google: 0,
    });
    assert.deepEqual(blockedPayload.providerTypedQuotaModelCounts, {
      openai: 0,
      google: 0,
    });
    assert.deepEqual(blockedPayload.providerRefreshedAt, {
      openai: null,
      google: null,
    });
    assert.deepEqual(blockedPayload.providerCodes, {
      openai: ['provider_command_failed'],
      google: ['provider_snapshot_missing'],
    });
    assert.deepEqual(blockedPayload.providerMessages, {
      openai: 'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
      google: 'No sanitized snapshot was found for provider "google" at google.json.',
    });
    assert.equal(
      blockedPayload.message,
      'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
    );
    assert.deepEqual(blockedPayload.providerAccountSyncMethods, {
      openai: [],
      google: [],
    });
    assert.deepEqual(blockedPayload.providerSyncModes, {
      openai: [],
      google: [],
    });
    assert.deepEqual(blockedPayload.providerSyncBadges, {
      openai: [],
      google: [],
    });
    assert.deepEqual(blockedPayload.providerRateLimitHosts, {
      openai: [],
      google: [],
    });
    assert.deepEqual(blockedPayload.providerOpenaiAuth, {
      openai: [],
      google: [],
    });
    assert.equal(blockedPayload.providers.find((item) => item.provider === 'openai')?.state, 'command_failed');
    assert.equal(
      blockedPayload.providers.find((item) => item.provider === 'openai')?.problem,
      'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
    );
    assert.equal(blockedPayload.providers.find((item) => item.provider === 'google')?.state, 'snapshot_missing');
    assert.equal(
      blockedPayload.providers.find((item) => item.provider === 'google')?.problem,
      'No sanitized snapshot was found for provider "google" at google.json.',
    );

    const blockedText = await runDoctor(
      ['openai', 'google'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', fakeWrapperPath]),
        FAKE_PROVIDER_SYNC_SCENARIO: 'command-failed',
      },
      false,
    );
    assert.equal(blockedText.code, 0);
    assert.match(
      blockedText.stdout,
      /message: Trusted provider sync command for "openai" failed\. Review provider sync diagnostics for details\./,
    );
    assert.match(
      blockedText.stdout,
      /openai: Trusted provider sync command for "openai" failed\. Review provider sync diagnostics for details\. \(trusted-command\)/,
    );
    assert.match(blockedText.stdout, /state: command_failed/);
    assert.match(blockedText.stdout, /quotaCoverage: none/);
    assert.equal(blockedText.stdout.includes('simulated trusted command failure'), false);
    assert.equal(blockedText.stdout.includes(fakeWrapperPath), false);

    console.log('Provider sync doctor smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Provider sync doctor smoke test failed: ${message}`);
  process.exitCode = 1;
});
