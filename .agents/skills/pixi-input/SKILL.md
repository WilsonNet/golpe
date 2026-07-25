---
name: pixi-input
description: "Use when handling keyboard, mouse or pointer input in a PixiJS v8 game — DOM listeners for gameplay, Pixi's federated events for clickable objects, converting screen to world coordinates, and why edge detection belongs in the simulation rather than the input layer. Triggers on: keyboard, keydown, keyup, e.code, mouse, pointer, pointerdown, click, eventMode, interactive, hit area, cursor, world coordinates, input lag, double tap, dash, blur, stuck keys."
license: MIT
---

# PixiJS v8: Input

Pixi has no input manager. There are two mechanisms, for two different jobs.

## Gameplay input: DOM listeners

Movement, attacks and anything polled per tick should read raw DOM state:

```ts
const down = new Set<string>();
window.addEventListener("keydown", (e) => down.add(e.code));
window.addEventListener("keyup",   (e) => down.delete(e.code));
```

Use **`e.code`** (physical key: `"KeyA"`), not `e.key` (the character produced).
`e.key` changes with keyboard layout, so a French AZERTY player would find WASD
bound to nowhere.

**Always clear on blur.** A game with chorded inputs — several keys and mouse
buttons held at once — otherwise leaves them stuck down forever when the window
loses focus mid-action, and the character keeps swinging at nothing:

```ts
window.addEventListener("blur", () => { down.clear(); leftMouse = false; });
```

## Mouse buttons and the context menu

`pointerdown`/`pointerup` with `e.button`: `0` left, `1` middle, `2` right.
Right-click needs the context menu suppressed or holding it opens a menu:

```ts
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
```

## Screen to world coordinates

The canvas is usually letterboxed or CSS-scaled, so client pixels are not world
pixels:

```ts
const rect = canvas.getBoundingClientRect();
const worldX = ((e.clientX - rect.left) / rect.width)  * canvas.width;
const worldY = ((e.clientY - rect.top)  / rect.height) * canvas.height;
```

If the world is inside a camera container, also subtract the camera transform —
or use `container.toLocal(globalPoint)`.

## UI input: Pixi's federated events

For clickable objects, Pixi's own system does hit testing for you:

```ts
button.eventMode = "static";     // v8 name; `interactive = true` is deprecated
button.cursor = "pointer";
button.on("pointerdown", () => start());
```

`eventMode` values: `"none"` (ignored entirely, fastest), `"passive"` (children
interactive, self not), `"auto"`, `"static"` (interactive, does not move),
`"dynamic"` (interactive and moves, so it is hit-tested continuously).

Set `eventMode = "none"` on large decorative containers. Hit testing walks the
tree, and a full-screen background left interactive is a real per-pointer-move
cost.

## Edge detection belongs to the simulation

The input layer should record **what is currently held** and nothing else.

Analogue jump height, a slash that needs a press edge, a charged attack that
fires on release — those are all *simulation* rules. If the input layer also
detects edges, the client and server end up disagreeing about what a given
frame's input was, which is a desync that only shows up under load.

```ts
intent(): PlayerIntent {
  return {
    left:   this.isDown("KeyA"),
    right:  this.isDown("KeyD"),
    up:     this.isDown("KeyW"),      // held, not "just pressed"
    attack: this.leftMouse,           // raw, the sim finds the edge
  };
}
```

## The one exception: gestures

A double-tap dash is a *gesture*, not a button — there is no "dash" key whose
state could be sent. Detect it in the input layer and hand the simulation the
resulting impulse:

```ts
private notePress(code: string) {
  const now = performance.now();
  if (now - (this.lastPress[code] ?? -Infinity) < DOUBLE_TAP_MS) {
    this.pendingDash = code === "KeyA" ? -1 : 1;
    this.lastPress[code] = -Infinity;   // consume the pair
    return;
  }
  this.lastPress[code] = now;
}
```

Two details that are easy to get wrong: **ignore `e.repeat`**, or simply holding
a direction registers as a dash; and **consume the pair**, or every subsequent
tap chains another dash.
