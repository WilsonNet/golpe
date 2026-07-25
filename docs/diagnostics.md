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
  only visible at 20Hz, so judging its frame data against a 60Hz tolerance
  reported the network as a state-machine bug.
- **Exclude what the client provably cannot predict.** Melee stun, launch and
  knockback are announced by the server, so they are marked as teleports and
  excluded from the desync counter — otherwise the metric fails hardest exactly
  when combat is working.
- **Count what should happen, not only what must not.** Every must-be-zero metric
  is trivially satisfied by a build where the mechanic never runs.

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

## AI vs AI mode

Both fighters run an `EnemyBrain`; on a KO both reset after 2s (1.5s online).
Logs: `[FIGHT]` hits and KOs, `=== FIGHT RESET ===`, `[ONLINE] round reset`.
Online damage is applied server-side and is **not** logged as `[FIGHT]` — use the
HP trace from `__gameState()` to tell whether an online fight is really happening.
