# Tweakables

**Every tuning constant in the game, in one folder.** If you are balancing —
making a weapon stronger, a jump higher, an ultimate cheaper — this is the
only place you should need to look. The simulation imports everything from
here; the folder is pure data, so changing a number can never desync a match.

| File | What it tunes |
|---|---|
| `movement.ts` | Gravity, the jump curve, walking, dashes, tumbles, wall play |
| `combat.ts` | A fighter's health, the attack cooldown, the bullet itself |
| `melee.ts` | The whole `MOVES` frame-data table, the Massive Strike and the plunge bomb, the guard, the chain |
| `ranged.ts` | The weapon stat cards: the rifle, the machine gun, the shotgun's pellet fan, its distance damage falloff, magazine, `magazinesPerLife` and the per-round reload times |
| `ultimate.ts` | The charge economy, the cinematic freeze, the black hole, the dragon, the Death Blossom |
| `items.ts` | The HE grenade, the trap, the smoke grenade, and the charges each kit grants |
| `match.ts` | Frag limits, timers, the end-of-match ceremony, MVP weights, team deathmatch's rounds |

## How to tune

1. **Change the number in the file.** Every constant carries the "why" in its
   comment — read it before you tune, because several numbers are load-bearing:
   gravity and the jump velocity set level reachability (see `movement.ts`),
   and the melee table's hitstun is sized to the chain's link times.
2. **Run the verification:** `pnpm run verify` (typecheck both projects, the
   full test suite, build, dead-code). The tests assert the invariants the
   numbers are allowed to break — e.g. the shotgun's shell reload must stay
   slower than its blast, the dagger's dash must stay quicker than the sword's.
3. **Measure the change online:** `tsx scripts/diagnose.ts --mode=online
   --runs=3` and the mode probes — a number that typechecks but breaks the
   feel shows up as a probe failure, not a compile error.
4. **Update the spec that names the number** (specs/melee.md, specs/combat.md,
   specs/ultimate.md, specs/items.md, specs/jeffs.md, specs/anands.md) in the
   same commit — the specs are the source of truth, and a spec that quotes a
   number the code no longer has is a lie.

## The rules

- **The simulation never defines a tuning constant.** If you find yourself
  writing `const SOMETHING_MS = 300` inside `src/game/simulation/`, that
  number belongs in here.
- **Derived constants stay in the simulation.** `JUMP_HEIGHT_PX` (computed
  from the jump velocity) and `GRENADE_MAX_RANGE_PX` (from the grenade's speed
  and gravity) are the docs' derived children — tune the raw numbers here and
  the derived ones follow. They are re-exported through the simulation, so
  nothing else has to change.
- **The folder imports nothing but types** (and `units.ts` for the match
  timers) — it must never grow an import from the simulation, or the tuning
  folder would stop being safe to read.
