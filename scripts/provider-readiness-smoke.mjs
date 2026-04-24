import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const doctorEntry = path.join(repoRoot, 'scripts/provider-readiness-doctor.mjs');

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

function validPayload(provider, displayName) {
  return {
    provider,
    accounts: [
      {
        id: `${provider}-main`,
        displayName,
        authMode: 'subscription',
        owner: 'operator',
        lastRefreshedAt: '2026-04-21T18:15:00.000Z',
        quotas: [
          {
            modelId: `${provider}-model`,
            displayName,
            availability: 'available',
            authMode: 'subscription',
            usageUnit: 'credits',
            interpretation: 'absolute',
            source: 'manual',
            confidence: 'high',
            remaining: 88,
          },
        ],
      },
    ],
  };
}

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-provider-readiness-smoke-'));
  const snapshotDir = path.join(tempRoot, 'provider-snapshots');

  await mkdir(snapshotDir, { recursive: true, mode: 0o700 });

  try {
    const inferredLocalOpenaiJson = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', '/tmp/inferred-openai-sync.mjs']),
      },
      true,
    );
    assert.equal(inferredLocalOpenaiJson.code, 0);
    const inferredLocalOpenaiPayload = JSON.parse(inferredLocalOpenaiJson.stdout);
    assert.equal(inferredLocalOpenaiPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(inferredLocalOpenaiPayload.verdict, 'ready');
    assert.deepEqual(inferredLocalOpenaiPayload.failureCodes, []);
    assert.deepEqual(inferredLocalOpenaiPayload.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(inferredLocalOpenaiPayload.blockedProviders, []);
    assert.deepEqual(inferredLocalOpenaiPayload.attentionProviders, []);
    assert.deepEqual(inferredLocalOpenaiPayload.readyProviders, ['openai']);
    assert.deepEqual(inferredLocalOpenaiPayload.unvalidatedProviders, ['openai']);
    assert.deepEqual(inferredLocalOpenaiPayload.providerStates, { openai: 'trusted_command_ready' });
    assert.deepEqual(inferredLocalOpenaiPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(inferredLocalOpenaiPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerConfigured, { openai: true });
    assert.deepEqual(inferredLocalOpenaiPayload.providerSecure, { openai: true });
    assert.deepEqual(inferredLocalOpenaiPayload.providerValidated, { openai: false });
    assert.deepEqual(inferredLocalOpenaiPayload.providerLastModifiedAt, { openai: null });
    assert.deepEqual(inferredLocalOpenaiPayload.providerAccountCounts, { openai: null });
    assert.deepEqual(inferredLocalOpenaiPayload.providerCodes, {
      openai: ['provider_trusted_command_unvalidated'],
    });
    assert.deepEqual(inferredLocalOpenaiPayload.providerMessages, {
      openai: 'trusted_command_ready (unvalidated)',
    });
    assert.equal(inferredLocalOpenaiPayload.message, 'trusted_command_ready (unvalidated)');
    assert.equal(inferredLocalOpenaiPayload.stateCounts.trusted_command_ready, 1);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.provider, 'openai');
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.state, 'trusted_command_ready');
    assert.equal(
      inferredLocalOpenaiPayload.providers[0]?.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.configured, true);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.secure, true);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.validated, false);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.lastModifiedAt ?? null, null);
    assert.equal(inferredLocalOpenaiPayload.providers[0]?.accountCount ?? null, null);

    const inferredLocalOpenaiText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', '/tmp/inferred-openai-sync.mjs']),
      },
      false,
    );
    assert.equal(inferredLocalOpenaiText.code, 0);
    assert.match(inferredLocalOpenaiText.stdout, /Provider readiness:/);
    assert.match(inferredLocalOpenaiText.stdout, /verdict: ready/);
    assert.match(inferredLocalOpenaiText.stdout, /message: trusted_command_ready \(unvalidated\)/);
    assert.match(inferredLocalOpenaiText.stdout, /advisoryCodes: provider_trusted_command_unvalidated/);
    assert.match(inferredLocalOpenaiText.stdout, /unvalidatedProviders: openai/);
    assert.match(
      inferredLocalOpenaiText.stdout,
      /openai: trusted_command_ready \(unvalidated\) \(trusted-command\)/,
    );
    assert.match(inferredLocalOpenaiText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(inferredLocalOpenaiText.stdout, /configured: yes/);
    assert.match(inferredLocalOpenaiText.stdout, /secure: yes/);
    assert.match(inferredLocalOpenaiText.stdout, /validated: no/);
    assert.match(inferredLocalOpenaiText.stdout, /state: trusted_command_ready/);
    assert.doesNotMatch(inferredLocalOpenaiText.stdout, /accounts:/);
    assert.doesNotMatch(inferredLocalOpenaiText.stdout, /lastModifiedAt:/);

    await writeFile(path.join(snapshotDir, 'anthropic.json'), `${JSON.stringify(validPayload('anthropic', 'Claude Code'), null, 2)}\n`, {
      mode: 0o600,
    });

    const openaiReadyJson = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', '/tmp/fake-openai-sync.mjs']),
      },
      true,
    );
    assert.equal(openaiReadyJson.code, 0);
    const openaiReadyPayload = JSON.parse(openaiReadyJson.stdout);
    assert.equal(openaiReadyPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(openaiReadyPayload.verdict, 'ready');
    assert.deepEqual(openaiReadyPayload.failureCodes, []);
    assert.deepEqual(openaiReadyPayload.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(openaiReadyPayload.blockedProviders, []);
    assert.deepEqual(openaiReadyPayload.attentionProviders, []);
    assert.deepEqual(openaiReadyPayload.readyProviders, ['openai']);
    assert.deepEqual(openaiReadyPayload.unvalidatedProviders, ['openai']);
    assert.deepEqual(openaiReadyPayload.providerStates, { openai: 'trusted_command_ready' });
    assert.deepEqual(openaiReadyPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(openaiReadyPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    });
    assert.deepEqual(openaiReadyPayload.providerConfigured, { openai: true });
    assert.deepEqual(openaiReadyPayload.providerSecure, { openai: true });
    assert.deepEqual(openaiReadyPayload.providerValidated, { openai: false });
    assert.deepEqual(openaiReadyPayload.providerLastModifiedAt, { openai: null });
    assert.deepEqual(openaiReadyPayload.providerAccountCounts, { openai: null });
    assert.deepEqual(openaiReadyPayload.providerCodes, {
      openai: ['provider_trusted_command_unvalidated'],
    });
    assert.deepEqual(openaiReadyPayload.providerMessages, {
      openai: 'trusted_command_ready (unvalidated)',
    });
    assert.equal(openaiReadyPayload.message, 'trusted_command_ready (unvalidated)');
    assert.equal(openaiReadyPayload.stateCounts.trusted_command_ready, 1);
    assert.equal(openaiReadyPayload.providers[0]?.provider, 'openai');
    assert.equal(openaiReadyPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(openaiReadyPayload.providers[0]?.state, 'trusted_command_ready');
    assert.equal(
      openaiReadyPayload.providers[0]?.source,
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
    );
    assert.equal(openaiReadyPayload.providers[0]?.configured, true);
    assert.equal(openaiReadyPayload.providers[0]?.secure, true);
    assert.equal(openaiReadyPayload.providers[0]?.validated, false);
    assert.equal(openaiReadyPayload.providers[0]?.lastModifiedAt ?? null, null);
    assert.equal(openaiReadyPayload.providers[0]?.accountCount ?? null, null);

    const openaiReadyText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', '/tmp/fake-openai-sync.mjs']),
      },
      false,
    );
    assert.equal(openaiReadyText.code, 0);
    assert.match(openaiReadyText.stdout, /message: trusted_command_ready \(unvalidated\)/);
    assert.match(openaiReadyText.stdout, /openai: trusted_command_ready \(unvalidated\) \(trusted-command\)/);
    assert.match(openaiReadyText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node \(\+1 args\)/);
    assert.match(openaiReadyText.stdout, /configured: yes/);
    assert.match(openaiReadyText.stdout, /secure: yes/);
    assert.match(openaiReadyText.stdout, /validated: no/);
    assert.match(openaiReadyText.stdout, /state: trusted_command_ready/);
    assert.doesNotMatch(openaiReadyText.stdout, /accounts:/);
    assert.doesNotMatch(openaiReadyText.stdout, /lastModifiedAt:/);

    const invalidOpenaiCommandMessage =
      'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].';
    const openaiInvalidJson = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":true}',
      },
      true,
    );
    assert.equal(openaiInvalidJson.code, 0);
    const openaiInvalidPayload = JSON.parse(openaiInvalidJson.stdout);
    assert.equal(openaiInvalidPayload.verdict, 'blocked');
    assert.deepEqual(openaiInvalidPayload.failureCodes, ['provider_command_invalid']);
    assert.deepEqual(openaiInvalidPayload.advisoryCodes, []);
    assert.deepEqual(openaiInvalidPayload.blockedProviders, ['openai']);
    assert.deepEqual(openaiInvalidPayload.attentionProviders, ['openai']);
    assert.deepEqual(openaiInvalidPayload.readyProviders, []);
    assert.deepEqual(openaiInvalidPayload.unvalidatedProviders, ['openai']);
    assert.deepEqual(openaiInvalidPayload.providerStates, { openai: 'command_invalid' });
    assert.deepEqual(openaiInvalidPayload.providerKinds, { openai: 'trusted-command' });
    assert.deepEqual(openaiInvalidPayload.providerSources, { openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON' });
    assert.deepEqual(openaiInvalidPayload.providerConfigured, { openai: false });
    assert.deepEqual(openaiInvalidPayload.providerSecure, { openai: false });
    assert.deepEqual(openaiInvalidPayload.providerValidated, { openai: false });
    assert.deepEqual(openaiInvalidPayload.providerLastModifiedAt, { openai: null });
    assert.deepEqual(openaiInvalidPayload.providerAccountCounts, { openai: null });
    assert.deepEqual(openaiInvalidPayload.providerCodes, { openai: ['provider_command_invalid'] });
    assert.deepEqual(openaiInvalidPayload.providerMessages, { openai: invalidOpenaiCommandMessage });
    assert.equal(openaiInvalidPayload.message, invalidOpenaiCommandMessage);
    assert.equal(openaiInvalidPayload.stateCounts.command_invalid, 1);
    assert.equal(openaiInvalidPayload.providers[0]?.provider, 'openai');
    assert.equal(openaiInvalidPayload.providers[0]?.kind, 'trusted-command');
    assert.equal(openaiInvalidPayload.providers[0]?.state, 'command_invalid');
    assert.equal(openaiInvalidPayload.providers[0]?.source, 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON');
    assert.equal(openaiInvalidPayload.providers[0]?.configured, false);
    assert.equal(openaiInvalidPayload.providers[0]?.secure, false);
    assert.equal(openaiInvalidPayload.providers[0]?.validated, false);
    assert.equal(openaiInvalidPayload.providers[0]?.lastModifiedAt ?? null, null);
    assert.equal(openaiInvalidPayload.providers[0]?.accountCount ?? null, null);
    assert.equal(openaiInvalidPayload.providers[0]?.problem, invalidOpenaiCommandMessage);

    const openaiInvalidText = await runDoctor(
      ['openai'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '{"broken":true}',
      },
      false,
    );
    assert.equal(openaiInvalidText.code, 0);
    assert.match(
      openaiInvalidText.stdout,
      /message: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\./,
    );
    assert.match(openaiInvalidText.stdout, /failureCodes: provider_command_invalid/);
    assert.match(openaiInvalidText.stdout, /blockedProviders: openai/);
    assert.match(openaiInvalidText.stdout, /attentionProviders: openai/);
    assert.match(openaiInvalidText.stdout, /unvalidatedProviders: openai/);
    assert.match(
      openaiInvalidText.stdout,
      /openai: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\. \(trusted-command\)/,
    );
    assert.match(openaiInvalidText.stdout, /source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON/);
    assert.match(openaiInvalidText.stdout, /configured: no/);
    assert.match(openaiInvalidText.stdout, /secure: no/);
    assert.match(openaiInvalidText.stdout, /validated: no/);
    assert.match(openaiInvalidText.stdout, /state: command_invalid/);
    assert.doesNotMatch(openaiInvalidText.stdout, /accounts:/);
    assert.doesNotMatch(openaiInvalidText.stdout, /lastModifiedAt:/);
    assert.doesNotMatch(openaiInvalidText.stdout, /problem:/);

    const anthropicReady = await runDoctor(['anthropic'], { SWITCHBOARD_SNAPSHOT_DIR: snapshotDir });
    assert.equal(anthropicReady.code, 0);
    assert.match(anthropicReady.stdout, /message: snapshot_ready/);
    assert.match(anthropicReady.stdout, /anthropic: snapshot_ready \(snapshot\)/);
    assert.match(anthropicReady.stdout, /source: anthropic\.json/);
    assert.match(anthropicReady.stdout, /configured: yes/);
    assert.match(anthropicReady.stdout, /secure: yes/);
    assert.match(anthropicReady.stdout, /validated: yes/);
    assert.match(anthropicReady.stdout, /accounts: 1/);
    assert.match(anthropicReady.stdout, /lastModifiedAt: 2026-/);

    const anthropicReadyJson = await runDoctor(['anthropic'], { SWITCHBOARD_SNAPSHOT_DIR: snapshotDir }, true);
    assert.equal(anthropicReadyJson.code, 0);
    const anthropicReadyPayload = JSON.parse(anthropicReadyJson.stdout);
    assert.equal(anthropicReadyPayload.verdict, 'ready');
    assert.deepEqual(anthropicReadyPayload.failureCodes, []);
    assert.deepEqual(anthropicReadyPayload.advisoryCodes, []);
    assert.deepEqual(anthropicReadyPayload.blockedProviders, []);
    assert.deepEqual(anthropicReadyPayload.attentionProviders, []);
    assert.deepEqual(anthropicReadyPayload.readyProviders, ['anthropic']);
    assert.deepEqual(anthropicReadyPayload.unvalidatedProviders, []);
    assert.deepEqual(anthropicReadyPayload.providerStates, { anthropic: 'snapshot_ready' });
    assert.deepEqual(anthropicReadyPayload.providerKinds, { anthropic: 'snapshot' });
    assert.deepEqual(anthropicReadyPayload.providerSources, { anthropic: 'anthropic.json' });
    assert.deepEqual(anthropicReadyPayload.providerConfigured, { anthropic: true });
    assert.deepEqual(anthropicReadyPayload.providerSecure, { anthropic: true });
    assert.deepEqual(anthropicReadyPayload.providerValidated, { anthropic: true });
    assert.match(anthropicReadyPayload.providerLastModifiedAt.anthropic ?? '', /^2026-/);
    assert.deepEqual(anthropicReadyPayload.providerAccountCounts, { anthropic: 1 });
    assert.deepEqual(anthropicReadyPayload.providerCodes, { anthropic: [] });
    assert.deepEqual(anthropicReadyPayload.providerMessages, { anthropic: 'snapshot_ready' });
    assert.equal(anthropicReadyPayload.message, 'snapshot_ready');
    assert.equal(anthropicReadyPayload.providers[0]?.state, 'snapshot_ready');
    assert.equal(anthropicReadyPayload.providers[0]?.accountCount, 1);

    const googleMissingJson = await runDoctor(['google'], { SWITCHBOARD_SNAPSHOT_DIR: snapshotDir }, true);
    assert.equal(googleMissingJson.code, 0);
    const googleMissingPayload = JSON.parse(googleMissingJson.stdout);
    assert.equal(googleMissingPayload.verdict, 'attention_required');
    assert.deepEqual(googleMissingPayload.failureCodes, []);
    assert.deepEqual(googleMissingPayload.advisoryCodes, ['provider_snapshot_missing']);
    assert.deepEqual(googleMissingPayload.blockedProviders, []);
    assert.deepEqual(googleMissingPayload.attentionProviders, ['google']);
    assert.deepEqual(googleMissingPayload.readyProviders, []);
    assert.deepEqual(googleMissingPayload.unvalidatedProviders, ['google']);
    assert.deepEqual(googleMissingPayload.providerStates, { google: 'snapshot_missing' });
    assert.deepEqual(googleMissingPayload.providerKinds, { google: 'snapshot' });
    assert.deepEqual(googleMissingPayload.providerSources, { google: 'google.json' });
    assert.deepEqual(googleMissingPayload.providerConfigured, { google: false });
    assert.deepEqual(googleMissingPayload.providerSecure, { google: false });
    assert.deepEqual(googleMissingPayload.providerValidated, { google: false });
    assert.deepEqual(googleMissingPayload.providerLastModifiedAt, { google: null });
    assert.deepEqual(googleMissingPayload.providerAccountCounts, { google: null });
    assert.deepEqual(googleMissingPayload.providerCodes, { google: ['provider_snapshot_missing'] });
    assert.deepEqual(googleMissingPayload.providerMessages, { google: 'No sanitized snapshot file found yet.' });
    assert.equal(googleMissingPayload.message, 'No sanitized snapshot file found yet.');
    assert.equal(googleMissingPayload.providers[0]?.state, 'snapshot_missing');

    const googleMissingText = await runDoctor(['google'], { SWITCHBOARD_SNAPSHOT_DIR: snapshotDir }, false);
    assert.equal(googleMissingText.code, 0);
    assert.match(googleMissingText.stdout, /message: No sanitized snapshot file found yet\./);
    assert.match(googleMissingText.stdout, /google: No sanitized snapshot file found yet\. \(snapshot\)/);
    assert.match(googleMissingText.stdout, /source: google\.json/);
    assert.match(googleMissingText.stdout, /configured: no/);
    assert.match(googleMissingText.stdout, /secure: no/);
    assert.match(googleMissingText.stdout, /validated: no/);

    await writeFile(path.join(snapshotDir, 'anthropic.json'), '{invalid-json}\n', { mode: 0o600 });
    const blockedJson = await runDoctor(
      ['openai', 'anthropic', 'google'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', '/tmp/fake-openai-sync.mjs']),
        SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON: '{"broken":true}',
      },
      true,
    );
    assert.equal(blockedJson.code, 0);
    const blockedPayload = JSON.parse(blockedJson.stdout);
    assert.equal(blockedPayload.verdict, 'blocked');
    assert.deepEqual(blockedPayload.failureCodes.sort(), ['provider_command_invalid', 'provider_snapshot_invalid']);
    assert.deepEqual(blockedPayload.advisoryCodes, ['provider_trusted_command_unvalidated']);
    assert.deepEqual(blockedPayload.blockedProviders.sort(), ['anthropic', 'google']);
    assert.deepEqual(blockedPayload.attentionProviders.sort(), ['anthropic', 'google']);
    assert.deepEqual(blockedPayload.readyProviders, ['openai']);
    assert.deepEqual(blockedPayload.unvalidatedProviders.sort(), ['google', 'openai']);
    assert.deepEqual(blockedPayload.providerStates, {
      openai: 'trusted_command_ready',
      anthropic: 'snapshot_invalid',
      google: 'command_invalid',
    });
    assert.deepEqual(blockedPayload.providerKinds, {
      openai: 'trusted-command',
      anthropic: 'snapshot',
      google: 'trusted-command',
    });
    assert.deepEqual(blockedPayload.providerSources, {
      openai: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node (+1 args)',
      anthropic: 'anthropic.json',
      google: 'SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON',
    });
    assert.deepEqual(blockedPayload.providerConfigured, {
      openai: true,
      anthropic: true,
      google: false,
    });
    assert.deepEqual(blockedPayload.providerSecure, {
      openai: true,
      anthropic: true,
      google: false,
    });
    assert.deepEqual(blockedPayload.providerValidated, {
      openai: false,
      anthropic: true,
      google: false,
    });
    assert.equal(blockedPayload.providerLastModifiedAt.openai, null);
    assert.match(blockedPayload.providerLastModifiedAt.anthropic ?? '', /^2026-/);
    assert.equal(blockedPayload.providerLastModifiedAt.google, null);
    assert.deepEqual(blockedPayload.providerAccountCounts, {
      openai: null,
      anthropic: null,
      google: null,
    });
    assert.deepEqual(blockedPayload.providerCodes, {
      openai: ['provider_trusted_command_unvalidated'],
      anthropic: ['provider_snapshot_invalid'],
      google: ['provider_command_invalid'],
    });
    assert.deepEqual(blockedPayload.providerMessages, {
      openai: 'trusted_command_ready (unvalidated)',
      anthropic: 'Snapshot file "anthropic.json" is not valid JSON: Expected property name or \'}\' in JSON at position 1 (line 1 column 2)',
      google: 'SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
    });
    assert.equal(
      blockedPayload.message,
      'Snapshot file "anthropic.json" is not valid JSON: Expected property name or \'}\' in JSON at position 1 (line 1 column 2)',
    );
    assert.equal(blockedPayload.stateCounts.trusted_command_ready, 1);
    assert.equal(blockedPayload.stateCounts.snapshot_invalid, 1);
    assert.equal(blockedPayload.stateCounts.command_invalid, 1);
    assert.equal(blockedPayload.providers.find((item) => item.provider === 'anthropic')?.state, 'snapshot_invalid');
    assert.equal(blockedPayload.providers.find((item) => item.provider === 'google')?.state, 'command_invalid');
    assert.equal(
      blockedPayload.providers.find((item) => item.provider === 'anthropic')?.problem,
      'Snapshot file "anthropic.json" is not valid JSON: Expected property name or \'}\' in JSON at position 1 (line 1 column 2)',
    );
    assert.equal(
      blockedPayload.providers.find((item) => item.provider === 'google')?.problem,
      'SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example ["node","/path/to/provider-sync.mjs"].',
    );

    const blockedText = await runDoctor(
      ['openai', 'anthropic', 'google'],
      {
        SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
        SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: JSON.stringify(['node', '/tmp/fake-openai-sync.mjs']),
        SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON: '{"broken":true}',
      },
      false,
    );
    assert.equal(blockedText.code, 0);
    assert.match(
      blockedText.stdout,
      /message: Snapshot file "anthropic\.json" is not valid JSON: Expected property name or '\}' in JSON at position 1 \(line 1 column 2\)/,
    );
    assert.match(
      blockedText.stdout,
      /anthropic: Snapshot file "anthropic\.json" is not valid JSON: Expected property name or '\}' in JSON at position 1 \(line 1 column 2\) \(snapshot\)/,
    );
    assert.match(blockedText.stdout, /source: anthropic\.json/);
    assert.match(blockedText.stdout, /configured: yes/);
    assert.match(blockedText.stdout, /secure: yes/);
    assert.match(blockedText.stdout, /validated: yes/);
    assert.match(
      blockedText.stdout,
      /google: SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON must be a JSON array of non-empty strings, for example \["node","\/path\/to\/provider-sync\.mjs"\]\. \(trusted-command\)/,
    );
    assert.match(blockedText.stdout, /source: SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON/);
    assert.match(blockedText.stdout, /configured: no/);
    assert.match(blockedText.stdout, /secure: no/);
    assert.match(blockedText.stdout, /validated: no/);
    assert.match(blockedText.stdout, /state: snapshot_invalid/);
    assert.match(blockedText.stdout, /state: command_invalid/);

    console.log('Provider readiness smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Provider readiness smoke test failed: ${message}`);
  process.exitCode = 1;
});
