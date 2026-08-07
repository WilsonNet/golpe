# The Ultimate

**Intent:** one button that changes the shape of a fight. It is earned slowly,
spent in an instant, announced to everybody in the room, and it can be thrown
away on a bad angle. The reward is not the damage — it is that four fighters
stop being able to move while you and everyone you are not fighting cut them
apart.

**An ultimate is the one thing that is always unique per hero.** The meter
economy below is shared by every hero; what the meter spends is the hero's
own. Lia's ultimate is the **Black Hole Grenade** specified here. Anands'
ultimate is the **dragon thrust** — a ride, not a throw — specified in
[anands.md](anands.md). The cast button, the hold-to-aim release-to-cast
gesture and the meter are the same for both; only the geometry that comes out
differs, and the aim preview shows the hero's own shape (the grenade's arc or
the dragon's straight beam).

Three references, deliberately: **Overwatch** for how it is earned and how it is
announced, **Dota 2's Enigma** for what the field actually does, and **Zarya's
Graviton Surge** for the fact that it is a *thrown* thing you can miss with.

## The shape of it, in order

1. A fighter's **ult meter** fills, from damage they deal and from a slow
   passive trickle. At 100 it is armed and the meter says so.
2. They **hold R** (or the pad's ultimate button). While the button is held the
   meter is full and nothing forbids a cast, the fighter **aims with a special
   arc** — the grenade's own ballistic trajectory traced from the chest, ending
   where the hole will open. The meter must be full and the fighter must be
   alive, upright and not mid-swing.
3. They **release R**. That release is the cast: charge is spent, **the whole
   room freezes for 1100ms** and every client draws the caster's portrait,
   their name, and the ability's title. Nobody can act; the match clock does
   not advance.
4. The freeze ends and the **grenade launches**, along the aim angle recorded
   at the release. It arcs under its own gravity.
5. It **detonates** on a platform, on an enemy fighter, or when its fuse runs
   out — into a **singularity** that lasts 4400ms. Unless a sword guard
   **denied** it first, which is rule 0 and is described below.
6. Everyone inside the event horizon, **except the caster**, is dragged to the
   centre, held completely still, and damaged four times a second.

The hold is the risk in reverse: the thrower gets a preview of the exact arc
for free, and the room gets the cinematic *before* the grenade flies — so
everybody who is not throwing sees the black hole coming and has the whole
flight to get out of its way. Aiming happens while the screen is clean; the
announcement happens when aiming is already done.

## Earning it

The Overwatch model: charge is a currency you are paid for participating.

| Source | Rate |
|---|---|
| Passive trickle | **0.35 charge/s** while alive |
| Damage dealt by a bullet | **0.2 charge per point** |
| Damage dealt by a sword | **0.4 charge per point** — the sword pays double |
| A kill | **3 charge** |

- The meter is **0..100**. It is **server-owned** — the client displays it and
  never decides it, because charge is paid out of damage and only the server
  knows a hit landed.
- **The meter is won by hits, and the ultimate is the one weapon that cannot
  pay.** The hole's damage feeds nobody: no charge for the caster, no kill
  bonus for a hole that scores. A caster whose own hole paid them would never
  have to land a sword hit again, and a hold that rearmed itself would be an
  infinite loop wearing a cinematic. Sword and gun only.
- **Death does not spend it — except the one death that is a deny.** Carrying
  an ult through a respawn is what makes it a plan rather than a lottery
  ticket; dying *while holding the button* is the aim phase's risk, and that
  death throws the whole meter away (see *Denying it*).
- **A match reset zeroes it**, along with the scores.
- Idling alone reaches 100 in ~285s — longer than a match. Landing a full
  kill's worth of damage (100 HP) is worth 20, so a fighter who is actually
  fighting arms roughly every 3-5 minutes of fighting.
- The passive is paid **only while alive**, so being dead is not a way to farm.

## Casting

The cast is an ordinary button in `PlayerIntent` — `ultimate` — and it travels
on the wire like every other button. **The server is the only thing that
decides a cast happened**, exactly as it is the only thing that decides a bullet
was fired. The client predicts nothing about it.

**The cast is decided at the release, not the press.** The button is held state
like every other, and the server edge-detects the *release*: a press that fired
early would throw the grenade before the player finished aiming. The hold in
between is the aim phase — the arc is a client-side preview, and the simulation
never learns it was shown. The aim angle used is the one the last held input
carried, so a release frame with no angle (scripted input, a dead zone) cannot
turn the throw into a guess.

A cast is refused, silently, unless all of:

- charge is at 100,
- the fighter is alive,
- the match phase is `live`,
- the fighter is not stunned or knocked down,
- **no cinematic is already running** — two ultimates cannot overlap, and the
  second release keeps their charge,
- **no singularity is already open.** One hole at a time in a room. The second
  one would have to argue with the first about which way a fighter is pulled.

On a successful cast the charge is spent **immediately**, at the release,
before the cinematic, so a caster who disconnects mid-freeze cannot come back
armed.

## The cinematic freeze

**1100ms in which the room does not simulate.**

This is the one place a frame freeze is allowed, and it is allowed only because
it is nothing like hitstop. See [netcode.md](netcode.md) for the full argument;
the short version:

- **The server declares it.** It is not a local decision a client makes on an
  impact it saw. Every client freezes because the snapshot told it to.
- **Nothing is simulated by anybody.** The server advances no fighter, consumes
  no input and marks every fighter's `input` as `null` in the snapshot; a client
  that sees the cinematic stops running fixed steps entirely, so it sends no
  input and predicts no remote.
- **The client is exactly as far ahead when it ends as when it started.** It
  freezes when the message reaches it and unfreezes when the next one does, so
  its lead over the server is unchanged across the whole event. The handful of
  inputs already in flight park in the server's queue and are consumed on the
  far side. Nothing is dropped, so nothing diverges.
- Bullets, grenades, the singularity, respawn timers and the match clock all
  stop with everything else. A cinematic costs nobody match time.

What is drawn during the freeze is a client-side matter: particles, the portrait
overlay and the camera keep running on wall-clock time, because none of them
are ever read back by the simulation.

## The grenade

Launched at the **end** of the freeze, from the caster's chest, along the aim
angle recorded at the **release** of the button. The cinematic happens *between*
the aim and the flight, which is what gives the room its dodge: the freeze
announces the black hole, and the grenade is only then in the air — a visible
lob every other fighter has the whole arc to run from. The thrower had their
clean look at the arc while holding the button, so nothing about the freeze
obstructs the aim.

- Speed **780 px/s**, gravity **860 px/s²** — a lobbed arc, much lighter than a
  falling fighter.
- **Maximum range 707px**, which is `v²/g` and therefore not a separate knob: it
  is the range of a 45° throw, and the two numbers above were chosen to produce
  it. A little under one 800px screen, so a committed high lob crosses a screen
  and a flat one does not — choosing the arc *is* the skill. The first tuning
  (620 at 900) gave 427px and made the ability quietly unusable at any normal
  fighting distance: the throw obeyed the cursor perfectly and fell short.
- Fuse **1400ms**.
- It detonates when it **touches a platform**, when it **touches a fighter that
  is not the caster**, or when the **fuse expires**. All three produce the same
  singularity; there is no "good" detonation.
- It **fizzles** — no singularity at all — if it leaves the world through the
  top, which is the only open edge. That is the miss you have to work for.
- A detonation point outside the arena is **clamped to the boundary**. A grenade
  that leaves through a side wall detonated where it was last seen, which put
  the hole's centre outside the world — half of it drawn off-screen and still
  reaching 128px into the room. The wall is where it hit, so the wall is where
  it opens.
- It is a **server-owned projectile**, like a bullet: the server simulates it,
  the snapshot carries it, and clients only draw it.
- **It does not collide with the caster.**

## The singularity

Enigma's Black Hole, scaled to an 800x600 arena and a 32x48 fighter. Dota's
inner radius is roughly 3.3 fighter-heights; so is this one.

| | |
|---|---|
| Event horizon | **168px** radius |
| Outer reach | **260px** radius |
| Duration | **4400ms** |
| Damage | **7 per 250ms** — 123 over a full hold |
| Draw-in speed | **260 px/s**, at **1400 px/s²** |
| Fringe tug | **520 px/s²** at the horizon, falling to zero at the outer reach |

Two bands, and the difference between them is the counterplay:

- **Inside the event horizon you are caught.** Gravity stops applying, steering
  does nothing, and you are reeled toward the centre. You are stunned for as
  long as you are inside plus a **60ms** tail, so a swing you had started is
  cancelled and you cannot act until slightly after the hole lets go. This is
  Dota's full disable, and like Dota's it is not a soft slow you can walk out
  of.
- **Between the horizon and the outer reach you are only pulled.** Gravity,
  steering, jumping, dashing and swinging all still work — the tug is an
  acceleration you fight, strongest at the horizon and zero at the edge. A dash
  (1000 px/s) beats it comfortably; walking (220 px/s) does not, near the lip.

Other rules:

- **Collision still applies.** Nobody is dragged through a wall. A hole opened
  against a ledge pins its victims against the ledge.
- **The pull is in the simulation, not applied on top of it.** It is an argument
  to `tickPlayer`, so it replays through reconciliation and rollback like
  gravity does — a pull bolted onto predicted state would be erased by the next
  snapshot, which is the same mistake the dash made once already.
- **Damage is server-side**, on the server's clock, credited to the caster.
  **It feeds nobody's meter** — not the caster's, and not a kill bonus either —
  because the ultimate is the one weapon that cannot pay for itself. A fighter
  caught for the whole 4.4s takes 123; the *cage* is the reward, the weapons
  that finish the job are everyone else's, and those still pay.
- **One singularity per room.** See the cast conditions.

## Denying it

**An ultimate can be taken away, and the takedown is loud.** Two ways, one
result: the meter is gone (it was spent at the cast; a deny does not refund
it), no hole opens, and the fighter who did it gets a comic-book **"DENY"**
caption popped over their head — heavy italic type, off-angle, the way a comic
caption announces that somebody's big moment just got taken.

**Kill while holding.** The hold is the aim phase, the fighter's most
committed moment, and dying in it is the risk that commitment was always
carrying: the whole meter is lost. If the death had a killer, the killer is
the denier and gets the caption; a fall or the arena denies in silence, but
the meter is still gone.

**Block the throw.** The sword guard is the universal counter to ultimates —
"most ultimates this game will ever have arrive as something the guard can
get in front of." For the black hole that something is the grenade: a
defender who is **blocking, facing the throw** catches it like a bullet
(the same rule as `blocksBullet`), the grenade is destroyed, no singularity
opens, and the blocker gets the caption. The caster's own meter was spent at
the release, so a blocked ultimate is simply *gone* — the deny is not a
refund, it is an execution. The guard only covers the front, so the answer to
a defender camping the throw lane is the same as the answer to a guard
anywhere: go around it, or make them use their sword on something else.

The deny is a **one-shot event in the snapshot** (`denies`), exactly like a
melee impact: the consequence travels in the meter, and a client that loses
the datagram loses a caption, never a fact.

## The other ultimates

The black hole is Lia's. The **dragon thrust** (Anands) is specified in full in
[anands.md](anands.md); the **Death Blossom** (Jeffs) in
[jeffs.md](jeffs.md). All three share the earn economy, the hold-to-release
cast, the 1100ms cinematic freeze and the "ultimate pays nobody" rule; they
differ in what the release does — a lob, a ride, or a self-centred storm.

## No friendly fireThe caster is immune to their own hole: no pull, no stun, no damage, and the
grenade passes through them. In **team deathmatch the caster's whole side is
immune** on the same terms; in a free-for-all everybody else is a target.

**The exclusion is a predicate, not a scattering of `if` statements.** Every
side asks the same question — "is this field hostile to this fighter?" —
`fieldAffects(field, id, team)`, which is the caster test plus the shared
`hostile()` from `simulation/Teams.ts`. That was the point of writing it as one
function, and adding teams touched it and the grenade's contact test and nothing
else.

**The side travels on the field itself** (`Singularity.ownerTeam`), not looked up
per fighter: the client feeds this object straight into `tickPlayer` for
everybody it predicts, including through replays, and a lookup would make the
pull depend on a roster that arrives on a different message. It is copied from the
grenade when the hole opens, so a caster who leaves the room mid-flight does not
leave a hole that has forgotten whose side it was on.

## What it costs a client to be wrong

The singularity's position never changes and its owner never changes, so the
only thing a client can disagree with the server about is *whether it is still
open*, and only by the latency skew (a few ticks at the very end of its life).
That is a few pixels of pull, absorbed by the render smoother like any other
correction. Deliberately: a field whose *strength* varied over time would make
every replayed tick a different tick, and reconciliation would never settle.

## Practising it

**`?ultCharge=N`** sets a *floor* on everybody's meter in a freshly created room
— creator-only, like the shortened match rules and the screen count. At 100 the
ultimate re-arms the instant it is spent, which turns ~285s of waiting into a
practice range: the throw is a lob with a 707px ceiling and an arc you have to
choose, and learning it against a meter that fills once a match is not learning
it. It cannot be used to spam, because a cast is refused while a hole is already
open.

It is honoured in the **training room** too, which is where it is most useful —
a dummy standing 60px away on clear ground, and a hole you can open on it as
often as you like.

## Measuring it

`node scripts/ultimate-probe.mjs`. Nothing else in the harness can see this
feature: AI vs AI never presses the button, so the ordinary diagnostic and the
deathmatch probe both run whole matches in which the ultimate does not exist.

Two scenarios, because the feature asks two questions:

- **A two-client deathmatch room** for the netcode: that a cast freezes *both*
  clients for the length the server declared and unfreezes both, that one hole
  opens at one position on both, and that the client whose own fighter is being
  dragged still reconciles to ~0px.
- **A training room** for the capture: a dummy 60px away, caught, held and
  damaged across the whole 4.4s hold — with the caster standing inside the
  same hole taking nothing. (The deny rows live in the training battery: a
  block that catches the grenade, and a kill mid-hold that throws the meter
  away.)

`--no-cast` runs the first scenario with the button never pressed. That control
is load-bearing: the probe's first prediction metric read 4.5px of rollback
error after a cast and looked exactly like the pull leaking outside
`tickPlayer`, and the control showed the same number with no ultimate at all.

## Bots cast it too

`EnemyBrain`'s `UltimateBrain` holds and releases like a player: it aims a
solved lob (the throw angle that lands at a given offset is a quadratic, solved
in `lobAngle`), holds the button briefly, and lets the release cast. When it
casts is the strategy: a cluster of two or more enemies, an enemy at the team's
line, a support being rushed (the point-blank throw detonates on contact), an
outnumbered fight, a killshot — and a **patience rule**: an ultimate held ready
for ten seconds is spent on the nearest enemy it can still reach, because a
meter that never empties is a weapon that does not exist.

**The brain is gated on the cinematic freeze, exactly like the fixed steps.**
The server's bots decide inside `fixedTick`, which the cinematic skips; a
client brain that kept deciding through a freeze held and released while no
input could leave the client, and every cast was silently swallowed. The freeze
is the one moment a bot's own ultimate cannot happen, so it waits it out.

## Controls

- **R** by default, and **Pad1** (the right-hand face button, B/Circle).
- Rebindable like everything else — it is an ordinary action in `ACTIONS`, so
  the Esc → Controls dialog lists it and the on-screen deck carries a button for
  it. See [controls.md](controls.md).
- The deck's ultimate button is drawn **only when the meter is full**, because a
  phone screen has no room for a button that does nothing.

## What is drawn

The renderer's job, none of it authoritative:

- **The meter**, bottom-centre, filling; a pulse and a colour change at 100.
- **The aim arc**: while the ultimate button is held and a cast is legal, the
  grenade's own trajectory drawn from the caster's chest — the same speed,
  gravity and fuse the simulation will use, stopped where the grenade would
  stop, with a larger dot where the hole will open. The dragon previews the
  same way with a straight beam along the ride's line; the blossom previews
  with a **pulsing ring at the blast radius**, because for a radial ultimate
  the radius is the information. Drawn from the *drawn*
  position like the nameplates, and a pure preview: nothing about it is read
  back. It appears only when the hold can actually cast, so an arc shown for a
  cast that will be silently refused is never shown.
- **The charge aura**: while the ultimate button is held and a cast is legal,
  violet energy sheets upward around the whole fighter — the same violet as
  the arc, so the glow and the throw are recognisably one ability. It is drawn
  on whichever fighter is holding the button: the caster's own client draws it
  from its live input, and every other client draws it from the input the
  server echoed for that fighter, so the room sees the charge-up coming and
  has the whole hold to react — the hold's risk, paid in advance. Like the
  arc, it appears only when the hold can actually cast, so an aura on a
  fighter with an empty meter is never shown.
- **The cinematic**: the caster's portrait in a frame, their name on a plate
  under it, the ability title, and a collapsing-star motif. Drawn by the React
  overlay, because it is a dialog and the canvas is the wrong tool for one.
- **The grenade**: a dark core with a violet corona and a trail that falls
  behind it.
- **The detonation**: a hard white flash, a shockwave ring, a debris burst and a
  heavy screen shake.
- **The singularity**: a black core, a counter-rotating accretion disk, a
  lensing ring, matter streams spiralling inward from the whole outer reach, and
  a per-victim stream of torn-off particles. This is the most expensive effect
  in the game and it is meant to be.

## Not implemented

- Any friendly-fire relationship other than "the caster and their side". No
  allied casters sharing a hole's credit, no team-coloured horizon beyond the
  light tint the mode applies to everything.
- More than one ultimate. `ultimate` is one action, not a per-character slot.
- Per-character portraits: every fighter uses the same sheet, so the portrait
  is tinted by a hash of the fighter's id to keep two casters distinguishable.
