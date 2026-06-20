# Dashboard UI/UX review

UI-hardening backlog item 4. A mechanical review of `apps/switchboard-ui`
(`src/App.tsx`, `src/styles.css`, `index.html`) across four dimensions:
layout/responsive, keyboard/focus order, color contrast, and
empty/error/loading states. Mechanical issues are fixed in this same change;
anything needing product or visual judgment is escalated rather than guessed.

The dashboard is a single dark-themed `<main className="page">` of CSS-grid
panels: Operator session, Quota refresh, Task intake, Model availability,
Planning notes, Model selection, and the Switchboard lanes board.

## Method

- Static read of the markup, styles, and the mocked dashboard payload the UI is
  tested against (`test/App.test.tsx`).
- Contrast computed with the WCAG 2.x relative-luminance formula for every
  foreground/background pair in the theme, evaluated against the *effective*
  (alpha-composited) panel, card, quota-window, pill, and chip backgrounds
  rather than the page background, so the numbers reflect what actually renders.
- Cross-checked against the existing automated coverage: the vitest render smoke
  (`test:ui`, gated in `verify:control-plane`) and the headless Playwright +
  axe-core e2e (`test:e2e`, serious/critical violations fail CI).

## Layout / responsive

Solid; no fixes required. The two boards use intrinsic responsive grids —
`panel-grid` is `repeat(auto-fit, minmax(min(340px, 100%), 1fr))` and `lanes` is
`repeat(auto-fit, minmax(min(260px, 100%), 1fr))`. The `min(…, 100%)` guard is
the important detail: it lets a single column shrink below the track minimum
instead of overflowing, so the layout reflows cleanly from wide desktop down to
a ~320px phone width without a horizontal scrollbar. Long, unbreakable strings
(model ids, tokens, reasons) are handled by a global `overflow-wrap: anywhere` /
`word-break: break-word` rule plus `min-width: 0` on every flex/grid child, which
prevents the classic flexbox blowout. Inputs are `width: 100%; box-sizing:
border-box`, so fields never exceed their column.

## Keyboard / focus order

DOM order is logical and matches visual order (operator session → quota refresh
→ task intake → availability → planning → selection → lanes), and every control
is natively focusable — no `tabindex` traps, no `div`-as-button. Form controls
are all wrapped in `<label className="field">`, giving implicit labels and
correct focus association.

- **Fixed — no visible focus indicator (WCAG 2.4.7).** `styles.css` defined no
  `:focus`/`:focus-visible` styling, so keyboard focus fell back to inconsistent
  UA defaults that are easy to lose on the dark theme — most notably the primary
  `.button`, which is `border: 1px solid transparent` over a bright fill. Added a
  high-contrast `:focus-visible` outline (`2px solid #67e8f9` with offset) scoped
  to `:focus-visible` so pointer interaction is visually unchanged and only
  keyboard navigation shows the ring. Also added a `prefers-reduced-motion`
  guard while in the stylesheet.

## Color contrast

No fixes required — the palette already clears WCAG AA everywhere, and clears
AAA (7:1) for all but small-text edge cases, which still pass AA. Ratios were
computed against composited backgrounds (worst case for the light-on-dark theme,
since the translucent card/window fills lift the background slightly). Lowest
ratios observed:

| Text | Effective background | Ratio | Verdict |
| --- | --- | --- | --- |
| `.signal-pill` `#a5b4fc` (0.8rem) | pill fill over card | 7.6:1 | AA + AAA |
| `.muted` `#a5b4fc` | quota-window | 8.2:1 | AA + AAA |
| `.policy-disabled` `#fca5a5` | chip fill | 7.0:1 | AA + AAA |
| `.error-text` `#fca5a5` | card | 9.4:1 | AA + AAA |
| body `#f3f4f6` | card | 16.2:1 | AA + AAA |

Status colors are not encoded by hue alone — every warning/error/success/policy
state also carries a text label or pill, so the UI does not rely on color to
convey meaning (WCAG 1.4.1).

## Empty / error / loading states

Empty states are consistently and correctly handled: each data section guards
its "nothing here" copy with `!isLoading && …length === 0` (subscriptions,
adapters, catalog, selection warnings, and every lane), so an empty list never
flashes before the broker responds and never masks the loading state. The hero's
`profile` line falls back to "Waiting for broker state", and the operator-session
copy degrades gracefully while `authSummary` is null.

- **Fixed — status/error messages were not announced (WCAG 4.1.3).** The
  broker-load error, mutation error, and provider-refresh result are injected
  into the Planning-notes panel on state change with no live-region semantics, so
  assistive tech stayed silent. Wrapped the two error paragraphs with
  `role="alert"` (assertive) and the refresh result with
  `role="status" aria-live="polite"`, and set `aria-busy={isLoading}` on the
  `<main>` landmark so the initial load is exposed programmatically. Text content
  is unchanged, so the render-smoke and axe e2e assertions are unaffected.

### Escalated — needs product / visual judgment (not changed here)

- **Message placement.** Load/mutation/refresh feedback renders only inside the
  bottom "Planning notes" panel, visually distant from where the action is taken
  (e.g. task creation at the top, per-provider refresh mid-page). Co-locating
  feedback with its trigger, or adding a top-level banner, is a layout/IxD
  decision rather than a mechanical fix. The `aria-live` change above makes the
  current placement non-blocking for assistive tech in the meantime.
- **No whole-dashboard reload affordance.** Refresh exists per provider, but
  there is no single "reload control-plane state" control; the only full refresh
  is a page reload. Whether to add one (and where) is a product call.
- **Single hard-coded project.** `projectId` is fixed to `'threatpedia'`; a
  project switcher is an architecture/product decision and is out of scope for a
  review pass.

## Net change

Two mechanical accessibility fixes (focus-visible indicator; live-region
semantics for status/error/loading) plus a reduced-motion guard. No layout or
contrast changes were needed. Three items are escalated for product/visual
judgment. Existing `test:ui` and the axe-core e2e remain the regression gate.
