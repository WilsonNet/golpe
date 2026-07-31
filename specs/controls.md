# Controls and Key Bindings

**Intent:** every button is the player's to choose, and choosing one is done by
*pressing it*. A fighting game is played with muscle memory; a control scheme
that cannot move to where the player's hands already are is a control scheme
that costs them the exchange.

Implemented in `src/game/input/Bindings.ts` (the store) and
`src/ui/PauseMenu.tsx` (the Esc menu and the controls dialog).
`src/game/input/Input.ts` reads the store and knows no key names of its own.

## Defaults

| Action | Primary | Alternate |
|---|---|---|
| Move left | **A** | — |
| Move right | **D** | — |
| Jump / double jump | **W** | **Space** |
| Slash / fire | **Left Click** | — |
| Block | **Left Shift** | **Right Shift** |
| Uppercut | **F** | — |
| Sword stance | **Q** | — |
| Gun stance | **E** | — |
| Toggle AI vs AI | **P** | — |

**Block is Shift, not right-click.** A guard is held through a whole exchange
while the same hand aims and slashes, and holding a mouse button down removes the
button the other half of the fight is fought with. Both shifts are bound because
which one is under the hand depends on where the player's movement fingers live.

**Jump is W *and* Space.** They are one action, so a double jump can be W then
Space. W keeps the WASD hand shape; Space is what a thumb reaches for unprompted.

**Dash is not a binding.** It is a gesture — double-tap left or right — so it
follows whatever those two actions are bound to, and rebinding movement rebinds
the dash with it. See [movement.md](movement.md).

**Escape and Tab cannot be bound.** Escape closes the menu the rebind happens in
and Tab is the scoreboard; binding either would leave a player in a dialog they
can only escape by reloading.

## Rebinding

- **Two slots per action**, a primary and an alternate. An action with neither
  simply cannot be performed — that is allowed, and right-clicking a slot is how
  it is done.
- **One code, one action.** Binding a key that another action holds takes it away
  from that action, and the dialog says which one it took it from. A rebind that
  silently unbinds something else is how a player ends up unable to jump with no
  idea why.
- **The dialog captures the button, it does not read a name.** Click a slot, press
  a key or a mouse button, and that is the binding. Escape cancels.
- **Mouse buttons and keys share one namespace** — `Mouse0`/`Mouse1`/`Mouse2`
  beside `KeyboardEvent.code`. That is what lets block move to Shift and back
  without the input layer growing a second code path.
- **Reset to defaults** restores every action at once.
- Bindings live in `localStorage` under `vento.bindings` and are re-read on every
  load. A stored map that is corrupt, incomplete, or names an action this build
  no longer has falls back per-action to the default rather than costing the
  player the rest of their bindings.

## The Esc menu

**Escape opens a menu; it does not pause the game.** The server is authoritative
and up to fifteen other fighters are still swinging — a client that stopped
simulating would only rubber-band back into a fight it stopped watching. The menu
says so.

**What it does take is the keyboard.** While it is open the game receives no
keys and no mouse buttons, announced as `input-suspended` on the EventBus, and
everything held is released. Without it, choosing `S` for block walks the fighter
while the player is choosing it, and clicking *Reset to defaults* swings the
sword. Anything held when the menu opens would otherwise never deliver its keyup
and would stay down forever.

The menu does not open over the name prompt: that modal owns the keyboard until
it is answered.

## Rules that bite

- **Bindings never reach the wire.** The simulation is handed buttons, not keys —
  `PlayerIntent` says `block`, never `ShiftLeft` — so rebinding cannot desync
  anything, and the server never learns what a client's keyboard looks like.
- **Codes bound to a move have their browser default suppressed.** Space scrolls
  the page and Shift starts a text selection otherwise.
- **A DOM overlay that takes focus must suspend input**, or the canvas keeps
  reading keys that were meant for a field. See [`docs/invariants.md`].
- **Nothing in the AI vs AI loop presses a key.** The brains hand the simulation
  an intent directly, so a broken binding is invisible to `diagnose.mjs` in
  exactly the way a broken cursor was. Bindings are measured with
  `scripts/controls-probe.mjs`.

## Measuring it

```bash
node scripts/controls-probe.mjs
```

Presses real keys at a real browser and reads the simulation state back: that
Shift blocks and right-click does not, that Space and W both clear a jump, that
the Esc menu stops a held key moving the fighter, and that a rebind made by
pressing a key at the dialog reaches the simulation, survives a reload, and is
undone by *Reset to defaults*.
