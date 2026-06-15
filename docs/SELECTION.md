# Model selection (cost-aware, capability-matched routing)

Switchboard resolves *who should do a task* in a discrete **selector** stage that
runs **before** the planner. The selector turns a task's declared *task-class*
(or an explicit pin) into a concrete `ModelReservation`; the existing planner
then answers *can they, right now* by validating that reservation against live
quota. Selection and planning are deliberately separate: the selector never
touches the planner's coverage logic, and selection warnings are a separate
union from planner warnings.

## Capability tiers

Tiers are coarse, hand-assigned, and deliberately **not** a benchmark matrix:

| Tier | Use |
| --- | --- |
| `heavy` | Judgment-heavy work — attribution and anything touching corpus accuracy. |
| `standard` | In-between work such as editorial/architecture review. |
| `light` | Mechanical drafting and formatting. |

A model *clears the floor* for a class when its tier is at least as capable as
the class's `minimumTier` (`heavy` clears every floor; `light` clears only a
`light` floor). The floor is the **only** thing protecting quality: the selector
always picks the cheapest model that clears it.

## Cost-basis policies

A profile sets a default `selectionPolicy`; a task-class may override it with
`selectionPolicyOverride`.

- **`subscription-first`** — marginal-cost-0 subscription models beat metered API
  calls while they remain available; no scarcity weighting.
- **`subscription-first-scarcity-preserving`** (default) — as above, but a
  near-exhausted premium subscription is progressively deprioritised
  (`scarcityPenalty` grows as remaining/limit shrinks) so a cheaper capable model
  can win *before* the subscription is fully spent.

## Candidate filter and ranking

A catalog row is a candidate for a class when **all** hold: it is `active`
(placeholder rows are never routed on), its tier clears the class floor, a
matching in-context quota snapshot exists, and that snapshot's availability is
not `unavailable` (unavailable models simply drop out — this is how failover
works). Candidates are ranked by `effectiveCost = base + scarcityPenalty`
ascending, with a deterministic tie-break of *tier rank → provider → modelId*.

## Per-task precedence

1. An existing reservation is authoritative and left untouched.
2. Otherwise an explicit `modelPin` is honoured (`source: 'pin'`).
3. Otherwise the declared `taskClass` is resolved (`source: 'selector'`).
4. Otherwise the task passes through unchanged.

A task-class with no `minimumTier` (e.g. local `validation`) needs no model and
is skipped entirely.

## Corpus-integrity guardrail — read before changing a floor

Lowering a judgment-heavy `minimumTier` (e.g. `attribution`, or any class that
touches corpus accuracy) below `heavy`, or routing such a class to a weaker or
cheaper model, is a **corpus-integrity risk, not a cost optimization**. The
cheapest model that clears the floor always wins, so the floor is the sole
quality guarantee for published, accuracy-sensitive output.

Treat any change that weakens a judgment-heavy floor as a change to the integrity
of the corpus itself. The default posture is to **refuse** it; it must be made
deliberately and with explicit operator sign-off, never as an incidental
cost-saving tweak. Cost savings belong on mechanical classes (`article-draft`,
formatting) where a lower tier reflects the actual nature of the work.
