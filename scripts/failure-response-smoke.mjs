import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  AdapterRefreshError,
  buildBrokerFailureResponse,
  TaskConflictError,
  TaskNotFoundError,
  unexpectedBrokerErrorDetail,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

assert.deepEqual(
  buildBrokerFailureResponse(new TaskNotFoundError('Task TASK-0001 does not exist for profile threatpedia.')),
  {
    statusCode: 404,
    payload: {
      error: 'not_found',
      detail: 'Task TASK-0001 does not exist for profile threatpedia.',
    },
  },
);

assert.deepEqual(
  buildBrokerFailureResponse(new TaskConflictError('Task TASK-0001 needs a blockedReason while status is blocked.')),
  {
    statusCode: 409,
    payload: {
      error: 'conflict',
      detail: 'Task TASK-0001 needs a blockedReason while status is blocked.',
    },
  },
);

assert.deepEqual(
  buildBrokerFailureResponse(
    new AdapterRefreshError(
      'command_failed',
      'Trusted provider sync command for "openai" failed: simulated stderr from /Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs',
    ),
  ),
  {
    statusCode: 409,
    payload: {
      error: 'conflict',
      detail: 'Trusted provider sync command for "openai" failed. Review provider sync diagnostics for details.',
    },
  },
);

assert.deepEqual(
  buildBrokerFailureResponse(new Error('refreshRequest.provider is not allowed.')),
  {
    statusCode: 400,
    payload: {
      error: 'bad_request',
      detail: 'refreshRequest.provider is not allowed.',
    },
  },
);

const internal = buildBrokerFailureResponse(
  new Error('failed to parse /Users/mhedhli/Documents/Coding/Switchboard/.switchboard/state/threatpedia.json'),
);
assert.deepEqual(internal, {
  statusCode: 500,
  payload: {
    error: 'internal_error',
    detail: unexpectedBrokerErrorDetail,
  },
});
assert.equal(internal.payload.detail.includes('/Users/'), false);
assert.equal(internal.payload.detail.includes('.switchboard'), false);

console.log('Failure response smoke test passed.');
