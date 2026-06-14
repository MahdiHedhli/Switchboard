import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { buildProjectAdaptersSnapshot } = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const snapshot = buildProjectAdaptersSnapshot([
  {
    provider: 'openai',
    kind: 'trusted-command',
    description: 'OpenAI trusted sync',
    source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node',
    status: 'ready_with_advisories',
    configured: true,
    secure: true,
    advisoryCodes: ['provider_trusted_command_unvalidated'],
    statusMessage: 'Trusted command is configured, but this view has not yet confirmed a live refresh.',
  },
  {
    provider: 'anthropic',
    kind: 'snapshot',
    description: 'Anthropic snapshot',
    source: 'anthropic.json',
    status: 'ready',
    configured: true,
    secure: true,
    lastModifiedAt: '2026-04-22T08:30:00.000Z',
  },
  {
    provider: 'google',
    kind: 'snapshot',
    description: 'Google snapshot',
    source: 'google.json',
    status: 'missing',
    configured: false,
    secure: false,
    problem: 'No sanitized snapshot file found yet.',
  },
]);

assert.deepEqual(snapshot, {
  adapters: [
    {
      provider: 'openai',
      kind: 'trusted-command',
      description: 'OpenAI trusted sync',
      source: 'SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON -> node',
      status: 'ready_with_advisories',
      configured: true,
      secure: true,
      advisoryCodes: ['provider_trusted_command_unvalidated'],
      statusMessage: 'Trusted command is configured, but this view has not yet confirmed a live refresh.',
    },
    {
      provider: 'anthropic',
      kind: 'snapshot',
      description: 'Anthropic snapshot',
      source: 'anthropic.json',
      status: 'ready',
      configured: true,
      secure: true,
      lastModifiedAt: '2026-04-22T08:30:00.000Z',
    },
    {
      provider: 'google',
      kind: 'snapshot',
      description: 'Google snapshot',
      source: 'google.json',
      status: 'missing',
      configured: false,
      secure: false,
      problem: 'No sanitized snapshot file found yet.',
    },
  ],
});

console.log('Adapters snapshot smoke test passed.');
