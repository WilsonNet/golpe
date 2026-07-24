# Running the Game

Every way to launch Vento Áureo, and what each one is for.

- [Prerequisites](#prerequisites)
- [Starting the dev servers](#starting-the-dev-servers)
- [Game modes](#game-modes)
  - [Player vs AI](#1-player-vs-ai-offline)
  - [AI vs AI](#2-ai-vs-ai-offline)
  - [Player vs Player](#3-player-vs-player-online)
  - [AI vs AI online](#4-ai-vs-ai-online)
- [Controls](#controls)
- [URL parameters](#url-parameters)
- [Debug console hooks](#debug-console-hooks)
- [Automated diagnostics](#automated-diagnostics)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

```bash
npm install
```

Node.js is required. Two ports are used:

| Port | Process | Needed for |
|---|---|---|
| 8080 | Vite dev server | everything |
| 9208 | Geckos.io game server | online modes only |

---

## Starting the dev servers

### Recommended — visible herdr panes

Runs both servers in named panes you can watch, and waits for the ports before
reporting success.

```bash
npm run dev:herdr          # start
npm run dev:herdr:status   # pane liveness + real port checks
npm run dev:herdr:logs     # tail both panes
npm run dev:herdr:down     # stop and close the tab
```

Requires a running [herdr](https://herdr.dev) server (just run `herdr` in a
terminal). See [the herdr-dev-workspace skill](../.agents/skills/herdr-dev-workspace/SKILL.md)
for the full model and the socket-API gotchas.

### Alternatives

```bash
npm run dev:all      # both servers, interleaved in one terminal via concurrently
npm run dev          # Vite only  — enough for the offline modes
npm run dev:server   # game server only
```

> **Avoid backgrounding these with `&`.** A detached server is invisible when it
> dies, and `pgrep -f "tsx server/index.ts"` matches its own shell command line,
> so it reports "running" when nothing is listening. That combination has already
> caused a physics diagnostic to report `PASS` against a dead server.

Restart the game server after editing anything in `server/` or
`src/game/simulation/` — `tsx` does not hot-reload.

---

## Game modes

All four are the same build, selected by URL.

| Mode | URL | Servers needed |
|---|---|---|
| Player vs AI | `http://localhost:8080/` | Vite |
| AI vs AI | `http://localhost:8080/?ai=true` | Vite |
| Player vs Player | `http://localhost:8080/?online=true` ×2 tabs | Vite + game server |
| AI vs AI (online) | `http://localhost:8080/?online=true&ai=true` ×2 tabs | Vite + game server |

### 1. Player vs AI (offline)

```
http://localhost:8080/
```

The default. You control the left fighter with the keyboard and mouse; the right
fighter is driven by `EnemyBrain`. Everything is simulated locally — no game
server required.

### 2. AI vs AI (offline)

```
http://localhost:8080/?ai=true
```

Both fighters are driven by independent `EnemyBrain` instances with randomised
configs, so each round plays differently. Press **P** at any time to toggle the
mode on or off, or call `window.__toggleAIVsAI()`.

On a KO both fighters reset to 100 HP after 2 seconds. The console logs
`[FIGHT]` for hits and KOs and `=== FIGHT RESET ===` between rounds.

This is the mode the physics harness drives, because it exercises the arena
without a human at the keyboard.

### 3. Player vs Player (online)

```
http://localhost:8080/?online=true      # open in two tabs or two browsers
```

Needs the game server on :9208. The first two clients to connect are matched
into a room; you'll see `[ONLINE] Matched in room room-N!` in the console and
the "Connecting..." overlay clears once both are present.

The server is authoritative. Your own fighter is predicted locally and
reconciled by rewind-and-replay, so it responds instantly; the opponent is
interpolated 150ms in the past for smoothness. Measured client/server
disagreement is 0.00px.

At 0 HP the server waits 1.5s, resets both fighters and broadcasts
`round-reset`.

> Local same-keyboard hotseat is **not** supported — player vs player is online
> only. Two tabs on one machine works fine for testing.

### 4. AI vs AI (online)

```
http://localhost:8080/?online=true&ai=true    # two tabs
```

Same netcode as PvP, but each client's fighter is AI-driven. This is how the
online half of the feedback loop runs unattended.

Online damage is applied server-side and is **not** logged as `[FIGHT]` — read
HP from `window.__gameState()` to confirm a fight is really happening.

---

## Controls

| Input | Action |
|---|---|
| **W** | Jump — hold for height, release early to cut the arc |
| **A** / **D** | Move left / right |
| **S** | Down |
| Double-tap **A** / **D** | Dash |
| **Mouse** | Aim |
| **Left click** | Fire |
| **Q** / **E** | Switch to melee / ranged |
| **P** | Toggle AI vs AI |

Jumping is forgiving on both sides of a ledge: 100ms of coyote time after
walking off, and a 120ms jump buffer before landing. While airborne and touching
a wall, jump again to wall jump — world edges count, so a flat wall can be
climbed with chained wall jumps.

---

## URL parameters

| Parameter | Effect |
|---|---|
| `?online=true` | Connect to the game server and use the authoritative netcode |
| `?ai=true` | Make the local fighter AI-driven (works online **and** offline) |

---

## Debug console hooks

Open DevTools (F12):

```js
window.__gameState()            // HP, AI states, full playerPhys / enemyPhys
window.__toggleAIVsAI()         // same as pressing P
window.__physicsDiagnostic(5000) // collect 5s of frames, print a JSON report
```

---

## Automated diagnostics

The feedback-loop harness drives real browsers, handles two-tab matchmaking and
prints a digest:

```bash
npm run diagnose                                  # offline + online, 8s each
node scripts/diagnose.mjs --mode=online --runs=3  # stability check
node scripts/probe-online.mjs                     # raw console from one online client
```

A run is only healthy when `verdict` is `PASS` **and**
`collisionSummary.penetrationFrames` is 0. Also glance at `movementSummary` and
`playerMovement.xRange/yRange` — a fighter wedged in a corner is perfectly
jitter-free. See [the feedback-loop skill](../.agents/skills/feedback-loop/SKILL.md).

Unit tests are the faster inner loop for anything about collision, jump feel or
arena layout:

```bash
npx vitest run
```

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Connecting..." never clears | Game server is down. `npm run dev:herdr:status`, or `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:9208/.wrtc/v2/connections` |
| Online run reports `INVALID: no server snapshots received` | The harness caught a dead server — start it and re-run |
| Server changes have no effect | `tsx` does not hot-reload; restart `npm run dev:server` |
| Port already in use | A previous background server survived. `npm run dev:herdr:down`, or `pkill -f "tsx server/index.ts"` |
| Both fighters idle in AI vs AI | Check `xRange`/`yRange` in the diagnostic — a fighter may be stuck on geometry |
