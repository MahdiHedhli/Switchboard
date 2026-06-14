import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { defaultOperatorTokenFile } from './operator-token-path.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const brokerEntry = path.join(repoRoot, 'apps/broker/dist/index.js');
export const remoteTrustedBrokerDefaultTokenFile = defaultOperatorTokenFile;
export const remoteTrustedBrokerTlsRequirementMessage =
  "Remote-trusted broker mode requires SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE. Use a reviewed certificate such as Let's Encrypt for remote exposure, or mkcert for local HTTPS testing.";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function trimToUndefined(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildRemoteTrustedBrokerEnvironment(env = process.env) {
  const tlsCertFile = trimToUndefined(env.SWITCHBOARD_TLS_CERT_FILE);
  const tlsKeyFile = trimToUndefined(env.SWITCHBOARD_TLS_KEY_FILE);

  if (!tlsCertFile || !tlsKeyFile) {
    throw new Error(remoteTrustedBrokerTlsRequirementMessage);
  }

  return {
    ...env,
    SWITCHBOARD_BROKER_HOST: trimToUndefined(env.SWITCHBOARD_BROKER_HOST) || '0.0.0.0',
    SWITCHBOARD_BROKER_PORT: trimToUndefined(env.SWITCHBOARD_BROKER_PORT) || '7007',
    SWITCHBOARD_ALLOW_REMOTE: '1',
    SWITCHBOARD_OPERATOR_TOKEN_FILE: trimToUndefined(env.SWITCHBOARD_OPERATOR_TOKEN_FILE) || remoteTrustedBrokerDefaultTokenFile,
  };
}

async function main() {
  const env = buildRemoteTrustedBrokerEnvironment(process.env);

  const child = spawn(process.execPath, [brokerEntry], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });

  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 0;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
