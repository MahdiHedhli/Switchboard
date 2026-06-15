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

const grokCliPath = process.env.GROK_CLI_PATH ?? 'grok';
const timeoutEnvName = 'SWITCHBOARD_XAI_STATUS_TIMEOUT_MS';
const timeoutMs = parsePositiveInteger(process.env[timeoutEnvName], 15_000, timeoutEnvName);
const liveProbeEnabled = process.env.SWITCHBOARD_XAI_LIVE_PROBE === '1';
const probeModel = trimToUndefined(process.env.SWITCHBOARD_XAI_PROBE_MODEL);
const probePrompt = 'Return exactly SWITCHBOARD_GROK_STATUS_OK and nothing else.';

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstModelFromStats(stats) {
  const models = stats?.models && typeof stats.models === 'object' ? Object.keys(stats.models) : [];
  return models.find(Boolean);
}

function displayNameForModel(modelId) {
  if (!modelId) {
    return 'Grok CLI';
  }

  return humanizeIdentifier(modelId.replace(/^grok[-_]/, 'Grok '), 'Grok CLI');
}

function buildBaseAccount(versionOutput) {
  const signals = [
    buildSignal('source', 'source', 'grok version'),
  ];

  if (trimToUndefined(versionOutput)) {
    signals.push(buildSignal('cli', 'cli', versionOutput));
  }

  return {
    id: 'xai-grok-cli',
    displayName: 'Grok CLI',
    authMode: 'subscription',
    owner: 'operator',
    lastRefreshedAt: new Date().toISOString(),
    signals,
    quotas: [
      {
        modelId: 'grok-cli',
        displayName: 'Grok CLI',
        availability: 'unknown',
        authMode: 'subscription',
        usageUnit: 'unknown',
        source: 'cli',
        confidence: 'medium',
        interpretation: 'informational',
        notes: 'Informational only: Grok CLI is installed, but live model access was not probed. Set SWITCHBOARD_XAI_LIVE_PROBE=1 for a reviewed status probe.',
      },
    ],
  };
}

function buildProbeAccount(versionOutput, probeResult) {
  const parsed = parseJson(probeResult.stdout);
  const modelId = safeSignalValue(firstModelFromStats(parsed?.stats) ?? probeModel ?? 'grok-cli');
  const response = trimToUndefined(parsed?.response);
  const ok = probeResult.code === 0 && response === 'SWITCHBOARD_GROK_STATUS_OK';
  const signals = [
    buildSignal('source', 'source', ok ? 'grok live probe' : 'grok cli unavailable'),
    buildSignal('probe', 'probe', ok ? 'ok' : 'failed'),
    buildSignal('model', 'model', modelId),
  ];

  if (trimToUndefined(versionOutput)) {
    signals.push(buildSignal('cli', 'cli', versionOutput));
  }

  return {
    id: ok ? 'xai-grok-cli' : 'xai-grok-probe-unavailable',
    displayName: 'Grok CLI',
    authMode: 'subscription',
    owner: 'operator',
    lastRefreshedAt: new Date().toISOString(),
    signals,
    quotas: [
      {
        modelId,
        displayName: displayNameForModel(modelId),
        availability: ok ? 'available' : 'unavailable',
        authMode: 'subscription',
        usageUnit: 'unknown',
        source: 'cli',
        confidence: ok ? 'high' : 'medium',
        interpretation: 'informational',
        notes: ok
          ? 'Informational only: Grok CLI live probe succeeded, but typed quota windows are not available through this wrapper yet.'
          : 'Grok CLI live probe failed or returned an unexpected response; typed quota windows are not available.',
      },
    ],
  };
}

async function buildPayload() {
  let versionOutput;
  try {
    const version = await runProviderCommand(grokCliPath, ['--version'], { timeoutMs });
    if (version.code === 0) {
      versionOutput = version.stdout || version.stderr;
    }
  } catch {
    return {
      provider: 'xai',
      accounts: [
        unavailableAccount({
          id: 'xai-grok-unavailable',
          displayName: 'Grok CLI',
          modelId: 'grok-cli',
          modelDisplayName: 'Grok CLI',
          source: 'grok cli unavailable',
          note: 'Grok CLI is unavailable or timed out in this shell; no credential material was read.',
        }),
      ],
    };
  }

  if (!liveProbeEnabled) {
    return {
      provider: 'xai',
      accounts: [buildBaseAccount(versionOutput)],
    };
  }

  try {
    const args = [
      '-p',
      probePrompt,
      '--approval-mode',
      'plan',
      '--output-format',
      'json',
    ];

    if (probeModel) {
      args.push('--model', probeModel);
    }

    const probe = await runProviderCommand(grokCliPath, args, { timeoutMs });
    return {
      provider: 'xai',
      accounts: [buildProbeAccount(versionOutput, probe)],
    };
  } catch {
    return {
      provider: 'xai',
      accounts: [
        unavailableAccount({
          id: 'xai-grok-probe-unavailable',
          displayName: 'Grok CLI',
          modelId: 'grok-cli',
          modelDisplayName: 'Grok CLI',
          source: 'grok cli unavailable',
          note: 'Grok CLI live probe failed in this shell; no credential material was read.',
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
      provider: 'xai',
      accounts: [
        unavailableAccount({
          id: 'xai-grok-wrapper-unavailable',
          displayName: 'Grok CLI',
          modelId: 'grok-cli',
          modelDisplayName: 'Grok CLI',
          source: 'grok cli unavailable',
          note: 'Grok wrapper failed before producing provider status; no credential material was read.',
        }),
      ],
    })}\n`);
  });
