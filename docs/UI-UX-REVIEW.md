# Dashboard UI/UX review

Covers the Switchboard operator dashboard (`apps/switchboard-ui`). Two parts: a
**real-world functional usage test** of every control, and a **UX/visual review**
that drove the redesign in `src/styles.css`. Performed against a live broker
(`SWITCHBOARD_ALLOW_OPEN_LOOPBACK_MUTATIONS=1`, seeded state) with the UI driven
in a real browser.

## 1. Functional usage test — every control

Each interactive control was exercised end to end and observed (DOM + network +
broker state). All pass or behave as intended.

| Flow / control | Result |
| --- | --- |
| Initial load + render (all panels, real data) | ✅ no errors; console clean |
| Create task — happy path (title/description/priority/role) | ✅ `POST` 201, task appears, form resets |
| Priority + Role `<select>` | ✅ drive state (verified `p0` / `penfold` on the created task) |
| Create task — validation (empty fields) | ✅ "New tasks need a title, description, and role."; no task created |
| Approval checkbox (create form) | ✅ reveals the approval-note field |
| Task status `<select>` + Save — valid transition | ✅ `PATCH`, task moves lane |
| Task status — illegal transition (queued→review) | ✅ broker rejects; error surfaced in the UI |
| Blocked status + empty reason | ✅ reveals reason field; **client blocks save** (no network call) |
| Operator token + Remember (on) | ✅ persisted to `localStorage` with a 24h expiry + "Saved until…" text |
| Operator token — Remember (off) | ✅ clears storage, shows "held in this session only" |
| Refresh-provider buttons | ✅ correctly **disabled** when an adapter is unconfigured/insecure |

**No functional defects found.**

> **Harness note for CI:** the in-browser preview harness's synthetic
> `fill`/`click` events do **not** reach React 19's delegated event listeners; the
> app only responds to native/trusted events (verified: a native `.click()` toggles
> a controlled checkbox and fires `onChange`; a synthetic one does not). The app is
> correct — this is a tooling limitation, and it is exactly why the planned
> **Playwright e2e (improvement-backlog item 3)** matters: Playwright dispatches
> trusted events and would exercise these flows in CI.

## 2. UX / accessibility review

Measured, not eyeballed (contrast composited over the real base background):

- **Contrast — passes AAA.** Body/muted text ≈ 8.9:1, headings ≈ 16:1, pills ≈
  7.6:1, warnings ≈ 11.5:1 (WCAG AA = 4.5:1, AAA = 7:1).
- **Semantics — good.** `main` landmark, single `h1`, one `h2` per panel, all
  `<button>`s typed, and **21/21 form controls labelled**.
- **Responsive — good.** Collapses cleanly from 3 columns → 1 on mobile (375px).

### Findings and fixes

| Finding | Severity | Resolution |
| --- | --- | --- |
| **No visible focus indicator** — `styles.css` defined no `:focus`/`:focus-visible` rules (WCAG 2.4.7). | a11y, real | **Fixed** — accent focus ring on every interactive element. |
| Status board (6 lanes) wrapped 4+2 at desktop width. | minor | **Fixed** — true horizontal kanban board with per-status color dots + custom scrollbar. |
| Large dead whitespace between unequal-height panels. | cosmetic | **Fixed** — deliberate balanced 3-column grouping. |
| Long uppercase env-var tokens wrapped mid-word. | minor | Mitigated via `overflow-wrap`. |
| Muted text rendered in link-blue (read as clickable). | minor | **Fixed** — muted text moved to a neutral slate; accent reserved for interactive/brand. |

## 3. Redesign summary (`src/styles.css`, pure-visual + balanced layout)

Token-driven dark theme with layered surfaces and soft elevation; real type scale
and a separated heading rule per panel; gradient hero with an accent bar and a
live status dot; refined inputs/selects (custom caret + checkbox) and a
gradient primary button with hover/active/focus states; semantic status colors
for policy chips, warnings, and the catalog; a horizontal kanban board with
per-status accents; accessible focus rings throughout; and a
`prefers-reduced-motion` guard.

Behavior is unchanged: the existing `<App/>` render smoke and the 11 `lib`
unit tests still pass, and `verify:control-plane` is green.

## 4. Still open (improvement-backlog)

- **Item 3 — Playwright e2e + axe** in CI (the harness limitation above makes this
  the right tool for automated interaction coverage).
