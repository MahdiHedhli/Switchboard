import type http from 'node:http';
import type { BrokerErrorResponse } from '@switchboard/core';
import { type BrokerMutationScope, BrokerAuthPolicy } from './auth-policy.js';
import { buildBrokerErrorResponse } from './error-response.js';

export type BrokerMutationAuthorizationResult =
  | { ok: true }
  | {
      ok: false;
      statusCode: 401 | 403;
      payload: BrokerErrorResponse;
    };

export function authorizeBrokerMutationRequest(
  request: http.IncomingMessage,
  authPolicy: BrokerAuthPolicy,
  scope: BrokerMutationScope,
): BrokerMutationAuthorizationResult {
  const authorization = authPolicy.authorize(request, scope);
  if (authorization.ok) {
    return { ok: true };
  }

  if (authorization.statusCode === 403) {
    return {
      ok: false,
      statusCode: 403,
      payload: buildBrokerErrorResponse('forbidden', authorization.detail ?? 'This route is not enabled.'),
    };
  }

  return {
    ok: false,
    statusCode: 401,
    payload: buildBrokerErrorResponse(
      'unauthorized',
      authorization.detail ?? 'A valid operator token is required for this mutation route.',
    ),
  };
}
