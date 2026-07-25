---
name: pixi-effects
description: "Use when adding visual effects in PixiJS v8 — particles, blend modes, tinting, filters, and impact feedback like screen shake and scale punch. Covers rolling a pooled particle burst system, and why frame-freeze hitstop is unavailable in a networked game. Triggers on: particles, emitter, burst, blend mode, additive, tint, filter, BlurFilter, ColorMatrixFilter, screen shake, hitstop, impact, juice, feedback, trail, sparks."
license: MIT
---

# PixiJS v8: Effects

## Blend modes and tint

```ts
sprite.blendMode = "add";      // v8 takes strings: "normal" | "add" | "multiply" | "screen" | ...
sprite.tint = 0xff8800;        // multiplies the texture
```

Additive blending is what makes sparks, trails and energy read as *light* rather
than as paint. Draw effect art white and tint per instance: one texture serves
every colour, and the batch stays intact.

## Particles: roll your own

Pixi ships no emitter. Third-party ones bring a config format larger than most
games need, and a burst emitter is about 80 lines. What matters:

- **Pool the sprites.** Allocating per particle causes GC hitches that show up as
  frame-time spikes.
- **Iterate backwards with swap-remove**, or removing a dead particle skips the
  one that took its place.
- **Drive it from frame time, never simulation time.** Particles are never read
  back by gameplay, so they cannot desync anything — and they must not be given
  the chance to try.

```ts
update(dtMs: number) {
  const dt = dtMs / 1000;
  for (let i = this.live.length - 1; i >= 0; i--) {
    const p = this.live[i];
    p.ageMs += dtMs;
    if (p.ageMs >= p.lifeMs) {
      p.sprite.visible = false;
      this.free.push(p.sprite);
      this.live[i] = this.live[this.live.length - 1];   // swap-remove
      this.live.pop();
      continue;
    }
    const t = p.ageMs / p.lifeMs;
    p.vy += p.gravity * dt;
    p.sprite.x += p.vx * dt;
    p.sprite.y += p.vy * dt;
    p.sprite.scale.set(lerp(p.scaleFrom, p.scaleTo, t));
    p.sprite.alpha = lerp(p.alphaFrom, p.alphaTo, t);
  }
}
```

A single `burst({ texture, count, x, y, tint, speed, angle, lifeMs, scale, alpha,
gravity, spin })` entry point covers hits, blocks, launches and ambient motes.
An `angle` cone turns the same burst into a directional plume.

For thousands of particles, `ParticleContainer` trades features (no per-child
filters or masks) for throughput.

## Filters

```ts
import { BlurFilter, ColorMatrixFilter } from "pixi.js";

container.filters = [new BlurFilter({ strength: 4 })];

const cm = new ColorMatrixFilter();
cm.desaturate();
container.filters = [cm];
```

Filters render the subtree to a texture first, so each one costs a full-screen
pass at the size of the object's bounds. Applying a filter to a large container
every frame is usually the first thing to look at when the frame time regresses.
`container.filterArea` bounds the cost when you know the region.

## Selling impact

Three cheap, layered cues do most of the work:

1. **Camera shake** — a `Container` you offset, decaying over ~100–250ms.
2. **Scale punch** — overshoot the struck sprite's scale and decay it back.
3. **A particle burst plus an expanding ring**, tinted by what happened.

```ts
private applyPunch(f, dtMs: number) {
  if (f.punch <= 0) { f.body.scale.set(1); return; }
  f.punch = Math.max(0, f.punch - dtMs / 180);
  f.body.scale.set(1 + 0.35 * f.punch, 1 + 0.18 * f.punch);
}
```

Non-uniform scale (wider than taller) reads as a squash and sells weight far
better than a uniform pop.

## Hitstop is unavailable in a networked game

Freezing the simulation for a few frames on impact is the standard way to make a
heavy hit land. **It cannot be used when a server is authoritative**: pausing one
machine and not the other is a desync, and the client will be yanked back the
moment it resumes.

Fake it entirely in the renderer — shake, punch, a brighter flash, more
particles. Everything above is cosmetic and reads back nothing, so the simulation
never notices.

The general rule this is an instance of: **effects may read simulation state,
never write it.** A system that wrote back into authoritative state would be
changing the game outside the tick function, and client and server would
immediately disagree.

## Measuring effects without measuring yourself

If tooling reads the same transform that screen shake writes to, every impact
gets reported as camera jitter — the metric fails hardest exactly when the effect
works. Keep deliberate camera movement and cosmetic shake in **separate
containers**, and measure only the former. See `pixi-scene-graph`.
