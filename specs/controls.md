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
and the controls dialog) and `src/ui/TouchControls.tsx` (the two-thumb deck).

## One alphabet

**A binding is a code string, and every device speaks the same namespace.**

| Device | Codes |
|---|---|
| Keyboard | `KeyboardEvent.code` — `KeyA`, `Space`, `ShiftLeft` |
| Mouse | `Mouse0`, `Mouse1`, `Mouse2` |
| Gamepad | `Pad0`…`Pad16`, and `PadUp`/`PadDown`/`PadLeft`/`PadRight` |
| On-screen deck | **actions**, not codes — a painted control is already a binding |

That is what lets block move from right-click to Shift to the left trigger
without the input layer growing a code path per device, and lets a player move it
back. `Input.actionDown` asks "is any of my codes held", and that question has
one answer only if every device answers in the same alphabet.

**The on-screen deck is the exception, and it is a deliberate one.** A painted
control is already a binding — the button that says Guard is the guard — so the
deck sends actions rather than fake pad codes. The two roads meet at
`actionDown`, which is the layer the simulation already consumes; nothing
downstream can tell a thumb from a key.

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
| Jump / double jump | **Space** | — | **Pad A** |
| Slash / fire | **Left Click** | — | **Pad X** |
| Block | **Left Shift** | **Right Shift** | **Pad LT** |
| Uppercut | **W** | — | **Pad Y** |
| Item | **F** | — | **Pad RT** |
| Ultimate | **R** | — | **Pad B** |
| Sword stance | **Q** | — | **Pad LB** |
| Gun stance | **E** | — | **Pad RB** |
| Toggle AI vs AI | **P** | — | — |

**The buttons are the skeleton; the hero decides what they do in the melee
stance.** Lia's Shift raises a guard and her W is the uppercut. Anands'
Shift is the **thrust** — the dagger has no block, and the whole of that trade is
that the block button is a committed lunge — and her W is the shoryuken. The
simulation is handed the same buttons either way, so a binding never knows or
cares which hero is using it; the HUD badge names the weapon the hero actually
carries. See [anands.md](anands.md).

**F is the item, and it is not a sword move.** The item is the third member of
the kit (Lia's HE grenade, Anands' trap — see [items.md](items.md)), so it works
in both stances, and the deck draws its button in both. The uppercut lives on W
— the top of the WASD movement hand — so the item took F for the same reason
the uppercut used to live there: both are one-finger commitments, and the move
hand's other fingers stay on walk and jump.
The use is decided on the press — the aim angle of the press *is* the throw —
so F is a tap, never a hold, unlike the ultimate's hold-to-release.

**The Esc menu has a Heroes item** beside Controls — changing hero mid-match
sends the request to the server, which confirms it in the next snapshot. The
root menu's hero picker sets the default every match starts with. See
[heroes.md](heroes.md).

**The ultimate is R, and Pad B.** Every game with an ultimate put it on R and a
player's hand goes looking for it there. On a pad it is the right-hand face
button — the one a thumb hits deliberately rather than in passing, which is what
a button that spends a minute of earned charge should require. The cast is
decided at the **release** of the hold: pressing R is the aim phase (the arc
comes up), releasing R is the cast. See [ultimate.md](ultimate.md).

**Block is Shift, not right-click.** A guard is held through a whole exchange
while the same hand aims and slashes, and holding a mouse button down removes the
button the other half of the fight is fought with. Both shifts are bound because
which one is under the hand depends on where the player's movement fingers live.
The same argument puts block on the left trigger and the stances on the shoulders
— the right thumb is busy on the face buttons.

**Jump is Space.** Space is what every player's thumb reaches for without being
told, and it is the one key the movement hand is not resting on. W — the top of
the WASD hand — is the uppercut instead: a punch fired without leaving the
hand's movement shape, so a double jump is Space then Space — or whatever a
player binds it to.

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

**The Contra layer.** The d-pad or the left stick — the same input that *moves*
you, so the aim follows the run for free and there is nothing extra to hold.
Horizontal aim is left/right; vertical is `aimUp` and `aimDown`. There is
deliberately no `aimLeft`/`aimRight`: that is the whole scheme, and aiming away
from where you are running is the other layer's job.

**An analog source is analog.** The left stick aims at the exact angle it is
pushed: a stick tilted at 30° aims at 30°, not at the nearest of eight. The
*movement* codes stay quantised — walking is still left or right — but the aim
follows the deflection, so a stick has more directions than a d-pad has fingers.
Only a d-pad, or the arrow keys feeding the same {-1, 0, 1} pairs, resolves to
exactly eight. **The deck's left hand is a one-axis rocker**, so it feeds the
same horizontal fallback and a swordfighter faces the way it walks; the gun and
the throwables take their angle from the drag on the button that fires or throws
them (the fine layer below).

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
own aim drag for fine aim, and it is absolute.

## The on-screen deck

`Esc → Controls → On-screen deck` is a **separate setting** from the aiming
scheme, and that separation is the point: somebody can pair a Bluetooth keyboard
and mouse to a phone, and that player must be able to send the deck away.

- **Auto** — drawn when a finger is the primary pointer *and* aiming is set to
  Controller.
- **On** / **Off** — say so explicitly.

**It is a two-thumb layout, and the split is by hand, not by console
convention.** The old deck gave one thumb six controls — aim, slash, jump,
block, uppercut, item — and put the other thumb on movement plus the stance
pills. A phone has one contact point per thumb, so the butterfly (guard + attack
at 6Hz), a charged Massive + jump (the plunge bomb), charge + guard, and
retreat-fire were all *physically impossible*, not merely awkward. The deck is
now the desktop split: **the left hand moves and defends; the right hand wields
and aims.**

**The left hand — feet and defence.**

- **Move rocker.** One horizontal axis, full speed from the first 14px, with an
  8px release hysteresis so a thumb parked on the line cannot stutter. Movement
  in the simulation is binary, so a rocker is more precise than a 360° stick
  for this game.
- **Jump cap.** The top 44px of the pad is a jump band, and the horizontal
  position still steers while the thumb is in it: a running jump is one thumb
  movement. The cap is the same 44px the maths uses (`JUMP_BAND_PX`), and the
  boundary is computed from the pad's real height, so the cap a player sees is
  the cap that jumps on every screen.
- **A tap jump is a full jump.** The simulation cuts a jump on release, and a
  70-100ms phone tap produced a 76px hop out of a 136px jump. The deck holds the
  jump action for **320ms** after the thumb leaves — just short of the jump's
  389ms apex — so a tap reaches ~93% of full height (the probe measures 127px of
  136). The latch is a floor, not a ceiling: a short hop is not available from a
  tap. A second tap inside the latch **flushes the release and re-presses**, so
  the natural 100-250ms double-jump rhythm spends the air jump instead of being
  swallowed. This is an input-layer latch; both sides simulate the same button.
- **Guard.** A **hold**, on the left, opposite the weapon thumb. It is not a
  toggle: the simulation re-raises a held guard after your own swing, and a
  toggle would turn the block-cancel press into an off-switch. The butterfly is
  therefore two thumbs tapping in place, exactly the desktop rhythm. Anands'
  dagger has no guard; the same control becomes **Thrust**, a tap, and the label
  comes from the kit.
- **Guard-walk.** If the thumb leaves the pad to hold Guard, the last direction
  is latched while the guard is held (a guard is still a walk at 55% speed). It
  only latches a direction from within **450ms** of the thumb leaving the pad —
  the release is what stamps the time, so a normal-length walk still counts —
  and pressing Guard while standing still must not start the fighter walking.
- **Dash.** A dedicated one-shot beside Guard, with the direction taken from the
  last recent movement or the facing. It is on the left because dash-slash is a
  real technique and the weapon thumb must not leave the weapon. The 300ms
  double-tap on the rocker remains an alias, not the only way to dash.

**The right hand — weapon, aim, kit.**

- **The weapon button is the thumb's home.** Tap for the kit's attack (the
  sword's slash, the dagger's stab, the viking sword's hew), hold for the kit's
  charge move (the **Massive** or the **Sunder**) — the ring shows the charge.
  In gun stance it is a **press-drag trigger**: press to fire, drag to aim,
  release to stop. That is what lets a two-thumb player run one way and shoot
  the other. Ibiriki's axe is the same gesture with a throw charge and no
  reload. The button shows the magazine and the reload ring, or the axe count
  and its charge; a dry gun reads DRY in the HUD.
- **Aim belongs to the action that needs it.** The sword consumes only the
  *sign* of the aim, so its facing comes from the feet. The gun aims from the
  button that fires it. The item and the ultimate are **press-drag-release** on
  their own buttons. The ultimate arms after a **260ms** hold, so a brush spends
  nothing; while it is armed the left thumb is free to reposition. The item is
  used on the press edge server-side, so the deck withholds its press until the
  thumb comes up and holds it for 90ms — the angle the player released on is the
  angle that is used. A **cancelled touch** (`pointercancel`, an OS gesture) does
  not cast the ultimate: the server's hold is kept and the next press/release can
  cast, so a 60-second resource is never spent by an interrupted finger.
- **Uppercut and Item** sit in the column beside the weapon; **stance** is the
  two-segment switch above them. A control that the stance makes unavailable is
  drawn disabled and releases anything it was holding, so a thumb never leaves
  a code down behind a button that has gone away.
- **Aim assist** is a narrow, visible option (`Esc → Controls → Mobile aim
  assist`). In **sword stance only**, against a living hostile within **240px**,
  it turns the angle toward that foe when the player has asked for a facing:
  a **held attack** turns at any angle, even while running — the retreat-slash a
  cursor gives desktop; a **guard** turns at any angle; a **standing** fighter
  turns only within 80°, so an enemy behind cannot spin them; a walking fighter
  who is not attacking keeps the feet's direction; a live aim drag always wins;
  the gun is never assisted. It changes only the **aim angle** handed to the
  simulation — read as `face` in sword stance — and the server never learns a
  thumb was helped. It is gated to a coarse-pointer device in controller mode
  with no paired pad, so a mouse or a gamepad never gains it, and the setting
  can turn it off.

**The deck is an overlay, not a handheld.** The 4:3 canvas keeps the page. The
hands float over the bottom corners inside the safe area, translucent enough to
see the arena through them; in landscape they lap the letterbox margins and the
canvas's bottom corners, and the middle of the arena is always clear. In
portrait the canvas sits at the top and the hands at the bottom, where thumbs
actually rest — not in a plastic slab halfway up the phone with the bottom sixth
empty. Every target is at least 44px (the weapon button 96+, the move pad
120x130+), the coach's *Got it* is 44px, and the coach is laid out so it cannot
cover either hand. No two hit areas overlap. In a one-screen room the camera
cannot scroll a fighter out from under a hand, so the hand the fighter is
standing under **fades to just under half** — the buttons still take the touch and come
back when the feet move — driven by the local fighter's screen position in
`hud-state`. A probe can stand in for a notch with `?safe=top,right,bottom,left`.

**It speaks actions, not pad codes.** A painted control is already a binding:
the button that says Guard *is* the guard. Emitting `Pad6` meant rebinding block
to `Pad1` silently turned the deck's Guard into the ultimate and left guard
unreachable. The deck now emits actions (`block`, `attack`, …) and joins the
input layer at `actionDown`, beside the AI brain's intents; physical keys, mouse
buttons and pad buttons still share one code alphabet. A press is a press edge
for the actions that own one (stance, the double-tap dash) and held state for
everything else, so the simulation still sees one `PlayerIntent`.

**It carries its own menu button**, because a phone has no Escape key. It opens
on `pointerup` and a tick later — not `pointerdown`: opening on pointerdown let
the compatibility click after `touchend` land on the card that had just mounted
under the finger (in portrait, that was Heroes), and `click` alone is not
synthesised while another thumb is still holding a button, so a guard hold could
not pause. Suspending input remounts the deck's controls, so a held button whose
pointerup the menu ate cannot leave a code down.

**A press on the deck is not a press at the fighter.** `Input` listens for
`pointerdown` on `window` — it has to, so a drag that starts on the canvas keeps
being tracked when it leaves — and button 0 is `Mouse0`, which is *attack*. The
deck is DOM on that same window, so every one of its buttons swung the sword as
well as doing its own job: Jump jumped and slashed, the stance pills slashed, the
menu button slashed. `preventDefault` in the deck's own handler cannot fix it —
it stops the browser's default, not another listener on the same event. Only a
press whose target *is the canvas* reaches the fighter.

**First run gets a coach, not a manual.** A non-blocking card names the three
things a thumb must know (move and push up to jump; Guard is on the left; drag
the gun to aim), remembers that it was seen, and gets out of the fight. The
Controls dialog carries the same legend.

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
- Bindings live in `localStorage` under `golpe.bindings`; the aiming scheme,
  the deck setting and the mobile aim-assist setting live under `golpe.input`. A stored value that is corrupt,
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
  mapping and a broken aim layer are all invisible to `diagnose.ts`.

## Measuring it

```bash
tsx scripts/controls-probe.ts   # keys, the Esc menu, and a rebind that sticks
tsx scripts/pad-probe.ts        # the two aim layers and the physical pad
tsx scripts/deck-probe.ts       # the two-thumb deck: layout and real sequences
```

`controls-probe.ts` presses real keys at a real browser: that Shift blocks and
right-click does not, that Space and W both clear a jump, that the Esc menu stops
a held key moving the fighter, and that a rebind made by pressing a key at the
dialog reaches the simulation, survives a reload, and is undone by *Reset to
defaults*.

`pad-probe.ts` stubs `navigator.getGamepads` — a polled API, so a stub is
genuinely equivalent from the game's point of view — and measures the claims
controller mode is made of: that the d-pad aims in eight directions and moves you
with the same input while the **left stick aims continuously** (a push at 30° must
land on 30°, not the nearest diagonal), that the right stick overrides at any
angle, that letting go falls back, and that a mouse stroke **runs up the arc**
past 45° instead of crawling at it.

`deck-probe.ts` runs the deck on phone-shaped contexts — landscape, portrait,
16:9 and a notched safe area — and taps it with **CDP touch events, never
`page.mouse`**. The two are not interchangeable here: `page.mouse` reports
`pointerType: "mouse"` even inside a touch context, which is the exact field the
relative-mouse filter reads, so a probe driven by it is blind to every bug in
that filter. It measures the layout gates (44px targets, no overlaps, safe area,
clear centre lane, no scroll, the coach's 44px button and no overlap with the
hands, six phone sizes) and the sequences that define the deck: move + attack,
the three-link chain, the butterfly, guard-walk, a charged Massive into a plunge
bomb, a tap jump near full height, a fast double jump, retreat-fire, item and
ultimate drag-aim (and an off-centre tap that must use the facing), no stuck
holds, the menu's click-through, turning the deck Off without losing the menu,
and press-to-simulation latency.
