# Heroes

**Intent:** the game is a hero shooter with one shared skeleton — movement,
aiming, stances, the ultimate meter, the deathmatch lifecycle are the same for
everybody. What differs is the **kit**: which melee weapon, which ranged weapon,
which ultimate and which item a hero carries. Heroes are compositions of
weapons, Brawlhalla style: two heroes can share a weapon or an item, and an
ultimate is the one thing that is always unique.

Lia is the first hero and the reference kit: sword + gun + black hole + HE
grenade. Anands is the second: dagger + machine gun + dragon thrust + trap — see
[anands.md](anands.md) for her full kit and [items.md](items.md) for the item
half of the kit. Jeffs is the third: sword + shotgun + death blossom + smoke
grenade — see [jeffs.md](jeffs.md).

## What a hero is

A hero is defined by four things, and nothing else:

| | Lia | Anands | Jeffs |
|---|---|---|---|
| **Melee weapon** (sword stance) | Sword | Dagger | Sword |
| **Ranged weapon** (gun stance) | Gun | Machine gun | Shotgun |
| **Ultimate** | Black Hole | Dragon Thrust | Death Blossom |
| **Item** | HE Grenade | Trap | Smoke Grenade |

Everything else a fighter has — movement, jumps, dashes, the stance system,
the meter economy, hitpoints — is shared code that a hero does not get to
change. This is the whole point of the composition: a future hero is a new
weapon table, a new ultimate entry and a new item, not a fork of the
simulation.

## The kit on the wire

The hero is an argument to `tickPlayer` — never a field of `PlayerPosition` —
for exactly the reason the black hole's pull is: it decides how the simulation
behaves, so both sides must agree on it, and it is a static property of the
fighter (like their name), so nothing about it ever has to be replayed.

- The hero travels in the snapshot, **beside `team`** (`SnapshotPlayer.hero`),
  for the same reason teams do: it is an input to the client's own `tickPlayer`
  for every fighter it predicts and replays. The roster is on a 2s heartbeat;
  a hero that arrived there could not be rolled back with the state that
  depends on it.
- `?hero=lia|anands|jeffs` in the URL picks the hero a client boots with. **Per-client,
  never creator-only** — it is the answer to "who do you want to be", and the
  last person through the door still gets to pick.
- The Esc menu's *Heroes* item changes the hero mid-match. The request is a
  reliable one-shot (`hero` message); the change comes home in the next
  snapshot's `hero` field, where the client swaps the sheet, the kit and the
  HUD. Changing hero resets the ultimate meter — ultimates are unique per hero,
  and a free dragon thrust would be a cheese.
- The stance enum on the wire stays `"sword" | "gun"` because it is the *slot*:
  melee weapon out or ranged weapon out. Which weapon that slot means is the
  hero's business, so the wire format never changes when a hero does.

## The kit parameter

`tickPlayer(pos, intent, dt, world, field, kit, traps)` — the kit is the sixth
argument, defaulting to Lia's so every pre-hero caller behaves exactly as it
always has; `traps` is the seventh, the room's floor traps already filtered for
friendly fire, defaulting to none. The kit threads through the whole prediction
path: `PredictedPlayer` and `RemoteFighter` each carry a kit (the local one from
the URL, the remotes from the snapshot), and the server ticks every fighter with
`kitFor(player.hero)`.

A kit is:

```ts
interface HeroKit {
  hero: HeroId;
  melee: MeleeWeaponDef;   // which moves, whether block/charge/chain exist
  ranged: RangedWeaponDef; // cooldown, damage, speed, and the shotgun's pellets
  ultimate: UltimateId;    // black-hole | dragon-thrust | death-blossom
  item: ItemDef;           // he-grenade | trap | smoke-grenade, and its charge count
}
```

The melee weapon's definition lives in `simulation/Melee.ts` beside the shared
frame-data table: every weapon lists the moves it can start, whether the shift
button blocks or thrusts, whether a charge exists, and its dash numbers. The
moves themselves stay in the one global `MOVES` table — a move is globally
unique (`slash` is the sword's, `stab` is the dagger's), which is what keeps
`meleePhase`, the hitboxes and the diagnostics weapon-agnostic.

## The hero select

- **The root menu** has a *Heroes* row showing the current pick. The choice is
  remembered in `localStorage` (`vento.hero`) and written into every launch URL
  the menu commits, so a menu commit and a boot can never disagree.
- **The Esc menu** has a *Heroes* item with the same three cards. It changes the
  fighter mid-match (see above) and updates the remembered preference.
- A shared room link (`?room=…`) deliberately does **not** carry a hero: a
  joiner plays whoever the menu last picked. Only a boot URL the menu wrote
  (or a probe) carries `?hero=`.
- The hero cards render the hero's actual sprite sheet, blown up with
  `image-rendering: pixelated` — the sheet is the character, and a card that
  drew something else would be a card that lied.

## The HUD

The stance badge names the actual weapon — SWORD/GUN for Lia, DAGGER/MACHINE
GUN for Anands, SWORD/SHOTGUN for Jeffs — because the stance is the slot and
the hero is the weapon in it. The foe panel's plaque adds the foe's hero. The
health bar is never tinted, whatever the hero. The item's charge pips sit in
the bottom-right corner above the ultimate meter, so a player reads "how much
item do I have left" at a glance.

## Bots

A bot's hero is **random per bot** by default, so a busy room exercises every
kit and the AI-vs-AI loop covers all three heroes' brains. `?botHero=`
(creator-only) pins the room's bots to one hero — how a probe measures the
dagger or the shotgun at sixteen fighters. The bot brain is constructed with
its hero, and `EnemyBrain` picks its melee module (`MeleeBrain` for the sword,
`DaggerBrain` for the dagger), its ultimate module (`UltimateBrain` for the
hole, `DragonBrain` for the thrust, `BlossomBrain` for the storm) and its item
behaviour from it — see [anands.md](anands.md) for the dagger's strategies and
[jeffs.md](jeffs.md) for the executioner's.

## Not implemented

- More than three heroes. The registry (`HEROES` in `simulation/Heroes.ts`) is
  the single place a fourth is added.
- Shared heroes with the same ultimate. Ultimates are unique by design.
- Per-hero body sizes. Every hero collides as 32x48; a different collider is a
  wire and arena change, deliberately out of scope.
