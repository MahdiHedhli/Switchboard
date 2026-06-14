import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOCTOR_SCHEMA_VERSION } from './doctor-schema.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const doctorEntry = path.join(repoRoot, 'scripts/codex-app-server-doctor.mjs');

async function runDoctor(fakeCodexPath, scenario, mode, json = false) {
  return new Promise((resolve, reject) => {
    const args = json ? [doctorEntry, mode, '--json'] : [doctorEntry, mode];
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
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'switchboard-codex-app-server-doctor-smoke-'));
  const fakeCodexPath = path.join(tempRoot, 'codex');

  await writeFile(
    fakeCodexPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_CODEX_SCENARIO ?? 'app-server';
const args = process.argv.slice(2).join(' ');

if (scenario === 'unavailable' && args === 'app-server --listen stdio://') {
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
            userAgent: 'Codex Desktop/0.122.0 (app-server doctor smoke)',
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
        } else if (scenario === 'mixed-app-server') {
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
                }
              },
              rateLimitsByLimitId: {
                codex_bengalfox: {
                  limitId: 'codex_bengalfox'
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
                }
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

process.stderr.write(\`Unexpected fake codex invocation: \${args}\\n\`);
process.exit(1);
`,
    { mode: 0o700 },
  );

  try {
    const fullAllow = await runDoctor(fakeCodexPath, 'app-server', 'allow-degraded');
    assert.equal(fullAllow.code, 0);
    assert.match(fullAllow.stdout, /Codex app-server doctor:/);
    assert.match(fullAllow.stdout, /message: available/);
    assert.match(fullAllow.stdout, /user agent: Codex Desktop\/0\.122\.0/);
    assert.match(fullAllow.stdout, /account type: chatgpt/);
    assert.match(fullAllow.stdout, /plan: Pro/);
    assert.match(fullAllow.stdout, /openai auth: required/);
    assert.match(fullAllow.stdout, /rate limits: available/);
    assert.match(fullAllow.stdout, /rate-limit coverage: typed/);
    assert.match(fullAllow.stdout, /typed rate-limit buckets: 2\/2/);
    assert.match(fullAllow.stdout, /limit ids: codex, codex_bengalfox/);
    assert.match(fullAllow.stdout, /rate-limit bucket: Codex/);
    assert.match(fullAllow.stdout, /5-hour window: 91% remaining, 9% used, resets 4\/21\/2026, 7:37:43 PM/);
    assert.match(fullAllow.stdout, /rate-limit bucket: GPT-5\.3-Codex-Spark/);
    assert.match(fullAllow.stdout, /5-hour window: 100% remaining, 0% used, resets 4\/21\/2026, 10:49:53 PM/);
    assert.match(fullAllow.stdout, /Weekly window: 100% remaining, 0% used, resets 4\/28\/2026, 5:49:53 PM/);

    const fullAllowJson = await runDoctor(fakeCodexPath, 'app-server', 'allow-degraded', true);
    assert.equal(fullAllowJson.code, 0);
    assert.deepEqual(JSON.parse(fullAllowJson.stdout), {
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      kind: 'codex-app-server-doctor',
      mode: 'allow-degraded',
      verdict: 'ready',
      failureCodes: [],
      advisoryCodes: [],
      message: 'available',
      userAgent: 'Codex Desktop/0.122.0 (app-server doctor smoke)',
      accountType: 'chatgpt',
      plan: 'Pro',
      openaiAuth: 'required',
      state: 'available',
      rateLimitsAvailable: true,
      rateLimitStatus: 'available',
      rateLimitHost: null,
      endpoint: null,
      limitIds: ['codex', 'codex_bengalfox'],
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
    });

    const fullAllowJsonDashed = await runDoctor(fakeCodexPath, 'app-server', '--allow-degraded', true);
    assert.equal(fullAllowJsonDashed.code, 0);
    const fullAllowJsonDashedPayload = JSON.parse(fullAllowJsonDashed.stdout);
    assert.equal(fullAllowJsonDashedPayload.mode, 'allow-degraded');
    assert.equal(fullAllowJsonDashedPayload.verdict, 'ready');

    const fullStrict = await runDoctor(fakeCodexPath, 'app-server', 'require-rate-limits');
    assert.equal(fullStrict.code, 0);
    assert.match(fullStrict.stdout, /message: available/);
    assert.match(fullStrict.stdout, /user agent: Codex Desktop\/0\.122\.0/);
    assert.match(fullStrict.stdout, /account type: chatgpt/);
    assert.match(fullStrict.stdout, /plan: Pro/);
    assert.match(fullStrict.stdout, /rate-limit coverage: typed/);
    assert.match(fullStrict.stdout, /typed rate-limit buckets: 2\/2/);

    const mixedAllow = await runDoctor(fakeCodexPath, 'mixed-app-server', 'allow-degraded');
    assert.equal(mixedAllow.code, 0);
    assert.match(mixedAllow.stdout, /message: available \[rate-limits mixed, typed 1\/2\]/);
    assert.match(mixedAllow.stdout, /rate-limit coverage: mixed/);
    assert.match(mixedAllow.stdout, /typed rate-limit buckets: 1\/2/);
    assert.match(mixedAllow.stdout, /rate-limit bucket: Codex Bengalfox/);
    assert.match(mixedAllow.stdout, /note: Additional rate-limit bucket observed, but no window detail was returned\./);

    const mixedAllowJson = await runDoctor(fakeCodexPath, 'mixed-app-server', 'allow-degraded', true);
    assert.equal(mixedAllowJson.code, 0);
    const mixedAllowJsonPayload = JSON.parse(mixedAllowJson.stdout);
    assert.equal(mixedAllowJsonPayload.message, 'available [rate-limits mixed, typed 1/2]');
    assert.equal(mixedAllowJsonPayload.rateLimitCoverage, 'mixed');
    assert.equal(mixedAllowJsonPayload.rateLimitBucketCount, 2);
    assert.equal(mixedAllowJsonPayload.typedRateLimitBucketCount, 1);
    assert.deepEqual(mixedAllowJsonPayload.rateLimitDetails[1], {
      limitId: 'codex_bengalfox',
      displayName: 'Codex Bengalfox',
      interpretation: 'informational',
      windows: [],
      notes: 'Additional rate-limit bucket observed, but no window detail was returned.',
    });

    const partialAllow = await runDoctor(fakeCodexPath, 'partial-app-server', 'allow-degraded');
    assert.equal(partialAllow.code, 0);
    assert.match(partialAllow.stdout, /message: usage endpoint unavailable via chatgpt.com \[rate-limits none\]/);
    assert.match(partialAllow.stdout, /user agent: Codex Desktop\/0\.122\.0/);
    assert.match(partialAllow.stdout, /account type: chatgpt/);
    assert.match(partialAllow.stdout, /plan: Pro/);
    assert.match(partialAllow.stdout, /openai auth: required/);
    assert.match(partialAllow.stdout, /rate limits: usage endpoint unavailable/);
    assert.match(partialAllow.stdout, /rate-limit coverage: none/);
    assert.match(partialAllow.stdout, /rate-limit host: chatgpt.com/);
    assert.match(partialAllow.stdout, /rate-limit endpoint: https:\/\/chatgpt.com\/backend-api\/wham\/usage/);

    const partialAllowJson = await runDoctor(fakeCodexPath, 'partial-app-server', 'allow-degraded', true);
    assert.equal(partialAllowJson.code, 0);
    const partialAllowJsonPayload = JSON.parse(partialAllowJson.stdout);
    assert.equal(partialAllowJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(partialAllowJsonPayload.verdict, 'attention_required');
    assert.deepEqual(partialAllowJsonPayload.failureCodes, []);
    assert.deepEqual(partialAllowJsonPayload.advisoryCodes, ['raw_codex_app_server_degraded']);
    assert.equal(partialAllowJsonPayload.message, 'usage endpoint unavailable via chatgpt.com [rate-limits none]');
    assert.equal(partialAllowJsonPayload.state, 'usage_endpoint_unavailable');
    assert.equal(partialAllowJsonPayload.rateLimitStatus, 'usage endpoint unavailable');
    assert.equal(partialAllowJsonPayload.rateLimitHost, 'chatgpt.com');
    assert.equal(partialAllowJsonPayload.rateLimitCoverage, 'none');
    assert.equal(partialAllowJsonPayload.rateLimitBucketCount, 0);
    assert.equal(partialAllowJsonPayload.typedRateLimitBucketCount, 0);
    assert.deepEqual(partialAllowJsonPayload.rateLimitDetails, []);

    const partialStrict = await runDoctor(fakeCodexPath, 'partial-app-server', 'require-rate-limits');
    assert.notEqual(partialStrict.code, 0);
    assert.match(partialStrict.stdout, /message: usage endpoint unavailable via chatgpt.com \[rate-limits none\]/);
    assert.match(partialStrict.stdout, /user agent: Codex Desktop\/0\.122\.0/);
    assert.match(partialStrict.stdout, /account type: chatgpt/);
    assert.match(partialStrict.stdout, /plan: Pro/);
    assert.match(partialStrict.stdout, /rate limits: usage endpoint unavailable/);
    assert.match(partialStrict.stderr, /expected rate limits but found usage endpoint unavailable/);

    const partialStrictJson = await runDoctor(fakeCodexPath, 'partial-app-server', 'require-rate-limits', true);
    assert.notEqual(partialStrictJson.code, 0);
    const partialStrictJsonPayload = JSON.parse(partialStrictJson.stdout);
    assert.equal(partialStrictJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(partialStrictJsonPayload.verdict, 'blocked');
    assert.deepEqual(partialStrictJsonPayload.failureCodes, ['raw_codex_app_server_failed']);
    assert.deepEqual(partialStrictJsonPayload.advisoryCodes, []);
    assert.equal(partialStrictJsonPayload.message, 'usage endpoint unavailable via chatgpt.com [rate-limits none]');
    assert.equal(partialStrictJsonPayload.state, 'usage_endpoint_unavailable');
    assert.equal(partialStrictJsonPayload.rateLimitStatus, 'usage endpoint unavailable');
    assert.equal(partialStrictJsonPayload.rateLimitHost, 'chatgpt.com');
    assert.equal(partialStrictJsonPayload.rateLimitCoverage, 'none');
    assert.equal(partialStrictJsonPayload.rateLimitBucketCount, 0);
    assert.equal(partialStrictJsonPayload.typedRateLimitBucketCount, 0);
    assert.deepEqual(partialStrictJsonPayload.rateLimitDetails, []);
    assert.match(partialStrictJson.stderr, /expected rate limits but found usage endpoint unavailable/);

    const unavailable = await runDoctor(fakeCodexPath, 'unavailable', 'allow-degraded');
    assert.notEqual(unavailable.code, 0);
    assert.match(unavailable.stdout, /message: Codex app-server could not start\./);
    assert.match(unavailable.stdout, /rate-limit coverage: none/);
    assert.match(unavailable.stderr, /Codex app-server could not start\./);

    const unavailableJson = await runDoctor(fakeCodexPath, 'unavailable', 'allow-degraded', true);
    assert.notEqual(unavailableJson.code, 0);
    const unavailableJsonPayload = JSON.parse(unavailableJson.stdout);
    assert.equal(unavailableJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(unavailableJsonPayload.verdict, 'blocked');
    assert.deepEqual(unavailableJsonPayload.failureCodes, ['raw_codex_app_server_failed']);
    assert.deepEqual(unavailableJsonPayload.advisoryCodes, []);
    assert.equal(unavailableJsonPayload.message, 'Codex app-server could not start.');
    assert.equal(unavailableJsonPayload.state, 'app_server_unavailable');
    assert.equal(unavailableJsonPayload.rateLimitStatus, 'app-server unavailable');
    assert.equal(unavailableJsonPayload.rateLimitCoverage, 'none');
    assert.equal(unavailableJsonPayload.rateLimitBucketCount, 0);
    assert.equal(unavailableJsonPayload.typedRateLimitBucketCount, 0);
    assert.deepEqual(unavailableJsonPayload.rateLimitDetails, []);
    assert.match(unavailableJson.stderr, /Codex app-server could not start\./);

    const missingCliPath = path.join(tempRoot, 'missing-codex');
    const missingCli = await runDoctor(missingCliPath, 'app-server', 'allow-degraded');
    assert.notEqual(missingCli.code, 0);
    assert.match(missingCli.stdout, /Codex app-server doctor:/);
    assert.match(missingCli.stdout, /message: Codex app-server could not start\./);
    assert.match(missingCli.stdout, /rate-limit coverage: none/);
    assert.match(missingCli.stderr, /Codex app-server could not start\./);
    assert.ok(!missingCli.stdout.includes(missingCliPath));
    assert.ok(!missingCli.stderr.includes(missingCliPath));

    const missingCliJson = await runDoctor(missingCliPath, 'app-server', 'allow-degraded', true);
    assert.notEqual(missingCliJson.code, 0);
    const missingCliJsonPayload = JSON.parse(missingCliJson.stdout);
    assert.equal(missingCliJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(missingCliJsonPayload.verdict, 'blocked');
    assert.deepEqual(missingCliJsonPayload.failureCodes, ['raw_codex_app_server_failed']);
    assert.deepEqual(missingCliJsonPayload.advisoryCodes, []);
    assert.equal(missingCliJsonPayload.message, 'Codex app-server could not start.');
    assert.equal(missingCliJsonPayload.state, 'app_server_unavailable');
    assert.equal(missingCliJsonPayload.error, 'Codex app-server could not start.');
    assert.equal(missingCliJsonPayload.rateLimitCoverage, 'none');
    assert.equal(missingCliJsonPayload.rateLimitBucketCount, 0);
    assert.equal(missingCliJsonPayload.typedRateLimitBucketCount, 0);
    assert.deepEqual(missingCliJsonPayload.rateLimitDetails, []);
    assert.ok(!missingCliJson.stdout.includes(missingCliPath));
    assert.ok(!missingCliJson.stderr.includes(missingCliPath));

    const missingCliStrict = await runDoctor(missingCliPath, 'app-server', 'require-rate-limits');
    assert.notEqual(missingCliStrict.code, 0);
    assert.match(missingCliStrict.stdout, /Codex app-server doctor:/);
    assert.match(missingCliStrict.stdout, /message: Codex app-server could not start\./);
    assert.match(missingCliStrict.stdout, /rate-limit coverage: none/);
    assert.match(missingCliStrict.stderr, /Codex app-server could not start\./);
    assert.ok(!missingCliStrict.stdout.includes(missingCliPath));
    assert.ok(!missingCliStrict.stderr.includes(missingCliPath));

    const missingCliStrictJson = await runDoctor(missingCliPath, 'app-server', 'require-rate-limits', true);
    assert.notEqual(missingCliStrictJson.code, 0);
    const missingCliStrictJsonPayload = JSON.parse(missingCliStrictJson.stdout);
    assert.equal(missingCliStrictJsonPayload.schemaVersion, DOCTOR_SCHEMA_VERSION);
    assert.equal(missingCliStrictJsonPayload.mode, 'require-rate-limits');
    assert.equal(missingCliStrictJsonPayload.verdict, 'blocked');
    assert.deepEqual(missingCliStrictJsonPayload.failureCodes, ['raw_codex_app_server_failed']);
    assert.deepEqual(missingCliStrictJsonPayload.advisoryCodes, []);
    assert.equal(missingCliStrictJsonPayload.message, 'Codex app-server could not start.');
    assert.equal(missingCliStrictJsonPayload.state, 'app_server_unavailable');
    assert.equal(missingCliStrictJsonPayload.error, 'Codex app-server could not start.');
    assert.equal(missingCliStrictJsonPayload.rateLimitCoverage, 'none');
    assert.equal(missingCliStrictJsonPayload.rateLimitBucketCount, 0);
    assert.equal(missingCliStrictJsonPayload.typedRateLimitBucketCount, 0);
    assert.deepEqual(missingCliStrictJsonPayload.rateLimitDetails, []);
    assert.ok(!missingCliStrictJson.stdout.includes(missingCliPath));
    assert.ok(!missingCliStrictJson.stderr.includes(missingCliPath));

    console.log('Codex app-server doctor smoke test passed.');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Codex app-server doctor smoke test failed: ${message}`);
  process.exitCode = 1;
});
