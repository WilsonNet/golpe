# Arena

**Intent:** a small, symmetric, vertical arena. Both fighters get the same
options, every surface is reachable, and there is enough cover to break
line-of-sight without anywhere to get stuck.

Defined once in `src/game/simulation/Arena.ts` and used by collision, rendering,
line-of-sight and bullets.

## World

- **800 × 600**, origin top-left, Y increasing downward.
- Player body: **32 × 48**, positioned by its **top-left** corner.
- The left and right world edges are solid **and wall-jumpable**.

## Layout

```
 y=170                    [ top ]
 y=250     [ hi-L ]                  [ hi-R ]
 y=360                    [ mid ]
 y=450     [ lo-L ]                  [ lo-R ]
 y=468            |P|          |P|              ground-level cover
 y=568  ============== ground ==============
```

| Surface | x | y | w | h |
|---|---|---|---|---|
| ground | 0 | 568 | 800 | 32 |
| low left | 90 | 450 | 130 | 24 |
| low right | 580 | 450 | 130 | 24 |
| centre mid | 330 | 360 | 140 | 24 |
| high left | 60 | 250 | 120 | 24 |
| high right | 620 | 250 | 120 | 24 |
| top centre | 350 | 170 | 100 | 24 |
| pillar left | 280 | 468 | 24 | 100 |
| pillar right | 496 | 468 | 24 | 100 |

Ledges are **24px thick** so a fighter can make side contact and wall jump off
them, rather than only landing on top.

The two ground-level pillars exist to break line-of-sight at ground level and to
offer a route upward that does not use the outer ledges.

## Invariants

These are enforced by tests, because each was violated by a real bug.

- **Every surface is within one jump (136px) of the surface below it.** The
  ladder is ground → pillar/low → mid → high → top. Changing gravity or jump
  velocity breaks this silently.
- **No horizontal gap narrower than the player (32px)** between solids that
  overlap vertically. A 30px gap under an overhang once pinned the AI in a 36px
  pocket for an entire match — invisible on screen, fatal to the fight.
- **Sprites are drawn from this data**, never hand-placed. Hand-placed platforms
  once drew a 400px image for a 100px collider, so players appeared to walk
  through solid ground and stand on thin air.
- **Nothing may end a tick inside a solid.** Asserted every frame by the
  diagnostic.

## Spawns

**Seventeen spawn points for sixteen slots** (`SPAWN_POINTS`), so a respawn always
has somewhere to go that nobody is standing on. Eight on the ground, two on each
low ledge pair, two on mid, one on each high ledge, one on the peak. Every point
faces the middle of the arena.

Two rules they must satisfy, both asserted by tests:

- **Nothing spawns inside geometry.** A spawn inside a solid is depenetrated on
  the first tick, which every *other* client sees as a teleport — from a fighter
  that has not done anything yet.
- **Sixteen fighters placed at once never overlap.** Otherwise the depenetrator
  shoves one of them sideways on tick one, on every client, simultaneously, before
  anybody has pressed a button. That is why the pillars have no spawn on them and
  why the ground points are spread wider than `PLAYER_WIDTH`.

`pickSpawn(occupied)` returns **the point furthest from the nearest fighter in
`occupied`**, ties going to the earlier point in the list. It is pure and
deterministic, so client and server agree on where a fighter came back and a test
can assert the choice rather than eyeballing it. Spawning inside somebody's swing
is the one death a player cannot do anything about.

A whole-arena reset hands spawns out one at a time against the points already
taken, so the *set* is spread rather than each fighter independently choosing the
same "best" point.

## Not implemented

- One-way / drop-through platforms. Every surface is solid from all sides.
- Moving or destructible geometry.
- Multiple arenas or map selection — `platforms` is a single module constant.
