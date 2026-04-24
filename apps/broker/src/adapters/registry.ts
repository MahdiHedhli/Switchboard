import type { ProjectProfile, ProviderId, SubscriptionAccount } from '@switchboard/core';
import { anthropicAdapter } from './anthropic.js';
import { googleAdapter } from './google.js';
import { openaiAdapter } from './openai.js';
import { AdapterRefreshError, type ProviderAdapterStatus, type ProviderRefreshResult, type QuotaAdapter } from './types.js';

const registeredAdapters: Record<string, QuotaAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
};

function uniqueProviders(profile: ProjectProfile): ProviderId[] {
  return [...new Set(profile.roles.map((role) => role.provider))];
}

export class AdapterRegistry {
  constructor(private readonly snapshotDir: string) {}

  getAdapter(provider: ProviderId): QuotaAdapter | null {
    return registeredAdapters[provider] ?? null;
  }

  async listForProfile(profile: ProjectProfile): Promise<ProviderAdapterStatus[]> {
    const providers = uniqueProviders(profile);

    return Promise.all(
      providers.map(async (provider) => {
        const adapter = this.getAdapter(provider);
        if (!adapter) {
          return {
            provider,
            kind: 'snapshot' as const,
            description: 'No adapter is registered for this provider yet.',
            source: `${provider}.json`,
            status: 'missing' as const,
            configured: false,
            secure: false,
            problem: 'No adapter registered.',
          };
        }

        return adapter.getStatus(this.snapshotDir);
      }),
    );
  }

  async refreshProviders(profile: ProjectProfile, providers?: ProviderId[]): Promise<ProviderRefreshResult[]> {
    const targets = providers && providers.length > 0 ? providers : uniqueProviders(profile);

    return Promise.all(
      targets.map(async (provider) => {
        const adapter = this.getAdapter(provider);
        if (!adapter) {
          throw new AdapterRefreshError('adapter_missing', `No adapter is registered for provider "${provider}".`);
        }

        return adapter.refresh(this.snapshotDir);
      }),
    );
  }
}

export function collectSubscriptions(results: ProviderRefreshResult[]): SubscriptionAccount[] {
  return results.flatMap((result) => result.subscriptions);
}
