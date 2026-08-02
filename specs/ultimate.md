# The Ultimate: Black Hole Grenade

**Intent:** one button that changes the shape of a fight. It is earned slowly,
spent in an instant, announced to everybody in the room, and it can be thrown
away on a bad angle. The reward is not the damage — it is that four fighters
stop being able to move while you and everyone you are not fighting cut them
apart.

Three references, deliberately: **Overwatch** for how it is earned and how it is
announced, **Dota 2's Enigma** for what the field actually does, and **Zarya's
Graviton Surge** for the fact that it is a *thrown* thing you can miss with.

## The shape of it, in order

1. A fighter's **ult meter** fills, from damage they deal and from a slow
   passive trickle. At 100 it is armed and the meter says so.
2. They press **R** (or the pad's ultimate button). The meter must be full and
   they must be alive, upright and not mid-swing.
3. **The whole room freezes for 1100ms** and every client draws the caster's
   portrait, their name, and the ability's title. Nobody can act; the match
   clock does not advance.
4. The freeze ends and the **grenade launches**, along the angle the caster was
   aiming at the instant they pressed. It arcs under its own gravity.
5. It **detonates** on a platform, on an enemy fighter, or when its fuse runs
   out — into a **singularity** that lasts 2200ms.
6. Everyone inside the event horizon, **except the caster**, is dragged to the
   centre, held completely still, and damaged four times a second.

## Earning it

The Overwatch model: charge is a currency you are paid for participating.

| Source | Rate |
|---|---|
| Passive trickle | **1.4 charge/s** while alive |
| Damage dealt to another fighter | **0.8 charge per point** |
| A kill | **12 charge** |

- The meter is **0..100**. It is **server-owned** — the client displays it and
  never decides it, because charge is paid out of damage and only the server
  knows a hit landed.
- **Death does not spend it.** Carrying an ult through a respawn is what makes
  it a plan rather than a lottery ticket, and it is what Overwatch does.
- **A match reset zeroes it**, along with the scores.
- Idling alone reaches 100 in ~71s. Landing a full kill's worth of damage
  (100 HP) is worth 80 on its own, so a fighter who is actually fighting arms
  roughly every 35-50s.
- The passive is paid **only while alive**, so being dead is not a way to farm.

## Casting

The cast is an ordinary button in `PlayerIntent` — `ultimate` — and it travels
on the wire like every other button. **The server is the only thing that
decides a cast happened**, exactly as it is the only thing that decides a bullet
was fired. The client predicts nothing about it.

A cast is refused, silently, unless all of:

- charge is at 100,
- the fighter is alive,
- the match phase is `live`,
- the fighter is not stunned or knocked down,
- **no cinematic is already running** — two ultimates cannot overlap, and the
  second presser keeps their charge,
- **no singularity is already open.** One hole at a time in a room. The second
  one would have to argue with the first about which way a fighter is pulled.

On a successful cast the charge is spent **immediately**, before the cinematic,
so a caster who disconnects mid-freeze cannot come back armed.

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
angle recorded when they pressed. That ordering is the whole risk: the cinematic
tells the room a black hole is coming, and *then* it has to be thrown well.

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
| Duration | **2200ms** |
| Damage | **5 per 250ms** — 40 over a full hold |
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
- **Damage is server-side**, on the server's clock, credited to the caster. It
  therefore feeds their ult charge and gives them the kill.
- **One singularity per room.** See the cast conditions.

## No friendly fire

The caster is immune to their own hole: no pull, no stun, no damage, and the
grenade passes through them. Everyone else in the room is a target, because
deathmatch has no teams.

**The exclusion is a predicate, not a scattering of `if` statements.** Every
side asks the same question — "is this field hostile to this fighter?" — and the
answer today is `fighter.id !== field.ownerId`. A team mode changes that one
function and nothing else.

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
ultimate re-arms the instant it is spent, which turns a minute of waiting into a
practice range: the throw is a lob with a 707px ceiling and an arc you have to
choose, and learning it against a meter that fills once a minute is not
learning it. It cannot be used to spam, because a cast is refused while a hole
is already open.

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
  damaged for exactly a full hold's 40 — with the caster standing inside the
  same hole taking nothing.

`--no-cast` runs the first scenario with the button never pressed. That control
is load-bearing: the probe's first prediction metric read 4.5px of rollback
error after a cast and looked exactly like the pull leaking outside
`tickPlayer`, and the control showed the same number with no ultimate at all.

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

- Teams, and therefore any friendly fire beyond excluding the caster.
- More than one ultimate. `ultimate` is one action, not a per-character slot.
- Per-character portraits: every fighter uses the same sheet, so the portrait
  is tinted by a hash of the fighter's id to keep two casters distinguishable.
