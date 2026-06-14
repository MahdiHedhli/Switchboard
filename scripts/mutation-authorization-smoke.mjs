import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  authorizeBrokerMutationRequest,
  BrokerAuthPolicy,
  operatorTokenHeaderName,
} = await import(path.join(repoRoot, 'apps/broker/dist/index.js'));

const headerKey = operatorTokenHeaderName.toLowerCase();

function requestWithToken(token) {
  return {
    headers: token ? { [headerKey]: token } : {},
  };
}

const localLockedPolicy = new BrokerAuthPolicy({
  host: '127.0.0.1',
});
assert.deepEqual(
  authorizeBrokerMutationRequest(requestWithToken(), localLockedPolicy, 'taskCreate'),
  {
    ok: false,
    statusCode: 403,
    payload: {
      error: 'forbidden',
      detail: `Loopback mutation routes require ${operatorTokenHeaderName} via SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE. For disposable local development only, set SWITCHBOARD_ALLOW_OPEN_LOOPBACK_MUTATIONS=1.`,
    },
  },
);

const localOpenPolicy = new BrokerAuthPolicy({
  host: '127.0.0.1',
  allowOpenLoopbackMutations: true,
});
assert.deepEqual(
  authorizeBrokerMutationRequest(requestWithToken(), localOpenPolicy, 'taskCreate'),
  { ok: true },
);

const localTokenPolicy = new BrokerAuthPolicy({
  host: '127.0.0.1',
  operatorToken: 'local-token',
});
assert.deepEqual(
  authorizeBrokerMutationRequest(requestWithToken(), localTokenPolicy, 'taskCreate'),
  {
    ok: false,
    statusCode: 401,
    payload: {
      error: 'unauthorized',
      detail: `This route requires ${operatorTokenHeaderName}. Provide the header ${operatorTokenHeaderName}.`,
    },
  },
);
assert.deepEqual(
  authorizeBrokerMutationRequest(requestWithToken('local-token'), localTokenPolicy, 'taskCreate'),
  { ok: true },
);

const remoteDisabledPolicy = new BrokerAuthPolicy({
  host: '0.0.0.0',
});
assert.deepEqual(
  authorizeBrokerMutationRequest(requestWithToken(), remoteDisabledPolicy, 'subscriptionRefresh'),
  {
    ok: false,
    statusCode: 403,
    payload: {
      error: 'forbidden',
      detail: `Non-local broker exposure requires ${operatorTokenHeaderName} via SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE before mutation routes may be used.`,
    },
  },
);

const remoteTokenNoReplacePolicy = new BrokerAuthPolicy({
  host: '0.0.0.0',
  operatorToken: 'remote-token',
});
assert.deepEqual(
  authorizeBrokerMutationRequest(requestWithToken('remote-token'), remoteTokenNoReplacePolicy, 'subscriptionReplace'),
  {
    ok: false,
    statusCode: 403,
    payload: {
      error: 'forbidden',
      detail:
        'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
    },
  },
);

console.log('Mutation authorization smoke test passed.');
