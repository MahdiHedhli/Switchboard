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

This repository is currently a bootstrap skeleton. The code is intentionally thin while the object model, repo layout, and control-plane boundaries are being established.

A Codex handoff brief is included in `docs/CODEX-HANDOFF.md`.

## License

Licensed under Apache-2.0. See `LICENSE` and `NOTICE`.
