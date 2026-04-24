import { timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import type { BrokerAuthSummary, BrokerMutationAccess, BrokerScopeSummary } from '@switchboard/core';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export const operatorTokenHeaderName = 'X-Switchboard-Operator-Token';

export type BrokerMutationScope =
  | 'taskCreate'
  | 'taskUpdate'
  | 'subscriptionRefresh'
  | 'subscriptionReplace';

export type BrokerAuthRequirement = BrokerMutationAccess;

export interface BrokerScopePolicy extends BrokerScopeSummary {}

interface BrokerAuthPolicyOptions {
  host: string;
  operatorToken?: string;
  manualSubscriptionReplaceEnabled?: boolean;
}

interface AuthorizationResult {
  ok: boolean;
  requirement: BrokerAuthRequirement;
  statusCode?: 401 | 403;
  detail?: string;
}

function disabled(detail: string): BrokerScopePolicy {
  return {
    requirement: 'disabled',
    detail,
  };
}

function operatorToken(detail: string): BrokerScopePolicy {
  return {
    requirement: 'operator_token',
    detail,
  };
}

function open(detail: string): BrokerScopePolicy {
  return {
    requirement: 'open',
    detail,
  };
}

function createScopePolicy(
  scope: BrokerMutationScope,
  localOnly: boolean,
  operatorTokenConfigured: boolean,
  manualSubscriptionReplaceEnabled: boolean,
): BrokerScopePolicy {
  if (scope === 'subscriptionReplace' && !manualSubscriptionReplaceEnabled) {
    return disabled(
      'Direct subscription replacement is disabled by default. Prefer provider refresh, or enable reviewed local recovery with SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1.',
    );
  }

  if (!localOnly && !operatorTokenConfigured) {
    return disabled(
      `Non-local broker exposure requires ${operatorTokenHeaderName} via SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE before mutation routes may be used.`,
    );
  }

  if (operatorTokenConfigured) {
    return operatorToken(`This route requires ${operatorTokenHeaderName}.`);
  }

  return open('Allowed while the broker stays loopback-only.');
}

export function isLoopbackHost(host: string): boolean {
  return loopbackHosts.has(host);
}

export class BrokerAuthPolicy {
  readonly localOnly: boolean;
  readonly operatorTokenConfigured: boolean;
  readonly manualSubscriptionReplaceEnabled: boolean;
  readonly scopes: Record<BrokerMutationScope, BrokerScopePolicy>;

  constructor(private readonly options: BrokerAuthPolicyOptions) {
    this.localOnly = isLoopbackHost(options.host);
    this.operatorTokenConfigured = Boolean(options.operatorToken);
    this.manualSubscriptionReplaceEnabled = options.manualSubscriptionReplaceEnabled ?? false;
    this.scopes = {
      taskCreate: createScopePolicy(
        'taskCreate',
        this.localOnly,
        this.operatorTokenConfigured,
        this.manualSubscriptionReplaceEnabled,
      ),
      taskUpdate: createScopePolicy(
        'taskUpdate',
        this.localOnly,
        this.operatorTokenConfigured,
        this.manualSubscriptionReplaceEnabled,
      ),
      subscriptionRefresh: createScopePolicy(
        'subscriptionRefresh',
        this.localOnly,
        this.operatorTokenConfigured,
        this.manualSubscriptionReplaceEnabled,
      ),
      subscriptionReplace: createScopePolicy(
        'subscriptionReplace',
        this.localOnly,
        this.operatorTokenConfigured,
        this.manualSubscriptionReplaceEnabled,
      ),
    };
  }

  summary(): BrokerAuthSummary {
    return {
      localOnly: this.localOnly,
      remoteExposureAllowed: !this.localOnly,
      operatorTokenConfigured: this.operatorTokenConfigured,
      manualSubscriptionReplaceEnabled: this.manualSubscriptionReplaceEnabled,
      operatorTokenHeader: operatorTokenHeaderName,
      scopes: this.scopes,
    };
  }

  authorize(request: http.IncomingMessage, scope: BrokerMutationScope): AuthorizationResult {
    const policy = this.scopes[scope];

    if (policy.requirement === 'disabled') {
      return {
        ok: false,
        requirement: policy.requirement,
        statusCode: 403,
        detail: policy.detail,
      };
    }

    if (policy.requirement === 'open') {
      return {
        ok: true,
        requirement: policy.requirement,
      };
    }

    if (this.hasValidOperatorToken(request)) {
      return {
        ok: true,
        requirement: policy.requirement,
      };
    }

    return {
      ok: false,
      requirement: policy.requirement,
      statusCode: 401,
      detail: `${policy.detail} Provide the header ${operatorTokenHeaderName}.`,
    };
  }

  private hasValidOperatorToken(request: http.IncomingMessage): boolean {
    const expectedValue = this.options.operatorToken;
    if (!expectedValue) {
      return true;
    }

    const headerValue = request.headers[operatorTokenHeaderName.toLowerCase()];
    if (typeof headerValue !== 'string') {
      return false;
    }

    const provided = Buffer.from(headerValue);
    const expected = Buffer.from(expectedValue);
    if (provided.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(provided, expected);
  }
}
