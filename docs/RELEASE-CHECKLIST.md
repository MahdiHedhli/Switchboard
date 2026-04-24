# Release Checklist

## Dependency review

- confirm package updates were intentional and lockfile changes are reviewed
- verify routine dependency upgrades satisfied the 30-60 day soak window, unless a reviewed security fix justified faster adoption
- run `npm audit` and document any accepted residual risk

## Broker security review

- confirm broker binds to loopback by default
- confirm non-local deployment still requires explicit remote enablement
- confirm an operator token is configured for any mutation-capable environment, preferably through `SWITCHBOARD_OPERATOR_TOKEN_FILE`
- for healthy local-only shells that use `SWITCHBOARD_OPERATOR_TOKEN_FILE`, confirm `doctor:operator` or `doctor:preflight` still stays `ready` and shows only basename-safe token metadata such as `operatorTokenSource: file` and `operatorTokenFile: operator-token`
- if using `npm run operator-token:save`, confirm the default `$HOME/.switchboard/operator-token` path or remote-trusted fallback is still the intended auto-hardened location
- if using that default `$HOME/.switchboard/operator-token` path, confirm the parent `.switchboard` directory is still owner-only; broker health now surfaces a sanitized `chmod 700` warning if it drifts back to group/world-readable, and the operator/preflight doctors fail closed until it is tightened again
- if using `npm run operator-token:save -- --file /path/to/private/operator-token`, confirm the custom parent directory is already private, because only the token file itself is forced to `0600`
- confirm direct subscription replacement is still disabled by default
- confirm `.switchboard/` remains ignored by git
- confirm quota snapshot files stay sanitized and use restrictive permissions
- confirm any `SWITCHBOARD_<PROVIDER>_REFRESH_COMMAND_JSON` values were reviewed and shell-free
- confirm trusted provider sync commands emit sanitized JSON only

## Verification

- run `npm run verify`
- if registry access or local broker port binds are intentionally unavailable, run `npm run verify:control-plane` and record why full `verify` or `smoke:broker` could not run in that environment; this constrained path covers adapter boundaries, auth-policy, Codex wrapper, operator readiness, planner, profile-loader, and state-store smoke verification after typecheck/build, and it now also syntax-checks the unrestricted `scripts/broker-smoke.mjs` source so broker HTTP smoke edits do not go entirely unverified
- run `npm run smoke:broker` and confirm it covers healthy fully typed, healthy mixed, and degraded authorized OpenAI refresh responses plus the persisted OpenAI `/dashboard`, raw `/state`, and on-disk `threatpedia.json` checks with `0600` state-file permissions for the healthy fully typed, healthy mixed, and degraded partial-app-server paths on the local and remote file-backed operator-token branches in addition to the live broker route contract
- confirm health output reports the expected auth policy for the target environment
- run `npm run doctor:operator -- local-only` or `npm run doctor:operator -- remote-trusted` for the intended release target
- run `npm run doctor:preflight -- <target> <allow-fallback|require-rate-limits>` for the intended release target and confirm the final `preflight summary` line matches the intended rollout posture
- for reviewed operator shells, also confirm the higher-level rollout smokes cover both the healthy strict typed and healthy mixed `1/2` paths: `npm run smoke:preflight` and `npm run smoke:doctor-contracts` should preserve `checkDetails.provider_sync` detail such as `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, plus the richer nested raw `userAgent` / `accountType` / `plan` / `endpoint` fields and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields on local env-token, local file-backed, and remote file-backed setups
- confirm the human `doctor:preflight` provider sections still preserve the direct provider doctor `message:` line plus nested readiness and sync detail such as readiness posture rows `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows `state`, `source`, `configured`, and `secure`, live sync detail like `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth`, and healthy trusted-command quota rows like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`, plus the strict healthy raw and wrapped Codex secondary `GPT-5.3-Codex-Spark` bucket/model rows with typed `2/2` coverage, not just the one-line summary
- confirm degraded-path rows like `syncBadges` and `rateLimitHosts` still appear when they actually carry data, but healthy typed and mixed trusted-command paths keep those empty rows suppressed instead of inventing placeholder human output
- confirm the higher-level JSON rollout surface also keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists
- run `node scripts/provider-readiness-smoke.mjs`, and confirm malformed `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` keeps direct OpenAI readiness fail-closed on both JSON and human `doctor:providers -- openai` output: `provider_command_invalid`, `state: command_invalid`, and the sanitized config message stay visible, while null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row stay suppressed
- run `node scripts/provider-sync-doctor-smoke.mjs`, and confirm malformed `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` keeps direct OpenAI provider-sync fail-closed on both JSON and human `doctor:provider-sync -- openai` output: `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, and zero quota counters stay visible, while null `accounts`, `refreshedAt`, and a redundant `problem:` row stay suppressed
- run `node scripts/preflight-doctor-smoke.mjs`, and confirm the blocked remote malformed-command `doctor:preflight` sections keep the nested OpenAI fail-closed rows visible too: `Provider readiness (openai)` and `Provider sync (openai)` should show `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no`, while blocked sync keeps `quotaCoverage: none` with zero quota counters and null `accounts`, `lastModifiedAt`, `refreshedAt`, plus redundant `problem:` rows stay suppressed
- confirm the degraded local allow-fallback and remote strict-fail `doctor:preflight` provider-sync sections keep the full degraded trusted-command shape visible too, not just the message and host/auth hints: they should show `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes: app-server-account`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows
- for the healthy mixed `1/2` rollout path specifically, confirm those human `doctor:preflight` provider sections also keep the nested `Provider readiness (openai)` rows visible on the local file-backed and remote env/file-backed setups, including `state`, `source`, `configured`, `secure`, and `validated`, while null `accounts` and `lastModifiedAt` rows stay suppressed, not just the one-line summary and JSON `checkDetails.provider_readiness`
- for the healthy strict typed rollout paths too, confirm those human `doctor:preflight` provider sections keep the nested `Provider readiness (openai)` rows visible on the local env-token, local file-backed, remote env-token, and remote file-backed setups, including `state`, `source`, `configured`, `secure`, and `validated`, while null `accounts` and `lastModifiedAt` rows stay suppressed, not just the one-line summary and JSON `checkDetails.provider_readiness`
- confirm the direct human Codex rollout surfaces still preserve identity, freshness, wrapped `source:` rows, and healthy raw multi-bucket detail instead of only status text, so wrapped `doctor:codex` keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw `doctor:codex-app-server` keeps `user agent:` alongside account, plan, auth, degraded host or endpoint hints, and fully typed secondary buckets when the upstream app-server returns them
- if rollout automation is consuming `doctor:preflight --json`, confirm `checkDetails.raw_codex_app_server` still preserves raw `userAgent`, `accountType`, `plan`, and `endpoint`, and `checkDetails.codex_wrapper` still preserves wrapped `account`, `refreshedAt`, `refreshedDisplay`, `plan`, and `credits`
- if rollout automation is consuming these checks, prefer the `--json` variants instead of scraping the human-readable doctor output
- this applies to `doctor:codex-app-server` and `doctor:codex` as well when rollout tooling needs the raw and wrapped Codex summaries directly
- run `npm run smoke:preflight-contract`, and confirm the low-level healthy OpenAI provider-sync rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths, and that malformed `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` keeps `checkDetails.provider_readiness` plus `checkDetails.provider_sync` at `command_invalid` with preserved readiness wiring (`source`, `configured`, `secure`, `validated`) and blocked sync `quotaCoverage: none` with zero quota counters
- run `npm run smoke:dashboard`, `npm run smoke:refresh`, and `npm run smoke:refresh-snapshot`, and confirm degraded, mixed, and fully typed trusted-command OpenAI cases stay aligned on the broker summary surfaces, including healthy `app-server rate-limits available` wording with no redundant quota-warning text or extra quota pills on the fully typed path, healthy mixed bind-free refresh and composed refresh-snapshot paths that keep `openaiAuth: ['required']` and the matching auth pill instead of an auth-empty shape, the shared bind-free `subscription-sync` helper path that keeps `openaiAuthRequired: true` plus grouped `openaiAuth: ['required']` state when the healthy fully typed account still reports OpenAI auth is required, and reviewed file-backed healthy mixed branches that keep `syncBadges: []`, `rateLimitHosts: []`, `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned beside that auth signal

## Deployment readiness

- confirm whether the release target is local-only or remote-trusted
- review [docs/DEPLOYMENT.md](DEPLOYMENT.md)
- review [docs/OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md)
- verify rollback plan for the broker process, lockfile, and state snapshot inputs
- capture any unresolved security gaps before rollout

## Post-release follow-through

- monitor for auth-policy drift or unexpected route exposure
- review quota refresh behavior against sanitized snapshot inputs
- record any manual recovery steps that were needed so they can be reduced in the next slice
