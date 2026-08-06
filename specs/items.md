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

- A fighter is granted the item's full kit (2 grenades, 3 traps) on respawn and
  on a round reset.
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

A floor hazard laid one step in front of the fighter — a **landmine seen from
the side**, a squat dome sitting on the floor. It is **visible to anyone** — the
seeing it is the whole of the counterplay — and **single-use**: nothing can
destroy it before it springs, but the moment an enemy's feet cross its patch it
**bursts into particles and is destroyed**, exactly like a Dota mine. A trap is
either on the floor and armed or it no longer exists.

- **Friendly traps are faded.** Your own traps and every teammate's are drawn
  at a fraction of full opacity, so "whose side is this mine on" is answered at
  a glance and a friendly trap never does the worrying for you. An enemy's trap
  is full-strength until it springs.
- When an enemy's feet cross its patch, it **springs**: the victim's mobility is
  locked for **3 seconds** — no walk, no dash, no jump — but everything else
  works. A trapped fighter can still attack, block, use their own items and cast
  their ultimate. It is a delay, not a disable; the counter is the timer, not a
  button.
- The lock is carried in `PlayerPosition.trapTimer`, set inside `tickPlayer` on
  both sides, so a caught fighter's own client reels exactly as the server says
  — the same prediction property the black hole's pull relies on. The trap's
  *consequences* — its destruction, the damage, the burst and the caption — are
  the server's alone.
- It deals a little damage (10) — not a kill tool, the reward for reading where
  somebody was going to stand, and the thing that makes a sprung trap read as
  having done something.
- The trap's trigger is a floor patch, not a bubble: a full jump clears it (the
  feet leave the radius); walking into it does not.
- Friendly fire: the owner and their teammates never trigger their own traps.

## The TRAPPED! caption and burst

When a trap springs, the trap **bursts** (a teal particle pop at the victim's
feet) and a **TRAPPED!** caption pops over the victim — the Jumanji register to
the DENY splash's Frank Miller: heavy, beveled, jungle-green. Both are events
(effect only), carried in the snapshot beside the denies; a dropped datagram
costs a caption, never the consequence, which is already in the victim's state.

## The trap on the wire

Traps travel in the snapshot **in full, every snapshot** — like the singularity,
because the client feeds them into `tickPlayer` for every fighter it predicts.
A trap in the list is armed; the server removes one the tick it springs, so
there is no spent state on the wire. HE grenades travel like bullets (position
+ velocity, dead-reckoned by the client through the same bounce the server
runs). The `trapped` and `explosions` event lists are one-shot effects, drained
every snapshot.

## Bots

Bots play the item. Lia's brain throws the grenade at medium range with line of
sight; Anands' lays a trap in the path of a nearby enemy. Both respect a cooldown
so the finite resource is not dumped in one exchange.

## Not implemented

- More than two items. The registry (`ITEMS` in `simulation/Items.ts`) is the
  single place a third is added.
- Items in the Play of the Game replay. The recorded frames do not carry the item
  world state, so a replay draws no traps or grenades — the same scope boundary
  the black hole's replay used to have.
- Items in the `?offline=true` escape hatch. There is no server to own the
  charges, so there are no items.
