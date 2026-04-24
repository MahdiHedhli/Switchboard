import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  buildBadRequestHttpResponse,
  buildConflictHttpResponse,
  buildForbiddenHttpResponse,
  buildInternalErrorHttpResponse,
  buildNotFoundHttpResponse,
  buildUnauthorizedHttpResponse,
  unexpectedBrokerErrorDetail,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

assert.deepEqual(
  buildNotFoundHttpResponse('No route for GET /nope.'),
  {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: '{\n  "error": "not_found",\n  "detail": "No route for GET /nope."\n}\n',
  },
);

assert.deepEqual(
  buildBadRequestHttpResponse('Request body must contain valid JSON.'),
  {
    statusCode: 400,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: '{\n  "error": "bad_request",\n  "detail": "Request body must contain valid JSON."\n}\n',
  },
);

assert.deepEqual(
  buildUnauthorizedHttpResponse('A valid operator token is required for this mutation route.'),
  {
    statusCode: 401,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: '{\n  "error": "unauthorized",\n  "detail": "A valid operator token is required for this mutation route."\n}\n',
  },
);

assert.deepEqual(
  buildForbiddenHttpResponse('Direct subscription replacement is disabled by default.'),
  {
    statusCode: 403,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: '{\n  "error": "forbidden",\n  "detail": "Direct subscription replacement is disabled by default."\n}\n',
  },
);

assert.deepEqual(
  buildConflictHttpResponse('Task TASK-0001 needs a blockedReason while status is blocked.'),
  {
    statusCode: 409,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: '{\n  "error": "conflict",\n  "detail": "Task TASK-0001 needs a blockedReason while status is blocked."\n}\n',
  },
);

const internal = buildInternalErrorHttpResponse(
  new Error('failed to parse /Users/mhedhli/Documents/Coding/Switchboard/.switchboard/state/threatpedia.json'),
);
assert.deepEqual(internal, {
  statusCode: 500,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body: `{\n  "error": "internal_error",\n  "detail": "${unexpectedBrokerErrorDetail}"\n}\n`,
});
assert.equal(internal.body.includes('/Users/'), false);
assert.equal(internal.body.includes('.switchboard'), false);

console.log('Error HTTP response smoke test passed.');
