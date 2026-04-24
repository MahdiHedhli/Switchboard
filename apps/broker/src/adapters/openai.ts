import { createProviderAdapter } from './provider-adapter.js';

export const openaiAdapter = createProviderAdapter({
  provider: 'openai',
  snapshotDescription: 'Imports sanitized OpenAI subscription quota snapshots from local JSON.',
  trustedCommandDescription: 'Runs a trusted local OpenAI sync command, including the repo-owned Codex supervisor wrapper, that emits sanitized quota JSON from an installed wrapper or OAuth-backed session.',
  sourceFile: 'openai.json',
});
