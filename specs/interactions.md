# Interactions

**Intent:** the game has a shared, deterministic simulation, and every
hero-vs-hero (and system-vs-system) rule runs through it. With more heroes on
the way, the danger is a pairwise "who interacts with whom" matrix — hero A vs
hero B special cases that grow quadratically and make adding a hero mean
touching every hero already in the game. This spec fixes the alternative:

> **A hero is data, and an interaction is a predicate over state and declared
> attributes.** A new hero composes existing attributes; a genuinely new
> interaction is a new *generic* predicate — never a hero-id branch.

## The vocabulary

Every interaction in the game is expressed with three layers. Nothing else is
allowed in the shared simulation.

**1. Declared attributes** — the data tables say what a thing *is*:

- `MOVES` in `Melee.ts`: `selfVx`/`selfVy` (the move carries the body),
  `piercesIframes`, `blockable`, `cancellable`, `knockdown`, `paysCharge`…
- `MeleeWeaponDef`: `hasCharge`, `shiftMove`, `chain`, `burst`, `blockable`
- `HeroDef`/`HeroKit`: melee, ranged, ultimate, item, sheet
- `ITEMS` and `tweakables/`: charges, radii, durations

**2. Statuses** — named, shared state in `PlayerPosition` that any system may
read: `stunTimer`, `knockdownTimer`, `trapTimer`, `iframeTimer`, the
singularity's `grip`, `dragonTimer`, `blossomTimer`, `freezeTimer`. A status is
the same field on both sides of the wire, so a system that compares against it
compares against the same truth everywhere.

**3. Generic predicates** — functions that answer one question and are asked by
everything: `hostile()` (friendly fire), `trapFor()`, `fieldAffects()`,
`trapCatches()`, `singularityGrip()`, `smokeHidesFrom()`.

An interaction is a predicate over state and attributes, living in the shared
simulation. The model example: **the trap counters moves that carry the body.**
`startMove` refuses a move when `moveCarriesBody(move)` — a declared attribute
(`selfVx`/`selfVy`) — and `trapTimer > 0` — a status. And the counter-rule,
**the dragon thrust is not countered**, is not a second case at all: a ride is
not a move, so no move gate applies. The exemption falls out of the
classification, which is exactly why the system stays flat as heroes multiply.

## Matchup exceptions

A true pair-specific rule — this move vs that hero only — still does not become
a hero-id branch:

- Prefer a **declared attribute on the participants** — a tag on the move, a
  flag on the ultimate. The rule then reads generically even though only one
  combination sets the flag today.
- If the rule cannot be stated as an attribute, it goes in **one small tagged
  table** (keyed by attribute tags), the single documented place for
  exceptions — never `if (hero === "x")` in `tickPlayer`, `GameRoom` or any
  damage path.

This is what the shipped games do. Dota 2's ability system is the canonical
case study: 125+ heroes and every ability *declares* its behavior
(`DOTA_ABILITY_BEHAVIOR_ROOT_DISABLES` — "cannot be used while rooted", which is
exactly a trap rule) and its targeting flags; units carry modifier *states*
(`MODIFIER_STATE_STUNNED`, `MODIFIER_STATE_MAGIC_IMMUNE`); interactions are
comparisons of those declarations at runtime. Fighting games are the other
pole: matchups *emerge* from the shared frame-data tables, and a hardcoded
matchup is treated as a balance smell. Where true exceptions survive in shipped
games (a wind wall, a spell shield), they live attached to the participating
ability's own data — still never in a global pairwise matrix.

## What the guard enforces

`src/game/simulation/Interactions.test.ts` scans the shared simulation and
`server/GameRoom.ts` for hero-id comparisons (`=== "lia"`, `case "anands"`, …)
and fails naming the offender. Adding a hero adds rows to `HEROES`, never `if`s
to the tick.

## Where per-hero code is allowed

Presentation may branch per hero: the HUD (names, colours), the menu, the
ultimate cinematic, the AI's animation choices (which sprite strip to draw).
The rule is only about the deterministic simulation and the server's authority
layer — the two places where a hero-id branch would be the first cell of a
matrix, and where both sides of the network must agree with no `if` to drift.

## Performance

Nothing about this costs per-tick time. The simulation iterates data tables and
predicates — O(heroes), no dynamic dispatch, no lookups keyed by hero. A
pairwise registry would add indirection (pointer-chasing and table walks) for
zero runtime benefit: the matrix is a maintenance cost, not a performance
feature. This game already paid the price of indirection once and packed the
wire format because of it.

## Not implemented

- An explicit tagged exception table. There is no pair exception yet, and this
  spec forbids inventing one: a hero-id branch is the first cell of the matrix.
  The first genuine matchup exception should implement the table and this
  section disappears.
