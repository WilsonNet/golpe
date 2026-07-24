---
name: feedback-loop
description: "CRITICAL: Use this skill when diagnosing physics jitter, network desync, projectile/bullet trajectory problems, or gameplay bugs in Vento Áureo. The canonical test is ONLINE AI vs AI — this game is online first. Covers the __physicsDiagnostic() tool, Playwright test workflow, reading diagnostic JSON reports, fixed-timestep model, reconciliation snap logic, jitter thresholds, and the one-shot feedback loop pattern. Triggers on: jitter, diagnostic, physics bug, desync, reconciliation, teleport, rubber-banding, stutter, framerate issue, Playwright test, feedback loop."
license: MIT
---

# Physics Diagnostic & Feedback Loop

**This is the most important part of the project.** Every fix must be verified through the feedback loop below. Do NOT guess at code changes without running the diagnostic first and after to confirm the fix.

## Rule 0: If there is no instrumentation to measure it, build the instrumentation

If the feedback loop is incomplete — missing diagnostic functions, missing Playwright scripts, missing console logging, missing any measurable output — **stop and build the missing tool before attempting any fix.**

This is the first step of the loop, not a preliminary to it. Every metric in the
report exists because a real bug was invisible without it:

| Metric | The bug it was built to see |
|---|---|
| `collisionSummary` | players walking through platforms while the verdict said PASS |
| `movementSummary` | a 184px / 2.2s moon jump, and an AI wedged in a 36px pocket |
| `bulletSummary` | projectiles stuttering, stalling and jumping between sprites |
| `reconciliationSummary` | a permanent ~14px client/server standing error |

A metric that cannot fail is worthless. Before trusting a green run, confirm the
instrument discriminates — the projectile metrics were only believable because
they first reported `3 jumps, 6 stalls`, then `5 jumps`, and only then zero.

The rule: **if you can't measure it, you can't fix it.** Never proceed with a physics fix if:
- There is no `window.__physicsDiagnostic()` (or equivalent) producing structured data
- There is no Playwright workflow to capture and deliver that data to the LLM
- The diagnostic output lacks the specific metric you need (e.g., reconciliation error, jitter events, physics step distribution)
- The game cannot run autonomously (AI vs AI mode, automated input)

In those cases, your first task is to **build the measurement tool**, then run it to get a baseline, then fix, then re-measure. A half-measure with no feedback loop is worse than no fix at all — it wastes time and creates false confidence.

## Test online, in AI vs AI

**This game is online first.** Every match — including single player — runs
through the authoritative server, so the netcode is exercised whenever anyone
plays. Testing must follow the same rule.

```bash
node scripts/diagnose.mjs --mode=online --runs=3   # the canonical run
```

- **Online AI vs AI is the reference mode.** Two AI fighters over the real
  server exercise prediction, reconciliation, remote interpolation, projectile
  rendering and the arena at once, with no human needed.
- **An offline PASS proves almost nothing.** It bypasses prediction,
  reconciliation and server-owned bullets — precisely where the bugs have been.
  `--mode=offline` is only useful for isolating pure-simulation behaviour, and
  unit tests do that better and faster.
- **Single player is not a separate path.** With no `?online=true` the server
  fills the second slot with a bot, so a solo match is a real online match. That
  is deliberate: it means playing the game is dogfooding the netcode.
- `?offline=true` exists only for working without a server. Never diagnose it and
  conclude anything about the netcode.

## Architecture Overview

The game has a Physics Diagnostic Tool that emits structured JSON reports. These reports are captured by Playwright and fed back to the LLM as hard numerical data. This replaces blind guessing with a measurable feedback loop.

```
[Game] --window.__physicsDiagnostic()--> JSON report --> console
                                                           |
[Playwright] --page.evaluate()--> reads console --> parses JSON
                                                           |
[LLM] analyzes report --> codes fix --> Playwright re-runs diagnostic
                                                           |
                                                    verify verdict === "PASS"
```

## Physics Model

All gameplay simulation lives in `src/game/simulation/`, imported unchanged by the
server via `server/physics.ts`. It must stay free of Phaser, the DOM and wall-clock
time — determinism is what makes prediction reconcile instead of rubber-band.

- `Arena.ts` — world bounds, `platforms`, rect maths, `hasLineOfSight`, `penetrationDepth`, `narrowGaps`
- `Collision.ts` — `moveAndCollide` (swept, axis-separated, 12px sub-steps), `probeWall`, `resolveOverlap`
- `Physics.ts` — tuning constants, `PlayerPosition`, `createPlayerState`, `tickPlayer`, bullets

Fixed timestep `PHYSICS_DT = 1/60` with a max of 5 steps per frame, on both sides.
Jump is **edge-triggered** (`up && !jumpHeld`), so anything driving it must release
between jumps.

Netcode: input sequencing + rewind-and-replay reconciliation, a starvation freeze on
the server, 150ms remote interpolation delay, and an explicit `round-reset` broadcast.
See the Netcode section of AGENTS.md for the reasoning behind each.

## Diagnostic Tool: `window.__physicsDiagnostic(durationMs)`

### How It Works

Added to `Game.ts` create() alongside `__toggleAIVsAI` and `__gameState`. The function:

1. Sets `_diagActive = true` and initializes frame buffers.
2. Each game `update()` frame records: `playerX/Y/Vx/Vy`, `enemyX/Y/Vx/Vy`, `cameraX/Y`, `t`, `dt`, `physicsSteps`.
3. At the end of the sample period, computes statistics and outputs the report.
4. The report is `console.log`'d wrapped in:
   ```
   __DIAGNOSTIC_RESULT__{...json...}__END__
   ```

### Output Format

```json
{
  "mode": "offline|online",
  "durationMs": 5000,
  "totalFrames": 425,
  "fpsStats": {
    "minFps": 85,
    "maxFps": 85,
    "avgFps": 85,
    "avgDtMs": 11.77,
    "dtStdDevMs": 0.01
  },
  "physicsStepDistribution": {
    "zeroStepFrames": 125,
    "oneStepFrames": 300,
    "twoStepFrames": 0,
    "pctZeroStep": 29
  },
  "playerMovement": {
    "xRange": [255, 361],
    "yRange": [336, 520],
    "totalTravelPx": 1117
  },
  "jitterEvents": [
    {
      "frame": 100,
      "type": "player_x",
      "delta": 47.13,
      "expectedMax": 35,
      "severity": 1.35
    }
  ],
  "jitterSummary": {
    "total": 0,
    "avgSeverity": 0,
    "maxSeverity": 0,
    "byType": {}
  },
  "reconciliationEvents": [
    {
      "frame": 0,
      "serverX": 410.75,
      "clientX": 405.74,
      "correction": 5.90
    }
  ],
  "reconciliationSummary": {
    "totalCorrections": 125,
    "avgErrorPx": 33.24,
    "maxErrorPx": 343.19,
    "cumulativeDriftPx": 4154.53
  },
  "verdict": "PASS: No jitter detected"
}
```

### Field Meanings

| Field | Meaning |
|-------|---------|
| `fpsStats` | Framerate analysis. `dtStdDevMs` < 0.5 means stable framerate. |
| `physicsStepDistribution` | How many physics steps ran per frame. `pctZeroStep > 10%` means display FPS exceeds physics FPS (normal for >60fps). At 60fps: 0% zero-step frames = perfect. |
| `jitterEvents[]` | Frames where position delta exceeded the threshold. Each event has `type` (player_x, player_y, enemy_x, enemy_y, camera_x, camera_y), `delta` (px), `severity` (multiple of threshold). **Fight resets are filtered out.** |
| `jitterSummary` | Aggregated jitter stats. `total` is the key metric to track. |
| `reconciliationEvents[]` | **Online mode only.** Every server snapshot correction. `serverX` = authoritative pos, `clientX` = client pos AFTER correction, `correction` = euclidean error BEFORE correction was applied. |
| `reconciliationSummary` | Aggregated reconciliation stats. `avgErrorPx` shows typical server-client divergence. `maxErrorPx` shows worst-case. `cumulativeDriftPx` is sum of all corrections. |
| `verdict` | `"PASS"` if zero jitter events. `"FAIL: N jitter events detected"` otherwise. |

### Jitter Thresholds (derived, in `PhysicsDiagnostics.ts`)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `DIAG_JITTER_X` | 35px | Covers max 2-step dash at 30fps (33.3px) with headroom. Captures reconciliation snaps >35px. |
| `DIAG_JITTER_Y` | 25px | Covers max 2-step free-fall at 30fps (20px) with headroom. Captures vertical reconciliation snaps. |
| `DIAG_JITTER_CAM` | 15px | Camera should move smoothly; large single-frame camera moves indicate jitter. |

Calibrate with Python:
```python
PHYSICS_DT = 1/60
DASH_SPEED = 1000
GRAVITY = 300
max_x = DASH_SPEED * PHYSICS_DT * 2  # 33.3px (2 steps at 30fps)
max_y = GRAVITY * 2 * PHYSICS_DT * 2 # 20px (2 steps falling at 30fps)
```

### Skipped Frames

Fight reset teleports are excluded from jitter detection via `_diagSkipJitter = true` flag set in `resetFight()`. Online server reconciliation snapshots with error >100px snap directly (no lerp), which may cause a single-frame jitter event at the reset boundary. This is intentional.

## Running the Loop

Use the harness — it handles two-tab matchmaking, console scraping, server
preflight and the digest.

```bash
npm run dev:server &   # :9208 — REQUIRED for online runs
npm run dev &          # :8080

node scripts/diagnose.mjs                          # offline + online, 8s each
node scripts/diagnose.mjs --mode=offline
node scripts/diagnose.mjs --mode=online --runs=3   # stability check
node scripts/probe-online.mjs                      # raw console when a run looks wrong
```

The report line is parsed with:

```js
/__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s
```

Unit tests are the fast inner loop — prefer them for anything about collision,
jump feel or arena layout, and reserve the browser for netcode and integration:

```bash
npx vitest run src/game/simulation/Physics.test.ts
```

### Verdict interpretation

| Signal | Meaning |
|---|---|
| `verdict: PASS` | No jitter events **and** no penetrations |
| `collisionSummary.penetrationFrames > 0` | A body was inside geometry — collision regression |
| `reconciliationSummary.avgErrorPx > 0` | Client/server divergence; 0.00 is achievable |
| `visibleCorrections` beyond ~1 per round | Something other than respawn is correcting |
| `movementSummary.jumps == 0` | The fighter is not moving — check the arena and AI |
| `bulletSummary.teleportFrames`/`frozenFrames` | Projectile jumped or stalled; both must be 0 |
| `bulletSummary.maxPathDeviationPx > 0` | A "straight" bullet path bent — sprite identity churn |
| `bulletSummary.maxStepRatio` | Worst step vs expected; 1.0 is ideal, healthy is ~1.2 |
| `bulletSummary.avgStepCv` | Step-length evenness; 0 is perfect, healthy is ~0.05 |
| tiny `xRange`/`yRange` | Stuck fighter, regardless of verdict |

## Known Root Causes (all fixed — do not reintroduce)

Each of these was found by measurement, not by reading code.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Players walk through platforms | Side collision was gated on `!grounded`, so a walking player was never blocked | Single `moveAndCollide` pass; contacts are valid grounded or not |
| 2 | Floaty, unfun jump (184px / 2.2s) | `GRAVITY = 300` with `JUMP_VELOCITY = -330` | Jump-first tuning: 1800 / -700 → 136px / ~0.7s |
| 3 | Visuals disagree with colliders | Platform sprites hand-placed; a 400px image drew a 100px collider | `ArenaRenderer.drawArena` derives sprites from `platforms` |
| 4 | Sprites half a body off | Body coords (top-left) assigned to centre-origin sprites | `syncSpriteToBody` everywhere |
| 5 | Constant ~14px online desync, 1790px cumulative drift | Blind 15% lerp per snapshot; predicted inputs were never replayed | Input `seq` + rewind-to-authoritative + replay unacked → **0.00px error** |
| 6 | Server could never wall jump | `GameRoom` rebuilt `PlayerPosition` each tick with `wallTouch: "none"` | Store the full state per player |
| 7 | ~24px correction every snapshot, player never landed | Server repeated the last input when its queue starved, simulating ticks the client never did | Freeze the player for up to 6 starved ticks instead |
| 8 | Remote player teleports ~100px | Interpolation delay of 2 snapshot intervals emptied on one dropped datagram | 150ms (3 intervals) + ease toward target |
| 9 | Remote clips through platforms | Interpolated paths are not simulated and cut corners | `resolveOverlap` before drawing |
| 10 | AI could only ever short-hop | `EnemyBrain` emitted `jump` on scattered single frames; jump height is analogue | Hold 240ms, then force a 60ms release for the next press edge |
| 11 | AI wedged in a 36px box, never fought | A 30px arena gap under an overhang, narrower than `PLAYER_WIDTH` | Move the pillars; `narrowGaps()` invariant test |
| 12 | Phantom frozen bullets | `Player`/`AIEnemy` spawned their own sprites that nothing simulated | Only `BulletSystem` (offline) or the server (online) spawns bullets |
| 13 | Projectile sprite jumps between bullets | Sprites indexed by snapshot array position; the server `splice`s dead bullets so indices shift | Key sprites by bullet id |
| 14 | Projectiles laggy and stuttering | Bullets interpolated 150ms in the past, mixed with a dead-reckon fallback computed at a different time base (~90px jump when crossing between them) | Dead-reckon only — bullets are ballistic and closed-form |
| 15 | Projectile sawtooth (jump every 50ms, stall between) | Position re-derived from the newest snapshot each frame, so each snapshot moved the extrapolation base | Anchor once on first sight, then fly off the local clock |
| 16 | Projectiles blink and reappear past a wall | Occluded bullets were hidden but allowed back when they cleared the geometry | Occlusion retires a bullet permanently |
| 17 | Server crashed: "EnemyBrain is not a constructor" | A default export resolves to the module *namespace* under the server's ESM/CJS interop (`typeof` was `object`, keys `AIState,default`) | Named exports for everything `server/` imports |
| 18 | Intermittent `player_y` jitter on a healthy build | The 25px threshold was calibrated for `GRAVITY = 300`; at `MAX_FALL_SPEED = 950` a legal 30fps fall is 31.7px | Derive thresholds from the constants and the frame's dt |

## False PASS traps

A green verdict is necessary, not sufficient. These all produced convincing lies:

- **Dead game server.** No snapshots → no reconciliation → no jitter → `PASS`.
  `scripts/diagnose.mjs` preflights `:9208` and marks such runs
  `INVALID: no server snapshots received`. Never trust an online report with no
  `reconciliationSummary`.
- **`pgrep -f "tsx server/index.ts"` matches its own shell command line.** Check the
  port instead:
  `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9208/.wrtc/v2/connections`
- **A stuck fighter is perfectly smooth.** Always read `playerMovement.xRange/yRange`
  and `movementSummary` alongside the verdict.
- **Stale server.** tsx does not hot-reload; restart after editing `server/` or
  `simulation/`. `npm run dev:herdr` restarts both and waits for the ports.
- **An offline PASS is not evidence.** Offline skips prediction, reconciliation
  and server-owned bullets. Only `--mode=online` exercises them.
- **A metric that has never failed is not a measurement.** Confirm a new
  instrument can go red before believing it when it is green.
- **Thresholds rot.** A limit calibrated against old constants will either miss
  real defects or flag correct behaviour. Derive limits from the simulation
  constants and the frame's own dt so they track the physics automatically.
- **Idle fighters look healthy.** Playwright never presses a key, so a
  human-controlled fighter is motionless by definition. Assert damage only in AI
  modes; elsewhere assert the opponent exists and moves (`scripts/verify-modes.mjs`).

## Python Physics Analysis Script

For proper threshold calibration and physics behavior analysis:

```python
import math

PHYSICS_DT = 1/60
WALK_SPEED = 160
DASH_SPEED = 1000
JUMP_VEL = -330
GRAVITY = 300

# Simulate physics accumulator at different framerates
for fps in [30, 60, 85, 120]:
    frame_dt = 1000 / fps
    frame_dt_sec = frame_dt / 1000
    acc = 0.0
    step_counts = []
    for _ in range(fps * 10):  # 10 seconds
        acc += frame_dt_sec
        steps = 0
        while acc >= PHYSICS_DT and steps < 5:
            steps += 1
            acc -= PHYSICS_DT
        step_counts.append(steps)
    max_steps = max(step_counts)
    zero_pct = sum(1 for s in step_counts if s == 0) / len(step_counts) * 100
    max_x = DASH_SPEED * PHYSICS_DT * max_steps
    print(f"FPS {fps}: max_steps={max_steps}, zero_pct={zero_pct:.0f}%, max_x/frame={max_x:.1f}px")
```

## Files That Implement the Feedback Loop

| File | Purpose |
|------|---------|
| `scripts/diagnose.mjs` | Playwright harness: drives both modes, preflights the server, prints a digest |
| `scripts/probe-online.mjs` | Dumps one online client's console + `__gameState()` when something is off |
| `scripts/verify-modes.mjs` | Smoke-checks every launch mode: connects, matches, fights |
| `scripts/dev-herdr.mjs` | Dev servers in visible herdr panes, with real port readiness |
| `src/game/diagnostics/PhysicsDiagnostics.ts` | Collection and report generation |
| `src/game/simulation/` | The code under test — `Arena`, `Collision`, `Physics` |
| `src/game/simulation/Physics.test.ts` | 40 unit tests: feel, collision, arena invariants, determinism |
| `server/GameRoom.ts` | Authoritative simulation, input queue, `round-reset` |
| `AGENTS.md` | Invariants, physics model, netcode rules |

## How to One-Shot a Physics Fix

1. **Read the diagnostic report** from the most recent Playwright run.
2. **Identify the issue** from `jitterEvents[]` and `reconciliationSummary`.
3. **Locate the root cause** in the source code (use the Known Jitter Sources table above).
4. **Apply the fix** in the appropriate file.
5. **Run `tsc --noEmit` and `vite build`** to verify compilation.
6. **Re-run the diagnostic** with Playwright (same settings).
7. **Compare old vs new reports**:
   - Before: `"jitterSummary": {"total": 47}`
   - After: `"jitterSummary": {"total": 0}`
   - Before: `"verdict": "FAIL: 47 jitter events detected"`
   - After: `"verdict": "PASS: No jitter detected"`
8. **Run 3 consecutive tests** to confirm stability.
9. **Update AGENTS.md** with any new findings.
