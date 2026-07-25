---
name: pixi-scene-graph
description: "Use when structuring what is drawn in PixiJS v8 — Containers, Sprites, anchors and pivots, draw order, layers, and building a camera. Covers the top-left vs centre-origin trap, why leaf nodes cannot have children in v8, and separating camera scroll from cosmetic shake. Triggers on: container, sprite, anchor, pivot, addChild, zIndex, sortableChildren, layer, depth, draw order, camera, scroll, shake, world space, screen space, HUD."
license: MIT
---

# PixiJS v8: Scene Graph and Camera

## Containers and sprites

```ts
import { Container, Sprite } from "pixi.js";

const layer = new Container();
const sprite = new Sprite(texture);
sprite.anchor.set(0.5);        // centre origin
layer.addChild(sprite);
```

**Leaf nodes cannot have children in v8.** `Sprite`, `Text` and `Graphics` are
leaves — only a `Container` parents. Parenting to a Sprite silently worked in v7
and is an error now.

## Anchor is not pivot

- **`anchor`** (Sprite/Text only) — normalised, `0..1`, moves the *texture*
  relative to the position. `0.5` centres it.
- **`pivot`** (any Container) — in *pixels*, moves the transform origin, so
  rotation and scale happen around it.

Use `anchor` to centre artwork; use `pivot` to spin something around a point that
is not its centre.

## The top-left trap

A physics AABB is almost always positioned by its **top-left corner**; a sprite
with `anchor 0.5` is positioned by its **centre**. Assigning body coordinates
straight to a sprite draws it half a body up and left of where it actually
collides — a bug that looks like "collision is slightly wrong" and wastes hours
in the wrong file.

Funnel every body-following sprite through one helper:

```ts
export function syncSpriteToBody(sprite, bodyX: number, bodyY: number) {
  sprite.x = bodyX + BODY_WIDTH / 2;
  sprite.y = bodyY + BODY_HEIGHT / 2;
}
```

## Draw order

Order within a parent is child order — later children draw on top. `zIndex` only
applies when the parent has `sortableChildren = true`, which costs a sort per
frame.

**Prefer explicit layer containers to per-object `zIndex`.** Layers make the
draw order a visible, reviewable fact instead of an emergent property of numbers
scattered across the codebase:

```ts
stage.addChild(background, arena, actors, projectiles, effects, hud);
```

## Building a camera

Pixi has no camera. A camera is a `Container` you move in the opposite direction
to the view: to look at world point `(x, y)`, set `container.position = (-x, -y)`.

**Split deliberate movement from cosmetic movement:**

```
stage
└── scroll        deliberate camera movement  ← what tooling should measure
    └── shake     cosmetic impact shake       ← never measured
        ├── arena
        ├── actors
        └── effects
hud                screen space, outside the camera
```

The split is not tidiness. If a diagnostic reads the same transform that screen
shake writes to, every impact gets reported as camera jitter — the measurement
fails precisely when the effect is working. Keep the HUD outside the camera
entirely, or shake will rattle your health bars.

```ts
update(dtMs: number) {
  if (this.shakeMs <= 0) { this.shake.position.set(0, 0); return; }
  this.shakeMs = Math.max(0, this.shakeMs - dtMs);
  const a = this.amplitude * (this.shakeMs / this.duration);   // linear falloff
  this.shake.position.set((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
}
```

Let a bigger shake override a smaller one already running rather than queueing
them: two impacts in quick succession should read as one heavier hit, not as a
long rattle.

## Visibility, alpha and culling

- `visible = false` skips the object and its subtree entirely — the cheapest way
  to park a pooled object.
- `alpha = 0` still renders. Use it for fades, not for hiding.
- `renderable = false` skips drawing but still updates transforms.

## Pooling

Allocating a sprite per projectile causes GC hitches that show up as frame-time
spikes. Pool and reuse, using `visible` as the free/used flag:

```ts
acquire(): Sprite {
  for (const s of this.sprites) if (!s.visible) { s.visible = true; return s; }
  const s = new Sprite(this.texture);
  s.anchor.set(0.5);
  this.layer.addChild(s);
  this.sprites.push(s);
  return s;
}
```

**Key pooled sprites by a stable id, never by index into a live array.** If the
owning system splices dead entries out, an index-keyed sprite silently starts
representing a different object mid-flight.
