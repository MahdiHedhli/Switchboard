# Autonomous improvement backlog

The twice-daily improvement loop (6am/6pm ET) reads this file, implements the
**top unchecked in-scope item** per run through the standard gate
(`verify:control-plane` green → branch → PR → squash-merge), and checks it off in
the same PR. When every item is checked — or the only ones left need operator
judgment — it escalates "backlog dry" via ntfy `Mahdi-Dev` and stops. It never
invents risky work, never expands scope, and never touches the out-of-scope list.

## In-scope queue (top = next)

### UI hardening track — gates human testing (do in order)

The dashboard UI must be feature-current, **smoke-tested, and UI/UX-tested before
any human test pass.** Work these top-down; each is one PR.

- [ ] **1. Surface model-selection results in the dashboard UI.** In
  `apps/switchboard-ui`, render the snapshot's `selectionWarnings`; show each
  reservation's `source` (selector / pin / explicit); show a task's `taskClass` and
  `modelPin`; add a read-only catalog panel (provider/modelId, tier,
  active|placeholder) from `/v1/projects/{id}/dashboard` + `/adapters`. Done when the
  UI renders all of these.
- [ ] **2. Automated UI smoke test.** Add a UI test runner (vitest +
  @testing-library/react + jsdom; commit the package.json/package-lock additions as
  part of this item). Render `<App/>` against a representative mocked dashboard
  payload and assert the core sections plus the selection fields from item 1 render
  without error. Add `npm run test:ui` and wire it into `verify:control-plane` and CI.
  Done when `test:ui` is green and gated.
- [ ] **3. UI/UX end-to-end test.** Add a headless Playwright e2e that boots the
  broker, serves the built UI, and walks the operator flow (load dashboard → see
  plan / providers / selection warnings → create a task → see it appear), plus an
  axe-core accessibility check on the main view. Add a CI job running it headless (no
  desktop browser required). Done when the e2e + a11y checks pass in CI.
- [ ] **4. UI/UX review pass.** Capture findings in `docs/UI-UX-REVIEW.md` —
  layout/responsive at common widths, keyboard/focus order, color contrast, and
  empty/error/loading states — and fix mechanical issues; escalate anything needing
  product/visual judgment. Done when the doc exists and mechanical fixes are merged.

> **Human-test gate:** the dashboard is NOT human-test-ready until items 1–4 are all
> checked and green in CI. The hands-on human pass is the operator's; the loop never
> performs it — once 1–4 are green, escalate "dashboard ready for human test" via ntfy.

### Other

- [ ] **README model-selection section.** A short section linking `docs/SELECTION.md`
  and `docs/QA-SMOKETEST.md`.

## Completed

- [x] GitHub Actions CI — `.github/workflows/ci.yml` runs `verify:control-plane` (#12).
- [x] Live broker HTTP smoke gated via a dedicated CI job (#13).
- [x] Surface selection warnings on the dashboard snapshot (#14).
- [x] Selector edge-case smokes — hybrid pricing, scarcity tie, cross-tier cost tie (#15).

## Out of scope — escalate via ntfy, never do autonomously

- Activating catalog rows (assigning a tier / `status:active`) — operator judgment
  and a quality-floor decision.
- Lowering any judgment-heavy floor (e.g. `attribution: heavy`) — corpus-integrity
  hard stop; refuse by default.
- Repo settings, branch protection, secrets, force-push, history rewrite.
- Anything needing a spec decision or new public-API design without operator sign-off.
- The hands-on human test pass itself (operator-only).
