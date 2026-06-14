#!/usr/bin/env node
import {
  buildSignal,
  humanizeIdentifier,
  parsePositiveInteger,
  runProviderCommand,
  safeSignalValue,
  trimToUndefined,
  unavailableAccount,
} from './provider-wrapper-utils.mjs';

const claudeCliPath = process.env.CLAUDE_CLI_PATH ?? 'claude';
const timeoutEnvName = 'SWITCHBOARD_ANTHROPIC_STATUS_TIMEOUT_MS';
const timeoutMs = parsePositiveInteger(process.env[timeoutEnvName], 10_000, timeoutEnvName);

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function authModeFromStatus(status) {
  const authMethod = String(status?.authMethod ?? '').toLowerCase();
  const apiProvider = String(status?.apiProvider ?? '').toLowerCase();

  if (authMethod.includes('api') || apiProvider === 'bedrock' || apiProvider === 'vertex') {
    return 'api';
  }

  if (authMethod.includes('claude.ai') || status?.loggedIn === true) {
    return 'subscription';
  }

  return 'subscription';
}

function accountIdFromStatus(status) {
  if (status?.loggedIn !== true) {
    return 'anthropic-claude-signed-out';
  }

  return authModeFromStatus(status) === 'api'
    ? 'anthropic-claude-api'
    : 'anthropic-claude-subscription';
}

function displayNameFromStatus(status) {
  if (status?.loggedIn !== true) {
    return 'Claude Code';
  }

  const subscriptionType = trimToUndefined(status?.subscriptionType);
  return subscriptionType
    ? `Claude Code (${humanizeIdentifier(subscriptionType)})`
    : 'Claude Code';
}

function safeAuthMethod(status) {
  const authMethod = safeSignalValue(status?.authMethod);
  if (authMethod === 'claude.ai' || authMethod === 'apiKey') {
    return authMethod;
  }

  return authMethod.toLowerCase().includes('api') ? 'apiKey' : 'unknown';
}

function buildAccount(status, versionOutput) {
  const loggedIn = status?.loggedIn === true;
  const authMode = authModeFromStatus(status);
  const subscriptionType = trimToUndefined(status?.subscriptionType);
  const signals = [
    buildSignal('source', 'source', 'claude auth status'),
    buildSignal('auth_method', 'auth-method', safeAuthMethod(status)),
  ];

  if (subscriptionType) {
    signals.push(buildSignal('subscription', 'subscription', humanizeIdentifier(subscriptionType)));
  }

  if (trimToUndefined(versionOutput)) {
    signals.push(buildSignal('cli', 'cli', versionOutput));
  }

  return {
    id: accountIdFromStatus(status),
    displayName: displayNameFromStatus(status),
    authMode,
    owner: 'operator',
    lastRefreshedAt: new Date().toISOString(),
    signals,
    quotas: [
      {
        modelId: 'claude-code',
        displayName: 'Claude Code',
        availability: loggedIn ? 'available' : 'unavailable',
        authMode,
        usageUnit: 'unknown',
        source: 'cli',
        confidence: loggedIn ? 'high' : 'medium',
        interpretation: 'informational',
        notes: loggedIn
          ? 'Informational only: Claude Code exposes sanitized auth posture locally; typed quota windows are not available through this wrapper yet.'
          : 'Claude Code is not signed in for this shell, so Anthropic work should stay unscheduled until login is restored.',
      },
    ],
  };
}

async function buildPayload() {
  let versionOutput;
  try {
    const version = await runProviderCommand(claudeCliPath, ['--version'], { timeoutMs });
    if (version.code === 0) {
      versionOutput = version.stdout || version.stderr;
    }
  } catch {
    return {
      provider: 'anthropic',
      accounts: [
        unavailableAccount({
          id: 'anthropic-claude-unavailable',
          displayName: 'Claude Code',
          modelId: 'claude-code',
          modelDisplayName: 'Claude Code',
          source: 'claude cli unavailable',
          note: 'Claude CLI is unavailable or timed out in this shell; no credential material was read.',
        }),
      ],
    };
  }

  try {
    const status = await runProviderCommand(claudeCliPath, ['auth', 'status', '--json'], { timeoutMs });
    const parsed = status.code === 0 ? parseJson(status.stdout) : null;

    if (!parsed) {
      return {
        provider: 'anthropic',
        accounts: [
          unavailableAccount({
            id: 'anthropic-claude-status-unavailable',
            displayName: 'Claude Code',
            modelId: 'claude-code',
            modelDisplayName: 'Claude Code',
            source: 'claude cli unavailable',
            note: 'Claude auth status was unavailable or not JSON; no credential material was read.',
          }),
        ],
      };
    }

    return {
      provider: 'anthropic',
      accounts: [buildAccount(parsed, versionOutput)],
    };
  } catch {
    return {
      provider: 'anthropic',
      accounts: [
        unavailableAccount({
          id: 'anthropic-claude-status-unavailable',
          displayName: 'Claude Code',
          modelId: 'claude-code',
          modelDisplayName: 'Claude Code',
          source: 'claude cli unavailable',
          note: 'Claude auth status failed in this shell; no credential material was read.',
        }),
      ],
    };
  }
}

buildPayload()
  .then((payload) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  })
  .catch(() => {
    process.stdout.write(`${JSON.stringify({
      provider: 'anthropic',
      accounts: [
        unavailableAccount({
          id: 'anthropic-claude-wrapper-unavailable',
          displayName: 'Claude Code',
          modelId: 'claude-code',
          modelDisplayName: 'Claude Code',
          source: 'claude cli unavailable',
          note: 'Claude wrapper failed before producing provider status; no credential material was read.',
        }),
      ],
    })}\n`);
  });
