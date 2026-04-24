import type {
  ProviderAdapterKind,
  ProviderAdapterStatusSnapshot,
  ProviderId,
  SubscriptionAccount,
} from '@switchboard/core';

export type AdapterKind = ProviderAdapterKind;
export type ProviderAdapterStatus = ProviderAdapterStatusSnapshot;

export interface ProviderRefreshResult {
  provider: ProviderId;
  kind: AdapterKind;
  refreshedAt: string;
  subscriptions: SubscriptionAccount[];
}

export interface QuotaAdapter {
  provider: ProviderId;
  description: string;
  getStatus(snapshotDir: string): Promise<ProviderAdapterStatus>;
  refresh(snapshotDir: string): Promise<ProviderRefreshResult>;
}

export class AdapterRefreshError extends Error {
  constructor(
    readonly code:
      | 'adapter_missing'
      | 'snapshot_missing'
      | 'snapshot_insecure'
      | 'invalid_snapshot'
      | 'command_invalid'
      | 'command_failed'
      | 'command_timeout',
    message: string,
  ) {
    super(message);
  }
}
