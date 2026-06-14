import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isLoopbackHost } from './auth-policy.js';

const defaultHost = '127.0.0.1';
const defaultPort = 7007;

export type BrokerOperatorTokenSource = 'direct' | 'env' | 'file' | 'unset';

interface ResolvedOperatorToken {
  token?: string;
  configured: boolean;
  source: BrokerOperatorTokenSource;
  file?: string;
  problem?: string;
}

interface ResolvedTlsConfiguration {
  enabled: boolean;
  cert?: Buffer;
  key?: Buffer;
  ca?: Buffer;
  certFile?: string;
  keyFile?: string;
  caFile?: string;
  problem?: string;
}

export interface BrokerRuntimeSummary {
  host: string;
  port: number;
  localOnly: boolean;
  allowRemote: boolean;
  allowOpenLoopbackMutations: boolean;
  manualSubscriptionReplaceEnabled: boolean;
  operatorTokenConfigured: boolean;
  operatorTokenSource: BrokerOperatorTokenSource;
  operatorTokenFile?: string;
  operatorTokenProblem?: string;
  protocol: 'http' | 'https';
  tlsEnabled: boolean;
  tlsCertFile?: string;
  tlsKeyFile?: string;
  tlsCaFile?: string;
  tlsProblem?: string;
}

export interface BrokerRuntimeConfig {
  host: string;
  port: number;
  profilesDir: string;
  stateDir: string;
  snapshotDir: string;
  operatorToken?: string;
  manualSubscriptionReplaceEnabled: boolean;
  summary: BrokerRuntimeSummary;
  tls?: {
    cert: Buffer;
    key: Buffer;
    ca?: Buffer;
  };
}

export interface BrokerRuntimeOptions {
  host?: string;
  port?: number;
  profilesDir: string;
  stateDir: string;
  snapshotDir: string;
  operatorToken?: string;
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeFileLabel(filePath: string | undefined): string | undefined {
  return filePath ? path.basename(filePath) : undefined;
}

async function assertReadableFile(filePath: string, label: string): Promise<void> {
  const metadata = await stat(filePath);

  if (!metadata.isFile()) {
    throw new Error(`${label} must point to a regular file.`);
  }
}

async function assertPrivateFile(filePath: string, label: string): Promise<void> {
  const metadata = await stat(filePath);

  if (!metadata.isFile()) {
    throw new Error(`${label} must point to a regular file.`);
  }

  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be accessible by group or others. Use chmod 600.`);
  }
}

async function assertPrivateDefaultTokenDirectory(filePath: string, label: string): Promise<void> {
  const directoryPath = path.dirname(filePath);

  if (path.basename(directoryPath) !== '.switchboard') {
    return;
  }

  const metadata = await stat(directoryPath);

  if (!metadata.isDirectory()) {
    throw new Error(`Parent directory for ${label} must be a directory.`);
  }

  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Parent directory for ${label} must not be accessible by group or others. Use chmod 700.`);
  }
}

async function resolveOperatorTokenFromEnvironment(env: NodeJS.ProcessEnv): Promise<ResolvedOperatorToken> {
  const operatorToken = trimToUndefined(env.SWITCHBOARD_OPERATOR_TOKEN);
  const operatorTokenFile = trimToUndefined(env.SWITCHBOARD_OPERATOR_TOKEN_FILE);

  if (operatorToken && operatorTokenFile) {
    return {
      configured: false,
      source: 'env',
      file: operatorTokenFile,
      problem: 'Set either SWITCHBOARD_OPERATOR_TOKEN or SWITCHBOARD_OPERATOR_TOKEN_FILE, not both.',
    };
  }

  if (operatorToken) {
    return {
      token: operatorToken,
      configured: true,
      source: 'env',
    };
  }

  if (!operatorTokenFile) {
    return {
      configured: false,
      source: 'unset',
    };
  }

  try {
    await assertPrivateDefaultTokenDirectory(operatorTokenFile, 'SWITCHBOARD_OPERATOR_TOKEN_FILE');
    await assertPrivateFile(operatorTokenFile, 'SWITCHBOARD_OPERATOR_TOKEN_FILE');
    const token = trimToUndefined(await readFile(operatorTokenFile, 'utf8'));

    if (!token) {
      throw new Error('SWITCHBOARD_OPERATOR_TOKEN_FILE must contain a non-empty token value.');
    }

    return {
      token,
      configured: true,
      source: 'file',
      file: operatorTokenFile,
    };
  } catch (error) {
    return {
      configured: false,
      source: 'file',
      file: operatorTokenFile,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveDirectTlsFromEnvironment(env: NodeJS.ProcessEnv): Promise<ResolvedTlsConfiguration> {
  const certFile = trimToUndefined(env.SWITCHBOARD_TLS_CERT_FILE);
  const keyFile = trimToUndefined(env.SWITCHBOARD_TLS_KEY_FILE);
  const caFile = trimToUndefined(env.SWITCHBOARD_TLS_CA_FILE);

  if (!certFile && !keyFile && !caFile) {
    return {
      enabled: false,
    };
  }

  if (!certFile || !keyFile) {
    return {
      enabled: false,
      certFile,
      keyFile,
      caFile,
      problem: 'Direct TLS requires both SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE.',
    };
  }

  try {
    await assertReadableFile(certFile, 'SWITCHBOARD_TLS_CERT_FILE');
    await assertPrivateFile(keyFile, 'SWITCHBOARD_TLS_KEY_FILE');
    if (caFile) {
      await assertReadableFile(caFile, 'SWITCHBOARD_TLS_CA_FILE');
    }

    return {
      enabled: true,
      cert: await readFile(certFile),
      key: await readFile(keyFile),
      ca: caFile ? await readFile(caFile) : undefined,
      certFile,
      keyFile,
      caFile,
    };
  } catch (error) {
    return {
      enabled: false,
      certFile,
      keyFile,
      caFile,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertBrokerExposurePolicy(host: string, allowRemote: boolean, tlsEnabled: boolean): void {
  if (isLoopbackHost(host)) {
    return;
  }

  if (!allowRemote) {
    throw new Error(`Refusing to bind broker to non-local host "${host}" without SWITCHBOARD_ALLOW_REMOTE=1.`);
  }

  if (!tlsEnabled) {
    throw new Error(
      `Refusing to bind broker to non-local host "${host}" without direct TLS via SWITCHBOARD_TLS_CERT_FILE and SWITCHBOARD_TLS_KEY_FILE.`,
    );
  }
}

export async function summarizeBrokerRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Pick<BrokerRuntimeOptions, 'host' | 'port' | 'operatorToken'> = {},
): Promise<BrokerRuntimeSummary> {
  const host = overrides.host ?? env.SWITCHBOARD_BROKER_HOST ?? defaultHost;
  const port = overrides.port ?? Number(env.SWITCHBOARD_BROKER_PORT ?? defaultPort);
  const allowRemote = env.SWITCHBOARD_ALLOW_REMOTE === '1';
  const allowOpenLoopbackMutations = env.SWITCHBOARD_ALLOW_OPEN_LOOPBACK_MUTATIONS === '1';
  const manualSubscriptionReplaceEnabled = env.SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE === '1';
  const directOperatorToken = trimToUndefined(overrides.operatorToken);
  const operatorToken = directOperatorToken
    ? {
      configured: true,
      source: 'direct' as const,
      token: directOperatorToken,
    }
    : await resolveOperatorTokenFromEnvironment(env);
  const directTls = await resolveDirectTlsFromEnvironment(env);

  return {
    host,
    port,
    localOnly: isLoopbackHost(host),
    allowRemote,
    allowOpenLoopbackMutations,
    manualSubscriptionReplaceEnabled,
    operatorTokenConfigured: operatorToken.configured,
    operatorTokenSource: operatorToken.source,
    operatorTokenFile: sanitizeFileLabel(operatorToken.file),
    operatorTokenProblem: operatorToken.problem,
    protocol: directTls.enabled ? 'https' : 'http',
    tlsEnabled: directTls.enabled,
    tlsCertFile: sanitizeFileLabel(directTls.certFile),
    tlsKeyFile: sanitizeFileLabel(directTls.keyFile),
    tlsCaFile: sanitizeFileLabel(directTls.caFile),
    tlsProblem: directTls.problem,
  };
}

export async function loadBrokerRuntimeConfig(options: BrokerRuntimeOptions): Promise<BrokerRuntimeConfig> {
  const summary = await summarizeBrokerRuntimeEnvironment(process.env, options);
  const directOperatorToken = trimToUndefined(options.operatorToken);
  const operatorToken = directOperatorToken
    ? {
      configured: true,
      source: 'direct' as const,
      token: directOperatorToken,
    }
    : await resolveOperatorTokenFromEnvironment(process.env);
  const directTls = await resolveDirectTlsFromEnvironment(process.env);

  if (operatorToken.problem) {
    throw new Error(operatorToken.problem);
  }

  if (directTls.problem) {
    throw new Error(directTls.problem);
  }

  assertBrokerExposurePolicy(summary.host, summary.allowRemote, directTls.enabled);

  return {
    host: summary.host,
    port: summary.port,
    profilesDir: options.profilesDir,
    stateDir: options.stateDir,
    snapshotDir: options.snapshotDir,
    operatorToken: operatorToken.token,
    manualSubscriptionReplaceEnabled: summary.manualSubscriptionReplaceEnabled,
    summary,
    tls: directTls.enabled && directTls.cert && directTls.key
      ? {
        cert: directTls.cert,
        key: directTls.key,
        ca: directTls.ca,
      }
      : undefined,
  };
}

export function describeBrokerOrigin(summary: Pick<BrokerRuntimeSummary, 'host' | 'port' | 'protocol'>): string {
  return `${summary.protocol}://${summary.host}:${summary.port}`;
}
