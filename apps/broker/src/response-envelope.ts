import { buildMethodNotAllowedResponse } from './error-response.js';

export interface BrokerHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const brokerJsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function buildBrokerJsonHeaders(
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    ...brokerJsonHeaders,
    ...extraHeaders,
  };
}

export function buildBrokerJsonResponse(
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): BrokerHttpResponse {
  return {
    statusCode,
    headers: buildBrokerJsonHeaders(extraHeaders),
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

export function buildMethodNotAllowedHttpResponse(
  allowed: string[],
): BrokerHttpResponse {
  return buildBrokerJsonResponse(
    405,
    buildMethodNotAllowedResponse(allowed),
    { Allow: allowed.join(', ') },
  );
}
