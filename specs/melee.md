# Sword Combat

**Intent:** the sword game is a rip of *GunZ: The Duel*'s K-Style, rebuilt for
two dimensions. The whole design rests on one idea:

> **Light attacks can be cancelled. Heavy attacks cannot.**

Everything else follows. Cancelling a slash into a block is what produces the
*butterfly* — the rapid, mobile, half-defensive pressure that GunZ players
invented and that made the game famous. Refusing to cancel the heavy moves is
what stops the butterfly being the only answer: a Massive Strike or an uppercut
commits you to a long recovery, and a fighter who reads it gets a free punish.

This is the **sword's** spec — the frame table below is the sword's, and the
weapon system it lives in is described in [heroes.md](heroes.md). The dagger's
kit is its own spec: [anands.md](anands.md). The two share the state machine
(startup/active/recovery, the phases, the hitbox rules, the stun/knockdown
replay path) and differ in what they are allowed to start: each weapon names
its moves in `simulation/Melee.ts`'s weapon table, and `tickMelee` is
parameterised by it. Everything in this file about the *mechanics* — the
butterfly, the guard, the massive, the bomb — is a property of the sword
weapon.

The loop the mechanics are meant to produce:

```
  butterfly pressure  ──blocked──▶  you are guard-broken: 1s helpless
         │                                        │
    opponent blocks                        they collect a free Massive
         │                                        │
  the answers to a turtle:            ◀── a read guard breaks the swing
  uppercut (unblockable, short reach)
  back massive (blast behind you, stuns through the guard)
  plunge bomb (from the air, unstoppable — and it plants you)
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
| **LMB** hold ≥ 1600ms, then release | **Massive Strike** (a floor slam — or the plunge bomb, airborne) | Fire (charge ignored) |
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
|---|---|---|---|---|---|---|---|---|---|
| **Slash** (link 1) | 75ms | 85ms | 170ms | 330ms | 7 | 48px | **yes** | **yes** |
| **Slash 2** (link 2) | 75ms | 85ms | 170ms | 330ms | 7 | 50px | **yes** | **yes** |
| **Slash 3** (finisher) | 85ms | 100ms | 420ms | 605ms | 11 | 54px | **yes** | **no** |
| **Uppercut** | 110ms | 100ms | 340ms | 550ms | 11 | 34px | **no** | **no** |
| **Massive Strike** (slam) | 90ms | 130ms | 460ms | 680ms | 24 | 40px | **yes** | **no** |

On hit:

| Move | Hitstun | Launch | Knockback | Knockdown |
|---|---|---|---|---|
| Slash | 190ms | — | 130 px/s | — |
| Slash 2 | 210ms | — | 150 px/s | — |
| Slash 3 | 520ms | — | 300 px/s | **yes** |
| Uppercut | 260ms | **−620 px/s** | 90 px/s | **yes, on the landing** |
| Massive Strike | 650ms | — | 420 px/s | — |

The Massive Strike's *blast* is not in this table, because it is not a swing:
it is an area event judged by the server when the swing reaches the floor. See
*The Massive Strike* and *The plunge bomb* below.

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
- **Massive recovery (460ms) is longer than a whiffed uppercut's entire
  duration.** Missing a Massive is meant to lose you the exchange outright.
- **Massive damage (24) is a bit over three slashes** but takes more than twice
  as long and cannot be cancelled or protected. The trade is deliberate.
- **The swing's startup is short (90ms) because the charge already was the
  wind-up**: the sword is raised for the whole 1.6s hold, so the swing itself only
  has to come down.
- **The swing is blockable, and that is the point.** The old Massive ignored the
  guard; the new one loses to it — a defender standing in the blade's path stops
  it before it reaches the floor, and every block of a sword attack is a guard
  break. A front massive thrown into a turtle is a gift; the answers to a turtle
  are the blast behind you and the bomb overhead. See *The Massive Strike*.
- **The whole chain deals 25** — a shade more than a Massive, for three separate
  hits that each have to connect, on the ground, off an opener that respects
  invulnerability like anything else. The finisher's own 11 is the "little bonus"
  for having got that far.
- **Slash 3's recovery (420ms) equals its knockdown minus its active frames.**
  This is a construction, not a coincidence, and `Melee.test.ts` asserts it: the
  attacker's swing ends `active + recovery` after its hitbox opened, and the
  victim gets up `KNOCKDOWN_MS` after being hit by it, so **a landed combo ends in
  neutral**. See *The ground chain* below.

### The hitbox is swept, and it covers the body

A slash's hitbox is not a fixed box parked in front of the fighter — it is the
**union of the weapon's reach and the path the body has travelled since the
swing began**. Two consequences, both lifted straight from GunZ:

- **The dash-slash trails.** A slash thrown out of a dash carries its hitbox
  across the dash's travel, so a fighter the dash passed *through* is caught by
  the trail even though, by the time the active frames open, they are already
  behind the sword. The sweep is derived from `vx` alone (`meleeHitbox`), so
  during a dash — where `vx` is the constant burst speed — the trail is exact,
  and during a walk it is the small, honest distance the fighter actually
  moved. A move that carries its own body (the dagger thrust's `selfVx`) is
  excluded: its sweep is `sweptThrustBox`'s job, and counting the lunge twice
  would widen the thrust twice.
- **Point-blank swings connect.** The box covers the attacker's own body, so a
  fighter pinned against a wall — or two fighters standing inside one another
  in a scramble — can never miss for being *too close*. The original box began
  past the body's front edge, which is exactly the situation that missed.

Reach is measured from the body's front edge as before; the body coverage and
the trail are additions on top, not a redefinition. The guard is unaffected by
either: a swept box still tests the defender's block the same way, so a read
guard still turns a dash-slash into a guard break.

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
That grace is for a link thrown after the previous one has fully recovered, so
the rhythm does not have to be caught inside the recovery window exactly.

**A cancel is not a link, and it ends the chain.** Blocking out of link 1 or link
2 returns you to link 1, not to the next cut — so **the butterfly and the combo
are different decisions on the ground**. Slash-and-guard is an endless loop you
can hold forever; walking the chain means declining the cancel three times and
accepting the finisher's uncancellable 420ms. The player picks the moment they
feel good about committing, and nothing chooses it for them.

Four rules pay for it:

- **Both feet on the floor.** A link thrown airborne is refused outright. An
  airborne chain would turn the butterfly's jump-in into three guaranteed hits
  from a position the defender cannot walk out of — and, read the other way, *an
  airborne butterfly still repeats link 1 forever*. That is the choice: commit to
  the chain on the ground, or keep the old endless pressure in the air.
- **The finisher cannot be cancelled.** Links 1 and 2 cancel into a block like any
  slash; link 3 is 605ms you are committed to. A chain that could be abandoned on
  its last frame would be a free three-hit string with an escape hatch.
- **A cancel ends the chain** — block or stance switch, from link 1 or link 2
  alike. Otherwise every
  butterfly cycle would advance the combo, and a player using the safe loop would
  be handed the uncancellable finisher on the third guard — the one move they
  were butterflying to avoid committing to.
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

Four moves put a target on the floor, and they are priced in the order of how
much they commit to it: the chain's finisher (**520ms**), both anti-airs
(**700ms**, `ANTIAIR_KNOCKDOWN_MS`), and the dagger's thrust (**1500ms**).

The finisher's 520ms is **equal to its own active plus recovery frames**. The
attacker is free `active + recovery` after the hitbox opened; the victim gets up
`KNOCKDOWN_MS` after being hit by it. They are the same number, so **a landed
combo ends in neutral** — position and damage, never a free follow-up. That is
what pays for the finisher being uninterruptible, and it is asserted in
`Melee.test.ts` rather than left as a comment.

**A knockdown is always a stun as well** — a fighter flat on the floor who could
still walk is the bug the `illegalActions` diagnostic watches for — and it is the
one thing that ends a Death Blossom. Both rules live in `applyKnockdown`, the
single place the state is written.

#### The knockdown a launch owes the floor

The sword's uppercut both **launches** (−620 px/s) and **knocks down**, and on the
tick of the hit those two contradict each other: a knockdown spikes its victim
downward and a launch sends them up. So the uppercut spends the launch and *arms*
the floor time, in `knockdownPendingTimer` — the debt is simulation state on the
wire, not a renderer's guess, because the tick a fighter goes down is a fact both
sides must agree on and a knockdown applied on top of predicted state would be
erased by the next reconciliation.

`tickPlayer` collects the debt on the tick the feet are next found on the floor,
**wherever in the arena that turns out to be** — and it collects it *before* the
melee tick runs, exactly where a stun that arrived between ticks is handled, so
the stun gate is the one thing that decides what a knockdown takes away. Paying
it at the end of the landing tick instead left the victim lying on the floor
still holding the guard they had out on the way down, which is the state the
`illegalActions` diagnostic exists to catch (and which it caught, online, on the
first run).

The consequences:

- The victim's arc is unchanged. They rise, and the 260ms hitstun expires
  mid-flight, so an uppercut still opens the juggle it always opened, and a foe
  with their air dash or second jump still in hand can spend it on the way down.
- Escaping the stun is **not** escaping the move. Whoever falls, falls on their
  back: the knockdown is delivered on the landing rather than never.
- A knockdown that lands *first* (a thrust catching the launched fighter) clears
  the debt, so the landing cannot shorten a longer sentence by re-arming a
  shorter one.

The dagger's shoryuken knocks down **on the hit** — it has no launch to contradict
it, so its victim is spiked straight into the floor.

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
is risky because it covers one side, slows you to 55% walk speed, and turns
every sword hit it stops into a guard break that commits both fighters — not
because the button is sticky.** (And it stops the Massive's *swing*; what it
cannot stop is the blast behind the swing and the bomb overhead — see *The
Massive Strike*.)

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
- **And it denies ultimates.** The guard is the game's universal answer to an
  ultimate: a blocking fighter facing the throw catches the black hole's
  grenade like a bullet, the hole never opens, and the thrower's meter is
  simply gone — the *DENY*. Same rule that covers bullets, named for the rule
  it serves (`blocksUltimate`), so every future ultimate that arrives as
  something throwable inherits the counterplay for free. See
  [ultimate.md](ultimate.md).
- **Eating bullets feeds the meter.** A guard that stops a bullet grants the
  defender a little ultimate charge (`ULT_CHARGE_PER_BLOCKED_BULLET`), paid
  once per round and drawn as **purple sparks** where the bullet died. It is
  a small, flat grant — a single rifle shot is a rounding error, but a
  machine gun or a shotgun emptied into a read guard is real charge. This is
  the guard's anti-spam job: a fighter who holds block against a streamer
  is being paid to, and the counter is what makes *mindless* spam feed the
  defender rather than the shooter. The purple is the one colour nothing else
  in a fight uses, so a defender reading a stream sees the reward it is
  paying. (It is deliberately not a parry — no guard break, no free Massive —
  because that would make holding block strictly dominant against a gunner.)
- **Front only.** A block covers the side the fighter faces. An attack landing
  from behind is not blocked at all — see *Backstab* below.
- **Every sword attack a guard stops is a guard break.** There is no
  "absorbed without reward" tier any more: a slash, a chain link, even the
  Massive's swing — if it lands on a raised guard, the *attacker* is
  incapacitated for a full second (`GUARD_BREAK_STUN_MS`), drawn raising their
  sword helplessly, and the defender is granted a full Massive Strike.
- **The uppercut ignores blocking entirely.** It is unblockable, and it is one
  of the two designed answers to a turtle — the other two are the blast behind
  the swing (the *back massive*) and the plunge bomb overhead.
- Blocking is impossible while stunned, and cannot begin during a heavy move's
  recovery.

### The guard break — every block rewards the defender

A guard that stops a sword attack **guard-breaks the attacker**:

- the attacker is stunned for **1000ms** and their move ends immediately,
  drawn with the sword raised uselessly (`guardBroken` — the helpless pose);
- the defender is granted an **instant Massive Strike** (`massiveReady`), which
  fires on the next attack *press* — the defender was not holding the button —
  and fades after **4 seconds** if unspent.

This is GunZ's rule that a successful block charges a counter-attack, made
strong: *defense is stronger than attack on a read.* The butterfly — slash,
cancel, guard — is now a genuine commitment against somebody holding block:
every press into their guard hands them a free Massive. What keeps blocking
from being the only option is that the guard only covers one side, and the
unblockables exist precisely to open a turtle: the uppercut at close range, the
blast behind the swing, and the bomb from above.

A guard that stops a **bullet** or an **ultimate** is a plain absorb — no
guard break, no reward. The break is the sword's answer to the sword.

**The granted Massive is one of the few things a client cannot predict**, and
it is doubly awkward because throwing it *consumes* the arming. Only the server
knows a guard break landed, so the client predicts a plain slash on press and
the replay lands on a Massive with `massiveReady` already spent — which reads
as the state machine diverging unless the reconciler recognises both spellings
of the event. See [netcode.md](netcode.md).

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
`scripts/aim-probe.ts` measures the single-press case, which is unchanged at
44ms worst.

Locking the whole move instead — which is what this said originally — meant a
player holding the attack button chained slashes and **went 332ms at a time
without obeying the cursor**, measured by `scripts/aim-probe.ts`. That is the
whole of "the game struggles to follow the mouse pointer". Freeing recovery caps
the worst case at a slash's startup plus active frames, measured at 154ms.

## The Massive Strike

A Massive Strike is armed (`massiveReady`) two ways:

1. **Charging** — hold LMB for **1600ms**. The sword is held up overhead for
   the whole hold, with energy motes streaming in — more of them the longer the
   hold, so the threat accumulates exactly as the charge does. Releasing fires
   it.
2. **A guard break** — blocking a sword attack arms it instantly, fires on the
   next *press* rather than a release, and fades after **4 seconds** if unspent.

### The charge

**Charging is a commitment that ends in a delivery.** While holding attack:

- **you cannot walk while the charge is filling** — the accumulation roots your
  feet (after `CHARGE_LOCK_MS`, so a butterfly tap or a chain link never loses
  its mobility) — but **dash and double-jump work even then**: the burst is how
  the charge closes distance, and the hop is how the bomb is made.
- **once the charge completes, everything returns.** An armed fighter walks the
  massive into range, dashes, jumps, blocks — the charge is a weapon being
  carried, not a cast being endured, and *delivering* it (walk it in, hop it
  into a bomb, guard up while approaching) is the strategy the 1.6s commitment is
  paid for.

The charge is lost by anything that is not a delivery: releasing early, being
hit, switching weapons, or casting an ultimate. It is not lost by blocking,
dashing or jumping — those are the tools it exists to keep.

### The slam

Releasing a charged massive **on the ground** slams the sword down into the
floor **a little in front of the fighter** (`MASSIVE_SLAM_OFFSET_PX` — 56px
from the body's centre, so the swing's own hitbox covers the blade's path and
nothing more).

Two things happen on the way down:

1. **The swing is a normal, blockable hit.** A defender standing in the blade's
   path stops it before it reaches the floor — and because every block of a
   sword attack is a guard break, a front massive thrown into a turtle is a
   gift: they block it, you eat a second of helplessness, they collect your
   massive. This is deliberate. The old unblockable Massive made a turtle
   helpless against it; the new one makes a *read* the counterplay, which is
   what keeps the slam from being the only option.
2. **If the blade reaches the floor, the floor explodes.** The blast is judged
   by the server the tick the swing's active window closes, **front and back
   of the slam point** (`MASSIVE_BLAST_RADIUS_PX` = 100px either way), dealing
   24 and stunning for 650ms — and the stun **goes straight through a guard**.
   The blast is not a swing; nothing can block or parry it. **It erupts even
   when it hits nobody** — the area of effect *is* the move, and a whiffed
   massive has to read as the floor exploding just the same, so the server
   sends the blast event once per slam whatever it caught (the drawn ring
   reaches exactly the blast's radius).

   **The blast has its own visual vocabulary, shared with nothing.** The
   parry, the backstab and the uppercut all draw the clean ring; the massive
   gets the one silhouette nothing else uses: a jagged crown of torn ground
   (`fx_shockwave` — an uneven spike rim, never a circle) that snaps out to
   the blast's exact radius, white-hot first and the move's amber riding
   behind; a mushroom of rocks torn straight up and thrown sideways at the
   top; and lumpy debris (`fx_chunk`) arcing back down over the whole radius.
   It is the only boom in the game that throws rocks, which is the point: a
   four-second commitment earns the loudest, most distinctive effect on the
   floor.

### The back massive

Because the blast radiates **behind** the slam point too, a fighter who turns
their back on a turtling opponent — aiming away, so the swing goes the other
way — plants the sword in front of themselves and the blast reaches backward
past their own body to the turtle, whose guard cannot stop it. The turtle is
outside the swing's path (nothing to block) and inside the blast's back reach
(caught anyway). It is the designed answer to a guard that the uppercut
cannot reach.

The slam is also the most punishable action in the game after the charge itself:
**90ms of startup you cannot cancel, and 460ms of recovery you cannot cancel.**
Whiffing it, or throwing it into a read guard, is meant to lose you the
exchange outright.

## The plunge bomb

Releasing a charged massive **in the air** refuses the swing and becomes the
**plunge bomb**: the fighter dives vertically at `PLUNGE_SPEED` (1500 px/s —
faster than a fall can ever get, *Ike's Aether-dive fast*), sword pointed
straight down, shedding all horizontal drift. Nothing can be pressed mid-dive;
the bomb is committed from the release to the floor.

### The blast is a measure of the fall

At floor contact the fighter slams the sword into the ground and the bomb
detonates. The fall height — release Y to landing Y, capped at
`PLUNGE_MAX_FALL_PX` — prices the whole event:

| Stat | Formula (H = fall in px) | At H=200 | At H=500 |
|---|---|---|---|
| Blast radius | 70 + 0.12·H (cap 130) | 94px | 130px |
| Stun | 450 + 0.5·H (cap 700) | 550ms | 700ms |
| Knockup | −250 − 0.9·H (cap −700) | −430 | −700 |
| Stuck (the bomber) | 400 + 0.8·H (cap 800) | 560ms | 800ms |

The bomb **cannot be blocked**. Its stun and its knockup hit through a guard
like the ground blast's do; the only way to avoid it is to be outside the
blast radius when it lands. It is the strongest tactic in the game, and the
arena's high ledges are what give it teeth — the higher you start, the more
of it there is.

**A dive cannot be anti-aired.** While `plunging`, the bomber is immune to
melee — slashes, stabs, the thrust's sweep, the uppercut and the shoryuken
all pass through it. The dive is committed and unanswerable by a swing; its
counters are **distance** (the column is narrow and the dive is fixed to it)
and **ultimates**: the black hole's hold and the dragon thrust's sweep are
the only things that still stop a dive.

### The catch — the dive carries its victims

The dive is not just a descent: while it lasts, the bomber's body is a
weapon column. Any hostile fighter **airborne and inside the bomber's reach**
(`PLUNGE_CATCH_RADIUS_PX` — a body's width past the bomber on every side) is
**caught**:

- the catch is a hit, judged once per victim per dive by the server — a
  carried fighter stays in the column (same speed, same line), so a
  re-judged grab would re-stun every tick and no client could predict it;
- the victim is stunned for the ride (`PLUNGE_CARRY_MS`) and **carried down
  at the dive's own speed** — the carry is `PlayerPosition` state both sides
  simulate, exactly like the dragon ride, so the victim's own client replays
  it deterministically;
- at the landing, the blast **pins instead of launches**: the bomb's usual
  knockup is traded for a knockdown lasting the blast's whole stun, so a
  caught anti-air ends face-down in the crater rather than thrown back up.

This is what makes the plunge **win against the shoryuken** — and the
uppercut: both anti-airs put their users in the dive's column (their
launch *is* the entry), the dive ignores their hit by the immunity above,
and it catches them on the way down. The bomb's counterplay is to step out
of the column, not to swing into it.

### The stuck — the bomber's price

The bigger the bomb, the longer the bomber is **planted with their sword in
the ground** (`plungeStuckTimer`): rooted, helpless, and unable even to guard.
A planted bomber is open season — the punisher's window is literally drawn as
a fighter bent over a stuck blade.

**The only thing that ends the stuck early is a melee hit.** A sword slash (or
another blast) is an animation punishment that tears the bomber free — with the
hit's own stun and knockback playing out on top. Bullets do not break it.

## The uppercut

A short, fast, **unblockable** thrust that launches the target into the air — and
then puts them on the floor.

- It out-ranges nothing — **34px, the shortest reach of the three** — so it must
  be walked into.
- It cannot be cancelled and recovers for 340ms.
- A launched fighter is airborne *and* stunned for 260ms, which is a combo
  opening rather than a kill on its own.
- Its **knockdown is paid on the landing** (`700ms`, the same short floor time as
  the dagger's shoryuken), because a launch and a slam cannot happen on the same
  tick. See *The knockdown a launch owes the floor*.

Its whole job is to answer a block. It loses to spacing, and it loses badly to
being whiffed.

## Cancels and the butterfly

**Only the first two links of the chain are cancellable, and only after their
startup.** Once one is in its active or recovery phase, either of these ends it
instantly:

- pressing **block** — the butterfly,
- **switching stance** — the slash-shot.

A cancelled slash keeps any hit it already landed. Cancelling does not refund the
hit, and a swing can only connect once (`hitLatch`). **Either cancel drops the
ground chain** — see *The ground chain* above.

The canonical 2D butterfly is therefore:

```
jump → dash → slash → block → slash → block → …
```

Each cycle costs about **160ms** instead of 330ms, moves you forward, and leaves
you blocking between swings. It is the correct default way to approach and to
apply pressure — and it loses cleanly to a guard, because every press into a
raised guard is a guard break. The butterfly is a *read-dependent* pressure
tool now: it demands the opponent not be holding the button, which is exactly
the risk that makes it a technique rather than a policy.

**It repeats link 1 forever, in the air and on the ground alike**, because the
block cancel resets the chain. The combo is the *other* option: to walk it you
have to let each link reach its recovery and press again without guarding, which
means giving up the cancel that made the butterfly safe. Pressure with the loop
for as long as you like, then spend it on three hits when you have the read.

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
| `blockedUnblockables` | **0** — a block never stops an uppercut |
| `frameDataViolations` | **0** — every phase lasts what the table says |
| `stuckActionFrames` | **0** — no move outlives its own duration |
| `meleeDesyncFrames` | **0** — predicted move matches the authoritative one |
| `slashes`, `massives`, `plunges`, `uppercuts`, `blocks`, `parries`, `backstabs`, `stuns`, `butterflyChains`, `blasts`, `bombs` | **> 0** across a few runs |
| `comboLinks`, `combosFinished`, `knockdowns` | **> 0** across a few runs |
| `knockdownsArmed` / `knockdownsPaidOnLanding` | **both > 0, and equal** — a launched
  victim's debt was armed by the hit and collected by the floor. `knockdowns` alone
  cannot tell the arc-and-a-landing from a spike on the hit, and only one of those is
  the uppercut |
| `plungeCatches` | **> 0** when the runs include dives — a dive that never catches is a fancy fall |

The second row matters as much as the first. Every must-be-zero metric is
trivially satisfied by a build where melee never happens, so a run that reports
no violations *and no moves* is a failed run, not a passing one. Both of the
worst bugs found while building this — reactive blocking being impossible, and
the backstab firing on overlapping bodies — showed up as a **zero in the second
row while the first row was perfectly clean**.

**`parries` is the guard-break counter now.** Every guard that stops a sword
attack is a parry — there is no rewardless "blocked" tier left — so a run where
guards meet swings must show parries, and `parries: 0` beside a healthy
`blocks` says the guards are going up but the swings are not reaching them (or
everything that connects is a backstab, which ignores the guard by design).

`outcomeByMove` breaks the outcomes down per move, because a flat `parried: 0`
is ambiguous: it reads identically whether guards are failing or whether
everything that connected happened to be unblockable by design, and those need
opposite fixes.

**`comboLinks: 0` beside a healthy `slashes` is the signature of a chain nobody
can reach** — a link window too tight to hit, or a ground check that is never
true. It is also exactly what the metric was added to catch, since every
must-be-zero row stays clean in a build where the combo simply never happens.

Healthy ranges for one 8s AI-vs-AI match, as a sanity check rather than a
threshold: 10-20 slashes, 1-4 massives, 0-2 plunges, 1-8 uppercuts, 9-15 blocks,
3-9 parries, 0-2 blasts, 0-2 bombs, 0-5 backstabs, 2-12 butterfly chains.
**Backstabs outnumbering clean hits is a defect**, not a fight going well.

```bash
node scripts/diagnose.ts --mode=online --runs=3
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
