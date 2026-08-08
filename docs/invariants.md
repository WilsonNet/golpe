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
- **knip goes blind at the same boundary.** A `server/physics.ts` `export *`
  is untraceable, so *every* name behind it reports as an unused export —
  which is the whole reason the explicit re-export block in `Physics.ts` is
  load-bearing. When knip flags a line of that block, trace the name
  (`npx knip --trace-export <name>`) and check `server/GameRoom.ts`'s
  `./physics.js` import before deleting anything.

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
- **A fighter sprite's scale is per-hero, and every writer of it must know.**
  Sheets stopped being one size the day Anands' hand-drawn art landed
  (`SHEET_CELLS` in `render/assets.ts`, drawn at `sheetScale`), and the impact
  punch found the trap: it latched its resting scale from the hero the fighter
  *spawned* as, so a bot that spawned as the host's hero but was really another
  rendered at the wrong size until the end of the match. The resting scale must
  follow the hero latch (see `MeleeFx.updateFighter`), and the dragon ride's
  own scale must not be clobbered by the punch either.
- **The ultimate's cinematic is the one legal freeze, and it is legal because it
  is the opposite of hitstop.** Hitstop is a *local* decision one client makes
  about an impact it drew. The cinematic is the **server** declaring a range of
  ticks in which nobody — server included — advances anything: it consumes no
  input, marks every fighter's snapshot `input` as `null`, and a client that sees
  it stops running fixed steps at all. Each client freezes when the message
  reaches it and unfreezes when the next one does, so its lead over the server is
  identical on both sides of the event and the inputs already in flight simply
  wait in the queue. Nothing is dropped, so nothing diverges. A freeze that any
  client decides for itself is still forbidden. See
  [`specs/ultimate.md`](../specs/ultimate.md).

## The ultimate

Full rules in [`specs/ultimate.md`](../specs/ultimate.md).

- **The black hole's pull is an argument to `tickPlayer`, never something applied
  on top of it.** Anything that moves a fighter from outside the simulation is
  erased by the next reconciliation — the same lesson the dash taught. Both sides
  pass the room's field in, so a caught fighter's own client predicts the drag
  and reconciles to ~0px.
- **The friendly-fire rule is one predicate, `fieldAffects`.** Nothing compares
  ids itself. `tickPlayer` never learns whose hole it is; the caller hands it
  `null` for the caster. A team mode is a change to that one function.
- **Presentation must ask the simulation where the field reaches.** The renderer
  sizes the horizon ring from `SINGULARITY_RADIUS` and derives its victim list
  from `singularityGrip`, because an effect whose visible edge is not its real
  one is the most confusing thing a field ability can do.
- **The local fighter's entity key is `"local"`, not its server id.** Anything
  that asks a question the *server* also asks must translate first — the
  friendly-fire test did not, and the caster's own client drew them being torn
  apart inside their own hole.
- **Ult charge is not in `PlayerPosition`.** It is paid out of damage, which only
  the server sees, and the simulation never reads it — so it travels beside `hp`
  in the snapshot rather than on the replay path.

## Items

Full rules in [`specs/items.md`](../specs/items.md).

- **Item charges are a per-life resource, server-owned.** A use spends one charge
  on the press edge — there is no aim phase, unlike the ultimate's hold-release —
  and the charge count travels in the snapshot beside `ult`. The client never
  predicts a throw or a placement; it learns of them from the snapshot, exactly
  like bullets.
- **The trap's lock is in `PlayerPosition`; the trap's consequences are not.**
  `trapTimer` is set by the shared `tickPlayer` on both sides — the caller hands
  it the room's traps already filtered by `trapFor`, so a caught fighter's own
  client reels and reconciles to ~0px, exactly like the black hole's pull. The
  catch also zeroes the victim's velocity and burst state on that same shared
  tick, so a dash, tumble or lunge caught mid-flight stops dead and predicts so.
  The trap's destruction, the damage, the burst and the "TRAPPED!" caption are
  the server's alone.
- **A trap is single-use.** Nothing can destroy it before it springs, but the
  server removes it from the world the tick it catches somebody — so a trap in
  the snapshot is armed, and there is no spent state on the wire. That is what
  makes the friendly fade readable: your own and your team's traps are drawn at
  a fraction of opacity, because a trap you never need to worry about should
  not be doing the worrying for you.
- **A trap cannot catch its owner or a teammate.** `trapFor` is the same
  friendly-fire predicate (`hostile`) every weapon asks, so the trap cannot
  disagree with the sword about who is on your side.
- **Dying is the price of the next use.** A respawn grants the full kit again and
  takes the dead fighter's traps off the floor with them — otherwise a player
  would stack a fresh three on top of the three that just got them killed.

## Hero interactions

Full rules in [`specs/interactions.md`](../specs/interactions.md).

- **The hero is data; an interaction is a predicate over declared attributes —
  never a hero-id branch.** The simulation and `GameRoom` contain no
  `hero === "anands"`, no `case "jeffs"`, and the guard
  (`simulation/Interactions.test.ts`) greps for exactly that and fails naming
  the file and line. The near-miss was the trap fix: "the trap counters the
  thrust but not the dragon" reads as two hero cases, and the pair that almost
  shipped was `if (hero === "anands")`. It shipped as a predicate instead —
  `startMove` refuses moves whose def carries the body while `trapTimer` runs,
  and the ride is exempt because a ride is not a move. The exemption falling
  out of the classification is the whole system: a pairwise matrix is the
  O(n²) trap where adding a hero means editing every hero already in the game.
- **A matchup exception is data on the participants, never a second `if`.** If a
  rule genuinely applies to one pair only, it is a declared tag on the move or
  ultimate (or the one tagged exception table `specs/interactions.md` names) —
  so the rule reads generically even when one combination sets it. The shipped
  games agree: Dota 2's abilities declare behaviors and modifiers declare
  states, and interactions are comparisons of those declarations at runtime.
- **Per-hero branches belong to presentation, not to truth.** The HUD, the
  menu, the cinematic and the AI's animation choices may switch on hero; the
  deterministic simulation and the server's authority layer may not — those
  are the two places a branch would be the first cell of the matrix and the
  first thing to drift across the wire.

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
  154ms, both measured by `scripts/aim-probe.ts`.
- **Backstab needs a full body width of separation.** Fighters do not collide
  with each other, so in a scramble the bodies overlap and facing is locked
  mid-swing. Deciding "behind" from a few pixels made the backstab the default
  outcome (11 backstabs to 1 clean hit) and, since a backstab ignores the guard,
  silently disabled blocking entirely.
- **You cannot guard and swing at once**, or the butterfly would be strictly free
  rather than merely safe.
- **A slash is the first link of a three-hit ground chain**, and every rule about
  it is load-bearing. A link is available the moment the previous one enters
  recovery; a link's hitstun is set by the gap to the next link's hitbox, not by
  feel; links 2 and 3 pierce melee invulnerability because 180ms of iframes would
  otherwise swallow a combo that lands every 160ms; **the chain requires both
  feet on the floor**, or the butterfly's jump-in becomes three guaranteed hits;
  and **any cancel — block or stance switch — drops the chain**, so the next press
  is link 1 again. A cancel that kept the chain made every butterfly cycle advance
  the combo, which handed the safe loop the uncancellable finisher on its third
  guard.
- **The finisher's recovery equals its knockdown minus its active frames.** Both
  fighters come out of a landed combo on the same tick — that neutral is what pays
  for the finisher being uncancellable, and `Melee.test.ts` asserts the identity
  rather than trusting the two numbers to stay in step.
- **A landed hit must be visible on the fighter that took it.** Hitstun with no
  sprite for it read as nothing happening for a whole LAN playtest. The disabled
  and knocked-down poses are generated from the character strip at boot, so they
  cannot drift from the art they are standing in for.
- **Every guard that stops a sword attack is a guard break.** There is no
  rewardless "blocked" tier — a slash, a chain link or the massive's own swing
  on a raised guard incapacitates the *attacker* for a full second and arms the
  defender a Massive. That is what makes the unblockables (uppercut, the blast
  behind the swing, the bomb overhead) the designed answers to a turtle.
- **The massive's swing is blockable; the blast is not.** The swing's hitbox
  reaches exactly to the slam point (`MASSIVE_SLAM_OFFSET_PX` in front), so a
  defender *in* the path can read it; the blast that follows front and back of
  the slam point stuns through a guard. Geometry is the whole move: move the
  slam point and both the block window and the back-massive's reach move with
  it.
- **The charge is a hold state with delivery tools, not a lock.** `CHARGE_LOCK_MS`
  roots only the walk, and only after the slash's own cancel options have passed
  — a butterfly tap must never root. Block, dash and double jump survive the
  hold; a release before 2.5s, a hit, a stance switch and an ult cast all spend it.
- **A bomb's blast is derived from replayable state; only the damage is
  server-side.** `plungeOriginY` rides the wire, so both sides compute the same
  fall height, the same stuck duration, and the same blast placement —
  prediction plants the bomber and the server prices the blast against the same
  numbers. The stuck itself is a simulation timer that any melee hit clears;
  bullets cannot.
- **A plunge is a flag, not a move.** It has no hitbox and no phase table — it is
  a physics state (pinned `vy` at `PLUNGE_SPEED`, no gravity) that ends at floor
  contact. Making it a `meleeAction` would have broken the frame-data invariants
  (no move may outlive its declared duration) for a fall whose duration is
  dynamic.
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
  angle and never touch a cursor, so `diagnose.ts` cannot fail on any of the
  above. `scripts/aim-probe.ts` drives a real mouse, and it must be run at
  `--dpr=2` — every backing-store bug is invisible at 1.
- **The simulation is handed an angle with no provenance.** A mouse points at a
  place; a controller gives a direction; a thumb gives a vector. All three become
  one number in `PlayerIntent`, which is the only reason a player can switch
  aiming scheme in the middle of a match without desyncing anything. The day the
  simulation branches on *how* the angle was made is the day it can disagree with
  the server about it.
- **One code alphabet across every device.** Keys are `KeyboardEvent.code`, the
  mouse is `Mouse0`, a pad is `Pad0`/`PadUp`, and the on-screen deck sends the
  same `Pad…` codes a real pad does. An action asks "is any of my codes held" and
  gets one answer. Give a device its own code path and it silently stops being
  rebindable — which is exactly the state the mouse was in before block moved to
  Shift.
- **The gamepad is polled, so its press edges must be derived.** There are no
  button events in the Gamepad API. `Input.poll` diffs this frame's held set
  against the previous one; without that, holding a direction is a fresh press
  sixty times a second and reads as a dash.
- **Poll before anything reads the aim.** `Input.poll` also advances the handover
  from the fine stick back to the Contra aim by one frame. Called after the intent
  is built, it spends a frame of the hold window on input that has not arrived —
  invisible at 60Hz and a stutter in the aim at 20.
- **A virtual stick must rotate at the rim, not clamp.** Accumulating mouse
  deltas and clamping the magnitude looks correct and is not: from "aiming right",
  strokes straight up give 45°, 63°, 71° and never reach the ceiling. Splitting
  the delta into radial and tangential parts and rotating by the tangential
  component reaches vertical in two strokes and carries on round. Prior art:
  Steam Input's *Mouse Joystick*, and Flick Stick's rotation along the gate.
- **A virtual stick must recentre when it is let go.** A stick that resumed from
  where it was abandoned answers the same flick with a different angle every time.
- **The Contra aim is analog when the source is, and eight when it is not.** The
  left stick and the deck's cross hand the raw deflection to `setContra`, so a
  push at 30° aims at 30°; only the d-pad and the arrow keys — which can feed
  nothing but {-1, 0, 1} — resolve to exactly eight. The *movement* codes stay
  quantised either way, so there is still one code path and one dash gesture; the
  analog stick just gains the angles in between. An analog source wins over the
  codes while it is held, because it is a superset of the direction its codes
  resolve to.
- **Near-vertical aim sets `face: 0`.** `cos(-90°)` is a positive floating-point
  crumb, so without a dead band a fighter aiming at the ceiling snaps to facing
  right — and facing decides which side a guard covers. With an analog stick,
  vertical is exactly where a player holds a stick to wait, so the dead band is a
  place players sit rather than an accident of the cursor.
- **The suspend rule covers every device.** `input-suspended` has to release the
  gamepad and the on-screen deck as well as the keyboard. A held trigger behind an
  open dialog keeps blocking and has nothing that will ever deliver its release.
- **A window-level `pointerdown` is not "the player clicked the game".** The
  listener has to be on `window` so a drag that starts on the canvas keeps being
  tracked when it leaves — but button 0 is `Mouse0`, and `Mouse0` is attack, so
  *every tap anywhere on the page swung the sword*. Invisible until the page grew
  DOM the player is meant to press: with the on-screen gamepad, Jump jumped **and
  slashed**, the stance pills slashed, and so did the menu button. Gate the press
  on `e.target === canvas`; leave the *release* ungated, because deleting a code
  that was never added is free and a drag must always be able to end.
  `preventDefault` in the other handler is not a fix — it stops the browser's
  default, not another listener on the same event.
- **`movementX`/`movementY` are populated for touch pointers too.** The relative
  virtual stick exists for a trackpad, and without a `pointerType === "mouse"`
  filter every thumb sliding across the on-screen d-pad drove it: holding *left*
  while dragging *right* aimed right, 180° from what the thumb was pressing. A
  touchscreen already has an absolute thumb pad for that layer.
- **A probe that drives touch UI with `page.mouse` is measuring the wrong
  device.** Playwright's mouse reports `pointerType: "mouse"` even inside a
  `hasTouch` context, so it cannot see a bug in anything that branches on that
  field — and both touch bugs above passed a green probe until it was rewritten
  onto CDP `Input.dispatchTouchEvent`.
- **A gesture test needs the press and the travel to disagree.** Dragging toward
  a d-pad arm pushes a broken virtual stick the same way that arm points, so the
  correct build and the broken one give the same answer. Sliding *along* an arm —
  holding left while travelling right — is what separates them.
- **The aim needs to be drawn when there is no cursor to look at.** A mouse
  player's cursor is the reticle; a controller has none, and facing is one bit —
  so the Contra aim and 360° of fine aim all collapsed into "left or
  right", with the fine layer's whole purpose (aiming away from where you run)
  being exactly the case facing cannot show. Draw it from the **drawn** position
  like the nameplates, or the beam detaches from its fighter by however much the
  render smoother is hiding.
- **On the deck, the aim stick is the fire button in gun mode.** A phone's right
  thumb lives on the aim pad, and there is no spare finger for the fire button
  on the face cluster — so while the stance is gun, `Input` reads "aim stick
  held" as "attack held" and a phone gun becomes a twin-stick shooter. Two
  limits keep it honest: it is the *on-screen* stick only (a physical right
  stick has a trigger to hand), and *gun mode* only (in sword mode a touch of
  the pad must not slash). It travels as the `attack` button in the intent, so
  the simulation never learns a thumb made it.
- **A deck that draws controls per stance must own the stance change.** `Input`
  owns `swordStance`, so the deck listens for `stance-changed` rather than
  guessing — and a button that stops being drawn releases its code, or a
  fighter would keep blocking while the deck it blocked with has gone away.
  The drawing of a control and the semantics of a control must never diverge:
  the left stick is drawn as a round analog pad precisely because it *is* one,
  and it was drawn as a d-pad for months while behaving analog, which read as
  a d-pad.

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
- **Remote fighters are rolled back, never interpolated.** They carry their last
  known input forward, are simulated on the client's own fixed step, and are
  rewound to the authoritative state and re-simulated on every snapshot. The old
  150ms interpolation delay was smooth and correct and drew every swing too late
  to react to — which in a game about reading a swing is the only thing that
  mattered. This also retired the split where position came from the interpolator
  and combat state came from the snapshot: one simulated state, one clock, and the
  two can no longer disagree.
- **Rollback depth is the local player's pending input count**, not a latency
  estimate. The server reported its state at seq *N* and the client holds *N+1..N+k*,
  so advancing remotes by *k* puts every fighter on one tick by construction.
  Capped at 9 ticks (150ms).
- **A snapshot's `input: null` means the server froze that fighter.** Reproduce
  the freeze. Inventing a tick of motion for it is the same mistake as the server
  inventing one, and costs the same permanent error.
- **Anything drawn from a position the simulation did not produce is
  depenetrated first** (`legaliseDrawn`). The render smoother offsets a sprite off
  its body deliberately, and that offset can put it inside a ledge the body never
  touched. The interpolator needed this for the same reason; forgetting it while
  replacing the interpolator turned zero jitter into six collision penetrations in
  one run.
- **The snapshot is the only authority on who is present.** `roster` supplies
  names and nothing else. Presence taken from the roster let a stale, unordered
  datagram delete a fighter the newest snapshot contained — destroying its entity
  and sprite, rebuilding them a frame later, and discarding its prediction. It
  showed up as `rollback.primarySwitches` counting more changes than anybody had
  joined or left, which is the only reason it was found.
- **A metric about "the opponent" must pin which opponent.** Sixteen fighters
  means "the first remote" is a choice, and deriving it per call from a list that
  gets rebuilt made the subject change between frames. `enemy_x`/`enemy_y` compare
  this frame to the last, so they reported the gap between two fighters standing in
  different parts of the arena as 45-75px of jitter from a fighter that had not
  moved. The metric was wrong, not the netcode — and every fix aimed at the netcode
  would have been aimed at nothing.
- **Judge a state machine's frame data against the authoritative state, never a
  predicted one.** The melee tracker asks whether a move honoured the MOVES table,
  which is only answerable about the state machine that *is* authoritative — a
  prediction being wrong is what prediction is. Once remote fighters became
  predicted, feeding the tracker their predicted state made a mispredicted uppercut
  read as an uncancellable move ending 500ms early, and reported correct netcode as
  a frame data violation. `DiagnosticSample.enemyState` is the snapshot's state;
  `DiagnosticSample.enemy` is the drawn position. The split is load-bearing.
- **A server-granted Massive is consumed by throwing it.** A guard break the client had
  not been told about arms a Massive server-side; the client predicts a plain slash
  on release, the replay lands on a Massive, and `massiveReady` is *already spent*.
  A reason check that only looks for the flag being newly set finds nothing and
  calls it an unexplained desync. Landing on a Massive the client did not know it
  had is the same event, one tick later — both spellings must be excused.
- **Wire packing is proved, not trusted.** `STATE_FIELDS` is asserted at compile
  time to cover every key of `PlayerPosition`, and a test replays 30 ticks from
  both a state and its round trip and requires them identical. A round-trip test
  alone is not enough: a fresh `createPlayerState` has every timer at zero and
  survives a packer that forgot half the fields.
- **Respawns are announced, not inferred — but an announcement can lose a race.**
  The server broadcasts `respawn { id }` for one fighter or `round-reset` for the
  arena, and the client drops that fighter's prediction outright; smoothing across
  a respawn drew the remote sliding through the arena.
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

## The deathmatch

Full detail in [specs/deathmatch.md](../specs/deathmatch.md); these are the ways
sixteen fighters breaks things two never could.

- **Death is a stun, not a flag.** A killed fighter gets
  `stunTimer = RESPAWN_DELAY_MS`. Stun already discards intent identically on both
  sides, already replays correctly through reconciliation, and is already the one
  legitimate way state changes without the client predicting it. A `dead` field in
  `PlayerPosition` would have needed all three built again.
- **Respawn one fighter, not the arena.** Resetting sixteen fighters because one
  of them lost a duel is precisely what a deathmatch is not. The whole-arena reset
  survives for a new match and for the training room, which still runs rounds
  because a scenario is the unit of measurement there.
- **The standings tie-break chain must be total** — frags, deaths, name, id.
  Anything less leaves the order dependent on iteration order, which differs
  between the server's `Map` and a client's rebuild, so two clients would draw two
  different podiums from identical data. One pure `rankScores` both sides call.
- **A bot is a scoreboard row like anyone else.** It has a generated, unique name,
  it gives up its seat to a human (`rebalanceBots` works in both directions), and
  it targets the nearest living opponent. Filling up without evicting left a
  leftover bot in a room asked for two fighters, so a test that wanted a clean duel
  silently measured a three-way fight.
- **Bots are opt-in, and zero is a real target.** A room has none unless asked,
  and `rebalanceBots(0)` must not clamp up to one — that would quietly seat a bot in
  every humans-only room. An empty room is fully served, predicted and reconciled,
  and it is the only way to measure the local fighter's aim without a bot closing to
  melee range and eating the measurement; half the aim probe's runs used to fail for
  reasons that had nothing to do with aim.
- **A count assertion must be exact.** `>=` passes a room that seated a bot nobody
  asked for, which is precisely the regression worth catching once bots are opt-in.
- **A fighter is transient, so its sprites must be destroyed.** Sixteen slots on a
  server that runs for hours means churn; three leaked effect sprites per departure
  is a leak nobody finds. `MeleeFx.forget` exists for that.
- **`fighter.side` was `"local" | "remote"` and was also the effects key.** At
  sixteen that means every remote fighter's swing trail, guard and impact punch
  land on one shared set of sprites. Fighters are keyed by the id the server scores
  them under.
- **A melee event carries its victim.** Deriving it from
  `attackerId === myId` was correct in a duel and wrong the instant a third fighter
  existed: every hit between two other players punched the local fighter's sprite.

## Play of the Game

Full detail in [specs/play-of-the-game.md](../specs/play-of-the-game.md). These
are the ways an end-of-match cinematic breaks a game that is still running
underneath it.

- **The replay is a projector, never a simulation.** It draws recorded
  `PackedState` and calls `tickPlayer` exactly zero times. Re-simulating from
  recorded inputs was the obvious alternative and is the wrong one: it needs the
  exact server tick alignment, and the first floating-point difference has the
  replay diverging from the match it is a replay of.
- **The footage is the broadcast.** Frames are built from the `GameSnapshot` the
  room already composed, so the reel and the room can never show two different
  fights — and a field added to `PlayerPosition` reaches both at once. A parallel
  recording of the server's internal state would have drifted the first time
  anybody added a timer.
- **The live match keeps running underneath, and the replay is the last writer.**
  It re-points entities *after* `updateOnline` has pointed them at prediction, so
  the moment it stops running the live bindings are back with no restore step to
  forget. The session never stops predicting, reconciling or sending input.
- **A hidden fighter's plate, shadow and sword must be hidden too.** Hiding a
  sprite leaves the entity in every archetype query, so `nameplateSystem`,
  `shadowSystem` and `meleeFxSystem` all skip invisible fighters now — the first
  version left health bars floating over empty arena and swing trails coming from
  nobody.
- **A cut is made when the play closes, not when the match ends.** By the end of
  a match the footage of a play from four minutes ago is long gone from the ring
  buffer, and keeping the whole match to avoid that would be tens of megabytes
  per room.
- **The recorder's clock is not the match clock.** `matchElapsedMs` stops during
  a team round's freezetime and cooldown, and footage stamped with a clock that
  stands still is footage the replay cannot sample — hundreds of frames would
  share one timestamp. `potgClockMs` is monotonic and counts every tick,
  including the ones the ultimate's cinematic froze, so a cast replays as the
  held beat it actually was.
- **Beats are moments, not events.** A frag emits one `kill` plus a modifier for
  each thing notable about it, all at one timestamp; the clip dedupes them, or a
  single kill would be slowed and shaken six times.
- **A beat's shake is counted, not time-windowed.** Slow motion holds a beat
  inside its own window for a dozen frames, and a re-triggered shake is a rattle
  instead of an impact.
- **The camera may never go wider than the world.** This game's arena is exactly
  one viewport tall, so the director's 0.82x establishing shot would draw a
  656x492 world inside an 800x600 canvas and frame the ceremony with a border of
  void. The replay floors the zoom at the fit.
- **`Stage.cameraX` divides the zoom back out.** The diagnostic compares it frame
  to frame; a getter reading the raw container position would report a cinematic
  push-in as several hundred pixels of camera jitter.
- **The podium is deferred, not cancelled.** `match-over` and the announcement
  arrive in the same breath, and `MATCH_OVER_LINGER_MS` has grown with the
  ending — 15s → 28s → 44s — to hold the breathing, the victory card, the reel
  and the podium; leaving it would have started a new match underneath a replay
  of the last one. The announcement waits in line behind the card: the client
  parks it until the victory window closes, so the reel can never cut the
  verdict short.
- **The breathing is what makes the verdict a verdict.** The first version cut
  from the winning blow straight to a full-screen card, and it read as an
  interruption of the fight. The arena holds for `VICTORY_BREATHING_MS` before
  the victory card lands, paced by the client's game loop — a timer would keep
  ticking inside a tab that has stalled the loop that draws it.
- **A title card must own the screen before it can hand it over.** The first
  version faded a title in over an already-playing replay and it read as a
  subtitle on footage, not as an event. The `curtain` reaching 1 — nothing else
  on screen — is the difference, and the probe asserts it: a caption satisfies
  every other metric in the snapshot.
- **The letterbox bars and the curtain are one pair of elements.** Two would
  have been two things to keep in step, and the reveal falls out for free: the
  halves open from meeting in the middle to being the 8% bars the rest of the
  ceremony is framed by. Their gold inner edges and glows are scaled by the
  curtain, or two lit edges meeting in the middle draw a rule straight through
  the wordmark.
- **The card's entrance is CSS keyframes, and only the card's.** Everything else
  is driven by the director because it runs against footage at a variable speed;
  the intro is the one movement with a fixed length, exactly like the ultimate's
  1100ms cutscene. `Director.test.ts` asserts the card's animation budget fits
  inside the intro with the wipe still to come — a card still in flight when the
  curtain opens is the one way this looks broken without anything throwing.
- **An absolutely positioned child of a grid or flex container takes its
  *static* position.** The flare was placed at its grid cell rather than the
  middle of the card, and the light sweep sized itself to the gap between two
  words and rendered as a grey block over "OF". `inset` on both, and `margin:
  auto` rather than a centring transform for anything that also animates one.
- **A tie between plays is kept by the earlier one.** Any other rule makes the
  winner depend on the order plays happen to close in, and two identical matches
  would produce two different cinematics.

## Teams

Full detail in [specs/team-deathmatch.md](../specs/team-deathmatch.md). These are
the ways a *side* breaks things a free-for-all could not.

- **Friendly fire is one predicate, `hostile(a, b)`, and every weapon asks it.**
  Swords, bullets, the grenade's contact test, the black hole's `fieldAffects`,
  and `damage()` as the backstop. A weapon that compared teams itself would be a
  weapon that disagreed with the sword the day the rule changed, and in a team
  game that bug loses the round for you rather than glitching.
- **`team: null` is hostile to everything, including another `null`.** That is
  not a quirk, it is the design: every fighter in a free-for-all carries `null`,
  so FFA falls out of the team rules with no `mode === "ffa"` test anywhere in
  the damage path. Deleting that property means branching every weapon.
- **A team travels in the snapshot, beside `hp` — never in the roster.** Teams
  are an argument to `tickPlayer`: the client applies the black hole's
  friendly-fire rule for every fighter it predicts, and replays it on every
  reconciliation. The roster is sent on change with a 2s heartbeat, so a client
  that lost one would spend two seconds dragging its own side into a hole the
  server is not pulling them into — with nothing in any metric to explain it.
- **The hole carries its caster's side, copied from the grenade.** Looked up per
  fighter instead, a caster who left the room mid-flight would leave a hole that
  had forgotten whose side it was on and started eating its own team.
- **A round cannot end until both sides have somebody seated.** A room with one
  fighter in it otherwise "wipes" the empty side sixty times a second and wins
  the match before the second player has finished connecting. `roundResult`
  checks seats before it checks the living.
- **Both sides falling on the same tick is a draw, not a win for whoever the
  iteration reached first.** A black hole makes simultaneous elimination
  ordinary, and crediting it by `Map` order would be a score that differs between
  a replay and the run.
- **A teammate does not consume anything.** A blade passes through without
  spending `hitLatch`, a bullet flies on unconsumed, a grenade does not detonate.
  Consuming them was the obvious implementation and makes a firing line
  impossible, a corridor a queue, and the ultimate a way to lose the round.
- **A bot is never told about a teammate.** `nearestFoe` filters them out, so
  friendly fire is not a decision `EnemyBrain` declines to make — it is a
  situation the brain cannot perceive. The brain gained no team concept at all.
- **Never reassign a side mid-match.** Balance by where the *next* joiner goes;
  moving somebody across hands the round they are standing in to the other side.
  And evict bots from the **larger** side, or every arriving human is seated
  beside the bot that just left and the room drifts 9v7.
- **A team tint blends toward the side's colour; it never replaces it.** Every
  combat colour in this game is frame data — white is the first slash, amber the
  finisher, cyan the uppercut, violet the ultimate. Painted flat you would know
  whose swing it was and no longer what it was. And the **health bar is never
  tinted**: it is the one reading that must be understood without a second
  thought.
- **Additive particles over a bright sky wash any tint toward white.** The same
  thing that forced the ultimate's aura to be painted rather than added. A blend
  that reads as clearly blue in isolation reads as white at 50% on this
  background, which is why the impact strengths are 0.62 and 0.8 rather than the
  half they started at.
- **Freezetime is a timer in `PlayerPosition`, not a stopped simulation.** Four
  seconds of the ultimate's cinematic mechanism would park four seconds of every
  client's input in the server's queue — that freeze is safe at 1.1s and nothing
  like safe at four; discarding the intent inside `tickPlayer`
  costs nothing and is replayed and rolled back like every other timer, so a
  client predicts the tick the round goes live instead of lurching a frame after
  being told. It is deliberately **not** a stun: a stun is drawn as one, and ten
  seconds of the staggered pose would say the whole team had just been hit.
- **Pause the clock, never the win condition.** The team match clock stops during
  freezetime and the cooldown — otherwise fifteen rounds of countdown decide the
  match — but returning early from the whole of `tickMatchClock` meant a deciding
  wipe went unread for five seconds, the arena reset, and the scoreboard counted
  a round nobody played.
- **A wipe that ends the match resets nothing.** The podium belongs over the
  arena as it was left.
- **The cast shadow is drawn from `world.platforms`,** like the arena itself, and
  sits a couple of pixels *below* the surface it lands on — an ellipse centred
  exactly on the line puts half of itself in the air off the front of a ledge and
  reads as a floating disc.

## Input and the UI

- **A programmatic entry point must drive the same *state* the UI does, not just
  fire the same event.** `window.__setPlayerName` emitted `player-name` and was
  documented as taking the path a player takes — while the modal closed only on its
  own submit handler. Called from a script it left the modal mounted over the game
  with its share-link field focused, and `Input` ignores keystrokes aimed at an
  editable element, so **every key a probe pressed afterwards was silently
  swallowed**. The claim was false in exactly the way that is hardest to notice:
  the game looked fine and simply did not respond.
- **Hand the keyboard back when an overlay closes.** A focused field behind a
  dismissed modal eats WASD, which reads as a dead game rather than a focus
  problem.
- **A feel constant needs a test with a fake clock.** The dash window is timing,
  not logic, so `DoubleTapDash` is separated from the DOM specifically to be
  testable — otherwise the only check is a human saying it feels wrong, which is
  how it got too tight in the first place.
- **An overlay that owns the keyboard must say so**, by emitting
  `input-suspended` — and everything held has to be released when it does. Half
  of a controls dialog is asking the player to press keys, and without the
  suspension binding block to `S` walks the fighter across the arena while they
  are choosing it, and clicking *Reset to defaults* swings the sword. A key that
  was already down when the overlay opened never delivers its keyup to the game
  and stays down forever.
- **A binding is a client fact and must never reach the wire.** The simulation is
  handed `block`, not `ShiftLeft`. The moment a key name travels, two clients
  with different keyboards are two clients running different games — and the
  packer would not even complain.
- **A compiled component must not read an external store mid-render.** The
  React Compiler memoises JSX on the values a render actually reads, so a
  `bindings.codesFor(...)` read straight off a module singleton is invisible to
  it: the controls dialog's slot table froze at whatever it showed when the
  dialog opened, and *Reset to defaults* — which rewrote the store and correctly
  refreshed the note below the table — kept showing the rebound key. The
  store's change events were arriving at an unread `[, bump]` state that no JSX
  depended on, which is the whole trap: the pattern worked under hand-written
  memoisation because `useCallback` made the closure the dependency; the
  compiler sees neither the store read nor the bump. (The bind path had masked
  it all along — binding a key also clears `capture`, and that *state* the JSX
  did read.) The fix is to snapshot the store into state
  (`useState(() => store.snapshot())`, resubscribed), and to ask the snapshot
  with a pure predicate (`isDefaultBindings`, `deckVisibleFor`) rather than the
  live store — the snapshot is a value the compiler sees, and the predicate
  keeps the question in one place. If a closure the compiler memoises is still
  flagged by Biome's `useExhaustiveDependencies`, the suppression is a
  *single-line* parameterised comment directly above the deps line — a
  multi-line block or any other placement is reported as unused.
- **One code belongs to one action.** Binding a key that another action already
  holds has to *take* it, visibly. Two owners means the loser is silently
  unbound, and the player finds out mid-fight that jump does nothing.
- **Nothing in AI vs AI presses a key.** The brains hand the simulation an intent
  directly, so every binding in the game can be wrong while `diagnose.ts`
  reports PASS — the same blind spot that made `aim-probe.ts` necessary.
  `scripts/controls-probe.ts` is the instrument for this one, and
  `scripts/pad-probe.ts` for the controller and the on-screen deck.
- **A polled API can be stubbed; an evented one has to be driven.** Playwright
  cannot press a physical gamepad button, but the Gamepad API is `getGamepads()`
  returning a fresh snapshot — so an init script replacing it is *genuinely
  equivalent* from the game's point of view, on the same schedule with the same
  shape. That is what makes controller mode measurable at all.
- **The on-screen gamepad is DOM, so tap it.** Emitting its EventBus messages
  from a probe proves the wiring and nothing else; a probe that taps the actual
  control proves the geometry, the pointer capture and the layout too — the same
  argument as `controls-probe.ts` pressing real keys rather than calling
  `Input`.
- **On a phone, the layout is the feature.** A 4:3 canvas and a control deck have
  to both fit a portrait screen with no horizontal scroll, and the canvas has to
  keep its aspect ratio doing it — which is why sizing lives in the stylesheet
  with `max-width` *and* `max-height`, and why Pixi's inline `autoDensity` sizes
  are cleared. `width: 100%` alone lets a short window crop the arena away.
- **A setting a player cannot undo is a trap.** The on-screen gamepad is reached
  by a setting and left by the Esc menu, and a phone has no Escape key — so the
  deck carries its own menu button. Anything that can only be turned on needs the
  same treatment.

## Rooms

- **A one-shot control message must be reliable.** Geckos datagrams are
  unreliable by default, which is right for anything that repeats — a lost input
  is what the starvation freeze exists for, a lost snapshot is followed by another
  in 50ms. It is wrong for a message with no second chance, and the failures are
  silent rather than glitchy: a lost `join` puts a player in a *different room*
  from the friend who invited them, a lost `match` means the client never learns
  the id it is scored under, a lost `match-over` means no podium, a lost
  `training-state` hangs an agent awaiting `set()`. `RELIABLE` in
  `online/types.ts` names the set — and names what is deliberately left out.
- **Both halves of the game must bind every interface.** The game server already
  did; Vite's default is localhost, so a LAN game failed before any netcode was
  involved, with nothing but a browser timeout to explain it.
- **Names are deduplicated for humans, not only bots.** Two rows reading
  `Wilson 4/2` and `Wilson 0/5` is indistinguishable from a scoring bug, and it
  happens constantly — people pick the same handle, and two tabs on one machine
  share the name remembered in `localStorage`.

- **Presence in a room is decided by an id, never by a queue.** No `?room=` means
  a new room. The consequence that bites: **two tabs at the same URL are in two
  different matches** unless that URL names a room, so every multi-client script
  must pass one — and a *fresh* one per run, or consecutive runs join the room the
  previous one has not finished leaving.
- **The client proposes a room id; the server decides.** It arrives from a client,
  becomes a `Map` key and is logged, so it is validated and replaced if malformed.
  The address bar is rewritten from what came back, never from what was asked for.
- **The room id has to reach the address bar** — before connecting, not after.
  Sharing the link *is* the matchmaking, and a host who cannot copy their own URL
  cannot invite anybody.
- **`crypto.randomUUID` and `navigator.clipboard` both require a secure context**,
  and a LAN game is served over plain HTTP. Reaching for either alone would leave
  every guest on `http://192.168.x.x:8084` unable to start or share a match.
  `getRandomValues` and `execCommand` are the fallbacks.
- **Size and rules are fixed when the room is created.** Reading them from every
  arriving client let the last person through the door resize a match already in
  progress.

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
