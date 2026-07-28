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
| **LMB** tap | Slash | Fire |
| **LMB** hold ≥ 420ms, then release | **Massive Strike** | Fire (charge ignored) |
| **RMB** hold | **Block** | — |
| **F** | **Uppercut** | — |

Uppercut is on its own key rather than sharing a mouse button. In GunZ it lived
on right-click because the weapon it belonged to had no block; here both matter
at once, and a hold/tap split on one button would make the two moves ambiguous
at exactly the moment precision counts.

## Frame data

Every attack runs **startup → active → recovery**. A hitbox exists only during
*active*. These numbers are the whole balance of the game, so they live in one
table in `src/game/simulation/Melee.ts` and nowhere else.

| Move | Startup | Active | Recovery | Total | Damage | Reach | Blockable | Cancellable |
|---|---|---|---|---|---|---|---|---|
| **Slash** | 75ms | 85ms | 170ms | 330ms | 7 | 42px | **yes** | **yes** |
| **Uppercut** | 110ms | 100ms | 340ms | 550ms | 11 | 34px | **no** | **no** |
| **Massive Strike** | 190ms | 110ms | 420ms | 720ms | 24 | 56px | **no** | **no** |

On hit:

| Move | Hitstun | Launch | Knockback |
|---|---|---|---|
| Slash | 130ms | — | 130 px/s |
| Uppercut | 260ms | **−620 px/s** | 90 px/s |
| Massive Strike | 650ms | — | 420 px/s |

**Why these hold:**

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

## Blocking

Hold **RMB**. The guard is up on the very next simulation tick and drops the
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

**The window belongs to the press, not to the block.** Holding RMB down does not
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

**Only a slash is cancellable, and only after its startup.** Once a slash is in
its active or recovery phase, either of these ends it instantly:

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

**Damage is capped by invulnerability, not by cooldown.** After taking melee
damage a fighter is immune to further melee for **180ms**. Without this the
butterfly would simply be the highest-DPS option as well as the safest; with it,
faster swinging stops paying and the technique stays a *positioning* tool.

## Stun

A stunned fighter:

- takes no input at all — no movement, jump, attack, block or stance change,
- has any in-progress melee move cancelled,
- still falls, still collides, and can still be hit.

Stun is stored in the simulation state and therefore replays through
reconciliation like everything else.

## Verification

Melee is measured, not eyeballed. `movementSummary`'s sibling `meleeSummary` in
the diagnostic reports both **that the mechanics fire** and **that they never
fire illegally**:

| Metric | Target |
|---|---|
| `illegalActions` | **0** — nobody acts while stunned |
| `blockedUnblockables` | **0** — a block never stops a Massive or uppercut |
| `frameDataViolations` | **0** — every phase lasts what the table says |
| `stuckActionFrames` | **0** — no move outlives its own duration |
| `meleeDesyncFrames` | **0** — predicted move matches the authoritative one |
| `slashes`, `massives`, `uppercuts`, `blocks`, `parries`, `backstabs`, `stuns`, `butterflyChains` | **> 0** across a few runs |

The second row matters as much as the first. Every must-be-zero metric is
trivially satisfied by a build where melee never happens, so a run that reports
no violations *and no moves* is a failed run, not a passing one. Both of the
worst bugs found while building this — reactive blocking being impossible, and
the backstab firing on overlapping bodies — showed up as a **zero in the second
row while the first row was perfectly clean**.

`outcomeByMove` breaks the outcomes down per move, because a flat `blocked: 0` is
ambiguous: it reads identically whether guards are failing or whether everything
that connected happened to be unblockable by design, and those need opposite
fixes.

Healthy ranges for one 8s AI-vs-AI match, as a sanity check rather than a
threshold: 10-20 slashes, 2-8 massives, 1-8 uppercuts, 9-15 blocks, 3-9 hits,
0-5 backstabs, 2-12 butterfly chains. **Backstabs outnumbering clean hits is a
defect**, not a fight going well.

```bash
node scripts/diagnose.mjs --mode=online --runs=3
```

## Not implemented

- **Combos with distinct follow-up animations.** A slash is one move, not the
  first of a chain; GunZ's rule that the final hit of a combo pierces a block has
  no equivalent here yet.
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
