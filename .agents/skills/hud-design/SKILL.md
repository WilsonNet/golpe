---
name: hud-design
description: "Use when building, restyling or extending the in-match HUD (fighter panels, HP bars, clock, ultimate meter, message window) or deciding whether an element belongs in Pixi or the React/DOM overlay. The screen-space UI is DOM, styled like a Chrono Trigger battle window in Fire Emblem gold, fed by the hud-state event at snapshot cadence; the world keeps nameplates and aim beams in Pixi. Covers the canvas/DOM split, container-unit sizing, damage feedback, the rebind-aware key hint, and the gotchas that made the first HUD invisible. Triggers on: HUD, hud, HP bar, health bar, fighter panel, clock, ultimate meter, stance badge, damage flash, ghost bar, kill feed, killpop, overlay, screen-space UI, hud-state, cqw, container units."
license: MIT
---

# The Fight HUD

The screen-space UI of Vento Áureo, in **two tiers**:

- **Gameplay** — fighter panels, clock, ultimate meter. Competitive minimal:
  slim translucent strips in the arena's own colours (dark teal over the teal
  sky, sky bleeding through), hairline of the game's cyan accent
  (`#7ff0f4` — the aim beam, every menu), no ornament. These elements are
  always on screen; the less they look like a window, the less they block the
  view.
- **Interrupt** — the battle message window. It exists to take the eye, so it
  keeps the Chrono Trigger / Fire Emblem gold codex frame (dark inked window,
  gold border, L-corner ornaments). Same reason the podium and menus keep
  theirs.

The gold tier was the whole HUD once, and it read as furniture over the fight.
The rule that fell out: **ornament is earned by interruption** — anything that
is always on screen wears the minimal tier; anything that appears to say
something wears the gold.

## The split: Pixi draws the world, DOM draws the screen

| What | Where | Why |
|---|---|---|
| Fighter sprites, nameplates, aim beams, projectiles, effects | Pixi, inside the camera | They track moving fighters in world space |
| Fighter panels, clock, ultimate meter, message window, scoreboard, podium, menus | React/DOM overlay | Ornate frames, subpixel-crisp text at any DPR, and CSS transitions/animations are exactly what canvas text is bad at |
| HUD container (`stage.hud`) | **Deleted** | Nothing uses it anymore; the whole HUD is DOM |

The world's nameplates (in-world, above each fighter) and the screen HUD (the
local fighter's numbers) answer different questions and never merge.

## Data flow: the hud-state event

`Match.emitHud()` composes a `HudState` (`src/game/hud.ts` — the one contract
both sides import) and emits `hud-state`:

- **Cadence**: every frame, throttled to 50ms — the data is server-owned and
  moves at snapshot speed anyway.
- **Forced immediately** on: damage landed, stance change, name arrival. The
  player's own hit must not wait out the throttle.
- The HUD also reads `match-status` (standings, clock, myId — 20Hz) and
  `hud-status` (battle messages). Nothing reaches into the simulation: a HUD
  that reads `body` directly is a HUD that stops updating when the code moves.

## Sizing: container units, no JS measurement

The HUD root is `position: absolute; inset: 0` inside `#game-container`, which
shrink-wraps the letterboxed canvas — so the HUD box **is** the canvas rect.
`#game-container` is `position: relative` in `public/style.css`.

The HUD root sets `container-type: size`, and everything is sized in
**`cqw`/`cqh`** (1cqw = 8 logical px, 1cqh = 6 logical px — the game is
authored 800x600). The HUD scales with the arena on any window shape with zero
measurement. Never mix in `px` for layout (hairlines at 1-2px are fine).

## The design language

- Panels (gameplay tier): `.vdh-panel` — translucent dark-teal gradient
  (sky bleeds through), 1px cyan hairline, no corners, no shadow. The clock is
  plain gold text with a dark shadow — no backing at all. The ult meter is a
  thin sliver in the bottom-right corner with a **gold percentage readout**
  (`vdh-ult-pct`, tabular, fixed min-width so the bar never jiggles) — the
  bar alone cannot answer "how close am I" — and the percentage turns into a
  violet breathing READY when armed. Only the message window wears
  `.vdh-frame` (the gold codex).
- HP bar: `.vdh-hp` track (flex:1 — see gotchas), `.vdh-hp-fill` (inline
  width/background from `hpColor`: green >66%, amber >33%, red below, `.vdh-low`
  pulse at ≤30%), `.vdh-hp-ghost` (white, `transition: width 700ms 220ms` — the
  FE drain), `.vdh-hp-ticks` (dark dividers at 33/66).
- Damage: `.vdh-damaged` class re-added per hit (state + timeout, NOT a keyed
  remount — a remount would kill the ghost's delayed drain).
- The foe panel renders **only when the room is a duel** (`standings.length ===
  2`, or offline `hud.fighterCount === 2`). A 16-player deathmatch has no "the
  opponent" — showing one fighter's HP as the enemy's is a lie. Both panels
  carry a FRAGS line (yours left, theirs right) so the pair mirrors and a
  duel's progress to the limit is visible on both sides.
- The ultimate keycap shows `bindings.codesFor("ultimate")[0]` via
  `codeLabel`, and subscribes to `bindings` so a rebind redraws it. A hint that
  lies about the button is worse than no hint.
- Messages (`hud-status` + the "FIGHT — FIRST TO N" announcement on phase →
  live) auto-dismiss after 3.5s. The window hides on an empty string.
- Everything is `pointer-events: none`. The HUD never eats a click.

## Gotchas (each cost real debugging time)

1. **A bar whose children are all absolute has no intrinsic width.** `.vdh-hp`
   is a flex item with absolutely-positioned children — without `flex: 1` it
   collapsed to a hairline and the fills rendered at zero width. The HUD "had
   bars that were not there".
2. **CSS comments inside the template-literal stylesheet must not contain
   backticks.** `fightHudStyles.ts` is one big template string; a `` `flex: 1` ``
   comment silently broke the Vite transform with `Expected ";" but found "flex"`.
3. **A one-render condition removes its own element.** The killpop `+1` was
   `grew ? <span/> : null` — the render that saw the counter rise added the
   span, and the next render (50ms later) removed it again. Latch it into state
   (`pop` keyed by the frag count) and let a 1s timer unmount it.
4. **`fighterCount` must count every fighter.** The offline rival is `offlineFoe`,
   not a remote — a duel computed as `1 + remotes.size` showed no foe panel
   offline.
5. **20Hz renders are fine; per-frame transitions are not.** HP/charge/clock
   update at snapshot cadence via setState; CSS transitions (240ms fill, 700ms
   ghost) make that look 60fps. Do not add a 60Hz DOM path.

## Verifying a HUD change

1. `npm run typecheck && npm run lint && npm run test` first.
2. Boot `npm run dev:herdr`, then screenshot with Playwright
   (`?ai=true&bots=1&scoreLimit=10&ultCharge=100` for a live duel with a full
   ultimate; `?offline=true` for the no-server panels; `?screen=2` to confirm
   the HUD stays pinned while the camera scrolls).
3. Ground truth beats eyeballs: probe `getComputedStyle`/`getBoundingClientRect`
   of `.vdh-hp-fill` (width must match the number), the ghost mid-drain, and the
   killpop's presence across a kill. A vision agent can review screenshots, but
   a DOM probe cannot be fooled by a bar that is not there.
4. End with `node scripts/diagnose.mjs --mode=online --runs=3` — the HUD is DOM
   and cannot desync the game, but `Match.emitHud` lives in the match loop and
   a regression there would show up as fighting:false or a crash.
