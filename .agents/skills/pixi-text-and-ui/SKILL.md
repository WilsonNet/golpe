---
name: pixi-text-and-ui
description: "Use when displaying text or building HUD/overlay UI with PixiJS v8 — Text, BitmapText, HTMLText, TextStyle, and deciding between in-canvas UI and a React/DOM overlay. Triggers on: Text, BitmapText, HTMLText, TextStyle, font, label, HUD, overlay, UI, score, health bar, screen space, DOM overlay."
license: MIT
---

# PixiJS v8: Text and UI

## Text takes one options object

```ts
import { Text } from "pixi.js";

const label = new Text({
  text: "hp: 100",
  style: { fontFamily: "monospace", fontSize: 26, fill: 0x000000 },
});
label.position.set(16, 16);
```

v8 replaced the positional `new Text(str, style)` signature with a single object.
Note `fill`, not Phaser's `color` — the two engines use the opposite name, which
is an easy silent mistake when porting.

Update by assigning `.text`. Each change re-rasterises the glyphs to a texture,
so **do not set it every frame with an unchanged value**:

```ts
if (label.text !== next) label.text = next;   // cheap guard, real saving
```

## Which text class

| Class | Use it when | Cost |
|---|---|---|
| `Text` | Occasional labels, arbitrary fonts | Rasterises on change |
| `BitmapText` | Text that changes every frame — counters, timers, damage numbers | Pre-baked glyphs, near-free updates |
| `HTMLText` | Rich markup, mixed styling | Slowest; renders via SVG foreignObject |

If a value updates per frame, reach for `BitmapText`:

```ts
import { Assets, BitmapText } from "pixi.js";

await Assets.load("assets/font.fnt");
const score = new BitmapText({ text: "0", style: { fontFamily: "MyFont", fontSize: 24 } });
```

## Screen space vs world space

HUD elements must live **outside the camera container**, or camera scroll and
screen shake will drag the health bars around with the world:

```
stage
├── camera        world space — scrolls and shakes
│   └── ...
└── hud           screen space — never transformed
```

This is the most common Pixi UI bug, and it presents as "the HUD jitters when I
get hit", which sounds like a text-rendering problem and is not.

## In-canvas UI or a DOM overlay?

Both, split by what each is good at.

**Canvas (Pixi `Text`)** — anything that belongs to the game world or must sit
between game layers: floating damage numbers, nameplates, a status line over the
arena. It scales and shakes with the scene for free.

**DOM/React overlay** — menus, buttons, settings, anything with real layout,
input focus or accessibility needs. Absolutely positioned over the canvas:

```tsx
<div id="app">
  <GameCanvas />
  <div style={{ position: "absolute", top: 0, right: 0 }}>Bullets: {count}</div>
</div>
```

Text input, tab order, screen readers and responsive layout are solved problems
in the DOM and a large project in canvas. Do not rebuild them.

Bridge the two with a tiny dependency-free emitter rather than the engine's:

```ts
useEffect(() => EventBus.on("bullet-fired", () => setCount((c) => c + 1)), []);
```

Two things matter here. **Subscribe in an effect, not in the render body** — a
subscription during render adds a fresh listener on every state change, so the
counter accelerates with every event. And **keep the bus engine-free**: using the
renderer's own emitter makes the React layer depend on the rendering engine for
nothing more than a callback list, and every renderer swap drags the UI along
with it.
