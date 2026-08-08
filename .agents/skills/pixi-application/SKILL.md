---
name: pixi-application
description: "Use when creating, configuring, ticking, resizing or tearing down the PixiJS v8 Application — the renderer, the canvas and the game loop. Covers async init, ticker deltaMS vs deltaTime, resolution and autoDensity, mounting into React, and the Vite dep-optimiser trap that breaks Pixi on boot. Triggers on: pixi app, Application, app.init, canvas, ticker, game loop, deltaMS, resolution, devicePixelRatio, resize, destroy, renderer, boot, startup."
license: MIT
---

# PixiJS v8: Application and Loop

## Initialisation is async, and nothing works before it resolves

```ts
import { Application } from "pixi.js";

const app = new Application();
await app.init({
  width: 800,
  height: 600,
  background: 0x1d1f2a,
  antialias: false,
  roundPixels: true,               // crisp pixel art beats a smooth upscale
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,               // sets CSS size so `resolution` is invisible
});

parent.appendChild(app.canvas);    // v8: `app.canvas`, not `app.view`
```

**Options moved from the constructor to `init()` in v8**, and `init()` returns a
promise. Nothing — not even `renderer.generateTexture` — is valid until it
resolves, so every caller has to be async too. This is the single biggest
structural difference from Phaser, where `new Phaser.Game(config)` handed you a
usable object immediately.

## The ticker gives you a Ticker, not a delta

```ts
app.ticker.add((ticker) => {
  update(ticker.deltaMS);   // real elapsed milliseconds
});
```

- **`deltaMS`** — actual elapsed time in ms. This is what a fixed-timestep
  accumulator needs.
- **`deltaTime`** — a *multiplier relative to 60fps* (1.0 at 60fps, 2.0 at 30).
  Convenient for "move n pixels per frame", and wrong for anything that has to
  agree with a server.

Using `deltaTime` where `deltaMS` was meant makes the simulation run at a
different speed on every display. In a networked game that is a desync, not a
cosmetic bug.

Useful knobs: `app.ticker.maxFPS`, `app.ticker.minFPS`, and
`Ticker.shared.maxElapsedMS` (default 100) which clamps the delta after a tab has
been backgrounded.

## Teardown

```ts
app.ticker.remove(tick);
app.destroy(true, { children: true });   // true = also remove the canvas
```

Always remove your ticker callback before destroying; a stale callback that runs
against a destroyed renderer throws inside Pixi's internals, where the stack
trace tells you nothing about your own code.

## Mounting into React

Two traps, both caused by init being asynchronous:

1. **StrictMode mounts twice in development.** Two concurrent `startGame()` calls
   build two Applications, and whichever finishes last wins any global hooks —
   which is not necessarily the one that survives the unmount. Symptoms are
   maddening: a game that renders but whose debug hooks report a frozen, empty
   world, because they point at the instance that was destroyed.
2. **Unmount can happen mid-init.** The effect cleanup runs before the promise
   resolves, so the handle does not exist yet to be destroyed.

Serialise boots through a module-level promise chain and check a `disposed` flag
after the await:

```ts
let bootChain: Promise<void> = Promise.resolve();

useEffect(() => {
  let disposed = false;
  bootChain = bootChain.then(async () => {
    if (disposed) return;                 // first StrictMode pass bails here
    const handle = await startGame(host);
    if (disposed) { handle.destroy(); return; }
    gameRef.current = handle;
  });
  return () => {
    disposed = true;
    bootChain = bootChain.then(() => gameRef.current?.destroy());
  };
}, []);
```

## The React overlay is compiled

`babel-plugin-react-compiler` runs in both vite configs (dev and prod) through
`@vitejs/plugin-react`'s `reactCompilerPreset` + `@rolldown/plugin-babel`, so
every component and hook in `src/ui/` is memoised automatically — no
`useCallback`/`useMemo`/`memo()` needed in new code, and the hand-written ones
already in the tree are legacy. The preset's rolldown filter only compiles files
whose source looks like a component (`/\b(?:[A-Z]|use[A-Z0-9])/`), and its
`applyToEnvironmentHook` pins it to the client consumer so the server build
never sees it.

Two consequences to keep in mind:

1. **The compiler output calls `useMemoCache`** (inlining `react/compiler-runtime`,
   which the preset adds to `optimizeDeps.include`). Grep the built bundle for
   `useMemoCache` to prove a config change actually compiled — absence means the
   plugin silently stopped running.
2. **The Rules of Hooks are now enforced at build time.** A component that
   violates them makes the compiler refuse to compile the file (a build error),
   which is usually a real bug the linter was going to find anyway. A needed
   escape hatch is `compilationMode: "annotation"` on the preset, or excluding
   the file via the preset's `rolldown.filter`.

### The one thing the compiler breaks: reading an external store mid-render

The compiler memoises JSX on the values a render *reads*. A read straight off a
module singleton — `bindings.codesFor(action)`, `inputSettings.scheme` — is
invisible to it, so the block that read it freezes at whatever it computed on
first render, and the store's change events arriving at an unread `[, bump]`
state change nothing the JSX depends on. The controls dialog's reset button
kept showing the old key under exactly this pattern.

The fix is to make the store read *visible*: snapshot the store into state and
resubscribe —

```ts
const [bindingsMap, setBindingsMap] = useState(() => bindings.snapshot());
useEffect(() => bindings.subscribe(() => setBindingsMap(bindings.snapshot())), []);
```

— and ask the snapshot with a pure predicate exported next to the store
(`isDefaultBindings(map)`, `deckVisibleFor(settings, touch)`). The snapshot is
reactive state the compiler sees; the predicate keeps the question in one
place. A closure the compiler memoises may still trip Biome's
`useExhaustiveDependencies` (it cannot see the compiler); suppress it with a
*single-line* parameterised comment directly above the deps line —
`// biome-ignore lint/correctness/useExhaustiveDependencies(fn): closes over
setters only — the compiler memoises it stably.` Multi-line suppressions and
other placements are reported as unused.

## Vite: Pixi must exist exactly once

Pixi registers renderers and environment adapters through a **global extension
registry at import time**. Two module instances means two registrations, and the
app dies on boot with:

```
Error: Extension type environment already has a handler
```

Vite's dependency optimiser will happily split `pixi.js` across two dep chunks
and cause exactly this. Fix it in the config, not in the code:

```js
optimizeDeps: { include: ["pixi.js"] },
resolve:     { dedupe: ["pixi.js"] },
```

Delete `node_modules/.vite` after changing this, or the old split chunks are
served from cache.

**Related trap:** a cold optimiser cache makes Vite re-optimise on the first page
load and force a full reload. An automated harness that loads a page during that
window watches its own page reset underneath it, and reports a game that never
progresses. Warm the cache with one throwaway load before measuring anything.

## What Pixi does not give you

Coming from Phaser, these have no equivalent and are yours to build:

| Phaser | In Pixi |
|---|---|
| Scenes, Boot/Preloader lifecycle | Nothing. Initialise in a straight line: init → load → build → tick. |
| Physics bodies | Nothing. Keep the simulation separate — which is the right answer anyway. |
| Camera with scroll/shake/bounds | A `Container` you move. See `pixi-scene-graph`. |
| Particle emitters | Roll a pooled one, or add a library. See `pixi-effects`. |
| Input manager | DOM events, or Pixi's own event system. See `pixi-input`. |
| Tween manager | A library, or hand-rolled lerps on a timer. |
