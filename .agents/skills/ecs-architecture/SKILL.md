---
name: ecs-architecture
description: "Use when adding an entity type, a component or a system, or when deciding whether something belongs in ECS at all. Covers this project's miniplex world, the archetype queries, system ordering, and the deliberate boundary that keeps the deterministic simulation out of ECS. Triggers on: ECS, entity, component, system, miniplex, world, query, archetype, add entity, spawn, new enemy, pickup, scaling, architecture, where does this code go."
license: MIT
---

# ECS Architecture

The entity world lives in `src/game/ecs/`. It is built on
[miniplex](https://github.com/hmans/miniplex): entities are plain objects,
components are optional properties, and the presence of a property defines the
archetype.

## The boundary — read this before adding anything

**ECS stops at the entity and presentation layer. The simulation is not in it.**

`src/game/simulation/` stays plain data and pure functions:
`tickPlayer(state, intent, dt)` over a flat `PlayerPosition`. That is deliberate,
and it is not an accident of history:

- Rewind-and-replay reconciliation is a three-line loop *because* state is a flat
  struct you can copy. Turning it into component stores would mean snapshotting
  and restoring a whole world per correction.
- It is what gets client/server disagreement to a measured **0.00px**, and it is
  covered by 80 tests that never touch a renderer.
- The entity count that actually grows is *drawn things* — effects, projectiles,
  pickups — not authoritative fighters, of which there are two.

So: **the simulation owns truth, the world owns things that are drawn.** ECS pays
for itself where the numbers grow, and stays out of the part that demonstrably
works.

## Entity shape

```ts
export interface Entity {
  key: string;                       // stable identity, for effects and debugging
  fighter?: { side: Side; hp: number };
  bullet?:  { id: number };
  body?: PlayerPosition;             // simulation state, referenced not copied
  position?: { x: number; y: number };
  renderPos?: { x: number; y: number };
  sprite?: Sprite;
  anim?: AnimState;
}
```

Two subtleties worth keeping:

- **`body` is a reference, not a copy.** Prediction replaces the local fighter's
  state object every tick, so the entity is re-pointed at the current one. A copy
  would go stale within a frame.
- **`renderPos` exists because drawing and simulating legitimately disagree.**
  Reconciliation snaps the simulation to the authoritative answer immediately so
  gameplay stays correct, while the sprite is drawn at a decaying offset — a pop
  becomes a glide. Drawing from `body` would undo the smoothing; simulating from
  `renderPos` would make the smoothing authoritative.

## Queries are built once

```ts
export function createQueries(world: GameWorld) {
  return {
    fighters:       world.with("fighter", "body"),
    drawnFighters:  world.with("fighter", "body", "sprite"),
    animated:       world.with("body", "sprite", "anim"),
    bullets:        world.with("bullet", "position", "sprite"),
  };
}
```

miniplex keeps each bucket up to date as components are added and removed.
Re-deriving a query per frame throws away the entire point of the index.

Queries also narrow types at the iteration site, so `e.body` is non-optional
inside `for (const e of queries.fighters)`. For entities held for their whole
lifetime — the two duellists — name the guarantee once instead:

```ts
export type FighterEntity = Entity &
  Required<Pick<Entity, "fighter" | "body" | "sprite" | "anim">>;
```

## Systems are plain functions, run in order

```ts
animationSystem(queries, dtMs);    // pick the frame
spriteSyncSystem(queries);         // move the sprites
meleeFxSystem(queries, fx, dtMs);  // effects read the same state
fx.update(dtMs);
stage.update(dtMs);                // camera settles last
```

**Every system reads simulation state and writes only presentation.** That
direction is the rule the architecture rests on: a system that wrote back into
`body` would be changing authoritative state outside `tickPlayer`, and the client
and server would immediately disagree.

Order matters and is explicit rather than emergent — animation picks a frame
before sync places it, effects read the same state both used, and the camera
settles after everything it might follow.

## What is *not* a system

Input, netcode and AI are singletons with their own lifecycles, not per-entity
behaviour. Forcing them into systems buys nothing and hides their sequencing.
They live in `Match`, which is the one place that knows about the simulation, the
netcode and the renderer at once — keeping those crossings in a single file is
what stops the responsibilities leaking into each other.

## Adding something new

1. **Is it drawn, and are there many of them?** → an entity with components.
2. **Is it one thing with a lifecycle?** (a connection, an input device) → a
   service owned by `Match`.
3. **Does it decide game outcomes?** → it belongs in `simulation/`, as pure
   functions over flat state, with tests — **not** in ECS.

To add an entity type: extend `Entity` with an optional component, add a query if
a system needs to iterate it, and write the system. Nothing else needs wiring —
existing archetypes are unaffected, which is exactly the scaling property ECS was
adopted for.
