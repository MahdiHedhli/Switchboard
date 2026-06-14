import { spawn } from 'node:child_process';

export const maxProviderOutputBytes = 64 * 1024;

export function parsePositiveInteger(rawValue, fallback, envName) {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer when configured.`);
  }

  return parsed;
}

export function trimToUndefined(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function humanizeIdentifier(value, fallback = 'Unknown') {
  const trimmed = trimToUndefined(String(value ?? ''));
  if (!trimmed) {
    return fallback;
  }

  return trimmed
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function safeSignalValue(value, fallback = 'unknown') {
  const trimmed = trimToUndefined(String(value ?? ''));
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[^a-zA-Z0-9._:+ -]/g, '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function buildSignal(id, label, value) {
  return {
    id,
    label,
    value: safeSignalValue(value),
  };
}

export function runProviderCommand(command, args, { timeoutMs, maxOutputBytes = maxProviderOutputBytes }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      reject(new Error('command_timeout'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.byteLength;

      if (stdoutBytes > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(new Error('command_output_limit'));
        return;
      }

      stdoutChunks.push(buffer);
    });

    child.stderr.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stderrChunks.reduce((total, entry) => total + entry.byteLength, 0) < 16 * 1024) {
        stderrChunks.push(buffer);
      }
    });

    child.once('error', () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error('command_unavailable'));
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
      });
    });
  });
}

export function unavailableAccount({
  id,
  displayName,
  modelId,
  modelDisplayName,
  source,
  note,
}) {
  return {
    id,
    displayName,
    authMode: 'subscription',
    owner: 'operator',
    lastRefreshedAt: new Date().toISOString(),
    signals: [
      buildSignal('source', 'source', source),
    ],
    quotas: [
      {
        modelId,
        displayName: modelDisplayName,
        availability: 'unavailable',
        authMode: 'subscription',
        usageUnit: 'unknown',
        source: 'cli',
        confidence: 'low',
        interpretation: 'informational',
        notes: note,
      },
    ],
  };
}
