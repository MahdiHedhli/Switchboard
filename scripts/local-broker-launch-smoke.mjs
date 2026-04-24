import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  applyLocalBrokerDefaults,
  buildLocalBrokerEnvironment,
  defaultLocalOpenaiRefreshCommand,
} = await import(path.join(repoRoot, 'scripts/local-broker-launch.mjs'));
const { defaultOperatorTokenFile } = await import(path.join(repoRoot, 'scripts/operator-token-path.mjs'));
const {
  parseArgs: parseSaveOperatorTokenArgs,
  saveOperatorTokenUsage,
} = await import(path.join(repoRoot, 'scripts/save-operator-token.mjs'));
const { defaultLocalOpenaiRefreshCommandNotice } = await import(path.join(repoRoot, 'scripts/start-local-broker.mjs'));
const {
  buildRemoteTrustedBrokerEnvironment,
  remoteTrustedBrokerDefaultTokenFile,
  remoteTrustedBrokerTlsRequirementMessage,
} = await import(path.join(repoRoot, 'scripts/start-remote-trusted-broker.mjs'));

async function importModuleSilently(modulePath) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', `import(${JSON.stringify(pathToFileURL(modulePath).href)});`],
      {
        cwd: repoRoot,
        env: process.env,
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

async function runScriptSilently(scriptPath, scriptArgs = [], envOverrides = {}) {
  const env = {
    ...process.env,
    ...envOverrides,
  };

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    }
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
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
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
      });
    });
  });
}

const rootPackage = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const brokerPackage = JSON.parse(await readFile(path.join(repoRoot, 'apps/broker/package.json'), 'utf8'));

assert.equal(rootPackage.scripts['dev:broker'], 'npm --workspace @switchboard/broker run dev');
assert.equal(
  rootPackage.scripts['dev:broker:remote-trusted'],
  'npm --workspace @switchboard/broker run build && node scripts/start-remote-trusted-broker.mjs',
);
assert.equal(brokerPackage.scripts.dev, 'npm run build && node ../../scripts/start-local-broker.mjs');

const localLauncherImport = await importModuleSilently(path.join(repoRoot, 'scripts/start-local-broker.mjs'));
assert.equal(localLauncherImport.code, 0);
assert.equal(localLauncherImport.stdout, '');
assert.equal(localLauncherImport.stderr, '');

const saveOperatorTokenImport = await importModuleSilently(path.join(repoRoot, 'scripts/save-operator-token.mjs'));
assert.equal(saveOperatorTokenImport.code, 0);
assert.equal(saveOperatorTokenImport.stdout, '');
assert.equal(saveOperatorTokenImport.stderr, '');
const invalidSaveOperatorTokenInvocation = await runScriptSilently(
  path.join(repoRoot, 'scripts/save-operator-token.mjs'),
  ['--file'],
);
assert.equal(invalidSaveOperatorTokenInvocation.code, 1);
assert.equal(invalidSaveOperatorTokenInvocation.stdout, '');
assert.equal(
  invalidSaveOperatorTokenInvocation.stderr,
  `Failed to save operator token: ${saveOperatorTokenUsage}`,
);
const unknownSaveOperatorTokenInvocation = await runScriptSilently(
  path.join(repoRoot, 'scripts/save-operator-token.mjs'),
  ['--prnit'],
);
assert.equal(unknownSaveOperatorTokenInvocation.code, 1);
assert.equal(unknownSaveOperatorTokenInvocation.stdout, '');
assert.equal(
  unknownSaveOperatorTokenInvocation.stderr,
  `Failed to save operator token: ${saveOperatorTokenUsage}`,
);

const remoteLauncherImport = await importModuleSilently(path.join(repoRoot, 'scripts/start-remote-trusted-broker.mjs'));
assert.equal(remoteLauncherImport.code, 0);
assert.equal(remoteLauncherImport.stdout, '');
assert.equal(remoteLauncherImport.stderr, '');
assert.equal(defaultOperatorTokenFile, remoteTrustedBrokerDefaultTokenFile);
assert.equal(parseSaveOperatorTokenArgs([]).file, defaultOperatorTokenFile);
assert.equal(
  parseSaveOperatorTokenArgs(['--file', '/tmp/reviewed-operator-token']).file,
  '/tmp/reviewed-operator-token',
);
assert.match(remoteTrustedBrokerTlsRequirementMessage, /SWITCHBOARD_TLS_CERT_FILE/);
assert.equal(remoteTrustedBrokerTlsRequirementMessage.includes(repoRoot), false);
assert.equal(remoteTrustedBrokerTlsRequirementMessage.includes('/Users/'), false);
assert.equal(path.basename(remoteTrustedBrokerDefaultTokenFile), 'operator-token');
assert.match(remoteTrustedBrokerDefaultTokenFile, /\.switchboard[/\\]operator-token$/);

const remoteTrustedDefaults = buildRemoteTrustedBrokerEnvironment({
  SWITCHBOARD_TLS_CERT_FILE: '/tmp/reviewed-cert.pem',
  SWITCHBOARD_TLS_KEY_FILE: '/tmp/reviewed-key.pem',
});
assert.equal(remoteTrustedDefaults.SWITCHBOARD_BROKER_HOST, '0.0.0.0');
assert.equal(remoteTrustedDefaults.SWITCHBOARD_BROKER_PORT, '7007');
assert.equal(remoteTrustedDefaults.SWITCHBOARD_ALLOW_REMOTE, '1');
assert.equal(remoteTrustedDefaults.SWITCHBOARD_OPERATOR_TOKEN_FILE, remoteTrustedBrokerDefaultTokenFile);

const remoteTrustedExplicit = buildRemoteTrustedBrokerEnvironment({
  SWITCHBOARD_BROKER_HOST: 'example.internal',
  SWITCHBOARD_BROKER_PORT: '7443',
  SWITCHBOARD_OPERATOR_TOKEN_FILE: '/tmp/reviewed-operator-token',
  SWITCHBOARD_TLS_CERT_FILE: '/tmp/reviewed-cert.pem',
  SWITCHBOARD_TLS_KEY_FILE: '/tmp/reviewed-key.pem',
});
assert.equal(remoteTrustedExplicit.SWITCHBOARD_BROKER_HOST, 'example.internal');
assert.equal(remoteTrustedExplicit.SWITCHBOARD_BROKER_PORT, '7443');
assert.equal(remoteTrustedExplicit.SWITCHBOARD_OPERATOR_TOKEN_FILE, '/tmp/reviewed-operator-token');

const saveOperatorTokenScript = path.join(repoRoot, 'scripts/save-operator-token.mjs');
const saveOperatorTokenHome = await mkdtemp(path.join(os.tmpdir(), 'switchboard-operator-token-home-'));
const saveOperatorTokenDefaultFile = path.join(saveOperatorTokenHome, '.switchboard', 'operator-token');

const initialTokenSave = await runScriptSilently(saveOperatorTokenScript, [], {
  HOME: saveOperatorTokenHome,
});
assert.equal(initialTokenSave.code, 0);
assert.equal(initialTokenSave.stderr, '');
assert.equal(
  initialTokenSave.stdout,
  [
    `Saved Switchboard operator token to ${saveOperatorTokenDefaultFile}`,
    'File permissions were set to owner-only access.',
    'Token value was not printed. Use --print only if you explicitly need to copy it once.',
  ].join('\n'),
);
const initialTokenValue = await readFile(saveOperatorTokenDefaultFile, 'utf8');
assert.match(initialTokenValue, /^[0-9a-f]{64}\n$/);
assert.equal((await stat(saveOperatorTokenDefaultFile)).mode & 0o777, 0o600);
assert.equal((await stat(path.dirname(saveOperatorTokenDefaultFile))).mode & 0o777, 0o700);

const duplicateTokenSave = await runScriptSilently(saveOperatorTokenScript, [], {
  HOME: saveOperatorTokenHome,
});
assert.equal(duplicateTokenSave.code, 1);
assert.equal(duplicateTokenSave.stdout, '');
assert.equal(
  duplicateTokenSave.stderr,
  `Failed to save operator token: Operator token file already exists at ${saveOperatorTokenDefaultFile}. Re-run with --rotate to replace it.`,
);

await chmod(saveOperatorTokenDefaultFile, 0o644);
await chmod(path.dirname(saveOperatorTokenDefaultFile), 0o755);
assert.equal((await stat(saveOperatorTokenDefaultFile)).mode & 0o777, 0o644);
assert.equal((await stat(path.dirname(saveOperatorTokenDefaultFile))).mode & 0o777, 0o755);

const rotatedTokenSave = await runScriptSilently(saveOperatorTokenScript, ['--rotate', '--print'], {
  HOME: saveOperatorTokenHome,
});
assert.equal(rotatedTokenSave.code, 0);
assert.equal(rotatedTokenSave.stderr, '');
const rotatedTokenLines = rotatedTokenSave.stdout.split('\n');
assert.deepEqual(rotatedTokenLines.slice(0, 2), [
  `Saved Switchboard operator token to ${saveOperatorTokenDefaultFile}`,
  'File permissions were set to owner-only access.',
]);
assert.equal(rotatedTokenLines.length, 3);
assert.match(rotatedTokenLines[2], /^Token: [0-9a-f]{64}$/);
const rotatedTokenValue = await readFile(saveOperatorTokenDefaultFile, 'utf8');
assert.match(rotatedTokenValue, /^[0-9a-f]{64}\n$/);
assert.equal(rotatedTokenLines[2], `Token: ${rotatedTokenValue.trim()}`);
assert.notEqual(rotatedTokenValue, initialTokenValue);
assert.equal((await stat(saveOperatorTokenDefaultFile)).mode & 0o777, 0o600);
assert.equal((await stat(path.dirname(saveOperatorTokenDefaultFile))).mode & 0o777, 0o700);

const customTokenDirectory = path.join(saveOperatorTokenHome, 'custom-token-dir');
const customTokenFile = path.join(customTokenDirectory, 'reviewed-token');
await mkdir(customTokenDirectory, { recursive: true, mode: 0o755 });
await chmod(customTokenDirectory, 0o755);
assert.equal((await stat(customTokenDirectory)).mode & 0o777, 0o755);

const customTokenSave = await runScriptSilently(saveOperatorTokenScript, ['--file', customTokenFile], {
  HOME: saveOperatorTokenHome,
});
assert.equal(customTokenSave.code, 0);
assert.equal(customTokenSave.stderr, '');
assert.equal(
  customTokenSave.stdout,
  [
    `Saved Switchboard operator token to ${customTokenFile}`,
    'File permissions were set to owner-only access.',
    'Token value was not printed. Use --print only if you explicitly need to copy it once.',
  ].join('\n'),
);
const customTokenValue = await readFile(customTokenFile, 'utf8');
assert.match(customTokenValue, /^[0-9a-f]{64}\n$/);
assert.equal((await stat(customTokenFile)).mode & 0o777, 0o600);
assert.equal((await stat(customTokenDirectory)).mode & 0o777, 0o755);

const remoteLauncherMissingTls = await runScriptSilently(path.join(repoRoot, 'scripts/start-remote-trusted-broker.mjs'), [], {
  SWITCHBOARD_TLS_CERT_FILE: undefined,
  SWITCHBOARD_TLS_KEY_FILE: undefined,
});
assert.equal(remoteLauncherMissingTls.code, 1);
assert.equal(remoteLauncherMissingTls.stdout, '');
assert.equal(
  remoteLauncherMissingTls.stderr,
  remoteTrustedBrokerTlsRequirementMessage,
);

const defaultLaunch = await buildLocalBrokerEnvironment({}, { repoRootPath: repoRoot });
assert.equal(defaultLaunch.env.SWITCHBOARD_BROKER_HOST, '127.0.0.1');
assert.equal(defaultLaunch.env.SWITCHBOARD_BROKER_PORT, '7007');
assert.equal(defaultLaunch.env.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON, defaultLocalOpenaiRefreshCommand);
assert.equal(defaultLaunch.inferredOpenaiRefreshCommand, true);
assert.equal(
  defaultLocalOpenaiRefreshCommandNotice,
  'Switchboard local broker is using the default reviewed OpenAI refresh command because no explicit OpenAI adapter env or sanitized openai.json snapshot was found.',
);
assert.equal(defaultLocalOpenaiRefreshCommandNotice.includes(repoRoot), false);
assert.equal(defaultLocalOpenaiRefreshCommandNotice.includes('/Users/'), false);
assert.equal(defaultLocalOpenaiRefreshCommandNotice.includes('openai-codex-sync.mjs'), false);

const explicitLaunch = await buildLocalBrokerEnvironment({
  SWITCHBOARD_BROKER_HOST: '127.0.0.1',
  SWITCHBOARD_BROKER_PORT: '9001',
  SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON: '["node","/tmp/custom-openai-sync.mjs"]',
}, { repoRootPath: repoRoot });
assert.equal(explicitLaunch.env.SWITCHBOARD_BROKER_HOST, '127.0.0.1');
assert.equal(explicitLaunch.env.SWITCHBOARD_BROKER_PORT, '9001');
assert.equal(
  explicitLaunch.env.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON,
  '["node","/tmp/custom-openai-sync.mjs"]',
);
assert.equal(explicitLaunch.inferredOpenaiRefreshCommand, false);

const inferredOverrideLaunch = await buildLocalBrokerEnvironment({
  SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON: '["node","/tmp/reviewed-local-default.mjs"]',
}, { repoRootPath: repoRoot });
assert.equal(
  inferredOverrideLaunch.env.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON,
  '["node","/tmp/reviewed-local-default.mjs"]',
);
assert.equal(inferredOverrideLaunch.inferredOpenaiRefreshCommand, true);

const skippedDefaultsEnv = {
  SWITCHBOARD_SKIP_LOCAL_BROKER_DEFAULTS: '1',
};
await applyLocalBrokerDefaults(skippedDefaultsEnv, { repoRootPath: repoRoot });
assert.equal(skippedDefaultsEnv.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON, undefined);

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'switchboard-local-broker-launch-'));
const snapshotDir = path.join(tempRoot, 'provider-snapshots');
await mkdir(snapshotDir, { recursive: true, mode: 0o700 });
await writeFile(path.join(snapshotDir, 'openai.json'), '{}\n', { mode: 0o600 });

const snapshotLaunch = await buildLocalBrokerEnvironment({
  SWITCHBOARD_SNAPSHOT_DIR: snapshotDir,
}, { repoRootPath: repoRoot });
assert.equal(snapshotLaunch.env.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON, undefined);
assert.equal(snapshotLaunch.inferredOpenaiRefreshCommand, false);

console.log('Local broker launch smoke test passed.');
