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

The root is four sections in strict hierarchy — seven buttons of equal weight
made every choice look like every other choice:

- **Start here** — the **Tutorial**, and it is the first thing on the page,
  above Play. This is a game whose good moves are invisible to somebody who has
  only ever pressed attack, so the answer to the only question a stranger
  actually has goes first; everything below it assumes you already know what a
  butterfly is. It is deliberately **not** the gold button — Quick match keeps
  that, because the primary action of a game is playing it — and wears the aim
  beam's cyan instead, so it reads as a different kind of door rather than as a
  competing one. The label names the picked hero, and a `4/16` badge appears
  once any lesson is finished: progress is remembered, and saying so is what
  turns a half-finished course into one worth coming back to. See
  [tutorial.md](tutorial.md).
- **Play** — starting a fight is the primary job, so it is next: the gold
  Quick match (the only filled button on the page), then Host/Join as siblings,
  then Practice.
- **Your fighter** — the hero picker lives here, on the home screen, beside the
  name field: a hero shooter should show its heroes, and the choice rides every
  match started here. There is no separate Heroes page; picking is the
  discoverable face of `golpe.hero`.
- **Learn & settings** — How to play full-width, then the Move list and Options
  as a pair. How to play is the stranger's one-page answer to "how do I play";
  the Move list is a *different question* — "what does my fighter do" — and a
  full-screen feature of its own (live preview, stats, frame data), so it sits
  beside not under How to play. Both read the current hero: the move list opens
  for whoever the picker above has selected.

Two-column rows (Host/Join, Move list/Options) collapse to a single column on
a phone so every button is a thumb-sized target.

## The flows

| Entry | What it commits | Notes |
|---|---|---|
| Quick match (primary) | joins an open room, or `?bots=1` when none | Asks the game server which room is open (`GET /rooms`), joins the busiest one by link, or creates a duel against a single server bot when no room is open — and that duel is itself an open room for the next player. A playtest funnels into one brawl without anyone pasting links. An open room is one with a human in it and a free seat, that is not a probe, a practice session or mid-ceremony. The room link is the bot's seat — friends replace it. |
| Your fighter (on home) | `golpe.hero`, and `?hero=` on every launch below | Two portrait chips: Lia and Anands, each the fighter's own sheet frame. Picking writes the preference immediately; a commit below carries it. |
| Host a match | `?mode=…&screen=N&bots=N&scoreLimit=N&timeLimit=N` (+ `fill`, `freezeTime`, `ultCharge`) | Every room-creator choice, defaults pre-filled to the server's own defaults. |
| Join a match | `?room=<id>` | One field accepts the bare id *or* the whole link. |
| Tutorial (first on the page) | `?tutorial=true&hero=<id>` | The guided course for the picked hero — a live opponent, one lesson at a time, and objectives the simulation has to agree happened. It boots the *training room* with a director in front of it, so it is the practice room's dummy and the practice room's netcode. See [tutorial.md](tutorial.md). |
| Practice | `?training=true` | The training room, one click away — the same room the tutorial runs in, handed to the player instead of to a lesson script. |
| How to play | — | The controls reference, **grouped into three sections** (getting around / fighting / the match) and read from the *live* bindings — a hint that lies about the button is worse than no hint. One sentence per row; the advanced tactics point to the Move list, which is where their full cards live. |
| Move list | — | The Guilty Gear-style command list, for the hero the picker has selected — the same module the Esc menu's *Moves* item opens. |
| Options | — | The same controls dialog as the Esc menu, so rebinding is possible before the first match. |

The hero is **per-client**: the picker's choice rides every commit as
`?hero=`, and a shared room link deliberately does not carry one, so a joiner
plays whoever their own menu last picked. See [heroes.md](heroes.md).

### Quick match is discovery, not a queue

The one place the menu is asynchronous: Quick match asks the game server
(`GET /rooms` on :9208, the same address the status line checks) which rooms a
stranger may be sent to, picks the busiest, and commits `?room=<id>`. Joining
is still joining by link — the game boots because the URL names a room, exactly
as if the link had been pasted into Join. That is the whole concession to
matchmaking: there is still no lobby and no queue, just one button that can
answer "which room is already going".

"Open" is the server's own predicate, not a guess the menu makes. A room
qualifies when a human is in it, a seat is free, and it is not a **probe room**
(created by an `?ai=true` client — a diagnostic is running, and a stranger
mid-run is the last thing it wants), not a **training room** (somebody's
practice session) and not sitting out the post-match ceremony. An empty room
was reaped the moment its last human left, so it never appears. When no room is
open, Quick match creates a `?bots=1` duel — which is itself an open room, so
the next player who clicks Quick match lands in it. A playtest funnels into one
brawl without anyone pasting links.

### Bots are named so they can be removed

A server-hosted bot's name begins with the **`BOT · `** marker — readable on the
in-world nameplate, not just on the scoreboard, where the roster already tags
it. The reason is the Esc menu's room panel: anybody can see who is a bot, and
the creator can remove one (`− Bot`) when a human replaces it. A client-side
AI fighter (`?ai=true`) carries its own marker, `AI-<number>`, so a probe's
fighter is identifiable the same way.

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

The move list opens from **two places** — the root menu's *Move list* item
(Learn & settings, using the hero picked on the home screen) and the Esc menu's
*Moves* item (using `readStoredHero`). Both render the same module, so the two
can never drift. It is a Guilty Gear-style command list for one hero, with four
parts:

- **A category rail** up the left (System / Movement / Melee / Ranged / Item /
  Ultimate) with a count per category and a dot per move, so a player sees the
  whole kit at a glance and where they are in it.
- **A card** with the hero's own sheet frame, the move's name, its tags
  (UNBLOCKABLE · KNOCKDOWN · CANCELLABLE …), its command as live keycaps, a
  prose explanation, and a stat card.
- **A preview stage** below that fills the remaining space: a *live* fighter
  playing the move **against target dummies that take the hit** — real
  fighters with nameplates, health bars, and every reaction the game owns —
  with a frame-data timeline (startup/active/recovery) whose cursor and phase
  chip track the move's *real* timings.
- A **position indicator** ("2 / 5") for the move within its category.
### The preview is the game, one duel wide

The preview is not a video and not a CSS puppet show (the first version was
both — a static sheet frame lunging on keyframes while a gold smear stood in
for the swing, and it could never show a slash because the slash *is* the
arc `MeleeFx` draws). It is a **`FighterStage`** (`src/game/preview/`): a
hero and its **target dummies** on the classic one-screen arena, fed through
the real `tickPlayer` at the fixed 60Hz step and rendered with the real
animation and melee-effect systems. A retune re-times every preview for free;
a new hero's previews exist the moment its sheet and clip table do; there is
nothing to re-render.

**The target dummies are what make a preview a demonstration.** Every combat
story stands one or two real fighters at lanes the story names
(`stories.ts`'s `targets`), facing the hero, named TARGET, with the
nameplate-and-health-bar module a match feeds (`Nameplates`). They are
ticked through the same `tickPlayer` — neutral intent, real physics — so
every reaction is the game's own: the stagger, the knockdown, the launch,
the root, the hole's orbit. And the stage stands in for the **server** for
every decision a lone fighter cannot make alone, by running the same
simulation functions the server runs and nothing else:

- **Melee** — the ordinary `resolveMelee` → `applyMeleeResult` pass, then
  the thrust's multi-target sweep with the server's per-cast latch
  (`resolveThrusts`), in the server's order — the reach box latches the
  swing, so a body it caught is never also swept.
- **Bullets** — the shared `BulletSystem` on the trigger edge, through the
  same `fireFan` the server spawns (cooldown, magazine, the shotgun's
  deterministic fan, distance falloff at the hit), aimed along the story's
  `aim`. The hero carries a real magazine — filled exactly as the server's
  `refillMagazine` fills it — so the gun-fire clip plays off the same
  ammo-drop evidence the wire provides.
- **The massive's blasts** — read off the same `tickPlayer` transitions the
  server's `noteBlasts` reads, applied to every dummy in the radius with the
  server's exact writes (shove, knockup, the carried-victim pin).
- **Items and ultimates** — `launchHeGrenade`/`launchGrenade`/`dragonVelocity`
  launches (the HE, the trap canister and the hole's grenade are *solved
  onto the first target*, a low-arc lob from the projectile equation, so the
  landing happens on somebody instead of past the arena's rim), the trap's
  single-use spring with its burst and ROOTED caption, the hole's
  per-interval ticks, the dragon's swept line with its per-cast latch, the
  blossom's per-interval sweeps — and `fieldFor` for every fighter, so the
  caster walks through their own hole exactly as they do in a match.
- **The readout** — every point of damage pops as a floating number
  (`preview/HitNumbers.ts`), so a card's stat row is shown, not claimed.

The camera frames **the whole scene**: hero, dummies and every live world
object (the grenade in flight, the hole, the storm) sit inside one interest
box, so a cast the old camera chased clear offstage now plays in frame.

The pieces:

- **`preview/stories.ts`** — the story registry: declarative timelines of
  `PlayerIntent` presses, the target lanes, a gun story's aim angle and the
  two scripted-server cues. The entry id *is* the story id — `MovePreview`
  looks up `entry.preview ?? entry.id`, so an entry and its story share one
  name and cannot drift; the field is an override only, used by the melee
  entries to project the shared `MOVES` id. Frame-data-derived holds read
  the tuning constant (the massive holds `MASSIVE_CHARGE_MS + 50`, not a
  literal), and the loops are cut to the action — no dead tails.
- **`preview/FighterStage.ts`** — the stage: the cast (hero + dummies), the
  server halves above, the interest camera, and the presentation modules a
  match feeds (`ItemFx`, `BlackHoleFx`, `DragonFx`, `BlossomFx`,
  `Nameplates`, `BulletSystem`, `MeleeFx`). `window.__previewState` and
  `window.__previewSpeed` are its probe surface — the counters (bullets
  fired and landed, melee hits, damage, traps sprung) and every dummy's
  state (stunned, downed, rooted, held) — and **`scripts/movelist-probe.ts`
  is the measurement**: every entry whose card claims a hit must land one on
  a dummy, online-shaped through the same functions a match's server runs.
- **`ui/MovePreview.tsx`** — the React shell: one stage for the panel's
  lifetime (walking the list calls `setStory`, it does not tear the renderer
  down per move), and a timeline whose cursor is written straight to the DOM
  from the stage's frame callback — never through state. The probe globals
  are published only by the stage that survives React StrictMode's
  double-mount, and torn down by identity, so they always answer for the
  renderer that is actually running.

Two rules the stage lives by:

- **One renderer's textures are its own.** The generated combat art is baked
  through a 2D canvas (`CanvasSource`), because a `generateTexture`
  RenderTexture is GPU-bound to the renderer that made it — a second Pixi app
  on the page handed one draws nothing, silently. The same rule in reverse
  means a preview teardown passes `releaseGlobalResources: false`: releasing
  global resources would strip the shared batch and texture state out from
  under the match rendering behind the menu.
- **The preview never writes the simulation** except through `tickPlayer` and
  the scripted-server cues, which write exactly the fields the server writes.

Navigation is keyboard-first: **Up/Down** (or W/S) walk the moves, **Left/Right**
(or A/D) jump whole categories, **Esc** returns to the menu. The keycaps are
read from the player's *actual* bindings (`codeLabel` over the live `bindings`
store), so a rebind re-labels every command; the numbers are the real tuning
constants from `tweakables/` and the shared `MOVES` table, so a retune rewrites
the cards without a hand edit.

This is a **presentation** module group (`src/ui/moveData.ts`,
`src/ui/MoveList.tsx`, `src/ui/MovePreview.tsx`, `src/game/preview/`).
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
flag stays a probe's and spectator's tool — and a room it creates is a probe
room, which quick match deliberately never sends a human into. Neither is a way
a human who can reach the menu should start a match.
