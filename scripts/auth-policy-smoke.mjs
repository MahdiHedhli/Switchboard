import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const {
  BrokerAuthPolicy,
  isLoopbackHost,
  operatorTokenHeaderName,
} = await import(path.join(repoRoot, 'apps/broker/dist/auth-policy.js'));

const headerKey = operatorTokenHeaderName.toLowerCase();

function requestWithToken(token) {
  return {
    headers: token ? { [headerKey]: token } : {},
  };
}

assert.equal(isLoopbackHost('127.0.0.1'), true);
assert.equal(isLoopbackHost('localhost'), true);
assert.equal(isLoopbackHost('::1'), true);
assert.equal(isLoopbackHost('0.0.0.0'), false);
assert.equal(isLoopbackHost('192.168.1.20'), false);

const localOpenPolicy = new BrokerAuthPolicy({
  host: '127.0.0.1',
});
assert.equal(localOpenPolicy.summary().localOnly, true);
assert.equal(localOpenPolicy.summary().operatorTokenConfigured, false);
assert.equal(localOpenPolicy.summary().scopes.taskCreate.requirement, 'open');
assert.equal(localOpenPolicy.summary().scopes.subscriptionRefresh.requirement, 'open');
assert.equal(localOpenPolicy.summary().scopes.subscriptionReplace.requirement, 'disabled');
assert.deepEqual(localOpenPolicy.authorize(requestWithToken(), 'taskCreate'), {
  ok: true,
  requirement: 'open',
});
assert.deepEqual(localOpenPolicy.authorize(requestWithToken(), 'subscriptionReplace'), {
  ok: false,
  requirement: 'disabled',
  statusCode: 403,
  detail: 'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
});

const localTokenPolicy = new BrokerAuthPolicy({
  host: '127.0.0.1',
  operatorToken: 'local-token',
  manualSubscriptionReplaceEnabled: true,
});
assert.equal(localTokenPolicy.summary().scopes.taskCreate.requirement, 'operator_token');
assert.equal(localTokenPolicy.summary().scopes.subscriptionReplace.requirement, 'operator_token');
assert.equal(localTokenPolicy.authorize(requestWithToken(), 'taskCreate').statusCode, 401);
assert.equal(localTokenPolicy.authorize(requestWithToken('wrong-token'), 'taskCreate').statusCode, 401);
assert.deepEqual(localTokenPolicy.authorize(requestWithToken('local-token'), 'taskCreate'), {
  ok: true,
  requirement: 'operator_token',
});
assert.deepEqual(localTokenPolicy.authorize(requestWithToken('local-token'), 'subscriptionReplace'), {
  ok: true,
  requirement: 'operator_token',
});

const remoteDisabledPolicy = new BrokerAuthPolicy({
  host: '0.0.0.0',
  manualSubscriptionReplaceEnabled: true,
});
assert.equal(remoteDisabledPolicy.summary().localOnly, false);
assert.equal(remoteDisabledPolicy.summary().remoteExposureAllowed, true);
assert.equal(remoteDisabledPolicy.summary().scopes.taskCreate.requirement, 'disabled');
assert.equal(remoteDisabledPolicy.summary().scopes.taskUpdate.requirement, 'disabled');
assert.equal(remoteDisabledPolicy.summary().scopes.subscriptionRefresh.requirement, 'disabled');
assert.equal(remoteDisabledPolicy.summary().scopes.subscriptionReplace.requirement, 'disabled');
assert.deepEqual(remoteDisabledPolicy.authorize(requestWithToken(), 'taskCreate'), {
  ok: false,
  requirement: 'disabled',
  statusCode: 403,
  detail: `Non-local broker exposure requires ${operatorTokenHeaderName} via SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE before mutation routes may be used.`,
});

const remoteTokenPolicy = new BrokerAuthPolicy({
  host: '0.0.0.0',
  operatorToken: 'remote-token',
  manualSubscriptionReplaceEnabled: true,
});
assert.equal(remoteTokenPolicy.summary().scopes.taskCreate.requirement, 'operator_token');
assert.equal(remoteTokenPolicy.summary().scopes.subscriptionRefresh.requirement, 'operator_token');
assert.equal(remoteTokenPolicy.summary().scopes.subscriptionReplace.requirement, 'operator_token');
assert.equal(remoteTokenPolicy.authorize(requestWithToken(), 'subscriptionRefresh').statusCode, 401);
assert.deepEqual(remoteTokenPolicy.authorize(requestWithToken('remote-token'), 'subscriptionRefresh'), {
  ok: true,
  requirement: 'operator_token',
});

const remoteTokenNoReplacePolicy = new BrokerAuthPolicy({
  host: '0.0.0.0',
  operatorToken: 'remote-token',
});
assert.equal(remoteTokenNoReplacePolicy.summary().scopes.taskCreate.requirement, 'operator_token');
assert.equal(remoteTokenNoReplacePolicy.summary().scopes.subscriptionReplace.requirement, 'disabled');
assert.deepEqual(remoteTokenNoReplacePolicy.authorize(requestWithToken('remote-token'), 'subscriptionReplace'), {
  ok: false,
  requirement: 'disabled',
  statusCode: 403,
  detail: 'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
});

console.log('Auth policy smoke test passed.');
