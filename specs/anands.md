# Anands, the Dagger

**Intent:** a storm of stabs and a committed lunge, with no guard at all. Where
Lia's sword reads and blocks, Anands *takes the initiative* — her Shift is not a
guard but the **thrust**, a dash that knocks down everyone in its path, and her
F is a rising **shoryuken** that reaches into the air. The kit is the mirror of
the weapon: the dagger is light, so everything it does is faster than the
sword's answer and weaker per hit; the lack of a block is paid for by the
thrust being unblockable; and the ultimate is the thrust's full expression — a
**dragon thrust** in any direction that nothing stops but an obstacle or a
black hole.

Luca from Chrono Trigger was the original visual reference; the sheet is now
the artist's own hand-drawn art, composed into the game's sheets by
`scripts/make-anands-art.py` from the reference boards in
`unprocessed-sprites/`. Anands is the first hero whose sprites are not
generated pixel art: purple hair and cap, teal goggles, olive green shirt,
brown backpack, dark trousers and purple boots. Her sheets have their own
cell geometry and her clip table is her own — see [the art budget](#the-art-budget).

## The dagger (melee stance)

The dagger has **no block**. The Shift button is the thrust. This is the whole
design: everything a guard does for Lia — stop a slash, stop a bullet, deny an
ultimate — is simply absent here, and the dagger's answer is to hit first.

| Move | Startup | Active | Recovery | Total | Damage | Reach | Blockable | Cancellable |
|---|---|---|---|---|---|---|---|---|
| **Stab** | 45ms | 55ms | 90ms | 190ms | 5 | 30px | **yes** | **yes** |
| **Thrust** | 260ms | 140ms | 480ms | 880ms | 16 | sweep, ~109px | **no** | **no** |
| **Shoryuken** | 90ms | 140ms | 320ms | 550ms | 8 | 62px, tall | **yes** | **no** |

On hit:

| Move | Hitstun | Knockback | Knockdown |
|---|---|---|---|
| Stab | 140ms | 90 px/s | — |
| Thrust | 1500ms | 240 px/s | **1500ms** |
| Shoryuken | 700ms | 120 px/s | **700ms** |

**Why these hold:**

- **The stab is the spam.** 190ms total against the slash's 330ms, 5 damage
  against 7. It is fast enough to punish the gap between a sword wielder's
  swings — a dagger in range *interrupts* — and weak enough that trading with
  the sword still loses. It is cancellable into the thrust and a stance switch,
  exactly as the slash cancels into a block.
- **The stab is blockable**, and every block of a sword attack is a guard
  break: a sword defender who reads the spam stops it cold, breaks the dagger
  for a full second and collects a free Massive. The spam has an answer, which
  is what forces the dagger to mix in the thrust.
- **The thrust is the dagger's identity.** The 260ms anticipation is the whole
  counterplay: the dash is a flat line at the height it started, so a foe who
  jumps during the wind-up is over the line when it arrives. What the
  anticipation buys is the rest of the move: unblockable, unparryable, hitting
  **everyone in the path** (the one melee move that does), and knocking them
  down for a full second and a half. The dash carries **780 px/s for 140ms —
  about 109px**, 60% of its original 1300 px/s lunge: a thrust still closes
  the gap a stab cannot, but the reads that used to land from two body-widths
  away must now be walked in, and a whiffed lunge is easier to punish — the
  range *is* the trade the move was balanced around. The 480ms recovery is the
  cost
  of that power and the thing that keeps thrust spam honest: a whiff is a
  walk-in, and back-to-back thrusts are a choice a foe can punish, not a
  rhythm to lean on. It does not fall in the air — `selfVx`
  pins the dash like a dash pins its line — so an airborne thrust is a flat
  lunge across the arena.
- **The shoryuken is an anti-air with a gate.** Its hitbox starts 60px above
  the head, runs 112px tall and reaches a wide 62px in front of the body —
  nearly double the stab's 30 and the sword uppercut's 34 — and the move
  rises at a constant `selfVy`, so it catches a jumping foe. The width is the
  point: a box that only reached 34px whiffed everything but a point-blank
  jump-in (one hit from three swings in a measured AI duel), so the anti-air
  reach is the widest of any melee box in the game. It is **not a third
  jump**: it only fires while the second jump is still in hand
  (`airJumps > 0`), so a fighter who double-jumped has spent its vertical
  options. And it is **blockable** — unlike the sword's uppercut —
  with the game's **short knockdown: 700ms** (`ANTIAIR_KNOCKDOWN_MS`), the same
  floor time the sword's uppercut pays on the landing, and well under the
  thrust's second and a half. Two anti-airs, one number: they are the same
  *answer* — a foe who chose the air — wearing different weapons, and one being
  a harder knockdown than the other would be an accident of the kit table. The
  trade for a knockdown that lands is that a read guard stops it. **The one
  thing the anti-air loses to is the plunge bomb**: the dive is immune to melee,
  and the shoryuken's own launch puts its user in the dive's column — a
  shoryuken into a dive is a shoryuken into a ride down (see
  [melee.md](melee.md#the-catch--the-dive-carries-its-victims)). The dagger
  reads the dive as distance, not as a jump-in.
- **The double-tap dash is the dagger's own**: a little faster than the
  sword's (1100 vs 900 px/s), a little shorter, ready a little sooner. The
  difference is a feel, not a gap the sword cannot close — the thrust is where
  the dagger's real speed lives.

## The machine gun (gun stance)

The gun stance's weapon is the machine gun: **110ms** between shots, **5**
damage per round, **780** px/s bullet speed — against the rifle's 250ms / 10 /
600. The dagger is the lightest weapon in the game and its ranged answer is a
stream, not a poke: four shots where the rifle fires one, each worth half. It
carries a **30-round magazine** whose whole-magazine **clip reload** takes
**1860ms** — a burst long enough to matter, a pause long enough to punish (see
[combat.md](combat.md)
for the reload rules every weapon shares). The
per-shot charge rate is the same per point of damage, so the meter does not
care which weapon dealt it — only the melee multiplier does, and a stab is
melee like a slash.

## The dragon thrust (ultimate)

The thrust's full expression: a ride, in any direction, that nothing stops but
an obstacle or a hostile black hole.

- **Casting:** hold R to aim — the preview is a **straight beam** along the
  angle (the grenade's arc is Lia's geometry; the dragon flies a line, and the
  preview must show the actual path) — release to cast. **Every ultimate gets
  the announcement**: the same 1100ms freeze and portrait card the black hole
  has, because a cast the room is not told about is a cast the room cannot
  react to. The freeze ends and the ride launches along the angle recorded at
  the release.
- **The ride:** the caster becomes cargo on the dragon's line — `dragonTimer`,
  `dragonVX/Y` in state, velocity pinned, gravity suppressed, intent discarded.
  It flies at **1500 px/s** for up to **900ms**, and it stops at the first
  obstacle: a wall, the ceiling, or a floor met while moving downward. The
  range *is* "until it is blocked".
- **The commitment:** a cast is **never zero ticks long**. An obstacle the
  launch direction meets *immediately* — a grounded caster releasing into the
  floor, a fighter aimed into the wall at their back, a launch under a low
  ceiling — is already a contact at the launch, so the ride must outlive its
  first tick: the dragon always shows the lunge and the start of the flight
  (**200ms**, two strip cells) before the obstacle claims it. Without it the
  launch would end on its own first tick, and a spent ultimate that showed
  nothing at all read as "the dragon did not fire" — the floor is exactly
  where an Anands player's cursor rests between fights. The aim preview draws
  the same commitment, so the beam never stops earlier than the cast
  delivers.
- **The hit:** everyone on the swept line is hit once per cast — **30 damage**,
  a **650 px/s knockback along the dragon's direction**, and a brief 300ms
  stun so the shove reads. It goes **through sword blocks**: `blocksUltimate`
  exists for thrown ultimates, and this is a ride, not a throw. The ultimate
  pays nobody — its damage feeds no meter, exactly like the hole.
- **The one counter:** a **hostile black hole**. Being caught cancels the ride
  and the hold takes over on the same tick — it is the only thing that stops a
  dragon early, and the aim preview is deliberately allowed to show a cast
  into an open hole, because throwing the dragon into one is a real decision.
- **The draw:** the caster's own art carries her — the six-cell ride strip
  from `anands-dragon.png` (the lunge into the dragon, then the flight),
  rotated down the dragon's line and mirrored for leftward travel. The
  generated gold serpent is gone; the rider *is* the dragon now. The
  portrait card and the cast announcement are unchanged.

## The trap (item)

The item half of the kit: a floor hazard laid one step in front of the fighter
on F — a **landmine seen from the side**, drawn as a squat dome sitting on the
floor. Where Lia's HE grenade *kills*, the trap *delays* — the dagger already
hits first and runs the initiative, and a delay that roots a fleeing enemy in
place for the follow-up is the exact tool a storm of stabs wants.

- **Three per life.** The trap is a mobility hindrance, not a kill tool, so it
  gets more charges than the grenade's two — and three is the cap that keeps it
  from becoming spam. Charges reset on death and on a round reset; a dead
  Anands' traps leave the floor with her.
- **Visible and single-use.** Anyone can see it, and nothing can destroy it
  before it springs — the seeing is the counterplay. Bots see it too: the
  perception hands every bot the hostile traps (pre-filtered by the same
  friendly-fire predicate), and a bot whose feet are a step short of a trigger
  leaves the floor — the jump is the trap's designed counter, and a bot that
  walked onto a patch would be a bot that taught the AI-vs-AI loop nothing
  about the item. The moment an enemy's feet
  cross its patch it **bursts into particles and is destroyed**, like a Dota
  mine: a trap is either on the floor and armed or it no longer exists.
- **Friendly traps are faded.** Your own and every teammate's are drawn at a
  fraction of full opacity, so the side a mine belongs to is answered at a
  glance.
- **The spring:** the first hostile fighter whose feet cross the patch is
  **rooted** for **3 seconds** — no walk, no dash, no jump, no buffered
  jump through the root — but can still attack, block, use items and cast. The
  catch stops the victim dead: a dash, tumble or lunge caught mid-flight loses
  its momentum on the tick. The root is `rootTimer` in state, set by the shared
  `tickPlayer` on both sides, so a caught fighter's own client predicts it. It
  deals a little damage (10): not the point, but the reason a sprung trap reads
  as having done something. A full jump clears it.
- **Counters the moves that need the feet, not the ones that don't.** The
  dagger's thrust and shoryuken — the only moves that relocate the body — will
  not start while rooted; the stab still works. The dragon-thrust ride is the
  one exception: the trap does not counter it, so a rooted Anands can still
  cast her ultimate and a rider caught mid-ride keeps riding.
- **The burst and caption:** the trap pops in teal particles and a **ROOTED!**
  splash appears over the victim — Jumanji green to the DENY splash's Frank
  Miller black-and-white. See [items.md](items.md) for the wire and the full
  rules.

## The AI

`EnemyBrain` picks its modules from the hero: `DaggerBrain` for melee and
`DragonBrain` for the ultimate, with the same `AIOutput` contract — the dagger
uses the same three buttons with different meanings, so the wire to the brain
never changes.

- **DaggerBrain** spams stabs inside reach, reads a whiffed heavy (or a foe
  committed to its own stab) into a thrust, thrusts as a spacing mixup only
  while the foe is grounded — the anticipation is the trade — and anti-airs
  with the shoryuken when the foe is above and the second jump is still in
  hand. It never raises a guard, because there is no guard to raise.
- **DragonBrain** holds the button for a line: two foes within ~100px of the
  same aim line, a low-HP killshot, a support being rushed, an outnumbered
  fight — and a patience rule: a meter held ready for ten seconds is spent on
  the nearest foe it can reach.
- **Every brain jumps a thrust.** The anticipation is the designed dodge, so
  the shared coordinator in `EnemyBrain` treats a thrust winding up nearby as
  "get off the floor", whatever hero is reading it.

## The art budget

Anands is the one hero whose art is hand-drawn. The artist paints reference
boards (in `unprocessed-sprites/`); `scripts/make-anands-art.py` cuts the
frames out of them — keying the boards' beige/charcoal/pale-gold tones,
dropping the text labels, normalising every frame to one standing height —
and composes the sheets the game ships:

| Sheet | Cells | Content |
|---|---|---|
| `anands.png` | 35 x 168x152 | 0-3 run right, 4 face-on, 5-8 run left (mirrors), 9-10 idle profiles, 11-12 gun hold, 13-14 gun fire (muzzle flash), 15-18 gun run, 19-22 dagger stab, 23-28 shoryuken, 29-32 thrust windup/dash, 33-34 damage |
| `anands-roll.png` | 16 x 168x152 | 0-7 roll right, 8-15 roll left (mirrors), derived from the face-on frame like the generated heroes' |
| `anands-dragon.png` | 6 x 352x176 | the dragon-thrust ride: the lunge into the dragon, then the flight |
| `anands-portrait.png` | 128x192 | the face-on frame for the hero select and the ultimate cinematic's card |

**The game's layout rules are per-hero now.** A strip is sliced by its own
cell geometry (`SHEET_CELLS` in `render/assets.ts`), a clip names the strip
and the frames it indexes (`HERO_CLIPS` in `ecs/systems.ts`), and a fighter
is drawn at `sheetScale` — the collider height over the cell height — so her
~140px art reads at the same 44px the generated heroes' 48px does. The
dagger's moves, the gun stance's walk and the damage poses are real frames,
not generated poses; the sword-only states (helpless, slam, plunge, stuck)
and the knockdown stay generated from her own face-on frame, because a
dagger cannot reach them. The dragon ride is her own art too — the generated
gold serpent is gone, and the ride is the six-cell strip rotated down the
dragon's line, mirrored for leftward travel.

A future hand-drawn hero is a new script (or new cells in this one), new
`SHEET_CELLS` entries and a new `HERO_CLIPS` table — the animation machinery
does not care how many cells a sheet has.
