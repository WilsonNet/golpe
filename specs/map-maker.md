# Map maker

**Intent:** anybody who plays golpe can build an arena, play it against bots
in the real game, and send it to the main repository as a pull request that
proves itself — screenshots and a play-test clip — without installing
anything. A merged map is in the next build's menu with no code change.

`?mapmaker=true` opens it (root menu → **Map maker**).

## The loop

Super Mario Maker's loop is the design: **build → play → fix**, with the play
button the biggest thing on screen. Everything else follows from keeping that
loop short.

1. **It starts with a map.** A first visit opens the classic arena in the
   Castle theme, already playable, with a five-step strip (draw, spawn, theme,
   test, publish). Templates (Blank floor, Classic arena, Twin towers, Sky
   islands, **Sky tower** — three rows tall) live behind **New**, with a
   width and a height.
2. **Editing** is the Tiled/Figma shape: tools on the left (Select, Platform,
   Spawn, Decor, Erase, Hand — V/P/S/D/E/H), the canvas in the middle, the
   inspector and the checks on the right, the whole map as a minimap strip.
   - Platforms are drawn as rectangles snapped to the **8px map cell**; a click
     without a drag drops a 128×24 ledge (the classic arena's).
   - Spawns **drop onto the surface under the cursor**, drawn as the 32×48
     fighter they are, with their facing. Decorations attach by their own
     rule (see *Decorations*).
   - Select drags to move, handles resize, empty space pans. Space-drag, the
     middle button and the wheel pan; ⌘/Ctrl-wheel and pinch zoom.
   - Undo/redo (⌘Z / ⇧⌘Z), one step per gesture. Duplicate (⌘D), nudge
     (arrows, ⇧ ×4), flip (F), delete (⌫).
   - **Make symmetric** copies the left half onto the right, mirrored — a
     competitive map gives neither side the better ground.
   - **Reach** (R) shades how high a jump (136px) and a double jump rise from
     the selected platform.
   - **Width** is 1–8 screens; growing extends a full-width floor, shrinking
     drops what no longer fits.
   - **Height** is 1–4 rows of screens (see *Vertical maps*).
3. **Themes** are swatches in the top bar — Waterfront, Castle, Meadow, Snow
   (see *Themes* below). Switching is instant and never moves a collider.
4. **Test with bots & friends** (T) boots the real game on the map in a frame: 0–15 bots,
   free-for-all or team deathmatch (3+ screens), your hero, or **AI vs AI**
   to watch. The game's Esc → Exit, or **Back to editor**, returns to exactly
   where you were.
5. **Publish** opens the pull request (see *Publishing*).

Autosave is continuous (`localStorage`, `golpe:mapmaker:maps`); **My maps** is
the library (open, duplicate, delete, import/export `.json`, and remix any map
already in the game).

## Decorations

The Decor tool (D) opens a **drawer** beside the tool rail — the canvas stays
fully visible — built like an asset browser, because a catalogue of 125
props does not fit a floating strip:

- **Search first** (`/` focuses it, Enter takes the first match), then
  **category tabs** with counts — Nature, Town, Windows & walls, Lights &
  fire, Hanging, Critters, Sky — and **Recently used** on top, because a map
  is dressed with a handful of props used many times (`localStorage`,
  `golpe:mapmaker:recentProps`).
- Every thumbnail is the **real art in the map's theme**, scaled to its cell
  in whole pixels; a teal dot marks an animated prop. The footer names the
  prop in hand, its size and how it attaches. `[` / `]` step through props.
- **Brushes**: **Stamp** (a click places one), **Row** (a drag lays the prop
  edge to edge — a fence, a terrace of windows) and **Scatter** (a drag
  sprinkles the whole category with uneven gaps — a flowerbed, a flock). A
  stroke is **one undo step**.

**Every prop attaches by its catalogue rule** (`propCatalog.json`, generated
from `scripts/tilesets/props.py` — see [tilemap.md](tilemap.md)):

| Attach | Placement | Examples |
|---|---|---|
| `stand` | bottom row on the surface under the cursor | bushes, trees, crates, birds perched, lamp posts |
| `hang` | top row on the ceiling above the cursor | vines, banners, bunting, lanterns, icicles, bats |
| `wall` | mounted on the platform under the cursor, inside it, **below the walkable lip** when the face has room | windows, doors, clocks, torches, ivy |
| `air` | exactly where it was clicked | flying birds, flocks, balloons, clouds, the moon |

Animated props (flags, fire, birds, the birdcage's canary) animate in the
game; the editor draws their first frame. Nothing about a decoration is ever
simulated.

### Prettify

A selected platform gets a **✨ Prettify** panel: Windows, Birds, Greenery,
Lights, Festive, and **Surprise me**. A platform has three slots — its
**top** (things stand on it), its **face** (things mount on it) and its
**underside** (things hang from it). Each style writes some of them and first
clears what is already in *those* slots of *that* platform, so styles compose
(windows, then birds) and pressing a style again **re-rolls** it. Windows lay
rows and columns across the face — a tall block becomes a building, with a
clock or a sign in the middle of a wide one — and lit and dark panes mix.
Picks lean on the theme: gulls and portholes on the Waterfront, banners,
crows and stained glass in the Castle, rabbits and sunflowers in the Meadow,
penguins, icicles and snowmen in the Snow.

**✨ Prettify the whole map** (the map panel) runs Surprise me on every
platform and puts a few birds and clouds in the open sky. **Clear all decor**
and **Strip its decor** undo either. Dressing is pure and seeded
(`src/ui/mapmaker/dress.ts`): the same map, platform, style and seed give the
same props, and a property test proves no decoration lands inside another
platform or off the map.

## Vertical maps

A map is **1–4 rows of screens tall** (the bar's *tall* control, or Height in
**New**). Rows are added and removed at the **top**: the floor stays the
floor and everything moves down a screen, so a map grows into a climb;
shrinking drops what was in the removed rows. The editor draws a dashed seam
per row, labels each screen `SCREEN n · ROW r`, opens a tall map on its bottom
row, and repeats the sky per row (the game's backdrop is screen-locked).

In the game nothing new simulates: the world's `bottom` is `rows × 600`, and
the follow camera, already written for a world taller than the view, scrolls
vertically. The backdrops lock to the screen vertically (see
[skybox.md](skybox.md)). Reach checks walk the whole height. Measured by
`scripts/decor-probe.ts`: a Sky tower is an 1800px world in the real game and
the camera scrolls from the summit to the floor.

## The play-test is the game

The editor writes the map into the play-test slot (`localStorage`,
`golpe:mapmaker:playtest`) and loads `?map=draft&bots=N&private=true` in an
iframe on the same origin. That is an ordinary room on the ordinary server:
the client resolves `draft` to the spec and sends it in the join, the server
sanitises it, builds the room's world from it and sends the sanitised copy
back in the `match` message. **No editor code simulates anything.** A map that
plays in the test plays in a match.

The frame's `exitToMenu` posts `golpe:mapmaker:exit` to the parent instead of
showing the root menu.

## Testing with friends

**👥 Invite friends** in the play-test bar copies a bare `?room=<id>` link.
The editor reads the id from the frame's own address bar (the game writes
the seated room there, `showRoomInUrl`) and deliberately drops the rest of
the frame's URL: `map=draft` names a slot only the author's browser has, and
`ai`/`hero` are the author's own. **A friend needs nothing but the room** —
the server sends them the sanitised map in `match.map`, so they play the map
without ever having the file. Bots are ballast: each friend takes a bot's
seat (`bots=0` is "just us"). The room is private, so it stays out of quick
match; it lives while anyone is in it, so friends can keep playing after the
author goes back to the editor. Measured by `mapmaker-probe.ts`: a fresh
browser with only the link plays the same platforms and theme, and the room
stays the same size.

## Capture

The play-test is filmed (`src/ui/mapmaker/capture.ts`):

- The game canvas is WebGL without `preserveDrawingBuffer`, so it is read
  through `captureStream` → a `<video>` → an **800×600** 2D canvas (the game's
  logical size, whatever the device pixel ratio) → `MediaRecorder`.
- With *Record* on (default), the **first take starts 2.5s in** (after the
  FIGHT banner) and stops itself at **20s**; Stop ends it early.
- **Screenshots** are taken automatically at 5s, 11s and 17s, and on demand.
- Media is stored in IndexedDB per map, so a clip survives a reload.

## Checks

`src/game/maps/checks.ts`, pure, live in the editor and listed in the PR:

| Rule | Level | Why |
|---|---|---|
| fewer than 2 spawns | error | nowhere to enter |
| spawn inside a platform | error | reads as a teleport on every client |
| spawn floats >24px | warning | fighters drop in |
| gap narrower than 32px | warning | `narrowGaps` — pins the AI |
| headroom under 48px | warning | a crawlspace nobody fits |
| surface out of reach | warning | a ledge nobody stands on |
| fewer than 8 spawns | info | 16 fighters respawn on top of each other |
| under 3 screens / no end-screen spawns | info | team deathmatch rules |

**Reach** is a breadth-first walk over surfaces from every spawn's landing:
up needs a rise ≤ double jump − 16px (≈227px) within 240px across; down is a
drop that buys extra horizontal airtime. It ignores wall jumps and air dashes,
so it is a warning, never an error. **The shipped classic arena passes every
rule at every width** — that property test is what keeps the rules honest.

Errors block publishing; warnings never do.

## Publishing

A published map is the folder `maps/<id>/`:

| File | What |
|---|---|
| `map.json` | the map, exactly as `sanitizeTilemap` returns it |
| `screenshot-1.png` | the whole map at 1:1 — also the menu's map card |
| `screenshot-2..4.png` | up to three play-test frames |
| `preview.webm` (or `.mp4`) | one play-test clip |

The Publish sheet is three steps that each unlock the next: **About** (name,
GitHub username, one line), **Proof** (checks pass, one clip, ≥1 shot — with
*Play-test now* right there when missing), **Send**. Three routes send:

1. **Sign in with GitHub** — the OAuth device flow. The game server relays the
   two token endpoints that lack CORS (`/github/device`, `/github/token`,
   `server/github.ts`) and holds only the public client id; needs
   `GOLPE_GITHUB_CLIENT_ID` (an OAuth app with *Enable Device Flow*) and
   optionally `GOLPE_MAP_REPO`. Hidden when unconfigured.
2. **A pasted token** (`public_repo`), used in the tab and never stored.
3. **Save into this checkout** (dev server only, `/__mapmaker/save`), then
   `pnpm map:pr <id>`.

Routes 1–2 run in the browser against the REST API: fork when the player
cannot push, sync the fork, upload blobs, one tree, one commit, branch
`map/<id>`, PR. Route 3's script commits in a throwaway worktree on
`origin/main` (never your working tree), pushes (to your fork if needed) and
runs `gh pr create`; it **films the map itself** with Playwright (AI vs AI,
`?map=draft`) when any media is missing, or always with `--record`.

Both routes write the same description (`src/game/maps/pullRequest.ts`): the
clip as a poster linking to the file, the overview and frames, a table
(theme, size, counts, modes, author) and the checks. Media URLs are pinned to
the commit (`raw.githubusercontent.com/<repo>/<sha>/…`) so they survive the
branch being deleted. GitHub does not play a committed video inline; the
poster is the click target.

## The map library

`maps/*/map.json` is bundled by Vite (`src/game/maps/library.ts`); every map
goes through `sanitizeTilemap`. The root menu's **Host** form lists them as
arena chips (a map too narrow for team deathmatch is disabled there), and
`?map=<id>` boots straight into one. Ships with three: **Castle Keep**
(Castle, 2 screens), **Meadow Run** (Meadow, 3 screens, team-ready),
**Frostpeak** (Snow, 1 screen).

## Themes

A theme is a palette over the same hand-set 9-slice tiles
(`scripts/tilesets/themes.py` recolours the Waterfront's pixel maps, so the
3×3 joint gate passes by construction) plus a backdrop:

| Theme | Platforms | Backdrop (`render/ThemeSky.ts`) |
|---|---|---|
| Waterfront | mossy stone quay | the hand-painted panorama |
| Castle | grey flagstone, crimson banner band | dusk sky, towers and ramparts, twinkling stars |
| Meadow | grass over packed earth | blue sky, rolling hills and trees, drifting clouds |
| Snow | packed snow on blue-grey rock, ice band | pale sky, snow-capped peaks, pines, falling snow |

The procedural backdrops are blurred and desaturated like the Waterfront, so
the platforms and fighters stay the high-contrast band. **Graphics → Off still
wins**: a themed map shows the plain gradient for a player who chose it, and
**Flat** still draws the competitive blocks.

## Not implemented

- Moving platforms, hazards, one-way platforms, slopes (the format has none).
- Vertical parallax on a tall map (the backdrop is screen-locked).
- Decorations in front of the fighters (every prop draws behind them).
- Inline video in the PR (GitHub only inlines its own uploads).
