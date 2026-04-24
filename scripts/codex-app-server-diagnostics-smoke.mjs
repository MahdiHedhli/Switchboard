import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  extractCodexAppServerHost,
  summarizeCodexAppServerError,
  extractCodexAppServerEndpoint,
} = await import(path.join(repoRoot, 'scripts/provider-sync/codex-app-server-diagnostics.mjs'));

assert.equal(
  summarizeCodexAppServerError(
    new Error('failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)'),
  ),
  'usage endpoint unavailable',
);
assert.equal(summarizeCodexAppServerError(new Error('Codex app-server timed out after 10000ms.')), 'timed out');
assert.equal(
  summarizeCodexAppServerError(new Error('Failed to start Codex app-server: simulated unavailable app-server')),
  'app-server unavailable',
);
assert.equal(
  summarizeCodexAppServerError(new Error('Codex app-server returned invalid JSON: Unexpected end of JSON input')),
  'invalid app-server response',
);
assert.equal(summarizeCodexAppServerError(new Error('unexpected failure')), 'unavailable');

assert.equal(
  extractCodexAppServerEndpoint(
    new Error('failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)'),
  ),
  'https://chatgpt.com/backend-api/wham/usage',
);
assert.equal(
  extractCodexAppServerHost(
    new Error('failed to fetch codex rate limits: error sending request for url (https://chatgpt.com/backend-api/wham/usage)'),
  ),
  'chatgpt.com',
);
assert.equal(
  extractCodexAppServerEndpoint('wrapper note (https://example.test/usage)'),
  'https://example.test/usage',
);
assert.equal(extractCodexAppServerHost('wrapper note (https://example.test/usage)'), 'example.test');
assert.equal(extractCodexAppServerEndpoint(new Error('no endpoint here')), undefined);
assert.equal(extractCodexAppServerHost(new Error('no endpoint here')), undefined);

console.log('Codex app-server diagnostics smoke test passed.');
