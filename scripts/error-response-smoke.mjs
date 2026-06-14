import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  buildBrokerErrorResponse,
  buildMethodNotAllowedResponse,
  buildInternalErrorResponse,
  unexpectedBrokerErrorDetail,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

assert.deepEqual(
  buildBrokerErrorResponse('unauthorized', 'A valid operator token is required for this mutation route.'),
  {
    error: 'unauthorized',
    detail: 'A valid operator token is required for this mutation route.',
  },
);

assert.deepEqual(
  buildMethodNotAllowedResponse(['GET', 'PATCH']),
  {
    error: 'method_not_allowed',
    detail: 'Allowed methods: GET, PATCH',
  },
);

const internal = buildInternalErrorResponse(
  new Error('failed to parse /Users/mhedhli/Documents/Coding/Switchboard/.switchboard/state/threatpedia.json'),
);
assert.deepEqual(internal, {
  error: 'internal_error',
  detail: unexpectedBrokerErrorDetail,
});
assert.equal(internal.detail.includes('/Users/'), false);
assert.equal(internal.detail.includes('.switchboard'), false);

console.log('Error response smoke test passed.');
