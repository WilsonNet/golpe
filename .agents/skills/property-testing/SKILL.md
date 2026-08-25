---
name: property-testing
description: "Use when writing or extending the unit-test suite — deciding whether a test should be an example or a property, or converting an example/LCG test into a fast-check property. Covers fast-check + @fast-check/vitest, the `.prop` syntax, the arbitraries for this codebase's pure functions (wire round-trip, launch parse/serialize, scoring, ranking, name sanitise, arena tiling, geometry predicates, pointer math), and the traps (NaN floats, `fc.option` null-vs-undefined, control-char fallback preconditions, order-independent grouping) that cost real debug time. Triggers on: property, property-based, fast-check, arbitraries, test.prop, fuzz, round-trip, LCG, example vs property, unit test."
license: MIT
---

# Property-Based Testing with fast-check

The unit-test suite is pure and deterministic by design (`tickPlayer` is the same
function both sides run). That makes it a perfect home for property-based
testing: fast-check generates hundreds of inputs and **shrinks a failure to the
smallest counterexample**, so a property patrols the whole input space where an
example only covers what the author thought of.

Wire-up (already in `package.json`):

```bash
pnpm add -D fast-check @fast-check/vitest
```

`@fast-check/vitest` provides `test`/`it` with a `.prop([...])` method; `describe`
and `expect` still come from `vitest`:

```ts
import { describe, expect, it } from "vitest";
import { test, fc } from "@fast-check/vitest";

test.prop([fc.integer()])("name", (n) => { /* assert */ });
```

## When a test should be a property, and when it must stay an example

A property replaces many examples when the function has an **invariant that
holds across a family of inputs** and is **pure/deterministic**. In this repo:

- **Convert to a property:** wire pack/unpack round-trip, launch
  `parse(serialize(p)) === p`, PlayTracker consolidation (no event lost, span
  capped), `rankScores`/`mvpOf` order-independence and total-place partition,
  name `sanitiseName` (finite, in-range, printable), `buildWorld` tiling/spawn
  validity across every screen count, `singularityGrip` band partition,
  friendly-fire agreement across hole/blossom/grenade, `smokeLobAngle`
  ballistics, `normalisePointer`/`viewToWorld` math, `sanitiseAudio` validity.
- **Keep as examples:** feel/tuning pins (`DASH_DOUBLE_TAP_MS`, reload timings,
  `Director` ceremony budget, health-colour ramp, `describePlay` headline
  strings), sequenced state machines (`DoubleTapDash`, melee chain/cancel/plunge,
  trap through `tickPlayer`, the training dummy), and any exact-string contract.

The repo used to hand-roll this with an LCG (`wire.test.ts`, `Physics.test.ts`'s
tunnelling run). A real `fc` property beats an LCG: it shrinks failures and
needs no bespoke generator plumbing.

## The traps that cost real debug time

fast-check found three of these during the first conversion — each was a bug in
my *test*, not in the code under test, and each took a shrinking report to spot:

- **`fc.float()` includes `NaN`.** A `viewToWorld` property failed with
  `Number.NaN` as a generated fraction. Use `fc.float({ min, max, noNaN: true })`
  when the domain excludes NaN.
- **`fc.option(x)` yields `null`, not `undefined`.** A `LaunchParams` optional
  field maps to `null` unless you convert: `fc.option(a).map((v) => v ?? undefined)`.
  The serialiser keys on `!== undefined`, so a `null` broke the round-trip.
- **A "sanitise" function returns its `fallback` verbatim on the empty path.**
  `sanitiseName` only sanitises when the input cleans to something non-empty;
  otherwise it hands back the (untrusted) fallback. A property asserting the
  *output* is always printable/trimmed fails on `raw=""` with `fallback="\t"`.
  Gate with `fc.pre(...)` on the branch that actually promises the invariant,
  mirroring the function's own branch condition.
- **Grouped collections lose input order.** `PlayTracker` partitions by actor,
  so flattening its closed plays regroups the stream. Compare order-independent:
  sort both sides by `(t, actorId, kind)` before `toEqual`.

## Prefer preconditions over weakening the assertion

When a property is only meaningful for part of the domain (e.g. a lob solver
within the canister's reach, or the sanitise branch), use `fc.pre(...)` to
exclude the rest rather than dropping the assertion. A property that always
passes because it never checks the interesting case is a metric that cannot
fail — the same rule the `feedback-loop` skill applies to diagnostics.

## The canonical properties, as templates

Round-trip (wire, launch):
```ts
const arb = fc.record({ ... });
test.prop([arb])("round-trips", (v) => expect(unpack(pack(v))).toEqual(v));
```

Order-independence (ranking): reverse and rotate the input, assert the output
order is unchanged.

Cross-function consistency (friendly fire): assert `fieldAffects`,
`blossomAffects` and `grenadeTouches` agree for the same `(owner, team, fighter,
fighterTeam)` — the one place the rule is written keeps them from drifting.

Geometric partition (grip bands): the three bands must be contiguous and
non-overlapping as distance from centre crosses each threshold.
