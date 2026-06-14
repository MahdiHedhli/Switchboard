import { createProviderAdapter } from './provider-adapter.js';

export const googleAdapter = createProviderAdapter({
  provider: 'google',
  snapshotDescription: 'Imports sanitized Google subscription quota snapshots from local JSON.',
  trustedCommandDescription: 'Runs a trusted local Google sync command that emits sanitized quota JSON from an installed wrapper or OAuth-backed session.',
  sourceFile: 'google.json',
});
