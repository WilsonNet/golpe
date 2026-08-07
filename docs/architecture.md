# Architecture

The shape of the codebase and who owns what. For the rules that hold it together
see [invariants.md](invariants.md); for intended behaviour see
[`specs/`](../specs/README.md).

## Layout

```
src/game/
  simulation/     deterministic, engine-free gameplay — shared verbatim with the server
    Arena.ts        buildWorld(screens): per-room bounds, platforms, spawns — plus
                    line-of-sight, penetrationDepth, narrowGaps
    Collision.ts    swept axis-separated AABB: moveAndCollide, probeWall, resolveOverlap
    Physics.ts      tuning constants, PlayerPosition, tickPlayer, bullets
    Melee.ts        the shared MOVES frame-data table, the per-weapon tables
                    (sword/dagger), tickMelee, hitboxes, resolveMelee, the thrust sweep
    Heroes.ts       the hero registry: who exists, their weapons, and kitFor()
    Ultimate.ts     the black hole and the dragon thrust: constants, sweeps, charge
    Deathmatch.ts   scoring limits, the win condition, and the one ranking both sides use
    Teams.ts        sides, the friendly-fire predicate, and the wipe-out round rules
  ecs/            miniplex world, entity components, and the per-frame systems
    world.ts        Entity shape, archetype queries, FighterEntity
    systems.ts      per-hero animation (strips and poses), sprite sync, melee effects
  Match.ts        the fixed-timestep loop and the wiring between sim, netcode and renderer
  app.ts          Pixi Application bootstrap: init, load, build, tick
  characters/     EnemyBrain (the coordinator) + AIConfig + the tactic modules:
    MeleeBrain.ts   the sword: techniques, rhythms, stance hysteresis
    DaggerBrain.ts  the dagger: stab spam, thrust reads, the shoryuken anti-air
    JumpBrain.ts    committed jump presses and the scripted double jump
    UltimateBrain.ts the black hole: when to hold the button, where to throw
    DragonBrain.ts  the dragon thrust: when a line is worth a cast
    TeamBrain.ts    team roles (vanguard/support), the cover line, bounded kiting
    types.ts        AIInput/AIOutput — the input-source contract, shared with the dummy
  combat/         BulletSystem.ts — the only simulated source of bullets offline
  input/          Input.ts — the one place four devices meet: raw held codes, dash
                  gestures, and the cursor->world conversion (logical view +
                  camera, never canvas.width)
    Bindings.ts     which button means what: defaults, rebinding, persistence
    Gamepad.ts      the polled pad, read as codes in that same namespace
    Aim.ts          the two controller aim layers — pure, clock-free, testable
    Scheme.ts       mouse vs controller, and whether the on-screen deck is drawn
  potg/           Play of the Game: the end-of-match highlight
    types.ts        the clip and announcement shapes — shared with the server
    scoring.ts      what a moment is worth and where a play begins and ends; pure,
                    shared with the server, unit tested
    Director.ts     the five-movement camera edit; pure — no Pixi, no clock
    Replay.ts       the projector: samples recorded frames, never simulates
    clipSource.ts   fetching the footage over HTTP, and surviving every failure
  online/         OnlineManager (channel), OnlineSession (owns netcode)
    Prediction.ts   the local fighter: predict, rewind, replay, and render smoothing
    Rollback.ts     every *other* fighter: carry its input forward, rewind on snapshot
    Interpolation.ts what is left of it — the server clock, for dead-reckoning bullets
    wire.ts         packs PlayerPosition and PlayerIntent for the snapshot
    room.ts         which room, and keeping the address bar shareable
    types.ts        the wire messages, shared with the server
  render/         Stage.ts (layers + camera), ArenaRenderer.ts (draws from collider
                  data), assets.ts (per-hero sheets, strips and generated poses),
                  SpritePool.ts, Particles.ts, MeleeFx.ts (per-hero blades and the
                  dagger's motion tells), DragonFx.ts (the dragon's wake),
                  Shadows.ts (team-tinted cast shadows, in their own layer)
  teamPalette.ts  the two team colours and the one function that applies them —
                  dependency-free, so the canvas and the React overlay share it
  diagnostics/    PhysicsDiagnostics.ts — the measurement half of the feedback loop
  training/       the training room's client half and its shared vocabulary
    types.ts        config, beats and the two wire messages — shared with the server
    scripts.ts      behaviour -> beat list; pure, and unit tested
    TrainingRoom.ts window.__training, and a *view* over PhysicsDiagnostics
    report.ts       the agent-facing API and report shapes (client only)
  EventBus.ts     game → React events (bullet-fired, enemy-hp-changed)

src/ui/           React overlays drawn over the canvas
  TrainingPanel.tsx the training menu — DOM, and a client of window.__training
  NamePrompt.tsx    the name a player enters before their client connects
  Scoreboard.tsx    the held-Tab scoreboard, and the table the podium reuses
  PauseMenu.tsx     the Esc menu and the controls dialog (suspends input, never pauses)
  MatchOver.tsx     the winner podium — deferred while the ceremony runs
  PlayOfTheGame.tsx the end-of-match ceremony's title, name card and skip
  FightHud.tsx      the in-match HUD — DOM, fed by the hud-state event
  useMatch.ts       EventBus subscriptions and the held-key hook
  hudStyles.ts      dialog/overlay CSS; fightHudStyles.ts the HUD's own, both
                    injected per component

server/           Geckos.io authoritative server
  physics.ts        re-exports src/game/simulation/Physics
  GameRoom.ts       authoritative tick, bullets, melee resolution, match lifecycle
  PlayOfTheGame.ts  the highlight reel: a ring buffer of broadcast frames, and the
                    running judgement of which slice of them was the match
  BotNames.ts       gamertags for bots, and sanitising the ones humans type
  TrainingDummy.ts  the scriptable practice dummy: an input source, like EnemyBrain
  index.ts          matchmaking, room sizing and deferred placement

scripts/          diagnose.mjs (Playwright harness), deathmatch-probe.mjs (sixteen
                  AI fighters played to a winner), tdm-probe.mjs (two sides,
                  wipe-out rounds, and friendly fire caught from the scoreboard), aim-probe.mjs (drives a real
                  cursor — the only thing that can test mouse aim), pad-probe.mjs
                  (stubs the Gamepad API — the only thing that can test controller
                  aim and the phone deck), training-probe.mjs (one interaction at
                  a time), potg-probe.mjs (the end-of-match ceremony — the only
                  thing that reads past the final whistle), make-anands-art.py
                  (composes the second hero's hand-drawn art into the shipped
                  sheets), make-potg-art.py
                  (generates the ceremony's sunburst and medal),
                  dev-herdr.mjs, probe-online.mjs, verify-modes.mjs
specs/            the source of truth for intended behaviour
docs/             how to work in this repo
public/assets/
```

## The one hard boundary

`simulation/` is the only code both the client and the server run, and it is the
reason the netcode converges instead of rubber-banding. It may not import a
rendering engine, touch the DOM, or read wall-clock time.

**The geometry is per-room, not global.** `buildWorld(screens)` makes the arena
`?screen=N` 800px screens wide, and every sim entry point that touches geometry
takes that `World` as a parameter (defaulting to the single-screen arena).
`GameRoom` builds one at creation; the client builds one from its URL and
rewrites it in place from the `match` message, because the room's size is a
property of the room. The two sides pass *the same values* into `tickPlayer`,
which is what keeps prediction bit-identical on a wide map.

Everything else is a consumer of it:

- **The server** owns truth. It ticks `tickPlayer` at 60Hz, resolves bullets and
  melee, and broadcasts snapshots at 20Hz.
- **The client** predicts *every* fighter with the same `tickPlayer` — its own
  from its own input, the other fifteen from the last input the server reported for
  them — rewinds them all on each snapshot, and draws. It never decides an outcome.
- **The renderer** reads simulation state and writes nothing back.

## Where ECS sits

The entity world (`ecs/`) owns **things that are drawn**; the simulation owns
truth. That boundary is deliberate — see the `ecs-architecture` skill for why
turning authoritative state into component stores would put the one part of the
codebase that measures 0.00px error at risk, for no benefit at two fighters.

Systems are plain functions run in an explicit order once a frame, and every one
of them reads the simulation and writes only presentation. Input, netcode and AI
are singletons owned by `Match` rather than systems: they have their own
lifecycles, and forcing them into the world would hide their sequencing. The AI
follows the same rule **within** itself — `EnemyBrain` is a coordinator over
small tactic modules (see `characters/` above), each owning one weapon or one
team concern and writing the same `AIOutput`, so a future weapon is a new module
rather than a new branch. An entity world for the AI was considered and rejected
for the same reason ECS stops at the renderer: the brain is an input source on
both sides of the wire, and the server has no entity world at all.

## What the engine does not do

Pixi renders. Everything else that Phaser used to supply is ours, which is why
those pieces are explicit files rather than framework config:

| Concern | Where it lives |
|---|---|
| Game loop, fixed timestep | `Match.update` via `app.ticker` |
| Scenes / lifecycle | none — `app.ts` initialises in a straight line |
| Camera, layers, screen shake | `render/Stage.ts` |
| Input | `input/Input.ts` |
| Key bindings | `input/Bindings.ts` — `Input` knows no key names of its own |
| Gamepad | `input/Gamepad.ts` — polled, and read as codes in the same namespace |
| Controller aim | `input/Aim.ts` — the analog Contra aim, plus a 360° virtual stick |
| On-screen gamepad | `ui/TouchControls.tsx` — DOM, and it emits `Pad…` codes |
| Aim beam | `render/AimLine.ts` — controller mode's reticle, drawn in the world |
| Particles | `render/Particles.ts` |
| Animation | `ecs/systems.ts` + frame slices in `render/assets.ts` |
| Physics | `simulation/` — and it always was |

## Online first

Every match runs through the authoritative server, including single player.
Playing the game *is* dogfooding the netcode — there is no second, easier code
path that only single-player uses, so netcode bugs surface immediately instead of
waiting for someone to open two tabs.

- **Solo is a real online match.** With no `?online=true`, the client sends
  `join {solo:true}` and the server fills the other slot with a **server-hosted
  bot** driven by the same `EnemyBrain`. Same rooms, same authoritative tick, same
  prediction and reconciliation as PvP.
- **The server places nobody until it hears `join`** (1.5s grace, then it assumes
  human matchmaking), because placement depends on which kind of match is wanted.
- **A bot is an ordinary player** to the simulation: same `PlayerPosition`, same
  `tickPlayer`, same bullets. Only its input source differs — it never starves, so
  `consumeInput` is bypassed for bots.
- **`?offline=true` is an escape hatch**, not a supported mode. It bypasses the
  netcode entirely; use it only when no server is available.
- **Always diagnose online.** An offline PASS says nothing about prediction,
  reconciliation or projectile rendering, which is where the real bugs live.

Run modes are listed in [running-the-game.md](running-the-game.md).

## Conventions

- **Input handling lives in `input/Input.ts`**, not on the entities — one set of
  listeners, one place to look.
- **The cursor is converted once, in `Input`, and read as world coordinates
  everywhere else.** It is stored normalised and resolved against the *logical*
  view plus the camera on read — see the Input and aim section of
  [invariants.md](invariants.md) for why the canvas backing store is the trap.
- **Actions, not keys.** `Input` asks `Bindings` what a code means and hands the
  simulation `block`, never `ShiftLeft`. A binding is a client fact and never
  reaches the wire, so rebinding cannot desync anything.
- **Buttons are passed to the simulation raw.** It does its own press-edge
  detection (jump height is analogue, a slash needs an edge, a Massive fires on
  release); edge-detecting in the scene as well would desync client and server.
- **The training dummy is a third input source, not a second pipeline.**
  `GameRoom` chooses between a network queue, an `EnemyBrain` and a
  `TrainingDummy`, and everything downstream of that choice is identical. It
  lives in `server/` for the same reason the solo bot does: a client-side dummy
  would bypass prediction, reconciliation and server-owned bullets, which is
  exactly what a training session is used to test other things through. See
  [specs/training-room.md](../specs/training-room.md).
- **`EnemyBrain.ts` drives every AI fighter** — the offline enemy, the local
  `?ai=true` fighter and the server's bots. One brain, one perception structure,
  so a bot cannot accidentally be cleverer in one mode than another.
- **`EventBus` carries game → React events** only, and is deliberately
  dependency-free: using the renderer's emitter made the UI depend on the
  rendering engine for nothing more than a callback list.
