# Sword Combat

**Intent:** the sword game is a rip of *GunZ: The Duel*'s K-Style, rebuilt for
two dimensions. The whole design rests on one idea:

> **Light attacks can be cancelled. Heavy attacks cannot.**

Everything else follows. Cancelling a slash into a block is what produces the
*butterfly* — the rapid, mobile, half-defensive pressure that GunZ players
invented and that made the game famous. Refusing to cancel the heavy moves is
what stops the butterfly being the only answer: a Massive Strike or an uppercut
commits you to a long recovery, and a fighter who reads it gets a free punish.

The loop the mechanics are meant to produce:

```
  butterfly pressure  ──blocked──▶  opponent parries  ──▶  you are guard-broken
         │                                                        │
    opponent blocks                                          free Massive
         │                                                        │
      uppercut (unblockable, launches)  ◀────── punished if whiffed
```

Every mechanic below exists to close one arrow of that diagram. A mechanic that
does not beat something and lose to something else does not belong here.

## Authority

**The server is the only judge of a melee hit**, exactly as it is for bullets.

- The client **predicts its own state machine** — startup, active, recovery,
  charge, block — so a swing draws on the same frame the button is pressed.
- The client **never decides that it hit anyone.** Damage, stun, launch,
  knockback and guard breaks are applied server-side and arrive in the
  authoritative `PlayerPosition`.
- Because stun and launch live in the replayed state, reconciliation converges on
  them like any other physics: the client rewinds to the stunned state and
  replays, and its inputs during stun are ignored by the simulation on both
  sides. See [netcode.md](netcode.md).

Impact **visuals** — sparks, shockwaves, screen shake, sprite punch — are
render-only and never touch the simulation. A true frame-freeze hitstop would
desync client and server, so the punch is faked with scale and shake instead.

## Stances

A fighter holds either a **sword** or a **gun**, never both.

- **Q** — sword stance. **E** — gun stance. **Sword is the default at spawn**;
  this is a sword game first.
- Switching is instant and **cancels a cancellable move**, which is GunZ's
  slash-shot cancel. It cannot rescue you from a heavy move's recovery.
- Blocking requires the sword. Firing requires the gun.

## Inputs

| Input | Sword stance | Gun stance |
|---|---|---|
| **LMB** tap | Slash — and, on the ground, the next link of the chain | Fire |
| **LMB** hold ≥ 420ms, then release | **Massive Strike** | Fire (charge ignored) |
| **Shift** hold | **Block** | — |
| **F** | **Uppercut** | — |

**Block is on Shift rather than right-click.** A guard is held through a whole
exchange while the same hand aims and slashes, and holding a mouse button down
takes away the button the other half of the fight is fought with.

Uppercut is on its own key rather than sharing a button with block. In GunZ it
lived on right-click because the weapon it belonged to had no block; here both
matter at once, and a hold/tap split on one button would make the two moves
ambiguous at exactly the moment precision counts.

Every one of these is rebindable, and the table is the default rather than the
law — see [controls.md](controls.md).

## Frame data

Every attack runs **startup → active → recovery**. A hitbox exists only during
*active*. These numbers are the whole balance of the game, so they live in one
table in `src/game/simulation/Melee.ts` and nowhere else.

| Move | Startup | Active | Recovery | Total | Damage | Reach | Blockable | Cancellable |
|---|---|---|---|---|---|---|---|---|
| **Slash** (link 1) | 75ms | 85ms | 170ms | 330ms | 7 | 42px | **yes** | **yes** |
| **Slash 2** (link 2) | 75ms | 85ms | 170ms | 330ms | 7 | 44px | **yes** | **yes** |
| **Slash 3** (finisher) | 85ms | 100ms | 420ms | 605ms | 11 | 48px | **yes** | **no** |
| **Uppercut** | 110ms | 100ms | 340ms | 550ms | 11 | 34px | **no** | **no** |
| **Massive Strike** | 190ms | 110ms | 420ms | 720ms | 24 | 56px | **no** | **no** |

On hit:

| Move | Hitstun | Launch | Knockback | Knockdown |
|---|---|---|---|---|
| Slash | 190ms | — | 130 px/s | — |
| Slash 2 | 210ms | — | 150 px/s | — |
| Slash 3 | 520ms | — | 300 px/s | **yes** |
| Uppercut | 260ms | **−620 px/s** | 90 px/s | — |
| Massive Strike | 650ms | — | 420 px/s | — |

**Why these hold:**

- **Every landed sword hit disables its target.** That is what the hitstun column
  is, and it is drawn: a staggered fighter is a different sprite, and a knocked
  down one is on the floor. This is a fix, not a flourish — through a whole LAN
  playtest the sword landed, the target kept walking its walk cycle, and the hit
  read as *nothing happening*. A mechanic nobody can see is a mechanic nobody
  believes in.
- **A link's hitstun is set by the link that follows it, not by feel.** The next
  slash becomes available when the previous one enters recovery and lands after
  its own startup, so hit *n+1* opens `active + startup` after hit *n* — 160ms
  into the chain, then 170ms. Hitstun shorter than that gap hands the defender
  free frames in the middle of a combo, which is not a combo but two swings that
  happened to be near each other. 190 and 210 are those gaps plus a couple of
  ticks.
- **Slash total (330ms) is more than double its cancelled length (160ms).** That
  gap *is* the butterfly's reward. Shrink slash recovery and the technique stops
  mattering; grow it and unskilled play becomes unplayable.
- **Slash startup (75ms) is set by the network, not by feel.** Blocking is
  specified below as a *read*, and online the earliest an opponent can learn a
  swing has started is the next 20Hz snapshot — up to 50ms. A wind-up shorter
  than that leaves no reaction budget at all, which is not a hard mechanic but an
  absent one: at the original 55ms, three measured matches raised 19 guards and
  intercepted nothing. **Any change to the snapshot rate changes this number.**
- **Uppercut launch is −620 px/s** against `JUMP_VELOCITY = -700`. A launched
  fighter rises slightly less than their own jump: high enough to be helpless,
  low enough that it is not an instant ring-out from every platform. It is
  derived from the jump, so **changing `JUMP_VELOCITY` or `GRAVITY` changes what
  a launch means** — see [movement.md](movement.md).
- **Massive recovery (420ms) is longer than a whiffed uppercut's entire
  duration.** Missing a Massive is meant to lose you the exchange outright.
- **Massive damage (24) is a bit over three slashes** but takes more than twice
  as long and cannot be cancelled or protected. The trade is deliberate.
- **The whole chain deals 25** — a shade more than a Massive, for three separate
  hits that each have to connect, on the ground, off an opener that respects
  invulnerability like anything else. The finisher's own 11 is the "little bonus"
  for having got that far.
- **Slash 3's recovery (420ms) equals its knockdown minus its active frames.**
  This is a construction, not a coincidence, and `Melee.test.ts` asserts it: the
  attacker's swing ends `active + recovery` after its hitbox opened, and the
  victim gets up `KNOCKDOWN_MS` after being hit by it, so **a landed combo ends in
  neutral**. See *The ground chain* below.

## The ground chain

A slash is not one move. It is the opening of a **three-hit chain**, and each link
is a different cut:

| Link | The cut | Cancellable |
|---|---|---|
| 1 — **Slash** | diagonal, top-down, right to left | **yes** |
| 2 — **Slash 2** | diagonal, top-down, left to right | **yes** |
| 3 — **Slash 3** | straight overhead, top-down | **no** |

**The link costs nothing but the press.** The next slash is available from the
moment the previous one enters *recovery* — the frame its hitbox closes — so the
chain is as fast as a player can tap, and there is no waiting through a recovery
that has nothing left to do. A press earlier than that is swallowed by the swing
already running, which is what stops mashing from being the same as timing.

After a link *ends*, the chain stays alive for another **260ms** (`COMBO_LINK_MS`).
That grace is what lets a link be cancelled into a block and picked up again on
the other side, so **on the ground the butterfly and the combo are the same
technique**.

Three rules pay for it:

- **Both feet on the floor.** A link thrown airborne is refused outright. An
  airborne chain would turn the butterfly's jump-in into three guaranteed hits
  from a position the defender cannot walk out of — and, read the other way, *an
  airborne butterfly still repeats link 1 forever*. That is the choice: commit to
  the chain on the ground, or keep the old endless pressure in the air.
- **The finisher cannot be cancelled.** Links 1 and 2 cancel into a block like any
  slash; link 3 is 605ms you are committed to. A chain that could be abandoned on
  its last frame would be a free three-hit string with an escape hatch.
- **Getting hit, guard-broken or stunned ends the chain.** So does anything that
  is not a link — an uppercut in the middle of a combo is a different decision,
  not the second hit of this one.

**A chain link connects through the invulnerability its own opener applied**, and
it is the only thing in the game that does. `MELEE_IFRAME_MS` is 180ms and the
links land ~160ms apart, so without this the second and third swings would pass
harmlessly through the fighter the first one just staggered: every animation would
play and the combo would deal seven damage. The opener never pierces, which keeps
invulnerability doing its real job of capping butterfly DPS.

### The knockdown

The finisher puts its target **on the floor for 520ms** — stunned, drawn lying
down, and spiked downward if it was caught in the air.

**`KNOCKDOWN_MS` equals the finisher's active plus recovery frames.** The attacker
is free `active + recovery` after the hitbox opened; the victim gets up
`KNOCKDOWN_MS` after being hit by it. They are the same number, so **a landed
combo ends in neutral** — position and damage, never a free follow-up. That is
what pays for the finisher being uninterruptible, and it is asserted in
`Melee.test.ts` rather than left as a comment.

### What it looks like

The three cuts are told apart by **perspective**, not just by angle. Each swing
declares how far it travels *through* the screen, and the blade is drawn longer,
thicker, brighter and further from the body as it comes toward the camera —
foreshortened and dimmed as it goes away. The two diagonals use opposite depths,
so they read as mirror images rather than as the same swing twice, and the trail
takes the same perspective as the blade that drew it.

All of it is renderer-side (`MeleeFx`), driven from `PlayerPosition` like every
other effect, so the local fighter's chain is predicted and the remote's comes
from the snapshot with no animation logic of its own.

## Blocking

Hold **Shift**. The guard is up on the very next simulation tick and drops the
instant the button is released — no startup cost, and no forgiveness window on
either side.

There is no startup delay because there is no budget for one. Reacting to a 75ms
wind-up across a 20Hz network already spends most of the available time waiting
for the snapshot; charging another 30ms on top was the difference between a hard
read and an impossible one. A sub-tick delay would have been worse still —
honest-looking in the constants and rounded away to nothing at 60Hz. **Blocking
is risky because it covers one side, slows you to 55% walk speed, and does
nothing against a Massive or an uppercut — not because the button is sticky.**

There is no forgiveness window either. Coyote time and jump buffering exist
because a jump has one correct moment and missing it feels like the game ignored
you; a block is held for as long as you want it, so making it sticky would only
make it stronger for free.

**You cannot guard and swing at the same time.** Holding block through your own
slash would make the butterfly not merely safe but strictly free. Cancelling into
the block still works — the cancel ends the move first, and the guard comes up
after.

- **Front only, and it covers bullets too.** A raised guard absorbs a shot
  arriving from the front — 0 damage, and the bullet is consumed. See
  [combat.md](combat.md); there is no parry against a bullet.
- **Front only.** A block covers the side the fighter faces. An attack landing
  from behind is not blocked at all — see *Backstab* below.
- **Blockable attacks are fully absorbed**: zero damage, a small shared
  pushback, and no stun.
- **Massive Strike and uppercut ignore blocking entirely.** This is the point of
  both moves: a turtling opponent must be opened up, not out-slashed.
- Blocking is impossible while stunned, and cannot begin during a heavy move's
  recovery.

### Parry — the reward for blocking early

The first **140ms** of a block is a **parry window**.

A blockable attack absorbed inside that window **guard-breaks the attacker**:

- the attacker is stunned for **420ms** and their move ends immediately,
- the defender is granted an **instant Massive Strike** (`massiveReady`), with no
  charge time.

This is GunZ's rule that a successful block charges a counter-attack, and it is
what stops the butterfly being unconditionally safe. Blocking *late* still
absorbs the hit but grants nothing, so mashing block is not the same as reading
the swing.

**The window belongs to the press, not to the block.** Holding block down does not
re-arm it, and neither does interrupting your own block with a slash — the timer
only resets when the button is released. A fighter who simply holds block gets
one parry attempt and then a plain, rewardless guard for as long as they crouch
behind it. Without that rule, holding block while butterflying would hand out a
free parry every cycle, and the safest option in the game would also be the most
rewarding one.

### Backstab — the reward for getting behind

Because a block only faces one way, **the answer to a turtle is footsies**, not
just heavy moves.

An attack that lands on a fighter's **unfaced** side ignores their block *and*
applies an extra **500ms** of stun on top of the move's own hitstun. Circling
behind a blocking opponent is therefore a complete opening, at the cost of the
time it takes to get there.

**Behind means a full body width past their centre (32px).** Fighters do not
collide with each other, so in any close exchange the two bodies are literally
standing inside one another — and facing is locked through a swing's active
frames. Deciding
"behind" from the sign of a few pixels in that situation made the backstab the
*default* outcome of a scramble rather than a reward for winning one: a measured
match produced 11 backstabs to 1 clean hit, and because a backstab ignores the
guard, it also silently disabled blocking. Requiring real separation is what
makes getting behind somebody a deliberate act.

**Facing follows aim, not feet.** A fighter turns to face where they are aiming,
so they can back away while still guarding the side the attacker is on. Deriving
facing from the walk direction alone meant a fighter standing still could never
turn around, and two fighters who had crossed over stayed permanently
back-to-back.

**Facing is locked through a move's startup and active frames, and free again in
recovery.** The lock covers exactly the window in which the direction is a
promise: steering a live hitbox would make blocking unreadable, and turning
during the wind-up would erase the tell the defender is reading. Recovery has no
hitbox and no tell left to give.

**The chain is the one place that adds up.** Each link's recovery is skipped by
the link after it, so a full three-hit combo is facing-locked for most of its
~600ms. That is a cost the player *chooses* three separate times, and it ends —
unlike the old bug below, which charged it for simply holding a button.
`scripts/aim-probe.mjs` measures the single-press case, which is unchanged at
44ms worst.

Locking the whole move instead — which is what this said originally — meant a
player holding the attack button chained slashes and **went 332ms at a time
without obeying the cursor**, measured by `scripts/aim-probe.mjs`. That is the
whole of "the game struggles to follow the mouse pointer". Freeing recovery caps
the worst case at a slash's startup plus active frames, measured at 154ms.

## The Massive Strike

A Massive Strike is armed (`massiveReady`) two ways:

1. **Charging** — hold LMB for **420ms**. The blade lights up. Releasing fires
   it.
2. **Parrying** — a successful parry arms it instantly, for free.

An armed Massive fires on the next attack press, replacing the slash. It is
unblockable, deals 24, stuns for 650ms and throws the target 420 px/s away.

**A parry-granted Massive is one of the few things a client cannot predict**, and
it is doubly awkward because throwing it *consumes* the arming. Only the server
knows a parry landed, so the client predicts a plain slash on release and the
replay lands on a Massive with `massiveReady` already spent — which reads as the
state machine diverging unless the reconciler recognises both spellings of the
event. See [netcode.md](netcode.md).

It is also the single most punishable action in the game: **190ms of startup you
cannot cancel, and 420ms of recovery you cannot cancel.** Charging in an
opponent's face is a gift.

## The uppercut

A short, fast, **unblockable** thrust that launches the target into the air.

- It out-ranges nothing — **34px, the shortest reach of the three** — so it must
  be walked into.
- It cannot be cancelled and recovers for 340ms.
- A launched fighter is airborne *and* stunned for 260ms, which is a combo
  opening rather than a kill on its own.

Its whole job is to answer a block. It loses to spacing, and it loses badly to
being whiffed.

## Cancels and the butterfly

**Only the first two links of the chain are cancellable, and only after their
startup.** Once one is in its active or recovery phase, either of these ends it
instantly:

- pressing **block** — the butterfly,
- **switching stance** — the slash-shot.

A cancelled slash keeps any hit it already landed. Cancelling does not refund the
hit, and a swing can only connect once (`hitLatch`).

The canonical 2D butterfly is therefore:

```
jump → dash → slash → block → slash → block → …
```

Each cycle costs about **160ms** instead of 330ms, moves you forward, and leaves
you blocking between swings. It is the correct default way to approach and to
apply pressure — and it loses cleanly to a parry.

**In the air it repeats link 1 forever. On the ground it walks the chain**, so
the third cycle is the finisher and its 420ms of uncancellable recovery. That is
deliberate: a grounded butterfly now has a shape and a cost, and the pilot
chooses between the endless airborne version and the grounded one that ends in a
knockdown.

**Damage is capped by invulnerability, not by cooldown.** After taking melee
damage a fighter is immune to further melee for **180ms**. Without this the
butterfly would simply be the highest-DPS option as well as the safest; with it,
faster swinging stops paying and the technique stays a *positioning* tool.

## Stun, and the disabled state

**Every landed sword hit disables its target**, for the hitstun in the frame data
table. A disabled fighter:

- takes no input at all — no movement, jump, attack, block or stance change,
- has any in-progress melee move cancelled, and loses any chain it was in,
- still falls, still collides, and can still be hit,
- **is drawn as disabled** — a distinct sprite, not the walk cycle. A knocked down
  fighter gets its own, lying on the surface it is standing on.

Both hit sprites are **generated from the shipped character strip** at boot
(`createHitTextures`): the same fighter, flushed and rocked off balance for a
stagger, rotated flat with a puff of dust for a knockdown. They are placeholders
in the honest sense — they line up perfectly with the walk cycle they came from,
and the real art replaces them by deleting one function.

`knockdownTimer` is separate from `stunTimer` even though a knockdown is always
also a stun: the renderer has to tell "staggered" from "on the floor", and a
diagnostic has to be able to count knockdowns without counting every hit. The two
coming apart — down but not stunned — is an `illegalActions` violation.

Stun is stored in the simulation state and therefore replays through
reconciliation like everything else.

## Verification

Melee is measured, not eyeballed. `movementSummary`'s sibling `meleeSummary` in
the diagnostic reports both **that the mechanics fire** and **that they never
fire illegally**:

| Metric | Target |
|---|---|
| `illegalActions` | **0** — nobody acts while stunned, nobody is down without being stunned |
| `airborneChainLinks` | **0** — the chain is a ground technique |
| `blockedUnblockables` | **0** — a block never stops a Massive or uppercut |
| `frameDataViolations` | **0** — every phase lasts what the table says |
| `stuckActionFrames` | **0** — no move outlives its own duration |
| `meleeDesyncFrames` | **0** — predicted move matches the authoritative one |
| `slashes`, `massives`, `uppercuts`, `blocks`, `parries`, `backstabs`, `stuns`, `butterflyChains` | **> 0** across a few runs |
| `comboLinks`, `combosFinished`, `knockdowns` | **> 0** across a few runs |

The second row matters as much as the first. Every must-be-zero metric is
trivially satisfied by a build where melee never happens, so a run that reports
no violations *and no moves* is a failed run, not a passing one. Both of the
worst bugs found while building this — reactive blocking being impossible, and
the backstab firing on overlapping bodies — showed up as a **zero in the second
row while the first row was perfectly clean**.

**`blockedHits: 0` alongside `parries > 0` is the expected signature of reactive
guarding, not a defect.** A guard held longer than the 140ms parry window when
the hit lands is a `blocked`; anything earlier is a `parried`. Since
`BLOCK_STARTUP_MS` is 0 and the AI raises its guard on reading a swing, virtually
every guard it wins lands inside the window. `blocked` is what a *turtle* who has
been holding the button produces — so a run of all `parried` says the guards are
reactive, and a run of all `blocked` would say nobody is reading anything.

`outcomeByMove` breaks the outcomes down per move, because a flat `blocked: 0` is
ambiguous: it reads identically whether guards are failing or whether everything
that connected happened to be unblockable by design, and those need opposite
fixes.

**`comboLinks: 0` beside a healthy `slashes` is the signature of a chain nobody
can reach** — a link window too tight to hit, or a ground check that is never
true. It is also exactly what the metric was added to catch, since every
must-be-zero row stays clean in a build where the combo simply never happens.

Healthy ranges for one 8s AI-vs-AI match, as a sanity check rather than a
threshold: 10-20 slashes, 2-8 massives, 1-8 uppercuts, 9-15 blocks, 3-9 hits,
0-5 backstabs, 2-12 butterfly chains. **Backstabs outnumbering clean hits is a
defect**, not a fight going well.

```bash
node scripts/diagnose.mjs --mode=online --runs=3
```

## Not implemented

- **A finisher that pierces a block.** GunZ ends a combo with a hit the guard
  cannot stop; here all three links are blockable, so reading any one of them ends
  the chain. Deliberate for now — the chain already beats invulnerability, and
  giving it the guard as well would leave nothing to read.
- **Directional blocking** beyond front/back. There is no high/low split, so
  GunZ's "cannot block the lower half of your body" does not apply.
- **Wall-slash deflection** — GunZ stuns an opponent who slashes into a wall in
  front of you. Not built.
- **Weapon variety.** One sword, one gun, fixed stats. No daggers, dual swords,
  or elemental charges.
- **Lag compensation on melee hits.** The server tests hitboxes against present
  positions, so a high-ping attacker must lead slightly.
- **Hitstop.** Impact is sold with shake and sprite punch only; freezing frames
  would desync the simulation.
