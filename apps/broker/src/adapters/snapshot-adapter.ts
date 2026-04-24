import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProviderId } from '@switchboard/core';
import { AdapterRefreshError, type ProviderAdapterStatus, type ProviderRefreshResult, type QuotaAdapter } from './types.js';
import { parseSanitizedProviderPayload } from './sanitized-payload.js';

type SnapshotAdapterOptions = {
  provider: ProviderId;
  description: string;
  sourceFile: string;
};

function isSecureFileMode(mode: number): boolean {
  return (mode & 0o022) === 0;
}

async function readSnapshotFile(provider: ProviderId, snapshotDir: string, sourceFile: string): Promise<ProviderRefreshResult> {
  const filePath = path.join(snapshotDir, sourceFile);
  let fileStat;

  try {
    fileStat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AdapterRefreshError('snapshot_missing', `No sanitized snapshot was found for provider "${provider}" at ${sourceFile}.`);
    }

    throw error;
  }

  if (!isSecureFileMode(fileStat.mode)) {
    throw new AdapterRefreshError(
      'snapshot_insecure',
      `Snapshot file "${sourceFile}" must not be group-writable or world-writable.`,
    );
  }

  const raw = await fs.readFile(filePath, 'utf8');
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AdapterRefreshError('invalid_snapshot', `Snapshot file "${sourceFile}" is not valid JSON: ${detail}`);
  }

  try {
    const subscriptions = parseSanitizedProviderPayload(payload, provider, 'snapshot', `${provider}Snapshot`);

    return {
      provider,
      kind: 'snapshot',
      refreshedAt: new Date().toISOString(),
      subscriptions,
    };
  } catch (error) {
    if (error instanceof AdapterRefreshError) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new AdapterRefreshError('invalid_snapshot', detail);
  }
}

export function createSnapshotAdapter(options: SnapshotAdapterOptions): QuotaAdapter {
  return {
    provider: options.provider,
    description: options.description,
    async getStatus(snapshotDir: string): Promise<ProviderAdapterStatus> {
      const filePath = path.join(snapshotDir, options.sourceFile);

      try {
        const fileStat = await fs.stat(filePath);
        const secure = isSecureFileMode(fileStat.mode);

        return {
          provider: options.provider,
          kind: 'snapshot',
          description: options.description,
          source: options.sourceFile,
          status: secure ? 'ready' : 'insecure',
          configured: true,
          secure,
          lastModifiedAt: fileStat.mtime.toISOString(),
          problem: secure ? undefined : 'Snapshot file permissions are too open.',
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return {
            provider: options.provider,
            kind: 'snapshot',
            description: options.description,
            source: options.sourceFile,
            status: 'missing',
            configured: false,
            secure: false,
            problem: 'No sanitized snapshot file found yet.',
          };
        }

        throw error;
      }
    },
    async refresh(snapshotDir: string): Promise<ProviderRefreshResult> {
      return readSnapshotFile(options.provider, snapshotDir, options.sourceFile);
    },
  };
}
