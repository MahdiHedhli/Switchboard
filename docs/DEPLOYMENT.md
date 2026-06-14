# Deployment Guidance

## Default mode

Switchboard should run as a local-only broker by default.

Recommended baseline:
- bind the broker to `127.0.0.1`
- keep `.switchboard/state/` and `.switchboard/provider-snapshots/` on private local storage
- use sanitized quota snapshots only
- store the operator token in a private file and point Switchboard at it with `SWITCHBOARD_OPERATOR_TOKEN_FILE`
- keep trusted provider refresh commands in local environment config, not in git-backed project files
- validate the intended deployment mode with `npm run doctor:operator -- local-only` or `npm run doctor:operator -- remote-trusted`

Healthy local-only shells now keep that token-file posture explicit too: when you use `SWITCHBOARD_OPERATOR_TOKEN_FILE`, `doctor:operator` and `doctor:preflight` stay `ready`, preserve `operatorTokenSource: file`, show basename-only `operatorTokenFile: operator-token`, and keep the same `local-only; host=127.0.0.1` summary text as the env-token baseline.
For reviewed file-backed rollout checks, the higher-level `smoke:preflight` and `smoke:doctor-contracts` paths now also preserve the healthy mixed `1/2` OpenAI/Codex detail on both local-only and remote-trusted `SWITCHBOARD_OPERATOR_TOKEN_FILE` shells, including the richer nested raw `userAgent` / `accountType` / `plan` / `endpoint` fields and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, not just the unrestricted broker persistence path.

## Local-only operator setup

Suggested environment:

```bash
npm run operator-token:save
export SWITCHBOARD_OPERATOR_TOKEN_FILE="$HOME/.switchboard/operator-token"
export SWITCHBOARD_BROKER_HOST=127.0.0.1
export SWITCHBOARD_BROKER_PORT=7007
```

Optional recovery-only flag:

```bash
export SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1
```

Use that flag only for reviewed local repair flows. Direct subscription replacement is disabled by default because it bypasses the adapter refresh path.

Optional trusted provider sync:

```bash
export SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON='["node","/absolute/path/to/openai-sync.mjs"]'
```

These commands should be reviewed local wrappers only. They run without shell expansion and must emit sanitized JSON to stdout.

For the current Codex-first setup, the repo-owned wrapper lives at `scripts/provider-sync/openai-codex-sync.mjs`.

See [docs/OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md) for the full dry-run sequence.

## Remote-trusted setup

Remote or shared-network exposure is higher risk and should stay exceptional.

Minimum requirements:
- set `SWITCHBOARD_ALLOW_REMOTE=1`
- set a strong operator token, preferably through `SWITCHBOARD_OPERATOR_TOKEN_FILE`
- configure `SWITCHBOARD_TLS_CERT_FILE` and `SWITCHBOARD_TLS_KEY_FILE`
- restrict ingress to a trusted operator network or bastion
- keep state and snapshot directories on private storage with restrictive permissions
- do not expose raw provider credentials, CLI caches, or session material through mounted volumes

Without an operator token, non-local mutation routes stay disabled by policy.
Without direct TLS material, non-local broker startup now fails closed by policy.
Loopback mutation routes also require an operator token by default; `SWITCHBOARD_ALLOW_OPEN_LOOPBACK_MUTATIONS=1` is only for disposable local development.

Recommended remote-trusted launch:

```bash
export SWITCHBOARD_BROKER_HOST=0.0.0.0
export SWITCHBOARD_BROKER_PORT=7007
export SWITCHBOARD_ALLOW_REMOTE=1
export SWITCHBOARD_OPERATOR_TOKEN_FILE="$HOME/.switchboard/operator-token"
export SWITCHBOARD_TLS_CERT_FILE="/etc/letsencrypt/live/switchboard/fullchain.pem"
export SWITCHBOARD_TLS_KEY_FILE="/etc/letsencrypt/live/switchboard/privkey.pem"
npm run dev:broker:remote-trusted
```

Before rollout, run `npm run doctor:operator -- remote-trusted` to confirm the current shell actually matches the expected remote-trusted baseline.
If `SWITCHBOARD_OPERATOR_TOKEN_FILE` is unset, `npm run dev:broker:remote-trusted` defaults it to `$HOME/.switchboard/operator-token`, which matches the output location from `npm run operator-token:save`.
That default token-save path is the auto-hardened one. If you intentionally use `npm run operator-token:save -- --file /path/to/private/operator-token`, the token file still lands with `0600`, but the parent directory stays operator-managed and should already be private.
If that default `.switchboard` token directory later becomes group- or world-accessible, broker health surfaces `Parent directory for SWITCHBOARD_OPERATOR_TOKEN_FILE must not be accessible by group or others. Use chmod 700.` as a sanitized warning, and the operator plus preflight doctors fail closed until it is tightened again.
For reviewed file-backed rollout checks here as well, `smoke:preflight` and `smoke:doctor-contracts` now explicitly cover both the healthy strict typed and healthy mixed `1/2` OpenAI provider-sync plus raw and wrapped Codex paths on the remote-trusted shell, including nested `checkDetails.provider_sync` alignment for `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, richer raw `userAgent` / `accountType` / `plan` / `endpoint` fields, and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, so the higher-level human and JSON rollout surfaces stay aligned with the broker persistence checks.
Those higher-level human preflight provider sections now also preserve the direct provider doctor `message:` line plus nested readiness and sync detail such as readiness posture rows `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows `state`, `source`, `configured`, and `secure`, and live sync detail like `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth`, so remote rollout shells do not have to fall back to JSON just to see that context. Degraded-path rows like `syncBadges` and `rateLimitHosts` stay visible there when they actually carry data, and the degraded local allow-fallback plus remote strict-fail trusted-command branches now also explicitly pin the fuller degraded provider-sync shape there, including `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows instead of only the message plus host/auth hints. On healthy trusted-command paths, that nested human preflight provider-sync output also keeps the direct quota rows visible, including `accounts: 1`, `syncModes: app-server-rate-limits`, and typed quota detail like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`; the strict healthy raw and wrapped Codex sections now also keep the secondary `GPT-5.3-Codex-Spark` bucket/model visible with typed `2/2` coverage instead of leaving that fuller healthy shape pinned only to the direct doctor or JSON rollout surfaces. The higher-level JSON surface separately keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists.
The direct readiness smoke now also pins the malformed OpenAI trusted-command path itself, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:providers -- openai` output with `provider_command_invalid`, `state: command_invalid`, and the sanitized config message visible, while null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row stay suppressed.
The direct provider-sync smoke now also pins the malformed OpenAI trusted-command path itself, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:provider-sync -- openai` output with `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, and zero quota counters visible, while null `accounts`, `refreshedAt`, and a redundant `problem:` row stay suppressed.
Those higher-level human mixed `1/2` rollout checks now also explicitly pin the nested `Provider readiness (openai)` rows on the remote env-token and reviewed file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible beside the mixed provider-sync detail, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being proven only through JSON `checkDetails.provider_readiness`.
Those higher-level human healthy strict typed rollout checks now also explicitly pin the nested `Provider readiness (openai)` rows on the remote env-token and reviewed file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible on the ready strict rollout branches too, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being implied only by the message line or JSON `checkDetails.provider_readiness`.
Those higher-level degraded rollout checks now also explicitly pin the real degraded trusted-command sync mode too, so the local allow-fallback and remote strict-fail OpenAI branches keep `syncModes: app-server-account` alongside the fuller degraded provider-sync shape, instead of leaving the degraded live sync source implied by only host/auth and informational-only quota hints.
Those higher-level blocked malformed-command rollout checks now also explicitly pin the nested remote `Provider readiness (openai)` and `Provider sync (openai)` sections, so `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no` stay visible there too; blocked sync keeps `quotaCoverage: none` with zero quota counters, while null `accounts`, `lastModifiedAt`, `refreshedAt`, and redundant `problem:` rows stay suppressed instead of being implied only by the direct doctor or JSON summary.
The direct human Codex rollout surfaces now also preserve identity, freshness, wrapped `source:` rows, and healthy raw multi-bucket detail instead of collapsing back to only status text, so wrapped `doctor:codex` keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw `doctor:codex-app-server` keeps `user agent:` alongside account, plan, auth, degraded host or endpoint hints, and fully typed secondary buckets when the upstream app-server returns them.
The machine-readable preflight Codex rows now preserve that same direct identity and freshness detail too, so rollout automation can correlate raw and wrapped Codex runs without scraping text: `checkDetails.raw_codex_app_server` carries `userAgent`, `accountType`, `plan`, and `endpoint`, while `checkDetails.codex_wrapper` carries `account`, `refreshedAt`, `refreshedDisplay`, `plan`, and `credits`.
That lower-level `smoke:preflight-contract` path now also keeps the healthy OpenAI provider-sync contract aligned directly, so healthy `app-server rate-limits` rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths instead of relying on only the combined doctor stack to catch that drift. That same low-level path now also keeps the malformed OpenAI trusted-command contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays `command_invalid` in `checkDetails.provider_readiness` and `checkDetails.provider_sync`, preserving readiness wiring like `source`, `configured`, `secure`, and `validated`, plus blocked sync `quotaCoverage: none` with zero quota counters.
For the operator-visible broker summary surfaces too, the bind-free `smoke:dashboard`, `smoke:refresh`, and `smoke:refresh-snapshot` checks now explicitly cover degraded, mixed, and fully typed trusted-command OpenAI paths, so healthy fully typed refreshes keep the clean `app-server rate-limits available` wording without redundant quota-warning text or extra quota pills across the dashboard, adapter cards, and composed refresh responses. Healthy mixed trusted-command refresh and composed refresh-snapshot paths now also preserve `openaiAuth: ['required']` and the matching auth pill there instead of understating that bind-free path as auth-empty. The shared bind-free `subscription-sync` helper coverage now also matches that richer healthy path: when the account reports OpenAI auth is still required, the healthy fully typed trusted-command helper path keeps `openaiAuthRequired: true`, the matching `OpenAI auth required` pill, and grouped `openaiAuth: ['required']` state alongside the clean ready wording instead of implying that the fully typed path is auth-empty. The reviewed file-backed healthy mixed broker branches now also explicitly pin the clean trusted-command shape there with `syncBadges: []` and `rateLimitHosts: []` beside that auth signal, and keep grouped account context like `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned between refresh and dashboard provider summaries on both local and remote paths.

## Recommended controls

- rotate operator tokens intentionally and after any suspected exposure
- use `npm run operator-token:save -- --rotate` only for intentional replacement; the default save path now refuses silent overwrite and the rotate path re-applies owner-only permissions to the replacement file plus the default `.switchboard` token directory
- keep the operator token file outside git-backed directories and locked to owner-only permissions
- log and review who can reach the broker, even in homelab or lab environments
- keep `.switchboard/` ignored by git
- treat snapshot imports as sensitive operator data, even when sanitized
- prefer provider refresh over direct state replacement

## Not supported for production

Avoid these patterns:
- exposing the broker directly to the public internet
- storing OAuth tokens, cookies, or API keys in project profiles or persisted broker state
- enabling manual subscription replacement as a normal sync path
- widening bind addresses without a reviewed network boundary and token policy
