import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { AdapterRefreshError } = await import(path.join(repoRoot, 'apps/broker/dist/adapters/types.js'));
const { buildAdapterRefreshConflictDetail } = await import(path.join(repoRoot, 'apps/broker/dist/adapter-conflict.js'));

const stderrFailure = buildAdapterRefreshConflictDetail(
  new AdapterRefreshError(
    'command_failed',
    'Trusted provider sync command for "openai" failed: spawn /Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs ENOENT',
  ),
);
assert.equal(
  stderrFailure,
  'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
);
assert.equal(stderrFailure.includes('/Users/'), false);
assert.equal(stderrFailure.includes('ENOENT'), false);

const invalidJson = buildAdapterRefreshConflictDetail(
  new AdapterRefreshError(
    'command_failed',
    'Trusted provider sync command for "openai" did not return valid JSON: Unexpected token / in JSON at position 0',
  ),
);
assert.equal(
  invalidJson,
  'Trusted provider sync command for "openai" did not return valid JSON.',
);
assert.equal(invalidJson.includes('Unexpected token'), false);

const invalidData = buildAdapterRefreshConflictDetail(
  new AdapterRefreshError(
    'command_failed',
    'Trusted provider sync command for "openai" returned invalid data: openaiTrustedCommand.accounts[0].extra is not allowed.',
  ),
);
assert.equal(
  invalidData,
  'Trusted provider sync command for "openai" returned invalid data.',
);
assert.equal(invalidData.includes('extra is not allowed'), false);

const outputLimit = buildAdapterRefreshConflictDetail(
  new AdapterRefreshError(
    'command_failed',
    'Trusted provider sync command for "openai" exceeded 262144 bytes of stdout.',
  ),
);
assert.equal(
  outputLimit,
  'Trusted provider sync command for "openai" exceeded the broker output limit.',
);

const safeSnapshotError = buildAdapterRefreshConflictDetail(
  new AdapterRefreshError(
    'snapshot_insecure',
    'Snapshot file "openai.json" must not be group-writable or world-writable.',
  ),
);
assert.equal(
  safeSnapshotError,
  'Snapshot file "openai.json" must not be group-writable or world-writable.',
);

console.log('Adapter conflict smoke test passed.');
