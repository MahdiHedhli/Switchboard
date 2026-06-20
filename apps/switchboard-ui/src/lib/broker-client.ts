/*
 * Thin broker HTTP helpers shared by the dashboard's load + mutation paths.
 * Pure functions: response parsing (surfacing the broker's `detail` on failure)
 * and operator-token header assembly.
 */
export async function parseBrokerResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let detail = `Broker request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload.detail) {
      detail = payload.detail;
    }
  } catch {
    // Keep the default error when the body is not JSON.
  }

  throw new Error(detail);
}

export function buildMutationHeaders(operatorToken: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (operatorToken.trim()) {
    headers['X-Switchboard-Operator-Token'] = operatorToken.trim();
  }

  return headers;
}
