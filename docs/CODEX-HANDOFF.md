# Codex Handoff

## Current state

The repository now includes:
- Apache-2.0 license and NOTICE file
- workspace root config with exact-version package policy
- shared core types in packages/core with task timestamps and partial update support
- a localhost-only broker surface in apps/broker with health, profile, state, dashboard, task detail, task creation, and task patch routes
- a provider adapter registry for OpenAI, Anthropic, and Google
- snapshot-backed quota refresh from `.switchboard/provider-snapshots/*.json`
- trusted-command provider refresh via `SWITCHBOARD_<PROVIDER>_REFRESH_COMMAND_JSON` when a reviewed local wrapper can emit sanitized JSON
- a repo-owned OpenAI/Codex supervisor sync command in `scripts/provider-sync/openai-codex-sync.mjs`
- a live Codex doctor command in `scripts/codex-doctor.mjs` for current-shell path diagnostics
- a direct Codex app-server doctor in `scripts/codex-app-server-doctor.mjs` for raw upstream diagnostics before wrapper fallback
- a combined preflight doctor in `scripts/preflight-doctor.mjs` for rollout-time operator readiness plus raw and wrapped Codex checks
- the Codex wrapper now prefers local app-server `account/read` and `account/rateLimits/read` responses before falling back to `codex login status`
- source, plan, and credit metadata are now surfaced as structured account signals instead of quota-row notes
- percentage-window quota data is visible to operators but treated as advisory planning data, not raw spendable credits
- degraded Codex sync paths now surface through dashboard warnings when only partial account context or login fallback is available
- broker dashboard snapshots now carry grouped `providerSummaries`, so the UI can consume provider sync, account sync method, and account context from broker-composed state instead of rebuilding it from raw subscription rows
- validated project profile loading from profiles/ with strict unknown-key and empty-section rejection
- a private local state store under `.switchboard/state/` for tasks and sanitized quota snapshots
- a first broker-fed UI path in apps/switchboard-ui with task intake and lifecycle controls
- task-level approval metadata with planner gating for queued and planned execution
- task approval history with request, approval, and reset-to-pending events persisted in local state
- scoped broker auth policy surfaced through `/healthz` and the UI
- broker health now also preserves transport posture, so the Operator session can confirm HTTP vs HTTPS instead of treating auth policy as the whole remote-trusted picture
- token-gated mutation routes when `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` is configured
- token-file loading through `SWITCHBOARD_OPERATOR_TOKEN_FILE`, with owner-only permissions preferred over raw shell-exported tokens
- direct HTTPS broker startup when `SWITCHBOARD_TLS_CERT_FILE` and `SWITCHBOARD_TLS_KEY_FILE` are configured
- direct subscription replacement disabled by default unless explicitly re-enabled for reviewed local recovery
- a Threatpedia project profile in profiles/threatpedia.json
- a broker smoke test in `scripts/broker-smoke.mjs`
- a bind-free Codex wrapper smoke test in `scripts/codex-wrapper-smoke.mjs`
- a bind-free Codex doctor smoke test in `scripts/codex-doctor-smoke.mjs`
- a bind-free dashboard composition smoke test in `scripts/dashboard-smoke.mjs`
- a bind-free broker health composition smoke test in `scripts/health-smoke.mjs`
- a bind-free broker runtime-config smoke test in `scripts/runtime-config-smoke.mjs`
- a bind-free broker refresh composition smoke test in `scripts/refresh-smoke.mjs`
- a bind-free Codex app-server diagnostics smoke test in `scripts/codex-app-server-diagnostics-smoke.mjs`
- a bind-free Codex app-server doctor smoke test in `scripts/codex-app-server-doctor-smoke.mjs`
- a bind-free preflight doctor smoke test in `scripts/preflight-doctor-smoke.mjs`
- a bind-free planner smoke test in `scripts/planner-smoke.mjs`
- a profile-loader fixture corpus plus bind-free smoke test in `fixtures/profile-loader/` and `scripts/profile-loader-smoke.mjs`
- a bind-free subscription-sync smoke test in `scripts/subscription-sync-smoke.mjs`
- a bind-free auth-policy matrix smoke test in `scripts/auth-policy-smoke.mjs`
- a bind-free operator readiness smoke test in `scripts/operator-readiness-smoke.mjs`
- a bind-free state-store smoke test in `scripts/state-store-smoke.mjs`
- a bind-free adapter boundary smoke test in `scripts/adapter-boundary-smoke.mjs`
- a constrained-environment `verify:control-plane` path for typecheck/build plus bind-free smoke coverage, including a syntax check for the unrestricted `scripts/broker-smoke.mjs` source when local binds are unavailable
- an operator runbook in `docs/OPERATOR-RUNBOOK.md` for local-only and remote-trusted dry runs
- architecture notes in docs/ARCHITECTURE.md

Fresh-install baseline verified on April 21, 2026:
- direct toolchain versions are pinned instead of using floating `latest`
- broker and core emit runnable ESM build output instead of relying on raw source execution
- root `typecheck`, `build`, and `audit` are the baseline repo health checks
- UI toolchain should stay on the audited Vite `6.4.2` line or another explicitly reviewed security fix before running the dev server

## Product intent

Switchboard is a reusable local control plane for supervised multi-agent workflows.

Codex should act as Kernel Proxy under human supervision, not as the final trust anchor.

## Immediate next steps

1. Keep dependency versions pinned and commit lockfile updates intentionally.
2. Let routine dependency upgrades sit through a 30-60 day validation window before adoption unless an explicit security fix needs faster action.
3. Verify Codex app-server availability across desktop, CLI, and non-interactive launch contexts, while keeping the current typed account-only fallback and the safer `codex login status` fallback for earlier app-server failures.
4. Extend provider-specific wrapper integrations on top of the trusted-command adapter path without persisting raw credentials or exports.
5. Build approval and review workflows on top of the current scoped auth policy instead of widening raw mutation access.
6. Dry-run the release checklist and deployment guidance against the first intended operator environments.
7. Expand the current task-level approval groundwork into richer review actions and stronger operator identity later.
8. Dry-run the documented auth policy, operator runbook, and release checklist against the first intended local-only and remote-trusted operator environments.
9. Keep the local-only default on loopback, and use the dedicated `npm run dev:broker:remote-trusted` path only with reviewed TLS material and a private operator-token file. When `SWITCHBOARD_OPERATOR_TOKEN_FILE` is unset, that launcher falls back to `$HOME/.switchboard/operator-token`, which matches `npm run operator-token:save`. That default path is the auto-hardened one: `operator-token:save` re-applies owner-only permissions to the token file and the default `.switchboard` token directory, while custom `--file` targets still expect the parent directory to be operator-managed. If that default `.switchboard` directory later drifts back to group- or world-accessible, broker health surfaces the sanitized `chmod 700` warning and the operator plus preflight doctors fail closed until it is tightened again.

## Credit and subscription requirement

This stays in scope:
- the system needs to track available model choices across subscription-backed accounts
- remaining usage or credits should be visible to operators, including distinct 5-hour and weekly Codex windows when the provider exposes them
- planning should consider remaining capacity before assignment
- tasks should support reservations or estimated consumption before execution starts
- MVP may use manual quota snapshots, but the architecture should support provider-backed sync later

## Threatpedia direction

Threatpedia should be adapted after the reusable scaffold is stable.

Key assumptions:
- public repo is publish target
- private repo is working substrate
- human remains trust anchor
- Codex routes and prepares work
- Claude and Gemini act as specialist workers and reviewers

## Guardrails

- do not remove quota-awareness from the core model
- do not collapse the UI into a passive dashboard only
- do not hard-code Threatpedia assumptions into the reusable core
- keep project-specific behavior in profiles or adapters
- keep direct dependencies pinned and update them on a deliberate review cadence, not on autopilot
- do not commit OAuth tokens, provider session material, raw quota exports, or other secrets
- current auth direction is subscription-backed access via provider OAuth or trusted installed client wrappers, not direct API keys
- if API-key support is ever introduced later, require explicit approval and local secret storage outside git-backed configs
- store only sanitized quota snapshots, opaque account identifiers, or local references in profiles and persistence
- trusted command adapters must emit sanitized JSON only and must not print raw credential material to stdout
- the current Codex supervisor wrapper uses `codex login status` and `codex --version`, not raw `~/.codex/auth.json` parsing
- the current Codex supervisor wrapper may also use local app-server `account/rateLimits/read`, which exposes plan type, credits metadata, and normalized budget windows without exposing tokens
- if `account/read` succeeds but `account/rateLimits/read` fails, preserve the typed account context and expose sanitized rate-limit availability instead of dropping immediately to login status
- when the app-server rate-limit path is unavailable, the wrapper should make that visible through structured source and rate-limit signals rather than silently pretending the typed snapshot succeeded
- when the app-server exposes a concrete failing usage endpoint, preserve at least a sanitized host hint in wrapper signals so operator warnings can point at the upstream surface without leaking secrets
- rollout preflight should surface raw app-server unavailability separately from wrapper fallback so operators can see whether degradation is upstream or only in the richer Codex path
- rollout preflight should also emit a one-line verdict so operators can distinguish `ready`, `degraded but acceptable`, and `blocked` shells without rereading each sub-check
- rollout preflight now consumes machine-readable Codex doctor summaries instead of scraping human text, so future doctor copy changes are less likely to break rollout classification
- operator readiness and preflight now both support `--json` output for automation and external rollout tooling
- `doctor:operator --json` now also carries stable `verdict`, `failureCodes`, `advisoryCodes`, `message`, and `problems` fields on top of the operator auth posture booleans and scope requirements
- blocked `doctor:operator` runs now exit cleanly from that structured summary instead of dumping a Node assertion stack trace
- the raw and wrapped Codex doctors also support `--json` output so rollout tooling can consume those surfaces directly without scraping terminal text
- the bind-free Codex wrapper smoke now also covers the healthy partially typed app-server path directly, so one typed quota plus one informational quota stays verified below the doctor and rollout layers instead of only through higher-level composition tests
- those direct raw and wrapped Codex doctor JSON outputs now also carry stable `verdict`, `failureCodes`, `advisoryCodes`, and `message` fields on top of the existing state/status data, and those top-level `message` fields now preserve rate-limit or quota quality for degraded, mixed, and fully typed healthy states such as `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, `partial app-server context (...) [quota informational_only, typed 0/1]`, or `full rate-limits available [quota mixed, typed 1/2]`
- those doctor JSON outputs now carry a shared `schemaVersion`, so external tooling can reject incompatible future contract changes explicitly
- the raw and wrapped Codex doctor JSON outputs now also carry stable `state` enums, so rollout tooling can branch on degraded conditions without parsing human-readable `status` strings
- the human `doctor:preflight` Codex sections now also preserve that same direct raw and wrapped `verdict`, `message`, and code detail, and they now render raw `rateLimitDetails` plus wrapped `quotaDetails` as explicit window rows, so terminal rollout output stays aligned with the JSON contract
- those human `doctor:preflight` Codex sections now also preserve the same identity, freshness, and wrapped `source:` rows as the direct doctors, so wrapped preflight output keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw preflight output keeps `user agent:` alongside account, plan, auth, and degraded host or endpoint hints
- direct Codex doctor fallback failures now also sanitize local CLI spawn detail, so missing-wrapper or bad local wiring cases stay actionable without echoing filesystem paths through `doctor:codex`, `doctor:codex-app-server`, or `sync:codex`
- preflight JSON now also carries stable `failureCodes`, `advisoryCodes`, `readyChecks`, `attentionChecks`, `blockedChecks`, `checkStates`, `checkCodes`, `checkMessages`, and structured `checkDetails`, so rollout tooling can stay at the top level longer before unpacking nested provider or Codex payloads. `checkDetails.operator` now preserves the operator auth posture too, including loopback/remote state, token presence, scope requirements, and the readable blocked message.
- those preflight `checkMessages.raw_codex_app_server` and `checkMessages.codex_wrapper` entries now also preserve the richer direct raw and wrapped Codex `message` fields, so rollout tooling can consume notes like `Codex app-server could not start.`, `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, or `full rate-limits available [quota mixed, typed 1/2]` without unpacking `checkDetails` first.
- `checkDetails.raw_codex_app_server` and `checkDetails.codex_wrapper` now also preserve the nested direct Codex doctor `verdict`, `failureCodes`, `advisoryCodes`, and `message` fields, and they now also carry the direct raw/wrapped identity rows that rollout tooling needs for correlation: raw `userAgent`, `accountType`, `plan`, and `endpoint`, plus wrapped `account`, `refreshedAt`, `refreshedDisplay`, `plan`, and `credits`.
- preflight now also treats any wrapped Codex result with `ok=false` as degraded, so future unknown wrapper-source states cannot slip through as false green rollout results.
- the shared preflight contract logic now has a dedicated direct smoke path, so rollout verdict and code-array semantics are tested independently of the full doctor orchestration; that low-level preflight smoke now also keeps the healthy OpenAI provider-sync contract aligned, so healthy `app-server rate-limits` rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths
- that same low-level `smoke:preflight-contract` path now also keeps the malformed OpenAI trusted-command contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays `command_invalid` in `checkDetails.provider_readiness` and `checkDetails.provider_sync`, preserving readiness wiring like `source`, `configured`, `secure`, and `validated`, plus blocked sync `quotaCoverage: none` with zero quota counters
- the higher-level `smoke:preflight` and `smoke:doctor-contracts` coverage now also explicitly proves the healthy mixed `1/2` OpenAI provider-sync plus raw and wrapped Codex detail on both local-only and remote-trusted `SWITCHBOARD_OPERATOR_TOKEN_FILE` shells, including the richer nested raw `userAgent` / `accountType` / `plan` / `endpoint` fields and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, so the reviewed file-backed operator rollout stays aligned in the human and JSON preflight surfaces too
- provider readiness now has a dedicated doctor and smoke path, so trusted-command wiring and sanitized snapshot validity can be checked before the broker or UI starts
- provider readiness JSON now also carries a top-level `message` plus stable failure/advisory codes, provider lists, and per-provider `providerStates`, `providerKinds`, `providerSources`, `providerConfigured`, `providerSecure`, `providerValidated`, `providerLastModifiedAt`, `providerAccountCounts`, `providerCodes`, and `providerMessages`, so rollout tooling can detect blocked or attention-required provider setup without scanning each provider entry manually
- the human `doctor:providers` output now also prints that same top-level `message:` line before the per-provider rows, so trusted-command-ready, snapshot-missing, and blocked snapshot/config states stay visible without switching to JSON
- on the inferred local OpenAI bridge path used by local-only broker defaults, those direct provider doctor messages now stay explicit too: healthy `doctor:providers -- openai` output reads `trusted_command_ready (unvalidated)`, and healthy `doctor:provider-sync -- openai` output reads `app-server rate-limits available`
- that inferred local bridge can still show up as a split preflight state in real shells: provider readiness remains `trusted_command_ready (unvalidated)` while provider sync degrades to `partial app-server context ... [quota informational_only, typed 0/1]` when wiring is correct but upstream OpenAI/Codex rate-limit windows are still unavailable
- the reviewed broker launchers now also keep startup behavior operator-visible in a safe way: the local launcher prints one sanitized notice when it infers the repo-owned OpenAI bridge instead of echoing local command paths, the remote-trusted launcher falls back to `$HOME/.switchboard/operator-token` when `SWITCHBOARD_OPERATOR_TOKEN_FILE` is unset, that default token-save path is auto-hardened while custom `--file` directories stay caller-managed, broker health surfaces a sanitized warning while the operator and preflight doctors fail closed if that default `.switchboard` token directory drifts back to group- or world-accessible, and both launcher files are now safe to import as helpers without accidentally starting a broker bind
- trusted-command providers now also surface an explicit `provider_trusted_command_unvalidated` advisory in provider readiness, so wiring-only success is not confused with live command execution
- the broker `/adapters` payload now also carries an explicit adapter `status`, so the quota-refresh cards can show `ready with advisories` for config-only trusted-command wiring instead of reconstructing that state from booleans
- that `/adapters` payload also keeps trusted-command `source` details sanitized to the env key plus a coarse command summary, so operator surfaces do not leak raw local wrapper paths or malformed env payloads
- adapter-status classification now also has a direct bind-free smoke path, so the broker/UI `/adapters` contract can drift less easily than if it were only exercised through broader adapter or broker tests
- the `/adapters` route now also has a composed broker helper plus its own bind-free smoke path, so the shared response wrapper can drift less easily than if it were only exercised through the live server route
- the `/v1/profiles` route now also has a composed broker helper plus its own bind-free smoke path, so the shared profile-list response wrapper can drift less easily than if it were only exercised through the live server route
- that list route now returns summary-only project metadata with `repoCount` and `roleCount`, keeping repo paths and full role definitions out of the project-selection surface
- the raw `/v1/projects/:id/state` route now also has a composed broker helper plus its own bind-free smoke path, so project-scoped state keeps approval history and provider account signals without drifting into dashboard-only fields like `plan` or `providerSummaries`
- the raw `/v1/projects/:id/tasks/:taskId` route now also has a composed broker helper plus its own bind-free smoke path, so task detail keeps approval and blocked-state metadata without drifting into project- or dashboard-level fields
- the subscription-refresh response now also has a composed broker helper plus its own bind-free smoke path, so dashboard state and per-provider refresh summaries can drift less easily than if they were only exercised through the live route
- profile-loader and persisted-state validation now use logical context labels instead of absolute filesystem paths, so malformed local profile/state files do not disclose directory layout through broker-facing error detail
- broker error payloads now also use a shared typed helper, and `internal_error` no longer reflects raw exception text back to clients
- malformed JSON, wrong content type, oversized bodies, empty JSON bodies, and request-shape validation now return safe `bad_request` details through shared streamed request-body helpers plus prefix-scoped parsing rules instead of broad string matching that could misclassify unrelated internal errors
- broker route matching now uses an exact shared contract helper, so extra segments like `/tasks/:id/extra` or `/subscriptions/refresh/extra` no longer get accepted accidentally, and `/subscriptions` now advertises only `PUT` while `/subscriptions/refresh` advertises only `POST`
- the unrestricted `scripts/broker-smoke.mjs` expectations are now aligned with that contract too, including precise `Allow` headers, `404` rejection for extra task/refresh path segments, healthy fully typed, healthy mixed, and degraded authorized OpenAI refresh responses, and persisted OpenAI state checks through `/dashboard`, raw `/state`, and the on-disk `threatpedia.json` state file with `0600` permissions for the healthy fully typed, healthy mixed, and degraded partial-app-server paths on the local and remote file-backed operator-token branches, but it still needs an environment that permits local port binds
- broker mutation authorization now also has a shared response-mapping helper, so the server-side `401` vs `403` payload contract stays aligned with auth-policy decisions without depending only on the unrestricted broker smoke
- broker exception handling now also has a shared failure-response helper, so task/store conflicts, adapter refresh conflicts, bad-request classification, and generic `internal_error` responses stay aligned without depending only on the unrestricted broker smoke
- broker profile lookup now also has a shared resolution helper, so the exact `Unknown project profile "..."` contract stays aligned without depending only on the unrestricted broker smoke
- broker JSON response headers now also have a shared envelope helper, so `Content-Type`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Allow` header behavior stay aligned without depending only on the unrestricted broker smoke
- live `doctor:provider-sync -- openai --json` in this shell is currently `blocked` for a local wiring reason rather than upstream rate-limit degradation: no sanitized `openai.json` snapshot is present and no trusted-command adapter is configured in this runtime
- broker subscription-refresh conflicts now also sanitize raw trusted-command stderr, local wrapper paths, and spawn details before they are reflected back to API clients
- `doctor:provider-sync` and preflight now also sanitize blocked trusted-command failure detail, so rollout/operator summaries stay actionable without echoing raw stderr or local wrapper paths
- the one-line preflight summary now also preserves that sanitized blocked provider-sync detail instead of collapsing it back to a generic `provider sync=blocked`
- blocked provider-readiness now also preserves safe snapshot/config detail in `doctor:providers` and shared preflight summaries instead of flattening back to generic `snapshot_invalid` or `command_invalid` labels
- direct `smoke:provider-readiness` now also explicitly pins the malformed OpenAI trusted-command path, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:providers -- openai` output with `provider_command_invalid`, `state: command_invalid`, and the sanitized config message visible, while null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row stay suppressed
- direct `smoke:provider-sync` now also explicitly pins the malformed OpenAI trusted-command path, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:provider-sync -- openai` output with `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, and zero quota counters visible, while null `accounts`, `refreshedAt`, and a redundant `problem:` row stay suppressed
- invalid trusted-command wiring now also blocks provider sync with the same sanitized config detail, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` no longer leaves preflight implying that provider sync is still `ready`
- provider sync now also has a dedicated live doctor and smoke path, so reviewed trusted-command wrappers can be executed once and classified separately from the config-only readiness check
- successful-but-degraded OpenAI/Codex live refresh now returns `attention_required` through `doctor:provider-sync`, so launch-context rate-limit gaps stay visible even when the wrapper itself executed successfully
- provider sync JSON now also carries a top-level `message` plus per-provider `providerStates`, `providerKinds`, `providerSources`, `providerConfigured`, `providerSecure`, `providerAccountCounts`, `providerRefreshedAt`, `providerCodes`, `providerMessages`, `providerAccountSyncMethods`, `providerSyncModes`, `providerSyncBadges`, `providerRateLimitHosts`, and `providerOpenaiAuth`, so automation can consume the exact provider-level degraded reason and persisted account sync source without unpacking the full provider rows
- that direct provider-sync `message` now also preserves provider quota-quality detail when the live refresh is informational-only or only partially typed, so automation can consume strings like `... [quota informational_only, typed 0/1]` or `... [quota mixed, typed 1/2]` without stitching them together from separate fields
- the human `doctor:provider-sync` output now also prints that same top-level `message:` line before the provider rows, so snapshot-backed, degraded, and partially typed live refresh states stay readable without switching to JSON
- the human `doctor:codex-app-server` and `doctor:codex` outputs now also print their top-level `message:` line before the detail rows, so healthy, degraded, and blocked direct Codex states stay readable without switching to JSON
- those human direct Codex outputs now also preserve the surrounding identity and freshness rows instead of collapsing back to only status text, so wrapped `doctor:codex` keeps `account:` plus `refreshed:` while raw `doctor:codex-app-server` keeps `user agent:` alongside account, plan, auth, and degraded host or endpoint hints
- preflight now also preserves that richer provider-sync text in `checkDetails.provider_sync.message`, so the nested preferred-provider view carries the same quota note as the direct doctor summary
- provider sync JSON now also carries per-provider `providerQuotaCoverage`, `providerQuotaModelCounts`, and `providerTypedQuotaModelCounts`, and preflight preserves the preferred-provider view in `checkDetails.provider_sync`, so rollout automation can distinguish typed quota windows from informational-only fallback metadata without unpacking raw account quotas
- the human `doctor:provider-sync` and `doctor:preflight` provider-sync sections now also print provider `quotaCoverage` plus typed/total quota-model counts, preserve direct usage-signal rows like `openaiAuth`, and keep degraded-path rows like `rateLimitHosts` visible when they actually carry data, so terminal rollout checks can distinguish typed quota windows from informational-only fallback metadata, host-specific degradation, or auth-required app-server paths without switching to JSON. On healthy typed and mixed trusted-command paths, empty `rateLimitHosts` and empty `syncBadges` stay suppressed so the human output does not invent noisy placeholder rows
- preflight `--json` now also preserves the same typed-vs-total count detail for the direct raw and wrapped Codex sections in `checkDetails.raw_codex_app_server` and `checkDetails.codex_wrapper`, so rollout automation does not have to derive that from coverage strings alone
- snapshot-backed provider-sync success now also emits `provider_snapshot_only`, so automation can tell when a provider is still running on snapshot-backed refresh instead of live trusted-command execution even if both remain runnable
- rollout preflight now preserves that distinction in the top-level summary too, so snapshot-only provider sync can stay `ready` while still surfacing the actual advisory detail such as `provider sync=snapshot-backed refresh (advisory)`
- when provider sync is fully healthy, the one-line preflight summary now also preserves the live ready message such as `provider sync=app-server rate-limits available` instead of omitting provider sync entirely from the healthy path
- the healthy-path one-line preflight summary now also preserves explicit raw/wrapped Codex ready detail like `raw Codex status=available` and `wrapper status=full rate-limits available` instead of collapsing back to a generic success sentence
- that one-line preflight summary now also preserves wrapped Codex quota-quality detail when the wrapper is non-typed or only partially typed, and raw Codex rate-limit-quality detail when the app-server is degraded, mixed, or fully typed, so rollout output can surface notes like `wrapper status=... [quota informational_only, typed 0/1]`, `wrapper status=full rate-limits available [quota mixed, typed 1/2]`, `raw Codex status=... [rate-limits none]`, `raw Codex status=available [rate-limits mixed, typed 1/2]`, or the clean fully typed `raw Codex status=available` path without opening the detailed section or JSON
- that one-line preflight summary now also preserves provider-sync message plus quota-quality detail when a live refresh is degraded or only partially typed, so rollout operators can see notes like `provider sync=... [quota informational_only, typed 0/1]` or `provider sync=app-server rate-limits available [quota mixed, typed 1/2]` without opening the detailed sections or JSON
- that higher-level preflight coverage now explicitly includes the healthy strict typed paths too: local env-token shells, local file-backed operator-token shells, and remote file-backed operator-token shells now all keep `checkDetails.provider_sync` aligned with the top-level preferred-provider summary for `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, not just the mixed or degraded branches
- that higher-level human mixed `1/2` preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local file-backed and remote env/file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible beside mixed provider-sync detail, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being proven only through JSON `checkDetails.provider_readiness`
- that higher-level human healthy strict typed preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local env-token, local file-backed, remote env-token, and remote file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible on the ready strict rollout branches too, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being implied only by the message line or JSON `checkDetails.provider_readiness`
- that higher-level degraded preflight coverage now also explicitly pins the real degraded trusted-command sync mode too, so the local allow-fallback and remote strict-fail OpenAI branches keep `syncModes: app-server-account` alongside the fuller degraded provider-sync shape, instead of leaving the degraded live sync source implied by only host/auth and informational-only quota hints
- that higher-level blocked malformed-command preflight coverage now also explicitly pins the nested remote `Provider readiness (openai)` and `Provider sync (openai)` sections, so `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no` stay visible there too; blocked sync keeps `quotaCoverage: none` with zero quota counters, while null `accounts`, `lastModifiedAt`, `refreshedAt`, and redundant `problem:` rows stay suppressed instead of being implied only by the direct doctor or JSON summary
- those top-level preflight `checkMessages` now also preserve readable provider advisory detail when it exists, so `trusted_command_ready (unvalidated)` or `snapshot-backed refresh (advisory)` do not get flattened back into advisory code strings
- the one-line preflight summary now also preserves readable provider-readiness detail, including `trusted_command_ready (unvalidated)` and snapshot-missing states, instead of flattening it back to generic advisory or `attention_required` wording
- the one-line preflight summary now also preserves healthy operator posture such as `operator=local-only, host=127.0.0.1` or `operator=remote-trusted, host=0.0.0.0`, so the top-line rollout state stays self-contained even when operator readiness is green
- preflight now also keeps running after operator-readiness failure, so blocked shells still emit a full rollout summary with operator, provider, raw app-server, and wrapper findings instead of stopping at the first assertion
- the human `doctor:operator` and `doctor:preflight` operator sections now also print the direct operator `message:` line before the detail rows, so healthy and blocked operator posture stays readable without switching to JSON
- healthy local-only shells now also preserve basename-safe token-file detail when they use `SWITCHBOARD_OPERATOR_TOKEN_FILE`: direct and preflight operator output stays `ready`, keeps `operatorTokenSource: file`, shows `operatorTokenFile: operator-token`, and preserves the same `local-only; host=127.0.0.1` summary text as the env-token baseline
- conflicting `SWITCHBOARD_OPERATOR_TOKEN` plus `SWITCHBOARD_OPERATOR_TOKEN_FILE` wiring now also surfaces as an explicit fail-closed operator state in both direct and preflight doctor output: `operatorTokenSource` stays visible, but `operatorTokenConfigured` drops to `false` and routine mutation scopes stay disabled until the conflict is resolved
- local-only shells with no exported `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` now also surface as an explicit fail-closed operator state: the direct and preflight operator `message` becomes `Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.`, `operatorTokenSource` reports `unset`, and routine mutation scopes remain disabled unless shell-side token wiring or the explicit dev-only `SWITCHBOARD_ALLOW_OPEN_LOOPBACK_MUTATIONS=1` escape hatch is added
- the human `doctor:preflight` provider sections now preserve that same readable per-provider detail too, and they now also print the direct provider doctor `message:` line before the per-provider rows, so CLI output no longer falls back to raw states like `trusted_command_degraded` when a clearer provider message is available
- those nested preflight provider sections now also mirror the direct provider doctors more fully, preserving readiness posture rows like `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows like `state`, `source`, `configured`, and `secure`, and live sync detail such as `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth` instead of flattening that context back into only the summary line. Degraded-path rows like `syncBadges` and `rateLimitHosts` stay visible there when they actually carry data, and the degraded local allow-fallback plus remote strict-fail trusted-command branches now also explicitly pin the fuller degraded provider-sync shape there, including `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows instead of only the message plus host/auth hints. On healthy trusted-command paths, that nested human preflight provider-sync output also keeps the direct quota rows visible, including `accounts: 1`, `syncModes: app-server-rate-limits`, and typed quota detail like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`; the strict healthy raw and wrapped Codex sections now also keep the secondary `GPT-5.3-Codex-Spark` bucket/model visible with typed `2/2` coverage instead of leaving that fuller healthy shape pinned only to the direct doctor or JSON rollout surfaces. The higher-level JSON surface separately keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists
- planner warnings now also carry structured provider-sync detail, so the broker/UI dashboard can surface the same Codex/OpenAI provider, mode, host, auth, and snapshot-backed sync-source hints without relying only on doctor output
- dashboard snapshot assembly now also has direct bind-free smoke coverage, so degraded provider-sync warning detail, healthy partially typed quota detail, healthy fully typed trusted-command summaries with clean `app-server rate-limits available` wording, and approval gating are verified on the composed broker payload, not only inside planner helpers
- dashboard snapshot assembly now also ships grouped `providerSummaries`, so provider-level sync, account sync method, account context, sanitized host hints, and auth hints stay consistent between broker output and the operator UI
- broker health snapshot assembly now also has direct bind-free smoke coverage, so auth policy stays operator-visible without leaking token material or local filesystem paths
- provider refresh response assembly now also has direct bind-free smoke coverage, so successful-but-degraded, healthy partially typed, and healthy fully typed trusted-command Codex/OpenAI refreshes preserve sync mode, badge, host, auth, and quota-quality detail such as `informational_only` with typed `0/1`, `mixed` with typed `1/2`, or clean `app-server rate-limits available` output instead of collapsing to account counts only. Healthy mixed trusted-command refresh and composed refresh-snapshot paths now also preserve `openaiAuth: ['required']` and the matching auth pill there instead of understating that path as auth-empty. The reviewed file-backed healthy mixed broker branches also explicitly pin the clean trusted-command shape there with `syncBadges: []` and `rateLimitHosts: []` beside that auth signal.
- provider refresh message formatting now also uses the shared core sync-summary helper, so the operator UI and `doctor:provider-sync` keep the same healthy, snapshot-backed, and degraded wording instead of drifting independently
- the quota-refresh adapter cards now also use that shared sync-summary helper on top of broker-composed `providerSummaries`, so operators can see live degraded Codex/OpenAI mode, host, auth, healthy partially typed quota detail such as `mixed` with typed `1/2`, healthy fully typed trusted-command summaries that stay clean without redundant quota-warning text, and snapshot-backed or persisted account sync-source hints at the refresh control itself instead of only in the subscription list or toast message
- the bind-free subscription-sync smoke now also proves both healthy mixed provider summaries from real account quota rows and healthy fully typed trusted-command summaries, so typed quota `1/2` helper output and the fully typed helper path are both covered below the broker and UI composition layers too; that healthy fully typed helper path now also explicitly keeps the auth-bearing shape when the account reports it, preserving `openaiAuthRequired: true` plus the matching `OpenAI auth required` pill and grouped `openaiAuth: ['required']` state alongside the clean `app-server rate-limits available` wording
- those quota-refresh adapter cards now also distinguish config-only trusted-command wiring from proven live refresh, so a reviewed wrapper can show `ready with advisories` until this view has actually seen a successful provider refresh
- the model-availability account cards now also use the shared account-warning helper, so snapshot-backed provider state is visible there too instead of only on the refresh controls and planning warnings
- the reviewed file-backed healthy mixed broker branches now also explicitly pin grouped account context on both local and remote paths, keeping `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned between refresh and dashboard provider summaries instead of leaving that shape implied by the grouped helper alone
- provider refresh summaries now also preserve account display names, latest account refresh timestamps, and grouped account sync methods, so operator refresh feedback can identify the concrete subscription account being acted on and how its current state was sourced instead of only reporting provider-level counts
- rollout preflight now nests the direct `openai` provider readiness and live provider sync summaries, so Codex/OpenAI rollout checks include broker-side provider wiring, one broker-side adapter refresh, and local Codex health in one JSON contract
- the rollout doctor JSON contracts now have a dedicated combined smoke path, so preflight nesting drift is caught directly instead of only by separate doctor tests
- the wrapper doctor and preflight summary now keep the same sanitized upstream host hint as the UI/planner path, so degraded rollout diagnostics stay aligned with the product surface
- the raw app-server doctor now also preserves that same sanitized host hint, so both raw and wrapped rollout diagnostics point at the same upstream usage host when degradation is endpoint-specific
- normalized percentage-window data should keep `interpretation: "percentage_window"` so planners do not treat it like absolute credits or messages
