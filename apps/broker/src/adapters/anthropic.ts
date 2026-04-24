import { createProviderAdapter } from './provider-adapter.js';

export const anthropicAdapter = createProviderAdapter({
  provider: 'anthropic',
  snapshotDescription: 'Imports sanitized Anthropic subscription quota snapshots from local JSON.',
  trustedCommandDescription: 'Runs a trusted local Anthropic sync command that emits sanitized quota JSON from an installed wrapper or OAuth-backed session.',
  sourceFile: 'anthropic.json',
});
