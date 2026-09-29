# Control Points (5CP)

**Intent:** a match that is a war over ground, not a scoreboard of frags. Five
points stand in a line between two bases; a team wins a round by pushing the
line all the way to the enemy's last point, and the map remembers who holds
what — so kills are the means and the *line* is the score.

The reference is **Team Fortress 2's symmetric Control Point (5CP)** — the 6v6
staple — and the parts worth keeping are the ones that make it a tug of war:
ownership is *spatial* (a point you own is behind you and spawns you), capture
is *ordered* (you can never back-cap past the front line), and the map is
*symmetric* so neither side starts with an excuse.

## The rules, and where they come from

### Five points, one line

Five control points stand at even spacing across a five-screen arena, left to
right. AZURE starts owning points 1 and 2, EMBER owns points 4 and 5, and the
middle point is neutral.

- **Ownership is spatial.** A team spawns behind its front line, and the front
  line moves when points change hands (see *Forward spawns*).
- **A round is won by capturing the enemy's last point** — the fifth point on
  their end of the map. There is no kill limit and no wipe-out: a team can die
  sixteen times and still win the round with one push.

### Capture

A fighter captures by standing inside the point's pad. The rules are TF2's:

- **Capture speed grows with the crowd, as a harmonic number.** One fighter
  captures at 1×, two at 1 + 1/2 = 1.5×, three at 1.833×, four at 2.083×, and
  so on with no player cap. Two bodies are always better than one, and the
  fifth is always worth less than the first — that is the whole curve.
- **Points closer to a base fall faster.** The last points are 2s at 1×, the
  yard points 5s and the middle 8s, scaled down from TF2's 4/12–16/18–24s to
  this game's pace (a 4000px map crossed in ~20s, respawns at 4s).
- **Contested freezes.** If both sides stand on the pad, progress neither
  advances nor decays — the point is being argued over, and the argument is
  settled with weapons.
- **Leaving decays.** Progress toward a capture is lost gradually when the
  capturing team leaves, not instantly: 30s from full to zero, **six times
  faster in overtime** (TF2's rule, scaled from its 90s/15s). **A defender
  standing on their own point does not freeze the bar** — TF2 loses progress
  when the offensive team is removed, and one body able to hold a claim open
  forever would let a defender park an attack out of existence (and hold
  overtime open with it). Only a contested pad is frozen.
- **A neutral point is reverted at capture speed** — six times that in
  overtime. If one team built progress on the middle point and was driven off,
  the other team must unwind that progress at its own capture rate before its
  own capture begins. (Owned points decay at the slow rate above; only neutral
  points revert at cap speed — also TF2's rule.)

### Locks: you cannot back-cap

A point is **unlocked for a team when the point between it and that team's base
is owned by that team**; a point is capturable only while it is unlocked and not
already owned by the capturer. Everything else falls out of that one sentence:

- At the start, all four owned points are locked and the middle is open to
  both. Whoever takes the middle unlocks the next enemy point.
- Taking a point locks the point behind it — the enemy cannot retake the point
  you took unless they first retake the one in front of it.
- **At most two points are ever unlocked at once**: each side's next step
  toward the other. The line can only move one point at a time.

### Overtime

When the match clock runs out, the round does not end while a capture is in
progress. **The clock holds** — it does not keep counting while overtime runs —
and **overtime** begins:

- Decay and reversion run six times faster — a stalled push reverts in seconds.
- Completing *any* capture during overtime awards **60s** back on the clock,
  measured from the limit, and the round continues. The push that was in
  progress when time expired is allowed to finish what it started; anything
  less is not.
- If every capture in progress reverts to zero with nothing in progress,
  overtime ends, the round ends **and is awarded on points held** (a tie is a
  draw), and the match is decided on rounds won.

With no capture in progress at the whistle, the round ends immediately the same
way — the team holding more points wins it, and the match on rounds. A pad that
stays *contested* keeps overtime open for as long as the fight does; that is
TF2's own rule, and a standoff is a thing players do deliberately.

### Rounds and the match

- A round resets the whole line to its starting ownership, respawns everyone at
  their new base, and starts after the usual freezetime countdown.
- The match is **first to `scoreLimit` round wins** (default 3). The match
  clock is shared across rounds and is the match's whole budget (default 10
  minutes; `?timeLimit` overrides): a round won early leaves more clock for the
  ones after it, and capping fast is how you afford a long war.
- **Dead fighters respawn individually**, like deathmatch — a wipe is a push,
  not a round loss. The respawn delay is **shorter for the side that owns fewer
  points**: 4s at even ground, 0.7s off per point of deficit, never under 1.5s.
  This is TF2's respawn advantage, and it is the comeback mechanic: the losing
  side gets bodies back faster to break the hold that is beating it.

### Forward spawns

**A team spawns on the screen of its furthest-forward point** — the friendly
side of the front line, which on this one-point-per-screen map is exactly that
screen:

| Front line | AZURE spawns | EMBER spawns |
|---|---|---|
| Start (own points 1,2 / 4,5) | screen 2 (their yard) | screen 4 (their yard) |
| Middle taken | screen 3 (the middle) | screen 4 |
| Second point taken | screen 4 (the yard they took) | screen 5 (their last) |
| Pushed to the last | screen 1 (their last) | screen 2 (their yard) |

The attacker's reward for a capture is a shorter walk; the defender's is that
their last point is on their own doorstep. Every screen carries spawn points
for either team, so the mapping is pure arithmetic on ownership — no per-mode
spawn tables in the room.

**It was one screen behind the frontier at first, and the probe caught what
that costs.** With the enemy's last point two screens from the attacker's spawn
and the defender respawning on it, no push ever landed: 1600px of walking
against a two-second respawn, and round after round ended on the clock.
Spawning on the frontier turns the last push into a fight at the point instead
of a run at it.

## The map

**One line, five screens, mirror-symmetric.** `buildControlWorld()` in
`simulation/ControlMap.ts` builds 4000×600 from five 800px modules:

| Screen | Module | Holds |
|---|---|---|
| 1 | base | AZURE spawn room, **point A** (their last) |
| 2 | yard | **point B**, cover pillars and a high ledge |
| 3 | mid | **point C**, the neutral fight, symmetric cover |
| 4 | yard, mirrored | **point D** |
| 5 | base, mirrored | **point E**, EMBER spawn room |

The odd modules are the even ones mirrored, the same trick the classic arena
uses to keep a tiled corridor from reading as wallpaper — and it is what makes
the map *fair by construction* rather than by hand-checking two halves.

- Every capture pad is **drawn from the collider data** (`ControlPad`,
  `CONTROL_PADS`),
  sat on the ground, 180px wide and 64px tall: a jump clears it, a fighter
  standing on the floor inside it captures.
- Each module carries **8+ spawn points across its platforms**, so a full side
  can always spawn spread on its front-line screen, and `pickFrom`'s
  furthest-from-the-fight rule still applies inside that screen.
- Platform layout per module follows the arena's reachability rule: every
  surface within one jump of the one below it (the `Physics.test.ts` ladder),
  no narrow pockets, spawns resting exactly on platform tops.

## On the wire

Control state is **server-owned**, exactly like rounds and scores: it rides in
the snapshot inside `TeamStatus.control`, never simulated by the client. A
client that predicted ownership would show a point flipping on its own screen
before the server agreed.

```ts
interface ControlStatus {
  points: {
    owner: TeamId | null;        // null = neutral
    attacker: TeamId | null;     // whose capture is in progress
    progress: number;            // 0..1 toward the attacker
    contested: boolean;
    unlocked: [boolean, boolean]; // per team, the adjacency rule
  }[];
  overtime: boolean;
  captures: number;              // captures this match, for the probe
}
```

- **Progress travels as a number, not a timestamp**: the HUD draws what the
  server says and nothing else, which is the same rule ammo and the ultimate
  meter follow.
- **The client rebuilds the map from the mode**, the way it rebuilds the
  arena from `screens`: `?mode=5cp` + a seated room builds the control map, so
  a latecomer sees the same five pads.

## Presentation

- **A control bar sits under the clock**, five pips in ownership colour, the
  pad under attack filling with the attacker's colour, locked pips hatched,
  `OVERTIME` in gold when the clock is held. The pips are the local player's
  map of the war.
- **Every pad is drawn in the world**: team-coloured, lettered (A–E), with a
  progress ring while it is being taken. The world marker is the thing a
  fighter actually plays around; the HUD bar is the thing that tells them where
  the front line is.
- **Sounds fire on server events**, exactly like hits and rounds: a tick when
  a pad's progress crosses a quarter, a chime for a capture, a descending tone
  when your point is taken, an alarm on overtime.
- **Bots play the objective.** A new `ControlBrain` module reads the control
  state from perception (a module, never a mode branch in the fight brain):
  defend a point under attack, otherwise push the next unlocked point —
  and cede to the combat modules the moment a foe is in weapon range.

## Tuning

All of it lives in `tweakables/control.ts` (the simulation re-exports; no
constants in the logic): the five per-point capture times, the decay time and
its overtime multiplier, the overtime time bonus, the respawn base and
advantage, the round score limit and match time, and the map's screen count.

## Creator-only practice flags

- `?capTime=S` sets the middle point's capture time in seconds (1–30; a
  non-positive or malformed value means the default 8, and the other four
  points scale by their ratios). A practice-room flag like `?ultCharge`, and
  the probe's lever for playing a whole round in seconds.

## Measuring it

```bash
tsx scripts/cp-probe.ts                     # AI vs AI, a full cap ladder
tsx scripts/cp-probe.ts --capTime=1         # a round in a couple of minutes
tsx scripts/cp-probe.ts --ultCharge=100     # and the black hole comes too
```

The probe runs **two rooms**. The first plays the line out: it asserts the mode
and the map (five screens, one pad each), the opening ownership and locks
exactly as the table above, that progress appears and points flip, and reports
whether any pad was contested. It checks the local fighter's **opening spawn** — the one spawn that
always happens — against the exact table entry the spawn picker chooses while
the countdown still holds it there. Every respawn it additionally observes is
checked against the front line on either side of the jump (the line can move
between the respawn tick and the sample, at these capture times); a run where
this particular bot never dies proves the arithmetic at round start and says so
in its notes rather than pretending. It fails if no last-point capture was ever
announced, so the whole ladder is proven even on a run whose match ended on the
clock, and reconstructs friendly fire from the scoreboard.

The second room is arranged for **overtime**, because overtime cannot be
requested, only caught: fifteen seconds of clock with no freezetime, so the
whistle lands mid-cap. Its deterministic assertion is the **held clock** — the
clock must not creep past the limit while overtime runs, because a clock that
keeps counting makes the 60s bonus a subtraction from an overshot number, and a
completed capture can then leave time still expired and award the round twice.
Whether the capture completes at all is a fight: a wipe reverts the bar
(correctly) and time decides the round instead, so up to three rooms are played
and a run that never catches the payback says so in its notes; the bonus
arithmetic is pinned by a unit test (`overtimeBonusElapsed`).

A clean run is not a good run: a room where nobody pushed satisfies every
correctness check above, so the probe fails on zero captures, zero flips and
zero round wins, not only on illegal states.

## Rules that bite

- **Ownership is snapshot state, never roster state**, for the same reason team
  is: a lost roster heartbeat must not move the front line.
- **Locks are one predicate** (`unlockedFor`): the neighbour between the point
  and the team's base. A second lock rule written anywhere else is a second
  answer to "can they cap that", and the first disagreement is a back-cap.
- **The capture tick reads the simulation and writes only control state.** It
  never touches a fighter: standing on a pad is read from bodies the same way
  the smoke hides them, and nothing about the pad pushes anybody.
- **A pad's geometry and its capture zone are the same rectangle.** The zone is
  built from the pad, so a fighter standing on the drawn pad is capturing and
  the art cannot lie.
- **The loser's respawn advantage is arithmetic on points owned**, not a state
  flag: it is asked at death, so it cannot drift out of step with the line.
- **Progress does not survive a round reset.** A new round is a new line, and
  half a capture from the last one is not a head start.

## Not implemented

- **Sudden death after an endless overtime.** A contested pad keeps overtime
  alive for as long as the fight does — TF2's own rule, and a deliberate
  standoff is a decision the players make. The clock running out with nothing
  in progress ends the round on points.
- Back-capture prevention beyond the adjacency rule (there is nothing behind
  the line worth capping).
- Engineer buildings, teleporters and spawn-room doors.
- **Captures as Play-of-the-Game moments.** A capture is a server moment and
  the ceremony's vocabulary is kill-shaped; a point that flipped a round is
  currently a footnote under the frag that made it possible.
