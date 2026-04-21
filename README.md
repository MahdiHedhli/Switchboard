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

## Initial direction

The first milestone is a reusable local scaffold with three major surfaces:
- `apps/broker` for orchestration, policy checks, and adapters
- `packages/core` for shared task, policy, and project profile types
- `apps/switchboard-ui` for the visual switchboard layer

Threatpedia is planned as the first serious project profile after the core scaffold is in place.

## Status

This repository is currently a bootstrap skeleton. The code is intentionally thin while the object model, repo layout, and control-plane boundaries are being established.

## License

Licensed under Apache-2.0. See `LICENSE` and `NOTICE`.
