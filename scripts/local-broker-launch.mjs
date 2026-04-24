import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const defaultLocalOpenaiRefreshCommand = JSON.stringify([
  'node',
  path.join(repoRoot, 'scripts/provider-sync/openai-codex-sync.mjs'),
]);

function trimToUndefined(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost';
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveSnapshotDir(env, repoRootPath) {
  return trimToUndefined(env.SWITCHBOARD_SNAPSHOT_DIR)
    ?? path.join(repoRootPath, '.switchboard', 'provider-snapshots');
}

function resolveDefaultOpenaiRefreshCommand(env, repoRootPath) {
  return trimToUndefined(env.SWITCHBOARD_DEFAULT_OPENAI_REFRESH_COMMAND_JSON)
    ?? JSON.stringify([
      'node',
      path.join(repoRootPath, 'scripts/provider-sync/openai-codex-sync.mjs'),
    ]);
}

export function shouldUseLocalBrokerDefaults(env = process.env) {
  if (trimToUndefined(env.SWITCHBOARD_SKIP_LOCAL_BROKER_DEFAULTS) === '1') {
    return false;
  }

  if (trimToUndefined(env.SWITCHBOARD_ALLOW_REMOTE) === '1') {
    return false;
  }

  const host = trimToUndefined(env.SWITCHBOARD_BROKER_HOST) ?? '127.0.0.1';
  return isLoopbackHost(host);
}

export async function applyLocalBrokerDefaults(
  env = process.env,
  { repoRootPath = repoRoot } = {},
) {
  if (!shouldUseLocalBrokerDefaults(env)) {
    return env;
  }

  const { env: nextEnv } = await buildLocalBrokerEnvironment(env, { repoRootPath });

  if (!trimToUndefined(env.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON) && nextEnv.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON) {
    env.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON = nextEnv.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON;
  }

  return env;
}

export async function buildLocalBrokerEnvironment(
  env = process.env,
  { repoRootPath = repoRoot } = {},
) {
  const nextEnv = {
    ...env,
    SWITCHBOARD_BROKER_HOST: trimToUndefined(env.SWITCHBOARD_BROKER_HOST) ?? '127.0.0.1',
    SWITCHBOARD_BROKER_PORT: trimToUndefined(env.SWITCHBOARD_BROKER_PORT) ?? '7007',
  };

  if (trimToUndefined(nextEnv.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON)) {
    return {
      env: nextEnv,
      inferredOpenaiRefreshCommand: false,
    };
  }

  const snapshotDir = resolveSnapshotDir(nextEnv, repoRootPath);
  const openaiSnapshotFile = path.join(snapshotDir, 'openai.json');

  if (await fileExists(openaiSnapshotFile)) {
    return {
      env: nextEnv,
      inferredOpenaiRefreshCommand: false,
    };
  }

  nextEnv.SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON = resolveDefaultOpenaiRefreshCommand(nextEnv, repoRootPath);

  return {
    env: nextEnv,
    inferredOpenaiRefreshCommand: true,
  };
}
