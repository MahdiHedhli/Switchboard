# Codex Handoff

## Current state

The repository now includes:
- Apache-2.0 license and NOTICE file
- workspace root config
- shared core types in packages/core
- a broker scaffold in apps/broker
- a first UI scaffold in apps/switchboard-ui
- a Threatpedia project profile in profiles/threatpedia.json
- architecture notes in docs/ARCHITECTURE.md

## Product intent

Switchboard is a reusable local control plane for supervised multi-agent workflows.

Codex should act as Kernel Proxy under human supervision, not as the final trust anchor.

## Immediate next steps

1. Make the workspace install and build cleanly.
2. Improve TypeScript pathing between workspaces.
3. Add a small broker server surface.
4. Replace demo UI data with broker-fed mock JSON.
5. Add a simple persistence layer for tasks and subscription snapshots.
6. Add adapter directory structure for OpenAI, Anthropic, and Google CLI integrations.
7. Add a project profile loader and validator.

## Credit and subscription requirement

This stays in scope:
- the system needs to track available model choices across subscription-backed accounts
- remaining usage or credits should be visible to operators
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
