import { spawn } from 'node:child_process';
import path from 'node:path';
import type { ProviderId } from '@switchboard/core';
import { AdapterRefreshError, type ProviderAdapterStatus, type ProviderRefreshResult } from './types.js';
import { parseSanitizedProviderPayload } from './sanitized-payload.js';

const defaultTimeoutMs = 15_000;
const maxOutputBytes = 256 * 1024;

type TrustedCommandSpec = {
  argv: string[];
  timeoutMs: number;
  envKey: string;
};

type TrustedCommandResolution =
  | { state: 'absent'; envKey: string }
  | { state: 'invalid'; envKey: string; problem: string }
  | { state: 'configured'; spec: TrustedCommandSpec };

function providerEnvStem(provider: ProviderId): string {
  return provider.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
}

function commandEnvKey(provider: ProviderId): string {
  return `SWITCHBOARD_${providerEnvStem(provider)}_REFRESH_COMMAND_JSON`;
}

function timeoutEnvKey(provider: ProviderId): string {
  return `SWITCHBOARD_${providerEnvStem(provider)}_REFRESH_TIMEOUT_MS`;
}

function summarizeCommand(argv: string[]): string {
  const [command, ...args] = argv;
  const commandName = path.basename(command);
  return args.length === 0 ? commandName : `${commandName} (+${args.length} args)`;
}

function loadTimeoutMs(provider: ProviderId): number {
  const raw = process.env[timeoutEnvKey(provider)];
  if (!raw) {
    return defaultTimeoutMs;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AdapterRefreshError(
      'command_invalid',
      `${timeoutEnvKey(provider)} must be a positive integer when configured.`,
    );
  }

  return parsed;
}

export function resolveTrustedCommand(provider: ProviderId): TrustedCommandResolution {
  const envKey = commandEnvKey(provider);
  const raw = process.env[envKey];
  if (!raw) {
    return {
      state: 'absent',
      envKey,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: 'invalid',
      envKey,
      problem: `${envKey} must be valid JSON: ${detail}`,
    };
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    return {
      state: 'invalid',
      envKey,
      problem: `${envKey} must be a JSON array of non-empty strings, for example [\"node\",\"/path/to/provider-sync.mjs\"].`,
    };
  }

  try {
    return {
      state: 'configured',
      spec: {
        argv: parsed.map((entry) => entry.trim()),
        timeoutMs: loadTimeoutMs(provider),
        envKey,
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: 'invalid',
      envKey,
      problem: detail,
    };
  }
}

export function trustedCommandStatus(
  provider: ProviderId,
  description: string,
): ProviderAdapterStatus | null {
  const resolution = resolveTrustedCommand(provider);
  if (resolution.state === 'absent') {
    return null;
  }

  if (resolution.state === 'invalid') {
    return {
      provider,
      kind: 'trusted-command',
      description,
      source: resolution.envKey,
      status: 'invalid',
      configured: false,
      secure: false,
      problem: resolution.problem,
    };
  }

  return {
    provider,
    kind: 'trusted-command',
    description,
    source: `${resolution.spec.envKey} -> ${summarizeCommand(resolution.spec.argv)}`,
    status: 'ready_with_advisories',
    configured: true,
    secure: true,
    advisoryCodes: ['provider_trusted_command_unvalidated'],
    statusMessage: 'Trusted command is configured, but this view has not yet confirmed a live refresh.',
  };
}

export async function refreshFromTrustedCommand(
  provider: ProviderId,
  description: string,
): Promise<ProviderRefreshResult | null> {
  const resolution = resolveTrustedCommand(provider);
  if (resolution.state === 'absent') {
    return null;
  }

  if (resolution.state === 'invalid') {
    throw new AdapterRefreshError('command_invalid', resolution.problem);
  }

  const { spec } = resolution;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let settled = false;

  return new Promise<ProviderRefreshResult>((resolve, reject) => {
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      reject(
        new AdapterRefreshError(
          'command_timeout',
          `Trusted provider sync command for "${provider}" timed out after ${spec.timeoutMs}ms.`,
        ),
      );
    }, spec.timeoutMs);

    child.stdout.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.byteLength;

      if (stdoutBytes > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(
          new AdapterRefreshError(
            'command_failed',
            `Trusted provider sync command for "${provider}" exceeded ${maxOutputBytes} bytes of stdout.`,
          ),
        );
        return;
      }

      stdoutChunks.push(buffer);
    });

    child.stderr.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stderrChunks.reduce((total, entry) => total + entry.byteLength, 0) < 16 * 1024) {
        stderrChunks.push(buffer);
      }
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(
        new AdapterRefreshError(
          'command_failed',
          `Trusted provider sync command for "${provider}" could not start: ${error.message}`,
        ),
      );
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(
          new AdapterRefreshError(
            'command_failed',
            stderr
              ? `Trusted provider sync command for "${provider}" failed: ${stderr}`
              : `Trusted provider sync command for "${provider}" exited with code ${code}.`,
          ),
        );
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8'));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reject(
          new AdapterRefreshError(
            'command_failed',
            `Trusted provider sync command for "${provider}" did not return valid JSON: ${detail}`,
          ),
        );
        return;
      }

      try {
        resolve({
          provider,
          kind: 'trusted-command',
          refreshedAt: new Date().toISOString(),
          subscriptions: parseSanitizedProviderPayload(payload, provider, 'provider', `${provider}TrustedCommand`),
        });
      } catch (error) {
        if (error instanceof AdapterRefreshError) {
          reject(error);
          return;
        }

        const detail = error instanceof Error ? error.message : String(error);
        reject(
          new AdapterRefreshError('command_failed', `Trusted provider sync command for "${provider}" returned invalid data: ${detail}`),
        );
      }
    });
  });
}
