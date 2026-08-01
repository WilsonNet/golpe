# Movement Mechanics

**Intent:** movement should feel snappy and deliberate — a fighter commits to a
jump, lands quickly, and never floats. Every surface in the arena must be
reachable from the surface below it.

Implemented in `src/game/simulation/Physics.ts` (`tickPlayer`), shared verbatim
by client and server.

## Design rule: jump first

The curve is solved jump-first. Pick the height a jump must clear, then derive
the velocity from the gravity:

```
JUMP_HEIGHT_PX = JUMP_VELOCITY² / (2 × GRAVITY) = 700² / 3600 = 136px
```

**Changing gravity or jump velocity changes level reachability.** Every ledge in
[arena.md](arena.md) sits within 136px of the surface below it, and a test
asserts this. Re-check the arena whenever these move.

It also changes **combat**: the uppercut's launch velocity is chosen relative to
the jump so that a launched fighter rises slightly *less* than they could jump.
Retuning the jump silently retunes what being launched feels like — see
[melee.md](melee.md).

## Basic movement

- **WASD**: W or **Space** = jump, A = left, D = right. **Every button is
  rebindable** from the Esc menu, and the dash follows whatever left and right
  are bound to — see [controls.md](controls.md).
- Walk speed: **220 px/s** — reached through acceleration, not assigned directly.
- Ground acceleration **2600 px/s²**, air acceleration **1800 px/s²**. Air
  control is deliberately weaker, so a jump is a commitment.
- Ground friction **2600 px/s²**, air friction **500 px/s²**. Momentum carries
  further in the air.
- Gravity: **1800 px/s²** rising, **×1.35** while falling. A heavier fall is the
  classic platformer "snap" — it removes the floaty apex.
- Terminal velocity: **950 px/s**.

## Aim and facing

**A fighter faces where it aims, always — the only exceptions are a swing's
startup and active frames, and being stunned.** Facing travels in the intent as
`face` (-1, 1, or 0 meaning "let the feet decide"), so the client and server
derive it from the same input on the same tick. See [melee.md](melee.md) for why
the two exceptions exist, and [combat.md](combat.md) for the shot that leaves
along the same angle.

**Where the aim angle comes from is the input layer's business, not the
simulation's.** With a mouse it is the vector to the cursor; with a controller it
is the Contra aim — eight directions from the d-pad, or the continuous angle of
an analog stick — overridden by the right stick's full 360°. The simulation is
handed a number with no provenance either way — which is why a player can switch
scheme mid-match and nothing desyncs. See [controls.md](controls.md).

**Within ~4.6° of straight up or down, `face` is 0 and the feet decide.** Without
the dead band `cos(-90°)` is a positive floating-point crumb and a fighter aiming
at the ceiling snaps to facing right; facing decides which side a guard covers,
so that frame is a free hit. It matters far more with a controller, where
straight up is a place players actually sit — one of the eight on a d-pad, or
wherever they hold an analog stick — than with a mouse where it is a pixel-wide
accident.

**The cursor is a screen fact and everything it is compared against is a world
fact.** The conversion divides by the *logical* view — 800x600, `app.screen` —
and adds the camera scroll. Dividing by `canvas.width` instead is the trap: with
`autoDensity` the backing store is the logical size times the device pixel ratio,
so on an ordinary 2x display every cursor position doubled. The fighter believed
the pointer was almost always to its right and below it, aim was up to **162°**
wrong, and shots left in a direction nobody had pointed at. Nothing in the AI vs
AI loop can see this — the bots hand the simulation an angle and never touch a
cursor — which is why `scripts/aim-probe.mjs` exists and why it runs at
`--dpr=2`.

## Jumping

- Jump velocity **−700 px/s**, giving a **136px** peak rise and roughly **0.70s**
  of airtime.
- **Jump height is analogue.** Releasing the button while still rising multiplies
  upward velocity by **0.45**, so a tap is a short hop (~73px) and a hold is a
  full jump. Anything driving the player — including the AI — must *hold* the
  button to get height.
- **Jump is edge-triggered.** A jump starts only on a press edge (`up` while it
  was not held last tick). A controller that never releases will never jump
  again.
- **Coyote time: 100ms.** You can still jump just after walking off a ledge.
- **Jump buffer: 120ms.** A jump pressed just before landing is honoured on
  touchdown — **once the air jump is spent**; see below.

### The double jump

**One extra jump while airborne** (`AIR_JUMPS = 1`), at **−620 px/s** — a 108px
rise against the ground jump's 136px.

- **Weaker than the first on purpose.** Equal jumps would make timing the ground
  jump pointless, because you would simply always have two of them. A shorter
  second one keeps the choice live: spend it to reach, or save it to recover.
- **Only landing refills it.** Notably *not* a wall jump, or a fighter could
  alternate the two up a single flat wall forever.
- **It is last in the chain.** A ground jump, then coyote time, then a wall jump,
  then this — so none of the better options ever spends it by accident, and a
  ground jump leaves it untouched.
- **It is cuttable**, like any other jump: release while rising for a shorter hop.
- **The air jump beats the jump buffer for the same press.** They want the same
  input and something has to win. A press in the air should always do something
  *now*, and a player who still has a double jump is not asking to land — so the
  buffer keeps its job only for a press made with nothing left to spend.
- Reachability goes up, as it must for anything that moves a fighter: every ledge
  is now trivially reachable. The arena's "within one jump of the surface below"
  rule is a floor, not a ceiling, so it still holds.

## Dash

- Double-tap **A** or **D** to dash that direction — or the d-pad, or flick the
  left stick, since the gesture is on the *action* and every device reaches it
  through the same four direction codes.
- Dash speed **1000 px/s**; double-tap window **300ms**; travel **160ms**;
  lockout **250ms**.
- A dash is an *impulse on the shared simulation* — it sets velocity, then
  normal physics and collision carry it. It is not a separate movement path.

### A dash in the air is a straight line

**While airborne and dashing, gravity is off and `vy` is pinned to zero.** The
fighter ends the dash at exactly the Y it started.

- **This is what makes the gesture aimable.** A dash that fell while it travelled
  was a dive, and how far it dropped depended on where in the jump arc it was
  thrown — so the same input crossed a different gap every time.
- **Grounded dashes keep gravity.** Gravity does nothing visible to a fighter
  standing on a floor, but it is what presses it *into* the floor, and contact is
  where `grounded` comes from. Suppressing it left a ground dash airborne on
  paper: unable to jump, with coyote time never starting because it never
  registered as grounded to begin with. A ground dash that carries off a ledge
  flattens out the moment it leaves.
- **Travel is deliberately shorter than the lockout.** The 90ms between them is
  the window gravity always gets, so no amount of chained dashing is level
  flight. Raise travel past the lockout and the fighter never comes down.
- **A jump, a wall, or being hit all end it.** Each sets or needs a vertical
  velocity the flat line would otherwise eat — most importantly the uppercut's
  launch, which arrives with stun and would have been silently cancelled.
- It changes reachability, like anything that moves a fighter: gaps that needed a
  jump can now be crossed flat. Only ever *more* reachable, never less.

**A dash is drawn with wind, not with more movement.** The dash is a burst of
speed with no other tell — the fighter is a flat line holding its Y — so the
renderer streams low-opacity streaks out of the trailing edge, tinted a cool
white-blue and additively blended so they read as speed without ever covering
the fighter or the arena behind it. Renderer-only (`MeleeFx`), driven from
`dashActiveTimer` and the direction of `vx` (never facing, which a fighter can
keep while dashing the other way); nothing about it reaches the simulation.

### Forgiveness

- **300ms, up from 200.** Dashing at the peak of a jump means releasing the
  direction you jumped with and landing both taps before the apex passes, and
  200ms made that genuinely hard while being comfortable standing still.
- The ceiling is deliberate stepping. Players tap a direction to take a single
  small step, roughly 350ms apart or slower, so a window much past 300 starts
  reading two intended steps as a dash — and an unwanted dash across the arena is
  a far worse failure than a missed one.
- Pinned by tests against a fake clock (`DoubleTapDash`), because a feel constant
  nothing pins gets retuned by accident.
- **The dash travels in the intent, like every other input.** Anything that
  moves a fighter has to be something *both* sides simulate. Applied straight to
  the client's predicted state and never sent, it was erased by the very next
  reconciliation: the server had no dash in its authoritative state, so it
  snapped the client back mid-dash. Only the double-tap *detection* is local —
  it is a gesture, not a button, so the input layer resolves it and hands the
  simulation a one-shot impulse.
- **A one-shot is delivered at the fixed-step boundary, not the rendered
  frame.** `dash` is the only one-shot in the intent — every other field is held
  button state, so it is the only one a frame can lose. A rendered frame runs
  zero physics steps whenever it is faster than one step: on a 120Hz+ display
  that is roughly half of all frames. A gesture consumed into such a frame was
  dropped on the floor — the player double-tapped and nothing happened, which
  read as a cooldown far longer than the 250ms lockout. The gesture therefore
  sits pending until the next fixed step actually pulls it. Measured at 8ms
  frames (52% zero-step): `scripts/dash-probe.mjs` went from 4/40 deliveries to
  30/30 for the same double-tap.
- **A dash is the only way to break away from an equal-speed opponent.** Walking
  backwards from someone who walks at your speed never opens a gap, which is why
  the AI could not disengage — and therefore never used the gun or the upper
  half of the arena — until it was given one.

## Wall interaction

- **Wall slide:** while airborne and pressing into a wall, fall speed is capped
  at **160 px/s**.
- **Wall jump:** press jump while airborne with wall contact. Launches **230
  px/s** away from the wall and **−640 px/s** up.
- **Steering lockout: 140ms** after a wall jump, so the launch actually carries
  you off the wall. Kept short deliberately — a long lockout feels like losing
  the controller, and too much horizontal push makes a wall unclimbable.
- **Wall coyote: 100ms**, so a wall jump does not need frame-perfect timing.
- World edges are wall-jumpable. Chained wall jumps can climb a flat wall.
- **Priority: ground jump wins over wall jump** when grounded.

## Stun and launch

Combat can take movement away, and it does so inside the same `tickPlayer` that
does everything else — never as a separate code path, or client and server would
disagree about who can move.

- **While stunned, all intent is discarded**: no walking, no jump, no attack, no
  block, no stance change. Gravity and collision continue as normal, so a
  stunned fighter still falls and still lands.
- **A launch is an impulse**, like a dash: the uppercut sets `vy = -620` and
  clears `grounded`, then ordinary physics carries the arc. The launch is
  deliberately weaker than a jump (−700), so being launched leaves you lower than
  you could have jumped — helpless, but not automatically thrown off the level.
- **Knockback is also just an impulse** on `vx`.

Because all three live in the replayed simulation state, prediction reconciles
them like any other physics. See [melee.md](melee.md) for what applies them and
[netcode.md](netcode.md) for why that matters.

## Collision

- Swept, axis-separated AABB (`Collision.moveAndCollide`): X resolves, then Y,
  each against the solids.
- Contact flags are valid **whether or not the actor is grounded**. Gating side
  collision on `!grounded` is what once let a walking player pass through every
  platform.
- Movement is sub-stepped at **12px** maximum, so nothing tunnels even at dash
  speed (1000 px/s) or at 20fps.
- A body must never end a tick inside solid geometry; the diagnostic asserts
  `collisionSummary.penetrationFrames == 0`.

## Not implemented

- **Crouch.** S is bound but does nothing.
- **Wall climb** — holding toward a wall to ascend, with a stamina drain. Wall
  *slide* and wall *jump* exist; climbing does not.
- **Landing bounce.** An earlier spec described a 0.4 bounce factor. No such
  behaviour exists and none is planned.
