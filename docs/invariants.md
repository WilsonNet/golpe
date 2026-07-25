# Invariants

**Every rule here was written by a real bug.** Breaking one reintroduces a defect
that took measurement to find, so each entry states the rule *and* what happened
without it — the war story is the part that makes the rule stick.

This file is engineering rules. For what the game is *supposed to do*, see
[`specs/`](../specs/README.md); numbers live there and in the code, not here.

## The simulation

- **One simulation.** `src/game/simulation/` must never import Phaser, touch the
  DOM, or read wall-clock time. Client and server run the *same* `tickPlayer`;
  any divergence becomes rubber-banding.
- **Bodies are top-left, sprites are centre-origin.** Always position sprites via
  `syncSpriteToBody`. Assigning body coordinates straight to a sprite draws it
  half a body off.
- **Draw from the collider data.** `ArenaRenderer.drawArena` derives every
  platform sprite from `platforms`. Hand-placing sprites is how visuals and
  colliders silently disagreed — a 400px image for a 100px collider, so players
  appeared to walk through solid ground and stand on thin air.
- **No arena gap narrower than `PLAYER_WIDTH`.** Enforced by a test via
  `narrowGaps()`. A 30px gap under an overhang once pinned the AI in a 36px
  pocket for an entire match: invisible on screen, fatal to the fight.
- **Changing gravity or jump velocity changes level reachability.** The curve is
  designed jump-first — pick the height a jump must clear, then solve for
  velocity. Every ledge sits within `JUMP_HEIGHT_PX` of the one below. Re-check
  `Arena.ts` and the reachability tests. It also retunes combat: the uppercut's
  launch is chosen relative to the jump.
- **Jump is edge-triggered.** `tickPlayer` starts a jump only on a press edge
  (`up && !jumpHeld`). Anything driving it must release between jumps — that is
  why `EnemyBrain` holds jump for 240ms then forces a 60ms release. Emitting
  `jump` on scattered single frames only ever produces a minimum-height hop.
- **Collision is sub-stepped at 12px**, so nothing tunnels even at dash speed
  (1000 px/s) or at 20fps. Contact flags are valid whether or not the actor is
  grounded; gating side collision on `!grounded` once let a walking player pass
  through every platform.

## The server boundary

**Anything `server/` reaches through must be an explicit named export.** Two
separate traps, one root cause: the server's module boundary does not preserve
the shapes you expect, and `tsc` cannot see either failure because the *types*
are perfectly fine.

- A **default export** resolves to the *module namespace object*. `typeof
  EnemyBrain` was `object` with keys `AIState,default`, so `new EnemyBrain()`
  threw "not a constructor" inside a native geckos callback and killed the
  process.
- **`export *` resolves to nothing, silently.** `Physics.ts` re-exported
  `./Melee` with a star and `server/physics.ts` re-exports `Physics`; every
  explicitly-named symbol arrived and every starred one vanished, with no
  resolution error — just `SyntaxError: does not provide an export named
  'applyMeleeResult'` on boot.

To debug this class of bug, write a `.mts` probe that imports each layer of the
chain and diffs `Object.keys`. It localises the break in one run.

## Combat authority

- **One source of bullets.** The scene's `BulletSystem` (offline) or the server
  (online). `Player`/`AIEnemy` must not spawn their own ranged sprites — those
  were never simulated and froze on screen forever.
- **The server is the only judge of a melee hit.** The client predicts the swing
  *state machine* so it draws on the press frame; it never decides that it
  connected. Damage, stun, launch and knockback are applied server-side in
  `GameRoom.resolveMeleeHits`.
- **Stun and launch are ordinary simulation fields.** That is why a stunned
  prediction converges with no special case: the client rewinds into the stun and
  replays inputs the simulation discards on both sides.
- **Impacts are events, not state.** The snapshot carries `melee[]` for effects
  only; a dropped datagram costs a spark, never a consequence.
- **Never freeze frames on impact.** Hitstop is the standard way to sell a heavy
  hit and it is unavailable here — pausing one side desyncs it. `MeleeFx` fakes
  it with camera shake and a sprite scale punch, purely in the renderer.

## Sword combat

Full frame data and rationale in [`specs/melee.md`](../specs/melee.md); the table
lives in `simulation/Melee.ts` and nowhere else.

**One asymmetry carries the whole design: a slash can be cancelled, a heavy move
cannot.** Cancelling a slash into a block is the butterfly; refusing to cancel the
Massive Strike and the uppercut is what makes them punishable, and therefore what
stops the butterfly being the only option.

- **A reaction window must be wider than the snapshot interval.** Blocking is
  specified as a *read*, so slash startup (75ms) is set by the 20Hz network, not
  by feel: at 55ms the defender learned of the swing too late to ever guard it,
  and three measured matches raised 19 guards while intercepting nothing.
  `BLOCK_STARTUP_MS` is 0 for the same reason — and anything under ~17ms would
  round away at 60Hz while still reading like a real cost. **Changing the
  snapshot rate retunes this.**
- **Facing lives in the simulation and follows aim, not feet.** The melee hitbox
  is built from it, so both sides must agree. Driving it from the walk direction
  meant a fighter standing still could never turn, and two who had crossed stayed
  back-to-back forever.
- **Backstab needs a full body width of separation.** Fighters do not collide
  with each other, so in a scramble the bodies overlap and facing is locked
  mid-swing. Deciding "behind" from a few pixels made the backstab the default
  outcome (11 backstabs to 1 clean hit) and, since a backstab ignores the guard,
  silently disabled blocking entirely.
- **You cannot guard and swing at once**, or the butterfly would be strictly free
  rather than merely safe.
- **AI reactions must be able to interrupt.** `EnemyBrain` plays melee as scripted
  rhythms of presses and releases, because inputs are edge-triggered and holding a
  button does nothing. A rhythm that ran to completion left the bot deaf for up to
  ~950ms — longer than any window it was supposed to react inside.

## Projectiles

A bullet flies at constant velocity, with no gravity and no collision response,
so its position is a closed-form function of time. That makes every technique
used for players wrong for bullets.

- **Dead-reckon, never interpolate.** Interpolation renders a bullet 150ms in the
  past — latency added to the thing that most needs to feel sharp.
- **Anchor once, then fly off the local clock.** Re-deriving position from the
  newest snapshot each frame looks right but is a sawtooth: every arriving
  snapshot moves the extrapolation base, giving a jump forward every 50ms and a
  stall between (measured: `maxStepRatio` 3.79, 5 jumps + 6 stalls per 8s).
- **Key sprites by bullet id.** The server `splice`s dead bullets, so a sprite
  indexed by array position jumps to an entirely different bullet mid-flight.
- **Occlusion is permanent.** When an extrapolated bullet reaches geometry the
  server has already destroyed it; retire the sprite for good. Letting it reappear
  past the platform made bullets blink and register as jumps.

Verified: `teleportFrames` 0, `frozenFrames` 0, `maxPathDeviationPx` 0,
`maxStepRatio` ~1.2 (1.0 ideal), `avgStepCv` ~0.05.

## Netcode

- **Input sequencing.** Every fixed step the client sends `{seq, ...intent}`. The
  server echoes `lastSeq` with the full `PlayerPosition`. `PlayerInput` extends
  `PlayerIntent` so a field added to the simulation cannot be left out of the
  packet.
- **Reconciliation is rewind + replay**, not a blend. `PredictedPlayer.reconcile`
  drops acknowledged inputs, rewinds to the authoritative state, and replays the
  rest. Because the sim is deterministic, a correct prediction replays to exactly
  where it already was — measured error **0.00px**. The old 15% blind lerp left a
  permanent ~14px standing error.
- **Never simulate a tick the client did not send.** When the server's input queue
  starves it freezes that player for up to `MAX_STARVED_TICKS` (6) rather than
  repeating input. Each invented tick is a permanent error the client cannot
  replay away (~8px per tick while falling, ~24px per snapshot).
- **The server keeps the whole `PlayerPosition`.** It used to rebuild it each tick
  with `wallTouch: "none", wallJumpTimer: 0`, so the server could never wall jump
  while the client could.
- **Remote entities are interpolated, never predicted.** 150ms delay (3 snapshot
  intervals at 20Hz); 2 intervals emptied the buffer on a single dropped datagram
  and the remote teleported ~100px. Interpolated positions are depenetrated with
  `resolveOverlap` before drawing — a straight line between two legal snapshots
  can still clip a corner.
- **Remote *combat* state is not interpolated.** Position must be, or the remote
  stutters between updates; sword state must not be, because a swing rendered
  150ms late is a swing you cannot react to.
- **Respawns are announced, not inferred.** The server broadcasts `round-reset`
  and the client drops all interpolation history. Blending across a respawn drew
  the remote sliding through the arena.
