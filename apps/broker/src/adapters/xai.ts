import { createProviderAdapter } from './provider-adapter.js';

export const xaiAdapter = createProviderAdapter({
  provider: 'xai',
  snapshotDescription: 'Imports sanitized xAI (Grok) subscription quota snapshots from local JSON.',
  trustedCommandDescription: 'Runs a trusted local xAI Grok sync command that emits sanitized quota JSON from an installed wrapper or OAuth-backed session.',
  sourceFile: 'xai.json',
});
