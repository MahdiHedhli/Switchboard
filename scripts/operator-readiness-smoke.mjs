import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import { createRuntimeSecurityFixtures } from './runtime-security-fixtures.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const operatorDoctorEntry = fileURLToPath(import.meta.url);
const { BrokerAuthPolicy } = await import(path.join(repoRoot, 'apps/broker/dist/auth-policy.js'));
const { summarizeBrokerRuntimeEnvironment } = await import(path.join(repoRoot, 'apps/broker/dist/runtime-config.js'));

async function runCurrentDoctor(profile, env, json = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [operatorDoctorEntry, 'from-env', profile, ...(json ? ['--json'] : [])],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

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

async function summarizeEnvironment(env) {
  const summary = await summarizeBrokerRuntimeEnvironment(env);
  const policy = new BrokerAuthPolicy({
    host: summary.host,
    operatorToken: summary.operatorTokenConfigured ? 'configured-operator-token' : undefined,
    allowOpenLoopbackMutations: summary.allowOpenLoopbackMutations,
    manualSubscriptionReplaceEnabled: summary.manualSubscriptionReplaceEnabled,
  }).summary();

  return {
    ...summary,
    policy,
  };
}

function scopeRequirements(summary) {
  return {
    taskCreate: summary.policy.scopes.taskCreate.requirement,
    taskUpdate: summary.policy.scopes.taskUpdate.requirement,
    subscriptionRefresh: summary.policy.scopes.subscriptionRefresh.requirement,
    subscriptionReplace: summary.policy.scopes.subscriptionReplace.requirement,
  };
}

function operatorReadyMessage(profile, summary) {
  return `${profile}; host=${summary.host}`;
}

function operatorProblems(summary, profile) {
  const scopes = scopeRequirements(summary);
  const problems = [];

  if (profile === 'remote-trusted') {
    if (summary.localOnly) {
      problems.push('Remote-trusted mode must bind to a non-loopback host.');
    }
    if (!summary.allowRemote) {
      problems.push('Remote-trusted mode must set SWITCHBOARD_ALLOW_REMOTE=1.');
    }
    if (summary.operatorTokenProblem) {
      problems.push(summary.operatorTokenProblem);
    }
    if (!summary.operatorTokenConfigured) {
      problems.push('Remote-trusted mode must set SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE.');
    }
    if (summary.tlsProblem) {
      problems.push(summary.tlsProblem);
    }
    if (!summary.tlsEnabled) {
      problems.push('Remote-trusted mode must set SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE.');
    }
    if (scopes.taskCreate !== 'operator_token') {
      problems.push('Remote-trusted mode must token-gate task creation.');
    }
    if (scopes.taskUpdate !== 'operator_token') {
      problems.push('Remote-trusted mode must token-gate task updates.');
    }
    if (scopes.subscriptionRefresh !== 'operator_token') {
      problems.push('Remote-trusted mode must token-gate provider refresh.');
    }
    if (scopes.subscriptionReplace !== 'disabled') {
      problems.push('Remote-trusted mode should keep direct subscription replacement disabled by default.');
    }
  } else {
    if (summary.operatorTokenProblem) {
      problems.push(summary.operatorTokenProblem);
    }
    if (summary.tlsProblem) {
      problems.push(summary.tlsProblem);
    }
    if (!summary.localOnly) {
      problems.push('Local-only mode must bind to a loopback host such as 127.0.0.1.');
    }
    if (summary.allowRemote) {
      problems.push('Local-only mode must not set SWITCHBOARD_ALLOW_REMOTE=1.');
    }
    if (!summary.operatorTokenConfigured) {
      problems.push('Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.');
    }
    if (scopes.taskCreate !== 'operator_token') {
      problems.push('Local-only mode should token-gate task creation for reviewed operator use.');
    }
    if (scopes.taskUpdate !== 'operator_token') {
      problems.push('Local-only mode should token-gate task updates for reviewed operator use.');
    }
    if (scopes.subscriptionRefresh !== 'operator_token') {
      problems.push('Local-only mode should token-gate provider refresh for reviewed operator use.');
    }
    if (scopes.subscriptionReplace !== 'disabled') {
      problems.push('Local-only mode should keep direct subscription replacement disabled by default.');
    }
  }

  return problems;
}

function buildDoctorSummary(summary, profile) {
  const scopes = scopeRequirements(summary);
  const problems = operatorProblems(summary, profile);
  const ready = problems.length === 0;

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'operator-readiness',
    profile,
    verdict: ready ? 'ready' : 'blocked',
    failureCodes: ready ? [] : ['operator_readiness_failed'],
    advisoryCodes: [],
    message: problems[0] ?? operatorReadyMessage(profile, summary),
    problems,
    host: summary.host,
    localOnly: summary.localOnly,
    allowRemote: summary.allowRemote,
    operatorTokenConfigured: summary.operatorTokenConfigured,
    operatorTokenSource: summary.operatorTokenSource,
    operatorTokenFile: summary.operatorTokenFile,
    ...(summary.operatorTokenProblem ? { operatorTokenProblem: summary.operatorTokenProblem } : {}),
    manualSubscriptionReplaceEnabled: summary.manualSubscriptionReplaceEnabled,
    protocol: summary.protocol,
    tlsEnabled: summary.tlsEnabled,
    tlsCertFile: summary.tlsCertFile,
    tlsKeyFile: summary.tlsKeyFile,
    tlsCaFile: summary.tlsCaFile,
    scopes,
  };
}

function validateLocalOnly(summary) {
  const problems = operatorProblems(summary, 'local-only');
  assert.equal(problems.length, 0, problems[0] ?? 'Local-only mode should satisfy operator readiness requirements.');
}

function validateRemoteTrusted(summary) {
  const problems = operatorProblems(summary, 'remote-trusted');
  assert.equal(problems.length, 0, problems[0] ?? 'Remote-trusted mode should satisfy operator readiness requirements.');
}

function renderSummaryLines(summary, doctorSummary, label) {
  return [
    `${label}:`,
    `  verdict: ${doctorSummary.verdict}`,
    `  message: ${doctorSummary.message}`,
    ...(doctorSummary.failureCodes.length > 0
      ? [`  failureCodes: ${doctorSummary.failureCodes.join(', ')}`]
      : []),
    `  host: ${summary.host}`,
    `  localOnly: ${summary.localOnly ? 'yes' : 'no'}`,
    `  allowRemote: ${summary.allowRemote ? 'yes' : 'no'}`,
    `  protocol: ${summary.protocol}`,
    `  tlsEnabled: ${summary.tlsEnabled ? 'yes' : 'no'}`,
    `  operatorTokenConfigured: ${summary.operatorTokenConfigured ? 'yes' : 'no'}`,
    `  operatorTokenSource: ${summary.operatorTokenSource}`,
    ...(summary.operatorTokenFile ? [`  operatorTokenFile: ${summary.operatorTokenFile}`] : []),
    ...(summary.operatorTokenProblem ? [`  operatorTokenProblem: ${summary.operatorTokenProblem}`] : []),
    `  manualSubscriptionReplaceEnabled: ${summary.manualSubscriptionReplaceEnabled ? 'yes' : 'no'}`,
    `  taskCreate: ${summary.policy.scopes.taskCreate.requirement}`,
    `  taskUpdate: ${summary.policy.scopes.taskUpdate.requirement}`,
    `  subscriptionRefresh: ${summary.policy.scopes.subscriptionRefresh.requirement}`,
    `  subscriptionReplace: ${summary.policy.scopes.subscriptionReplace.requirement}`,
  ];
}

function printSummary(summary, doctorSummary, label) {
  for (const line of renderSummaryLines(summary, doctorSummary, label)) {
    console.log(line);
  }
}

async function exampleMatrix() {
  const fixtures = await createRuntimeSecurityFixtures('switchboard-operator-smoke-');

  try {
    const localOnly = await summarizeEnvironment({
    SWITCHBOARD_BROKER_HOST: '127.0.0.1',
    SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
  });
    validateLocalOnly(localOnly);
    const localOnlyDoctorSummary = buildDoctorSummary(localOnly, 'local-only');
    assert.deepEqual(localOnlyDoctorSummary, {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'operator-readiness',
    profile: 'local-only',
    verdict: 'ready',
    failureCodes: [],
    advisoryCodes: [],
    message: 'local-only; host=127.0.0.1',
    problems: [],
    host: '127.0.0.1',
    localOnly: true,
    allowRemote: false,
    operatorTokenConfigured: true,
    operatorTokenSource: 'env',
    operatorTokenFile: undefined,
    manualSubscriptionReplaceEnabled: false,
    protocol: 'http',
    tlsEnabled: false,
    tlsCertFile: undefined,
    tlsKeyFile: undefined,
    tlsCaFile: undefined,
    scopes: {
      taskCreate: 'operator_token',
      taskUpdate: 'operator_token',
      subscriptionRefresh: 'operator_token',
      subscriptionReplace: 'disabled',
    },
  });
    assert.deepEqual(
      renderSummaryLines(localOnly, localOnlyDoctorSummary, 'Operator readiness (local-only)'),
      [
        'Operator readiness (local-only):',
        '  verdict: ready',
        '  message: local-only; host=127.0.0.1',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: yes',
        '  operatorTokenSource: env',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: operator_token',
        '  taskUpdate: operator_token',
        '  subscriptionRefresh: operator_token',
        '  subscriptionReplace: disabled',
      ],
    );
    const localOnlyFileBacked = await summarizeEnvironment({
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    });
    validateLocalOnly(localOnlyFileBacked);
    const localOnlyFileBackedDoctorSummary = buildDoctorSummary(localOnlyFileBacked, 'local-only');
    assert.deepEqual(localOnlyFileBackedDoctorSummary, {
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      kind: 'operator-readiness',
      profile: 'local-only',
      verdict: 'ready',
      failureCodes: [],
      advisoryCodes: [],
      message: 'local-only; host=127.0.0.1',
      problems: [],
      host: '127.0.0.1',
      localOnly: true,
      allowRemote: false,
      operatorTokenConfigured: true,
      operatorTokenSource: 'file',
      operatorTokenFile: 'operator-token',
      manualSubscriptionReplaceEnabled: false,
      protocol: 'http',
      tlsEnabled: false,
      tlsCertFile: undefined,
      tlsKeyFile: undefined,
      tlsCaFile: undefined,
      scopes: {
        taskCreate: 'operator_token',
        taskUpdate: 'operator_token',
        subscriptionRefresh: 'operator_token',
        subscriptionReplace: 'disabled',
      },
    });
    assert.deepEqual(
      renderSummaryLines(localOnlyFileBacked, localOnlyFileBackedDoctorSummary, 'Operator readiness (local-only)'),
      [
        'Operator readiness (local-only):',
        '  verdict: ready',
        '  message: local-only; host=127.0.0.1',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: yes',
        '  operatorTokenSource: file',
        '  operatorTokenFile: operator-token',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: operator_token',
        '  taskUpdate: operator_token',
        '  subscriptionRefresh: operator_token',
        '  subscriptionReplace: disabled',
      ],
    );

    const localOnlyFileBackedHuman = await runCurrentDoctor(
      'local-only',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      },
      false,
    );
    assert.equal(localOnlyFileBackedHuman.code, 0);
    assert.match(localOnlyFileBackedHuman.stdout, /Operator readiness \(local-only\):/);
    assert.match(localOnlyFileBackedHuman.stdout, /message: local-only; host=127\.0\.0\.1/);
    assert.match(localOnlyFileBackedHuman.stdout, /operatorTokenConfigured: yes/);
    assert.match(localOnlyFileBackedHuman.stdout, /operatorTokenSource: file/);
    assert.match(localOnlyFileBackedHuman.stdout, /operatorTokenFile: operator-token/);
    assert.equal(localOnlyFileBackedHuman.stderr, '');

    const localOnlyFileBackedJson = await runCurrentDoctor(
      'local-only',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      },
      true,
    );
    assert.equal(localOnlyFileBackedJson.code, 0);
    const localOnlyFileBackedJsonPayload = JSON.parse(localOnlyFileBackedJson.stdout);
    assert.equal(localOnlyFileBackedJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localOnlyFileBackedJsonPayload.kind, 'operator-readiness');
    assert.equal(localOnlyFileBackedJsonPayload.profile, 'local-only');
    assert.equal(localOnlyFileBackedJsonPayload.verdict, 'ready');
    assert.equal(localOnlyFileBackedJsonPayload.message, 'local-only; host=127.0.0.1');
    assert.equal(localOnlyFileBackedJsonPayload.operatorTokenConfigured, true);
    assert.equal(localOnlyFileBackedJsonPayload.operatorTokenSource, 'file');
    assert.equal(localOnlyFileBackedJsonPayload.operatorTokenFile, 'operator-token');
    assert.deepEqual(localOnlyFileBackedJsonPayload.failureCodes, []);
    assert.deepEqual(localOnlyFileBackedJsonPayload.scopes, {
      taskCreate: 'operator_token',
      taskUpdate: 'operator_token',
      subscriptionRefresh: 'operator_token',
      subscriptionReplace: 'disabled',
    });

    const localMissingToken = await summarizeEnvironment({
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
    });
    const localMissingTokenDoctorSummary = buildDoctorSummary(localMissingToken, 'local-only');
    assert.deepEqual(localMissingTokenDoctorSummary, {
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      kind: 'operator-readiness',
      profile: 'local-only',
      verdict: 'blocked',
      failureCodes: ['operator_readiness_failed'],
      advisoryCodes: [],
      message: 'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.',
      problems: [
        'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.',
        'Local-only mode should token-gate task creation for reviewed operator use.',
        'Local-only mode should token-gate task updates for reviewed operator use.',
        'Local-only mode should token-gate provider refresh for reviewed operator use.',
      ],
      host: '127.0.0.1',
      localOnly: true,
      allowRemote: false,
      operatorTokenConfigured: false,
      operatorTokenSource: 'unset',
      operatorTokenFile: undefined,
      manualSubscriptionReplaceEnabled: false,
      protocol: 'http',
      tlsEnabled: false,
      tlsCertFile: undefined,
      tlsKeyFile: undefined,
      tlsCaFile: undefined,
      scopes: {
        taskCreate: 'disabled',
        taskUpdate: 'disabled',
        subscriptionRefresh: 'disabled',
        subscriptionReplace: 'disabled',
      },
    });
    assert.deepEqual(
      renderSummaryLines(localMissingToken, localMissingTokenDoctorSummary, 'Operator readiness (local-only)'),
      [
        'Operator readiness (local-only):',
        '  verdict: blocked',
        '  message: Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.',
        '  failureCodes: operator_readiness_failed',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: no',
        '  operatorTokenSource: unset',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: disabled',
        '  taskUpdate: disabled',
        '  subscriptionRefresh: disabled',
        '  subscriptionReplace: disabled',
      ],
    );
    const localMissingTokenHuman = await runCurrentDoctor(
      'local-only',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      },
      false,
    );
    assert.equal(localMissingTokenHuman.code, 1);
    assert.match(localMissingTokenHuman.stdout, /Operator readiness \(local-only\):/);
    assert.match(localMissingTokenHuman.stdout, /message: Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN\./);
    assert.match(localMissingTokenHuman.stdout, /operatorTokenConfigured: no/);
    assert.match(localMissingTokenHuman.stdout, /operatorTokenSource: unset/);
    assert.match(localMissingTokenHuman.stdout, /taskCreate: disabled/);
    assert.match(localMissingTokenHuman.stderr, /Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN\./);

    const localMissingTokenJson = await runCurrentDoctor(
      'local-only',
      {
        SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      },
      true,
    );
    assert.equal(localMissingTokenJson.code, 1);
    const localMissingTokenJsonPayload = JSON.parse(localMissingTokenJson.stdout);
    assert.equal(localMissingTokenJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(localMissingTokenJsonPayload.kind, 'operator-readiness');
    assert.equal(localMissingTokenJsonPayload.profile, 'local-only');
    assert.equal(localMissingTokenJsonPayload.verdict, 'blocked');
    assert.equal(localMissingTokenJsonPayload.message, 'Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.');
    assert.equal(localMissingTokenJsonPayload.operatorTokenConfigured, false);
    assert.equal(localMissingTokenJsonPayload.operatorTokenSource, 'unset');
    assert.deepEqual(localMissingTokenJsonPayload.failureCodes, ['operator_readiness_failed']);
    assert.deepEqual(localMissingTokenJsonPayload.scopes, {
      taskCreate: 'disabled',
      taskUpdate: 'disabled',
      subscriptionRefresh: 'disabled',
      subscriptionReplace: 'disabled',
    });

    const remoteTrusted = await summarizeEnvironment({
    SWITCHBOARD_BROKER_HOST: '0.0.0.0',
    SWITCHBOARD_ALLOW_REMOTE: '1',
    SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    SWITCHBOARD_TLS_CERT_FILE: fixtures.certFile,
    SWITCHBOARD_TLS_KEY_FILE: fixtures.keyFile,
  });
    validateRemoteTrusted(remoteTrusted);
    const remoteTrustedDoctorSummary = buildDoctorSummary(remoteTrusted, 'remote-trusted');
    assert.deepEqual(remoteTrustedDoctorSummary, {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    kind: 'operator-readiness',
    profile: 'remote-trusted',
    verdict: 'ready',
    failureCodes: [],
    advisoryCodes: [],
    message: 'remote-trusted; host=0.0.0.0',
    problems: [],
    host: '0.0.0.0',
    localOnly: false,
    allowRemote: true,
    operatorTokenConfigured: true,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    manualSubscriptionReplaceEnabled: false,
    protocol: 'https',
    tlsEnabled: true,
    tlsCertFile: 'fixture-cert.pem',
    tlsKeyFile: 'fixture-key.pem',
    tlsCaFile: undefined,
    scopes: {
      taskCreate: 'operator_token',
      taskUpdate: 'operator_token',
      subscriptionRefresh: 'operator_token',
      subscriptionReplace: 'disabled',
    },
  });
    assert.deepEqual(
      renderSummaryLines(remoteTrusted, remoteTrustedDoctorSummary, 'Operator readiness (remote-trusted)'),
      [
        'Operator readiness (remote-trusted):',
        '  verdict: ready',
        '  message: remote-trusted; host=0.0.0.0',
        '  host: 0.0.0.0',
        '  localOnly: no',
        '  allowRemote: yes',
        '  protocol: https',
        '  tlsEnabled: yes',
        '  operatorTokenConfigured: yes',
        '  operatorTokenSource: file',
        '  operatorTokenFile: operator-token',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: operator_token',
        '  taskUpdate: operator_token',
        '  subscriptionRefresh: operator_token',
        '  subscriptionReplace: disabled',
      ],
    );

    const blockedRemoteTrusted = await summarizeEnvironment({
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
    });
    const blockedRemoteDoctorSummary = buildDoctorSummary(blockedRemoteTrusted, 'remote-trusted');
    assert.deepEqual(
    blockedRemoteDoctorSummary,
    {
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      kind: 'operator-readiness',
      profile: 'remote-trusted',
      verdict: 'blocked',
      failureCodes: ['operator_readiness_failed'],
      advisoryCodes: [],
      message: 'Remote-trusted mode must bind to a non-loopback host.',
      problems: [
        'Remote-trusted mode must bind to a non-loopback host.',
        'Remote-trusted mode must set SWITCHBOARD_ALLOW_REMOTE=1.',
        'Remote-trusted mode must set SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE.',
        'Remote-trusted mode must set SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE.',
        'Remote-trusted mode must token-gate task creation.',
        'Remote-trusted mode must token-gate task updates.',
        'Remote-trusted mode must token-gate provider refresh.',
      ],
      host: '127.0.0.1',
      localOnly: true,
      allowRemote: false,
      operatorTokenConfigured: false,
      operatorTokenSource: 'unset',
      operatorTokenFile: undefined,
      manualSubscriptionReplaceEnabled: false,
      protocol: 'http',
      tlsEnabled: false,
      tlsCertFile: undefined,
      tlsKeyFile: undefined,
      tlsCaFile: undefined,
      scopes: {
        taskCreate: 'disabled',
        taskUpdate: 'disabled',
        subscriptionRefresh: 'disabled',
        subscriptionReplace: 'disabled',
      },
    },
  );
    assert.deepEqual(
      renderSummaryLines(
        blockedRemoteTrusted,
        blockedRemoteDoctorSummary,
        'Operator readiness (remote-trusted)',
      ),
      [
        'Operator readiness (remote-trusted):',
        '  verdict: blocked',
        '  message: Remote-trusted mode must bind to a non-loopback host.',
        '  failureCodes: operator_readiness_failed',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: no',
        '  operatorTokenSource: unset',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: disabled',
        '  taskUpdate: disabled',
        '  subscriptionRefresh: disabled',
        '  subscriptionReplace: disabled',
      ],
    );

    await chmod(fixtures.tokenFile, 0o644);
    const insecureTokenFile = await summarizeEnvironment({
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    });
    const insecureDoctorSummary = buildDoctorSummary(insecureTokenFile, 'local-only');
    assert.equal(
      insecureDoctorSummary.operatorTokenProblem,
      'SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
    );
    assert.deepEqual(
      renderSummaryLines(insecureTokenFile, insecureDoctorSummary, 'Operator readiness (local-only)'),
      [
        'Operator readiness (local-only):',
        '  verdict: blocked',
        '  message: SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
        '  failureCodes: operator_readiness_failed',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: no',
        '  operatorTokenSource: file',
        '  operatorTokenFile: operator-token',
        '  operatorTokenProblem: SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: disabled',
        '  taskUpdate: disabled',
        '  subscriptionRefresh: disabled',
        '  subscriptionReplace: disabled',
      ],
    );

    const insecureDefaultTokenDir = path.join(fixtures.root, '.switchboard');
    const insecureDefaultTokenFile = path.join(insecureDefaultTokenDir, 'operator-token');
    await mkdir(insecureDefaultTokenDir, { recursive: true, mode: 0o700 });
    await writeFile(insecureDefaultTokenFile, 'reviewed-default-token\n', { mode: 0o600 });
    await chmod(insecureDefaultTokenDir, 0o755);
    const insecureDefaultToken = await summarizeEnvironment({
      SWITCHBOARD_OPERATOR_TOKEN_FILE: insecureDefaultTokenFile,
    });
    const insecureDefaultDoctorSummary = buildDoctorSummary(insecureDefaultToken, 'local-only');
    assert.equal(
      insecureDefaultDoctorSummary.operatorTokenProblem,
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    );
    assert.deepEqual(
      renderSummaryLines(insecureDefaultToken, insecureDefaultDoctorSummary, 'Operator readiness (local-only)'),
      [
        'Operator readiness (local-only):',
        '  verdict: blocked',
        '  message: Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
        '  failureCodes: operator_readiness_failed',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: no',
        '  operatorTokenSource: file',
        '  operatorTokenFile: operator-token',
        '  operatorTokenProblem: Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: disabled',
        '  taskUpdate: disabled',
        '  subscriptionRefresh: disabled',
        '  subscriptionReplace: disabled',
      ],
    );

    const conflictingTokens = await summarizeEnvironment({
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    });
    const conflictingDoctorSummary = buildDoctorSummary(conflictingTokens, 'local-only');
    assert.equal(
      conflictingDoctorSummary.operatorTokenProblem,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );
    assert.deepEqual(
      renderSummaryLines(conflictingTokens, conflictingDoctorSummary, 'Operator readiness (local-only)'),
      [
        'Operator readiness (local-only):',
        '  verdict: blocked',
        '  message: Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
        '  failureCodes: operator_readiness_failed',
        '  host: 127.0.0.1',
        '  localOnly: yes',
        '  allowRemote: no',
        '  protocol: http',
        '  tlsEnabled: no',
        '  operatorTokenConfigured: no',
        '  operatorTokenSource: env',
        '  operatorTokenFile: operator-token',
        '  operatorTokenProblem: Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
        '  manualSubscriptionReplaceEnabled: no',
        '  taskCreate: disabled',
        '  taskUpdate: disabled',
        '  subscriptionRefresh: disabled',
        '  subscriptionReplace: disabled',
      ],
    );
    const conflictingTokensHuman = await runCurrentDoctor(
      'local-only',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      },
      false,
    );
    assert.equal(conflictingTokensHuman.code, 1);
    assert.match(conflictingTokensHuman.stdout, /Operator readiness \(local-only\):/);
    assert.match(
      conflictingTokensHuman.stdout,
      /message: Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );
    assert.match(conflictingTokensHuman.stdout, /operatorTokenConfigured: no/);
    assert.match(conflictingTokensHuman.stdout, /operatorTokenSource: env/);
    assert.match(conflictingTokensHuman.stdout, /operatorTokenFile: operator-token/);
    assert.match(
      conflictingTokensHuman.stdout,
      /operatorTokenProblem: Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );
    assert.match(conflictingTokensHuman.stdout, /taskCreate: disabled/);
    assert.match(
      conflictingTokensHuman.stderr,
      /Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both\./,
    );
    assert.match(conflictingTokensHuman.stderr, /Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN\./);

    const conflictingTokensJson = await runCurrentDoctor(
      'local-only',
      {
        SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      },
      true,
    );
    assert.equal(conflictingTokensJson.code, 1);
    const conflictingTokensJsonPayload = JSON.parse(conflictingTokensJson.stdout);
    assert.equal(conflictingTokensJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(conflictingTokensJsonPayload.kind, 'operator-readiness');
    assert.equal(conflictingTokensJsonPayload.profile, 'local-only');
    assert.equal(conflictingTokensJsonPayload.verdict, 'blocked');
    assert.equal(
      conflictingTokensJsonPayload.message,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );
    assert.equal(conflictingTokensJsonPayload.operatorTokenConfigured, false);
    assert.equal(conflictingTokensJsonPayload.operatorTokenSource, 'env');
    assert.equal(conflictingTokensJsonPayload.operatorTokenFile, 'operator-token');
    assert.equal(
      conflictingTokensJsonPayload.operatorTokenProblem,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );
    assert.deepEqual(conflictingTokensJsonPayload.failureCodes, ['operator_readiness_failed']);
    assert.deepEqual(conflictingTokensJsonPayload.scopes, {
      taskCreate: 'disabled',
      taskUpdate: 'disabled',
      subscriptionRefresh: 'disabled',
      subscriptionReplace: 'disabled',
    });

    console.log('Operator readiness smoke test passed.');
  } finally {
    await fixtures.cleanup();
  }
}

async function doctorCurrentEnvironment(profile, json) {
  const summary = await summarizeEnvironment(process.env);
  const doctorSummary = buildDoctorSummary(summary, profile);

  if (json) {
    console.log(JSON.stringify(doctorSummary));
  } else {
    printSummary(summary, doctorSummary, `Operator readiness (${profile})`);
  }

  if (doctorSummary.verdict === 'blocked') {
    console.error(doctorSummary.problems.join(' '));
    process.exitCode = 1;
  }
}

const mode = process.argv[2] ?? 'example-matrix';

if (mode === 'example-matrix') {
  await exampleMatrix();
} else if (mode === 'from-env') {
  const profile = process.argv[3] ?? 'local-only';
  const json = process.argv.slice(4).includes('--json');
  if (profile !== 'local-only' && profile !== 'remote-trusted') {
    throw new Error('Usage: node scripts/operator-readiness-smoke.mjs from-env <local-only|remote-trusted> [--json]');
  }

  await doctorCurrentEnvironment(profile, json);
} else {
  throw new Error('Usage: node scripts/operator-readiness-smoke.mjs <example-matrix|from-env>');
}
