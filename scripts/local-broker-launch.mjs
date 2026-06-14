import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const defaultLocalOpenaiRefreshCommand = JSON.stringify([
  'node',
  path.join(repoRoot, 'scripts/provider-sync/openai-codex-sync.mjs'),
]);
export const defaultLocalAnthropicRefreshCommand = JSON.stringify([
  'node',
  path.join(repoRoot, 'scripts/provider-sync/anthropic-claude-sync.mjs'),
]);
export const defaultLocalGoogleRefreshCommand = JSON.stringify([
  'node',
  path.join(repoRoot, 'scripts/provider-sync/google-gemini-sync.mjs'),
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

function providerEnvStem(provider) {
  return provider.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
}

function refreshCommandEnvKey(provider) {
  return `SWITCHBOARD_${providerEnvStem(provider)}_REFRESH_COMMAND_JSON`;
}

function defaultRefreshCommandEnvKey(provider) {
  return `SWITCHBOARD_DEFAULT_${providerEnvStem(provider)}_REFRESH_COMMAND_JSON`;
}

function resolveDefaultProviderRefreshCommand(provider, env, repoRootPath) {
  const explicitDefault = trimToUndefined(env[defaultRefreshCommandEnvKey(provider)]);
  if (explicitDefault) {
    return explicitDefault;
  }

  if (provider === 'openai') {
    return resolveDefaultOpenaiRefreshCommand(env, repoRootPath);
  }

  const scriptByProvider = {
    anthropic: 'anthropic-claude-sync.mjs',
    google: 'google-gemini-sync.mjs',
  };

  return JSON.stringify([
    'node',
    path.join(repoRootPath, 'scripts/provider-sync', scriptByProvider[provider]),
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
  if (!trimToUndefined(env.SWITCHBOARD_ANTHROPIC_REFRESH_COMMAND_JSON) && nextEnv.SWITCHBOARD_ANTHROPIC_REFRESH_COMMAND_JSON) {
    env.SWITCHBOARD_ANTHROPIC_REFRESH_COMMAND_JSON = nextEnv.SWITCHBOARD_ANTHROPIC_REFRESH_COMMAND_JSON;
  }
  if (!trimToUndefined(env.SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON) && nextEnv.SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON) {
    env.SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON = nextEnv.SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON;
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

  const snapshotDir = resolveSnapshotDir(nextEnv, repoRootPath);
  const inferredProviderRefreshCommands = [];

  for (const provider of ['openai', 'anthropic', 'google']) {
    const envKey = refreshCommandEnvKey(provider);
    if (trimToUndefined(nextEnv[envKey])) {
      continue;
    }

    const snapshotFile = path.join(snapshotDir, `${provider}.json`);
    if (await fileExists(snapshotFile)) {
      continue;
    }

    nextEnv[envKey] = resolveDefaultProviderRefreshCommand(provider, nextEnv, repoRootPath);
    inferredProviderRefreshCommands.push(provider);
  }

  return {
    env: nextEnv,
    inferredOpenaiRefreshCommand: inferredProviderRefreshCommands.includes('openai'),
    inferredProviderRefreshCommands,
  };
}
