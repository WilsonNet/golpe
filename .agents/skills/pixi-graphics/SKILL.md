---
name: pixi-graphics
description: "Use when drawing vector shapes in PixiJS v8 — the v8 shape-then-style chaining API, rects, circles, arcs, polygons, strokes, holes, and when to bake a Graphics into a texture instead. Triggers on: Graphics, drawRect, drawCircle, beginFill, endFill, lineStyle, fill, stroke, arc, poly, path, cut, hole, debug overlay, vector shapes, shapes."
license: MIT
---

# PixiJS v8: Graphics

## The v8 API: shape first, then style

v7 set a style and then drew; v8 defines a shape and then styles it. Every
`draw*` method was renamed.

```ts
import { Graphics } from "pixi.js";

// v7 (gone)
// g.beginFill(0xff0000); g.drawRect(50, 50, 100, 100); g.endFill();

// v8
const g = new Graphics()
  .rect(50, 50, 100, 100)
  .fill(0xff0000);

new Graphics()
  .circle(530, 50, 140)
  .fill("blue")
  .stroke({ width: 2, color: "white" });
```

| v7 | v8 |
|---|---|
| `drawRect` | `rect` |
| `drawCircle` | `circle` |
| `drawEllipse` | `ellipse` |
| `drawPolygon` | `poly` |
| `drawRoundedRect` | `roundRect` |
| `beginFill` / `endFill` | `fill(...)` after the shape |
| `lineStyle` | `stroke({ width, color, alpha })` |

`fill` and `stroke` apply to every shape queued since the last style call, so you
can batch several shapes under one fill — and can accidentally fill more than you
meant if you forget.

## Arcs and paths

`arc` follows the canvas convention: `arc(x, y, radius, startAngle, endAngle,
counterclockwise)`. Two arcs in opposite directions plus `closePath` give a
crescent:

```ts
const arc = new Graphics();
arc.arc(48, 48, 46, -1.0, 1.0, false);   // outer edge, clockwise
arc.arc(48, 48, 24, 1.0, -1.0, true);    // inner edge, back the other way
arc.closePath();
arc.fill(0xffffff);
```

Note that stroking an open path needs `stroke()` after the arc without
`closePath`, or the ends get joined.

## Holes

`cut()` subtracts the last shape from what came before:

```ts
new Graphics()
  .rect(0, 0, 100, 100).fill(0x00ff00)
  .circle(50, 50, 20).cut();
```

## Redrawing

`Graphics` retains its geometry. To animate, `clear()` and rebuild:

```ts
g.clear();
g.rect(0, 0, w, h).fill(color);
```

Rebuilding every frame re-tessellates, which is genuinely expensive for complex
paths. If the shape is static, draw it once.

## Prefer baking to redrawing

A `Graphics` object is geometry, not a sprite: it does not batch with sprites,
cannot be pooled cheaply, and re-tessellates on change. For anything that will
exist in quantity — particles, effects, placeholder art — bake it once:

```ts
const g = new Graphics().poly([4, 0, 8, 4, 4, 8, 0, 4]).fill(0xffffff);
const texture = app.renderer.generateTexture(g);
g.destroy();
```

Now it is an ordinary texture: poolable, tintable, and batched with every other
sprite. Draw it white and tint per instance.

Keep `Graphics` for things that are genuinely one-off and static — a debug
collider overlay is the ideal case:

```ts
const g = new Graphics();
for (const p of platforms) g.rect(p.x, p.y, p.w, p.h);
g.stroke({ width: 1, color: 0x00ff00, alpha: 0.8 });
```

Deriving a debug overlay from the same data the collision code uses is the only
way to be sure the picture and the physics agree — hand-placed debug art can
disagree with the colliders just as easily as real art can.
