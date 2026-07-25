---
name: pixi-assets
description: "Use when loading or creating textures in PixiJS v8 — the Assets loader, aliases and manifests, spritesheets, slicing a plain image strip into frames, and generating textures from Graphics at runtime. Triggers on: Assets.load, Assets.add, texture, spritesheet, atlas, frame, Rectangle, TextureSource, generateTexture, preload, alias, resolver, animation frames, placeholder art."
license: MIT
---

# PixiJS v8: Assets and Textures

## Loading

```ts
import { Assets } from "pixi.js";

Assets.add({ alias: "dude", src: "assets/dude.png" });
await Assets.load(["dude", "fireball"]);

const texture = Assets.get("dude");
```

- **The application must be initialised first.** `Assets` needs the renderer's
  environment adapters to exist.
- `Assets.add('alias', 'src')` (two positional args) was **removed in v8** — pass
  an object.
- `Assets.load()` accepts one alias or an array, and returns the texture(s).
- `Assets.get()` is synchronous and only returns something already loaded.

**Register aliases once.** The resolver is global and warns
`[Resolver] already has key: x overwriting` if you re-add. React StrictMode
mounts twice in development, so a naive loader spams the console on every boot:

```ts
let registered = false;
export async function loadAssets() {
  if (!registered) { for (const a of manifest) Assets.add(a); registered = true; }
  await Assets.load(manifest.map((a) => a.alias));
}
```

## Spritesheets with an atlas

```ts
const sheet = await Assets.load("assets/atlas.json");
const sprite = new Sprite(sheet.textures["hero_idle_0.png"]);
const anim   = new AnimatedSprite(sheet.animations["hero_walk"]);
```

`sheet.animations` is keyed by the frame-name prefix, so an atlas whose frames
are named `walk_0..walk_7` gives you `sheet.animations.walk` for free. This is
the efficient path — prefer it when you control the art pipeline.

## Slicing a plain strip (no atlas)

A bare PNG of evenly spaced frames has no atlas, so cut it yourself:

```ts
import { Rectangle, Texture } from "pixi.js";

const sheet = Assets.get("dude") as Texture;
const frames: Texture[] = [];
for (let i = 0; i < 9; i++) {
  frames.push(new Texture({
    source: sheet.source,                                  // share one GPU upload
    frame: new Rectangle(i * 32, 0, 32, 48),
  }));
}
```

Note `source`, not `baseTexture` — **`BaseTexture` is gone in v8**, replaced by
`TextureSource`. All frames share one source, so this costs one upload.

## Generating textures at runtime

Ideal for placeholder art and simple shapes: draw once, then render to a texture
so it can be pooled, tinted and batched like any other sprite.

```ts
const g = new Graphics().circle(48, 48, 44).stroke({ width: 5, color: 0xffffff });
const texture = app.renderer.generateTexture(g);
g.destroy();
```

Draw generated art **white**, then `sprite.tint = 0xff8800` per use. One texture
serves every colour variant, keeps the batch intact, and means swapping in real
artwork later touches only the loader.

## Texture lifetime

- `Assets.unload(alias)` frees a loaded asset.
- `texture.destroy(true)` also destroys its source — only correct if nothing else
  shares it. After slicing a strip, destroying one frame's source kills them all.
- Textures generated with `generateTexture` are yours; nothing frees them for
  you.

## A useful indirection

Route every lookup through one accessor so callers never care whether art was
loaded or generated:

```ts
export function tex(key: string): Texture {
  return generated.get(key) ?? Assets.get(key) ?? Texture.EMPTY;
}
```

Returning `Texture.EMPTY` rather than `undefined` means a missing asset renders
as nothing instead of throwing deep inside the renderer, which is far easier to
trace back to the real cause.
