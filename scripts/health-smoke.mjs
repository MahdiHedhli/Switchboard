import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { resolveBrokerProtocol, resolveBrokerTlsEnabled } = await import(
  path.join(repoRoot, 'packages/core/dist/index.js'),
);
const { BrokerAuthPolicy, buildBrokerHealthSnapshot, operatorTokenHeaderName } = await import(
  path.join(repoRoot, 'apps/broker/dist/index.js'),
);

const remoteTokenRequirementDetail =
  `Non-local broker exposure requires ${operatorTokenHeaderName} via SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE before mutation routes may be used.`;

const localHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '127.0.0.1',
    operatorToken: 'reviewed-local-token',
  }),
  {
    protocol: 'http',
    tlsEnabled: false,
    operatorTokenSource: 'env',
  },
);

assert.deepEqual(localHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: true,
  operatorTokenRequired: true,
  protocol: 'http',
  tlsEnabled: false,
  auth: {
    localOnly: true,
    remoteExposureAllowed: false,
    operatorTokenConfigured: true,
    operatorTokenSource: 'env',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      taskUpdate: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      subscriptionRefresh: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const localTokenFileHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '127.0.0.1',
    operatorToken: 'reviewed-local-token',
  }),
  {
    protocol: 'http',
    tlsEnabled: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
  },
);

assert.deepEqual(localTokenFileHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: true,
  operatorTokenRequired: true,
  protocol: 'http',
  tlsEnabled: false,
  auth: {
    localOnly: true,
    remoteExposureAllowed: false,
    operatorTokenConfigured: true,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      taskUpdate: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      subscriptionRefresh: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const remoteBlockedHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '0.0.0.0',
  }),
  {
    protocol: 'https',
    tlsEnabled: true,
    operatorTokenSource: 'unset',
  },
);

assert.deepEqual(remoteBlockedHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: false,
  operatorTokenRequired: false,
  protocol: 'https',
  tlsEnabled: true,
  auth: {
    localOnly: false,
    remoteExposureAllowed: true,
    operatorTokenConfigured: false,
    operatorTokenSource: 'unset',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      taskUpdate: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      subscriptionRefresh: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const remoteTokenFileHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '0.0.0.0',
    operatorToken: 'reviewed-remote-token',
  }),
  {
    protocol: 'https',
    tlsEnabled: true,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
  },
);

assert.deepEqual(remoteTokenFileHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: false,
  operatorTokenRequired: true,
  protocol: 'https',
  tlsEnabled: true,
  auth: {
    localOnly: false,
    remoteExposureAllowed: true,
    operatorTokenConfigured: true,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      taskUpdate: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      subscriptionRefresh: {
        requirement: 'operator_token',
        detail: `This route requires ${operatorTokenHeaderName}.`,
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const invalidTokenFileHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '127.0.0.1',
  }),
  {
    protocol: 'http',
    tlsEnabled: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem: 'SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
  },
);

assert.deepEqual(invalidTokenFileHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: true,
  operatorTokenRequired: false,
  protocol: 'http',
  tlsEnabled: false,
  auth: {
    localOnly: true,
    remoteExposureAllowed: false,
    operatorTokenConfigured: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem: 'SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'open',
        detail: 'Allowed while the broker stays loopback-only.',
      },
      taskUpdate: {
        requirement: 'open',
        detail: 'Allowed while the broker stays loopback-only.',
      },
      subscriptionRefresh: {
        requirement: 'open',
        detail: 'Allowed while the broker stays loopback-only.',
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const remoteInvalidTokenFileHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '0.0.0.0',
  }),
  {
    protocol: 'https',
    tlsEnabled: true,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem: 'SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
  },
);

assert.deepEqual(remoteInvalidTokenFileHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: false,
  operatorTokenRequired: false,
  protocol: 'https',
  tlsEnabled: true,
  auth: {
    localOnly: false,
    remoteExposureAllowed: true,
    operatorTokenConfigured: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem: 'SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 600.',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      taskUpdate: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      subscriptionRefresh: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const invalidDefaultTokenDirectoryHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '127.0.0.1',
  }),
  {
    protocol: 'http',
    tlsEnabled: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem:
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
  },
);

assert.deepEqual(invalidDefaultTokenDirectoryHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: true,
  operatorTokenRequired: false,
  protocol: 'http',
  tlsEnabled: false,
  auth: {
    localOnly: true,
    remoteExposureAllowed: false,
    operatorTokenConfigured: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem:
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'open',
        detail: 'Allowed while the broker stays loopback-only.',
      },
      taskUpdate: {
        requirement: 'open',
        detail: 'Allowed while the broker stays loopback-only.',
      },
      subscriptionRefresh: {
        requirement: 'open',
        detail: 'Allowed while the broker stays loopback-only.',
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const remoteInvalidDefaultTokenDirectoryHealth = buildBrokerHealthSnapshot(
  new BrokerAuthPolicy({
    host: '0.0.0.0',
  }),
  {
    protocol: 'https',
    tlsEnabled: true,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem:
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
  },
);

assert.deepEqual(remoteInvalidDefaultTokenDirectoryHealth, {
  status: 'ok',
  service: 'switchboard-broker',
  localOnly: false,
  operatorTokenRequired: false,
  protocol: 'https',
  tlsEnabled: true,
  auth: {
    localOnly: false,
    remoteExposureAllowed: true,
    operatorTokenConfigured: false,
    operatorTokenSource: 'file',
    operatorTokenFile: 'operator-token',
    operatorTokenProblem:
      'Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.',
    manualSubscriptionReplaceEnabled: false,
    operatorTokenHeader: operatorTokenHeaderName,
    scopes: {
      taskCreate: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      taskUpdate: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      subscriptionRefresh: {
        requirement: 'disabled',
        detail: remoteTokenRequirementDetail,
      },
      subscriptionReplace: {
        requirement: 'disabled',
        detail:
          'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
      },
    },
  },
});

const serialized = JSON.stringify(localHealth);
assert.equal(serialized.includes('reviewed-local-token'), false);
assert.equal(serialized.includes('.switchboard'), false);
assert.equal(serialized.includes('/Users/'), false);

const localTokenFileSerialized = JSON.stringify(localTokenFileHealth);
assert.equal(localTokenFileSerialized.includes('reviewed-local-token'), false);
assert.equal(localTokenFileSerialized.includes('.switchboard'), false);
assert.equal(localTokenFileSerialized.includes('/Users/'), false);

const remoteTokenFileSerialized = JSON.stringify(remoteTokenFileHealth);
assert.equal(remoteTokenFileSerialized.includes('reviewed-remote-token'), false);
assert.equal(remoteTokenFileSerialized.includes('.switchboard'), false);
assert.equal(remoteTokenFileSerialized.includes('/Users/'), false);

const invalidTokenFileSerialized = JSON.stringify(invalidTokenFileHealth);
assert.equal(invalidTokenFileSerialized.includes('.switchboard'), false);
assert.equal(invalidTokenFileSerialized.includes('/Users/'), false);

const remoteInvalidTokenFileSerialized = JSON.stringify(remoteInvalidTokenFileHealth);
assert.equal(remoteInvalidTokenFileSerialized.includes('.switchboard'), false);
assert.equal(remoteInvalidTokenFileSerialized.includes('/Users/'), false);

const invalidDefaultTokenDirectorySerialized = JSON.stringify(invalidDefaultTokenDirectoryHealth);
assert.equal(invalidDefaultTokenDirectorySerialized.includes('.switchboard'), false);
assert.equal(invalidDefaultTokenDirectorySerialized.includes('/Users/'), false);

const remoteInvalidDefaultTokenDirectorySerialized = JSON.stringify(remoteInvalidDefaultTokenDirectoryHealth);
assert.equal(remoteInvalidDefaultTokenDirectorySerialized.includes('.switchboard'), false);
assert.equal(remoteInvalidDefaultTokenDirectorySerialized.includes('/Users/'), false);

assert.equal(resolveBrokerProtocol({}), 'http');
assert.equal(resolveBrokerTlsEnabled({}), false);
assert.equal(resolveBrokerProtocol({ tlsEnabled: true }), 'https');
assert.equal(resolveBrokerTlsEnabled({ protocol: 'https' }), true);
assert.equal(resolveBrokerProtocol({ protocol: 'http', tlsEnabled: true }), 'http');
assert.equal(resolveBrokerTlsEnabled({ protocol: 'http', tlsEnabled: true }), true);

console.log('Health smoke test passed.');
