import type { BrokerErrorCode, BrokerErrorResponse } from '@switchboard/core';

export const unexpectedBrokerErrorDetail = 'Unexpected broker error.';

export function buildBrokerErrorResponse(
  error: BrokerErrorCode,
  detail: string,
): BrokerErrorResponse {
  return {
    error,
    detail,
  };
}

export function buildMethodNotAllowedResponse(
  allowed: string[],
): BrokerErrorResponse {
  return buildBrokerErrorResponse('method_not_allowed', `Allowed methods: ${allowed.join(', ')}`);
}

export function buildInternalErrorResponse(
  _error: unknown,
): BrokerErrorResponse {
  return buildBrokerErrorResponse('internal_error', unexpectedBrokerErrorDetail);
}
