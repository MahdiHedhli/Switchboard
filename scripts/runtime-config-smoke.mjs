import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeSecurityFixtures } from './runtime-security-fixtures.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  summarizeBrokerRuntimeEnvironment,
  loadBrokerRuntimeConfig,
} = await import(path.join(repoRoot, 'apps/broker/dist/runtime-config.js'));

async function withEnvironment(overrides, callback) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main() {
  const fixtures = await createRuntimeSecurityFixtures('switchboard-runtime-config-smoke-');

  try {
    const localSummary = await summarizeBrokerRuntimeEnvironment({
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
    });

    assert.deepEqual(localSummary, {
      host: '127.0.0.1',
      port: 7007,
      localOnly: true,
      allowRemote: false,
      manualSubscriptionReplaceEnabled: false,
      operatorTokenConfigured: true,
      operatorTokenSource: 'env',
      operatorTokenFile: undefined,
      operatorTokenProblem: undefined,
      protocol: 'http',
      tlsEnabled: false,
      tlsCertFile: undefined,
      tlsKeyFile: undefined,
      tlsCaFile: undefined,
      tlsProblem: undefined,
    });

    const localFileSummary = await summarizeBrokerRuntimeEnvironment({
      SWITCHBOARD_BROKER_HOST: '127.0.0.1',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    });

    assert.deepEqual(localFileSummary, {
      host: '127.0.0.1',
      port: 7007,
      localOnly: true,
      allowRemote: false,
      manualSubscriptionReplaceEnabled: false,
      operatorTokenConfigured: true,
      operatorTokenSource: 'file',
      operatorTokenFile: 'operator-token',
      operatorTokenProblem: undefined,
      protocol: 'http',
      tlsEnabled: false,
      tlsCertFile: undefined,
      tlsKeyFile: undefined,
      tlsCaFile: undefined,
      tlsProblem: undefined,
    });

    const remoteSummary = await summarizeBrokerRuntimeEnvironment({
      SWITCHBOARD_BROKER_HOST: '0.0.0.0',
      SWITCHBOARD_ALLOW_REMOTE: '1',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      SWITCHBOARD_TLS_CERT_FILE: fixtures.certFile,
      SWITCHBOARD_TLS_KEY_FILE: fixtures.keyFile,
    });

    assert.deepEqual(remoteSummary, {
      host: '0.0.0.0',
      port: 7007,
      localOnly: false,
      allowRemote: true,
      manualSubscriptionReplaceEnabled: false,
      operatorTokenConfigured: true,
      operatorTokenSource: 'file',
      operatorTokenFile: 'operator-token',
      operatorTokenProblem: undefined,
      protocol: 'https',
      tlsEnabled: true,
      tlsCertFile: 'fixture-cert.pem',
      tlsKeyFile: 'fixture-key.pem',
      tlsCaFile: undefined,
      tlsProblem: undefined,
    });

    const conflictingTokenSummary = await summarizeBrokerRuntimeEnvironment({
      SWITCHBOARD_OPERATOR_TOKEN: 'reviewed-local-token',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    });

    assert.equal(conflictingTokenSummary.operatorTokenConfigured, false);
    assert.equal(conflictingTokenSummary.operatorTokenSource, 'env');
    assert.equal(conflictingTokenSummary.operatorTokenFile, 'operator-token');
    assert.equal(
      conflictingTokenSummary.operatorTokenProblem,
      'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    );

    await chmod(fixtures.tokenFile, 0o644);
    const insecureTokenSummary = await summarizeBrokerRuntimeEnvironment({
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
    });

    assert.equal(insecureTokenSummary.operatorTokenConfigured, false);
    assert.equal(insecureTokenSummary.operatorTokenSource, 'file');
    assert.equal(insecureTokenSummary.operatorTokenFile, 'operator-token');
    assert.match(
      insecureTokenSummary.operatorTokenProblem ?? '',
      /SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others\. Use chmod 600\./,
    );
    assert.equal(JSON.stringify(insecureTokenSummary).includes(fixtures.root), false);

    await chmod(fixtures.tokenFile, 0o600);

    const insecureDefaultTokenDir = path.join(fixtures.root, '.switchboard');
    const insecureDefaultTokenFile = path.join(insecureDefaultTokenDir, 'operator-token');
    await mkdir(insecureDefaultTokenDir, { recursive: true, mode: 0o700 });
    await writeFile(insecureDefaultTokenFile, 'reviewed-default-token\n', { mode: 0o600 });
    await chmod(insecureDefaultTokenDir, 0o755);
    const insecureDefaultTokenSummary = await summarizeBrokerRuntimeEnvironment({
      SWITCHBOARD_OPERATOR_TOKEN_FILE: insecureDefaultTokenFile,
    });

    assert.equal(insecureDefaultTokenSummary.operatorTokenConfigured, false);
    assert.equal(insecureDefaultTokenSummary.operatorTokenSource, 'file');
    assert.equal(insecureDefaultTokenSummary.operatorTokenFile, 'operator-token');
    assert.match(
      insecureDefaultTokenSummary.operatorTokenProblem ?? '',
      /Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others\. Use chmod 700\./,
    );
    assert.equal(JSON.stringify(insecureDefaultTokenSummary).includes(fixtures.root), false);

    await assert.rejects(
      () => withEnvironment({
        SWITCHBOARD_ALLOW_REMOTE: '1',
        SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
        SWITCHBOARD_TLS_CERT_FILE: undefined,
        SWITCHBOARD_TLS_KEY_FILE: undefined,
        SWITCHBOARD_TLS_CA_FILE: undefined,
      }, () =>
        loadBrokerRuntimeConfig({
          host: '0.0.0.0',
          profilesDir: path.join(repoRoot, 'profiles'),
          stateDir: path.join(repoRoot, '.switchboard', 'state'),
          snapshotDir: path.join(repoRoot, '.switchboard', 'provider-snapshots'),
        })),
      /Refusing to bind broker to non-local host "0\.0\.0\.0" without direct TLS via SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE\./,
    );

    const loadedRemoteConfig = await withEnvironment({
      SWITCHBOARD_ALLOW_REMOTE: '1',
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      SWITCHBOARD_TLS_CERT_FILE: fixtures.certFile,
      SWITCHBOARD_TLS_KEY_FILE: fixtures.keyFile,
      SWITCHBOARD_TLS_CA_FILE: undefined,
    }, () =>
      loadBrokerRuntimeConfig({
        host: '0.0.0.0',
        profilesDir: path.join(repoRoot, 'profiles'),
        stateDir: path.join(repoRoot, '.switchboard', 'state'),
        snapshotDir: path.join(repoRoot, '.switchboard', 'provider-snapshots'),
      }),
    );

    assert.equal(loadedRemoteConfig.summary.protocol, 'https');
    assert.equal(loadedRemoteConfig.summary.tlsEnabled, true);
    assert.equal(loadedRemoteConfig.summary.operatorTokenSource, 'file');
    assert.equal(loadedRemoteConfig.summary.operatorTokenFile, 'operator-token');
    assert.equal(JSON.stringify(loadedRemoteConfig.summary).includes(fixtures.root), false);

    const loadedLocalFileConfig = await withEnvironment({
      SWITCHBOARD_ALLOW_REMOTE: undefined,
      SWITCHBOARD_OPERATOR_TOKEN: undefined,
      SWITCHBOARD_OPERATOR_TOKEN_FILE: fixtures.tokenFile,
      SWITCHBOARD_TLS_CERT_FILE: undefined,
      SWITCHBOARD_TLS_KEY_FILE: undefined,
      SWITCHBOARD_TLS_CA_FILE: undefined,
    }, () =>
      loadBrokerRuntimeConfig({
        host: '127.0.0.1',
        profilesDir: path.join(repoRoot, 'profiles'),
        stateDir: path.join(repoRoot, '.switchboard', 'state'),
        snapshotDir: path.join(repoRoot, '.switchboard', 'provider-snapshots'),
      }),
    );

    assert.equal(loadedLocalFileConfig.summary.protocol, 'http');
    assert.equal(loadedLocalFileConfig.summary.tlsEnabled, false);
    assert.equal(loadedLocalFileConfig.summary.operatorTokenConfigured, true);
    assert.equal(loadedLocalFileConfig.summary.operatorTokenSource, 'file');
    assert.equal(loadedLocalFileConfig.summary.operatorTokenFile, 'operator-token');
    assert.equal(JSON.stringify(loadedLocalFileConfig.summary).includes(fixtures.root), false);

    console.log('Runtime config smoke test passed.');
  } finally {
    await fixtures.cleanup();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Runtime config smoke test failed: ${message}`);
  process.exitCode = 1;
});
