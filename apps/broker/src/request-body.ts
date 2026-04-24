import type { IncomingHttpHeaders } from 'node:http';

export const defaultMaxBodySizeBytes = 256 * 1024;
export const invalidJsonContentTypeDetail = 'Request body must use application/json.';
export const invalidJsonBodyDetail = 'Request body must contain valid JSON.';

const badRequestMessagePatterns = [
  /^Request body\b/,
  /^task(?:\.|\b)/,
  /^taskPatch(?:\.|\b)/,
  /^payload(?:\.|\b)/,
  /^subscriptions(?:\.|\[|\b)/,
  /^subscription\.signals(?:\.|\[|\b)/,
  /^refreshRequest(?:\.|\b)/,
];

type JsonRequestBodySource = AsyncIterable<Buffer | string | Uint8Array> & {
  headers: IncomingHttpHeaders;
};

export function parseJsonRequestBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(invalidJsonBodyDetail);
  }
}

export function buildRequestBodyTooLargeDetail(maxBytes: number): string {
  return `Request body exceeds ${maxBytes} bytes.`;
}

export async function readJsonRequestBody(
  source: JsonRequestBodySource,
  maxBodySizeBytes = defaultMaxBodySizeBytes,
): Promise<unknown> {
  const contentType = source.headers['content-type'];
  const contentTypeValue = Array.isArray(contentType) ? contentType.join(', ') : contentType;
  if (!contentTypeValue?.includes('application/json')) {
    throw new Error(invalidJsonContentTypeDetail);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > maxBodySizeBytes) {
      throw new Error(buildRequestBodyTooLargeDetail(maxBodySizeBytes));
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return parseJsonRequestBody(Buffer.concat(chunks).toString('utf8'));
}

export function isBrokerBadRequestError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return badRequestMessagePatterns.some((pattern) => pattern.test(error.message));
}
