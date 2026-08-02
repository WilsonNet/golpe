# Deathmatch

**Intent:** sixteen fighters in one arena, everybody against everybody, first to
twenty-one frags. This is the default mode; `?mode=tdm` plays the same arena in
two sides with wipe-out rounds instead — see
[team-deathmatch.md](team-deathmatch.md), which states only what *differs* from
this document. The mode exists to be played with real people, so every part of
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

## Bots are opt-in

**A room has no bots unless somebody asked for them.** A room is for the people in
it, and seating fifteen strangers nobody requested is a decision rather than a
default — it also meant opening the game to check something dropped you into a
brawl, and a probe measuring one fighter had to remember to opt *out*.

| | |
|---|---|
| `?bots=N` | "Give me N opponents." Room is topped up to `1 + N` fighters |
| `?fill=N` | "Keep this room at N fighters", whoever they turn out to be |
| neither | **No bots.** Humans only, still up to sixteen of them |

Asking for none does not make the room smaller: `MAX_PLAYERS` humans can always
join. The target is a floor on activity, never a cap on people.

- **A bot gives up its seat the moment a human wants it.** `rebalanceBots`
  works in both directions: it evicts surplus bots and adds missing ones, so a
  room holds exactly its target number of fighters with humans always kept.
  Zero is a real target and must not be clamped up to one — that would quietly
  seat a bot in every humans-only room, which is the entire thing being avoided.
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

- **Fight HUD** (a DOM overlay, minimal by design — a competitive game, so
  nothing on screen may read as furniture). Slim translucent strips in the
  arena's own dark teal, edged with a hairline of the game's cyan accent: a
  self panel top-left with name, stance badge (and a gold glow while a Massive
  Strike is armed), a segmented HP bar with the number read off its end, and
  frags against the limit; a mirrored foe panel top-right in a two-fighter room
  only — a deathmatch has no "the opponent" — carrying the foe's own frags so
  the pair mirrors; the clock as plain gold numerals floating top-centre, the
  one element allowed to be prominent, pulsing red in the final ten seconds;
  and the ultimate meter as a thin sliver in the bottom-right corner: a bar
  too thin to read alone, so a gold percentage answers "how close am I"
  exactly, turning into a violet breathing READY when armed. Damage snaps the
  bar down and leaves a white ghost that drains after it; the strip's hairline
  flashes red on the hit; a low bar turns red and pulses. The HUD scales with
  the canvas rectangle, and nothing on it can be confused with in-world state
  — the world's own nameplates stay in the arena.
- **Announcements interrupt.** "FIGHT — FIRST TO N" and the other battle
  messages appear in a gold-framed window above the ultimate meter — the
  Chrono Trigger / Fire Emblem codex is reserved for moments that are meant to
  take the eye, and everything that is always on screen wears the minimal tier.
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

## Rooms, and how anyone joins one

**Rooms are addressed by id, not matchmade.** `?room=<uuid>` puts you in that
room; no `?room=` makes a new one. **To play together, share the link** — which is
why the id lands in the address bar immediately and the name prompt offers it with
a Copy button. A host who cannot copy their own URL cannot invite anybody. Full
mechanics in [netcode.md](netcode.md).

| URL | Room |
|---|---|
| `/` | A new, empty room. No bots |
| `/?bots=N` | A new room with N bots to fight (1-15) |
| `/?fill=N` | A new room held at N fighters, bots as ballast |
| `/?room=<id>` | That room, and whoever is already in it |
| `/?ai=true&bots=15` | A room full of AI — the canonical deathmatch test |
| `/?scoreLimit=N&timeLimit=S` | Shortened rules. **Only when creating the room** |
| `/?mode=tdm` | **Team deathmatch** instead — two sides, wipe-out rounds. See [team-deathmatch.md](team-deathmatch.md) |

**Size and rules belong to whoever created the room.** A five-minute match is the
right length to play and the wrong length to measure, so a probe can ask for a
short one — but a latecomer must not be able to resize or shorten a match
everybody else is already playing.

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

- Objectives of any kind: no flags, no control points, no bomb.
- Kill feed, assists, streaks, or damage attribution shown to players.
- Persistence: scores, names and rankings live only as long as the room.
- Reconnection to a match in progress, and spectators.
- Map rotation. Every match is the one arena.
