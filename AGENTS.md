# Vento Áureo

## ████████████████████████████████████████████████████
## ██  THE FEEDBACK LOOP IS THE MOST IMPORTANT PART  ██
## ██  ALL FIXES MUST BE VERIFIED THROUGH MEASUREMENT ██
## ████████████████████████████████████████████████████

**Never guess at a physics fix without running `window.__physicsDiagnostic()` first and after.** The diagnostic tool provides structured JSON data that the LLM can parse and reason about. Every fix must be a measurable improvement: `jitterSummary.total` must decrease, and ideally hit 0.

Load the feedback-loop skill for full details:
```
skill({ name: "feedback-loop" })
```

Key one-shot workflow:
1. `node scripts/diagnose.mjs` → capture the baseline report
2. Analyse `jitterEvents[]`, `collisionSummary`, `movementSummary`, `reconciliationSummary`, `verdict`
3. Fix code; verify with `tsc --noEmit`, `npx vitest run`, `vite build`
4. Re-run the diagnostic — confirm FAIL → PASS on the metric you targeted
5. Run 3 consecutive tests for stability (`--runs=3`)
6. Run the knowledge-sharpener skill to fold findings back into AGENTS.md

**If the loop cannot measure the thing you want to fix, extend the diagnostic first.**
Jitter alone could not see moon-gravity jumps, players walking through walls, or an
AI wedged in a corner — `collisionSummary` and `movementSummary` exist because of that.

## Tech Stack
- Phaser 4.1.0 (rendering, input, scenes)
- React 19 (UI overlay), Vite 6, TypeScript 5.7 (strict)
- Geckos.io (WebRTC) for the authoritative server
- Vitest for simulation unit tests; Playwright for the feedback loop
- **Custom AABB physics in `src/game/simulation/` — Arcade Physics is not used for gameplay**

## Architecture
- `src/game/`
  - `simulation/` — **deterministic, engine-free gameplay code shared with the server**
    - `Arena.ts` — world bounds, platform rects, rect maths, line-of-sight, `penetrationDepth`, `narrowGaps`
    - `Collision.ts` — swept axis-separated AABB (`moveAndCollide`, `probeWall`, `resolveOverlap`)
    - `Physics.ts` — tuning constants, `PlayerPosition`, `tickPlayer`, bullets
  - `scenes/` — Phaser scenes (Boot, Preloader, Game)
  - `characters/` — Player, AIEnemy, EnemyBrain, AIConfig
  - `combat/BulletSystem.ts` — the only simulated source of bullets offline
  - `online/` — `OnlineManager` (channel), `OnlineSession` (owns netcode), `Prediction.ts`, `Interpolation.ts`, `types.ts`
  - `render/` — `ArenaRenderer.ts` (draws from collider data), `SpritePool.ts`
  - `diagnostics/PhysicsDiagnostics.ts` — the measurement half of the feedback loop
  - `EventBus.ts` — Phaser → React events
- `server/` — Geckos.io authoritative server; `server/physics.ts` re-exports `src/game/simulation/Physics`
- `scripts/diagnose.mjs` — Playwright feedback-loop harness
- `specs/`, `public/assets/`

## Invariants
These are the rules that were violated by real bugs. Breaking one reintroduces a bug that took measurement to find.

- **One simulation.** `src/game/simulation/` must never import Phaser, touch the DOM, or read wall-clock time. Client and server run the *same* `tickPlayer`; any divergence becomes rubber-banding.
- **Draw from the collider data.** `ArenaRenderer.drawArena` derives every platform sprite from `platforms`. Hand-placing sprites is how visuals and colliders silently disagreed (a 400px image for a 100px collider).
- **Bodies are top-left, sprites are centre-origin.** Always position sprites via `syncSpriteToBody`. Assigning body coords straight to a sprite draws it half a body off.
- **One source of bullets.** The scene's `BulletSystem` (offline) or the server (online). `Player`/`AIEnemy` must not spawn their own ranged sprites — those were never simulated and froze on screen.
- **Never simulate a tick the client did not send.** See "Netcode" below.
- **No arena gap narrower than `PLAYER_WIDTH`.** Enforced by a test via `narrowGaps()`; a narrow gap under an overhang pins the AI in place.

## Physics Model
The curve is designed jump-first: pick the height a jump must clear, then solve for velocity. **Changing gravity or jump velocity changes level reachability** — re-check `Arena.ts` and the reachability tests.

| Constant | Value | Note |
|---|---|---|
| `GRAVITY` | 1800 | was 300 — a 184px, 2.2s moon jump |
| `FALL_GRAVITY_MULTIPLIER` | 1.35 | heavier falling = platformer "snap" |
| `JUMP_VELOCITY` | -700 | `JUMP_HEIGHT_PX` = 136px, ~0.7s airtime |
| `JUMP_CUT_MULTIPLIER` | 0.45 | releasing mid-rise cuts the arc |
| `COYOTE_TIME_MS` / `JUMP_BUFFER_MS` | 100 / 120 | forgiveness both sides of a ledge |
| `PLAYER_WALK_SPEED` | 220 | with accel/friction, not instant velocity |
| `WALL_JUMP_HORIZONTAL` / `_VERTICAL` / `_LOCKOUT` | 230 / -640 / 140ms | modest push + short lockout so a flat wall stays climbable |

- **Fixed timestep**: `PHYSICS_DT = 1/60`, max 5 steps/frame, on both sides.
- **Collision**: `moveAndCollide` resolves X then Y with sub-stepping capped at 12px, so nothing tunnels even at dash speed (1000 px/s) or 20fps.
- **Jump is edge-triggered.** `tickPlayer` starts a jump only on a press edge (`up && !jumpHeld`). Anything driving it must release between jumps — that is why `EnemyBrain` holds jump for 240ms then forces a 60ms release. Emitting `jump` on scattered single frames only ever produces a minimum-height hop.

## Netcode
- **Input sequencing.** Every fixed step the client sends `{seq, ...intent}`. The server echoes `lastSeq` with the full `PlayerPosition`.
- **Reconciliation is rewind + replay**, not a blend. `PredictedPlayer.reconcile` drops acknowledged inputs, rewinds to the authoritative state, and replays the rest. Because the sim is deterministic, a correct prediction replays to exactly where it already was — measured error is **0.00px**. The old 15% blind lerp produced a permanent ~14px standing error.
- **Never simulate a tick the client did not send.** When the server's input queue starves it freezes that player for up to `MAX_STARVED_TICKS` (6) instead of repeating input. Each invented tick is a permanent error the client cannot replay away (~8px per tick while falling, ~24px per snapshot).
- **The server keeps the whole `PlayerPosition`.** It used to rebuild it each tick with `wallTouch: "none", wallJumpTimer: 0`, so the server could never wall jump while the client could.
- **Remote entities are interpolated, never predicted.** 150ms delay (3 snapshot intervals at 20Hz); 2 intervals emptied the buffer on a single dropped datagram and the remote teleported ~100px.
- **Respawns are announced, not inferred.** The server broadcasts `round-reset`; the client drops all interpolation history. Blending across a respawn draws the remote sliding through the arena.
- Interpolated positions are depenetrated with `resolveOverlap` before drawing — a straight line between two legal snapshots can still clip a corner.

## Important Rules
- Input handling lives in the `Game.ts` scene, not `Player.ts` (avoids duplicate listeners).
- `EnemyBrain.ts` drives both AI fighters; tune via `AIConfig.ts`.
- `EventBus` carries Phaser → React events (`bullet-fired`, `enemy-hp-changed`).
- Phaser 4 vs 3: `color` not `fill` in TextStyle, `currentAnim.key` not `getCurrentKey()`.
- After any change: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`.
- Restart `npm run dev:server` after touching `server/` or `src/game/simulation/` — tsx does not hot-reload.
- Ports: Vite 8080, Geckos 9208. `npm run dev:all` runs both.
- Online: `http://localhost:8080/?online=true`, two tabs. Add `&ai=true` for AI-vs-AI online.
- Online match end: at 0 HP the server waits 1.5s, resets both fighters, and broadcasts `round-reset`.
- Wall jump: press jump while airborne with `wallTouch !== "none"`. Ground jump wins when grounded. World edges are wall-jumpable; chained wall jumps can climb a flat wall.

## Physics Diagnostic Tool

### Console commands (F12)
- `window.__physicsDiagnostic(durationMs = 5000)` — collect frames, print a JSON report
- `window.__gameState()` — HP, AI states, and full `playerPhys` / `enemyPhys`
- `window.__toggleAIVsAI()` — or press **P** in-game

### Harness (preferred)
```bash
npm run dev:server &          # :9208 — REQUIRED for online runs
npm run dev &                 # :8080
node scripts/diagnose.mjs                       # offline + online, 8s each
node scripts/diagnose.mjs --mode=online --runs=3
node scripts/probe-online.mjs                   # dump one online client's console
```

### Reading the report
`__DIAGNOSTIC_RESULT__{...}__END__` on one console line.

| Field | Meaning |
|---|---|
| `verdict` | `PASS` only when there are **no jitter events and no penetrations** |
| `collisionSummary.penetrationFrames` | frames a body was inside solid geometry — **must be 0** |
| `movementSummary` | `jumps`, `wallJumps`, `pctAirborne`, `peakRisePx` — is the fighter using the arena? |
| `reconciliationSummary.avgErrorPx` | client/server disagreement; **0.00 is achievable and expected** |
| `reconciliationSummary.visibleCorrections` | corrections > 1px; only respawns should appear |
| `playerMovement.xRange/yRange` | a tiny range means the AI is stuck, even when the verdict says PASS |

Jitter thresholds: `player_x` 35px, `player_y` 25px, camera 15px. Announced
teleports suppress checking for 4 frames.

### Traps that produce false results
- **A dead game server reads as PASS.** No snapshots means no reconciliation and
  no jitter. `scripts/diagnose.mjs` now preflights `:9208` and marks a run
  `INVALID: no server snapshots received`. Never trust an online run without a
  `reconciliationSummary`.
- **`pgrep -f "tsx server/index.ts"` matches its own shell.** Check the port
  instead: `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9208/.wrtc/v2/connections`.
- **`verdict: PASS` is necessary, not sufficient.** Read `xRange`/`yRange` and
  `movementSummary` too — a fighter wedged in a corner is perfectly jitter-free.
- Restart the server after editing anything under `server/` or `simulation/`; tsx does not hot-reload.

### AI vs AI mode
Both fighters run an `EnemyBrain`; on a KO both reset after 2s (1.5s online).
Logs: `[FIGHT]` hits and KOs, `=== FIGHT RESET ===`, `[ONLINE] round reset`.
Online damage is applied server-side and is **not** logged as `[FIGHT]` — use the
HP trace from `__gameState()` to tell whether an online fight is really happening.

## Skill Index

Every skill lives in `.agents/skills/<name>/SKILL.md` and is loaded with `skill({ name: "<name>" })`.
Keep this list in sync — the knowledge-sharpener skill verifies it.

### Project

- **`feedback-loop`** — Diagnosing physics jitter, network desync, or gameplay bugs in Vento Ãureo
- **`knowledge-sharpener`** — Run at the END of a substantial session: fold what was learned into AGENTS.md and the skills, and verify the skill index.

### Phaser 4 reference

- `actions-and-utilities` — Working with Phaser 4 utility functions, actions, alignment, grid layout, or batch operations on game...
- `animations` — Creating or controlling sprite animations in Phaser 4
- `audio-and-sound` — Adding audio or sound to a Phaser 4 game
- `cameras` — Working with cameras in Phaser 4
- `curves-and-paths` — Working with curves and paths in Phaser 4
- `data-manager` — Using the Phaser 4 DataManager to store custom key-value data on game objects, listen for data change...
- `events-system` — Working with the Phaser 4 event system
- `filters-and-postfx` — Applying visual filters or post-processing effects in Phaser 4
- `game-object-components` — Working with Phaser 4 game object components and the mixin system
- `game-setup-and-config` — Creating a new Phaser 4 game instance or configuring GameConfig options
- `geometry-and-math` — Using Phaser 4 math and geometry utilities
- `graphics-and-shapes` — Drawing shapes and graphics in Phaser 4
- `groups-and-containers` — Using Groups or Containers in Phaser 4
- `input-keyboard-mouse-touch` — Handling user input in Phaser 4
- `loading-assets` — Loading assets in Phaser 4
- `particles` — Creating particle effects in Phaser 4
- `physics-arcade` — Using Arcade Physics in Phaser 4
- `physics-matter` — Using Matter.js physics in Phaser 4
- `render-textures` — Using RenderTexture or DynamicTexture in Phaser 4
- `scale-and-responsive` — Making a Phaser 4 game responsive or handling display scaling
- `scenes` — Working with Phaser 4 scenes
- `sprites-and-images` — Creating Sprites or Images in Phaser 4
- `text-and-bitmaptext` — Displaying text in Phaser 4
- `tilemaps` — Working with tilemaps in Phaser 4
- `time-and-timers` — Using timers and time-based events in Phaser 4
- `tweens` — Animating properties over time in Phaser 4
- `v3-to-v4-migration` — Migrating a Phaser 3 project to Phaser 4, or when a user asks about breaking changes, API differences,...
- `v4-new-features` — Learning about new features, game objects, components, and rendering capabilities added in Phaser 4

## Agent Config Layout (write once, run everywhere)

One source of truth, symlinks for every other tool's convention. Supported tools: **OpenCode** and **Claude Code**.

```
AGENTS.md                     # source of truth for project instructions
CLAUDE.md         -> AGENTS.md          (symlink)
.agents/skills/<name>/SKILL.md          # source of truth for all skills
.claude/skills    -> ../.agents/skills  (symlink, whole directory)
```

Why this works:
- **OpenCode** reads `AGENTS.md` natively and discovers skills in `.agents/skills/`, `.claude/skills/`, and `.opencode/skills/` — so it needs no symlink at all.
- **Claude Code** reads `CLAUDE.md` and only discovers project skills in `.claude/skills/` — both are satisfied by the symlinks above.
- The `.claude/skills` symlink points at the *directory*, not individual skills, so a new skill added to `.agents/skills/` shows up in both tools with **zero** extra setup.

### Rules
- **Never** edit `CLAUDE.md` or anything under `.claude/skills/` — they are symlinks. Edit `AGENTS.md` and `.agents/skills/` instead.
- **Never** create a real `CLAUDE.md` file or a real `.claude/skills/` directory; that forks the knowledge and the two tools drift apart.
- New skill = new folder `.agents/skills/<kebab-name>/SKILL.md`. Nothing else to wire up.
- Symlinks are committed to git (git stores them as symlinks), so a fresh clone works in both tools immediately.

### SKILL.md frontmatter (must satisfy both tools)
```yaml
---
name: kebab-case-name        # required, must equal the folder name, ^[a-z0-9]+(-[a-z0-9]+)*$
description: One line...     # required, when to use the skill + trigger keywords
---
```
Keep frontmatter to the fields both tools understand. Avoid tool-specific keys such as `compatibility:` (OpenCode-only) — they make a skill read as single-tool.

### Recreating the symlinks
```bash
ln -sfn AGENTS.md CLAUDE.md
mkdir -p .claude && ln -sfn ../.agents/skills .claude/skills
```

### Adding a third tool later
Point its expected path at the same source, e.g. Cursor: `ln -sfn ../.agents/skills .cursor/skills`. Do not copy files.
