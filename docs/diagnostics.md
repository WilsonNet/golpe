# The Physics Diagnostic

The measurement half of the feedback loop. **Load the `feedback-loop` skill for
the full workflow** — this file is the reference for the tool itself.

> **If there is no instrumentation to measure it, build the instrumentation.**
> That is the first step of the loop, not a preliminary to it.

## Console commands (F12)

- `window.__physicsDiagnostic(durationMs = 5000)` — collect frames, print a JSON report
- `window.__gameState()` — HP, AI states, and full `playerPhys` / `enemyPhys`
- `window.__toggleAIVsAI()` — or press **P** in-game

## Harness (preferred)

```bash
npm run dev:herdr                               # both servers in visible panes
node scripts/diagnose.mjs                       # offline + online, 8s each
node scripts/diagnose.mjs --mode=online --runs=3  # the canonical run
node scripts/probe-online.mjs                   # dump one online client's console
node scripts/verify-modes.mjs                   # smoke-check every launch mode
```

## Reading the report

Emitted as `__DIAGNOSTIC_RESULT__{...}__END__` on one console line.

| Field | Meaning |
|---|---|
| `verdict` | `PASS` only when nothing violated a rule — **necessary, not sufficient** |
| `collisionSummary.penetrationFrames` | frames a body was inside solid geometry — **must be 0** |
| `movementSummary` | `jumps`, `wallJumps`, `pctAirborne`, `peakRisePx` — is the fighter using the arena? |
| `playerMovement.xRange/yRange` | a tiny range means the AI is stuck, even when the verdict says PASS |
| `reconciliationSummary.avgErrorPx` | client/server disagreement; **0.00 is achievable and expected** |
| `reconciliationSummary.visibleCorrections` | corrections > 1px; only respawns should appear |
| `meleeSummary` violations | `illegalActions`, `blockedUnblockables`, `frameDataViolations`, `stuckActionFrames`, `meleeDesyncFrames` — **all must be 0** |
| `meleeSummary` counters | `slashes`, `massives`, `uppercuts`, `blocks`, `parries`, `backstabs`, `butterflyChains` — **must be > 0**, or the run proves nothing |
| `meleeSummary.outcomeByMove` | outcomes per move; a flat `blocked: 0` cannot distinguish "guards failing" from "everything that landed was unblockable" |
| `meleeSummary.violations[]` | which fighter broke which frame-data contract, and by how much |
| `arenaSummary.xSpanPct` / `ySpanPct` | how much of the arena the fight touched. A duel confined to a narrow band tests almost nothing |
| `arenaSummary.surfacesUsed` | distinct platforms stood on, out of `surfacesAvailable`. 1 of 9 means the ledges are untested |
| `bulletSummary.tracked` | projectiles seen. **0 means the entire ranged pipeline went untested**, not that it was flawless |
| `bulletSummary.teleportFrames` / `frozenFrames` | projectile jumps and stalls — **must be 0** |
| `bulletSummary.maxPathDeviationPx` | bend in a straight path; >0 means a sprite was reassigned |
| `bulletSummary.maxStepRatio` / `avgStepCv` | step vs expected (1.0 ideal) and evenness (0 ideal) |

## Designing a metric that works

Jitter thresholds are **derived from the physics constants and the frame's own
dt** (`speed × dt × 1.6`, floored at 35/25/15px), never hardcoded. The old fixed
25px `player_y` was calibrated against `GRAVITY = 300`; once `MAX_FALL_SPEED`
became 950 a single 30fps frame legitimately moved 31.7px and the metric started
reporting correct physics as a defect. Announced teleports suppress checking for
4 frames.

Three rules learned the hard way, all the same shape — **a metric that flags
correct behaviour trains you to ignore it**:

- **A metric must know the resolution of what it watches.** The remote fighter is
  only visible at 20Hz, and *every* fighter is sampled once per frame while the
  simulation steps at 60Hz — so a tolerance of one physics tick reported perfectly
  legal moves as violations the moment the frame rate dipped below 60.
- **Exclude what the client provably cannot predict.** Melee stun, launch and
  knockback are announced by the server, so they are marked as teleports and
  excluded from the desync counter — otherwise the metric fails hardest exactly
  when combat is working.
- **An announced discontinuity breaks continuity, it does not fail it.** A round
  reset replaces both fighters wholesale; a fighter caught mid-Massive looks
  exactly like an uncancellable move ending 650ms early. `markRoundReset()` drops
  the melee tracks, because after a respawn there is nothing left to compare
  against.
- **Count what should happen, not only what must not.** Every must-be-zero metric
  is trivially satisfied by a build where the mechanic never runs.
- **Absence must be loud.** `bulletSummary` used to return *nothing* when no
  projectile was fired, so "the ranged game never happened" and "projectiles were
  flawless" printed identically. It now reports a zero.
- **Coverage is a metric too.** Correctness says whether what happened was legal;
  coverage says whether enough happened to be worth trusting. `arenaSummary`
  exists because the AI learned to sword-fight and promptly stopped using 89% of
  the arena — every violation counter stayed clean.

## Traps that produce false results

- **A dead game server reads as PASS.** No snapshots means no reconciliation and
  no jitter. `scripts/diagnose.mjs` preflights `:9208` and marks a run
  `INVALID: no server snapshots received`. Never trust an online run without a
  `reconciliationSummary`.
- **`pgrep -f "tsx server/index.ts"` matches its own shell.** Check the port
  instead:
  `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9208/.wrtc/v2/connections`
- **`verdict: PASS` is necessary, not sufficient.** Read `xRange`/`yRange` and
  `movementSummary` too — a fighter wedged in a corner is perfectly jitter-free.
- **A zero in a counter is as damning as a one in a violation.** Both of the worst
  melee bugs — reactive blocking being impossible, and the backstab firing on
  overlapping bodies — presented as `parries: 0` / `blockedHits: 0` while every
  violation counter read perfectly clean.
- **Restart the server** after editing anything under `server/` or `simulation/`;
  tsx does not hot-reload.
- **A cold Vite dep-optimiser cache reloads the page under the harness.** After
  deleting `node_modules/.vite`, the first page load triggers a re-optimise and a
  full reload — the harness then watches the game reset beneath it and reports a
  match that never progresses. Warm it with one throwaway load before measuring.
- **Two game instances is a whole class of false result.** Startup is async and
  React StrictMode mounts twice, so both instances install `window.__gameState`
  and the winner need not be the survivor. The symptom is a fight frozen at
  100 HP with no opponent, in a game that visibly renders.

## Judging a run

Read the whole report, and **judge coverage across a few runs rather than one**.
Individual matches legitimately vary — one may be a pure brawl, the next a
ranged duel across the ledges — and that variety is the point. What must hold is
that across a handful of runs every mechanic fires at least once and every
violation counter stays at zero.

Healthy for the canonical 14s online AI-vs-AI run:

| Metric | Healthy |
|---|---|
| `arenaSummary.xSpanPct` | 50-95% |
| `arenaSummary.surfacesUsed` | 3-6 of 9 |
| `bulletSummary.tracked` | 4-20 |
| `meleeSummary` move counters | all non-zero across a few runs |
| every violation counter | **0, every run** |

## AI vs AI mode

Both fighters run an `EnemyBrain`; on a KO both reset after 2s (1.5s online).
Logs: `[FIGHT]` hits and KOs, `=== FIGHT RESET ===`, `[ONLINE] round reset`.
Online damage is applied server-side and is **not** logged as `[FIGHT]` — use the
HP trace from `__gameState()` to tell whether an online fight is really happening.
