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
- role selection
- permission checks
- model reservation checks
- scheduling decisions
- handoff and review state

### Agents
Agents are adapters, not the source of truth. Each agent receives a structured task and returns artifacts, notes, or diffs.

### Project profiles
Project profiles map the reusable control plane to a specific project. They define repos, roles, and later will define path permissions and workflow rules.

## Quota-aware planning

Switchboard must be able to reason about subscription capacity before it schedules work.

That means the planning model needs:
- provider and model availability
- a quantifiable remaining-capacity snapshot when possible
- a confidence score for the usage data source
- task-level reservations for expected consumption
- warnings when usage is unknown, stale, or likely insufficient

The MVP may rely on manually entered or inferred quota snapshots. The architecture intentionally supports provider-backed sync later.

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
