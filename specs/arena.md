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

- Player A: **x = 100**, Player B: **x = 668**, both at **y = 480**, facing each
  other. Symmetric about the arena centre.

## Not implemented

- One-way / drop-through platforms. Every surface is solid from all sides.
- Moving or destructible geometry.
- Multiple arenas or map selection — `platforms` is a single module constant.
