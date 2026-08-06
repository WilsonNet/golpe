# Team Deathmatch

**Intent:** two sides, no friendly fire, and a round that ends when one side is
**wiped out**. A death is not a two-second inconvenience any more — it is a
fighter your team does not get back until the round is over, so the last player
standing is playing for everybody, and everybody is watching them do it.

That single rule is what the mode is for. Deathmatch rewards the fighter who
scores; this rewards the side that is still there. Everything else here follows
from it: the arena is wider because a losing team needs somewhere to retreat to,
the score counts rounds because a round is the unit of winning, and the whole
room is colour-coded because a mode where hitting the wrong person is impossible
is also a mode where *knowing* who the wrong person is has to be instant.

> Free-for-all is unchanged and is still the default. See
> [deathmatch.md](deathmatch.md); everything there holds unless contradicted
> below.

## Shape of a match

| | |
|---|---|
| Sides | **2** — AZURE and EMBER (`TEAM_COUNT`, `TEAM_NAMES`) |
| Fighters per room | **16** (`MAX_PLAYERS`), split as evenly as they arrive |
| Round limit | **15** round wins (`TDM_SCORE_LIMIT`) |
| Time limit | **5 minutes** (`TIME_LIMIT_MS`), shared with FFA |
| Arena width | **at least 3 screens** (`TDM_MIN_SCREENS`) |
| Cooldown after a wipe | **5s** (`ROUND_RESET_DELAY_MS`), then the arena resets |
| Freezetime before a round | **4s** (`ROUND_FREEZE_MS`), everybody planted |
| Respawns | **None, until the round ends.** |

Asked for with **`?mode=tdm`**, and — like `?screen=`, `?bots=` and the
shortened rules — **honoured only for the client that creates the room**. The
mode decides how big the arena is, who is on your side and what a point means; a
latecomer switching it would be reshaping a match in progress. The server
answers with the room's real mode in the `match` message, so a client that
followed a link learns which game it is in rather than assuming its own URL.

## The round

Four phases, and only one of them is a fight:

```
  freezetime 4s  ->  the round  ->  cooldown 5s  ->  reset  ->  freezetime …
  everybody            until one     score on         spawns,
  planted              side is       screen,          bullets and
                       wiped         survivors        holes cleared
                                     still play
```

A round ends **when every fighter on one side is down** — never on a timer.

- The surviving side scores one round. Both sides falling on the same tick
  (a black hole makes this easy) is a **draw**, and scores nobody.
- The arena then holds for `ROUND_RESET_DELAY_MS` with the score on screen, and
  the survivors keep playing through it. **The simulation is never frozen for a
  scoring state** — that is how it desyncs, and it is the same reason the FFA
  podium does not stop the fight.
- Then the whole arena resets: everybody respawns at their own end, the bullets
  and any open hole are cleared, and the round number goes up. That reset is the
  existing `round-reset` announcement, so every client legitimately drops its
  prediction history for it.
- **A wipe that decides the match resets nothing.** The podium goes up over the
  arena as it stands, and the round counter does not advance — otherwise the
  scoreboard would claim a round that was never fought.
- **A round cannot end before both sides have somebody in them.** Without that
  check a room with one fighter in it wipes the empty side sixty times a second
  and wins the match before the second player has finished connecting.

`roundResult` is a pure function of who is alive, in
`simulation/Teams.ts`, so the server and a unit test agree on what "wiped" means.

**A wipe is announced** (`round-won { team, round, scores, resetInMs }`), sent
reliably and separately from the arena reset that follows it. Same rule as the
podium: the snapshot carries the same numbers twenty times a second, so the
announcement can only cost a banner, never the score.

## Freezetime

**Four seconds, planted at your spawn, before every round.** Counter-Strike's
freezetime, and it is here for CS's reason: the seconds before a round are where
the round is decided — where your team is, where theirs will come from, what you
are going to do — and the dead air is what makes the first exchange land like it
matters. A round that starts the instant the last one is scored is a round nobody
arrives at.

**Four rather than CS's ten**, because the two modes spend it differently: CS
buys a loadout and plans a two-minute round, and there is nothing to buy here and
a round lasts half a minute. Ten seconds was mostly waiting; four is long enough
to find your team, read the score and tense up, and short enough that fifteen
rounds of it are not a minute of the match spent standing still.

**It is not a pause, and it must never become one.** Every client keeps
simulating at sixty ticks a second; fighters simply take the neutral intent
inside `tickPlayer`, driven by `PlayerPosition.freezeTimer`. That is the same
mechanism death uses and for the same reasons: it is state the client already
predicts, replays through reconciliation and rolls back with everything else, so
a client predicts the exact tick a round goes live rather than being told a frame
late.

Stopping the simulation instead — the ultimate's cinematic mechanism — would be
wrong at this length. That freeze is 1.1s of *server-declared* ticks with a
deepened input queue behind it; ten seconds of it would park ten seconds of input
in every client's queue.

- A frozen fighter **still falls and still collides**. They are standing on a
  spawn platform, so nothing moves — but the arena is not held still.
- **Facing is kept.** The spawn already points across the map, and a fighter
  should start the round looking where they were put.
- No gunshot and **no ultimate cast** during it: both are decided outside
  `tickPlayer`, so both ask `isFrozen` themselves.
- **The match clock does not run.** Fifteen rounds of freezetime and cooldown is
  two and a half minutes of a five-minute match — counted, the timer would decide
  almost every team match, and the mode's own pacing would be punishing the
  players living through it. **The win condition is still checked**, though: only
  the clock is paused, or a deciding wipe would go unnoticed for five seconds and
  the arena would reset into a round nobody was playing.
- **`?freezeTime=S`** shortens it (0-60s), creator-only like every other room
  rule. Zero is legitimate — "no countdown, start fighting" — and it is how the
  probe runs.
- A fighter who joins **during** a countdown inherits whatever is left of it, so
  a bot seated three seconds in is planted for the remaining seven rather than
  walking around a room that has not started.
- `round-live` is announced reliably when it ends. The countdown is in every
  snapshot and drawn from there, so this carries nothing new — it exists so
  "FIGHT" lands on the same moment on every screen instead of each client racing
  its own copy of the clock to zero.
## Sides

- **Assigned on arrival, to whichever side is smaller** (`balanceTeam`), ties to
  the lower id. Deterministic, so a room seated in the same order twice comes out
  the same way and a probe can assert the split.
- **Never reassigned mid-match.** Balancing a live match by moving somebody
  across would hand the round they are standing in to the other side. Balance
  comes from where the *next* joiner goes.
- **A bot gives up its seat from the larger side.** The human taking it is
  assigned to the smaller one, so evicting at random would seat every arriving
  human beside the bot that just left and the room would drift 9v7.
- Teams travel **in the snapshot, beside `hp`** — not in the roster. They are an
  argument to `tickPlayer`: the black hole's friendly-fire rule is applied on the
  client for every fighter it predicts and replayed on every reconciliation, and
  the roster is sent on change with a 2s heartbeat. A client that lost one would
  spend two seconds dragging its own teammates into a hole the server is not
  pulling them into.

## No friendly fire

**One predicate, `hostile(a, b)` in `simulation/Teams.ts`**, and every weapon
asks it. A fighter with `team: null` — which is every fighter in a free-for-all —
is hostile to everybody including other `null`s, so FFA falls out of the same
code with no mode check in any damage path.

| | What a teammate gets |
|---|---|
| Sword | The blade **passes through**: no damage, no stun, no knockback, and `hitLatch` is *not* spent, so the swing still hits the enemy behind them |
| Bullet | **Flies on, unconsumed.** A shot that stopped on the friendly in front of you would make a firing line impossible |
| Grenade | **Does not detonate on contact.** A lob that blew up on the ally it was thrown over would make the ultimate a way to lose the round |
| Black hole | No pull, no damage — `fieldAffects` excludes the caster *and* the caster's side |
| `damage()` | Refuses friendly damage outright, as the backstop that makes the four above an optimisation rather than the rule |

**Bots know, and they know by construction.** `EnemyBrain`'s combat is aimed
only at living enemies — `nearestFoe` filters by `hostile`, so a teammate is
not a target the AI declines, it is a fighter the brain is never told about.
The same filter runs client-side for `?ai=true` clients.

**And they play the side, not the fight.** The brain's `TeamBrain` gives every
bot in a team room a stable role — the n-th fighter of a side alternates
**vanguard** (sword, holds a line `LINE_OFFSET_PX` ahead of the support, toward
whatever enemy threatens it) and **support** (gun, keeps the 240–420px band,
kites what closes — but only as far as its own end screen, where the retreat
becomes a last stand). The vanguard covers: when an enemy swings inside the
support's reach it drops its rhythm and holds the guard. Both roles keep off
each other (spacing), push together (never more than the lead cap ahead of the
side), and regroup only when actually separated. Two measured failure modes
the roles exist to prevent: a vanguard that chased a kiting enemy crossed three
screens without a single swing, and a support that never stopped retreating
dragged the whole side across the arena.

## The arena

Team deathmatch is played on **at least three screens** (2400px). `?screen=N`
below that is raised; above it is honoured.

One screen was tried and is the wrong room for this mode: the two sides start
inside each other's reach, the first exchange decides the round, and there is no
flank, no regroup and no reason to hold ground. Three screens is the smallest
arena in which a team can lose a fight and still have a fight left.

**Team 0 spawns on the leftmost screen and team 1 on the rightmost** — exactly
one screen each, whatever the room's width, furthest from everybody already
placed (`pickTeamSpawn`). Everything between is contested.

A screen rather than a fraction of the arena, because a screen is the unit the
game is authored in and the one a player can point at: "we start on the left
screen, they start on the right" survives being said out loud at three screens
and at eight, where "a third of the map" stops meaning anything.
Facing is overridden to point across the map rather than inherited from the spawn
point — the per-screen layout aims its spawns at the middle of *their* screen,
which would leave half a team starting with its back to the fight, and facing
decides which side a guard covers.

**Sides do not swap ends between rounds.** The arena is mirrored per screen, so
the two ends are already the same fight from either side; swapping would cost
every player their sense of which way the enemy is and buy nothing.

## Colour

**Everything a fighter emits is tinted toward their side.** This is a feature of
the mode, not decoration: the rule "you cannot hit your own team" is only worth
anything if you can tell, instantly and without looking away from your own
fighter, who your own team is.

The palette is **AZURE `#4ea8ff`** and **EMBER `#ff8a4c`** — complementary, so
they separate at any size against both the bright sky and the dark ledges;
survivable for the two common colour-vision deficiencies, which red/green is not;
and colliding with nothing the game already uses to *mean* something (green/amber/red
is health, violet is the ultimate, gold is the HUD frame).

### Tinting is a blend, never a replacement

Every combat colour already carries information — white is the first slash, amber
the finisher, cyan the uppercut, violet the ultimate. Painted flat team-blue, the
move data is gone: you would know whose swing it was and no longer what it was.
So a team tint is a **mix toward** the side's colour at a strength chosen per
effect (`teamPalette.ts`), and the strength scale is "how much did the original
colour mean":

| Strength | Used by | Why |
|---|---|---|
| `subtle` 0.34 | Swing trails, the blade, the guard, the ultimate aura, the black hole, **the fighter's own sprite** | The colour is frame data, or the ability's identity |
| `medium` 0.62 | Impact sparks, shards, rings, the launch plume, the grenade | Mostly move-coloured; pulled clearly toward the side |
| `strong` 0.8 | Dash wind, charge motes, stun stars | Near-neutral to begin with |
| `full` 1.0 | Names, **bullets**, cast shadows | The colour *is* the identity |

`medium` and `strong` are higher than they first look because most particles are
drawn **additively over a bright sky**, which washes any tint toward white — the
same thing that forced the ultimate's aura to be painted rather than added. A
blend that reads as clearly blue in isolation reads as white at 50% on this
background.

The **health bar keeps green-amber-red, always.** It is the one reading in the
world that must be understood instantly and never second-guessed, and a bar that
was blue on one fighter and orange on another would take that away to say
something the name already says. The bar's *surround* carries the side instead.

### Cast shadows

Every fighter throws a **team-tinted shadow onto the surface below them**
(`render/Shadows.ts`), in its own layer between the arena and the actors.

It is the one place a saturated colour can go without competing — nothing else in
this game is drawn on the floor — and it sits where a player is already looking,
at the feet, watching for the ledge they are about to land on. It answers "whose
side is that" before you have read anything.

It earns its place twice: an airborne fighter's shadow is on the ground *below*
them, smaller, fainter and offset, so it also answers "how high is that, and
where will they land" — which this game previously had no way to show at all.

The surface comes from `world.platforms`, like the arena itself. **Drawn from the
collider data**, so a level edit cannot leave shadows hanging at an old floor
height.

### The local fighter

In a team match the local fighter's name is a **lighter shade of their own side's
colour**, not the free-for-all cyan. Two questions are being answered at once —
"which of these is me" and "which of these can I hit" — and in a team game the
second is the one that gets you killed, so the team colour wins and "me" is said
by lightening it. A free-for-all has no sides, so the old cyan/white pair is
still exactly right there and is unchanged.

## What a player sees

- **During freezetime:** a title card in the middle of the arena — the round
  number, a big per-second countdown that goes gold for the last three, and
  `AZURE 4 vs EMBER 4` beneath it. It is allowed to own the centre of the screen
  because for those ten seconds there is nothing behind it to own. It reads
  `status.teams.freezeMs` rather than counting locally, so the moment it says
  zero is the moment fighters can actually move.
- **Under the clock:** the round score in both sides' colours with the living
  count between them — `3 (4 v 2) 2` — and `ROUND N · FIRST TO 15` beneath.
  In a wipe-out mode "4 v 2" is the most decision-changing number on screen: it
  is what tells you to push or to hold. The side that just took a round flares
  once, because a score that changes silently is a score nobody saw change.
- **The self panel** is edged in your own side's colour.
- **A banner** on every wipe: `AZURE WIN THE ROUND — 3 : 2`, through the same
  battle-message window everything else announces itself in.
- **Hold Tab:** the scoreboard is **two blocks**, one per side, each headed with
  the side's round score and how many of it are still standing. The order *inside*
  a block is `rankScores`'s, untouched — the standings are ranked once, by the
  same pure function the server uses, and re-sorting here is how a live scoreboard
  ends up disagreeing with the podium it turns into. The rows carry the same stat
  columns a free-for-all's do — damage dealt, denies, damage blocked — because
  they are the whole evidence a teammate was carrying a side that lost.
- **Match over:** the podium leads with **the side that won** and the final round
  score, and names the top individual as MVP underneath. The match was won by a
  team; the MVP is the footnote. The MVP is `mvpOf`, a weighted whole-match
  score — frags, then denies at more than a frag apiece, then damage and blocked
  damage in cheap health-bar bursts, the same values the Play of the Game
  weights moments with — so the support who denied two ultimates can carry the
  line over their side's cleanest fragger. A timed match that ends level says
  `DRAW`.

## Verification

```bash
node scripts/tdm-probe.mjs                                  # 8 bots, two sides, to a winner
node scripts/tdm-probe.mjs --fighters=16 --scoreLimit=2     # a full room
node scripts/tdm-probe.mjs --freeze=0                       # no countdown at all
```

The probe asserts the room is `tdm`, that it is **three screens wide without
having asked**, that the teams split evenly and every fighter got a side, that
rounds ended by wipe-out and the arena reset between them, that the match ended
on the round limit with a winning side, and that snapshots arrived.

**And that freezetime actually held them still** — measured, not assumed. The
probe compares the local fighter's x between two consecutive samples *of the same
countdown* and fails if it moved at all. Between rather than from a baseline,
because the arena reset that begins a freeze teleports everybody to their spawn:
measuring from where the countdown started reported a working freezetime as a
1008px failure, which was the corpse's distance from its spawn. A countdown that ran while fighters walked around would be worse
than none: it would say the round had not started while the round was being
decided. It runs at `--freeze=3` by default, because a probe that sat through ten
seconds a round is a probe nobody waits for; that the default is ten is a
constant and `Teams.test.ts` asserts constants.

**And that nobody hit a teammate** — reconstructed from the scoreboard rather
than trusted from the code. With no friendly fire, a side's deaths can only have
been scored by the other side, so a side that died more often than its opponents
have frags killed itself. That is a failure; the reverse (unattributed deaths) is
only a note, because a fall or a hole opened by somebody who has left is
legitimate.

**And that the fight happened at all**: a room where sixteen fighters stood still
satisfies every correctness check above, and no wipe, no reset and no frag is a
failure rather than a clean run.

## Not implemented

- More than two sides. `TEAM_COUNT` is 2 and the round rules are written over an
  array, but nothing chooses a third colour or a third spawn zone.
- Team-chosen sides, switching teams, or party/pre-made grouping.
- Objectives: no flags, no control points, no bomb. The only objective is the
  other team.
- Sides swapping ends between rounds (deliberately — see *The arena*).
- Buying, loadouts or anything else to *do* during freezetime. It is four seconds
  of looking at the map, which is the half of CS's freezetime this game has —
  and why it is four and not ten.
- Spectating your own team after dying. A dead fighter watches the arena, not a
  teammate's camera.
- Any per-side voice, ping or communication.
