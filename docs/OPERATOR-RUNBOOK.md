# Operator Runbook

## Purpose

Use this runbook to dry-run the two intended Switchboard deployment modes before opening the UI or exposing the broker to real work.

The runbook is designed to work even in restricted environments where registry access or local broker port binds are unavailable.

## Local-only operator mode

Recommended environment:

```bash
npm run operator-token:save
export SWITCHBOARD_OPERATOR_TOKEN_FILE="$HOME/.switchboard/operator-token"
export SWITCHBOARD_BROKER_HOST=127.0.0.1
export SWITCHBOARD_BROKER_PORT=7007
```

Re-running `npm run operator-token:save` against that same file fails closed unless you add `-- --rotate`, so a normal setup refresh does not silently replace an existing operator token. The intentional rotate path also re-applies owner-only permissions to the replacement token file and the default `.switchboard` token directory.
If you use `npm run operator-token:save -- --file /private/path/operator-token`, the token file is still forced to `0600`, but the parent directory is not rewritten for you. Point custom targets at a directory you already control.

Readiness checks:

```bash
npm run doctor:preflight -- local-only allow-fallback
npm run doctor:operator -- local-only
npm run verify:control-plane
```

`doctor:preflight -- local-only ...` now mirrors the same default OpenAI launch behavior as `npm run dev:broker`: if no explicit OpenAI adapter env is set and no `openai.json` snapshot exists, it evaluates the reviewed repo-owned OpenAI/Codex bridge instead of treating local-only as snapshot-missing by default.

`doctor:providers -- openai` and `doctor:provider-sync -- openai` now follow that same local-only default too, so standalone provider diagnostics stay aligned with the reviewed loopback broker launch instead of reporting false snapshot-missing drift.
When that inferred local OpenAI bridge is healthy, the direct doctor messages also stay concrete instead of generic: `doctor:providers -- openai` reports `trusted_command_ready (unvalidated)`, and `doctor:provider-sync -- openai` reports `app-server rate-limits available` when the bridge returned fully typed quota windows.
`doctor:preflight -- local-only --allow-fallback` can still show the same inferred local bridge as healthy at the readiness layer while the live sync layer is degraded upstream. In practice that means it is valid to see `provider readiness=trusted_command_ready (unvalidated)` alongside `provider sync=partial app-server context ... [quota informational_only, typed 0/1]` when the command wiring is correct but OpenAI/Codex rate-limit windows are still unavailable through `chatgpt.com`.

If local port binds are available, continue with:

```bash
npm run smoke:broker
npm run dev:broker
```

`npm run smoke:broker` now exercises the live broker route contract plus healthy fully typed, healthy mixed, and degraded authorized OpenAI refresh responses, and it also follows those OpenAI paths through persisted `/dashboard`, raw `/state`, and the on-disk `threatpedia.json` state file. That includes the healthy fully typed, healthy mixed, and degraded partial-app-server paths on both the local and remote file-backed operator-token branches, and those persistence checks also confirm the saved state file stays owner-only at `0600`. That makes it the unrestricted check that proves the real HTTP broker keeps the same `chatgpt.com`, `OpenAI auth required`, and quota-quality detail already covered by the bind-free refresh, dashboard, and state smokes.
At the higher-level rollout layer, `npm run smoke:preflight` and `npm run smoke:doctor-contracts` now also explicitly cover that healthy mixed `1/2` OpenAI/Codex detail on both local-only and remote-trusted `SWITCHBOARD_OPERATOR_TOKEN_FILE` shells, including the richer nested raw `userAgent` / `accountType` / `plan` / `endpoint` fields and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, so the human and JSON preflight surfaces are checked too instead of only the persisted broker state.

`npm run dev:broker`, `npm --workspace @switchboard/broker run dev`, and `cd apps/broker && npm run dev` now all use the same reviewed local launcher. It auto-wires the repo-owned OpenAI/Codex refresh bridge for local loopback runs when both of these are true:
- `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` is not already set
- `.switchboard/provider-snapshots/openai.json` does not exist

That keeps the local HTTP path from silently falling back to a missing `openai.json` snapshot after a restart when you intended to keep using the reviewed trusted-command adapter.
When that fallback is inferred, the launcher prints one sanitized notice instead of echoing the local command path it selected.

The broker `/healthz` payload and the Operator session now also surface the broker token source (`env`, `file`, `direct`, or `unset`) with a basename-only token-file label when available, so you can distinguish broker-shell token wiring from the browser-only UI token cache without dropping straight to the doctors.
They also surface sanitized token-file wiring problems like insecure permissions or an insecure default `.switchboard` token directory, so a broken `SWITCHBOARD_OPERATOR_TOKEN_FILE` no longer looks like a silent `operatorTokenConfigured=false`.

Expected outcome:
- mutation routes are token-gated
- direct subscription replacement stays disabled by default
- provider refresh remains the preferred path
- `.switchboard/` stays private and git-ignored
- operator token material stays in a private file instead of shell history

Important:
- the UI can cache the operator token in the browser for local mutation flows, but shell-based `doctor:*` and `doctor:preflight` checks do not read that browser cache
- if a local shell preflight or operator doctor still reports `operatorTokenConfigured=false`, export `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` in that shell before rerunning it
- if a local-only shell instead says `Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.`, that is the same fail-closed operator posture spelled out directly: `operatorTokenSource` will be `unset`, `operatorTokenConfigured` stays `no` / `false`, and mutation scopes remain `open` until a shell token env or token file is configured

Optional local HTTPS:

```bash
mkcert localhost 127.0.0.1 ::1
export SWITCHBOARD_TLS_CERT_FILE="$PWD/localhost+2.pem"
export SWITCHBOARD_TLS_KEY_FILE="$PWD/localhost+2-key.pem"
export SWITCHBOARD_BROKER_URL="https://127.0.0.1:7007"
```

When those TLS env vars are set, `npm run dev:broker` serves HTTPS on loopback and the Vite proxy should follow the matching `SWITCHBOARD_BROKER_URL`.

Optional reviewed local recovery:

```bash
export SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1
```

Only use that flag for operator-reviewed repair work. Do not leave it enabled as a normal sync path.

## Remote-trusted operator mode

Remote-trusted exposure is exceptional and should stay behind a reviewed network boundary.

Recommended environment:

```bash
npm run operator-token:save
export SWITCHBOARD_OPERATOR_TOKEN_FILE="$HOME/.switchboard/operator-token"
export SWITCHBOARD_BROKER_HOST=0.0.0.0
export SWITCHBOARD_BROKER_PORT=7007
export SWITCHBOARD_ALLOW_REMOTE=1
export SWITCHBOARD_TLS_CERT_FILE="/etc/letsencrypt/live/switchboard/fullchain.pem"
export SWITCHBOARD_TLS_KEY_FILE="/etc/letsencrypt/live/switchboard/privkey.pem"
```

Readiness checks:

```bash
npm run doctor:preflight -- remote-trusted allow-fallback
npm run doctor:operator -- remote-trusted
npm run verify:control-plane
```

If the environment allows local binds and ingress validation:

```bash
npm run smoke:broker
npm run dev:broker:remote-trusted
```

The same unrestricted `npm run smoke:broker` check now also proves the reviewed broker HTTP path preserves healthy fully typed, healthy mixed, and degraded authorized OpenAI refresh responses before you rely on remote-trusted ingress.

Expected outcome:
- all mutation-capable routes require `X-Switchboard-Operator-Token`
- direct subscription replacement remains disabled unless explicitly enabled for reviewed recovery
- broker serves HTTPS directly with the reviewed certificate material you configured
- provider wrappers and sanitized snapshot files stay on private storage only

Notes:
- Let’s Encrypt paths are the recommended remote-trusted default when the broker is behind a reviewed public or internal DNS name.
- `SWITCHBOARD_OPERATOR_TOKEN` still works, but `SWITCHBOARD_OPERATOR_TOKEN_FILE` is the preferred path so the secret does not live in shell history or long-lived environment dumps.
- if `SWITCHBOARD_OPERATOR_TOKEN_FILE` is unset, `npm run dev:broker:remote-trusted` defaults it to `$HOME/.switchboard/operator-token`, which matches the output location from `npm run operator-token:save`
- re-running `npm run operator-token:save` against that default file also fails closed unless you pass `npm run operator-token:save -- --rotate`, so remote-trusted startup does not depend on silent token replacement
- if that default `.switchboard` token directory becomes group- or world-accessible later, the broker-side operator doctor now fails closed too until it is tightened back to `0700`
- Remote-trusted mode now fails closed unless both `SWITCHBOARD_TLS_CERT_FILE` and `SWITCHBOARD_TLS_KEY_FILE` are present and readable.

## Codex-first provider refresh

For the current OpenAI/Codex supervisor path:

```bash
export SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON='["node","/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs"]'
```

Optional local Codex path override:

```bash
export CODEX_CLI_PATH="/Applications/Codex.app/Contents/Resources/codex"
```

Validation:

```bash
npm run doctor:providers -- openai
npm run doctor:provider-sync -- openai
npm run doctor:codex-app-server -- allow-degraded
npm run doctor:codex -- allow-fallback
npm run doctor:preflight -- local-only allow-fallback
npm run sync:codex
npm run smoke:codex
npm run smoke:codex-app-server
npm run smoke:codex-doctor
```

If live rate-limit windows are unavailable in the current launch context, the wrapper should still surface a sanitized source/rate-limit signal instead of pretending the richer path succeeded.

`doctor:providers` validates provider wiring without opening local ports or executing provider sync commands:
- trusted-command providers report whether the JSON argv wiring is valid
- snapshot-backed providers report missing, insecure, invalid, or ready sanitized snapshot state
- add `--json` when external tooling needs a machine-readable readiness summary
- the JSON summary also exposes a top-level `message`, stable failure/advisory codes, blocked/attention/ready provider lists, and per-provider `providerStates`, `providerCodes`, and `providerMessages`
- trusted-command providers remain `unvalidated` in this doctor by design; use broker refresh, `sync:codex`, or the focused wrapper smokes when you need proof of actual command execution
- if `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` is malformed, both `doctor:providers` and `doctor:provider-sync` now fail closed with the same sanitized config message, and preflight preserves both blocked lines instead of leaving provider sync looking healthy
- direct `smoke:provider-readiness` now also pins that malformed OpenAI trusted-command branch on both JSON and human `doctor:providers -- openai` output, including `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, and suppression of null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row when `message:` already carries the sanitized config error
- direct `smoke:provider-sync` now also pins that malformed OpenAI trusted-command branch on both JSON and human `doctor:provider-sync -- openai` output, including `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, zero quota counters, and suppression of null `accounts`, null `refreshedAt`, and a redundant `problem:` row when `message:` already carries the sanitized config error

The broker `/adapters` route now follows the same intent more explicitly by returning a broker-classified adapter `status`, so the quota-refresh cards can show `ready with advisories` for config-only trusted-command wiring instead of inferring that state from raw booleans. Once a live provider refresh has run, those same cards also reuse broker-composed `providerSummaries` for the last-sync line, host/auth pills, and quota-coverage note, so a degraded OpenAI/Codex refresh can stay explicit there with detail such as `host: chatgpt.com`, `OpenAI auth required`, and `typed quota models: 0/1`, a healthy partially typed refresh can stay concrete as `quota mixed` with typed `1/2`, and a healthy fully typed trusted-command refresh can keep the clean `app-server rate-limits available` wording without redundant quota-warning text or extra quota pills instead of collapsing back to a generic warning. Healthy mixed trusted-command refresh and composed refresh-snapshot paths now also keep `openaiAuth: ['required']` and the matching auth pill there instead of understating that path as auth-empty. The shared bind-free subscription-sync helper coverage now matches that richer healthy path too: when the account reports OpenAI auth is still required, the healthy fully typed trusted-command helper path keeps `openaiAuthRequired: true`, the matching `OpenAI auth required` pill, and grouped `openaiAuth: ['required']` state alongside the clean ready wording instead of implying that the fully typed path is auth-empty. The reviewed file-backed healthy mixed broker branches now also explicitly pin the clean trusted-command shape there too, keeping `syncBadges: []` and `rateLimitHosts: []` beside `openaiAuth: ['required']` instead of only proving the degraded host-bearing case, and keeping grouped account context like `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned between refresh and dashboard provider summaries on both local and remote paths.

`doctor:provider-sync` executes the selected provider refresh path once and validates the sanitized output it returns:
- trusted-command providers actually run the reviewed local wrapper configured in `SWITCHBOARD_<PROVIDER>_REFRESH_COMMAND_JSON`
- snapshot-backed providers reload and validate the current sanitized snapshot through the same adapter path the broker uses
- add `--json` when automation needs a machine-readable live refresh summary
- the JSON summary also exposes a top-level `message` plus blocked/attention/ready provider lists and per-provider `providerStates`, `providerCodes`, `providerMessages`, `providerSyncModes`, `providerSyncBadges`, `providerRateLimitHosts`, and `providerOpenaiAuth`
- that top-level `message` now also preserves provider quota-quality detail for informational-only and mixed live refreshes, so direct machine-readable or human `doctor:provider-sync` runs can surface strings like `... [quota informational_only, typed 0/1]` or `... [quota mixed, typed 1/2]` without rejoining the separate coverage fields
- the human `doctor:provider-sync` output now also prints that same top-level `message:` line before the provider rows, so snapshot-backed, degraded, and partially typed live refresh states stay readable without switching to JSON
- preflight now also carries that richer provider-sync text through `checkDetails.provider_sync.message`, so the preferred-provider detail keeps the same quota note as the direct doctor
- successful-but-degraded OpenAI/Codex refreshes return `attention_required` instead of `ready`, so command execution is not confused with healthy live rate-limit access

`doctor:preflight` now prints five separate steps:
- `operator` for broker-policy readiness
- `provider-readiness` for broker-side OpenAI provider wiring and sanitized snapshot state
- `provider-sync` for one live broker-side OpenAI refresh using the configured adapter path
- provider-sync JSON now also includes per-provider quota coverage (`typed`, `mixed`, `informational_only`, or `none`) plus typed/total quota-model counts, and preflight carries the preferred-provider version of that detail in `checkDetails.provider_sync`
- `codex-app-server` for the raw upstream Codex path
- `codex` for the sanitized wrapper path that Switchboard actually consumes

It also prints a final `preflight summary` line:
- `ready` or `ready for strict rollout` when both raw and wrapped Codex rate-limit paths are healthy, preserving lines like `raw Codex status=available` and `wrapper status=full rate-limits available`
- `degraded but acceptable` when fallback is allowed and the wrapper can still operate safely
- `blocked` when the requested rollout posture is stricter than the current shell can satisfy

The human-readable provider sections now also preserve the same per-provider advisory detail that the nested doctor payloads carry, so lines like `trusted_command_ready (unvalidated)`, `snapshot-backed refresh (advisory)`, or the full degraded Codex/OpenAI badge text stay visible without switching to JSON. The human `doctor:preflight` provider sections now also print the direct provider doctor `message:` line before the per-provider rows, and the human `doctor:provider-sync` plus `doctor:preflight` provider-sync sections now also print provider `quotaCoverage` plus typed/total quota-model counts, preserve direct usage-signal rows like `openaiAuth`, and keep degraded-path rows like `rateLimitHosts` visible when they actually carry data, so the terminal view makes it clear when a live refresh only has informational fallback metadata, is still running from a snapshot, or has confirmed app-server-backed rate limits for all or only some models. Those nested preflight provider sections now also mirror the direct provider doctors more fully, preserving readiness posture rows like `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows like `state`, `source`, `configured`, and `secure`, and live sync detail such as `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth` instead of collapsing that context back into only the summary line. Degraded-path rows like `syncBadges` and `rateLimitHosts` stay visible there when they actually carry data, and the degraded local allow-fallback plus remote strict-fail trusted-command branches now also explicitly pin the fuller degraded provider-sync shape there, including `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows instead of only the message plus host/auth hints. On healthy trusted-command paths, that nested human preflight provider-sync output also keeps the direct quota rows visible, including `accounts: 1`, `syncModes: app-server-rate-limits`, and typed quota detail like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`; the strict healthy raw and wrapped Codex sections now also keep the secondary `GPT-5.3-Codex-Spark` bucket/model visible with typed `2/2` coverage instead of leaving that fuller healthy shape pinned only to the direct doctor or JSON rollout surfaces. The higher-level JSON surface separately keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists. The one-line preflight summary now preserves degraded provider-sync message plus quota-quality detail when a live refresh is only `informational_only`, preserves the actual advisory message when a ready sync is still snapshot-backed, and preserves both fully typed and partially typed healthy live refresh detail such as `provider sync=app-server rate-limits available [quota mixed, typed 1/2]`.
That higher-level preflight coverage now explicitly includes the healthy strict typed paths too: local env-token shells, local file-backed operator-token shells, and remote file-backed operator-token shells now all keep `checkDetails.provider_sync` aligned with the top-level preferred-provider summary for `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, not just the mixed or degraded branches.
That lower-level `smoke:preflight-contract` path now also keeps the healthy OpenAI provider-sync contract aligned directly, so healthy `app-server rate-limits` rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths instead of relying on only the combined doctor stack to catch that drift. That same low-level path now also keeps the malformed OpenAI trusted-command contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays `command_invalid` in `checkDetails.provider_readiness` and `checkDetails.provider_sync`, preserving readiness wiring like `source`, `configured`, `secure`, and `validated`, plus blocked sync `quotaCoverage: none` with zero quota counters.
That higher-level preflight coverage now explicitly includes the healthy mixed `1/2` path on both local-only and remote-trusted `SWITCHBOARD_OPERATOR_TOKEN_FILE` shells, so reviewed file-backed operator rollout keeps the same mixed provider-sync plus raw and wrapped Codex detail in both the human and JSON preflight views.
That higher-level human mixed `1/2` preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local file-backed and remote env/file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible beside mixed provider-sync detail, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being proven only through JSON `checkDetails.provider_readiness`.
That higher-level human healthy strict typed preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local env-token, local file-backed, remote env-token, and remote file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible on the ready strict rollout branches too, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being implied only by the message line or JSON `checkDetails.provider_readiness`.
That higher-level degraded preflight coverage now also explicitly pins the real degraded trusted-command sync mode too, so the local allow-fallback and remote strict-fail OpenAI branches keep `syncModes: app-server-account` alongside the fuller degraded provider-sync shape, instead of leaving the degraded live sync source implied by only host/auth and informational-only quota hints.
That higher-level blocked malformed-command preflight coverage now also explicitly pins the nested remote `Provider readiness (openai)` and `Provider sync (openai)` sections, so `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no` stay visible there too; blocked sync keeps `quotaCoverage: none` with zero quota counters, while null `accounts`, `lastModifiedAt`, `refreshedAt`, and redundant `problem:` rows stay suppressed instead of being implied only by the direct doctor or JSON summary.
Preflight JSON now also preserves the richer direct raw and wrapped Codex `message` fields in the top-level `checkMessages` map, so automation can see notes like `Codex app-server could not start.`, `usage endpoint unavailable via chatgpt.com [rate-limits none]`, or `full rate-limits available [quota mixed, typed 1/2]` without unpacking `checkDetails`.
Those human `doctor:preflight` Codex sections now also preserve the same identity, freshness, and wrapped `source:` rows as the direct doctors, so wrapped preflight output keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw preflight output keeps `user agent:` alongside account, plan, auth, and degraded host or endpoint hints.
The preflight JSON contract now also preserves the same typed-vs-total count detail for direct raw and wrapped Codex status in `checkDetails.raw_codex_app_server` and `checkDetails.codex_wrapper`, so rollout tooling does not have to infer that from coverage labels alone. Those machine-readable Codex entries now also preserve the direct raw and wrapped identity rows too: raw `userAgent`, `accountType`, `plan`, and `endpoint`, plus wrapped `account`, `refreshedAt`, `refreshedDisplay`, `plan`, and `credits`.

The human `operator` sections in both `doctor:operator` and `doctor:preflight` now also print the direct operator `message:` line before the detail rows, preserve `operatorTokenSource`, the token-file basename when available, and any sanitized `operatorTokenProblem`, so shell-side token wiring issues are easier to distinguish from the browser-only UI token cache. Healthy local-only shells keep that basename-safe token-file detail visible too: if you use `SWITCHBOARD_OPERATOR_TOKEN_FILE`, the direct and preflight operator surfaces still stay `ready`, preserve `operatorTokenSource: file`, show `operatorTokenFile: operator-token`, and keep the same `local-only; host=127.0.0.1` summary text as the env-token baseline. If both `SWITCHBOARD_OPERATOR_TOKEN` and `SWITCHBOARD_OPERATOR_TOKEN_FILE` are set, that conflict now surfaces as a fail-closed operator posture too: `operatorTokenSource` still shows where the conflict came from, but `operatorTokenConfigured` drops to `no` and the mutation scopes fall back to `open` until the conflict is resolved. Local-only shells with no exported operator token now surface the same fail-closed posture just as explicitly: the operator `message:` becomes `Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.`, `operatorTokenSource` reports `unset`, and mutation scopes stay `open` until `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` is configured in that shell. The one-line preflight summary now also preserves healthy operator posture such as `operator=local-only, host=127.0.0.1` or `operator=remote-trusted, host=0.0.0.0`, plus readable provider-readiness detail such as `trusted_command_ready (unvalidated)` instead of flattening that state back to a generic advisory label.

For automation or external tooling, both `doctor:operator` and `doctor:preflight` now support `--json`:

```bash
npm run doctor:operator -- local-only --json
npm run doctor:preflight -- remote-trusted require-rate-limits --json
```

Those JSON paths keep the same rollout logic but avoid scraping human-readable output.

The preflight JSON summary now also includes:
- direct nested `providerReadiness` and `providerSync` results for `openai`
- top-level `readyChecks`, `attentionChecks`, and `blockedChecks` arrays
- top-level `checkStates`, `checkCodes`, and `checkMessages` maps keyed by subsystem, plus structured `checkDetails` for the selected provider/Codex state behind each top-level check
- `doctor:operator --json` now mirrors that pattern more closely too, with stable `verdict`, `failureCodes`, `message`, and `problems` fields alongside host/token/scope posture so operator misconfiguration can be consumed directly before preflight

That lets rollout tooling confirm broker-side OpenAI refresh wiring, one live adapter refresh, and the exact degraded or blocked subsystem without parsing the nested doctor payloads by hand.

The human `doctor:providers` output now also prints that same top-level `message:` line before the per-provider rows, so trusted-command-ready, snapshot-missing, and blocked snapshot/config states stay visible without switching to JSON.

The Codex-specific doctors support the same pattern:

```bash
npm run doctor:codex-app-server -- allow-degraded --json
npm run doctor:codex -- allow-fallback --json
```

Use those when rollout tooling or external scripts need the raw app-server and wrapped Codex summaries directly. The raw `doctor:codex-app-server --json` path now includes structured `rateLimitDetails`, and the wrapped `doctor:codex --json` path now includes structured `quotaDetails`, so the same 5-hour and weekly usage windows available to the UI can be consumed without parsing the formatted strings. Those direct top-level `message` fields now also preserve rate-limit or quota quality for degraded, mixed, and fully typed healthy states, so direct runs can surface strings like `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, `partial app-server context (...) [quota informational_only, typed 0/1]`, or `full rate-limits available [quota mixed, typed 1/2]` without reconstructing those notes from separate coverage fields.
The human `doctor:codex-app-server` and `doctor:codex` outputs now also print that same top-level `message:` line before their detail rows, so healthy, degraded, and blocked direct Codex states stay readable without switching to JSON.
Those human direct Codex outputs now also preserve the surrounding identity and freshness rows instead of collapsing back to only status text: wrapped `doctor:codex` keeps `account:` plus `refreshed:`, and raw `doctor:codex-app-server` keeps `user agent:` alongside `account type:`, `plan:`, `openai auth:`, and degraded host or endpoint hints.
The human `doctor:codex-app-server`, `doctor:codex`, and `doctor:preflight` Codex sections now also render those same raw bucket and wrapped quota details as explicit window rows, so operators can read live `5-hour window` and `Weekly window` usage directly from the terminal without dropping to `--json`. On healthy raw app-server paths, that now includes fully typed secondary buckets when the upstream app-server returns them, instead of documenting only the mixed `1/2` fallback shape.

In `allow-fallback` mode, raw app-server unavailability is still surfaced, but it is treated as advisory when the wrapper can fall back cleanly. Use `require-rate-limits` when the rollout must fail closed unless live Codex rate-limit windows are available.

If a workstation or release candidate specifically requires full app-server rate-limit windows, use:

```bash
npm run doctor:codex -- require-rate-limits
```

That command should fail fast when the shell only has partial account context or the login-status fallback.

If you need to confirm whether the upstream Codex app-server itself is degrading before wrapper fallback is involved, use:

```bash
npm run doctor:codex-app-server -- require-rate-limits
```

That path talks directly to `codex app-server --listen stdio://` and should fail when `account/rateLimits/read` is unavailable even if `account/read` still succeeds.

## Restricted environments

When registry access is blocked or local port binds fail:
- use `npm run verify:control-plane` as the bind-free baseline
- `npm run verify:control-plane` now also syntax-checks `scripts/broker-smoke.mjs`, so unrestricted broker-smoke edits still get a constrained verification pass even when the real HTTP broker smoke cannot run
- run `npm run smoke:broker-parse` when you want that broker-smoke syntax check by itself without waiting for the rest of the constrained baseline
- record why `npm run verify` or `npm run smoke:broker` could not run
- do not widen broker exposure just to make smoke coverage pass
