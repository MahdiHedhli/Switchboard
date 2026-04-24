import { buildBrokerErrorResponse, buildInternalErrorResponse } from './error-response.js';
import { buildBrokerJsonResponse, type BrokerHttpResponse } from './response-envelope.js';

export function buildNotFoundHttpResponse(detail: string): BrokerHttpResponse {
  return buildBrokerJsonResponse(404, buildBrokerErrorResponse('not_found', detail));
}

export function buildBadRequestHttpResponse(detail: string): BrokerHttpResponse {
  return buildBrokerJsonResponse(400, buildBrokerErrorResponse('bad_request', detail));
}

export function buildUnauthorizedHttpResponse(detail: string): BrokerHttpResponse {
  return buildBrokerJsonResponse(401, buildBrokerErrorResponse('unauthorized', detail));
}

export function buildForbiddenHttpResponse(detail: string): BrokerHttpResponse {
  return buildBrokerJsonResponse(403, buildBrokerErrorResponse('forbidden', detail));
}

export function buildConflictHttpResponse(detail: string): BrokerHttpResponse {
  return buildBrokerJsonResponse(409, buildBrokerErrorResponse('conflict', detail));
}

export function buildInternalErrorHttpResponse(error: unknown): BrokerHttpResponse {
  return buildBrokerJsonResponse(500, buildInternalErrorResponse(error));
}
