# Items

**Intent:** the kit has three members — melee weapon, ranged weapon, ultimate —
and the item is the fourth: a **finite, per-life resource** that every hero
carries. The ultimate is earned and spent; an item is *given* and hoarded.
Charges are the whole of the item: using one is a decision, because a new one
only arrives with a new life or a new round.

Like weapons, items are **not unique to a hero** — a future hero could carry
either of these. Like the ultimate, every use is a **server decision**: the
server owns the charges, the throw, the placement and the damage, and the
client learns of a use from the snapshot, exactly like a bullet. The one thing
the client *does* predict is a trap's effect, because the trap is a world
object whose trigger sets a timer both sides simulate.

## The button

**F** uses the item (rebindable, like every button). The uppercut and shoryuken
moved to **Space** to make room. The use is decided on the **press edge** — the
aim angle of the press *is* the throw, so there is no aim phase to hold through,
which is the whole difference from the ultimate's hold-to-release cast.

## Charges

- A fighter is granted the item's full kit (2 grenades, 3 traps, 2 smoke
  grenades) on respawn and on a round reset.
- A use spends one charge. Spent is spent: there is no partial refill and no
  passive gain.
- **Dying is the price of the next use.** A respawn grants the full kit again —
  and takes the dead fighter's traps off the floor with them, so a player cannot
  stack a fresh three on top of the three that just got them killed.
- A hero change mid-match resets the charges to the new hero's item.

## Lia: the HE grenade

Counter-Strike's HE, at this game's scale: a thrown projectile that **bounces**
off walls, the floor and the ceiling — keeping 55% of its speed each time —
and detonates on a hostile fighter it touches or when its fuse runs out, with
damage that **falls off linearly from the epicentre**.

| Stat | Value |
|---|---|
| Throw speed | 820 px/s |
| Grenade gravity | 900 px/s² (max range ≈ 750px, under a screen) |
| Fuse | 2500 ms (long enough to *bounce*) |
| Blast radius | 130 px |
| Damage | 45 at the epicentre, 0 at the edge |

- The thrower and their teammates walk out of their own blast — the friendly-fire
  rule is the same single predicate every weapon asks.
- The HE is **not deniable**. The sword guard catches the *ultimate's* grenade —
  the one exception this item deliberately does not have.
- It feeds the ultimate meter like a bullet: it is an ordinary weapon, and the
  Overwatch economy pays for participation.
- **It bounces.** A grenade that hits a wall or the floor reflects and keeps
  going, so a throw banked off a corner is a real play. A direct hit on a
  hostile fighter detonates on contact; geometry never does — the fuse is what a
  bounced throw spends. A grenade that has bounced down to a crawl settles on
  the floor and goes off where it stopped.

## Anands: the trap

A **landmine seen from the side** — a squat dome sitting on the floor. It is
**thrown**, not laid: the press hurls a canister out of the hand along the aim
angle, under its own gravity, and the moment it touches the floor it plants
into an armed mine at its landing spot. It is **visible to anyone** — the
seeing it is the whole of the counterplay, and an arc everyone can watch come
down is a louder warning than a mine already sitting there — and
**single-use**: nothing can destroy it before it springs, but the moment an
enemy's feet cross its patch it **bursts into particles and is destroyed**,
exactly like a Dota mine. A trap is either on the floor and armed or it no
longer exists.

- **The throw takes the thrower's momentum.** The canister's launch velocity
  is the throw plus the fighter's own velocity at the press, so a dash-throw
  or a throw out of a fall carries — momentum is the reward for throwing on
  the move, and a standing throw lands a step short of the aim. The canister
  flies under `TRAP_THROW_GRAVITY` and does **not** bounce: a wall or the
  ceiling scrubs the offending velocity and the canister slides down to plant
  at the wall's base. Only the floor ends the flight.
- **Airborne throws are legal.** The old grounded-only placement is gone: the
  charge is spent wherever the press finds the fighter, and throwing from the
  air is the move — a trap dropped from a double-jump plants at the feet
  below.
- **A mine honours its centre of gravity when it lands.** The canister's small
  box can catch a ledge's edge while the mine's centre hangs over empty space;
  there it does **not** plant — it slides off the edge and falls to a floor
  that actually holds it. A mine plants only where its centre sits over solid
  ground, so a trap never hovers half on, half off a ledge; once more than half
  of it overhangs an edge, gravity takes it. Both sides run the same code, so
  the dead-reckoned arc falls in exactly the place the server plants.
- **Friendly traps are faded.** Your own traps and every teammate's are drawn
  at a fraction of full opacity, so "whose side is this mine on" is answered at
  a glance and a friendly trap never does the worrying for you. An enemy's trap
  is full-strength until it springs.
- When an enemy's feet cross its patch, it **springs**: the victim is
  **rooted** for **3 seconds** — no walk, no dash, no jump — but everything else
  works. A rooted fighter can still attack, block, use their own items and cast
  their ultimate. It is a delay, not a disable; the counter is the timer, not a
  button.
- **The spring stops the victim dead.** The catch zeroes their velocity on the
  tick it lands, so a dash, tumble or lunge caught mid-flight loses its momentum
  right there — a caught fighter never slides out of the patch while the root
  runs. The burst state dies with the velocity: the airborne dash's flat line
  and the roll's reduced hitbox do not outlive the catch.
- **The root takes every voluntary movement.** Walking, dashing, tumbling and
  jumping are all gone for the full 3s — including a jump pressed *before* the
  catch: a buffered jump does not fire through the root, the press must be made
  again. Gravity and knockback still apply; only intent is discarded.
- **It counters the dagger's body-carrying moves.** The thrust and the shoryuken
  are the two moves that relocate the fighter, and the root has the feet: they
  will not start while the root holds, and one caught mid-lunge freezes in
  place — its swept box is the reach ahead of the frozen body, never the
  phantom arc the cast would have covered. The stab carries no body and still
  works, like every weapon that plays where the fighter stands.
- **It does not counter the dragon thrust.** The ride is not the feet: a rooted
  Anands can still cast her ultimate, and a rider caught as the trap springs
  keeps riding — the one voluntary movement the root lets through.
- The root is carried in `PlayerPosition.rootTimer`, set inside `tickPlayer` on
  **both** sides — the server's tick passes the same `trapFor`-filtered traps
  the client's prediction does, so the root is authoritative, not a client-side
  hope that the next snapshot erases. A caught fighter's own client reels
  exactly as the server says — the same prediction property the black hole's
  pull relies on. The trap's *consequences* — its destruction, the damage, the
  burst and the caption — are the server's alone.
- It deals a little damage (10) — not a kill tool, the reward for reading where
  somebody was going to stand, and the thing that makes a sprung trap read as
  having done something.
- The trap's trigger is a floor patch, not a bubble: a full jump clears it (the
  feet leave the radius); walking into it does not.
- Friendly fire: the owner and their teammates never trigger their own traps.

## The smoke grenade (Jeffs)

A thrown canister that pops into a **vision cloud** — the trap's structural
cousin: a server-placed world object, single-use, travelling in the snapshot in
full every frame. Where the trap *roots* and the HE *kills*, the smoke *lies*:
it changes what the enemy is allowed to know. See [jeffs.md](jeffs.md) for the
full kit; the rules here are the wire and the general item rules.

- **Two per life**, like the HE. The smoke hides — it does not hurt — so it is
  scarce, and spending one is a decision.
- **Thrown, then planted.** The canister arcs (700 px/s, gravity 900, 0.4
  restitution bounces) and blooms into a 200px cloud where its 900ms fuse runs
  out. The cloud is anchored there for **6.5s** and then dissipates.
- **Travels like a trap:** full state in the snapshot, both the canisters in
  flight (dead-reckoned like bullets) and the clouds themselves. There is
  nothing for the client to predict into `tickPlayer` — the cloud changes no
  simulation state — so this is pure world state for the renderer.
- **Per-side drawing is the whole feature.** Your own and your teammates'
  clouds are drawn nearly transparent; hostile clouds are full-strength. The
  side test is the one `sameTeam` predicate the trap's friendly-fade uses.
- **Ally smoke ghosts the people inside.** A fighter in a cloud belonging to
  their own side is faded almost out to anyone hostile to them — a ghost, with
  no shadow, no nameplate, no health bar. The local fighter ghosts too,
  standing in their own smoke, so the fade is the cue that they are invisible
  right now.
- **A dead Jeffs' clouds leave the floor with him**, exactly like traps:
  removed at respawn and at a round reset.
- The cloud affects vision only. No damage, no collision, no bullet block.

## The ROOTED! caption and burst

When a trap springs, the trap **bursts** (a teal particle pop at the victim's
feet) and a **ROOTED!** caption pops over the victim — the Jumanji register to
the DENY splash's Frank Miller: heavy, beveled, jungle-green. Both are events
(effect only), carried in the snapshot beside the denies; a dropped datagram
costs a caption, never the consequence, which is already in the victim's state.

## The trap on the wire

Traps travel in the snapshot **in full, every snapshot** — like the singularity,
because the client feeds them into `tickPlayer` for every fighter it predicts.
A trap in the list is armed; the server removes one the tick it springs, so
there is no spent state on the wire. Trap canisters in flight travel like HE
grenades — position + velocity, dead-reckoned by the client through the same
`tickTrapCanister` the server runs, so the arc plants in exactly the place the
server's does (the snapshot then shows the canister gone and an armed trap at
its landing spot). HE grenades travel like bullets. Smoke canisters travel like
HE grenades; smoke **clouds** travel in full every snapshot too — they are not
fed into `tickPlayer` (they change no simulation state), but the concealment is
re-derived from the list every snapshot, so a lost datagram costs a puff at
most and never a false clear. The `rooted` and `explosions` event lists are
one-shot effects, drained every snapshot.

## Bots

Bots play the item. Lia's brain throws the grenade at medium range with line of
sight; Anands' throws a trap at the feet of a nearby enemy, so the arc plants it
in the rush path. Both respect a cooldown so the finite resource is not dumped
in one exchange.

## Not implemented

- More than three items. The registry (`ITEMS` in `simulation/Items.ts`) is the
  single place a fourth is added.
- Items in the Play of the Game replay. The recorded frames do not carry the item
  world state, so a replay draws no traps, grenades or smoke — the same scope
  boundary the black hole's replay used to have.
- Items in the `?offline=true` escape hatch. There is no server to own the
  charges, so there are no items.
