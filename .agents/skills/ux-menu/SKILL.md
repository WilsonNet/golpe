---
name: ux-menu
description: "Use when building, changing or reviewing any menu or pre-match screen in Golpe — the root menu, the name prompt, the Esc menu, the controls dialog, or any new flow a human walks before a fight starts. Covers the UX principles this project commits to (Don Norman's The Design of Everyday Things and Nielsen's 10 heuristics, applied), the URL-as-state model that makes the menu truthful, the nesting rules for host/join/practice flows, and how to verify a menu without breaking the agentic path. Triggers on: menu, root menu, main menu, UX, discoverability, host a match, join a match, quick match, how to play, options, pre-match screen, onboarding, first-time experience."
license: MIT
---

# UX Skill: Menus and Pre-Match Screens

The UX discipline for this project, grounded in Don Norman's *The Design of
Everyday Things* and Nielsen's 10 usability heuristics. This is the thinking
behind `specs/menu.md`; read that spec before changing anything a human clicks
before a fight.

## The two readings of Norman and Nielsen that matter here

**Norman: the gulfs.** Every screen is a bridge over two gaps: the *gulf of
execution* ("what can I do, and how?") and the *gulf of evaluation* ("what did
that do?"). The whole project's URL system is a Gulf-of-Execution story: options
that exist only as query parameters are perfectly executable by nobody who has
not read the docs. The menu closes that gulf for humans. Its five tools, in
order of value:

1. **Discoverability** — the root must show what is possible. If a feature is
   reachable only by a URL nobody knows, it does not exist.
2. **Feedback** — every action must answer. The menu answers with a status line
   (server online/offline), a summary line ("the match you are about to
   create"), and the address bar itself.
3. **Conceptual model** — the user's mental model must match the system's. This
   game's model is *links are invitations*: you don't search for a match, you
   share a room. The menu must never imply matchmaking, lobbies, or queues that
   the server does not have.
4. **Constraints** — make it impossible to do it wrong. The host form floors a
   team arena at 3 screens, clamps ranges, and validates a join id before a
   connection is attempted.
5. **Error recovery** — plain-language errors ("room ids are letters, numbers,
   dashes and underscores"), a Back button on every sub-view, Esc to step back,
   and a confirmed Exit-to-menu.

**Nielsen's 10 heuristics**, applied as a checklist for any change:

| # | Heuristic | This project's reading |
|---|---|---|
| 1 | Visibility of system status | Server status line; host form summary; the URL is visible state |
| 2 | Match the real world | "Slash / fire" not "attack" or "Mouse0"; "Bots to fight", not "fill" |
| 3 | User control and freedom | Back on every view; Esc steps back; Exit to menu asks first |
| 4 | Consistency and standards | One `vd-` design language across menu, prompt and Esc menu; same wording everywhere ("frags to win" in the form and the HUD) |
| 5 | Error prevention | Constraints before validation: clamped fields, enforced team floor, join id checked against `ROOM_ID_RE` |
| 6 | Recognition rather than recall | Options visible in the form, never remembered parameters; the share link is shown, not described |
| 7 | Flexibility and efficiency | Query params stay the expert/agentic path; the menu is the novice path; both reach the same game |
| 8 | Aesthetic and minimalist | Primary action first, everything else in order of frequency; measuring tools behind the Advanced disclosure; **spacing is part of the layout — a control with no air around it reads as broken** |
| 9 | Help users recover from errors | Error text says what was wrong and what to do; nothing is a code |
| 10 | Help and documentation | "How to play" reads the **live bindings** — a hint that lies about the button is worse than no hint |

## Breathing room is a feature, not a nicety

A screen with seven buttons of equal weight is cluttered; a screen with seven
buttons *that touch each other* is broken. The menu's polish is its vertical
rhythm, and it is explicit, not accidental. The values that ship today
(`src/ui/menuStyles.ts`):

- **28px of card padding** — the menu owns the whole screen, so its furniture
  earns more air than an overlay's.
- **24px between sections**, **10px inside a section** — a section is a flex
  column with `gap: 10px`, so the heading, the Quick match button, the
  Host/Join row and Practice all sit 10px apart and the sections sit 24px
  apart. One number does the whole job instead of hand-tuned margins.
- **4px inside a button** between its title and its one-line description.
  At 3px it read as a label with a footnote; at 4px it reads as a button with
  a caption.
- **Every element must have air on all sides.** Audit the vertical gaps on the
  real page (`getBoundingClientRect`, not eyeballs): section head hugged its
  content at 9px, the name field and its description met at **0px**, and the
  stacked buttons met at **0px**. All three read as one control until the air
  was added.

Two CSS traps cost real time on this screen and both look like the layout
"just not working":

- **Chromium shrink-to-fits `<button>` even with `display: flex`.** A button
  with `width: auto` hugs its text. Every menu button needs an explicit
  `width: 100%` (plus `box-sizing: border-box`), or a full-width "Practice"
  renders 398px wide with a void to its right.
- **A `.vd-two`/`.vd-hero-pick` @media rule that comes *before* the base rules
  is dead on arrival** — later rules of equal specificity beat it, so the
  phone kept two cramped columns and the card overhung the screen. Put the
  phone block last, and test at a real 390px viewport, not a wide one.

Breathing has a cost: the card grew to 812px before the hero chips were sized
down (48×72 on the home screen, the Esc menu keeps its 64×96 cards), and it
still ends 30px taller than a 778px viewport at the layout's previous density.
That is the right trade — a menu that scrolls gracefully (`margin: auto` +
`overflow-y: auto` on the page keeps the title reachable at the top and the
footer reachable by scroll) beats a menu that fits but is cramped. What is not
acceptable is a menu where the footer is *invisible without scroll on a
standard laptop window*; aim for the whole card inside ~800px of height.

## The architectural law: the menu is a URL generator, never a booter

`src/game/online/launch.ts` is the single source of truth for the launch query
string. Rules that follow:

- `Match` parses the URL at boot; the menu serialises it on commit; `App`
  decides "menu or boot" by asking `isMenuShape(location.search)`. **A menu
  commit never boots a match directly** — it writes the URL, and the boot
  happens because the URL now carries a launch key.
- **A menu-shaped URL always shows the menu.** Presence of any launch key
  (`room`, `ai`, `offline`, `training`, `training-room`, `bots`, `fill`,
  `scoreLimit`, `timeLimit`, `ultCharge`, `mode`, `freezeTime`, `screen`)
  boots. Values are ignored by the rule — `?ai=false` boots like `?ai=true`,
  because explicit is explicit.
- **The vestigial `?online=` is the menu**, not a launch key.
- **The URL is written before the boot**, so the address bar never lies about
  the match that is running.
- Never add a feature that only exists in the menu. If a new mode or option is
  worth having, it gets a launch key, and the menu becomes one more writer of
  that key — otherwise agents and shared links cannot reach it.

## The nesting rules (how to arrange any pre-match flow)

1. **The primary action is one click from the bare URL.** Everything else is a
   detour. (Quick match = `?bots=1`.)
2. **Hosting and joining are siblings.** They answer different questions and
   neither is a step toward the other. Never nest Join inside Host or vice
   versa.
3. **Options that exist for measuring go behind a disclosure.** Arena size,
   score limits, freeze time and ult charge are the language of probes; the
   vanilla host should not have to read them to reach vanilla.
4. **Every sub-view has a way back** (Back button + Esc), and **destructive
   choices are two-step** (Exit to menu asks "your fighter leaves the room").
5. **Defaults are the server's defaults**, and a committed value is written
   explicitly so the room's rules are pinned by the URL.
6. **One field accepts both the whole and the part** (join accepts the link or
   the bare id). Never make a human extract the `room=` from a URL by hand.

## Where the pieces live

| Piece | File |
|---|---|
| Launch URL parse/serialize, menu-shaped rule | `src/game/online/launch.ts` |
| The menu | `src/ui/MainMenu.tsx`, `src/ui/menuStyles.ts` |
| Shared controls/rebind dialog | `src/ui/ControlsDialog.tsx` (used by menu + Esc menu) |
| Boot gating | `src/App.tsx` (`started`, `launch()`, `exitToMenu()`) |
| Name storage | `src/game/playerName.ts` (menu and in-game prompt share the key) |
| Server status endpoint | `server/index.ts` `/health` (added via geckos `addServer` — geckos forwards non-`/.wrtc` paths to pre-registered listeners) |
| Spec | `specs/menu.md` |

## Gotchas (each cost real debugging time)

1. **A menu that boots a match directly desyncs from the URL.** The URL is the
   state; the boot must be caused by the URL. If you find yourself calling a
   `startMatch()` from a menu handler, you are building a second path — stop.
2. **The menu is DOM before the match exists.** It must not import or touch the
   simulation, the netcode or Pixi state. `EventBus` is fine, but the match
   object does not exist yet.
3. **`?online=true` alone is the menu now.** Scripts that opened the bare URL
   expecting a match must pass a launch key — `?bots=0` is the empty room. The
   bare-root probe (verify-modes "empty room") passes because it appends a
   `room=`.
4. **The in-game name prompt is untouched by the menu.** The menu writes the
   same `localStorage` key, so a player named in the menu never sees the prompt;
   a player who boots by URL still does. `window.__setPlayerName` still fires
   the same event either way.
5. **Health-check the server, not the page.** `fetch('http://<hostname>:9208/health')`
   with a timeout — the page being up (Vite) says nothing about the game server,
   and the "Connecting…" failure is the one a new player cannot diagnose.
6. **A hint that lies is worse than no hint.** Any keycap shown in a menu must
   come from `bindings.codesFor(...)` / `codeLabel`, subscribed to the store.
   Hardcoding "Q/E" means a rebound player is told a lie.
7. **Escape is layered.** The controls dialog captures Escape (capture-phase,
   stopPropagation) to cancel a rebind; the menu's Esc handler steps back a
   view. If you add a new keyboard flow, decide which layer owns Escape before
   writing a listener.
8. **The menu must work on a phone.** No hover-only affordances, buttons big
   enough for a thumb, and the responsive breakpoint in `menuStyles.ts` — a
   phone is the discoverability story too.

## Verifying a menu change

1. `pnpm run typecheck && pnpm run lint && pnpm run test`.
2. `node scripts/menu-probe.mjs` with the servers up — it drives the real menu:
   bare URL shows the menu; Quick match boots with `bots=1`; Practice boots
   training; Join accepts a room; a URL with a launch key never shows the menu.
3. `node scripts/verify-modes.mjs` — the whole URL matrix must still pass: the
   menu is the novice path and must not have disturbed the expert path.
4. Take a screenshot at a phone viewport: the menu is the first thing a mobile
   player sees, and the last thing a desktop player sees differently.
5. Measure the vertical gaps, don't eyeball them. `getBoundingClientRect` the
   heading-to-content and element-to-element gaps and confirm the 24px/10px/4px
   rhythm survived — a button at 0px from its neighbour is the exact bug that
   ships as "unpolished".
6. Ground truth beats eyeballs: the probe asserts on `.vd-menu` presence and
   the URL after commits, not on styling.
