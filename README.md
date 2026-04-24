# Switchboard

Local control plane for supervised multi-agent workflows.

Switchboard is a local-first orchestration layer for routing work, enforcing permissions, coordinating artifacts, and supervising AI-assisted execution across ChatGPT, Claude, Gemini, Codex, and other agents.

## What it is

Switchboard treats agent collaboration as an operational workflow problem, not a chat UX problem.

It provides:
- a deterministic broker for task routing and approvals
- a shared task and artifact model
- role-based permissions for agents and project packs
- an operator-facing visualization layer for routing and observing work
- reusable project profiles that can adapt the same control plane to multiple repos and workflows
- a planning model that can account for model availability, subscription limits, and reserved usage before execution starts

## Initial direction

The first milestone is a reusable local scaffold with three major surfaces:
- `apps/broker` for orchestration, policy checks, and adapters
- `packages/core` for shared task, policy, project profile, and quota-aware planning types
- `apps/switchboard-ui` for the visual switchboard layer

Threatpedia is planned as the first serious project profile after the core scaffold is in place.

## Current milestone

The repository now has a first production-oriented slice in place:
- a localhost-only broker API with health, profile, state, dashboard, and task creation routes
- task detail and task patch routes with validated lifecycle transitions
- adapter registry and provider refresh paths for OpenAI, Anthropic, and Google
- scoped mutation auth policy surfaced through broker health and the operator UI
- broker health and the Operator session now also surface transport posture, so operators can confirm HTTP vs HTTPS alongside token-gating policy
- broker health and the Operator session now also surface the broker token source (`env`, `file`, `direct`, or `unset`) with a basename-only token file label when present, so UI/browser token state is easier to distinguish from broker-shell token wiring
- broker health and the Operator session now also surface sanitized operator-token wiring problems such as insecure token-file permissions or an insecure default `.switchboard` token directory, so invalid broker token-file setup does not collapse into a silent `operatorTokenConfigured=false`
- validated project profile loading from `profiles/`, with strict unknown-key and empty-section rejection
- private persisted operator state under `.switchboard/state/` with restrictive file permissions
- private sanitized quota imports under `.switchboard/provider-snapshots/`
- trusted-command provider sync that can reuse reviewed local wrappers or OAuth-backed installed clients without persisting raw secrets
- a first OpenAI/Codex supervisor wrapper in `scripts/provider-sync/openai-codex-sync.mjs`
- typed Codex app-server rate-limit and plan snapshots now flow into the OpenAI/Codex wrapper when available
- structured account signals now separate source, plan, and credit metadata from quota-row notes
- percentage-window budgets are treated as advisory planning data instead of raw spendable credits
- planner warnings now distinguish unavailable models from low or non-comparable quota states
- degraded provider sync paths now surface as explicit operator warnings when Codex falls back to partial app-server context or login status
- Codex app-server diagnostics now preserve whether the local account reports `OpenAI auth required`, so degraded sync is a little more actionable
- degraded Codex sync now also preserves a sanitized upstream host hint such as `chatgpt.com`, so operator warnings can point at the failing usage host without exposing credentials
- broker dashboard snapshots now also carry grouped `providerSummaries`, so the UI can read broker-composed provider sync, account sync method, host, and auth context instead of recomputing those summaries from raw subscription rows
- task-level approval metadata now blocks queued and planned work until an operator explicitly approves execution
- task approval history now records request, approval, and reset-to-pending events locally for operator review
- profile-loader fixture coverage now validates valid, duplicate-id, unknown-key, and empty-role failure paths
- auth-policy matrix coverage now validates loopback, remote, token-gated, and manual-replace cases without opening local ports
- operator readiness coverage now validates the documented local-only and remote-trusted deployment baselines without opening local ports
- state-store coverage now validates private file permissions, task lifecycle conflicts, and provider-scoped subscription replacement without opening local ports
- adapter boundary coverage now validates sanitized provider payload parsing, trusted-command failures, and insecure snapshot rejection without opening local ports
- a UI that reads broker-fed dashboard data instead of hard-coded demo arrays
- operator controls for task intake, assignee updates, lifecycle status changes, and quota refresh
- token-gated mutation routes when `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` is configured
- operator token file loading through `SWITCHBOARD_OPERATOR_TOKEN_FILE` for safer local secret storage
- direct HTTPS broker startup when `SWITCHBOARD_TLS_CERT_FILE` and `SWITCHBOARD_TLS_KEY_FILE` are configured
- direct subscription replacement disabled by default unless explicitly re-enabled for reviewed local recovery
- a repeatable broker smoke test via `npm run smoke:broker`

The next steps are verifying Codex app-server availability across launch contexts, extending additional provider wrappers, strengthening operator identity and approval review flows on top of the scoped auth policy, and release-operations polish.

## Visualization layer

The UI is meant to be the switchboard itself, not just a passive dashboard.

The first version focuses on:
- task lanes by status
- assignee and role visibility
- model reservations attached to tasks
- provider and model availability
- remaining subscription capacity when known
- planning warnings when quota data is unknown or low

## Status

This repository is still early, but it is no longer scaffold-only. The local broker, seed persistence, and broker-fed UI path are now working, and the repo has a documented production plan in `docs/PRODUCTION-PLAN.md`.

A Codex handoff brief is included in `docs/CODEX-HANDOFF.md`.

## Working commands

- `npm run verify` validates typecheck, build, and audit.
- `npm run verify:control-plane` validates typecheck, build, a syntax check for the unrestricted broker smoke source, adapter boundaries, adapter refresh conflict sanitization, auth policy, broker health sanitization, broker error-response sanitization, broker failure-response sanitization, broker request-body sanitization, broker response-envelope headers, broker route-contract parsing, broker mutation-authorization mapping, broker profile-resolution mapping, Codex wrapper behavior, Codex doctor behavior, broker dashboard composition, broker raw-state composition, broker task-detail composition, broker refresh-response composition, operator readiness, planner safety, profile-loader validation, profile-list composition, and state-store persistence without registry access or local broker port binds.
- `npm run smoke:broker-parse` syntax-checks `scripts/broker-smoke.mjs` directly, which is useful when you want the tightest standalone constrained check on the unrestricted broker HTTP smoke source.
- `npm run smoke:runtime-config` validates token-file loading, basename sanitization, TLS config reporting, and fail-closed remote startup for the shared broker runtime-config helper.
- `npm run smoke:adapters` validates sanitized provider payload parsing, trusted-command failures, and insecure snapshot rejection without opening local ports.
- `npm run smoke:adapter-conflict` validates that broker-facing provider refresh conflicts keep safe snapshot/config details while stripping raw trusted-command stderr and local path detail.
- `npm run smoke:adapter-status` validates broker adapter-status classification for trusted-command advisories plus ready, missing, insecure, and invalid provider states without opening local ports.
- `npm run smoke:adapters-snapshot` validates the composed broker `/adapters` response shape so the shared route helper and UI-facing adapter snapshot contract do not drift.
- `npm run smoke:auth` validates auth-policy behavior for loopback, remote, token-gated, and manual-replace cases without opening local ports.
- `npm run smoke:codex-app-server-diagnostics` validates the shared Codex app-server error classifier and endpoint extraction helper directly, so wrapper and doctor degradation labels stay aligned.
- `npm run smoke:codex-app-server` validates the direct Codex app-server doctor against full rate-limit, partial usage-endpoint, and app-server-unavailable scenarios without opening local ports.
- `npm run smoke:codex` validates the Codex wrapper against fully typed app-server output, healthy partially typed app-server output, partial app-server account-only output, and the sanitized login-status fallback without opening local ports.
- `npm run smoke:codex-doctor` validates the live Codex doctor command against full rate-limit, partial app-server, and login-fallback scenarios without opening local ports.
- `npm run smoke:dashboard` validates broker dashboard snapshot composition, including approval gating, broker-composed `providerSummaries`, degraded provider-sync warning detail, healthy partially typed quota-detail preservation, and healthy fully typed trusted-command summaries that keep the clean `app-server rate-limits available` wording without redundant quota-warning text, without opening local ports.
- `npm run smoke:doctor-contracts` validates that the JSON contracts from `doctor:operator`, `doctor:codex-app-server`, `doctor:codex`, and `doctor:preflight` stay aligned across degraded, blocked, and ready rollout scenarios.
- that combined doctor-contract coverage now also explicitly includes healthy mixed `1/2` OpenAI provider-sync plus raw and wrapped Codex detail on both the local-only and remote-trusted `SWITCHBOARD_OPERATOR_TOKEN_FILE` shells, including the richer nested raw `userAgent` / `accountType` / `plan` / `endpoint` fields and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, so the reviewed file-backed operator path stays aligned at the top-level JSON rollout surface too.
- `npm run smoke:error-response` validates broker error payload helpers so common API failures stay typed and unexpected internal errors do not echo raw exception text back to clients.
- `npm run smoke:health` validates the composed `/healthz` broker snapshot so auth policy stays visible without leaking operator tokens or local filesystem paths.
- `npm run smoke:operator` validates the documented local-only and remote-trusted operator baselines against the real broker env names without opening local ports.
- `npm run smoke:preflight-contract` validates the shared preflight verdict, summary, and failure/advisory code classifier directly, so rollout semantics do not rely only on the full doctor stack tests. It now also keeps the healthy OpenAI provider-sync contract aligned on that low-level surface: healthy `app-server rate-limits` preflight rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths. That same low-level path now also keeps the malformed OpenAI trusted-command contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays `command_invalid` in `checkDetails.provider_readiness` and `checkDetails.provider_sync`, preserving readiness wiring like `source`, `configured`, `secure`, and `validated`, plus blocked sync `quotaCoverage: none` with zero quota counters.
- `npm run smoke:preflight` validates the combined operator, raw Codex app-server, and Codex wrapper preflight path for permissive and strict rollout modes without opening local ports.
- that higher-level preflight smoke now also explicitly proves the healthy mixed `1/2` OpenAI/Codex path on both local-only and remote-trusted file-backed operator-token shells in both human and JSON output, including the richer nested raw and wrapped Codex identity/freshness rows, not just env-token or degraded rollout states.
- `npm run smoke:planner` validates planner handling for advisory percentage windows, low quota, and unavailable models without opening local ports.
- `npm run smoke:providers` validates provider readiness classification for trusted-command wiring, sanitized snapshot validation, missing snapshots, and invalid provider config without opening local ports.
- `npm run smoke:provider-sync` validates the live provider refresh doctor against trusted-command success, degraded trusted-command sync, and blocked refresh failures without opening local ports.
- `npm run smoke:profiles` validates profile-loader fixtures for valid profiles, duplicate IDs, unknown keys, and empty role/responsibility failures without opening local ports.
- `npm run smoke:profiles-snapshot` validates the composed `/v1/profiles` broker snapshot so the shared route helper keeps the project list summary-only and path-safe.
- `npm run smoke:request-body` validates broker streamed request-body parsing/classification so empty bodies, malformed JSON, wrong content type, and oversized bodies return safe `bad_request` details instead of falling through to generic broker failures.
- `npm run smoke:route-contract` validates exact broker path/method matching so extra path segments do not get misclassified as valid task or refresh routes, and `Allow` headers stay precise for collection vs subresource endpoints.
- `npm run smoke:mutation-authorization` validates the server-side mapping from auth-policy decisions to `401 unauthorized` vs `403 forbidden` broker payloads, so that mutation-route error bodies stay aligned even when the unrestricted broker smoke cannot run.
- `npm run smoke:failure-response` validates the server-side mapping from task/store/adapter/request exceptions to `404`, `409`, `400`, and sanitized `500` broker payloads, so the catch-path contract stays aligned without relying only on the unrestricted broker smoke.
- `npm run smoke:profile-resolution` validates the server-side mapping from requested project ids to either a loaded profile or the exact `Unknown project profile "..."` `404` payload, so profile lookup behavior no longer depends only on the unrestricted broker smoke.
- `npm run smoke:response-envelope` validates the broker’s shared JSON response headers and `Allow` handling, so `application/json`, `no-store`, `nosniff`, and `method_not_allowed` header behavior stay aligned without needing a live port-bind route check.
- `npm run smoke:broker` is also aligned with that exact-path contract now, including `405 Allow` precision for `/v1/profiles`, `/subscriptions`, and `/subscriptions/refresh`, `404` rejection for extra task/refresh path segments, healthy fully typed, healthy mixed, and degraded authorized OpenAI refresh responses, and persisted OpenAI state checks through `/dashboard`, raw `/state`, and the on-disk `threatpedia.json` state file with `0600` permissions for the healthy fully typed, healthy mixed, and degraded partial-app-server paths on the local and remote file-backed operator-token branches when an unrestricted local port-bind environment is available.
- `npm run smoke:refresh` validates broker refresh summary composition so degraded trusted-command OpenAI refreshes, healthy partially typed refreshes, and healthy fully typed trusted-command refreshes preserve sync mode, badge, host, auth, and quota-quality detail such as `informational_only` with typed `0/1`, `mixed` with typed `1/2`, or clean `app-server rate-limits available` output without redundant quota-warning text instead of collapsing to account counts only. Healthy mixed trusted-command refreshes now also keep `openaiAuth: ['required']` and the matching `OpenAI auth required` pill instead of understating that path as auth-empty.
- `npm run smoke:refresh-snapshot` validates the composed subscription-refresh broker response so dashboard state and per-provider refresh summaries stay aligned on the same degraded, partially typed, or fully typed trusted-command host, auth, and quota-quality detail instead of drifting apart. The healthy mixed trusted-command composed path now also keeps `openaiAuth: ['required']` aligned between the refresh result and dashboard provider summary instead of dropping it on the bind-free composed surface.
- `npm run smoke:state-snapshot` validates the composed `/v1/projects/:id/state` broker snapshot so raw project state keeps approval history, provider signals, and profile detail without accidentally drifting into dashboard-only fields.
- `npm run smoke:subscription-sync` validates the shared Codex/OpenAI sync-state helper so the wrapper, planner, and UI keep interpreting degraded provider states the same way, and it now also proves both healthy mixed provider summaries such as typed quota `1/2` and healthy fully typed trusted-command summaries from real account quota rows. That healthy fully typed helper path now also explicitly keeps the auth-bearing shape when the account reports it, preserving `openaiAuthRequired: true` plus the matching `OpenAI auth required` pill and grouped `openaiAuth: ['required']` state alongside the clean `app-server rate-limits available` wording.
- `npm run smoke:state` validates state-store permissions, task lifecycle transitions, and provider-scoped subscription replacement without opening local ports.
- `npm run smoke:task-snapshot` validates the composed `/v1/projects/:id/tasks/:taskId` broker snapshot so task detail stays distinct from state and dashboard payloads.
- `npm run smoke:broker` runs the broker against a temporary isolated state directory.
- `npm run doctor:codex-app-server -- allow-degraded` queries the raw Codex app-server directly, and `npm run doctor:codex-app-server -- require-rate-limits` fails if `account/rateLimits/read` is unavailable. Add `--json` for machine-readable output.
- `npm run doctor:codex -- allow-fallback` summarizes the live Codex wrapper path for the current shell, and `npm run doctor:codex -- require-rate-limits` fails if full app-server rate-limit data is unavailable. Add `--json` for machine-readable output.
- `doctor:codex-app-server --json` and `doctor:codex --json` now also expose stable `verdict`, `failureCodes`, `advisoryCodes`, and `message` fields on top of the existing state/status data. Those direct top-level `message` fields now also preserve rate-limit or quota quality for degraded, mixed, and fully typed healthy states, so direct runs can surface strings like `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, `partial app-server context (...) [quota informational_only, typed 0/1]`, or `full rate-limits available [quota mixed, typed 1/2]` without rebuilding the note from separate fields. `doctor:codex-app-server --json` now also carries structured `rateLimitDetails`, and `doctor:codex --json` now carries structured `quotaDetails`, so automation can consume live raw and wrapped 5-hour / weekly Codex windows without scraping formatted strings.
- the human `doctor:codex-app-server` and `doctor:codex` outputs now also print that same top-level `message:` line before their detail rows, so healthy, degraded, and blocked direct Codex states stay readable without switching to JSON.
- those human direct Codex outputs now also preserve the surrounding identity and freshness rows instead of collapsing back to only status text: wrapped `doctor:codex` keeps `account:` plus `refreshed:`, and raw `doctor:codex-app-server` keeps `user agent:` alongside `account type:`, `plan:`, `openai auth:`, and degraded host or endpoint hints.
- the human `doctor:codex` output now also renders one block per model with explicit window rows like `5-hour window` and `Weekly window`, so operators can read live Codex quota windows from the terminal without inspecting `--json`.
- the human `doctor:codex-app-server` output now also renders raw `rate-limit bucket` rows with explicit window resets when the upstream app-server returns them, including healthy fully typed secondary buckets like `GPT-5.3-Codex-Spark` when those windows are available, so operators can compare raw and wrapped Codex windows from the terminal instead of only seeing the mixed `1/2` fallback shape.
- `npm run doctor:operator -- local-only` or `npm run doctor:operator -- remote-trusted` checks the current shell configuration against the intended deployment mode before starting the broker. Add `--json` for machine-readable output.
- `doctor:operator --json` now exposes stable `verdict`, `failureCodes`, `advisoryCodes`, `message`, and `problems` fields in addition to the operator auth posture booleans and scope requirements, so automation can consume operator-readiness failures without scraping stderr.
- blocked `doctor:operator` runs now fail cleanly from that structured summary too, instead of dumping a Node assertion stack trace.
- `npm run doctor:providers -- [openai|anthropic|google ...]` validates trusted-command wiring and sanitized snapshot readiness for the selected providers without executing provider sync commands. Add `--json` for machine-readable output.
- `npm run doctor:provider-sync -- [openai|anthropic|google ...]` executes the selected provider refresh paths once and validates the sanitized output they return. Add `--json` for machine-readable output.
- `npm run doctor:preflight -- local-only allow-fallback` or `npm run doctor:preflight -- remote-trusted require-rate-limits` runs operator readiness, broker-side OpenAI provider readiness, live broker-side OpenAI provider sync, raw Codex app-server diagnostics, and wrapper checks as one deployment preflight, then prints a one-line rollout verdict. Add `--json` for a single structured rollout summary.
- the human `doctor:provider-sync` and `doctor:preflight` provider-sync sections now also show provider `quotaCoverage` plus typed/total quota-model counts, preserve direct usage-signal rows like `openaiAuth`, and keep degraded-path rows like `rateLimitHosts` visible when they actually carry data, so operators can tell whether a live refresh produced typed quota windows, which host degraded the path, or whether OpenAI auth is still required without switching to JSON. On healthy typed and mixed trusted-command paths, empty `rateLimitHosts` and empty `syncBadges` stay suppressed so the human output does not invent noisy placeholder rows.
- in `local-only` mode, `doctor:providers` and `doctor:provider-sync` now also mirror the default `npm run dev:broker` OpenAI launch behavior: when no explicit OpenAI adapter env is set and no `openai.json` snapshot exists, they evaluate the reviewed repo-owned OpenAI/Codex bridge instead of reporting a false local snapshot-missing block.
- on that inferred local OpenAI path, healthy direct doctor output now also stays concrete instead of generic: `doctor:providers -- openai` reports `trusted_command_ready (unvalidated)`, and `doctor:provider-sync -- openai` reports `app-server rate-limits available` when the bridge returns fully typed quota windows.
- in `local-only` mode, that preflight path now mirrors the default `npm run dev:broker` launch behavior for OpenAI too: when no explicit OpenAI adapter env is set and no `openai.json` snapshot exists, it evaluates the reviewed repo-owned OpenAI/Codex bridge instead of reporting a false local snapshot-missing block.
- on that same inferred local preflight path, current live output can legitimately mix a healthy provider-readiness line with a degraded provider-sync line: for example `provider readiness=trusted_command_ready (unvalidated)` can appear alongside `provider sync=partial app-server context ... [quota informational_only, typed 0/1]` when the bridge is wired correctly but upstream OpenAI/Codex rate-limit windows are still degrading.
- all doctor `--json` outputs now include a shared `schemaVersion` field so rollout automation can fail safely on future contract changes.
- the raw and wrapped Codex doctor JSON outputs now also include stable `state` enums, so automation does not need to parse human `status` strings for degraded-path handling.
- the human `doctor:preflight` Codex sections now also preserve the direct raw and wrapped doctor `verdict`, `message`, and code detail, so terminal rollout output stays aligned with the machine-readable contract.
- those human `doctor:preflight` Codex sections now also preserve the same identity, freshness, and wrapped `source:` rows as the direct doctors, so wrapped preflight output keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw preflight output keeps `user agent:` alongside account, plan, auth, and degraded host or endpoint hints.
- those human `doctor:preflight` Codex sections now also render the raw doctor `rateLimitDetails` and wrapped doctor `quotaDetails` as explicit window rows, so strict rollout checks show both raw app-server buckets and wrapped `5-hour` / `Weekly` Codex windows directly in the CLI when that data is available.
- direct Codex doctor fallback failures now also sanitize local CLI spawn detail, so missing-wrapper or bad local wiring cases do not echo filesystem paths back through `doctor:codex`, `doctor:codex-app-server`, or `sync:codex`.
- `doctor:preflight --json` now also exposes stable `failureCodes`, `advisoryCodes`, `readyChecks`, `attentionChecks`, `blockedChecks`, `checkStates`, `checkCodes`, `checkMessages`, and structured `checkDetails`, so rollout automation can stay at the top level longer before it needs to inspect nested provider or Codex payloads. `checkDetails.operator` now carries the operator auth posture too, including loopback/remote shape, token presence, scope requirements, and the readable blocked message when operator readiness fails.
- those top-level preflight `checkMessages.raw_codex_app_server` and `checkMessages.codex_wrapper` entries now also preserve the richer direct doctor `message` fields, so rollout automation can see notes like `Codex app-server could not start.`, `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, or `full rate-limits available [quota mixed, typed 1/2]` without opening `checkDetails`.
- `checkDetails.raw_codex_app_server` and `checkDetails.codex_wrapper` now also preserve the nested direct Codex doctor `verdict`, `failureCodes`, `advisoryCodes`, and `message` fields. `checkDetails.raw_codex_app_server` now carries raw `userAgent`, `accountType`, `plan`, `endpoint`, and `rateLimitDetails`, and `checkDetails.codex_wrapper` now carries wrapped `account`, `refreshedAt`, `refreshedDisplay`, `plan`, `credits`, and `quotaDetails`, so automation can consume direct raw/wrapped Codex identity, freshness, severity, and structured usage windows without reverse-mapping from state or scraping display strings.
- preflight now also treats any wrapped Codex result with `ok=false` as degraded instead of only special-casing `login_fallback` and `partial_app_server`, so future unknown wrapper-source states do not get flattened into false green rollout results.
- those preflight verdict and code semantics now also have a direct helper smoke path, so they can drift less easily than if they were tested only through the full preflight command.
- preflight now also nests the direct `openai` provider readiness and provider sync summaries, so rollout tooling can see both broker-side wiring and broker-side live refresh status in the same machine-readable payload as the Codex health checks.
- `doctor:providers --json` now exposes a top-level `message` plus stable `failureCodes`, `advisoryCodes`, provider name lists, and per-provider `providerStates`, `providerKinds`, `providerSources`, `providerConfigured`, `providerSecure`, `providerValidated`, `providerLastModifiedAt`, `providerAccountCounts`, `providerCodes`, and `providerMessages`, so automation can detect blocked or attention-required provider wiring without scanning every provider entry.
- the human `doctor:providers` output now also prints that same top-level `message:` line before the per-provider rows, so trusted-command-ready, snapshot-missing, and blocked snapshot/config states stay visible without switching to JSON.
- trusted-command providers also surface `provider_trusted_command_unvalidated` until a deeper execution path like broker refresh or dedicated wrapper smoke has actually exercised the command.
- the broker `/adapters` payload now also carries an explicit adapter `status`, so the UI can show `ready with advisories` for config-only trusted-command wiring instead of inferring that state from booleans.
- that `/adapters` payload also keeps trusted-command `source` details sanitized to the env key plus a coarse command summary, so operator surfaces do not leak raw local wrapper paths or malformed env payloads.
- the `/v1/profiles` route now also has a composed broker helper plus its own bind-free smoke path, and it returns summary-only project metadata with `repoCount` and `roleCount` instead of leaking repo paths or full role definitions on the list surface.
- the raw `/v1/projects/:id/state` route now also has a composed broker helper plus its own bind-free smoke path, so project-scoped state keeps approval history and provider account signals without drifting into dashboard-only fields like `plan` or `providerSummaries`.
- the raw `/v1/projects/:id/tasks/:taskId` route now also has a composed broker helper plus its own bind-free smoke path, so task detail keeps approval and blocked-state metadata without drifting into project- or dashboard-level fields.
- the subscription-refresh response now also has a composed broker helper plus its own bind-free smoke path, so dashboard state and per-provider refresh summaries are covered together instead of only through broader route tests.
- profile-loader and persisted-state validation now use logical context labels instead of absolute filesystem paths, so malformed local profile/state files do not disclose directory layout through broker-facing error detail.
- broker error payloads now also use a shared typed helper, and `internal_error` no longer reflects raw exception text back to clients.
- malformed JSON, wrong content type, oversized bodies, empty JSON bodies, and request-shape validation now return safe `bad_request` details through shared streamed request-body helpers plus prefix-scoped parsing rules instead of broad string matching that could misclassify unrelated internal errors.
- broker route matching now uses an exact shared contract helper, so extra segments like `/tasks/:id/extra` or `/subscriptions/refresh/extra` no longer get accepted accidentally, and `/subscriptions` now advertises only `PUT` while `/subscriptions/refresh` advertises only `POST`.
- broker mutation authorization now also has a shared response-mapping helper, so the server-side `401` vs `403` payload contract stays aligned with auth-policy decisions without depending only on the unrestricted broker smoke.
- broker exception handling now also has a shared failure-response helper, so task/store conflicts, adapter refresh conflicts, bad-request classification, and generic `internal_error` responses stay aligned without depending only on the unrestricted broker smoke.
- broker profile lookup now also has a shared resolution helper, so the exact `Unknown project profile "..."` contract stays aligned without depending only on the unrestricted broker smoke.
- broker JSON response headers now also have a shared envelope helper, so `Content-Type`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Allow` header behavior stay aligned without depending only on the unrestricted broker smoke.
- broker subscription-refresh conflicts now also sanitize raw trusted-command stderr, local wrapper paths, and spawn details before they are reflected back to API clients.
- `doctor:provider-sync` and preflight now also sanitize blocked trusted-command failure detail, so operator-facing summaries stay actionable without echoing raw stderr or local wrapper paths.
- preflight’s one-line rollout summary now also preserves that sanitized blocked provider-sync detail instead of collapsing it back to a generic `provider sync=blocked`.
- blocked provider-readiness now also preserves safe snapshot/config detail in `doctor:providers` and shared preflight summaries instead of flattening back to generic `snapshot_invalid` or `command_invalid` labels.
- direct `smoke:provider-readiness` now also explicitly pins the malformed OpenAI trusted-command path, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:providers -- openai` output with `provider_command_invalid`, `state: command_invalid`, and the sanitized config message visible, while null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row stay suppressed.
- direct `smoke:provider-sync` now also explicitly pins the malformed OpenAI trusted-command path, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:provider-sync -- openai` output with `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, and zero quota counters visible, while null `accounts`, `refreshedAt`, and a redundant `problem:` row stay suppressed.
- invalid trusted-command wiring now also blocks provider sync with the same sanitized config detail, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` no longer leaves preflight pretending that provider sync is still `ready`.
- `doctor:provider-sync --json` now exposes a top-level `message` plus the same machine-readable provider lists and per-provider `providerStates`, `providerKinds`, `providerSources`, `providerConfigured`, `providerSecure`, `providerAccountCounts`, `providerRefreshedAt`, `providerCodes`, `providerMessages`, `providerAccountSyncMethods`, `providerSyncModes`, `providerSyncBadges`, `providerRateLimitHosts`, and `providerOpenaiAuth`, so automation can distinguish a wiring-only success from an actually executed provider refresh without unpacking every nested provider row.
- `doctor:provider-sync --json` now also exposes per-provider `providerQuotaCoverage`, `providerQuotaModelCounts`, and `providerTypedQuotaModelCounts`, and preflight preserves the preferred-provider view of those fields in `checkDetails.provider_sync`, so rollout tooling can tell whether a live provider refresh has typed quota windows, informational-only fallback metadata, or no quota rows at all.
- that top-level `doctor:provider-sync` `message` now also preserves provider quota-quality detail for non-typed live refreshes, so direct degraded or partially typed runs can say things like `partial app-server context ... [quota informational_only, typed 0/1]` or `app-server rate-limits available [quota mixed, typed 1/2]` without rejoining separate fields.
- the human `doctor:provider-sync` output now also prints that same top-level `message:` line before the provider rows, so snapshot-backed, degraded, and partially typed live refresh states stay readable without switching to JSON.
- preflight now preserves that same richer nested provider-sync message in `checkDetails.provider_sync.message`, so automation can consume the preferred-provider detail directly without rebuilding quota notes from separate fields.
- snapshot-backed provider-sync success now also emits `provider_snapshot_only`, so automation can distinguish live trusted-command execution from snapshot-only fallback even when both remain runnable.
- preflight now preserves that distinction at the top level too: a snapshot-only provider sync can still stay `ready`, but `doctor:preflight` will surface the actual advisory detail such as `provider sync=snapshot-backed refresh (advisory)` instead of flattening it into silent success.
- when provider sync is fully healthy, the one-line preflight summary now also preserves the live ready message such as `provider sync=app-server rate-limits available` instead of omitting provider sync entirely from the healthy path.
- the healthy-path one-line preflight summary now also preserves explicit raw/wrapped Codex ready detail like `raw Codex status=available` and `wrapper status=full rate-limits available` instead of collapsing back to a generic success sentence.
- that one-line preflight summary now also preserves wrapped Codex quota-quality detail when the wrapper is non-typed or only partially typed, and raw Codex rate-limit-quality detail when the app-server is degraded, mixed, or fully typed, so rollout output can surface notes like `wrapper status=... [quota informational_only, typed 0/1]`, `wrapper status=full rate-limits available [quota mixed, typed 1/2]`, `raw Codex status=... [rate-limits none]`, `raw Codex status=available [rate-limits mixed, typed 1/2]`, or the clean fully typed `raw Codex status=available` path without opening the detailed section or JSON.
- the human `doctor:codex-app-server`, `doctor:codex`, and wrapped sections in `doctor:preflight` now also print typed/total rate-limit bucket or quota-model counts, so direct Codex/OpenAI checks use the same `0/N`, `1/N`, or `N/N` quality language as provider sync.
- preflight `--json` now also preserves those raw/wrapped typed-vs-total count fields in `checkDetails.raw_codex_app_server` and `checkDetails.codex_wrapper`, so rollout automation can consume the same count detail the human CLI prints.
- that one-line preflight summary now also preserves provider-sync message plus quota-quality detail when a live refresh is degraded or only partially typed, so rollout operators can see notes like `provider sync=... [quota informational_only, typed 0/1]` or `provider sync=app-server rate-limits available [quota mixed, typed 1/2]` without opening the detailed sections or JSON.
- those top-level preflight `checkMessages` now also preserve readable provider advisory detail when it exists, so `trusted_command_ready (unvalidated)` or `snapshot-backed refresh (advisory)` do not get flattened back into advisory code strings.
- the one-line preflight summary now also preserves readable provider-readiness detail, including `trusted_command_ready (unvalidated)` and snapshot-missing states, instead of flattening them back to generic advisory or `attention_required` wording.
- that higher-level human mixed `1/2` preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local file-backed and remote env/file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible alongside mixed provider-sync detail, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being proven only through JSON `checkDetails.provider_readiness`.
- that higher-level human healthy strict typed preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local env-token, local file-backed, remote env-token, and remote file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible on the ready strict rollout branches too, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being implied only by the message line or JSON `checkDetails.provider_readiness`.
- that higher-level degraded preflight coverage now also explicitly pins the real degraded trusted-command sync mode too, so the local allow-fallback and remote strict-fail OpenAI branches keep `syncModes: app-server-account` alongside the fuller degraded provider-sync shape, instead of leaving the degraded live sync source implied by only host/auth and informational-only quota hints.
- that higher-level blocked malformed-command preflight coverage now also explicitly pins the nested remote `Provider readiness (openai)` and `Provider sync (openai)` sections, so `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no` stay visible there too; blocked sync keeps `quotaCoverage: none` with zero quota counters, while null `accounts`, `lastModifiedAt`, `refreshedAt`, and redundant `problem:` rows stay suppressed instead of being implied only by the direct doctor or JSON summary.
- the one-line preflight summary now also preserves healthy operator posture such as `operator=local-only, host=127.0.0.1` or `operator=remote-trusted, host=0.0.0.0`, so the top-line rollout state stays self-contained even when operator readiness is green.
- preflight now also keeps running after operator-readiness failure, so blocked shells still return a full rollout summary with operator, provider, raw app-server, and wrapper findings instead of stopping at the first assertion.
- the human `doctor:operator` and `doctor:preflight` operator sections now also print the direct operator `message:` line before the detail rows, so healthy and blocked operator posture stays readable without switching to JSON.
- the human `doctor:preflight` provider sections now preserve that same readable per-provider detail too, and they now also print the direct provider doctor `message:` line before the per-provider rows, so CLI output no longer falls back to raw states like `trusted_command_degraded` when a clearer provider message is available. Those nested provider sections now also mirror the direct provider doctors more fully by preserving readiness posture rows like `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows like `state`, `source`, `configured`, and `secure`, and live sync detail such as `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth`, while keeping degraded-path rows like `syncBadges` and `rateLimitHosts` visible when they actually carry data. The degraded local allow-fallback and remote strict-fail trusted-command paths now also explicitly pin that fuller degraded provider-sync shape, so `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows stay visible there instead of only the message plus host/auth hints. On healthy typed and mixed trusted-command paths, empty `syncBadges` and empty `rateLimitHosts` stay suppressed there too, while the direct quota rows remain visible, including `accounts: 1`, `syncModes: app-server-rate-limits`, and typed quota detail like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`; the strict healthy raw and wrapped Codex sections now also keep the secondary `GPT-5.3-Codex-Spark` bucket/model visible with typed `2/2` coverage instead of leaving that fuller healthy shape pinned only to the direct doctor or JSON rollout surfaces. The higher-level JSON surface separately keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists.
- that higher-level preflight coverage now explicitly includes the healthy strict typed paths too: local env-token shells, local file-backed operator-token shells, and remote file-backed operator-token shells now all keep `checkDetails.provider_sync` aligned with the top-level preferred-provider summary for `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, not just the mixed or degraded branches.
- the human `doctor:operator` and `doctor:preflight` operator sections now also show `operatorTokenSource`, the token-file basename when available, and any sanitized `operatorTokenProblem`, so shell-side token wiring drift is easier to distinguish from the browser-only UI token cache.
- healthy local-only shells now also keep that token-file detail visible when they use `SWITCHBOARD_OPERATOR_TOKEN_FILE`: the direct and preflight operator surfaces stay `ready`, preserve `operatorTokenSource: file`, show basename-only `operatorTokenFile: operator-token`, and keep the same `local-only; host=127.0.0.1` summary text as the env-token baseline.
- conflicting `SWITCHBOARD_OPERATOR_TOKEN` plus `SWITCHBOARD_OPERATOR_TOKEN_FILE` wiring now also surfaces as an explicit fail-closed operator state in both direct and preflight doctor output: `operatorTokenSource` stays visible, but `operatorTokenConfigured` drops to `no` and mutation scopes fall back to `open` until the conflict is resolved.
- local-only shells with neither `SWITCHBOARD_OPERATOR_TOKEN` nor `SWITCHBOARD_OPERATOR_TOKEN_FILE` now also surface as an explicit fail-closed operator state in both direct and preflight doctor output: the operator `message:` becomes `Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.`, `operatorTokenSource` reports `unset`, `operatorTokenConfigured` stays `no`, and mutation scopes remain `open` until a shell token env or token file is configured.
- planner warnings now also carry structured provider-sync detail, and the dashboard warning cards surface the same provider, mode, host, auth, and snapshot-backed sync-source hints instead of relying only on long prose warnings.
- provider refresh responses now also carry structured degraded-sync detail, so a successful-but-degraded OpenAI/Codex refresh can surface the same badge and host/auth hints in the operator UI instead of only reporting refreshed account counts.
- provider refresh messages now also use the same shared formatting contract as the live provider-sync doctor, so healthy `app-server rate-limits available`, snapshot-backed refresh, and degraded Codex/OpenAI badges do not drift between the operator UI and the doctor tooling.
- broker dashboard snapshots now also expose grouped `providerSummaries`, so the operator UI can render provider-level sync, account sync method, and account context from the broker payload instead of recomputing it from raw subscription rows.
- the quota-refresh adapter cards now surface the same live sync summary and pills as the shared Codex/OpenAI sync helpers on top of those broker-composed `providerSummaries`, so operators can see degraded `chatgpt.com` / auth-required conditions, healthy partially typed states such as `mixed` with typed `1/2`, plus snapshot-backed or persisted `seed` / `snapshot` / `provider` account sync source directly where they trigger refreshes. The reviewed file-backed healthy mixed broker branches now also explicitly pin the clean trusted-command shape there too, keeping `syncBadges: []` and `rateLimitHosts: []` beside `openaiAuth: ['required']` instead of only proving the degraded host-bearing case.
- those quota-refresh adapter cards now also distinguish config-only trusted-command wiring from proven live refresh, so a reviewed wrapper can show `ready with advisories` until this view has actually seen a successful provider refresh.
- the model-availability account cards now also surface snapshot-backed provider-state warnings through the same shared helper path, so snapshot-only accounts are no longer quieter than the refresh and planning surfaces.
- provider refresh summaries now also preserve account display names, latest account refresh timestamps, and grouped account sync methods, so operator toasts and quota-refresh cards can show which subscription account was actually refreshed and how that account state was sourced instead of only provider-level counts. The reviewed file-backed healthy mixed broker branches now also explicitly pin that grouped account context on both local and remote paths, keeping `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned between refresh and dashboard provider summaries instead of leaving that shape implied by the grouped helper alone.
- successful-but-degraded OpenAI/Codex sync now surfaces as `attention_required` in `doctor:provider-sync`, keeping live command execution distinct from healthy rate-limit-window access.
- `npm run sync:codex` emits the current sanitized OpenAI/Codex supervisor snapshot from the local Codex CLI.
- `npm run dev:broker` builds and starts the local broker on `127.0.0.1:7007`. `npm --workspace @switchboard/broker run dev` and `cd apps/broker && npm run dev` now use the same launcher. When no explicit OpenAI adapter env is set and no `.switchboard/provider-snapshots/openai.json` exists, that launcher auto-wires the reviewed repo-owned `scripts/provider-sync/openai-codex-sync.mjs` bridge for local loopback testing. When that fallback is inferred, the launcher prints a single sanitized notice instead of echoing local command paths.
- `npm run operator-token:save` writes a strong operator token to `$HOME/.switchboard/operator-token` with owner-only storage and refuses to overwrite that file unless you rerun it intentionally with `npm run operator-token:save -- --rotate`, which also re-applies owner-only mode to the replacement token file and the default `.switchboard` token directory. When you use `--file /custom/path`, the token file is still forced to `0600`, but the parent directory stays caller-managed and should already be private.
- `npm run dev:broker:remote-trusted` builds and starts the reviewed remote-trusted broker path with `SWITCHBOARD_ALLOW_REMOTE=1`, HTTPS, and token-file loading. If `SWITCHBOARD_OPERATOR_TOKEN_FILE` is unset, it defaults to `$HOME/.switchboard/operator-token`, which matches `npm run operator-token:save`.
- `npm run dev:ui` starts the Vite UI with `/api` proxied to the broker.

## Sanitized quota snapshots

Snapshot-backed refresh currently expects sanitized local files under `.switchboard/provider-snapshots/` such as `openai.json`.

Those files must:
- contain quota/account metadata only
- never contain OAuth tokens, cookies, raw provider exports, or CLI credential caches
- stay private on disk with restrictive permissions

## Trusted provider sync

When a reviewed local wrapper or installed client can emit sanitized quota state directly, the broker can prefer that over static snapshot files.

Per-provider configuration uses JSON argv arrays instead of shell strings:
- `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`
- `SWITCHBOARD_ANTHROPIC_REFRESH_COMMAND_JSON`
- `SWITCHBOARD_GOOGLE_REFRESH_COMMAND_JSON`

Example:

```bash
export SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON='["node","/absolute/path/to/openai-sync.mjs"]'
```

Codex-first local setup:

```bash
export SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON='["node","/Users/mhedhli/Documents/Coding/Switchboard/scripts/provider-sync/openai-codex-sync.mjs"]'
```

The command must:
- run locally without shell expansion
- emit sanitized JSON to stdout using the schema in [docs/QUOTA-SNAPSHOT-SCHEMA.md](/Users/mhedhli/Documents/Coding/Switchboard/docs/QUOTA-SNAPSHOT-SCHEMA.md)
- keep raw OAuth tokens, cookies, or provider exports out of stdout and out of broker state

The current Codex wrapper now prefers the local Codex app-server rate-limit surface. When available, it reports:
- ChatGPT-backed plan type
- 5-hour and weekly Codex usage windows
- additional credit balance metadata when Codex exposes it

The wrapper stores source, plan, and credit metadata as structured account signals instead of burying them in quota notes. If `account/read` succeeds but rate-limits do not, it keeps the typed app-server account context, marks the source as `app-server account`, and surfaces a sanitized rate-limit availability signal. Only earlier app-server failures fall back to `login-status fallback`. It normalizes usage-window percentages into `limit=100`, `used=<percent>`, and `remaining=<percent>` with `interpretation: "percentage_window"` and `usageUnit: unknown`, and now preserves explicit per-model quota windows for the 5-hour and weekly Codex surfaces when those are available. The UI renders those windows directly instead of flattening weekly limits into freeform notes, and the planner still treats them as advisory windows instead of pretending they are raw credits.

When refresh succeeds through this path, persisted subscription records are marked as `syncMethod: provider`.

## Broker auth policy

Mutation routes follow a narrow default policy:
- loopback-only brokers may keep task creation, task updates, and adapter refresh open unless an operator token is configured
- `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` turns those mutation routes into token-gated operations
- non-local broker exposure disables mutation routes until a token is configured and direct TLS is present
- `PUT /v1/projects/:id/subscriptions` stays disabled by default unless `SWITCHBOARD_ENABLE_MANUAL_SUBSCRIPTION_REPLACE=1` is set for reviewed local recovery work

Preferred token storage:

```bash
npm run operator-token:save
export SWITCHBOARD_OPERATOR_TOKEN_FILE="$HOME/.switchboard/operator-token"
```

The UI may cache that token in the browser for local mutation flows, but shell-based `doctor:*` and `doctor:preflight` commands still read `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` from the shell you launch them in.

Remote-trusted HTTPS launch:

```bash
export SWITCHBOARD_BROKER_HOST=0.0.0.0
export SWITCHBOARD_BROKER_PORT=7007
export SWITCHBOARD_ALLOW_REMOTE=1
export SWITCHBOARD_OPERATOR_TOKEN_FILE="$HOME/.switchboard/operator-token"
export SWITCHBOARD_TLS_CERT_FILE="/etc/letsencrypt/live/switchboard/fullchain.pem"
export SWITCHBOARD_TLS_KEY_FILE="/etc/letsencrypt/live/switchboard/privkey.pem"
npm run dev:broker:remote-trusted
```

Additional deployment guidance lives in [docs/DEPLOYMENT.md](/Users/mhedhli/Documents/Coding/Switchboard/docs/DEPLOYMENT.md), the operator dry-run steps live in [docs/OPERATOR-RUNBOOK.md](/Users/mhedhli/Documents/Coding/Switchboard/docs/OPERATOR-RUNBOOK.md), and the current release checklist lives in [docs/RELEASE-CHECKLIST.md](/Users/mhedhli/Documents/Coding/Switchboard/docs/RELEASE-CHECKLIST.md).

## License

Licensed under Apache-2.0. See `LICENSE` and `NOTICE`.
