# Invariants

**Every rule here was written by a real bug.** Breaking one reintroduces a defect
that took measurement to find, so each entry states the rule *and* what happened
without it — the war story is the part that makes the rule stick.

This file is engineering rules. For what the game is *supposed to do*, see
[`specs/`](../specs/README.md); numbers live there and in the code, not here.

## The simulation

- **One simulation.** `src/game/simulation/` must never import a rendering
  engine, touch the DOM, or read wall-clock time. Client and server run the
  *same* `tickPlayer`; any divergence becomes rubber-banding. It survived a whole
  engine swap untouched, which is the clearest evidence the boundary is real.
- **ECS stops at the entity and presentation layer.** Systems read simulation
  state and write only presentation. A system that wrote back into `body` would
  be changing authoritative state outside `tickPlayer`, and the two sides would
  immediately disagree. See the `ecs-architecture` skill.
- **Bodies are top-left, sprites are centre-origin.** Always position sprites via
  `syncSpriteToBody`. Assigning body coordinates straight to a sprite draws it
  half a body off — and the bug presents as "collision feels slightly wrong",
  which sends you looking in the wrong file.
- **The renderer must exist exactly once.** Pixi registers renderers and
  environment adapters in a global registry at import time, so two module
  instances kill the app on boot with `Extension type environment already has a
  handler`. Vite's dep optimiser will split it happily; `optimizeDeps.include`
  and `resolve.dedupe` both name `pixi.js` to stop that.
- **Only one game instance may boot.** Startup is async and React StrictMode
  mounts twice, so two `Match` instances race and both install the
  `window.__gameState` hooks — the winner is not necessarily the survivor. The
  diagnostic then reads a destroyed match and reports a fight frozen at 100 HP
  with no opponent. `GameCanvas` serialises boots through one promise chain.
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

**A re-export is not an import.** `Physics.ts` re-exports `meleePhase` from
`Melee.js` for the server's benefit, and that line creates *no local binding* —
using `meleePhase` inside `Physics.ts` is a plain "cannot find name". Import what
the module itself uses, separately from what it re-exports (aliasing, e.g.
`meleePhase as meleePhaseOf`, keeps the two apart and readable).

**`tsx` does not hot-reload, and `src/game/training/` counts as server code.**
Restart after touching `server/`, `src/game/simulation/`, `src/game/characters/`
or `src/game/training/` — all four are inside `tsconfig.server.json`. A stale
server is a genuinely confusing failure because the *client* reloads: a training
scenario read its new spawn positions back from its own config and then measured
the fighters standing at the old ones, with nothing in the report to say why.

**`server/` must stay inside `tsc`.** For a long time it was not: `tsconfig.json`
included only `src`, so the authoritative half of the game was never
typechecked. It grew a real bug behind that gap — `botInput` read `foe.facingDir`
after facing moved into `PlayerPosition`, so `playerFacingDirection` was
`undefined`, `undefined * n` was `NaN`, every `playerFacesMe` test was false, and
**the server's bots could never evade**. Nothing failed, nothing logged; the bots
were simply worse. `npm run typecheck` now covers both projects.

## Combat authority

- **One source of bullets.** `combat/BulletSystem` (offline) or the server
  (online). Nothing else may spawn a ranged sprite — the fighter classes used to,
  producing projectiles nothing simulated, which froze on screen forever.
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
- **Facing is locked for a swing's startup and active frames only.** That is the
  window where the direction is a promise — a steerable live hitbox is an
  unreadable one. Locking the whole move made a player holding the attack button
  ignore the cursor for 332ms at a time; freeing recovery cut the worst case to
  154ms, both measured by `scripts/aim-probe.mjs`.
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

## Input and aim

- **Convert the cursor against the logical view, never `canvas.width`.** Under
  `autoDensity` the canvas backing store is the logical size times the device
  pixel ratio, so on a 2x display dividing by it doubled every cursor position:
  aim ran up to 162° wrong and bullets left in a direction nobody pointed at.
  `app.screen` is the logical rectangle; the camera scroll is added on top,
  because the pointer is a screen fact and body centres are world facts.
- **Store the pointer normalised and resolve it on read.** Converting on the
  pointer event freezes the world position at whatever the view and camera were
  when the mouse last twitched — a cursor held still while the camera moves is
  still aiming somewhere.
- **Aim is invisible to the AI-vs-AI loop.** The brains hand the simulation an
  angle and never touch a cursor, so `diagnose.mjs` cannot fail on any of the
  above. `scripts/aim-probe.mjs` drives a real mouse, and it must be run at
  `--dpr=2` — every backing-store bug is invisible at 1.

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
- **Respawns are announced, not inferred — but an announcement can lose a race.**
  The server broadcasts `round-reset` and the client drops all interpolation
  history; blending across a respawn drew the remote sliding through the arena.
  What that announcement cannot be trusted to do is *arrive first*: it is a
  datagram, and the snapshot carrying the respawned state races it. Melee
  tracking relied on it alone, so when the snapshot won it observed a fighter
  caught mid-Massive with the move gone, no stun and no invulnerability — which
  is indistinguishable from an uncancellable move ending 400ms early, and was
  reported as one in roughly one canonical run in five. Anything that must
  survive a respawn should also derive it from a fact the client can see: a
  correction past `RESPAWN_CORRECTION_PX` (100px) is the same event and cannot be
  dropped or reordered.
- **Instrumentation that captures a detail and never passes it is worse than
  none.** `ReconcileResult.meleeDivergence` was built to make a rare desync
  diagnosable, and the call site passed three of the four arguments — so the
  `[DESYNC]` log could only ever print nothing, and the metric it was meant to
  explain went unexplained for as long as it existed.

## The training room

Full detail in [specs/training-room.md](../specs/training-room.md); these are the
ways it goes wrong quietly.

- **The dummy is server-side, and never a simulation flag.** It is an *input
  source* with `EnemyBrain`'s exact contract, so `GameRoom` picks a source rather
  than growing a branch. If a `training` flag ever reaches `tickPlayer`, the
  design has gone wrong. A client-side dummy would be easy and worthless: it
  bypasses prediction, reconciliation and server-owned bullets, which is the
  whole of what a training session is used to test other things through.
- **The dummy must be deterministic.** No `Math.random`, no wall clock — only
  accumulated `dtMs`. The training room is the instrument other measurements are
  taken with, so a dummy that drifted between runs would launder its own
  flakiness into every later result.
- **A beat list is a controller recording, not a command list.** Buttons are held
  for the beat and the gaps carry as much meaning as the presses. A rhythm that
  holds `attack` forever produces exactly one swing.
- **The butterfly's cancel must land at `SLASH_CANCELLED_MS`.** A block pressed
  during startup is *ignored* — and, because the cancel is checked on the press
  edge only, the guard is then already held and never cancels at all. Measured, a
  butterfly cancelling at 55ms produced 7 swings where 15 were intended.
- **Aim, then swing — they cannot share a tick.** `tickMelee` starts the move
  before facing is applied, and facing is locked through startup and active, so a
  fighter that aims and attacks on the same tick commits to whichever way it was
  already facing. `__training.input()` leads with the aim, and deliberately does
  *not* release in between: a released frame hands the fighter back to the
  cursor, which turns it straight back round.
- **Moves start from neutral only.** Two programmatic holds back to back read as
  one press, and a step fired inside the previous move's recovery is silently
  swallowed — three chained attacks produced two moves, and the report could only
  say the third never happened.
- **A dummy spawn is a level-design decision.** The obvious `x=300` puts it on
  top of `PILLAR_LEFT`, 100px above the player, where no attack can reach it and
  every scenario reports a clean whiff. The defaults sit on the clear ground
  between the pillars, 60px apart — inside slash range and outside
  `BACKSTAB_MIN_SEPARATION_PX`.
- **A move that connects stuns the dummy.** A punish scenario whose setup *hits*
  never gets punished: the counter-attack is discarded along with every other
  input the stun eats. Whiff on purpose when the recovery is the thing under
  test.
- **Count damage before invincibility refills the bar.** Otherwise a practice
  session — where both fighters are invincible by default — reports that nothing
  ever landed.
- **The measurement window must open after the reset settles.** A respawn is a
  legitimate discontinuity worth a single ~40px correction; folding it into the
  window made a healthy scenario report several times a normal match's
  reconciliation error, measuring its own setup.
- **Typing is not gameplay.** `Input` ignores keydown on editable elements and
  the panel blurs on any canvas click. Without it, setting a walk bound to "500"
  also walked the fighter, and a menu that swallows WASD makes the mode useless.
