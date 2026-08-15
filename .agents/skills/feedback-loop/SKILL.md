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
| `meleeSummary` | a sword system whose blocks, parries and Massive Strikes were never happening at all |
| `arenaSummary` | a fight confined to 11% of the arena, using one of nine surfaces and firing no shots — with every correctness metric clean |

A metric that cannot fail is worthless. Before trusting a green run, confirm the
instrument discriminates — the projectile metrics were only believable because
they first reported `3 jumps, 6 stalls`, then `5 jumps`, and only then zero.

### Count what should happen, not only what must not

Every "must be 0" metric is trivially satisfied by a build where the mechanic
never runs. `meleeSummary` therefore has two halves, and the second one is where
the real bugs surfaced:

- **Violations** (`illegalActions`, `blockedUnblockables`, `frameDataViolations`,
  `stuckActionFrames`, `meleeDesyncFrames`) must all be **0**.
- **Counters** (`slashes`, `massives`, `plunges`, `uppercuts`, `blocks`,
  `parries`, `backstabs`, `blasts`, `bombs`, `butterflyChains`) must all be
  **> 0** across a few runs.

`parries` is the guard-break counter: every guard that stops a sword attack is
a `parried` outcome — there is no rewardless "blocked" tier left — so a run
with guards meeting swings must show parries, and `parries: 0` beside a healthy
`blocks` means swings are not reaching the guards. A charge is a 2.5s commitment,
so `massives` (ground slams) legitimately run at 0 in single duels while
`plunges`/`bombs` (the airborne half) fire — the back-massive and bomb rows in
`training-probe.mjs` cover the ground slam deterministically.

Both of the worst sword bugs presented as a zero in the second half while the
first half read perfectly clean: reactive blocking was *impossible* online
(19 guards raised, 0 slashes intercepted), and the backstab was firing on
overlapping bodies (11 backstabs to 1 clean hit, which also silently disabled
blocking, since a backstab ignores the guard).

### Coverage is a metric, and absence must be loud

Correctness says whether what happened was legal. **Coverage says whether enough
happened to be worth trusting.** They fail independently, and the second failure
is the quiet one:

- `bulletSummary` used to return *nothing* when no projectile was fired, so "the
  ranged game never happened" and "projectiles were flawless" printed
  identically. An empty section must become a loud zero.
- `arenaSummary` exists because the AI learned to sword-fight and promptly
  stopped using 89% of the arena. Every violation counter stayed clean while the
  ledges, the wall jumps, the line-of-sight cover and the entire ranged pipeline
  went untested.

**Judge coverage across a few runs, not one.** Individual matches legitimately
vary — one is a brawl, the next a ranged duel across the ledges — and that
variety is the point. What must hold every run is that the violation counters are
zero; what must hold across a handful is that every mechanic fired at least once.

When a counter is stuck at zero, **break it down before theorising**.
`outcomeByMove` was added for exactly this: a flat `blocked: 0` reads identically
whether guards are failing or whether everything that connected was unblockable
by design, and those need opposite fixes.

### Baseline the rule you changed, not the build you remember

A counter that looks wrong after a change is not evidence until you have seen
what it reads *without* that change. AI-vs-AI counts vary run to run, so a memory
of "there used to be more parries" is worthless.

The cheap, decisive move is to **revert only the one rule, re-run, and compare**:
after freeing facing during a swing's recovery, three runs reported `parries: 0`.
Temporarily restoring the old line and re-running gave `1, 0, 2` — and the fixed
build then gave `3, 1, 0`. Same range, no regression, question closed in four
minutes. Guessing would have cost an afternoon or shipped a real regression.

Restart the server between the revert and the re-run — tsx does not hot-reload
`server/` or `simulation/`, so an unrestarted server measures the old rule twice.

### A metric must know the resolution of what it watches

The remote fighter is only visible at 20Hz, so judging its frame data against a
60Hz tolerance reported the *network* as a state-machine bug. Same family as the
stale jitter threshold: a metric that flags correct behaviour trains you to
ignore it.

Likewise, **exclude what the client provably cannot predict.** Melee stun, launch
and knockback are announced by the server, so they are marked as teleports and
excluded from the desync counter — otherwise the metric fails hardest exactly
when combat is working.

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
node scripts/diagnose.mjs --mode=online --runs=3   # the canonical duel
node scripts/deathmatch-probe.mjs                  # a room full of AI, to a winner
node scripts/tdm-probe.mjs                         # the same, in two sides
```

- **Online AI vs AI is the reference mode.** Two AI fighters over the real
  server exercise prediction, reconciliation, remote rollback, projectile
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

### What a duel cannot test: everything that only breaks at sixteen

`--mode=online` seats two fighters — two clients in one room, and bots are opt-in,
so that is all there is in it. That is the cleanest place to read
prediction, reconciliation and projectile flight — and it is blind to every bug
that needs a crowd.

```bash
node scripts/deathmatch-probe.mjs                                   # to the frag limit
node scripts/deathmatch-probe.mjs --scoreLimit=999 --timeLimit=20   # to the clock
node scripts/tdm-probe.mjs                                          # two sides, to a winning team
```

**A team match is a third thing again, and the deathmatch probe cannot see it.**
Every check it makes passes in a room where friendly fire is on and rounds never
end — frags still exceed nothing, names are still unique, a winner is still
ranked first. `tdm-probe.mjs` watches the *rounds* go by (a wipe is one tick in a
thirty-second fight, so the final scoreboard cannot prove one happened) and
reconstructs friendly fire from the standings: with none, a side's deaths can only
have been scored by the other side.

Every one of these was found by the sixteen-fighter run and was invisible to the
duel:

- **A metric that assumed one opponent.** `enemy_x`/`enemy_y` follow "the primary
  remote". Derived per call from a list that gets rebuilt, the *subject* changed
  between frames, and the metric reported the gap between two fighters standing in
  different parts of the arena as 45-75px of jitter. Check
  `net.rollback.primarySwitches` before believing those two numbers, and before
  trying to fix the netcode they are accusing.
- **A stale roster deleting live fighters.** Presence taken from an unordered
  datagram destroyed and rebuilt entities a frame later, throwing away their
  prediction. The only visible symptom was `primarySwitches` counting more changes
  than anybody had joined or left.
- **The victim of a hit.** Deriving it from `attackerId === myId` is correct in a
  duel and punches the local fighter's sprite for every hit between two other
  players.
- **A snapshot too big for a datagram.** Sixteen verbatim `PlayerPosition`
  objects is ~128 KB/s. `net.avgSnapshotBytes` is in the report because that is
  what forced the packed wire format.

**Read `net.rollback` on any online run.** Rollback trades a fixed visual delay
for occasional misprediction, so `avgErrorPx` and `visibleCorrections` are how you
know the trade came out ahead. `jitterSummary` measures the *drawn* position and
should be 0; the raw corrections live in `net.rollback`, so smoothing them hides
nothing.

### What AI vs AI cannot test: aim

The brains hand the simulation an aim angle directly and never touch a cursor, so
**every mouse bug is invisible to the canonical run**. A cursor→world conversion
that divided by the canvas backing store instead of the logical view put aim up
to 162° out on any 2x display, and three clean `diagnose.mjs` runs said nothing.

```bash
node scripts/aim-probe.mjs            # dpr 1 and 2
node scripts/aim-probe.mjs --dpr=2    # the ratio that catches backing-store bugs
```

It drives a real mouse around the canvas and measures the cursor→world error, the
aim angle, which side the fighter turned to, how long it ignores a cursor that
crossed sides *while swinging* (`attackTurn.worstMs`), and the heading a fired
bullet actually left with. Run it after touching `input/`, `app.ts`, facing rules
or anything that spawns a projectile.

### Controller mode is a third blind spot

`aim-probe.mjs` measures the *cursor*, and controller mode does not use one.
Playwright cannot press a physical gamepad button either — but the Gamepad API is
**polled**, so a stub of `navigator.getGamepads` is genuinely equivalent from the
game's point of view.

```bash
node scripts/pad-probe.mjs
```

It drives the d-pad, the left stick, the right stick and a mouse-as-stick, and
checks the numbers that separate a correct build from a plausible one: a left
stick pushed at 30° must aim at 30° (a quantised one lands on the 45° diagonal),
and an upward stroke from "aiming right" must **run up the arc past 45°**, where
a clamping implementation stalls near -63° forever. It then taps the on-screen
gamepad on a phone-shaped context — including a thumb held at 30° on the cross,
which is the deck's analog Contra aim, the aim pad firing the gun in gun mode,
since on a phone the pad is its trigger, and the deck following the stance (it
draws the left stick as an analog pad, and hides block and uppercut in gun mode
because they are sword moves). Run it after touching `input/`, the aim layers,
the Esc menu's controls dialog, the deck, or the page layout.

### What AI vs AI cannot test: one specific interaction

A brain never does the same thing twice. The canonical run can tell you that
*something* legal happened; it cannot tell you whether **this** block stops
**that** slash — and every input feature so far was validated by inference from
a noisy fight rather than by observation.

```bash
node scripts/training-probe.mjs             # the full battery
node scripts/training-probe.mjs --only=backstab
```

`?training=true` seats a **scriptable dummy** instead of a bot, and
`window.__training` drives both it and your own fighter. It is still an ordinary
online match — the dummy is server-side precisely so a scenario exercises
prediction, reconciliation and server-owned hits rather than bypassing them.

**Reach for the training probe when the question names one mechanic**: does a
guard stop a slash, does an uppercut beat it, is the recovery on a whiffed
Massive actually punishable, does the frame data match the table. **Reach for
`diagnose.mjs` when the question is about the whole system**: jitter,
reconciliation error over a real fight, arena coverage, projectile trajectories.
Neither replaces the other — a training scenario is 850ms of two fighters doing
exactly one thing, which is a terrible sample of a match and a perfect sample of
a mechanic.

Two traps specific to the training room, both of which produce a confident wrong
answer rather than an error:

- **A stale server.** `tsx` does not hot-reload, and `src/game/training/` is
  server code. The client reloads, so a scenario happily reads its new config
  back and then measures the fighters standing at the *old* spawn positions.
- **A scenario that measures its own setup.** A punish test whose setup move
  *lands* stuns the dummy, and the stun eats the counter-attack it was supposed
  to demonstrate. Whiff on purpose when recovery is the thing under test.

Its determinism row is not a nicety: if the same script produces different events
on two runs, nothing measured with the training room means anything, and that is
a bug in the room rather than flakiness to retry around.

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
server via `server/physics.ts`. It must stay free of the rendering engine, the
DOM and wall-clock time — determinism is what makes prediction reconcile instead
of rubber-band.

- `Arena.ts` — world bounds, `platforms`, rect maths, `hasLineOfSight`, `penetrationDepth`, `narrowGaps`
- `Collision.ts` — `moveAndCollide` (swept, axis-separated, 12px sub-steps), `probeWall`, `resolveOverlap`
- `Physics.ts` — tuning constants, `PlayerPosition`, `createPlayerState`, `tickPlayer`, bullets

Fixed timestep `PHYSICS_DT = 1/60` with a max of 5 steps per frame, on both sides.
Jump is **edge-triggered** (`up && !jumpHeld`), so anything driving it must release
between jumps.

Netcode: input sequencing + rewind-and-replay reconciliation, a starvation freeze on
the server, GGPO-style rollback for remote fighters (carry their last input forward,
rewind on every snapshot), and explicit `respawn` / `round-reset` broadcasts.
See [`docs/invariants.md`](../../../docs/invariants.md) for the reasoning behind
each.

## Diagnostic Tool: `window.__physicsDiagnostic(durationMs)`

### How It Works

Installed by `Match` alongside `__toggleAIVsAI` and `__gameState`. The function:

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
pnpm run dev:server &   # :9208 — REQUIRED for online runs
pnpm run dev &          # :8084

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
| `meleeSummary.illegalActions` | Somebody acted while stunned; must be 0 |
| `meleeSummary.blockedUnblockables` | A guard stopped the uppercut; must be 0 — the massive's *swing* is blockable by design now |
| `meleeSummary.frameDataViolations` | A move ignored its own `MOVES` table; `violations[]` names which |
| `meleeSummary.meleeDesyncFrames` | The client drew a swing the server never ran; must be 0 |
| `meleeSummary` counters all > 0 | The mechanics actually fired. A clean run with zeroes here proves nothing |
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
| 12 | Phantom frozen bullets | The fighter classes spawned their own sprites that nothing simulated | Only `BulletSystem` (offline) or the server (online) spawns bullets |
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
  `simulation/`. `pnpm run dev:herdr` restarts both and waits for the ports.
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
- **A sampler that throws every call reads as an empty run.** Any named inner
  function inside a `page.evaluate` gets esbuild's `__name(fn, "fn")` decoration,
  which Playwright serializes into the browser where `__name` does not exist — so
  the callback throws, and a `try/catch` around it silently returns nothing
  forever. `diagnose.ts`'s state sampler did exactly this since the TS migration:
  `activity.hpTrace` was always `[]` and `fighting: false`, so the fight metric
  could never go red. Keep evaluate callbacks to literals and page globals; a
  `try/catch` that swallows the *callback's* failure is a metric that cannot fail.

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
| `scripts/aim-probe.mjs` | Drives a real cursor: screen→world mapping, facing, and shot direction, at dpr 1 and 2 |
| `scripts/pad-probe.mjs` | Stubs the Gamepad API: the two controller aim layers, pad bindings, and the on-screen deck on a phone-shaped context |
| `scripts/training-probe.mjs` | One interaction at a time against a scripted dummy: block, uppercut, backstab, frame data, determinism |
| `scripts/potg-probe.mjs` | The end-of-match ceremony — the **only** probe that reads past `phase === "over"`, which is the frame every other one stops on |
| `server/TrainingDummy.ts` | The scriptable dummy: a deterministic input source with `EnemyBrain`'s contract |
| `src/game/training/TrainingRoom.ts` | `window.__training`, and the report as a *view* over `PhysicsDiagnostics` |
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
