# Deathmatch

**Intent:** sixteen fighters in one arena, everybody against everybody, first to
twenty-one frags. The mode exists to be played with real people, so every part of
it is answerable to one question: can a player tell what is happening to them
without looking away from the fight?

That is why the scoreboard is held rather than toggled, why bots have names, and
why the match ends with a podium instead of a number.

## Shape of a match

| | |
|---|---|
| Fighters per room | **16** (`MAX_PLAYERS`) |
| Frag limit | **21** (`SCORE_LIMIT`) |
| Time limit | **5 minutes** (`TIME_LIMIT_MS`) |
| Respawn delay | **2s** (`RESPAWN_DELAY_MS`) |
| Podium duration | **15s** (`MATCH_OVER_LINGER_MS`), then a new match |

A match ends when **someone reaches the frag limit, or the clock runs out** —
score is checked first, so a frag landing on the final second reads as a won
match rather than an expired one. The winner is first place in the standings.

**Everyone in the room is on the scoreboard, bots included.** A bot is an
ordinary player everywhere else in this game; making it invisible on the one
screen that says who is winning would be the only place it was not.

## Scoring

- A **frag** goes to whoever last damaged the fighter that died. Damage is
  attributed where it is resolved — melee in `resolveMeleeHits`, bullets in
  `tickBullets` — so a kill from a shot fired ten seconds ago is still credited.
- **A death with no attributed attacker still counts as a death.** It scores
  nobody. `deaths` may therefore exceed the sum of `kills`; the reverse must never
  happen, and the deathmatch probe fails if it does.
- **A swing hits at most one fighter.** `hitLatch` closes a swing on its first
  connection. That is a combat rule rather than an optimisation — see
  [melee.md](melee.md) — and it is what stops a crowd turning one slash into six
  frags.
- **Scores freeze when the match ends**, but the simulation does not. Damage and
  kills stop being awarded; fighters keep moving. Freezing the simulation on one
  side of the wire is how it desyncs, so the podium is a scoring state, not a
  pause.

## Standings order

Ranked by frags, then fewest deaths, then name, then id.

**The chain is deliberately total.** Anything less leaves the order dependent on
iteration order, which differs between the server's `Map` and whatever a client
rebuilt from a snapshot — so two clients would draw two different podiums from
identical data. `rankScores` is a pure function in `simulation/Deathmatch.ts` and
both sides call it; the client is never given a ranking to display, only the
numbers to rank.

## Death and respawn

**Death is expressed as an ordinary stun.** A killed fighter gets
`stunTimer = RESPAWN_DELAY_MS`, which the simulation already knows how to handle:
it discards all intent, on both sides, deterministically, and replays correctly
through reconciliation. A `dead` flag in `PlayerPosition` would have needed all of
that built a second time.

- A dead fighter **cannot be hit and cannot score**. It is still simulated, so
  every client's prediction of it stays consistent.
- **Respawns are individual.** One fighter returning does not reset the arena —
  that distinction *is* the difference between a deathmatch and the rounds this
  game used to run. The whole-arena reset survives for a new match and for the
  training room.
- **A respawn is announced** (`respawn { id }`), never inferred. The
  announcement can lose the race with the snapshot that carries the respawned
  state, so a correction past the teleport threshold is treated as a
  discontinuity too. See [netcode.md](netcode.md).
- **Spawn selection maximises distance from the living.** Spawning inside
  somebody's swing is the one death a player cannot do anything about. The choice
  is a pure, deterministic function — see [arena.md](arena.md).

## Bots fill the empty seats

An empty arena is worse than a bot-filled one, so a public room is topped up to
sixteen fighters with server-hosted bots.

- **A bot gives up its seat the moment a human wants it.** `rebalanceBots`
  works in both directions: it evicts surplus bots and adds missing ones, so a
  room holds exactly its target number of fighters with humans always kept.
- **Bots are named** by `unique-names-generator`, gamertag-shaped and unique
  within a room. Two `SilentWolf`s on a scoreboard is indistinguishable from a
  scoring bug.
- **A bot fights the nearest living opponent.** `EnemyBrain` reasons about
  exactly one enemy, so at sixteen somebody has to choose which — and "whoever is
  closest and still standing" is the choice that reads as fighting rather than as
  commuting across the arena at a fixed rival.
- **Each bot gets a fresh personality every match**, so sixteen of them do not
  replay the same fight every five minutes.

## Names

A human types a name before their client connects, and it is remembered in
`localStorage` so they type it once.

- **The gate is in the netcode, not the UI.** The *connection* needs a name, so
  the connection is what waits for one. A client whose fighter is AI (`?ai=true`,
  which is how every probe runs) names itself and never blocks.
- **One way in.** The React modal and `window.__setPlayerName` fire the same
  event, so an automated run exercises the path a player takes rather than a
  bypass nobody plays.
- Names are trimmed, capped at 16 characters and stripped of control characters
  server-side. React escapes the text, so this is not about injection: it is that
  a 400-character name destroys the layout and an empty one leaves a row with no
  label.

## What a player sees

- **Canvas HUD:** own HP, own frags against the limit, and the clock. Two numbers
  and a timer — everything a player reads without looking away.
- **Hold Tab:** the full scoreboard, as a DOM overlay. Held rather than toggled,
  because a scoreboard you press twice is one you leave open over a fight.
  Released on window blur as well as on key-up, since switching windows mid-hold
  never delivers a key-up.
- **Match over:** a podium. First place largest and centred, second and third set
  well above the rest of the field, the remaining places in a plain table. Second
  and third are the places people argue about, so they get names rather than rows.
- The final standings arrive in their own one-shot `match-over` message. The live
  scoreboard could rebuild the same ranking from the last snapshot, and
  deliberately is not asked to: the podium is the screen a player will remember,
  and it should not depend on their client having kept up with the final datagram
  of a match.

## Room kinds

| URL | Room |
|---|---|
| `/` | Private, one bot |
| `/?bots=N` | Private, N bots (0-15). `bots=0` is an empty room |
| `/?online=true` | Public deathmatch, topped up to 16 with bots |
| `/?online=true&fill=N` | Public, held at N fighters |
| `/?ai=true&bots=15` | A room full of AI — the canonical deathmatch test |
| `/?scoreLimit=N&timeLimit=S` | Shortened rules. **Private rooms only** |

**Shortened rules are refused on a public room.** A five-minute match is the right
length to play and the wrong length to measure, so a probe can ask for a short
one — but one client must not be able to end everybody else's match early.

## Verification

```bash
node scripts/deathmatch-probe.mjs                       # 16 bots, to a winner
node scripts/deathmatch-probe.mjs --scoreLimit=999 --timeLimit=20   # the clock
```

The probe asserts the room filled, the match ended, a winner exists and is ranked
first, places form a total order 1..n, every fighter has a unique name, frags never
exceed deaths, snapshots arrived, and remote fighters were actually corrected.

**And that somebody scored.** Every other check above holds in a room where
sixteen fighters stood still, which is exactly the run a probe must not call a
pass.

## Not implemented

- Teams, objectives or any mode other than deathmatch.
- Kill feed, assists, streaks, or damage attribution shown to players.
- Persistence: scores, names and rankings live only as long as the room.
- Reconnection to a match in progress, and spectators.
- Map rotation. Every match is the one arena.
