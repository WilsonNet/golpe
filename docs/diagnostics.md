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
node scripts/diagnose.mjs --mode=online --ultCharge=100  # bots cast their ultimates
node scripts/deathmatch-probe.mjs               # sixteen AI fighters, played to a winner
node scripts/tdm-probe.mjs                      # two sides, wipe-out rounds, no friendly fire
node scripts/tdm-probe.mjs --ultCharge=100      # ... and the teams throw black holes
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
| Do sides hold: even split, no friendly fire, rounds that end by wipe-out? | `tdm-probe.mjs` |

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

## The team deathmatch probe

`tdm-probe.mjs` is the same shape against `?mode=tdm`, and it asks the questions
that only exist once fighters have sides.

```bash
node scripts/tdm-probe.mjs                                # 8 bots, two sides, to a winner
node scripts/tdm-probe.mjs --fighters=16 --scoreLimit=2   # a full room
```

**It watches the match rather than reading the end of it.** A wipe-out is a
one-tick event in a fight that lasts half a minute, so the final scoreboard
cannot prove one ever happened: the probe polls `__matchState().teams` and counts
the rounds in which a side hit zero standing, and the arena resets that followed.

**Friendly fire is caught from the scoreboard, not trusted from the code.** With
no friendly fire a side's deaths can only have been scored by the *other* side, so
a side that died more often than its opponents have frags killed itself — that is
a failure. The reverse is only a note: an unattributed death (a fall, a hole
opened by somebody who has since left) is legitimate.

**And that freezetime held them still.** The probe compares the local fighter's x
between two consecutive samples of the *same* countdown and fails if it moved at
all — between, not from a baseline, because the reset that starts a freeze
teleports everybody to their spawn and a baseline measured that as a 1008px
"drift" — a countdown that ran
while fighters walked around would say the round had not started while the round
was being decided. `--freeze=N` overrides the countdown; the default is the real 4s, because unlike
a five-minute match that is affordable to sit through.

**The diagnostic is delayed into the fight.** Seated, the local bot is frozen
for freezetime and then walks the length of its side's arena before contact; a
diagnostic started at seating measured the approach and reported zero melee
moves from a bot that fought perfectly well. The probe waits for round two and
samples from there.

**And it reads the team brain's own report.** `teamSummary` carries the local
bot's role and stance usage, and the probe fails on a side that is not
complementary: a support that played more sword frames than gun frames, or a
vanguard that did the reverse. `--ultCharge=100` also asserts the armed local
bot actually casts — `ultimateSummary.localCasts` must be ≥ 1.

It also fails on: a room the server did not make `tdm`, an arena narrower than
three screens **that nobody asked to be wide**, a fighter with no side, teams more
than one apart, a match that ended without a winning side, and — as ever — no
wipe, no reset and no frag, because a room of sixteen fighters standing still
passes every correctness check there is.
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
It also checks the two ways the deck follows the stance: the left stick is
**drawn as an analog pad, not a d-pad** (the nub is there, the arms are not), and
**block and uppercut are hidden in gun mode**, because they are sword moves that
would otherwise sit there doing nothing.

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

## The ultimate probe

`node scripts/ultimate-probe.mjs`. It presses the button deliberately — a real
human keypress, not a brain — because the probe's questions are about the
netcode and the capture, and the answers must not depend on a bot's timing.
(The brains *do* cast now — `diagnose.mjs --ultCharge=100` and
`tdm-probe.mjs --ultCharge=100` measure that — but they are not the probe's
subject.) Without this probe the black hole was invisible to the harness:
`diagnose.mjs` and `deathmatch-probe.mjs` would run whole matches in which the
ability does not exist, and would report a room that froze on one client and
not the other as excellent jitter numbers.

Two scenarios, because one room cannot answer both questions:

| Question | Room |
|---|---|
| Did a cast freeze *both* clients, for the length the server declared, and unfreeze both? | two-client deathmatch |
| Did one hole open at one position on both, credited to the caster? | two-client deathmatch |
| Does the client whose own fighter is dragged still reconcile to ~0px? | two-client deathmatch |
| Was somebody actually caught, held and damaged? | training room |
| Did the caster take anything from their own hole? | training room |

The split is not tidiness. The capture was originally measured in the deathmatch
room and every run lost to the *arena* rather than the ability: a bot closes to
melee range and detonates the grenade on contact inside a single frame, a
stationary opponent is 660px away and a grenade is a lob so the throw hits the
underside of a ledge, and walking there means solving two pillars — where a jump
held *into* a pillar is a wall jump that goes backwards. All of that is the game
working correctly. The training room stages a dummy 60px away on clear ground,
which is exactly what it is for.

**`--no-cast` is the control**, and it is load-bearing. The probe's first
prediction metric read 4.5px of average *rollback* error after a cast and failed
a 3px budget, which looked precisely like the pull leaking outside `tickPlayer`.
The control showed 4.0px with no ultimate cast at all: rollback error is about a
*remote* fighter predicted from a carried-forward input, and a bot changing its
mind sixty times a second produces that number regardless. The metric could not
have discriminated. It was replaced by running `__physicsDiagnostic` on the
client whose **own locally predicted fighter** is the one being dragged — an
unpredicted pull would show there as double-digit correction on every one of the
~44 snapshots the hold lasts, and it reads 0.00px.

`?ultCharge=N` is the flag that makes any of this measurable: a creator-only
*floor* on everybody's meter, so the ultimate re-arms as soon as it is spent
instead of taking ~285s to fill. It is honoured in the training room too, which is
where a human practising the throw wants it.

## The play-of-the-game probe

`node scripts/potg-probe.mjs`. It is the only thing in the suite that reads
**past the final whistle**.

That is the whole argument for it existing. Every other probe polls
`__matchState()` until `phase === "over"` and then stops — which is the exact
frame the ceremony begins. A server that scored nobody, a clip that never
downloaded, a pre-roll that quietly degraded into a static wide shot, a replay
drawing an empty arena, a podium sitting on top of the replay: all of it leaves
`diagnose`, `deathmatch`, `tdm` and `ultimate` green.

It plays a short AI-vs-AI match to a winner, then watches `__potgState()` at
60ms and the DOM alongside it:

| Question | What it reads |
|---|---|
| Was a play announced, with a headline and a protagonist? | `announced` |
| Did the server keep footage, and is it fetchable? | `GET /potg/<roomId>`, from node |
| Is the clip real — frames, cast, beats, a lead-in? | the fetched JSON |
| Did the victory card appear *after* the breathing, and leave before the reel? | the DOM, timed from `phase === "over"` |
| Did the card *cover* the arena, then open? | `curtain` — peak and return |
| Did all seven movements run, in order? | `phase`, sampled |
| Was the establish wide, did the orbit swing, did the push push, did the whip *swing*? | `track` |
| Did the footage slow at a beat, and reach full speed otherwise? | `track[].minRate` / `maxRate` |
| Did the shake fire once per beat rather than once per frame? | `track[].shakes` vs the clip's beat count |
| Did the replay draw anybody? | `drawn` |
| Did the HUD and the podium stay down, and the overlay come up? | the DOM, while `active` |
| Did the podium then arrive? | `.vd-veil` |

Three details are load-bearing.

**`curtain` is the only thing that can tell a title card from a caption.** A
title faded in over a playing replay — which is what the first version did —
satisfies every other assertion in the list. The probe requires it to reach 1
(nothing else on screen) and then come back to 0 (the footage is actually
visible).

**`track` summarises each movement as a range, not a final sample.** A whip pan
*ends* back on its subject, so its last position says nothing about whether it
swung; `travel` is the furthest the camera got from where the movement started,
and it is the only number that can tell a pan from a static shot. It is recorded
*after* the clamp, too — the clamp is entirely capable of turning a 400px pan
into no pan at all at the edge of a one-screen arena, and a metric taken before
it would have reported a movement the player never saw.

**"Wide" is asserted relative to the push, not against 1.0.** The replay camera
is floored at the zoom that still fills the arena, and this game's world is
exactly one viewport tall — so an absolute test for a sub-1.0 establishing shot
would fail on every arena that exists.

`--ultCharge=100` is worth running: the grenade, the singularity and the
caster's immunity are all recorded per frame and replayed from the clip rather
than from the live match, and without an armed room that path is never taken.
`--mode=tdm` covers the wipe-kill highlight and the team-tinted card.

## A known flake: "combo links thrown airborne"

`diagnose.mjs --mode=online` fails roughly one run in ten with
`FAIL: 1 combo links thrown airborne`, and **it is not caused by whatever you
just changed**. Measured over 29 runs across two builds: 1 failure in 14 on
`main`, 3 in 15 with a large feature on top — the same message both times, and
statistically indistinguishable.

The metric samples the server's authoritative state at frame rate and flags any
sample where a fighter is mid-chain (`comboStep > 1`) and not grounded. A fighter
that starts a link legally and leaves the floor during it — knocked back, or
walking off a ledge — trips it.

**Take the tally, not the run.** If a change is suspected of causing a
regression here, the honest test is five or six runs before *and* after, on the
same machine, and comparing rates. A single red run proves nothing either way.
Chasing one cost most of an afternoon — though it did turn up a real regression
on the way: raising `MAX_QUEUED_INPUTS` from 10 to 24 makes the server execute
input up to 400ms stale, which is exactly this symptom, deliberately induced.

## Reading the report

Emitted as `__DIAGNOSTIC_RESULT__{...}__END__` on one console line.

| Field | Meaning |
|---|---|
| `verdict` | `PASS` only when nothing violated a rule — **necessary, not sufficient** |
| `collisionSummary.penetrationFrames` | frames a body was inside solid geometry — **must be 0** |
| `movementSummary` | `jumps`, `doubleJumps`, `wallJumps`, `pctAirborne`, `peakRisePx` — is the fighter using the arena? `doubleJumps` was structurally 0 and `peakRisePx` sat at exactly one jump's height until the bots learned the air jump |
| `playerMovement.xRange/yRange` | a tiny range means the AI is stuck, even when the verdict says PASS |
| `reconciliationSummary.avgErrorPx` | client/server disagreement; **0.00 is achievable and expected** |
| `reconciliationSummary.visibleCorrections` | corrections > 1px; only respawns should appear |
| `ultimateSummary.localCasts` | casts by the local fighter. **0 with `--ultCharge=100` means the bots ignore a weapon**, not that the feature is fine |
| `teamSummary` | the local brain's role, stance-usage frames and ally distance, in a team room with a local bot. `null` outside one |
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
| `bulletSummary.teleportFrames` / `frozenFrames` | projectile jumps and stalls — **must be 0** (a bullet parked by an ultimate's cinematic freeze is not a stall; the projectile clock is held still for the whole cutscene and the metric knows it) |
| `bulletSummary.maxPathDeviationPx` | bend in a straight path; >0 means a sprite was reassigned |
| `bulletSummary.maxStepRatio` / `avgStepCv` | step vs expected (1.0 ideal) and evenness (0 ideal) |

## Designing a metric that works

Jitter thresholds are **derived from the physics constants and the frame's own
dt** (`speed × dt × 1.6–2.0`, floored at 35/25/15px), never hardcoded. The old fixed
25px `player_y` was calibrated against `GRAVITY = 300`; once `MAX_FALL_SPEED`
became 950 a single 30fps frame legitimately moved 31.7px and the metric started
reporting correct physics as a defect. Announced teleports suppress checking for
4 frames. X got the same 2.0 headroom Y has after the bots learned to dash in
zones: a remote fighter's burst is mispredicted for a tick or two, the rollback
correction lands on top of the frame's own motion, and the measured
dash+correction came in at ~2.0× a tick of dash on a 30fps frame. A genuine
failure — a teleport, a floor fall — still moves a body hundreds of pixels in a
tick, so the extra headroom costs nothing real.

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
- **A *stale* server also reads as healthy.** A tsx process killed out from under
  its pane can leave the old server holding `:9208` — the port check passes, and
  every room then has the *old* rules. Symptom: a `--screens=2` run reports
  `worldScreens: 1` while the code says 2. Fix: `pgrep -af "tsx server"`, kill
  the survivor, then `npm run dev:herdr:down && npm run dev:herdr` — and read the
  room-creation line, which now names the screen count
  (`[MATCH] Created room … (fill N, M screens)`).
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

**A lone marginal event is the bot-variance band, not a signal.** Random bot
personalities occasionally throw one event just over a threshold — an airborne
combo link, or a `player_y`/`enemy_x` correction at severity ~1.1–1.3 (a
12-second window of a random sixteen-fighter brawl is the best place to catch
one). Baseline runs on `main` produce them too, so chase the failure class, not
the run: the same type in every run, or severity climbing past ~1.5, is a
regression; one marginal event in a handful of runs is not.

Healthy for the canonical 14s online AI-vs-AI run:

| Metric | Healthy |
|---|---|
| `arenaSummary.xSpanPct` | 50-95% |
| `arenaSummary.surfacesUsed` | 3-6 of 9 |
| `bulletSummary.tracked` | 4-20 |
| `meleeSummary` move counters | all non-zero across a few runs |
| every violation counter | **0, every run** |

Healthy for a wide-arena run (`diagnose.mjs --screens=2` — the follow camera
moves the whole time, so this proves scroll never reads as jitter):

| Metric | Healthy |
|---|---|
| `verdict` | `PASS` |
| `jitterSummary.total` | **0** — the camera cap (12px/frame) sits under the 15px threshold on purpose |
| `arenaSummary.xSpanPct` | 50-95% of the *wider* world — the bots must cross screen 0 |
| `arenaSummary.surfacesAvailable` | `1 + 8 × screens` |

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
| `verdict` | `PASS`, all 16 rows — the two deny rows included: a block catches the grenade, and a kill mid-hold throws the meter away |
| `activity.impacts` | > 0 — a battery that judged no impact proves nothing |
| `activity.playerMoves` / `dummyMoves` | both > 0 |

## AI vs AI mode

Both fighters run an `EnemyBrain`; on a KO both reset after 2s (1.5s online).
Logs: `[FIGHT]` hits and KOs, `=== FIGHT RESET ===`, `[ONLINE] round reset`.
Online damage is applied server-side and is **not** logged as `[FIGHT]` — use the
HP trace from `__gameState()` to tell whether an online fight is really happening.
