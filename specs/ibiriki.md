# Ibiriki, the Bloodthirsty

**Intent:** a predator who gets *stronger the closer anyone is to dying*. Lia
reads, Anands takes the initiative, Jeffs ambushes — Ibiriki **hunts**. His
weapons are slow and heavy until the room starts bleeding, and then he is the
fastest thing in it. Bloodseeker from Dota 2, wearing a horned helmet.

The visual reference is his Gemini board and Tripo model: a round, chubby
green goblin-viking — a ball of a body, short legs, a horned iron helmet,
two blonde braids, brown leather gloves and boots, a scowl and **red eyes**.
He carries a **viking sword** and **throwing axes**. He is drawn from a
Blender model (`art/ibiriki/ibiriki.blend` — a Tripo mesh of his T-pose
turnaround; the sword and the axe were cut from his first, armed model by
Tripo's segmentation) on the same rig and clips as the other heroes, with a
heavy cartoon outline. His face is painted on the ball of his body, so the
chest turns him **near profile** — one eye leading, never both eyes staring
at the player while he runs sideways. See [heroes.md](heroes.md#the-art).

| | Ibiriki |
|---|---|
| **Melee** (sword stance) | Viking sword — slow heavy chain, the **Sunder** charge |
| **Ranged** (gun stance) | Throwing axes — charged ballistic throws, picked back up |
| **Ultimate** | **Rupture** — a global curse: whoever moves, bleeds |
| **Item** | Trap (shared with Anands) — a hunter's snare |
| **Passive** | **Bloodlust** — faster as the room bleeds; **Berserk** below 30% |

## The passive: Bloodlust

Ibiriki is always tracking the **weakest hostile fighter alive**, anywhere in
the room. Let `f` be that fighter's HP fraction.

- **Bloodlust** is `clamp((90% − f) / (90% − 30%), 0, 1)`: nothing while every
  foe is above 90%, full at 30% and below. It scales his **walk speed** (up to
  **+35%**) and his **attack speed** (up to **+30%** — every melee move's clock
  runs faster).
- **Berserk** is full bloodlust: some foe is **below 30% HP**. Berserk Ibiriki
  - **dual wields** — the sword in one hand, an axe in the other — and his
    attack button runs the **frenzy chain** instead of the hew chain (below);
  - takes **25% less damage** from everything;
  - is drawn with **glowing red eyes** and a **red aura**, so the whole room
    can see the predator has scented blood.
- The value is computed **by the server** every tick and travels in
  `PlayerPosition.bloodlust`, so both sides simulate the faster walk and the
  faster swings — a speed applied on top of predicted state would be erased by
  the next reconciliation. Between snapshots the client keeps the last value,
  which is a tiny mispredict on the tick it changes and nothing else.
- Only a hero whose kit declares the passive (`HeroKit.passive`) ever gets a
  non-zero value — the simulation reads the field, never the hero.
- Global by design: in a sixteen-fighter brawl somebody is always bleeding,
  and that is exactly when Ibiriki is supposed to be a menace.

## The viking sword (melee stance)

A heavier sword. Slower to start, bigger to land: **more damage and longer
hitstun than the katana**, so a hit is a stagger, not a flinch.

| Move | Startup | Active | Recovery | Damage | Hitstun | Notes |
|---|---|---|---|---|---|---|
| `hew` | 120 | 95 | 230 | 10 | 300 | chain link 1, cancellable into block |
| `hew2` | 120 | 95 | 230 | 10 | 330 | chain link 2, cancellable |
| `hew3` | 140 | 110 | 460 | 15 | 570 | finisher — knockdown 570 |
| `uppercut` | the sword's | | | | | the regular uppercut |
| `sunder` | 110 | 140 | 420 | 28 | 700 | the charged overhead — **crushes guards** |

- **The chain** is the sword's rule — both feet on the floor, a link from the
  previous one's recovery, cancels drop it — with Ibiriki's own three moves.
  Each link's hitstun is sized to the gap to the next link's hitbox (215ms at
  base speed), exactly as the slash chain's are.
- **Block** is the sword's guard: front-only, every sword hit it stops guard
  breaks the attacker. Ibiriki's guard-break reward is a free **Sunder**
  (fires on the next press, 4s to spend), the way Lia's is a free Massive.

### Sunder (hold attack)

Hold the attack button and Ibiriki raises the sword over his head; blood-red
motes stream into the blade while it fills. After **1000ms** it is armed, and
**releasing** brings it down top to bottom, leaving a trail of embers.

- **It goes through blocks.** A front guard does not stop it: the guard is
  **crushed** — the defender takes **40%** of the damage and a **450ms mini
  stun** with their guard knocked down, and Ibiriki is *not* guard broken.
  Unguarded, it lands the full 28 and a 700ms stagger.
- The hold roots his walk after 250ms like the Massive's charge, keeps the
  dash, jump and guard as delivery tools, and dies to a hit, a stance switch
  or a cast. Unlike the Massive there is no plunge: released in the air, the
  Sunder is just swung in the air.
- **Charge it out of reach, then walk it in.** The first tap of the hold is
  a hew, and a hew into a guard is guard broken like any sword swing — so
  the delivery is to start the hold from outside the defender's reach and
  carry the armed blade to them (walking returns once it is armed). The
  tutorial's drill and the bots' step-in (`SUNDER_STEP_RANGE_PX`) both do it
  this way.

### Berserk: the frenzy chain

While berserk, the attack button runs a different chain: **sword, axe, both**.

| Move | Startup | Active | Recovery | Damage | Hitstun |
|---|---|---|---|---|---|
| `rend` (sword) | 55 | 70 | 120 | 8 | 240 |
| `rend2` (axe) | 55 | 70 | 120 | 8 | 240 |
| `rend3` (both, X-cut) | 70 | 90 | 260 | 12 | 380 |

Fast, every hit a mini stun, and the third shoves the victim away. With the
bloodlust attack speed on top, a berserk Ibiriki out-swings anyone in the
game — the counterplay is to not be the low fighter, or to heal the one who is
by killing Ibiriki first.

## The throwing axes (gun stance)

**Five axes a life, no reload.** An axe stays where it lands — stuck in the
floor, a wall, a ledge — until Ibiriki **walks over it and picks it up** (one
axe back per pickup) or **dies** (every axe of his vanishes, and he respawns
with five).

- **Hold to charge, release to throw.** The charge (`throwChargeTimer`,
  shared state both sides tick) fills over **1200ms**; the release throws at
  the aim angle. The server throws on the release edge **whatever the
  stance reads that tick** — a release that lands on the tick a stance
  switch flips would otherwise eat the throw and its charge.
  | Charge | Speed | Damage |
  |---|---|---|
  | tap | 560 px/s | 14 |
  | full | 1180 px/s | 85 |
  Linear in between. Gravity is **1300 px/s²** for every throw, so a tap is a
  short lob and a full charge flies flat and far (~1000px at 45°).
- **A full-charge axe** flies wreathed in red embers, and it **crushes
  guards** like the Sunder: a blocker facing it takes 40% (34) and the 450ms
  mini stun. A part-charged axe is stopped by a front guard like a bullet.
  Unguarded, a full axe takes 85 of a 100 HP bar — almost a kill.
- Charging slows the walk to **75%** after 250ms (planting the feet for the
  throw). A stun, a stance switch or running out of axes drops the charge.
- **Axes are physical.** In flight an axe spins along a ballistic arc. It
  sticks into the first platform, wall or floor it meets. A fighter it hits
  takes the damage and the axe **drops** at their feet. Out of the world's
  sides it sticks at the edge.
- **Pickup:** Ibiriki's body within 30px of one of *his own* resting axes
  takes it back (ammo +1, capped at five). Nobody else can take them.
- The axes are server-owned world objects (like trap canisters), sent in
  full every snapshot while they exist.
- The HUD reads **axes in hand** (`4 AXES`), and DRY when none are left.

## The ultimate: Rupture

Hold **R**, release to cast. The room freezes for the usual 1100ms behind
Ibiriki's portrait card, then he **stomps the ground with both weapons
drawn** (650ms, rooted) and every hostile fighter alive is **ruptured** for
**6 seconds**:

- **Moving hurts.** Every pixel a ruptured fighter's body travels costs
  **0.09 HP** — walking for a second is ~20 damage, a dash ~15, a jump and
  landing ~25. Standing still costs nothing. Knockback, falls and black-hole
  pulls count: it is the *body* that moved, not the input.
- The cast deals **5** on application.
- It is **global**: no aim, no radius, no line of sight. Every hostile alive
  at the release is caught; a victim who dies is freed; it keeps running if
  Ibiriki dies.
- It pays nobody: the rupture never feeds the meter, like every ultimate.
- It cannot be guarded or denied once cast — the deny is killing Ibiriki
  while he holds R.
- Ruptured fighters drip blood as they move, and the local victim sees a red
  vignette and **DON'T MOVE** — a tense six seconds is the whole point.
- `ULT_CAP` 100, the shared economy.

Bots understand it: a ruptured bot plants its feet and only swings at what
is already in reach.

## Bots

Ibiriki's brain is a melee duelist (the sword module drives the hew chain and
the Sunder), throws charged axes at range with a solved lob, walks back over
its resting axes when it runs low, and casts Rupture when two or more foes
are alive or one is low and fleeing.

## Not implemented

- A per-hero collider: Ibiriki collides as 32x48 like everybody.
- Axes that bounce. An axe sticks or drops; it never ricochets.
