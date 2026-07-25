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

- **WASD**: W = jump, A = left, D = right, S = down.
- Walk speed: **220 px/s** — reached through acceleration, not assigned directly.
- Ground acceleration **2600 px/s²**, air acceleration **1800 px/s²**. Air
  control is deliberately weaker, so a jump is a commitment.
- Ground friction **2600 px/s²**, air friction **500 px/s²**. Momentum carries
  further in the air.
- Gravity: **1800 px/s²** rising, **×1.35** while falling. A heavier fall is the
  classic platformer "snap" — it removes the floaty apex.
- Terminal velocity: **950 px/s**.

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
  touchdown.

## Dash

- Double-tap **A** or **D** to dash that direction.
- Dash speed **1000 px/s**; double-tap window **200ms**; lockout **250ms**.
- A dash is an *impulse on the shared simulation* — it sets velocity, then
  normal physics and collision carry it. It is not a separate movement path.

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
