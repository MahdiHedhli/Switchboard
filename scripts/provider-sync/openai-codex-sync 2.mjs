import { spawn } from 'node:child_process';

const codexCliPath = process.env.CODEX_CLI_PATH ?? 'codex';
const timeoutMs = parsePositiveInteger(process.env.SWITCHBOARD_CODEX_STATUS_TIMEOUT_MS, 10_000);
const maxOutputBytes = 32 * 1024;

function parsePositiveInteger(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('SWITCHBOARD_CODEX_STATUS_TIMEOUT_MS must be a positive integer when configured.');
  }

  return parsed;
}

function runCodex(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexCliPath, args, {
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
      reject(new Error(`Codex CLI timed out after ${timeoutMs}ms while running "${args.join(' ')}".`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.byteLength;
      if (stdoutBytes > maxOutputBytes && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(new Error(`Codex CLI produced more than ${maxOutputBytes} bytes while running "${args.join(' ')}".`));
        return;
      }

      stdoutChunks.push(buffer);
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Failed to start Codex CLI: ${error.message}`));
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (code !== 0) {
        reject(new Error(stderr || stdout || `Codex CLI exited with code ${code} while running "${args.join(' ')}".`));
        return;
      }

      resolve({
        stdout,
        stderr,
      });
    });
  });
}

function deriveAccount(statusOutput, versionOutput) {
  const normalized = statusOutput.toLowerCase();
  const versionNote = versionOutput ? `codex=${versionOutput}` : 'codex version unavailable';

  if (normalized.includes('logged in using chatgpt') || normalized.includes('signed in with your chatgpt account')) {
    return {
      id: 'openai-codex-chatgpt',
      displayName: 'Codex Supervisor',
      authMode: 'subscription',
      availability: 'available',
      confidence: 'medium',
      notes: `${versionNote}; Codex CLI reports ChatGPT-backed login, but does not expose remaining credits locally.`,
    };
  }

  if (normalized.includes('api key configured') || normalized.includes('logged in using an api key')) {
    return {
      id: 'openai-codex-api-key',
      displayName: 'Codex Supervisor',
      authMode: 'api',
      availability: 'constrained',
      confidence: 'medium',
      notes: `${versionNote}; Codex CLI is using API-key auth. Switchboard currently prefers ChatGPT subscription-backed supervisor access.`,
    };
  }

  if (normalized.includes('not logged in')) {
    return {
      id: 'openai-codex-signed-out',
      displayName: 'Codex Supervisor',
      authMode: 'subscription',
      availability: 'unavailable',
      confidence: 'high',
      notes: `${versionNote}; Codex CLI is signed out, so the supervisor surface is unavailable until ChatGPT login is restored.`,
    };
  }

  return {
    id: 'openai-codex-unknown',
    displayName: 'Codex Supervisor',
    authMode: 'subscription',
    availability: 'unknown',
    confidence: 'low',
    notes: `${versionNote}; Codex CLI returned an unrecognized login status: "${statusOutput}".`,
  };
}

async function main() {
  const [statusResult, versionResult] = await Promise.all([
    runCodex(['login', 'status']),
    runCodex(['--version']).catch(() => ({ stdout: '', stderr: '' })),
  ]);
  const statusOutput = statusResult.stdout || statusResult.stderr;
  const versionOutput = versionResult.stdout || versionResult.stderr;

  const account = deriveAccount(statusOutput, versionOutput);
  const payload = {
    provider: 'openai',
    accounts: [
      {
        id: account.id,
        displayName: account.displayName,
        authMode: account.authMode,
        owner: 'operator',
        lastRefreshedAt: new Date().toISOString(),
        quotas: [
          {
            modelId: 'codex',
            displayName: 'Codex',
            availability: account.availability,
            authMode: account.authMode,
            usageUnit: 'credits',
            source: 'cli',
            confidence: account.confidence,
            notes: account.notes,
          },
        ],
      },
    ],
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
