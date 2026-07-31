# Architecture

The shape of the codebase and who owns what. For the rules that hold it together
see [invariants.md](invariants.md); for intended behaviour see
[`specs/`](../specs/README.md).

## Layout

```
src/game/
  simulation/     deterministic, engine-free gameplay — shared verbatim with the server
    Arena.ts        world bounds, platform rects, line-of-sight, penetrationDepth, narrowGaps
    Collision.ts    swept axis-separated AABB: moveAndCollide, probeWall, resolveOverlap
    Physics.ts      tuning constants, PlayerPosition, tickPlayer, bullets
    Melee.ts        sword combat: the MOVES frame-data table, tickMelee, hitboxes, resolveMelee
    Deathmatch.ts   scoring limits, the win condition, and the one ranking both sides use
  ecs/            miniplex world, entity components, and the per-frame systems
    world.ts        Entity shape, archetype queries, FighterEntity
    systems.ts      animation, sprite sync, melee effects
  Match.ts        the fixed-timestep loop and the wiring between sim, netcode and renderer
  app.ts          Pixi Application bootstrap: init, load, build, tick
  characters/     EnemyBrain, AIConfig
  combat/         BulletSystem.ts — the only simulated source of bullets offline
  input/          Input.ts — raw keyboard and pointer state, dash gestures, and the
                  cursor->world conversion (logical view + camera, never canvas.width)
    Bindings.ts     which button means what: defaults, rebinding, persistence
  online/         OnlineManager (channel), OnlineSession (owns netcode)
    Prediction.ts   the local fighter: predict, rewind, replay, and render smoothing
    Rollback.ts     every *other* fighter: carry its input forward, rewind on snapshot
    Interpolation.ts what is left of it — the server clock, for dead-reckoning bullets
    wire.ts         packs PlayerPosition and PlayerIntent for the snapshot
    room.ts         which room, and keeping the address bar shareable
    types.ts        the wire messages, shared with the server
  render/         Stage.ts (layers + camera), ArenaRenderer.ts (draws from collider
                  data), assets.ts, SpritePool.ts, Particles.ts, MeleeFx.ts
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
  MatchOver.tsx     the winner podium
  useMatch.ts       EventBus subscriptions and the held-key hook
  hudStyles.ts      the overlay's own CSS, injected per component

server/           Geckos.io authoritative server
  physics.ts        re-exports src/game/simulation/Physics
  GameRoom.ts       authoritative tick, bullets, melee resolution, match lifecycle
  BotNames.ts       gamertags for bots, and sanitising the ones humans type
  TrainingDummy.ts  the scriptable practice dummy: an input source, like EnemyBrain
  index.ts          matchmaking, room sizing and deferred placement

scripts/          diagnose.mjs (Playwright harness), deathmatch-probe.mjs (sixteen
                  AI fighters played to a winner), aim-probe.mjs (drives a real
                  cursor — the only thing that can test aim), training-probe.mjs
                  (one interaction at a time), dev-herdr.mjs, probe-online.mjs,
                  verify-modes.mjs
specs/            the source of truth for intended behaviour
docs/             how to work in this repo
public/assets/
```

## The one hard boundary

`simulation/` is the only code both the client and the server run, and it is the
reason the netcode converges instead of rubber-banding. It may not import a
rendering engine, touch the DOM, or read wall-clock time.

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
lifecycles, and forcing them into the world would hide their sequencing.

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
