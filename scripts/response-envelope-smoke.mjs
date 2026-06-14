import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  buildBrokerJsonHeaders,
  buildBrokerJsonResponse,
  buildMethodNotAllowedHttpResponse,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

assert.deepEqual(
  buildBrokerJsonHeaders(),
  {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
);

assert.deepEqual(
  buildBrokerJsonHeaders({ Allow: 'GET' }),
  {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Allow: 'GET',
  },
);

assert.deepEqual(
  buildBrokerJsonResponse(404, { error: 'not_found', detail: 'No route for GET /nope.' }),
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
  buildMethodNotAllowedHttpResponse(['GET', 'PATCH']),
  {
    statusCode: 405,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Allow: 'GET, PATCH',
    },
    body: '{\n  "error": "method_not_allowed",\n  "detail": "Allowed methods: GET, PATCH"\n}\n',
  },
);

console.log('Response envelope smoke test passed.');
