# The Physics Diagnostic

The measurement half of the feedback loop. **Load the `feedback-loop` skill for
the full workflow** — this file is the reference for the tool itself.

> **If there is no instrumentation to measure it, build the instrumentation.**
> That is the first step of the loop, not a preliminary to it.

## Console commands (F12)

- `window.__physicsDiagnostic(durationMs = 5000)` — collect frames, print a JSON report
- `window.__gameState()` — HP, AI states, and full `playerPhys` / `enemyPhys`
- `window.__aimState()` — cursor in world space, aim angle, facing, move phase,
  and the local fighter's live bullets with their headings
- `window.__toggleAIVsAI()` — or press **P** in-game
- `window.__training` — the training room's controller, present only under
  `?training=true`. See *The training probe* below and
  [specs/training-room.md](../specs/training-room.md).

## Harness (preferred)

```bash
npm run dev:herdr                               # both servers in visible panes
node scripts/diagnose.mjs                       # offline + online, 8s each
node scripts/diagnose.mjs --mode=online --runs=3  # the canonical duel
node scripts/deathmatch-probe.mjs               # sixteen AI fighters, played to a winner
node scripts/probe-online.mjs                   # dump one online client's console
node scripts/verify-modes.mjs                   # smoke-check every launch mode
node scripts/aim-probe.mjs                      # cursor, facing and shot direction, at dpr 1 and 2
node scripts/training-probe.mjs                 # one interaction at a time, against a scripted dummy
node scripts/controls-probe.mjs                 # key bindings, the Esc menu and a rebind
node scripts/pad-probe.mjs                      # controller aim, a gamepad, and the phone deck
```

## The deathmatch probe

`diagnose.mjs` runs a duel. `deathmatch-probe.mjs` runs **a room full of AI, to a
winner** — and it exists because a duel cannot ask the questions that only have
answers at scale:

| Question | Tool |
|---|---|
| Is prediction, reconciliation, projectile flight clean? | `diagnose.mjs --mode=online` |
| Does a sixteen-fighter room stay consistent, score honestly, and end? | `deathmatch-probe.mjs` |

It shortens the rules so a win condition is observable in seconds rather than five
minutes — `--scoreLimit`, `--timeLimit` — and everything else is the real path:
real server, real snapshots, real prediction, real bots. Shortened rules apply only
to the client that *creates* the room, so nobody can end a match already in
progress.

```bash
node scripts/deathmatch-probe.mjs                                   # to the frag limit
node scripts/deathmatch-probe.mjs --scoreLimit=999 --timeLimit=20   # to the clock
node scripts/deathmatch-probe.mjs --fighters=8                      # a smaller room
```

It fails on: a room that did not fill, a match that never ended, a winner who is
not ranked first, places that are not a total order 1..n, a duplicated or missing
name, frags exceeding deaths, no snapshots, no rollbacks — **and nobody scoring**.
That last one is the important one: every other check passes in a room where
sixteen fighters stood still.

## Rollback and bandwidth: `netSummary`

Online reports carry a `netSummary`, because rollback trades a fixed visual delay
for occasional misprediction and a trade has to be measured or it is a preference.

| Field | Meaning |
|---|---|
| `snapshots` | **0 means the client simulated alone** — every other number is about nothing |
| `avgSnapshotBytes` / `estBytesPerSec` | what forced the packed wire format; ~800B/16KBps for a duel, ~3.4KB/66KBps at sixteen |
| `rollback.avgErrorPx` | how wrong remote prediction usually is. 2-8px observed |
| `rollback.maxErrorPx` | worst single correction. 57-99px observed; past 100px is a discontinuity, not an error |
| `rollback.visibleCorrections` | corrections over 1px. ~12% of rollbacks in a duel, ~20% at sixteen |
| `rollback.avgResimTicks` / `maxLeadTicks` | prediction depth, in 60Hz ticks. Capped at 9 |
| `rollback.frozenRemoteTicks` | ticks the server had starved a fighter, and so did we |
| `rollback.teleports` | announced discontinuities — respawns and spawns. Not errors |
| `rollback.primarySwitches` | **check this first** when `enemy_x`/`enemy_y` look wrong |

`primarySwitches` counts how often the fighter those metrics *describe* changed. A
change of subject reads exactly like a fighter teleporting, and it is what turned
out to be behind every remote jitter event in this mode. `jitterSummary` measures
the *drawn* position and should be **0**; the raw corrections live here, so nothing
is hidden by smoothing them.

## The aim probe

`diagnose.mjs` is blind to aim: AI vs AI is the canonical run and the brains hand
the simulation an angle directly, so no cursor is ever involved. `aim-probe.mjs`
drives a real mouse instead and reports:

| Field | Meaning |
|---|---|
| `worstPointerErrPx` | cursor→world error. **0 is achievable**; anything else is a conversion bug |
| `worstAimErrDeg` | angle the fighter aimed vs the angle the cursor asked for |
| `facing` | how many cursor positions the fighter turned to correctly |
| `attackTurn.worstMs` | longest the fighter ignored a cursor that crossed sides **while swinging** |
| `shots[].errDeg` | angle a bullet actually left with vs the angle aimed |

**Run it at `--dpr=2`.** The bug it was built for — dividing by the canvas
backing store rather than the logical view — is exactly invisible at device pixel
ratio 1, which is the only ratio a default headless browser has.

## The controls probe

`diagnose.mjs` is blind to bindings for the same reason it is blind to aim: the
brains hand the simulation an *intent*, so no key is ever pressed. Every button
in the game could be bound to nothing and the canonical run would still report
PASS. `controls-probe.mjs` presses real keys at a real browser and reads the
simulation state back:

| Check | Why it is there |
|---|---|
| Shift blocks, right-click does not | the default moved, and a binding that quietly still works is the same bug as one that quietly does not |
| Space and W both clear a jump | one action, two slots — the alternate slot is only real if it reaches `tickPlayer` |
| the Esc menu stops a held key moving the fighter | a dialog that asks for keypresses must not also play the game with them |
| a rebind reaches the simulation, survives a reload, and resets | the whole feature, end to end, through the DOM a player actually clicks |

Every check reports what it measured, not just a verdict — `blocking=false` on a
line that expected a guard says which half of the chain broke.

## The controller probe

`pad-probe.mjs` covers the third blind spot. `aim-probe.mjs` measures the
*cursor*, which controller mode does not use at all, and Playwright cannot press
a physical gamepad button — so the probe **stubs `navigator.getGamepads`** before
the page loads. That is legitimate rather than a shortcut: the Gamepad API is
polled, so a stub returning the same snapshot shape on the same schedule is
genuinely equivalent from the game's point of view.

| Check | Why it is there |
|---|---|
| the d-pad aims in eight directions | the Contra layer, and its horizontal half is the same input that moves you |
| a left stick pushed at 30° aims at 30° | the Contra aim is *analog*: a quantised stick would land on the diagonal at 45° and never say the angle in between |
| aiming straight up leaves `face: 0` | `cos(-90°)` is a positive crumb, and a fighter that snapped to facing right there gives away free hits |
| the right stick aims at any angle while running the other way | the whole reason there are two layers |
| letting go falls back to the Contra aim | a stick that stayed where it was left is a fighter aiming at a wall |
| a mouse stroke **runs up the arc past 45°** | a clamping virtual stick stalls near -63° and never reaches the ceiling; this is the one number that distinguishes the two implementations |
| a mouse left alone holds, then resets on its own | the mouse has no spring, so a hold window stands in for one |
| trigger blocks, face button jumps, shoulder swaps stance | pad buttons reach the simulation through the *ordinary* bindings, not a second path |
| switching back to Mouse gives the cursor its say | a scheme that cannot be left is a trap |

It then opens a second, phone-shaped context — `hasTouch` is what makes Chromium
answer `pointer: coarse` the way a phone does, and it cannot be changed on a live
page — and checks that the deck is drawn, that the game and the deck **both fit
with no horizontal scroll and the canvas keeps its 4:3**, that the screen reaches
both edges of the phone, that a thumb on the cross walks the fighter **and aims
at whatever angle the thumb is held — 30°, not the nearest sector**, that the
thumb pad aims and recentres, and that the deck's own menu button can send the
deck away. The controls are ordinary DOM, so it taps them: an emitted event
proves the wiring, a tap proves the game.

Two checks exist for the deck's buttons being *ordinary DOM*: the aim pad must
**aim without slashing** while the stance is sword, and it must **fire the gun**
in gun mode — a phone's right thumb lives on the pad, so the pad is its trigger.
It switches stance by tapping the Gun pill, and counts bullets to prove a shot.

**It drives that context with CDP `Input.dispatchTouchEvent`, never
`page.mouse`.** Playwright's mouse reports `pointerType: "mouse"` even inside a
touch context, and that field is exactly what the relative-mouse aim layer is
filtered on — so a probe driven by it is structurally blind to every bug in the
filter, and was: two of them passed a green probe until this section was
rewritten. Two checks exist only because of that:

| Check | Why it is there |
|---|---|
| a deck button does not also swing the sword | `Input`'s `pointerdown` is on `window` and `Mouse0` is attack, so every button on the deck slashed as well as doing its own job |
| a thumb sliding across the cross does not steer the aim | `movementX` is populated for touch pointers, so a thumb drag drove the virtual stick — holding *left* while dragging *right* aimed right |

The second one slides **rightward along the left arm** on purpose. A drag *toward*
an arm pushes a broken virtual stick the same way that arm points, so the correct
and the broken build agree; only a press and a travel that disagree can separate
them.

## The training probe

`diagnose.mjs` measures a whole chaotic match; `training-probe.mjs` measures
**one interaction**. Neither replaces the other, and the choice is not about
which is stricter:

| Question | Tool |
|---|---|
| Is the game healthy end to end? | `diagnose.mjs --mode=online --runs=3` |
| Does a block actually stop a slash from the left? | `training-probe.mjs` |
| Did the fix change the thing I aimed at? | usually both |

A brain never does the same thing twice, so the canonical run can only tell you
that *something* happened legally. The training room hands the simulation a
dummy that does exactly one thing on command, which is what makes a single
mechanic falsifiable.

It prints `__TRAINING_RESULT__{...}__END__` on one console line and exits
non-zero on failure. Useful flags: `--only=backstab` to run one row,
`--keep-open` to leave the browser up.

Every row's expectation comes from [specs/melee.md](../specs/melee.md) — a slash
deals 7, an uppercut beats a guard for 11 and launches, a Massive beats it for
24, a guard facing away is backstabbed and one at less than a body width is not.
Three rows are about the tool rather than the game:

- **Determinism.** The same script twice must produce the same event sequence.
  If it does not, nothing measured with the training room means anything, and
  that is a bug in the feature rather than flakiness to retry around.
- **No desync.** `meleeDesyncFrames` must be 0 and `reconciliation.avgErrorPx`
  must stay in the band a normal match shows (≈0–3px, asserted at ≤5).
- **Activity.** The summary carries `playerMoves`, `dummyMoves` and `impacts`
  across the whole battery, and a battery with zero impacts fails outright —
  every must-be-zero row is satisfied by a build where nothing happens.

`__training.report()` is a **filtered view of `PhysicsDiagnostics`**, not a
second measurement stack: the melee counters and violations are the same ones
the canonical run prints. Damage and bullet counters come from the server, which
is the only thing that sees a projectile connect or a hit land through
invincibility.

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
| `meleeSummary.meleeReplacements` | sword states the server replaced, with the reconciler's verdict on each: `stun`, `iframe`, `massive-armed` and `respawn` are facts only the server holds; **`unexplained` is the one that is a bug** |
| `meleeSummary.violations[].replacedThisFrame` | what the server did on the frame a violation fired. `null` means the state machine really did break its own table |
| `meleeSummary` counters | `slashes`, `massives`, `uppercuts`, `blocks`, `parries`, `backstabs`, `butterflyChains` — **must be > 0**, or the run proves nothing |
| `meleeSummary.blockedHits` vs `parries` | a guard that beat the 140ms parry window is `blocked`; earlier is `parried`. **Reactive guarding produces `blockedHits: 0` legitimately** — `blocked` is the turtle's signature |
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

- **A canvas taller than the browser window silently fakes an aim bug.**
  Playwright clamps a mouse move to the viewport, so every sample below the fold
  returns the *previous* cursor position — which reads exactly like a broken
  conversion. `aim-probe.mjs` now throws if the canvas does not fit.
- **A shot fired into a fighter standing on top of you is never observed.** The
  server destroys it in the same tick, so it never reaches a 20Hz snapshot and
  the probe can only report "no shot fired". Shoot upward, early, before the bot
  closes.
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

Healthy for a sixteen-fighter deathmatch run:

| Metric | Healthy |
|---|---|
| `verdict` | `PASS` |
| `match.frags` == `match.deaths` | or deaths slightly higher (unattributed) |
| `jitterSummary.total` | **0** |
| `collisionSummary.penetrationFrames` | **0** |
| `net.rollback.avgErrorPx` | 2-8px |
| `net.rollback.primarySwitches` | 2 in a duel; low and explainable at sixteen |
| `net.estBytesPerSec` | ~66,000 at sixteen fighters |
| `meleeSummary` hits/backstabs/parries | all non-zero — sixteen fighters should produce a lot of each |

Healthy for the training battery:

| Metric | Healthy |
|---|---|
| `verdict` | `PASS`, all 13 rows |
| `activity.impacts` | > 0 — a battery that judged no impact proves nothing |
| `activity.playerMoves` / `dummyMoves` | both > 0 |

## AI vs AI mode

Both fighters run an `EnemyBrain`; on a KO both reset after 2s (1.5s online).
Logs: `[FIGHT]` hits and KOs, `=== FIGHT RESET ===`, `[ONLINE] round reset`.
Online damage is applied server-side and is **not** logged as `[FIGHT]` — use the
HP trace from `__gameState()` to tell whether an online fight is really happening.
