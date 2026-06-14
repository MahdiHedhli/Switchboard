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

const geminiCliPath = process.env.GEMINI_CLI_PATH ?? 'gemini';
const timeoutEnvName = 'SWITCHBOARD_GOOGLE_STATUS_TIMEOUT_MS';
const timeoutMs = parsePositiveInteger(process.env[timeoutEnvName], 15_000, timeoutEnvName);
const liveProbeEnabled = process.env.SWITCHBOARD_GOOGLE_LIVE_PROBE === '1';
const probeModel = trimToUndefined(process.env.SWITCHBOARD_GOOGLE_PROBE_MODEL);
const probePrompt = 'Return exactly SWITCHBOARD_GEMINI_STATUS_OK and nothing else.';

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
    return 'Gemini CLI';
  }

  return humanizeIdentifier(modelId.replace(/^gemini[-_]/, 'Gemini '), 'Gemini CLI');
}

function buildBaseAccount(versionOutput) {
  const signals = [
    buildSignal('source', 'source', 'gemini version'),
  ];

  if (trimToUndefined(versionOutput)) {
    signals.push(buildSignal('cli', 'cli', versionOutput));
  }

  return {
    id: 'google-gemini-cli',
    displayName: 'Gemini CLI',
    authMode: 'subscription',
    owner: 'operator',
    lastRefreshedAt: new Date().toISOString(),
    signals,
    quotas: [
      {
        modelId: 'gemini-cli',
        displayName: 'Gemini CLI',
        availability: 'unknown',
        authMode: 'subscription',
        usageUnit: 'unknown',
        source: 'cli',
        confidence: 'medium',
        interpretation: 'informational',
        notes: 'Informational only: Gemini CLI is installed, but live model access was not probed. Set SWITCHBOARD_GOOGLE_LIVE_PROBE=1 for a reviewed status probe.',
      },
    ],
  };
}

function buildProbeAccount(versionOutput, probeResult) {
  const parsed = parseJson(probeResult.stdout);
  const modelId = safeSignalValue(firstModelFromStats(parsed?.stats) ?? probeModel ?? 'gemini-cli');
  const response = trimToUndefined(parsed?.response);
  const ok = probeResult.code === 0 && response === 'SWITCHBOARD_GEMINI_STATUS_OK';
  const signals = [
    buildSignal('source', 'source', ok ? 'gemini live probe' : 'gemini cli unavailable'),
    buildSignal('probe', 'probe', ok ? 'ok' : 'failed'),
    buildSignal('model', 'model', modelId),
  ];

  if (trimToUndefined(versionOutput)) {
    signals.push(buildSignal('cli', 'cli', versionOutput));
  }

  return {
    id: ok ? 'google-gemini-cli' : 'google-gemini-probe-unavailable',
    displayName: 'Gemini CLI',
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
          ? 'Informational only: Gemini CLI live probe succeeded, but typed quota windows are not available through this wrapper yet.'
          : 'Gemini CLI live probe failed or returned an unexpected response; typed quota windows are not available.',
      },
    ],
  };
}

async function buildPayload() {
  let versionOutput;
  try {
    const version = await runProviderCommand(geminiCliPath, ['--version'], { timeoutMs });
    if (version.code === 0) {
      versionOutput = version.stdout || version.stderr;
    }
  } catch {
    return {
      provider: 'google',
      accounts: [
        unavailableAccount({
          id: 'google-gemini-unavailable',
          displayName: 'Gemini CLI',
          modelId: 'gemini-cli',
          modelDisplayName: 'Gemini CLI',
          source: 'gemini cli unavailable',
          note: 'Gemini CLI is unavailable or timed out in this shell; no credential material was read.',
        }),
      ],
    };
  }

  if (!liveProbeEnabled) {
    return {
      provider: 'google',
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

    const probe = await runProviderCommand(geminiCliPath, args, { timeoutMs });
    return {
      provider: 'google',
      accounts: [buildProbeAccount(versionOutput, probe)],
    };
  } catch {
    return {
      provider: 'google',
      accounts: [
        unavailableAccount({
          id: 'google-gemini-probe-unavailable',
          displayName: 'Gemini CLI',
          modelId: 'gemini-cli',
          modelDisplayName: 'Gemini CLI',
          source: 'gemini cli unavailable',
          note: 'Gemini CLI live probe failed in this shell; no credential material was read.',
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
      provider: 'google',
      accounts: [
        unavailableAccount({
          id: 'google-gemini-wrapper-unavailable',
          displayName: 'Gemini CLI',
          modelId: 'gemini-cli',
          modelDisplayName: 'Gemini CLI',
          source: 'gemini cli unavailable',
          note: 'Gemini wrapper failed before producing provider status; no credential material was read.',
        }),
      ],
    })}\n`);
  });
