# Production Plan

## Goal

Take Switchboard from a validated scaffold to a production-ready local control plane that can safely broker multi-agent work, surface operator state, and support subscription-backed providers without persisting raw secrets.

## Release stages

### Stage 0: Foundation hardening

Exit criteria:
- dependency versions are pinned
- root verification runs `typecheck`, `build`, and `audit`
- broker state lives under ignored local storage only
- local services bind to loopback by default

Status:
- complete enough to build on

### Stage 1: Local broker MVP

Exit criteria:
- broker exposes health, profile, state, and dashboard APIs
- profiles are validated before use
- tasks and sanitized subscription snapshots persist locally
- planner warnings are included in dashboard responses

Status:
- complete enough to build on

### Stage 2: Operator UI on live broker data

Exit criteria:
- UI no longer depends on hard-coded demo arrays
- UI reads broker-fed dashboard data in dev and production-like setups
- broker errors and planning warnings are visible to operators

Status:
- complete enough to build on

### Stage 3: Adapter and quota sync rollout

Exit criteria:
- adapter boundaries exist for OpenAI, Anthropic, and Google
- subscription-backed OAuth or trusted installed-client flows are preferred
- raw OAuth tokens, cookies, and provider exports stay out of git-backed state
- quota refresh paths distinguish trusted sync from manual snapshots

Status:
- in progress

Current progress:
- snapshot-backed refresh is working
- trusted-command refresh can now bridge to reviewed local wrappers that emit sanitized JSON
- a first OpenAI/Codex supervisor wrapper is working on top of that bridge
- the Codex wrapper now uses the reviewed local app-server rate-limit surface for plan type, credit metadata, and 5-hour/weekly budget windows
- source, plan, and credit metadata now surface separately from quota-row notes
- percentage-window data is now marked as advisory so the planner warns instead of treating it like raw credits
- remaining follow-up is validating Codex app-server availability across interactive and non-interactive launch contexts and preserving visible fallback diagnostics when typed rate-limit data is unavailable
- partial app-server success now preserves typed account metadata even when rate-limit fetch fails

### Stage 4: Production operations

Exit criteria:
- repeatable smoke tests cover broker health, profile loading, persistence, and UI fetch paths
- deployment model is documented for local-only versus remote-trusted environments
- remote-trusted startup fails closed unless direct HTTPS material is present
- upgrade policy enforces the 30-60 day soak window unless a reviewed security fix needs faster adoption
- release checklist exists for dependency review, security review, and rollback

Status:
- in progress

Current progress:
- direct Codex wrapper coverage now exists without requiring broker port binds
- operator-token persistence now has a first-class private-file path, and remote-trusted broker startup now requires direct HTTPS material instead of relying on plaintext non-loopback binds
- broker health and the Operator session now also surface transport posture, so remote-trusted HTTPS state is visible in the product surface instead of only through startup commands
- the wrapper smoke path now validates fully typed app-server snapshots, healthy partially typed app-server snapshots, partial app-server account-only snapshots, and the sanitized login-status fallback
- the Codex doctor smoke path validates allow-fallback and require-rate-limits behavior against those same wrapper scenarios
- the direct Codex app-server doctor smoke path validates raw upstream success, usage-endpoint degradation, and app-server-unavailable cases
- the shared Codex app-server diagnostics helper now has direct smoke coverage so wrapper and raw doctor degradation labels stay aligned
- a live Codex doctor command now summarizes whether the current shell has full rate-limit windows, partial account context, or login fallback
- a preflight doctor now combines operator readiness, raw Codex app-server diagnostics, and wrapper Codex checks so rollout-time shells can be validated in one command
- that preflight path now emits a one-line rollout verdict so degraded-but-acceptable shells are easier to distinguish from blocked ones
- that preflight path now uses machine-readable Codex doctor summaries internally instead of parsing human-oriented output, reducing rollout-classification drift as doctor wording evolves
- operator readiness and preflight now expose optional JSON output so future rollout automation can consume the same checks without scraping terminal text
- the direct operator doctor JSON now also carries stable `verdict`, `failureCodes`, `advisoryCodes`, `message`, and `problems` fields so rollout tooling can consume operator-readiness failures without relying on stderr parsing
- blocked direct operator runs now also exit cleanly from that structured summary instead of reflecting a Node assertion stack trace
- the raw and wrapped Codex doctors now expose the same optional JSON output, so automation can query each rollout surface directly instead of parsing human-oriented diagnostics
- those direct raw and wrapped Codex doctor JSON surfaces now also carry stable `verdict`, `failureCodes`, `advisoryCodes`, and `message` fields in addition to the existing state/status data, and those top-level `message` fields now preserve rate-limit or quota quality for degraded, mixed, and fully typed healthy states such as `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, `partial app-server context (...) [quota informational_only, typed 0/1]`, or `full rate-limits available [quota mixed, typed 1/2]`
- those rollout doctor JSON surfaces now include a shared schema version so automation can gate on intentional contract changes
- the raw and wrapped Codex doctor JSON surfaces now also expose stable degraded-state enums, so automation can react to usage-endpoint failures without parsing human status copy
- the human `doctor:preflight` Codex sections now also preserve the same direct raw and wrapped `verdict`, `message`, and code detail, and they now render raw `rateLimitDetails` plus wrapped `quotaDetails` as explicit window rows, so operator terminal output stays aligned with the rollout JSON contract
- those human `doctor:preflight` Codex sections now also preserve the same identity, freshness, and wrapped `source:` rows as the direct doctors, so wrapped preflight output keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw preflight output keeps `user agent:` alongside account, plan, auth, and degraded host or endpoint hints
- direct Codex doctor fallback failures now also sanitize local CLI spawn detail, so missing-wrapper or bad local wiring cases stay actionable without echoing filesystem paths through `doctor:codex`, `doctor:codex-app-server`, or `sync:codex`
- preflight now also treats any wrapped Codex result with `ok=false` as degraded, so future unknown wrapper-source states cannot slip through as false green rollout results.
- preflight JSON now also exposes stable failure and advisory code arrays plus `readyChecks`, `attentionChecks`, `blockedChecks`, `checkStates`, `checkCodes`, `checkMessages`, and structured `checkDetails`, so automation can stay at the top level longer before unpacking nested provider or Codex data. That now includes operator auth posture in `checkDetails.operator`, not just provider and Codex state.
- those preflight `checkMessages.raw_codex_app_server` and `checkMessages.codex_wrapper` entries now also preserve the richer direct raw and wrapped Codex `message` fields, so automation can see notes like `Codex app-server could not start.`, `usage endpoint unavailable via chatgpt.com [rate-limits none]`, `available [rate-limits mixed, typed 1/2]`, `available`, or `full rate-limits available [quota mixed, typed 1/2]` without unpacking `checkDetails`.
- those preflight `checkDetails` entries for `raw_codex_app_server` and `codex_wrapper` now also preserve the nested direct Codex doctor `verdict`, `failureCodes`, `advisoryCodes`, and `message` fields, and they now also carry the direct raw/wrapped identity rows that rollout automation cares about: raw `userAgent`, `accountType`, `plan`, and `endpoint`, plus wrapped `account`, `refreshedAt`, `refreshedDisplay`, `plan`, and `credits`.
- the shared preflight contract logic now has direct smoke coverage, so verdict and code-array semantics can drift less easily than if they were tested only through the full doctor pipeline; that low-level preflight smoke now also keeps the healthy OpenAI provider-sync contract aligned, so healthy `app-server rate-limits` rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths
- that same low-level `smoke:preflight-contract` path now also keeps the malformed OpenAI trusted-command contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays `command_invalid` in `checkDetails.provider_readiness` and `checkDetails.provider_sync`, preserving readiness wiring like `source`, `configured`, `secure`, and `validated`, plus blocked sync `quotaCoverage: none` with zero quota counters
- the higher-level `smoke:preflight` and `smoke:doctor-contracts` coverage now also explicitly proves the healthy mixed `1/2` OpenAI provider-sync plus raw and wrapped Codex detail on both local-only and remote-trusted `SWITCHBOARD_OPERATOR_TOKEN_FILE` shells, including the richer nested raw `userAgent` / `accountType` / `plan` / `endpoint` fields and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, so reviewed file-backed operator rollout stays aligned in the human and JSON preflight surfaces too
- provider readiness now has a direct doctor and smoke path, so trusted-command wiring and sanitized snapshot validity can be checked independently of the broker process
- provider readiness JSON now also exposes a top-level `message` plus stable failure/advisory codes, provider lists, and per-provider `providerStates`, `providerKinds`, `providerSources`, `providerConfigured`, `providerSecure`, `providerValidated`, `providerLastModifiedAt`, `providerAccountCounts`, `providerCodes`, and `providerMessages`, so automation can react to blocked or incomplete provider setup without scanning every provider row
- the human `doctor:providers` output now also prints that same top-level `message:` line before the per-provider rows, so trusted-command-ready, snapshot-missing, and blocked snapshot/config states stay visible without switching to JSON
- on the inferred local OpenAI bridge path used by local-only broker defaults, those direct provider doctor messages now stay explicit too: healthy `doctor:providers -- openai` output reads `trusted_command_ready (unvalidated)`, and healthy `doctor:provider-sync -- openai` output reads `app-server rate-limits available`
- that inferred local bridge can still present as a split preflight result in real rollout shells: provider readiness remains `trusted_command_ready (unvalidated)` while provider sync degrades to `partial app-server context ... [quota informational_only, typed 0/1]` when command wiring is healthy but upstream OpenAI/Codex rate-limit windows are still unavailable
- the reviewed broker launchers now also keep startup behavior operator-visible in a safe way: the local launcher prints one sanitized notice when it infers the repo-owned OpenAI bridge instead of echoing local command paths, the remote-trusted launcher falls back to `$HOME/.switchboard/operator-token` when `SWITCHBOARD_OPERATOR_TOKEN_FILE` is unset, that default token-save path is auto-hardened while custom `--file` directories stay caller-managed, broker health surfaces a sanitized warning while the operator and preflight doctors fail closed if that default `.switchboard` token directory drifts back to group- or world-accessible, and both launcher files are now safe to import as helpers without accidentally starting a broker bind
- trusted-command providers now also expose an explicit unvalidated advisory in provider readiness, keeping config-only success distinct from live command execution
- the broker `/adapters` payload now also carries an explicit adapter `status`, so UI and future tooling do not need to infer `ready_with_advisories` from `configured`, `secure`, and advisory-code combinations
- that `/adapters` payload also keeps trusted-command `source` details sanitized to the env key plus a coarse command summary, so operator surfaces do not leak raw local wrapper paths or malformed env payloads
- adapter-status classification now also has a direct bind-free smoke path, so the broker/UI `/adapters` contract is covered independently of the lower-level adapter boundary tests
- the `/adapters` route now also has a composed broker helper plus its own bind-free smoke path, so the shared response wrapper is covered independently of the live server path
- broker subscription-refresh conflicts now also sanitize raw trusted-command stderr, local wrapper paths, and spawn details before they are reflected back to API clients
- `doctor:provider-sync` and preflight now also sanitize blocked trusted-command failure detail, so rollout/operator summaries stay actionable without echoing raw stderr or local wrapper paths
- the one-line preflight summary now also preserves that sanitized blocked provider-sync detail instead of collapsing it back to a generic `provider sync=blocked`
- blocked provider-readiness now also preserves safe snapshot/config detail in `doctor:providers` and shared preflight summaries instead of flattening back to generic `snapshot_invalid` or `command_invalid` labels
- direct `smoke:provider-readiness` now also explicitly pins the malformed OpenAI trusted-command path, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:providers -- openai` output with `provider_command_invalid`, `state: command_invalid`, and the sanitized config message visible, while null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row stay suppressed
- direct `smoke:provider-sync` now also explicitly pins the malformed OpenAI trusted-command path, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:provider-sync -- openai` output with `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, and zero quota counters visible, while null `accounts`, `refreshedAt`, and a redundant `problem:` row stay suppressed
- invalid trusted-command wiring now also blocks provider sync with the same sanitized config detail, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` no longer leaves preflight implying that provider sync is still `ready`
- the `/v1/profiles` route now also has a composed broker helper plus its own bind-free smoke path, so the shared profile-list response wrapper is covered independently of the live server path
- that list route now returns summary-only project metadata with `repoCount` and `roleCount`, keeping repo paths and full role definitions out of the project-selection surface
- the raw `/v1/projects/:id/state` route now also has a composed broker helper plus its own bind-free smoke path, so project-scoped state is covered independently of the transformed dashboard path
- the raw `/v1/projects/:id/tasks/:taskId` route now also has a composed broker helper plus its own bind-free smoke path, so task detail is covered independently of project-state and dashboard payloads
- the subscription-refresh response now also has a composed broker helper plus its own bind-free smoke path, so the combined dashboard-plus-refresh payload is covered independently of the live route
- profile-loader and persisted-state validation now use logical context labels instead of absolute filesystem paths, so malformed local profile/state files do not disclose directory layout through broker-facing error detail
- broker error payloads now also use a shared typed helper, and `internal_error` no longer reflects raw exception text back to clients
- malformed JSON, wrong content type, oversized bodies, empty JSON bodies, and request-shape validation now return safe `bad_request` details through shared streamed request-body helpers plus prefix-scoped parsing rules instead of broad string matching that could misclassify unrelated internal errors
- broker route matching now uses an exact shared contract helper, so extra segments like `/tasks/:id/extra` or `/subscriptions/refresh/extra` no longer get accepted accidentally, and `/subscriptions` now advertises only `PUT` while `/subscriptions/refresh` advertises only `POST`
- the unrestricted `scripts/broker-smoke.mjs` expectations are now aligned with that contract too, including precise `Allow` headers, `404` rejection for extra task/refresh path segments, healthy fully typed, healthy mixed, and degraded authorized OpenAI refresh responses, and persisted OpenAI state checks through `/dashboard`, raw `/state`, and the on-disk `threatpedia.json` state file with `0600` permissions for the healthy fully typed, healthy mixed, and degraded partial-app-server paths on the local and remote file-backed operator-token branches, but it still needs an environment that permits local port binds
- broker mutation authorization now also has a shared response-mapping helper, so the server-side `401` vs `403` payload contract stays aligned with auth-policy decisions without depending only on the unrestricted broker smoke
- broker exception handling now also has a shared failure-response helper, so task/store conflicts, adapter refresh conflicts, bad-request classification, and generic `internal_error` responses stay aligned without depending only on the unrestricted broker smoke
- broker profile lookup now also has a shared resolution helper, so the exact `Unknown project profile "..."` contract stays aligned without depending only on the unrestricted broker smoke
- broker JSON response headers now also have a shared envelope helper, so `Content-Type`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Allow` header behavior stay aligned without depending only on the unrestricted broker smoke
- provider sync now also has a direct live doctor and smoke path, so the same adapter refresh path the broker uses can be exercised without starting the broker or UI
- provider sync JSON now also exposes a top-level `message` plus per-provider `providerStates`, `providerKinds`, `providerSources`, `providerConfigured`, `providerSecure`, `providerAccountCounts`, `providerRefreshedAt`, `providerCodes`, `providerMessages`, `providerAccountSyncMethods`, `providerSyncModes`, `providerSyncBadges`, `providerRateLimitHosts`, and `providerOpenaiAuth`, so automation can tell whether a live refresh is healthy, degraded, blocked, or still running on older persisted account state without unpacking each nested provider entry
- that direct provider-sync `message` now also preserves provider quota-quality detail for informational-only and mixed live refresh states, so rollout tooling can consume strings like `... [quota informational_only, typed 0/1]` or `... [quota mixed, typed 1/2]` without rebuilding them from separate coverage fields
- the human `doctor:provider-sync` output now also prints that same top-level `message:` line before the provider rows, so snapshot-backed, degraded, and partially typed live refresh states stay readable without switching to JSON
- the human `doctor:codex-app-server` and `doctor:codex` outputs now also print their top-level `message:` line before the detail rows, so healthy, degraded, and blocked direct Codex states stay readable without switching to JSON
- those human direct Codex outputs now also preserve the surrounding identity and freshness rows instead of collapsing back to only status text, so wrapped `doctor:codex` keeps `account:` plus `refreshed:` while raw `doctor:codex-app-server` keeps `user agent:` alongside account, plan, auth, and degraded host or endpoint hints
- preflight now also preserves that richer provider-sync text in `checkDetails.provider_sync.message`, so the nested preferred-provider view stays self-describing for degraded and mixed quota states
- provider sync JSON now also exposes per-provider `providerQuotaCoverage`, `providerQuotaModelCounts`, and `providerTypedQuotaModelCounts`, and preflight preserves the preferred-provider view in `checkDetails.provider_sync`, so rollout automation can tell whether a live provider refresh produced typed quota windows or only informational fallback metadata
- the human `doctor:provider-sync` and `doctor:preflight` provider-sync sections now also print provider `quotaCoverage` plus typed/total quota-model counts, preserve direct usage-signal rows like `openaiAuth`, and keep degraded-path rows like `rateLimitHosts` visible when they actually carry data, so terminal rollout checks can distinguish typed quota windows from informational-only fallback metadata, host-specific degradation, or auth-required app-server paths without switching to JSON. On healthy typed and mixed trusted-command paths, empty `rateLimitHosts` and empty `syncBadges` stay suppressed so the human output does not invent noisy placeholder rows
- preflight `--json` now also preserves the same typed-vs-total count detail for the direct raw and wrapped Codex sections in `checkDetails.raw_codex_app_server` and `checkDetails.codex_wrapper`, so rollout automation does not have to infer that from coverage strings alone
- snapshot-backed provider-sync success now also emits `provider_snapshot_only`, so live rollout automation can distinguish snapshot-only refresh from trusted-command execution without treating both as identical green paths
- preflight now preserves that difference in its top-level messaging too, so snapshot-only provider sync can remain `ready` while still surfacing the actual advisory detail such as `provider sync=snapshot-backed refresh (advisory)`
- when provider sync is fully healthy, the one-line preflight summary now also preserves the live ready message such as `provider sync=app-server rate-limits available` instead of omitting provider sync entirely from the healthy path
- the healthy-path one-line preflight summary now also preserves explicit raw/wrapped Codex ready detail like `raw Codex status=available` and `wrapper status=full rate-limits available` instead of collapsing back to a generic success sentence
- that one-line preflight summary now also preserves wrapped Codex quota-quality detail when the wrapper is non-typed or only partially typed, and raw Codex rate-limit-quality detail when the app-server is degraded, mixed, or fully typed, so rollout output can surface notes like `wrapper status=... [quota informational_only, typed 0/1]`, `wrapper status=full rate-limits available [quota mixed, typed 1/2]`, `raw Codex status=... [rate-limits none]`, `raw Codex status=available [rate-limits mixed, typed 1/2]`, or the clean fully typed `raw Codex status=available` path without opening the detailed section or JSON
- that one-line preflight summary now also preserves provider-sync message plus quota-quality detail when a live refresh is degraded or only partially typed, so rollout operators can see notes like `provider sync=... [quota informational_only, typed 0/1]` or `provider sync=app-server rate-limits available [quota mixed, typed 1/2]` without opening the detailed sections or JSON
- that higher-level preflight coverage now explicitly includes the healthy strict typed paths too: local env-token shells, local file-backed operator-token shells, and remote file-backed operator-token shells now all keep `checkDetails.provider_sync` aligned with the top-level preferred-provider summary for `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, not just the mixed or degraded branches
- that higher-level human mixed `1/2` preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local file-backed and remote env/file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` remain visible beside mixed provider-sync detail, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being proven only through JSON `checkDetails.provider_readiness`
- that higher-level human healthy strict typed preflight coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local env-token, local file-backed, remote env-token, and remote file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` remain visible on the ready strict rollout branches too, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being implied only by the message line or JSON `checkDetails.provider_readiness`
- that higher-level degraded preflight coverage now also explicitly pins the real degraded trusted-command sync mode too, so the local allow-fallback and remote strict-fail OpenAI branches keep `syncModes: app-server-account` alongside the fuller degraded provider-sync shape, instead of leaving the degraded live sync source implied by only host/auth and informational-only quota hints
- that higher-level blocked malformed-command preflight coverage now also explicitly pins the nested remote `Provider readiness (openai)` and `Provider sync (openai)` sections, so `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no` remain visible there too; blocked sync keeps `quotaCoverage: none` with zero quota counters, while null `accounts`, `lastModifiedAt`, `refreshedAt`, and redundant `problem:` rows stay suppressed instead of being implied only by the direct doctor or JSON summary
- those top-level preflight `checkMessages` now also preserve readable provider advisory detail when it exists, so `trusted_command_ready (unvalidated)` or `snapshot-backed refresh (advisory)` do not get flattened back into advisory code strings
- the one-line preflight summary now also preserves readable provider-readiness detail, including `trusted_command_ready (unvalidated)` and snapshot-missing states, instead of flattening it back to generic advisory or `attention_required` wording
- the one-line preflight summary now also preserves healthy operator posture such as `operator=local-only, host=127.0.0.1` or `operator=remote-trusted, host=0.0.0.0`, so the top-line rollout state stays self-contained even when operator readiness is green
- preflight now also keeps running after operator-readiness failure, so blocked shells still emit a full rollout summary with operator, provider, raw app-server, and wrapper findings instead of stopping at the first assertion
- the human `doctor:operator` and `doctor:preflight` operator sections now also print the direct operator `message:` line before the detail rows, so healthy and blocked operator posture stays readable without switching to JSON
- healthy local-only shells now also preserve basename-safe token-file detail when they use `SWITCHBOARD_OPERATOR_TOKEN_FILE`: direct and preflight operator output stays `ready`, keeps `operatorTokenSource: file`, shows `operatorTokenFile: operator-token`, and preserves the same `local-only; host=127.0.0.1` summary text as the env-token baseline
- conflicting `SWITCHBOARD_OPERATOR_TOKEN` plus `SWITCHBOARD_OPERATOR_TOKEN_FILE` wiring now also surfaces as an explicit fail-closed operator state in both direct and preflight doctor output: `operatorTokenSource` stays visible, but `operatorTokenConfigured` drops to `false` and mutation scopes fall back to `open` until the conflict is resolved
- local-only shells with no exported `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` now also surface as an explicit fail-closed operator state in both direct and preflight doctor output: the operator `message` becomes `Local-only mode should set SWITCHBOARD_OPERATOR_TOKEN.`, `operatorTokenSource` reports `unset`, and mutation scopes remain `open` until shell-side token wiring is configured
- the human `doctor:preflight` provider sections now preserve that same readable per-provider detail too, and they now also print the direct provider doctor `message:` line before the per-provider rows, so CLI output no longer falls back to raw states like `trusted_command_degraded` when a clearer provider message is available
- those nested preflight provider sections now also mirror the direct provider doctors more fully, preserving readiness posture rows like `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows like `state`, `source`, `configured`, and `secure`, and live sync detail such as `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth` instead of flattening that context back into only the summary line. Degraded-path rows like `syncBadges` and `rateLimitHosts` stay visible there when they actually carry data, and the degraded local allow-fallback plus remote strict-fail trusted-command branches now also explicitly pin the fuller degraded provider-sync shape there, including `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows instead of only the message plus host/auth hints. On healthy trusted-command paths, that nested human preflight provider-sync output also keeps the direct quota rows visible, including `accounts: 1`, `syncModes: app-server-rate-limits`, and typed quota detail like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`; the strict healthy raw and wrapped Codex sections now also keep the secondary `GPT-5.3-Codex-Spark` bucket/model visible with typed `2/2` coverage instead of leaving that fuller healthy shape pinned only to the direct doctor or JSON rollout surfaces. The higher-level JSON surface separately keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists
- planner warnings now also carry structured provider-sync detail, so the live dashboard path can surface the same degraded or snapshot-backed Codex/OpenAI provider, mode, host, auth, and sync-source hints as the doctor tooling
- broker dashboard snapshots now also carry grouped `providerSummaries`, so the UI can consume provider-level sync, account sync method, and account context from broker output instead of recomputing that view from raw subscription rows
- successful-but-degraded OpenAI/Codex refresh now shows up as `attention_required` in the live provider-sync doctor, keeping wrapper execution separate from truly healthy rate-limit-window access
- rollout preflight now nests the direct `openai` provider readiness and live provider sync summaries, so broker-side OpenAI setup, one adapter refresh, and Codex shell health can be validated in one machine-readable rollout surface
- the rollout doctor JSON contracts now have direct combined smoke coverage, so `doctor:preflight` stays aligned with the direct raw, wrapped, and operator doctor surfaces
- degraded Codex rollout diagnostics now preserve the same sanitized upstream host hint as the UI/planner warnings, so rollout and product surfaces stay aligned
- the raw app-server doctor now carries that sanitized host hint too, so both raw and wrapped rollout diagnostics stay equally actionable when the upstream failure is endpoint-specific
- degraded Codex sync paths now surface through dashboard warnings and operator UI cards instead of hiding in account signals alone
- degraded Codex sync warnings now preserve a sanitized upstream host hint so the product surface can say which usage host is failing, not just that the sync is degraded
- planner smoke coverage now exists without requiring broker port binds and verifies advisory windows, low quota, and unavailable models
- dashboard composition smoke coverage now exists without requiring broker port binds and verifies that approval gating, degraded provider-sync warning detail, healthy partially typed quota detail, and healthy fully typed trusted-command summaries with clean `app-server rate-limits available` wording survive the composed broker payload without redundant quota-warning text
- broker health composition smoke coverage now exists without requiring broker port binds and verifies that auth policy stays visible without leaking token material or local filesystem paths
- broker runtime-config coverage now exists without requiring broker port binds and verifies token-file permission handling, basename sanitization, TLS reporting, and fail-closed remote startup
- broker refresh composition smoke coverage now exists without requiring broker port binds and verifies that successful-but-degraded, healthy partially typed, and healthy fully typed trusted-command provider refreshes keep sync mode, badge, host, auth, and quota-quality detail such as `informational_only` with typed `0/1`, `mixed` with typed `1/2`, or clean `app-server rate-limits available` output on the composed response; healthy mixed trusted-command refresh and composed refresh-snapshot paths now also preserve `openaiAuth: ['required']` and the matching auth pill there instead of understating that path as auth-empty, and the reviewed file-backed healthy mixed broker branches explicitly pin the clean trusted-command shape with `syncBadges: []` and `rateLimitHosts: []` beside that auth signal
- provider refresh wording now also uses the same shared sync-summary formatter as the live provider-sync doctor, so healthy, snapshot-backed, and degraded OpenAI/Codex refresh status stays aligned across operator and rollout surfaces
- the quota-refresh adapter cards now also use that shared sync-summary formatter on top of broker-composed `providerSummaries`, so operators can see degraded live sync state, host/auth hints, healthy partially typed quota detail such as `mixed` with typed `1/2`, healthy fully typed trusted-command summaries that stay clean without redundant quota-warning text, and snapshot-backed or persisted account sync source directly at the provider refresh control instead of only in downstream subscription or toast surfaces
- those quota-refresh adapter cards now also distinguish config-only trusted-command wiring from proven live refresh, so a reviewed wrapper can show `ready with advisories` until this view has actually seen a successful provider refresh
- provider refresh summaries now also preserve account display names, latest account refresh timestamps, and grouped account sync methods, so operator-facing refresh feedback can identify the concrete subscription account being acted on and how that account state was sourced instead of only reporting provider-level counts; the reviewed file-backed healthy mixed broker branches now also explicitly pin that grouped account context on both local and remote paths, keeping `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned between refresh and dashboard provider summaries
- shared subscription-sync coverage now exists so wrapper, planner, and UI degradation states stay aligned without relying on incidental higher-level tests, and it now also directly proves both healthy mixed provider summaries such as typed quota `1/2` and healthy fully typed trusted-command summaries from real account quota rows; that healthy fully typed helper path now also explicitly keeps the auth-bearing shape when the account reports it, preserving `openaiAuthRequired: true` plus the matching `OpenAI auth required` pill and grouped `openaiAuth: ['required']` state alongside the clean `app-server rate-limits available` wording
- constrained environments now have a first-class `verify:control-plane` path for typecheck/build plus bind-free smoke coverage, and it now also syntax-checks the unrestricted `scripts/broker-smoke.mjs` source so broker HTTP smoke edits do not go entirely unverified when local binds are unavailable
- profile-loader fixture coverage now exists for valid profiles, duplicate ids, unknown keys, and empty role/responsibility failures
- auth-policy matrix coverage now exists for loopback, remote, token-gated, and manual-replace cases without broker port binds
- operator readiness coverage now exists for the documented local-only and remote-trusted deployment baselines without broker port binds
- state-store coverage now exists for private file permissions, task lifecycle conflicts, and provider-scoped subscription replacement without broker port binds
- adapter boundary coverage now exists for sanitized payload parsing, trusted-command failures, and insecure snapshot rejection without broker port binds
- task-level approval metadata now exists with planner gating and execution-state enforcement for unapproved queued or planned work
- approval history now records local request, approval, and reset-to-pending events without introducing a full identity system yet

## Current execution focus

1. Verify Codex app-server availability across interactive and non-interactive launch contexts, then extend provider-specific wrapper integrations on top of the trusted-command bridge where safe and reviewed.
2. Evolve the scoped auth policy into fuller approval and review workflows where operator trust needs to be explicit.
3. Dry-run the operator runbook and release checklist against the first local-only and remote-trusted deployment candidates.
