# QA / Smoketest runbook — Switchboard model selection

This runbook covers what to verify after the model-selection program
(slices 1–5 plus the catalog-wiring and timezone follow-ups) landed on `main`.
It assumes a normal local filesystem and `node >= 22`.

## 1. Clean-clone automated smoke (authoritative gate)

```bash
git clone https://github.com/MahdiHedhli/Switchboard.git
cd Switchboard
npm ci
npm run verify:control-plane     # typecheck + build + ~45 smokes; TZ-independent
npm run smoke:broker             # full broker HTTP boot test (not in verify)
```

`verify:control-plane` must exit 0. It no longer depends on the host timezone
(the codex/preflight doctor smokes pin TZ internally), so it passes under UTC.
`smoke:broker` boots a real broker over TLS and exercises the HTTP endpoints; it
prints nothing on success and exits 0.

## 2. Broker boot-up QA (dormant routing — expected)

```bash
npm run dev:broker
# then, against the printed origin:
curl -s $ORIGIN/v1/profiles
curl -s $ORIGIN/v1/projects/threatpedia/dashboard
curl -s $ORIGIN/v1/projects/threatpedia/adapters
```

Expected with the shipped catalog (intentionally all-placeholder):

- `dashboard.plan` resolves exactly as before — selection runs but routes
  nothing, because no catalog row is `active`. Seeded tasks carry no
  `taskClass`, so they pass through untouched.
- `adapters` lists `openai`, `anthropic`, `google`, and `xai`; the `xai` entry
  is `missing` until an `xai.json` snapshot exists.

## 3. End-to-end routing QA (activate a row)

Routing is dormant by design until an operator activates a catalog row. To
exercise real selection:

1. In `config/model-catalog.json`, pick a row that has a live quota snapshot,
   set a real `tier` (`heavy` | `standard` | `light`) and `status: "active"`.
   Validate it: `npm run doctor:model-catalog -- --strict` (expect `ready`).
2. Give the profile a task that declares a matching `taskClass` (the
   `threatpedia` profile already declares `article-draft`, `article-review`,
   `attribution`, `validation`). Create such a task via
   `POST /v1/projects/threatpedia/tasks`.
3. Re-fetch the dashboard: the task should now carry a reservation with
   `source: "selector"` for the cheapest capable available model, and the
   planner should mark it runnable (or blocked if the quota is insufficient).

**Guardrail:** never lower a judgment-heavy floor (e.g. `attribution`, which is
`heavy`) to route it to a cheaper/weaker model. That is a corpus-integrity risk,
not a cost optimization — see `docs/SELECTION.md`. Cost tuning belongs on
mechanical classes (`article-draft`, formatting).

## 4. xAI / Grok provider QA

The Grok sync wrapper mirrors the gemini wrapper's flag shape
(`-p`, `--output-format json`, `--approval-mode plan`); the real Grok CLI's
flags/output may differ and should be confirmed against an actual install.

```bash
# informational (no live probe): emits a schema-valid payload to stdout
node scripts/provider-sync/xai-grok-sync.mjs
# live probe against a real Grok CLI:
GROK_CLI_PATH=/path/to/grok SWITCHBOARD_XAI_LIVE_PROBE=1 node scripts/provider-sync/xai-grok-sync.mjs
# persist as a snapshot the adapter can read (mode 0600):
node scripts/provider-sync/xai-grok-sync.mjs > .switchboard/provider-snapshots/xai.json
chmod 600 .switchboard/provider-snapshots/xai.json
```

On a missing/timed-out CLI or a failed probe the wrapper degrades to an
`unavailable` account and never reads credential material. After writing a
secure snapshot, the `xai` adapter status should read `ready`.

## 5. Known scope / caveats

- The shipped catalog is all-placeholder, so live routing is dormant until a row
  is activated (§3). This is intentional — no tiers/prices are fabricated.
- The selector only acts on tasks that declare a `taskClass` or a `modelPin`;
  tasks with an explicit reservation or neither field pass through unchanged.
- A `validation`-style class with no `minimumTier` is skipped by the selector.
- The §9 timezone flake is fixed; no `TZ` export is required for the gate.
