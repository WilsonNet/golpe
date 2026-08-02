# Controls and Key Bindings

**Intent:** every button is the player's to choose, and choosing one is done by
*pressing it*. A fighting game is played with muscle memory; a control scheme
that cannot move to where the player's hands already are is a control scheme
that costs them the exchange.

**And every device is a first-class way to play.** A mouse, a gamepad, a laptop
trackpad and a thumb on a phone all reach the simulation as the same two things:
a set of buttons and an angle. Nothing downstream of the input layer knows which
one produced them.

Implemented in `src/game/input/` — `Bindings.ts` (the store), `Scheme.ts`
(mouse vs controller), `Aim.ts` (the two aim layers), `Gamepad.ts` (the pad),
`Input.ts` (the one place they meet) — plus `src/ui/PauseMenu.tsx` (the Esc menu
and the controls dialog) and `src/ui/TouchControls.tsx` (the on-screen gamepad).

## One alphabet

**A binding is a code string, and every device speaks the same namespace.**

| Device | Codes |
|---|---|
| Keyboard | `KeyboardEvent.code` — `KeyA`, `Space`, `ShiftLeft` |
| Mouse | `Mouse0`, `Mouse1`, `Mouse2` |
| Gamepad | `Pad0`…`Pad16`, and `PadUp`/`PadDown`/`PadLeft`/`PadRight` |
| On-screen gamepad | the same `Pad…` codes a real one sends |

That is what lets block move from right-click to Shift to the left trigger
without the input layer growing a code path per device, and lets a player move it
back. `Input.actionDown` asks "is any of my codes held", and that question has
one answer only if every device answers in the same alphabet.

**The d-pad and the left stick produce the same four direction codes.** The stick
goes through the eight-way quantiser first, so there is one movement path, and
the double-tap dash gesture works off a stick flick with no extra code. The stick
also keeps its raw deflection for the *aim* — see the Contra layer below. A d-pad
has no deflection, so it stays eight.

**Both halves of a physical d-pad button are never two codes.** Buttons 12–15 in
the standard mapping become `PadUp`…`PadRight` and never `Pad12`…`Pad15` — two
codes for one button would let a player bind it twice and have one binding
silently lose.

## Defaults

Three slots per action: a keyboard binding, an alternate, and a gamepad button.
The third slot is a *convention*, not a constraint.

| Action | Primary | Alternate | Gamepad |
|---|---|---|---|
| Move / aim left | **A** | **Left Arrow** | **Pad Left** |
| Move / aim right | **D** | **Right Arrow** | **Pad Right** |
| Aim up | **Up Arrow** | — | **Pad Up** |
| Aim down | **Down Arrow** | — | **Pad Down** |
| Jump / double jump | **W** | **Space** | **Pad A** |
| Slash / fire | **Left Click** | — | **Pad X** |
| Block | **Left Shift** | **Right Shift** | **Pad LT** |
| Uppercut | **F** | — | **Pad Y** |
| Ultimate — Black Hole | **R** | — | **Pad B** |
| Sword stance | **Q** | — | **Pad LB** |
| Gun stance | **E** | — | **Pad RB** |
| Toggle AI vs AI | **P** | — | — |

**The ultimate is R, and Pad B.** Every game with an ultimate put it on R and a
player's hand goes looking for it there. On a pad it is the right-hand face
button — the one a thumb hits deliberately rather than in passing, which is what
a button that spends a minute of earned charge in one press should require. See
[ultimate.md](ultimate.md).

**Block is Shift, not right-click.** A guard is held through a whole exchange
while the same hand aims and slashes, and holding a mouse button down removes the
button the other half of the fight is fought with. Both shifts are bound because
which one is under the hand depends on where the player's movement fingers live.
The same argument puts block on the left trigger and the stances on the shoulders
— the right thumb is busy on the face buttons.

**Jump is W *and* Space.** They are one action, so a double jump can be W then
Space. W keeps the WASD hand shape; Space is what a thumb reaches for unprompted.

**The arrow keys are the keyboard's d-pad.** Left and right double up with A/D;
up and down are the aim axis WASD has no room for.

**Dash is not a binding.** It is a gesture — double-tap left or right — so it
follows whatever those two actions are bound to on *any* device, including a
flick of the left stick. See [movement.md](movement.md).

**AI vs AI has no pad button on purpose.** It is a debug switch, and a stray
button flipping the whole match to bots would be a bug rather than a feature.

**Escape and Tab cannot be bound.** Escape closes the menu the rebind happens in
and Tab is the scoreboard; binding either would leave a player in a dialog they
can only escape by reloading.

## Aiming: two schemes

`Esc → Controls → Aiming` picks one, it is remembered in `localStorage`, and
**switching mid-match is safe** — the simulation is handed an angle and never
learns which device made it, so nothing about a scheme can desync.

A device with a real pointer starts on **Mouse**. A device whose primary pointer
is a finger (`pointer: coarse`) starts on **Controller**, because it is the only
scheme that is playable there at all.

### Mouse

**You face the cursor, always** — the only exceptions are a swing's startup and
active frames, and being stunned. `aimUp`/`aimDown` do nothing here; the cursor
answers both axes. See [movement.md](movement.md) for the screen→world conversion
and the pixel-ratio trap that hides in it.

### Controller

Two layers, and the second one wins.

**The Contra layer.** The d-pad, the left stick or the on-screen cross — the same
input that *moves* you, so the aim follows the run for free and there is nothing
extra to hold. Horizontal aim is left/right; vertical is `aimUp` and `aimDown`.
There is deliberately no `aimLeft`/`aimRight`: that is the whole scheme, and
aiming away from where you are running is the other layer's job.

**An analog source is analog.** The left stick and the deck's cross aim at the
exact angle they are pushed: a stick tilted at 30° aims at 30°, not at the
nearest of eight. The *movement* codes stay quantised — walking is still left or
right — but the aim follows the deflection, so a stick has more directions than a
d-pad has fingers. Only a d-pad, or the arrow keys feeding the same {-1, 0, 1}
pairs, resolves to exactly eight.

**Releasing the d-pad keeps the last direction.** Letting go should not make a
fighter forget which way it was looking. Before anything has been aimed, the aim
is along the fighter's facing.

**The fine layer.** The right stick, **full 360°**, at whatever angle it is
pushed. It overrides the Contra aim entirely, which is what lets a fighter run
right and cover the door on the left. Below a **0.25** deadzone the stick is at
rest and has no say — generous, because a worn stick resting at 0.12 would hold
the override open forever and read as "aiming is broken" rather than "my
controller is old".

**The aim is drawn.** A short, translucent beam leaves the local fighter's chest
along the aim angle: **gold** for the Contra aim, **cyan** while the fine
layer is overriding, blending between the two as the handover runs. It exists
because a controller has no cursor — the only other feedback for the Contra aim
and a full 360° of fine aim was which way the sprite faced, and facing is one bit.
It is drawn **only in controller mode**; in mouse mode the cursor already is the
reticle, and a second one a few hundred pixels away would be worse than none.

**Aiming straight up or down does not turn the fighter.** Within ~4.6° of
vertical, `face` is 0 — the intent's existing "let the feet decide" — because
`cos(-90°)` is a positive floating-point crumb and a fighter that snapped to
facing right every time it aimed at the ceiling would be giving away free hits.
Straight up is a place players sit — one of the eight on a d-pad, or wherever
they hold an analog stick — so the dead band is what a controller needs.

#### The handover back

- A **physical stick recentres itself**, so letting go is unambiguous: the
  handover starts at once.
- A **mouse has no spring**, so a hold window decides. The fine aim survives
  **900ms** after the last movement — long enough to aim, fire and re-aim without
  the Contra aim snatching the reticle back mid-exchange.
- Either way the fall back is **eased over 260ms**, not snapped. A snap is a
  frame facing somewhere nobody chose, and facing decides which side a guard
  covers.
- Once it has fully handed back, the virtual stick **recentres**. The next stroke
  must leave from the centre, or the same flick would give a different angle
  every time.

#### The mouse as a right stick

For a trackpad — the reason controller mode exists on a laptop at all — mouse
*movement* drives the fine layer, relatively. This is prior art, not an
invention: it is what Steam Input ships as its **Mouse Joystick** style, and the
rim behaviour is what **Flick Stick** calls rotating along the gate.

- **90px of pointer travel** pushes the virtual stick from centre to rim. That is
  the sensitivity knob, and it is roughly one comfortable trackpad stroke.
- **Inside the gate**, movement accumulates and is clamped at the rim.
- **At the rim**, the delta is split into radial and tangential parts. The
  tangential part *rotates* the stick — one radius of tangential travel is one
  radian — and only an inward radial push pulls it back off the rim. Pushing
  outward does nothing: a gate does not give.

**The rim case is the whole feature.** Plain accumulation with a clamp looks
correct and is not: aim right, then slide up one radius at a time, and you get
45°, 63°, 71° — it crawls towards straight up and the player gives up before it
arrives. Rotating along the rim gives 57°, then 88°, then vertical, and carries
on round the circle as long as the stroke keeps curving. Every one of the 360° is
reachable.

**It is relative on purpose.** An absolute cursor cannot express "keep turning":
it runs out of screen, and on a trackpad it runs out of glass long before that.

**A finger is not a trackpad.** This layer is driven only by pointers whose
`pointerType` is `mouse`. `movementX`/`movementY` are populated for *touch*
pointers too, so without the filter every thumb sliding across the on-screen
d-pad also shoved the virtual stick: holding **left** while dragging **right**
aimed right — 180° from what the thumb was pressing. A touchscreen has the deck's
own thumb pad for fine aim, and it is absolute.

## The on-screen gamepad

`Esc → Controls → On-screen gamepad` is a **separate setting** from the aiming
scheme, and that separation is the point: somebody can pair a Bluetooth keyboard
and mouse to a phone, and that player must be able to send the deck away.

- **Auto** — drawn when a finger is the primary pointer *and* aiming is set to
  Controller.
- **On** / **Off** — say so explicitly.

**In portrait it is a handheld.** A 4:3 game on a portrait phone leaves the
bottom half of the screen empty, and the shape that fills it — screen up top,
cross on the left, face buttons on the right, a wordmark between them — is a Game
Boy. Borrowing the silhouette means a player knows where their thumbs go before
reading a label. The wordmark is the game's, and the palette is the game's:
charcoal-plum shell, gold trim.

**The screen has no bezel.** The handheld this borrows from has a thick plastic
surround; a phone cannot afford one. The arena is a fixed 800x600 scaled to fit,
so every pixel spent on a frame is arena the player cannot see — and on a 390px
screen, 20px of padding is 5% of the fight. The canvas goes edge to edge and the
shell starts where it ends.

**In landscape the shell dissolves.** There is no room below the game, so the
clusters pin into the two letterbox margins a 4:3 canvas leaves beside itself on
a 16:9 screen — which is where thumbs already are. Same DOM, placed by grid area,
so a rotation cannot drop a button a thumb is holding.

**The cross is one element, not four buttons, and it is an analog stick, not a
d-pad.** A thumb rolling from left to up-left has to stay on the control the
whole way, and four adjacent buttons each with their own hit test drop the input
in the gap between them. It is the deck's *left stick*: the movement sector comes
from the same eight-way quantiser a physical left stick goes through, and the raw
thumb position is the analog Contra aim — a thumb at 30° aims at 30°, not at the
nearest of eight. It is drawn as a round pad with a nub that follows the thumb,
because that is what it is; it used to be drawn as a d-pad and read as one.

**The thumb pad is absolute**, like a real right stick: the vector is where the
thumb sits relative to the pad's centre, clamped to the rim, and it recentres the
instant it is let go.

**In gun mode the thumb pad fires too.** On a phone the right thumb lives on it,
and there is no spare finger for the fire button on the face cluster — so while
the stance is gun, holding the pad aims *and* fires, and a phone gun plays as a
twin-stick shooter. It is the on-screen pad only, and gun mode only: a physical
right stick has a trigger to hand, and in sword mode a touch of the pad must not
slash. Like everything else here it reaches the simulation as the `attack`
button, never as a thumb, so it cannot desync anything.

**Each stance draws its own buttons.** Block and uppercut are sword moves and do
nothing in gun stance, so in gun mode the deck does not draw them — a dead button
on a phone is a thumb spent on nothing. Slash survives both, as the gun's fire
button. The stance is owned by `Input` and announced over `stance-changed`, and a
button that stops being drawn releases its code, so a fighter never keeps
blocking while the deck it blocked with has gone away.

**The deck emits codes, not actions.** A thumb on the slash button sends `Pad2` —
exactly what a real controller's X button sends — so it is rebindable for free
and shares one code path with everything else. A player who moves block off the
left trigger moves it off this deck's block button too.

**It carries its own menu button**, because a phone has no Escape key. Without
it, choosing the on-screen gamepad on a phone would be a decision that could not
be undone.

**A press on the deck is not a press at the fighter.** `Input` listens for
`pointerdown` on `window` — it has to, so a drag that starts on the canvas keeps
being tracked when it leaves — and button 0 is `Mouse0`, which is *attack*. The
deck is DOM on that same window, so every one of its buttons swung the sword as
well as doing its own job: Jump jumped and slashed, the stance pills slashed, the
menu button slashed. `preventDefault` in the deck's own handler cannot fix it —
it stops the browser's default, not another listener on the same event. Only a
press whose target *is the canvas* reaches the fighter.

## Rebinding

- **Three slots per action.** An action with none simply cannot be performed —
  that is allowed, and right-clicking a slot is how it is done.
- **One code, one action.** Binding a code that another action holds takes it
  away from that action, and the dialog says which one it took it from. A rebind
  that silently unbinds something else is how a player ends up unable to jump
  with no idea why.
- **The dialog captures the button, it does not read a name.** Click a slot, then
  press a key, a mouse button or a **gamepad button**. Escape cancels. The pad is
  *polled* while the dialog listens, because it is the one device with no button
  events — and the poll is seeded from what is already held, so a trigger still
  down from opening the menu does not bind itself.
- **Reset to defaults** restores every action at once.
- Bindings live in `localStorage` under `vento.bindings`, the aiming scheme and
  the deck setting under `vento.input`. A stored value that is corrupt,
  incomplete, or names an action this build no longer has falls back per-action
  to the default rather than costing the player the rest of their bindings.

## The Esc menu

**Escape opens a menu; it does not pause the game.** The server is authoritative
and up to fifteen other fighters are still swinging — a client that stopped
simulating would only rubber-band back into a fight it stopped watching. The menu
says so.

**What it does take is every input device.** While it is open the game receives
no keys, no mouse buttons, **no gamepad buttons and nothing from the deck**,
announced as `input-suspended` on the EventBus, and everything held is released.
Without it, choosing `S` for block walks the fighter while the player is choosing
it, and a held trigger would keep blocking behind the dialog with nothing to ever
deliver its release.

The menu does not open over the name prompt: that modal owns the keyboard until
it is answered.

## Rules that bite

- **Bindings and schemes never reach the wire.** The simulation is handed buttons
  and an angle — `PlayerIntent` says `block`, never `ShiftLeft`, and `aimAngle`
  is a number with no provenance — so none of this can desync anything, and the
  server never learns what a client is holding.
- **The gamepad has no events.** It is polled once per frame in `Input.poll`, and
  press edges are derived against the previous frame's set. Without that, a held
  button reads as a press sixty times a second and simply holding a direction
  counts as a dash.
- **`Input.poll` runs before anything reads an aim or an intent.** It is also
  what advances the aim handover by one frame, so ticking it later would spend a
  frame of the hold on input that had not arrived.
- **Codes bound to a move have their browser default suppressed.** Space scrolls
  the page, Shift starts a text selection, and the arrows scroll too.
- **A DOM overlay that takes focus must suspend input**, or the canvas keeps
  reading keys meant for a field. See [`docs/invariants.md`].
- **Nothing in the AI vs AI loop presses anything.** The brains hand the
  simulation an intent and an angle directly, so a broken binding, a broken pad
  mapping and a broken aim layer are all invisible to `diagnose.mjs`.

## Measuring it

```bash
node scripts/controls-probe.mjs   # keys, the Esc menu, and a rebind that sticks
node scripts/pad-probe.mjs        # the two aim layers, the pad, and the deck
```

`controls-probe.mjs` presses real keys at a real browser: that Shift blocks and
right-click does not, that Space and W both clear a jump, that the Esc menu stops
a held key moving the fighter, and that a rebind made by pressing a key at the
dialog reaches the simulation, survives a reload, and is undone by *Reset to
defaults*.

`pad-probe.mjs` stubs `navigator.getGamepads` — a polled API, so a stub is
genuinely equivalent from the game's point of view — and measures the claims
controller mode is made of: that the d-pad aims in eight directions and moves you
with the same input while the **left stick aims continuously** (a push at 30° must
land on 30°, not the nearest diagonal), that the right stick overrides at any
angle, that letting go falls back, and that a mouse stroke **runs up the arc**
past 45° instead of crawling at it.

It then runs the deck on a phone-shaped context and taps it, the same way
`controls-probe.mjs` presses real keys — using **CDP touch events, never
`page.mouse`**. The two are not interchangeable here: `page.mouse` reports
`pointerType: "mouse"` even inside a touch context, which is the exact field the
relative-mouse filter reads, so a probe driven by it is blind to every bug in
that filter. The check that catches them slides a thumb *rightward along the left
arm of the cross*, because a drag toward an arm pushes the virtual stick the same
way the arm points and the two agree by accident; only a press and a travel that
disagree can tell a correct build from a broken one.
