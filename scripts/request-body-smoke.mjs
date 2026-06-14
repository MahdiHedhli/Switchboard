import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  buildRequestBodyTooLargeDetail,
  defaultMaxBodySizeBytes,
  invalidJsonContentTypeDetail,
  invalidJsonBodyDetail,
  isBrokerBadRequestError,
  parseJsonRequestBody,
  readJsonRequestBody,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

function buildRequestSource({
  contentType = 'application/json; charset=utf-8',
  chunks = [],
} = {}) {
  return {
    headers: contentType === undefined ? {} : { 'content-type': contentType },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

assert.deepEqual(
  parseJsonRequestBody('{"provider":"openai","approvalRequired":true}'),
  {
    provider: 'openai',
    approvalRequired: true,
  },
);

assert.throws(
  () => parseJsonRequestBody('{"provider":'),
  (error) => error instanceof Error && error.message === invalidJsonBodyDetail,
);

assert.deepEqual(
  await readJsonRequestBody(buildRequestSource({
    chunks: ['{"provider":"openai",', '"approvalRequired":true}'],
  })),
  {
    provider: 'openai',
    approvalRequired: true,
  },
);

assert.deepEqual(
  await readJsonRequestBody(buildRequestSource()),
  {},
);

await assert.rejects(
  readJsonRequestBody(buildRequestSource({ contentType: 'text/plain', chunks: ['{}'] })),
  (error) => error instanceof Error && error.message === invalidJsonContentTypeDetail,
);

await assert.rejects(
  readJsonRequestBody(buildRequestSource({ chunks: ['{"provider":'] })),
  (error) => error instanceof Error && error.message === invalidJsonBodyDetail,
);

await assert.rejects(
  readJsonRequestBody(buildRequestSource({ chunks: [Buffer.alloc(8)] }), 4),
  (error) => error instanceof Error && error.message === buildRequestBodyTooLargeDetail(4),
);

assert.equal(isBrokerBadRequestError(new Error(invalidJsonBodyDetail)), true);
assert.equal(isBrokerBadRequestError(new Error(invalidJsonContentTypeDetail)), true);
assert.equal(isBrokerBadRequestError(new Error(buildRequestBodyTooLargeDetail(defaultMaxBodySizeBytes))), true);
assert.equal(isBrokerBadRequestError(new Error('task.title must be a string.')), true);
assert.equal(isBrokerBadRequestError(new Error('taskPatch must include at least one editable field.')), true);
assert.equal(isBrokerBadRequestError(new Error('payload must be an object.')), true);
assert.equal(isBrokerBadRequestError(new Error('subscription.signals[0].id must be a string.')), true);
assert.equal(isBrokerBadRequestError(new Error('refreshRequest.provider is not allowed.')), true);
assert.equal(isBrokerBadRequestError(new Error('unexpected storage fault')), false);
assert.equal(isBrokerBadRequestError(new Error('state snapshot threatpedia.updatedAt must be a string.')), false);
assert.equal(isBrokerBadRequestError(new Error('/Users/example/path failed unexpectedly')), false);

console.log('Request body smoke test passed.');
