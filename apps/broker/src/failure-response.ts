import type { BrokerErrorResponse } from '@switchboard/core';
import { buildAdapterRefreshConflictDetail } from './adapter-conflict.js';
import { AdapterRefreshError } from './adapters/types.js';
import { buildBrokerErrorResponse, buildInternalErrorResponse } from './error-response.js';
import { isBrokerBadRequestError } from './request-body.js';
import { TaskConflictError, TaskNotFoundError } from './state-store.js';

export interface BrokerFailureResponse {
  statusCode: 400 | 404 | 409 | 500;
  payload: BrokerErrorResponse;
}

export function buildBrokerFailureResponse(error: unknown): BrokerFailureResponse {
  if (error instanceof TaskNotFoundError) {
    return {
      statusCode: 404,
      payload: buildBrokerErrorResponse('not_found', error.message),
    };
  }

  if (error instanceof TaskConflictError) {
    return {
      statusCode: 409,
      payload: buildBrokerErrorResponse('conflict', error.message),
    };
  }

  if (error instanceof AdapterRefreshError) {
    return {
      statusCode: 409,
      payload: buildBrokerErrorResponse('conflict', buildAdapterRefreshConflictDetail(error)),
    };
  }

  if (isBrokerBadRequestError(error)) {
    return {
      statusCode: 400,
      payload: buildBrokerErrorResponse('bad_request', error.message),
    };
  }

  return {
    statusCode: 500,
    payload: buildInternalErrorResponse(error),
  };
}
