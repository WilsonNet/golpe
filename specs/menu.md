# The Root Menu

**Intent:** a player who opens the game for the first time can find every way to
play without having read the docs. The query parameters stay — they are the
authority, the expert path and the agentic path — and the menu is their
discoverable face.

## The model: the URL is the state

Every way the game is started ends as a query string, and `src/game/online/launch.ts`
is the only place that string is read or written:

- `Match` parses it at boot.
- The menu serialises it when a player commits a choice.
- `App` decides whether the menu shows at all by asking whether the URL carries
  a launch request.

A commit therefore cannot configure a match the game will not honour — the menu
and the boot use the same code, by construction. And what the address bar shows
after a commit is exactly the link that boots that match when shared.

## When the menu shows

The menu is the root URL: no launch request in the query string. *Presence* of
any launch key — `room`, `ai`, `offline`, `training`, `training-room`, `bots`,
`fill`, `scoreLimit`, `timeLimit`, `ultCharge`, `mode`, `freezeTime`, `screen`
— boots straight into the game, whatever its value. The vestigial `?online=`
is *not* a launch key: it is the old spelling of the bare URL, which is the
menu's own page.

The rule is structural so it is predictable: any URL with a launch key was
written by someone who knew what they were asking for — a shared link, a saved
bookmark, or a probe. Every automated script runs exactly this way, and none of
them ever sees the menu.

## The home screen

The root is three sections in strict hierarchy — seven buttons of equal weight
made every choice look like every other choice:

- **Play** — starting a fight is the primary job, so it is first: the gold
  Quick match (the only filled button on the page), then Host/Join as siblings,
  then Practice.
- **Your fighter** — the hero picker lives here, on the home screen, beside the
  name field: a hero shooter should show its heroes, and the choice rides every
  match started here. There is no separate Heroes page; picking is the
  discoverable face of `golpe.hero`.
- **Learn & settings** — How to play and Options, smallest and quietest.

Two-column rows (Host/Join, How to play/Options) collapse to a single column on
a phone so every button is a thumb-sized target.

## The flows

| Entry | What it commits | Notes |
|---|---|---|
| Quick match (primary) | `?bots=1` | A duel vs a server bot: action in one click. The room link is the bot's seat — friends replace it. |
| Your fighter (on home) | `golpe.hero`, and `?hero=` on every launch below | Two portrait chips: Lia and Anands, each the fighter's own sheet frame. Picking writes the preference immediately; a commit below carries it. |
| Host a match | `?mode=…&screen=N&bots=N&scoreLimit=N&timeLimit=N` (+ `fill`, `freezeTime`, `ultCharge`) | Every room-creator choice, defaults pre-filled to the server's own defaults. |
| Join a match | `?room=<id>` | One field accepts the bare id *or* the whole link. |
| Practice | `?training=true` | The training room, one click away. |
| How to play | — | The controls reference, read from the *live* bindings — a hint that lies about the button is worse than no hint. |
| Options | — | The same controls dialog as the Esc menu, so rebinding is possible before the first match. |

The hero is **per-client**: the picker's choice rides every commit as
`?hero=`, and a shared room link deliberately does not carry one, so a joiner
plays whoever their own menu last picked. See [heroes.md](heroes.md).

Hosting and joining are siblings, not parent and child of one "Play": they
answer different questions, and neither is a step toward the other. The primary
action stays one click from the bare URL; the settings that exist for measuring
(arena size, score/time limits, fill, freeze time, ult charge) live behind an
explicit "Advanced" disclosure, because they are the language of probes, not of
first matches.

## The host form

Defaults are the server's own defaults, so a host who changes nothing gets the
vanilla game — and every committed value is written explicitly, so the room's
rules are pinned by the URL and cannot drift with a future default change.

| Field | Default | Range |
|---|---|---|
| Mode | Deathmatch | Deathmatch / Team deathmatch |
| Arena width | 1 screen | 1–8; **3 is the floor in a team match**, enforced by the form (the server enforces the same floor) |
| Bots to fight | 0 | 0–15 |
| Frags / rounds to win | 21 / 15 | 1–999 |
| Match length | 5 minutes | 1–60 |
| Advanced: keep room filled | 0 (off) | 0–16 |
| Advanced: freezetime | 4s (team matches only) | 0–60 |
| Advanced: ult charge floor | 0 | 0–100 |

The summary line under the fields states the match the button will create — the
team floor, in particular, is told *before* the commit, not discovered after.

## Joining

The field accepts a room id (`abc-123`) or a full link (anything with a `room=`
parameter). Anything else is a plain-language error; the id is validated against
the same `ROOM_ID_RE` the server validates against, so a malformed join is
caught before a connection is ever attempted.

## The name

The menu's name field reads and writes the same `localStorage` key as the
in-match prompt (`golpe.playerName`), so a player who names themselves in the
menu never sees the prompt — and a script that answers `player-name` through
`window.__setPlayerName` still walks the path a human walks. See
[controls.md](controls.md) for the name rules.

## The Esc menu — in-match room controls

The Esc menu does not pause the match (the server is authoritative) — it takes
the keyboard away via `input-suspended` so rebinding does not walk the fighter.

Beyond Heroes and Controls it now holds the live room panel:

- **Teams & Bots** (TDM) or **Room & Bots** (FFA) — the only place a match is
  reconfigured without leaving it.
- **Your team** (TDM only) — two chips, AZURE / EMBER, showing the live side.
  Changing side teleports a live fighter to the new spawn with the same HP, so
  stacking for Players vs Bots is done in the freezetime between rounds.
- **Bots** — `+ Bot (auto)` / `− Bot` and, in TDM, per-side `+ AZURE` /
  `+ EMBER` / `− AZURE` / `− EMBER`. The server seats a new bot on the side
  you choose (or the smaller one for auto) and prefers the larger side when
  removing, so the room stays balanced. Only the creator and their admins may
  use these controls; everybody else sees them disabled but still readable.
- **Admins** — the creator may promote any other human to admin (and demote
  them) from the player list. Admins persist until they leave; a leaving
  creator passes the crown to the next human so the room never ends up
  admin-less. The same messages are exposed as `window.__sendTeam`,
  `window.__sendBotAdd`, `window.__sendBotRemove` and `window.__sendAdmin` for
  probes.

The panel reads the live roster (`RosterEntry.team`, `admin`, `creator`) and the
snapshot's `MatchStatus.mode`, so a client that joined by link learns the mode
and who can manage the room rather than assuming its own URL.

## The move list

The Esc menu's **Moves** item opens a Guilty Gear-style command list for the
hero the menu last picked (`readStoredHero`). It is a DOM overlay, one move at
a time, with four parts:

- **A category rail** up the left (System / Movement / Melee / Ranged / Item /
  Ultimate) with a count per category and a dot per move, so a player sees the
  whole kit at a glance and where they are in it.
- **A card** with the hero's own sheet frame, the move's name, its tags
  (UNBLOCKABLE · KNOCKDOWN · CANCELLABLE …), its command as live keycaps, a
  prose explanation, and a stat card.
- **A preview stage** below that fills the remaining space: the hero on a
  ground line, with a frame-data timeline (startup/active/recovery) whose
  animated cursor and swing effects track the move's *real* timings.
- A **position indicator** ("2 / 5") for the move within its category.

Navigation is keyboard-first: **Up/Down** (or W/S) walk the moves, **Left/Right**
(or A/D) jump whole categories, **Esc** returns to the menu. The keycaps are
read from the player's *actual* bindings (`codeLabel` over the live `bindings`
store), so a rebind re-labels every command; the numbers are the real tuning
constants from `tweakables/` and the shared `MOVES` table, so a retune rewrites
the cards without a hand edit.

This is a **presentation** module (`src/ui/moveData.ts`, `src/ui/MoveList.tsx`).
Per-hero branching belongs here by the same rule that lets the HUD branch per
hero: it never touches the simulation, and it must never drift from the tuning
constants it reads.

## Leaving

The Esc menu's *Exit to menu* destroys the client (the fighter leaves the room;
the match keeps running for everyone else) and clears the launch request from
the URL. The action is the one destructive choice in the UI, so it asks
"your fighter leaves the room" before it happens.

## Invariants

- **The menu never boots a match itself.** It writes a URL; `App` boots from
  the URL. There is no second path.
- **A menu-shaped URL always shows the menu.** Presence of any launch key is
  the only thing that skips it.
- **`?online=true` alone is the menu**, because it is the bare URL's old
  spelling.
- **The URL is written before the game boots** (and the game reads the URL at
  boot), so there is no window where a match runs against the address bar the
  player was looking at.
- **The menu owns no simulation state** — it is DOM before the match exists.
- **The server's `/health` endpoint** answers `{ ok, rooms }` with
  `Access-Control-Allow-Origin: *`, so the menu's status line works from any
  origin the page is served on.

## What is not in the menu

The offline escape hatch (`?offline=true`) stays a typed URL: it bypasses the
netcode and is for working without a server, not for playing. The `?ai=true`
flag stays a probe's and spectator's tool. Neither is a way a human who can
reach the menu should start a match.
