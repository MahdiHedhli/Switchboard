import type { ProjectAdaptersSnapshot, ProviderAdapterStatusSnapshot } from '@switchboard/core';

export function buildProjectAdaptersSnapshot(
  adapters: ProviderAdapterStatusSnapshot[],
): ProjectAdaptersSnapshot {
  return {
    adapters,
  };
}
