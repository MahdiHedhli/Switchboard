# Autonomous improvement backlog

The twice-daily improvement loop (6am/6pm ET) reads this file, implements the
**top unchecked in-scope item** per run through the standard gate
(`verify:control-plane` green → branch → PR → squash-merge), and checks it off in
the same PR. When every item is checked — or the only ones left need operator
judgment — it escalates "backlog dry" via ntfy `Mahdi-Dev` and stops. It never
invents risky work, never expands scope, and never touches the out-of-scope list.

## In-scope queue (top = next)

- [x] **Add GitHub Actions CI.** `.github/workflows/ci.yml` running `npm ci` then
  `npm run verify:control-plane` on pull_request and pushes to `main`. There is
  currently no CI. Done when the workflow is present and green on its own PR.
- [x] **Gate the full broker HTTP smoke.** Today `verify:control-plane` only runs
  `smoke:broker-parse` (syntax). Add `smoke:broker` (or a dedicated CI job) so the
  live server boot is actually gated.
- [x] **Surface selection warnings in the dashboard.** Expose
  `SelectionResult.warnings` on `ProjectDashboardSnapshot` as a new optional field
  so operators see `selection_unresolved` / `selection_placeholder_skipped`. Update
  `dashboard-smoke`. Planner output must stay byte-for-byte.
- [x] **Selector edge-case smokes.** Add cases: hybrid-pricing rows, scarcity tie at
  equal fill ratio, equal `effectiveCost` across different tiers (tie-break proof).
- [ ] **README model-selection section.** A short section linking `docs/SELECTION.md`
  and `docs/QA-SMOKETEST.md`.

## Out of scope — escalate via ntfy, never do autonomously

- Activating catalog rows (assigning a tier / `status:active`) — operator judgment
  and a quality-floor decision.
- Lowering any judgment-heavy floor (e.g. `attribution: heavy`) — corpus-integrity
  hard stop; refuse by default.
- Repo settings, branch protection, secrets, force-push, history rewrite.
- Anything needing a spec decision or new public-API design without operator sign-off.
