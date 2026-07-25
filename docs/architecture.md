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
  scenes/         Phaser scenes (Boot, Preloader, Game)
  characters/     Player, AIEnemy, EnemyBrain, AIConfig, Controls
  combat/         BulletSystem.ts — the only simulated source of bullets offline
  online/         OnlineManager (channel), OnlineSession (owns netcode),
                  Prediction.ts, Interpolation.ts, types.ts
  render/         ArenaRenderer.ts (draws from collider data), SpritePool.ts,
                  MeleeFx.ts (swing trails, impact particles, placeholder art)
  diagnostics/    PhysicsDiagnostics.ts — the measurement half of the feedback loop
  EventBus.ts     Phaser → React events (bullet-fired, enemy-hp-changed)

server/           Geckos.io authoritative server
  physics.ts        re-exports src/game/simulation/Physics
  GameRoom.ts       authoritative tick, bullets, melee resolution, round lifecycle
  index.ts          matchmaking and deferred placement

scripts/          diagnose.mjs (Playwright harness), dev-herdr.mjs, probe-online.mjs,
                  verify-modes.mjs
specs/            the source of truth for intended behaviour
docs/             how to work in this repo
public/assets/
```

## The one hard boundary

`simulation/` is the only code both the client and the server run, and it is the
reason the netcode converges instead of rubber-banding. It may not import Phaser,
touch the DOM, or read wall-clock time.

Everything else is a consumer of it:

- **The server** owns truth. It ticks `tickPlayer` at 60Hz, resolves bullets and
  melee, and broadcasts snapshots at 20Hz.
- **The client** predicts its own fighter with the same `tickPlayer`, interpolates
  the remote one, and draws. It never decides an outcome.
- **The renderer** reads simulation state and writes nothing back.

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

- **Input handling lives in the `Game.ts` scene**, not `Player.ts` — one set of
  listeners, one place to look.
- **Buttons are passed to the simulation raw.** It does its own press-edge
  detection (jump height is analogue, a slash needs an edge, a Massive fires on
  release); edge-detecting in the scene as well would desync client and server.
- **`EnemyBrain.ts` drives every AI fighter** — the offline enemy, the local
  `?ai=true` fighter and the server's bots. One brain, one perception structure,
  so a bot cannot accidentally be cleverer in one mode than another.
- **`EventBus` carries Phaser → React events** only.
- **Phaser 4 vs 3:** `color` not `fill` in `TextStyle`; `currentAnim.key` not
  `getCurrentKey()`.
