import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';
import { buildSummary } from './codex-doctor.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const codexDoctorEntry = path.join(repoRoot, 'scripts/codex-doctor.mjs');

async function runDoctor(fakeCodexPath, scenario, mode, json = false) {
  return new Promise((resolve, reject) => {
    const args = json ? [codexDoctorEntry, mode, '--json'] : [codexDoctorEntry, mode];
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_CLI_PATH: fakeCodexPath,
        FAKE_CODEX_SCENARIO: scenario,
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

async function main() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-codex-doctor-smoke-'));
  const fakeCodexPath = path.join(tempRoot, 'codex');

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
            userAgent: 'Codex Desktop/0.122.0 (doctor smoke)',
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
                      limitId: 'codex_bengalfox',
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
                      },
                      credits: null,
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

  try {
    const fullAllow = await runDoctor(fakeCodexPath, 'app-server', 'allow-fallback');
    assert.equal(fullAllow.code, 0);
    assert.match(fullAllow.stdout, /message: full rate-limits available/);
    assert.match(fullAllow.stdout, /account: Codex Supervisor \(Pro\)/);
    assert.match(fullAllow.stdout, /refreshed: /);
    assert.match(fullAllow.stdout, /source: app-server rate-limits/);
    assert.match(fullAllow.stdout, /status: full rate-limits available/);
    assert.match(fullAllow.stdout, /credits: 0/);
    assert.match(fullAllow.stdout, /typed quota models: 2\/2/);
    assert.match(fullAllow.stdout, /quota model: Codex/);
    assert.match(fullAllow.stdout, /5-hour window: 91% remaining, 9% used, resets 4\/21\/2026, 7:37:43 PM/);
    assert.match(fullAllow.stdout, /Weekly window: 98% remaining, 2% used, resets 4\/28\/2026, 2:37:43 PM/);
    assert.match(fullAllow.stdout, /quota model: GPT-5\.3-Codex-Spark/);
    assert.match(fullAllow.stdout, /5-hour window: 100% remaining, 0% used, resets 4\/21\/2026, 10:49:53 PM/);
    assert.match(fullAllow.stdout, /Weekly window: 100% remaining, 0% used, resets 4\/28\/2026, 5:49:53 PM/);

    const fullAllowJson = await runDoctor(fakeCodexPath, 'app-server', 'allow-fallback', true);
    assert.equal(fullAllowJson.code, 0);
    const fullAllowJsonPayload = JSON.parse(fullAllowJson.stdout);
    assert.equal(fullAllowJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(fullAllowJsonPayload.kind, 'codex-doctor');
    assert.equal(fullAllowJsonPayload.mode, 'allow-fallback');
    assert.equal(fullAllowJsonPayload.verdict, 'ready');
    assert.deepEqual(fullAllowJsonPayload.failureCodes, []);
    assert.deepEqual(fullAllowJsonPayload.advisoryCodes, []);
    assert.equal(fullAllowJsonPayload.message, 'full rate-limits available');
    assert.equal(fullAllowJsonPayload.account, 'Codex Supervisor (Pro)');
    assert.match(fullAllowJsonPayload.refreshedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(fullAllowJsonPayload.state, 'full_rate_limits');
    assert.equal(fullAllowJsonPayload.source, 'app-server rate-limits');
    assert.equal(fullAllowJsonPayload.status, 'full rate-limits available');
    assert.equal(fullAllowJsonPayload.ok, true);
    assert.equal(fullAllowJsonPayload.rateLimitsHost, null);
    assert.equal(fullAllowJsonPayload.plan, 'Pro');
    assert.equal(fullAllowJsonPayload.openaiAuth, 'required');
    assert.equal(fullAllowJsonPayload.credits, '0');
    assert.equal(fullAllowJsonPayload.quotaCoverage, 'typed');
    assert.equal(fullAllowJsonPayload.quotaModelCount, 2);
    assert.equal(fullAllowJsonPayload.typedQuotaModelCount, 2);
    assert.equal(fullAllowJsonPayload.quotas.length, 2);
    assert.match(fullAllowJsonPayload.quotas[0], /^Codex · available · 91% budget/);
    assert.match(fullAllowJsonPayload.quotas[1], /^GPT-5\.3-Codex-Spark · available · 100% budget/);
    assert.deepEqual(fullAllowJsonPayload.quotaDetails, [
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
    ]);

    const mixedAllowJson = await runDoctor(fakeCodexPath, 'mixed-app-server', 'allow-fallback', true);
    assert.equal(mixedAllowJson.code, 0);
    const mixedAllowJsonPayload = JSON.parse(mixedAllowJson.stdout);
    assert.equal(mixedAllowJsonPayload.verdict, 'ready');
    assert.equal(mixedAllowJsonPayload.message, 'full rate-limits available [quota mixed, typed 1/2]');
    assert.equal(mixedAllowJsonPayload.quotaCoverage, 'mixed');
    assert.equal(mixedAllowJsonPayload.quotaModelCount, 2);
    assert.equal(mixedAllowJsonPayload.typedQuotaModelCount, 1);
    assert.equal(mixedAllowJsonPayload.quotaDetails.length, 2);

    const mixedAllow = await runDoctor(fakeCodexPath, 'mixed-app-server', 'allow-fallback');
    assert.equal(mixedAllow.code, 0);
    assert.match(mixedAllow.stdout, /message: full rate-limits available \[quota mixed, typed 1\/2\]/);
    assert.match(mixedAllow.stdout, /account: Codex Supervisor \(Pro\)/);
    assert.match(mixedAllow.stdout, /refreshed: /);
    assert.match(mixedAllow.stdout, /source: app-server rate-limits/);
    assert.match(mixedAllow.stdout, /status: full rate-limits available/);
    assert.match(mixedAllow.stdout, /plan: Pro/);
    assert.match(mixedAllow.stdout, /openai auth: required/);
    assert.match(mixedAllow.stdout, /credits: 0/);
    assert.match(mixedAllow.stdout, /quota coverage: mixed/);
    assert.match(mixedAllow.stdout, /typed quota models: 1\/2/);
    assert.match(mixedAllow.stdout, /quota model: Codex Bengalfox/);
    assert.match(mixedAllow.stdout, /current window:/);

    const fullAllowJsonDashed = await runDoctor(fakeCodexPath, 'app-server', '--allow-fallback', true);
    assert.equal(fullAllowJsonDashed.code, 0);
    const fullAllowJsonDashedPayload = JSON.parse(fullAllowJsonDashed.stdout);
    assert.equal(fullAllowJsonDashedPayload.mode, 'allow-fallback');
    assert.equal(fullAllowJsonDashedPayload.verdict, 'ready');

    const fullStrict = await runDoctor(fakeCodexPath, 'app-server', 'require-rate-limits');
    assert.equal(fullStrict.code, 0);
    assert.match(fullStrict.stdout, /message: full rate-limits available/);
    assert.match(fullStrict.stdout, /status: full rate-limits available/);
    assert.match(fullStrict.stdout, /quota coverage: typed/);

    const partialAllow = await runDoctor(fakeCodexPath, 'partial-app-server', 'allow-fallback');
    assert.equal(partialAllow.code, 0);
    assert.match(
      partialAllow.stdout,
      /message: partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(partialAllow.stdout, /account: Codex Supervisor \(Pro\)/);
    assert.match(partialAllow.stdout, /refreshed: /);
    assert.match(partialAllow.stdout, /source: app-server account/);
    assert.match(partialAllow.stdout, /status: partial app-server context \(usage endpoint unavailable via chatgpt.com\)/);
    assert.match(partialAllow.stdout, /plan: Pro/);
    assert.match(partialAllow.stdout, /openai auth: required/);
    assert.match(partialAllow.stdout, /partial app-server context \(usage endpoint unavailable via chatgpt.com\)/);
    assert.match(partialAllow.stdout, /quota coverage: informational_only/);
    assert.match(partialAllow.stdout, /typed quota models: 0\/1/);
    assert.match(partialAllow.stdout, /quota model: Codex/);
    assert.match(
      partialAllow.stdout,
      /note: Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop\/0\.122\.0 \(doctor smoke\)/,
    );

    const partialAllowJson = await runDoctor(fakeCodexPath, 'partial-app-server', 'allow-fallback', true);
    assert.equal(partialAllowJson.code, 0);
    const partialAllowJsonPayload = JSON.parse(partialAllowJson.stdout);
    assert.equal(partialAllowJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(partialAllowJsonPayload.verdict, 'attention_required');
    assert.deepEqual(partialAllowJsonPayload.failureCodes, []);
    assert.deepEqual(partialAllowJsonPayload.advisoryCodes, ['codex_wrapper_partial_app_server']);
    assert.equal(
      partialAllowJsonPayload.message,
      'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    );
    assert.equal(partialAllowJsonPayload.state, 'partial_app_server');
    assert.equal(partialAllowJsonPayload.status, 'partial app-server context (usage endpoint unavailable via chatgpt.com)');
    assert.equal(partialAllowJsonPayload.rateLimitsHost, 'chatgpt.com');
    assert.equal(partialAllowJsonPayload.quotaCoverage, 'informational_only');
    assert.equal(partialAllowJsonPayload.quotaModelCount, 1);
    assert.equal(partialAllowJsonPayload.typedQuotaModelCount, 0);
    assert.deepEqual(partialAllowJsonPayload.quotaDetails, [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'unknown',
        interpretation: 'informational',
        source: 'cli',
        confidence: 'medium',
        notes: 'Informational only: Codex app-server returned account metadata but no rate-limit snapshot; userAgent=Codex Desktop/0.122.0 (doctor smoke)',
      },
    ]);

    const partialStrict = await runDoctor(fakeCodexPath, 'partial-app-server', 'require-rate-limits');
    assert.notEqual(partialStrict.code, 0);
    assert.match(
      partialStrict.stdout,
      /message: partial app-server context \(usage endpoint unavailable via chatgpt.com\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(partialStrict.stdout, /source: app-server account/);
    assert.match(
      partialStrict.stderr,
      /expected full app-server rate limits but found partial app-server context \(usage endpoint unavailable via chatgpt.com\)/,
    );

    const partialStrictJson = await runDoctor(fakeCodexPath, 'partial-app-server', 'require-rate-limits', true);
    assert.notEqual(partialStrictJson.code, 0);
    const partialStrictJsonPayload = JSON.parse(partialStrictJson.stdout);
    assert.equal(
      partialStrictJsonPayload.status,
      'partial app-server context (usage endpoint unavailable via chatgpt.com)',
    );
    assert.equal(partialStrictJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(partialStrictJsonPayload.verdict, 'blocked');
    assert.deepEqual(partialStrictJsonPayload.failureCodes, ['codex_wrapper_failed']);
    assert.deepEqual(partialStrictJsonPayload.advisoryCodes, []);
    assert.equal(
      partialStrictJsonPayload.message,
      'partial app-server context (usage endpoint unavailable via chatgpt.com) [quota informational_only, typed 0/1]',
    );
    assert.equal(partialStrictJsonPayload.state, 'partial_app_server');
    assert.match(
      partialStrictJson.stderr,
      /expected full app-server rate limits but found partial app-server context \(usage endpoint unavailable via chatgpt.com\)/,
    );

    const fallbackAllow = await runDoctor(fakeCodexPath, 'fallback', 'allow-fallback');
    assert.equal(fallbackAllow.code, 0);
    assert.match(
      fallbackAllow.stdout,
      /message: login fallback \(app-server unavailable\) \[quota informational_only, typed 0\/1\]/,
    );
    assert.match(fallbackAllow.stdout, /account: Codex Supervisor/);
    assert.match(fallbackAllow.stdout, /refreshed: /);
    assert.match(fallbackAllow.stdout, /source: login-status fallback/);
    assert.match(fallbackAllow.stdout, /login fallback \(app-server unavailable\)/);
    assert.match(fallbackAllow.stdout, /quota coverage: informational_only/);
    assert.match(fallbackAllow.stdout, /typed quota models: 0\/1/);
    assert.match(fallbackAllow.stdout, /quota model: Codex/);
    assert.match(
      fallbackAllow.stdout,
      /note: codex=codex-cli 0\.122\.0-alpha\.1; Codex CLI reports ChatGPT-backed login, but typed rate-limit data was unavailable locally\./,
    );

    const fallbackAllowJson = await runDoctor(fakeCodexPath, 'fallback', 'allow-fallback', true);
    assert.equal(fallbackAllowJson.code, 0);
    const fallbackAllowJsonPayload = JSON.parse(fallbackAllowJson.stdout);
    assert.equal(fallbackAllowJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(fallbackAllowJsonPayload.verdict, 'attention_required');
    assert.deepEqual(fallbackAllowJsonPayload.failureCodes, []);
    assert.deepEqual(fallbackAllowJsonPayload.advisoryCodes, ['codex_wrapper_login_fallback']);
    assert.equal(fallbackAllowJsonPayload.state, 'login_fallback');
    assert.equal(fallbackAllowJsonPayload.status, 'login fallback (app-server unavailable)');
    assert.equal(fallbackAllowJsonPayload.message, 'login fallback (app-server unavailable) [quota informational_only, typed 0/1]');
    assert.equal(fallbackAllowJsonPayload.quotaCoverage, 'informational_only');
    assert.equal(fallbackAllowJsonPayload.quotaModelCount, 1);
    assert.equal(fallbackAllowJsonPayload.typedQuotaModelCount, 0);
    assert.deepEqual(fallbackAllowJsonPayload.quotaDetails, [
      {
        modelId: 'codex',
        displayName: 'Codex',
        availability: 'available',
        authMode: 'subscription',
        usageUnit: 'unknown',
        interpretation: 'informational',
        source: 'cli',
        confidence: 'medium',
        notes: 'codex=codex-cli 0.122.0-alpha.1; Codex CLI reports ChatGPT-backed login, but typed rate-limit data was unavailable locally.',
      },
    ]);

    const unknownSourcePayload = {
      accounts: [
        {
          displayName: 'Codex Supervisor (Pro)',
          lastRefreshedAt: '2026-04-22T03:45:00.000Z',
          signals: [
            { id: 'source', value: 'mystery backend' },
            { id: 'plan', value: 'Pro' },
            { id: 'openai_auth', value: 'required' },
          ],
          quotas: [],
        },
      ],
    };

    const unknownSourceAllowSummary = buildSummary(unknownSourcePayload, 'allow-fallback');
    assert.equal(unknownSourceAllowSummary.verdict, 'attention_required');
    assert.deepEqual(unknownSourceAllowSummary.failureCodes, []);
    assert.deepEqual(unknownSourceAllowSummary.advisoryCodes, ['codex_wrapper_degraded']);
    assert.equal(unknownSourceAllowSummary.message, 'unknown source');
    assert.equal(unknownSourceAllowSummary.state, 'unknown_source');
    assert.equal(unknownSourceAllowSummary.source, 'mystery backend');
    assert.equal(unknownSourceAllowSummary.status, 'unknown source');
    assert.equal(unknownSourceAllowSummary.ok, false);
    assert.equal(unknownSourceAllowSummary.plan, 'Pro');
    assert.equal(unknownSourceAllowSummary.openaiAuth, 'required');
    assert.equal(unknownSourceAllowSummary.quotaCoverage, 'none');
    assert.equal(unknownSourceAllowSummary.quotaModelCount, 0);
    assert.equal(unknownSourceAllowSummary.typedQuotaModelCount, 0);
    assert.deepEqual(unknownSourceAllowSummary.quotaDetails, []);

    const unknownSourceStrictSummary = buildSummary(unknownSourcePayload, 'require-rate-limits');
    assert.equal(unknownSourceStrictSummary.verdict, 'blocked');
    assert.deepEqual(unknownSourceStrictSummary.failureCodes, ['codex_wrapper_failed']);
    assert.deepEqual(unknownSourceStrictSummary.advisoryCodes, []);
    assert.equal(unknownSourceStrictSummary.message, 'unknown source');
    assert.equal(unknownSourceStrictSummary.state, 'unknown_source');
    assert.equal(unknownSourceStrictSummary.source, 'mystery backend');
    assert.equal(unknownSourceStrictSummary.status, 'unknown source');
    assert.equal(unknownSourceStrictSummary.quotaCoverage, 'none');

    const missingCliPath = path.join(tempRoot, 'missing-codex');
    const missingCli = await runDoctor(missingCliPath, 'app-server', 'allow-fallback');
    assert.notEqual(missingCli.code, 0);
    assert.match(missingCli.stdout, /Codex doctor:/);
    assert.match(missingCli.stdout, /message: Codex CLI could not start\./);
    assert.match(missingCli.stdout, /quota coverage: none/);
    assert.match(missingCli.stderr, /Codex CLI could not start\./);
    assert.ok(!missingCli.stdout.includes(missingCliPath));
    assert.ok(!missingCli.stderr.includes(missingCliPath));

    const missingCliJson = await runDoctor(missingCliPath, 'app-server', 'allow-fallback', true);
    assert.notEqual(missingCliJson.code, 0);
    const missingCliJsonPayload = JSON.parse(missingCliJson.stdout);
    assert.equal(missingCliJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(missingCliJsonPayload.verdict, 'blocked');
    assert.deepEqual(missingCliJsonPayload.failureCodes, ['codex_wrapper_failed']);
    assert.deepEqual(missingCliJsonPayload.advisoryCodes, []);
    assert.equal(missingCliJsonPayload.message, 'Codex CLI could not start.');
    assert.equal(missingCliJsonPayload.state, 'cli_unavailable');
    assert.equal(missingCliJsonPayload.status, 'Codex CLI could not start.');
    assert.equal(missingCliJsonPayload.quotaCoverage, 'none');
    assert.equal(missingCliJsonPayload.quotaModelCount, 0);
    assert.equal(missingCliJsonPayload.typedQuotaModelCount, 0);
    assert.deepEqual(missingCliJsonPayload.quotaDetails, []);
    assert.equal(missingCliJsonPayload.error, 'Codex CLI could not start.');
    assert.ok(!missingCliJson.stdout.includes(missingCliPath));
    assert.ok(!missingCliJson.stderr.includes(missingCliPath));

    const missingCliStrict = await runDoctor(missingCliPath, 'app-server', 'require-rate-limits');
    assert.notEqual(missingCliStrict.code, 0);
    assert.match(missingCliStrict.stdout, /Codex doctor:/);
    assert.match(missingCliStrict.stdout, /message: Codex CLI could not start\./);
    assert.match(missingCliStrict.stdout, /quota coverage: none/);
    assert.match(missingCliStrict.stderr, /Codex CLI could not start\./);
    assert.ok(!missingCliStrict.stdout.includes(missingCliPath));
    assert.ok(!missingCliStrict.stderr.includes(missingCliPath));

    const missingCliStrictJson = await runDoctor(missingCliPath, 'app-server', 'require-rate-limits', true);
    assert.notEqual(missingCliStrictJson.code, 0);
    const missingCliStrictJsonPayload = JSON.parse(missingCliStrictJson.stdout);
    assert.equal(missingCliStrictJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(missingCliStrictJsonPayload.mode, 'require-rate-limits');
    assert.equal(missingCliStrictJsonPayload.verdict, 'blocked');
    assert.deepEqual(missingCliStrictJsonPayload.failureCodes, ['codex_wrapper_failed']);
    assert.deepEqual(missingCliStrictJsonPayload.advisoryCodes, []);
    assert.equal(missingCliStrictJsonPayload.message, 'Codex CLI could not start.');
    assert.equal(missingCliStrictJsonPayload.state, 'cli_unavailable');
    assert.equal(missingCliStrictJsonPayload.status, 'Codex CLI could not start.');
    assert.equal(missingCliStrictJsonPayload.quotaCoverage, 'none');
    assert.equal(missingCliStrictJsonPayload.quotaModelCount, 0);
    assert.equal(missingCliStrictJsonPayload.typedQuotaModelCount, 0);
    assert.deepEqual(missingCliStrictJsonPayload.quotaDetails, []);
    assert.equal(missingCliStrictJsonPayload.error, 'Codex CLI could not start.');
    assert.ok(!missingCliStrictJson.stdout.includes(missingCliPath));
    assert.ok(!missingCliStrictJson.stderr.includes(missingCliPath));

    console.log('Codex doctor smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Codex doctor smoke test failed: ${message}`);
  process.exitCode = 1;
});
