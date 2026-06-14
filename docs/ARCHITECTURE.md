# Switchboard Architecture

## Purpose

Switchboard is a local control plane for supervised multi-agent workflows.

The system is designed around four ideas:
- agents should collaborate through structured tasks and artifacts, not loose chat relays
- permissions should be explicit and project-aware
- planning should account for model availability and remaining subscription capacity
- operators need a visual routing layer, not just logs and prompts

## Repository layout

- `packages/core` contains shared types for tasks, roles, project profiles, subscriptions, model quotas, and reservations
- `apps/broker` contains the planning and orchestration surface
- `apps/switchboard-ui` contains the operator-facing visualization layer
- `profiles/` contains project packs and reusable project configuration
- `docs/` contains architecture and handoff materials

## Control-plane model

### Broker
The broker is deterministic. It owns:
- task intake
- task lifecycle transitions
- role selection
- permission checks
- model reservation checks
- scheduling decisions
- handoff and review state

### Agents
Agents are adapters, not the source of truth. Each agent receives a structured task and returns artifacts, notes, or diffs.

### Project profiles
Project profiles map the reusable control plane to a specific project. They define repos, roles, and later will define path permissions and workflow rules.

## Task lifecycle discipline

Tasks are durable control-plane records, not disposable chat messages.

That means task state should:
- carry creation and update timestamps
- move through explicit lifecycle transitions instead of arbitrary replacement
- require a blocked reason when a task is marked `blocked`
- allow narrow partial mutation routes instead of full task overwrites
- preserve operator intent in local state without persisting secrets

## Quota-aware planning

Switchboard must be able to reason about subscription capacity before it schedules work.

That means the planning model needs:
- provider and model availability
- a quantifiable remaining-capacity snapshot when possible
- a confidence score for the usage data source
- task-level reservations for expected consumption
- warnings when usage is unknown, stale, or likely insufficient

The MVP may rely on manually entered or inferred quota snapshots. The architecture intentionally supports provider-backed sync later.

## Credential and session handling

Switchboard should prefer subscription-compliant integrations over direct API-key handling.

That means the control plane should:
- reuse provider OAuth flows when available
- prefer trusted installed client wrappers when they can expose quota or execution surfaces without copying secrets into repo state
- persist only sanitized quota snapshots, opaque account identifiers, or local references
- keep raw OAuth tokens, session cookies, CLI credential caches, and raw provider usage exports out of git-backed configuration

API-key support is out of scope for the current MVP unless it is explicitly approved with separate secret-storage rules.

## Broker auth policy

The broker should expose mutation routes narrowly and predictably.

Current policy:
- loopback-only operation is the default
- `SWITCHBOARD_OPERATOR_TOKEN_FILE` is the preferred mutation-token path, with `SWITCHBOARD_OPERATOR_TOKEN` still available for reviewed shell-only cases
- healthy local-only shells using `SWITCHBOARD_OPERATOR_TOKEN_FILE` now preserve the same `ready` operator posture as env-token shells, while exposing only basename-safe token metadata such as `operatorTokenSource: file` and `operatorTokenFile: operator-token`
- the default reviewed token-file path is `$HOME/.switchboard/operator-token`, and the save flow re-applies owner-only permissions to both that file and the default `.switchboard` directory
- `SWITCHBOARD_OPERATOR_TOKEN` or `SWITCHBOARD_OPERATOR_TOKEN_FILE` enables routine mutation routes through token-gated access
- open loopback mutation access is reserved for explicit disposable development via `SWITCHBOARD_ALLOW_OPEN_LOOPBACK_MUTATIONS=1`
- non-local mutation routes stay disabled until a token is configured
- direct subscription replacement is disabled by default and only exists as an explicit recovery path
- the health surface should describe the active mutation policy without exposing local filesystem paths, while still surfacing sanitized token-source and token-wiring drift such as basename-only file labels or permission failures
- if the default `.switchboard` token directory drifts back to group- or world-accessible, broker health surfaces a sanitized `chmod 700` warning and the operator/preflight doctors fail closed until it is tightened again
- at the higher-level rollout layer, the combined `smoke:preflight` and `smoke:doctor-contracts` coverage now also proves both the healthy strict typed and healthy mixed `1/2` OpenAI provider-sync plus raw and wrapped Codex detail on reviewed local-only and remote-trusted shells, including nested `checkDetails.provider_sync` alignment for `provider`, `state`, `kind`, `configured`, `secure`, `codes`, `message`, `source`, `refreshedAt`, `syncMethods`, `accountCount`, `syncModes`, `syncBadges`, `rateLimitHosts`, and `openaiAuth`, richer raw `userAgent` / `accountType` / `plan` / `endpoint` fields, and wrapped `account` / `refreshedAt` / `refreshedDisplay` / `plan` / `credits` fields, so higher-level rollout posture stays aligned beyond the raw broker state and health helpers
- that lower-level `smoke:preflight-contract` path now also keeps the healthy OpenAI provider-sync contract aligned directly, so healthy `app-server rate-limits` rows stay clean on `syncBadges` while still preserving `openaiAuth: ['required']` on the typed and mixed trusted-command paths instead of relying on only the combined doctor stack to catch that drift
- that same low-level `smoke:preflight-contract` path now also keeps the malformed OpenAI trusted-command contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays `command_invalid` in `checkDetails.provider_readiness` and `checkDetails.provider_sync`, preserving readiness wiring like `source`, `configured`, `secure`, and `validated`, plus blocked sync `quotaCoverage: none` with zero quota counters
- direct `smoke:provider-readiness` now also keeps the malformed OpenAI trusted-command readiness contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:providers -- openai` output with `provider_command_invalid`, `state: command_invalid`, and the sanitized config message visible, while null `accounts`, null `lastModifiedAt`, and a redundant `problem:` row stay suppressed
- direct `smoke:provider-sync` now also keeps the malformed OpenAI trusted-command sync contract aligned directly, so a bad `SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON` stays fail-closed on both JSON and human `doctor:provider-sync -- openai` output with `provider_command_invalid`, `state: command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `quotaCoverage: none`, and zero quota counters visible, while null `accounts`, `refreshedAt`, and a redundant `problem:` row stay suppressed
- those higher-level human preflight provider sections now also preserve the direct provider doctor `message:` line plus nested readiness and sync detail such as readiness posture rows `source`, `configured`, `secure`, and `validated`, provider-sync wiring rows `state`, `source`, `configured`, and `secure`, and live sync detail like `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, and `openaiAuth`, instead of flattening that context back into only the one-line rollout summary. Degraded-path rows like `syncBadges` and `rateLimitHosts` stay visible there when they actually carry data, and the degraded local allow-fallback plus remote strict-fail trusted-command branches now also explicitly pin the fuller degraded provider-sync shape there, including `source`, `state`, `configured`, `secure`, `accounts`, `refreshedAt`, `syncMethods`, `syncModes`, `syncBadges`, `rateLimitHosts`, `openaiAuth`, and informational-only quota rows instead of only the message plus host/auth hints. On healthy trusted-command paths, that nested human preflight provider-sync output also keeps the direct quota rows visible, including `accounts: 1`, `syncModes: app-server-rate-limits`, and typed quota detail like `quotaCoverage: typed` with fully typed `typedQuotaModels: 2/2` or mixed `1/2`; the strict healthy raw and wrapped Codex sections now also keep the secondary `GPT-5.3-Codex-Spark` bucket/model visible with typed `2/2` coverage instead of leaving that fuller healthy shape pinned only to the direct doctor or JSON rollout surfaces. The higher-level JSON surface separately keeps `checkDetails.provider_readiness.provider`, `state`, `kind`, `accountCount`, `unvalidated`, and `codes` aligned with the top-level provider-readiness summary, and keeps `lastModifiedAt` aligned when that readiness freshness field exists
- that higher-level human mixed `1/2` rollout coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local file-backed and remote env/file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible beside the mixed provider-sync detail, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being proven only through JSON `checkDetails.provider_readiness`
- that higher-level human healthy strict typed rollout coverage now also explicitly pins the nested `Provider readiness (openai)` rows on the local env-token, local file-backed, remote env-token, and remote file-backed paths, so `state`, `source`, `configured`, `secure`, and `validated` stay visible on the ready strict rollout branches too, while null `accounts` and `lastModifiedAt` rows stay suppressed instead of being implied only by the message line or JSON `checkDetails.provider_readiness`
- that higher-level degraded preflight coverage now also explicitly pins the real degraded trusted-command sync mode too, so the local allow-fallback and remote strict-fail OpenAI branches keep `syncModes: app-server-account` alongside the fuller degraded provider-sync shape, instead of leaving the degraded live sync source implied by only host/auth and informational-only quota hints
- that higher-level blocked malformed-command preflight coverage now also explicitly pins the nested remote `Provider readiness (openai)` and `Provider sync (openai)` sections, so `state: command_invalid`, `codes: provider_command_invalid`, `source: SWITCHBOARD_OPENAI_REFRESH_COMMAND_JSON`, `configured: no`, and `secure: no` stay visible there too; blocked sync keeps `quotaCoverage: none` with zero quota counters, while null `accounts`, `lastModifiedAt`, `refreshedAt`, and redundant `problem:` rows stay suppressed instead of being implied only by the direct doctor or JSON summary
- the direct human Codex rollout surfaces now also preserve identity, freshness, wrapped `source:` rows, and healthy raw multi-bucket detail instead of collapsing back to only status text, so wrapped `doctor:codex` keeps `source:` plus `account:` and `refreshed:`, including `app-server rate-limits` on healthy paths and `app-server account` on degraded partial-app-server paths, while raw `doctor:codex-app-server` keeps `user agent:` alongside account, plan, auth, degraded host or endpoint hints, and fully typed secondary buckets when the upstream app-server returns them
- the machine-readable preflight Codex rows now preserve that same direct identity and freshness detail too: `checkDetails.raw_codex_app_server` carries raw `userAgent`, `accountType`, `plan`, and `endpoint`, while `checkDetails.codex_wrapper` carries wrapped `account`, `refreshedAt`, `refreshedDisplay`, `plan`, and `credits`
- the bind-free broker summary smokes now also cover degraded, mixed, and fully typed trusted-command OpenAI composition, so `smoke:dashboard`, `smoke:refresh`, and `smoke:refresh-snapshot` keep the healthy `app-server rate-limits available` wording plus the absence of redundant quota-warning text or extra quota pills aligned across the dashboard, adapter cards, and composed refresh payloads instead of only pinning degraded or partially typed cases. Healthy mixed trusted-command refresh and composed refresh-snapshot paths now also preserve `openaiAuth: ['required']` and the matching auth pill there instead of understating that bind-free path as auth-empty. The shared bind-free `subscription-sync` helper coverage now also matches that richer healthy path: when the account reports OpenAI auth is still required, the healthy fully typed trusted-command helper path keeps `openaiAuthRequired: true`, the matching `OpenAI auth required` pill, and grouped `openaiAuth: ['required']` state alongside the clean ready wording instead of implying that the fully typed path is auth-empty. The reviewed file-backed healthy mixed broker branches now also explicitly pin the clean trusted-command shape there with `syncBadges: []` and `rateLimitHosts: []` beside that auth signal, and they keep grouped account context like `accountDisplayNames`, `latestAccountRefreshedAt`, and `accountSyncMethods` aligned between refresh and dashboard provider summaries on both local and remote paths.

This is still an intermediate step toward fuller approvals, but it prevents the most obvious accidental remote write exposure.

## Adapter boundary

Provider integrations should enter the broker through adapters, not through ad hoc route logic.

The current adapter model:
- keeps one adapter boundary per provider
- supports sanitized local snapshot import first
- prefers a reviewed trusted-command bridge when a provider wrapper can emit sanitized JSON locally
- separates adapter refresh from persisted operator state
- allows mutation routes to remain narrow even as provider integrations grow
- keeps direct subscription replacement outside the normal refresh path

The next adapter phase is provider-specific live sync implementations on top of the same boundary, with the same secret-handling rules and stronger provenance checks.

## Visualization layer

The UI is not just an observer. It is the switchboard.

The first version should make these things visible together:
- task lanes by status
- assignee and role
- model reservations by task
- provider and model availability
- remaining subscription capacity
- planning warnings when credits are unknown or low

## Threatpedia adaptation

Threatpedia is the first serious project pack planned for Switchboard.

The public Threatpedia repo is the publication target.
The private Threatpedia working repo is the operational substrate.
Kernel K remains the human trust anchor.
Codex acts as Kernel Proxy under supervision.
