# A block should stop a bullet

- **Issue:** #14
- **Branch:** `training-room` (continues from the training-room work)
- **Status:** done — landed, verified, awaiting the balance measurement below

## The bug

`block` (RMB) stops melee only. A bullet passes straight through a raised guard
and deals full damage.

Confirmed in the code, not inferred: `bulletHitsPlayer`
(`src/game/simulation/Physics.ts`) is pure geometry — a box test with a 12px
margin — and neither caller consults `blocking`:

- `GameRoom.tickBullets` (server, authoritative)
- `Match.bulletTargets` → `BulletSystem.resolve` (the `?offline=true` escape hatch)

`specs/combat.md` never says a block stops a bullet, so the spec is not being
violated — it is silent, and the behaviour is wrong. **Spec must change in the
same commit.**

## Decisions

Settled, with reasons — these are the answers a future session should not have to
re-derive:

1. **A front block stops a bullet completely.** 0 damage, and the bullet is
   destroyed. Partial damage reduction would need a second damage concept that
   exists nowhere else in the game.
2. **Front only**, exactly like melee. A bullet travelling right arrives from the
   left, so it is blocked when the defender faces left:
   `Math.sign(vx) !== facing`. A purely vertical bullet (`vx === 0`) has no side
   and is **not** blocked.
3. **No parry from a bullet.** A parry's reward is a free Massive Strike, which
   is worthless at gun range and would make blocking strictly dominant against a
   gunner. A bullet is absorbed, never guard-broken.
4. **No pushback.** Bullets currently apply no knockback at all; adding one is a
   movement change and belongs to its own decision.
5. **One rule, both paths.** The test is a pure function in `Melee.ts`, exported
   by name through `Physics.ts`, used by the server *and* by the offline hatch.
   The escape hatch must not become a second set of combat rules — it is the one
   path nobody dogfoods.
6. **No netcode change.** Bullets are already server-owned and `blocking` is
   already in `PlayerPosition` and therefore in the snapshot. Nothing new crosses
   the wire.

## Open questions

- **Impact effects.** A silently absorbed bullet feels broken even when it is
  correct. The existing effect path is `MeleeEventMsg { move: MeleeMove, outcome
  }`, and both `MeleeFx` and `PhysicsDiagnostics` index `MOVES[move]` — so a
  bullet cannot be squeezed into it without a wider type change. **Deferred to a
  follow-up**, and called out as such in the issue and the spec.
- **Does this make the gun useless against a sword?** The counter is that
  blocking costs 45% of your walk speed, covers one side only, and cannot be held
  in gun stance. Wants a measured answer from the training room once it works
  (`dummyStance: "gun"` vs a blocking player), not an opinion.

## Plan

1. `blocksBullet(defender, bulletVx)` in `Melee.ts` — pure, named export, plus
   unit tests in `Melee.test.ts`. **← independently verifiable**
2. Re-export by name through `Physics.ts` (never `export *` — it resolves to
   nothing across the server boundary, silently).
3. Use it in `GameRoom.tickBullets`: a blocked bullet is consumed, deals 0
   damage, and counts as neither a hit nor damage in the training stats.
4. Use it in the offline path (`Match.bulletTargets`), so the two agree.
5. Training-room battery rows: a blocking fighter takes 0 from a shot to the
   front, and full damage from one to the back.
6. `specs/combat.md` + `specs/melee.md`, same commit.
7. Full sweep: `npm run verify`, `npm run lint`, `training-probe.mjs`,
   `diagnose.mjs --mode=online --runs=3`, `verify-modes.mjs`.

## Progress log

- Confirmed the defect in both bullet paths; wrote decisions above.
- Created `.tasks/` and this tracker. Issue #14 opened.
- Steps 1-4 done: `blocksBullet` in `Melee.ts` + 5 unit tests, re-exported by
  name through `Physics.ts`, used by `GameRoom.tickBullets` and by
  `BulletSystem.resolve` (`BulletTarget` gained `state`).
- Step 5, and three things the battery caught on the way — all of them the
  measurement being wrong, not the fix:
  - **First row measured a wall.** At x=200 vs 430 every shot died on
    `PILLAR_LEFT`, so both directions took 0 damage and the row "passed" the
    front case for the wrong reason. Moved into the clear lane between the
    pillars (330 vs 460).
  - **Then it measured the settle window.** `run()` reports after the steps
    finish, and the dummy keeps firing into a player whose guard has just
    dropped — 30 damage, attributed to the guard. A trace settled it: damage
    stayed at 0 for the whole 2.6s the guard was up and only appeared 300ms
    after it fell. The row now samples *during* the hold, and measures the
    **delta** across the window, since the cumulative counter also includes the
    shot that lands before the guard comes up.
  - **Scenarios were order-dependent.** `set()` merges, so this row handed the
    dummy a gun and moved the spawns, and the next two rows inherited both —
    "training does not desync" measured a ranged fight it never asked for.
    `run()` now applies its config onto `defaultTrainingConfig()`, so a scenario
    is a complete description of a situation. This was a latent bug in the
    battery, not something this task introduced.
  - **The determinism row was measuring knockback.** It required 3+ impacts, but
    the first hit knocks the target out of range, so how many of a fixed number
    of swings connect is a fact about knockback. Determinism is a property of the
    script, so it now asserts on the dummy's own move counts.
- Step 6 done: `specs/combat.md` and `specs/melee.md`.
- Step 7 done. Measured: training probe **13/13**, `npm run verify` 144 tests,
  lint clean, all 6 launch modes OK, canonical online **3/3 PASS** with every
  violation counter 0 and healthy counters (17-23 slashes, 4-7 massives, 8-15
  blocks, 8-21 bullets tracked).

## Resume here

Nothing blocking. The one open item is the balance question in **Open
questions**: measure whether a blocking sword fighter simply walks down a gunner,
using the training room (`dummyStance: "gun"` against a player holding block and
advancing). If it does, the answer is a cost on blocking, not a revert — the
guard covering bullets is correct.
