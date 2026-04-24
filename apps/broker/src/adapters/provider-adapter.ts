import type { ProviderId } from '@switchboard/core';
import { createSnapshotAdapter } from './snapshot-adapter.js';
import { refreshFromTrustedCommand, trustedCommandStatus } from './trusted-command-adapter.js';
import type { ProviderAdapterStatus, ProviderRefreshResult, QuotaAdapter } from './types.js';

type ProviderAdapterOptions = {
  provider: ProviderId;
  snapshotDescription: string;
  trustedCommandDescription: string;
  sourceFile: string;
};

export function createProviderAdapter(options: ProviderAdapterOptions): QuotaAdapter {
  const snapshotAdapter = createSnapshotAdapter({
    provider: options.provider,
    description: options.snapshotDescription,
    sourceFile: options.sourceFile,
  });

  return {
    provider: options.provider,
    description: options.trustedCommandDescription,
    async getStatus(snapshotDir: string): Promise<ProviderAdapterStatus> {
      return trustedCommandStatus(options.provider, options.trustedCommandDescription)
        ?? snapshotAdapter.getStatus(snapshotDir);
    },
    async refresh(snapshotDir: string): Promise<ProviderRefreshResult> {
      return (await refreshFromTrustedCommand(options.provider, options.trustedCommandDescription))
        ?? snapshotAdapter.refresh(snapshotDir);
    },
  };
}
