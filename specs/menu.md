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

The root is **a short list, not a catalogue**. Hick's law is the reason: the time
to choose grows with the number of options weighed, and eleven equal-weight
buttons made every choice look like every other choice. So the front page carries
only the decisions a player actually makes, and everything else is one disclosure
away (progressive disclosure: show what is frequent up front, reveal the rest on
request, never more than one level deep).

- **Quick match** — the gold button and the only filled one on the page, one
  click from the bare URL.
- **Host a match / Join a match** — two quiet siblings, still on the front page
  because playing with a human is the second most common intent. They answer
  different questions and neither is a step toward the other.
- **Map maker** — also on the front page, not in the disclosure: building an
  arena is still play, and it is the one tool that produces content for the
  game. It is a link, not a launch — the editor is its own page.
- **Your fighter** (the right column) — the **name field first**, then the hero
  picker: a row of four portrait tiles, each the fighter's own sheet frame with
  the name beneath and the selected tile in gold. A hero shooter should show its
  heroes, and the choice rides every match started here. There is no separate
  Heroes page; picking is the discoverable face of `golpe.hero`. The kit labels
  are deliberately not repeated on the tiles — the selected fighter's blurb
  beneath the row says what they carry, and the Move list says it in full.
- **`Play <hero> Tutorial`** — under the picker and the blurb, because the
  course teaches *this kit*: the swordsman's lessons are not the dagger's. The
  label names the fighter ("Play Lia Tutorial"), the aim beam's cyan marks it as
  a different kind of door, and a `4/18` badge appears once any lesson is
  finished — progress is remembered, and saying so is what turns a half-finished
  course into one worth coming back to. Most players never need it, so it is not
  one of the four front-page play choices; the player who does finds it where
  the choice of kit is. See [tutorial.md](tutorial.md).
- **More** — one labelled disclosure at the foot of the page: *practice and
  settings*. Inside it, grouped: **More ways to play** (Practice), **Learn**
  (How to play, Move list), **Settings** (Options, Graphics, Sound). The label
  names what is inside, so it is not a mystery-meat "More"; and the disclosure
  is capped at this single level — a menu of submenus is burying complexity,
  not organising it.

### The first-time card

A browser that has never answered the card **and has no lesson finished** gets
one dialog over the menu: *First time?* — one line, *Learn the moves that aren't
on the buttons* — then the cyan **`Play <hero> Tutorial`** as the card's biggest
target, **Skip for now** as a quiet full-width button beneath it, and a
**Don't show this again** link. Esc or a click on the backdrop is Skip.

The course is the big one because the player who needs it is exactly the one who
would never go looking for it. Skipping still costs one click and never hides:
most players will take it.

The card exists because the offer has to find the player who needs it: the good
moves are invisible to somebody who has only pressed attack. It is a dialog, not
a section, because it is a question about this player, and the menu behind it is
what they came for.

- **Skipping is the session's answer.** It closes the card; the button beside
  the hero picker is right there, so nothing is lost.
- **Accepting and "Don't show this again" are the browser's answer**, stored in
  `localStorage` (`golpe.tutorialPromptDismissed`) — never the wire, like the
  name and the bindings. Accepting also writes it: the card introduced the
  course, and the course stays visible under the picker, so re-asking would be
  a nag.
- **Storage that cannot be written counts as answered**, so a private-mode
  browser is never shown a card it cannot silence.

**The repository is named in the header, and only there**: an octocat mark and
the live star count as a pill beside the title, linking to
`github.com/WilsonNet/golpe`. The mark *is* the label — a second "Open source"
caption beside it said the same thing twice and made the header heavier; the
accessible name still spells it out. The star count is read from the public
GitHub API once per session (`sessionStorage`, 10 minutes); a failed fetch costs
the number, never the link. (A whole "Open source" section under Play — a blurb
plus *Read the code* and *Report a bug* — said the same thing twice and was cut
as clutter; the pill is the one place.)

**Two columns, one decision each, not a wall of pairs.** From 980px wide the
home card is 940px and the home view is a grid: the play column on the left, who
you are on the right, with a hairline between them. *Inside* each column every
action is full-width and stacked — there is no side-by-side pair anywhere on the
home screen, because two buttons sharing a row read as equal choices of equal
weight. On a narrow screen the columns stack in the same order, and the hero
chips become one column. The other views (host form, join, how to play…) keep the
single column — a form is a column. Past 1800×1000 and 2400×1300 the card is
zoomed (1.2×, 1.5×) rather than stretched: a longer line of text is harder to
read, not easier.

The rule the layout is protecting: **a newcomer must be able to name what this
screen offers in one breath** — play, host, join, build, and who you are
(including the course that teaches them). If a new item cannot be described as
one of those, it belongs behind *More*.

## The flows

| Entry | What it commits | Notes |
|---|---|---|
| Quick match (primary) | joins an open room, or `?bots=1` when none | Asks the game server which room is open (`GET /rooms`), joins the busiest one by link, or creates a duel against a single server bot when no room is open — and that duel is itself an open room for the next player. A playtest funnels into one brawl without anyone pasting links. An open room is one with a human in it and a free seat, that is not a probe, a practice session or mid-ceremony. The room link is the bot's seat — friends replace it. |
| Your fighter (on home) | `golpe.hero`, and `?hero=` on every launch below | Two portrait chips: Lia and Anands, each the fighter's own sheet frame. Picking writes the preference immediately; a commit below carries it. |
| Host a match | `?mode=…&screen=N` (or `map=<id>`) `&bots=N&scoreLimit=N&timeLimit=N` (+ `fill`, `freezeTime`, `ultCharge`, `private`, `password`) | Every room-creator choice, defaults pre-filled to the server's own defaults. |
| Join a match | `?room=<id>` | One field accepts the bare id *or* the whole link. |
| Tutorial (first-time card, and under the hero picker) | `?tutorial=true&hero=<id>` | The guided course for the picked hero — a live opponent, one lesson at a time, and objectives the simulation has to agree happened. It boots the *training room* with a director in front of it, so it is the practice room's dummy and the practice room's netcode. A first-time browser is offered it once in a card. See [tutorial.md](tutorial.md). |
| Practice (under *More*) | `?training=true` | The training room, one click away — the same room the tutorial runs in, handed to the player instead of to a lesson script. |
| Map maker | `?mapmaker=true` | A link, not a launch: the editor is its own page (see [map-maker.md](map-maker.md)). It stays on the front page rather than in *More* — building an arena is still play. |
| How to play (under *More*) | — | The controls reference, **grouped into three sections** (getting around / fighting / the match) and read from the *live* bindings — a hint that lies about the button is worse than no hint. One sentence per row; the advanced tactics point to the Move list, which is where their full cards live. |
| Move list (under *More*) | — | The Guilty Gear-style command list, for the hero the picker has selected — the same module the Esc menu's *Moves* item opens. |
| Options (under *More*) | — | The same controls dialog as the Esc menu, so rebinding is possible before the first match. |
| Graphics (under *More*) | — | The visual-comfort submenu: a side-by-side Waterfront vs. Off skybox comparison, plus a Waterfront art vs. Flat competitive platform comparison. Off restores the plain blue gradient with no grade, blur, scenery or motion; Flat restores the original monochrome blocks. The two choices are **independent**: Off keeps painted platforms, and Flat does not bring the city back. Both are stored and apply immediately — a live match swaps only its backdrop or its arena container, without resetting the fight. The same submenu is in the Esc menu. |

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
practice session), not **private** (`?private=true`, or passworded — an
unlisted room is for the people who hold its link, and a listing has no
password field to offer them anyway) and not sitting out the post-match
ceremony. An empty room was reaped the moment its last human left, so it never
appears. When no room is open, Quick match creates a `?bots=1` duel — which is
itself an open room, so the next player who clicks Quick match lands in it. A
playtest funnels into one brawl without anyone pasting links.

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
| Mode | Deathmatch | Deathmatch / Team deathmatch / 5 Control Points |
| Arena width | 1 screen | 1–8; **3 is the floor in a team match**, enforced by the form (the server enforces the same floor). A control room has no width to choose — five screens, one point per screen, is the map |
| Arena | Classic | The classic arena, or any map in `maps/` (`?map=<id>`). A library map is its own width, so the width field gives way to the map's description; a map under three screens is disabled for team deathmatch, and none applies to 5CP. |
| Bots to fight | 0 | 0–15 |
| Frags / rounds / captures to win | 21 / 15 / 3 | 1–999 |
| Match length | 5 minutes | 1–60 |
| Private room | Off | Off / On — hidden from quick match and any listing. A password implies private. |
| Password | (none) | Up to 64 characters. Disabled until Private room is on — only a private room takes a password, and a passworded room is always private. Hidden from the URL by default; check "Include password in invite link" to make the link carry `?password=`. |
| Advanced: keep room filled | 0 (off) | 0–16 |
| Advanced: freezetime | 4s (team modes only) | 0–60 |
| Advanced: ult charge floor | 0 | 0–100 |

The summary line under the fields states the match the button will create — the
team floor, in particular, is told *before* the commit, not discovered after.

## Joining

The field accepts a room id (`abc-123`) or a full link (anything with a `room=`
parameter). Anything else is a plain-language error; the id is validated against
the same `ROOM_ID_RE` the server validates against, so a malformed join is
caught before a connection is ever attempted. A locked room answers
`room-locked` rather than a seat, and the client shows a password prompt that
stores the key in `sessionStorage` and reloads without putting it in the URL —
a manually typed `?password=` still works for old share links.

### Server browser

Below the manual field the join screen lists every open room — the same
`GET /rooms` quick match uses, refreshed every five seconds. Each row shows
the room id (shortened), region, mode (Deathmatch / Team DM), player count
(`humans/players` with bot count), map size (screens) and HTTP ping (time to
fetch the listing, a proxy for latency; WebRTC ping is not available via
`fetch`). The list is the same `GameRoom.isOpen` predicate, so discovery and
the game cannot disagree.

**LAN rooms are pinned first and badged `LAN`.** They come from the host pack:
the page's own server when it was loaded from a private address, plus the rooms
the pack discovered on the network (`GET /lan/rooms`). The badge is derived from
the validated private endpoint, never from a query flag or a server field. The
chosen sort runs *inside* the LAN and internet groups, so a nearby machine
cannot be pushed below a distant one by changing the sort column. A LAN row
from another build offers **Open host** instead of Join; see
[lan.md](lan.md) for the build gate.

The public site never shows LAN rows: a browser cannot scan a LAN or browse
mDNS, and only a page served by the host pack can ask its local discovery
endpoint.

Filters sit above the list: a search box (room id substring), a mode
filter (All / Deathmatch / Team DM / 5 CP), a region filter (All / LAN / each
reported region) and a sort control (Ping, Players, Mode, toggling
asc/desc). Private, probe and full rooms never appear.

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
(under *More*, using the hero picked on the home screen) and the Esc menu's
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
  origin the page is served on. The menu asks it — and `/rooms` — on the
  page's own protocol (`https:` in production), via the same
  `resolveGameEndpoint` + `httpBaseFor` the match uses. A hardcoded `http://`
  is mixed content on the deployed HTTPS site, which reads as a healthy server
  being offline and makes quick match skip the room lookup.

## What is not in the menu

The offline escape hatch (`?offline=true`) stays a typed URL: it bypasses the
netcode and is for working without a server, not for playing. The `?ai=true`
flag stays a probe's and spectator's tool — and a room it creates is a probe
room, which quick match deliberately never sends a human into. Neither is a way
a human who can reach the menu should start a match.
