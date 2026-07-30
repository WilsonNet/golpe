# Running the Game

Every way to launch Vento Áureo, and what each one is for.

- [Prerequisites](#prerequisites)
- [Starting the dev servers](#starting-the-dev-servers)
- [Playing with real people](#playing-with-real-people)
- [Game modes](#game-modes)
  - [Player vs AI (solo)](#1-player-vs-ai-solo)
  - [AI vs AI](#2-ai-vs-ai)
  - [Player vs Player](#3-player-vs-player)
  - [AI vs AI across two clients](#4-ai-vs-ai-across-two-clients)
  - [Offline escape hatch](#5-offline-escape-hatch)
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
| 9208 | Geckos.io game server | every mode except `?offline=true` |

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
npm run dev          # Vite only  — enough for ?offline=true
npm run dev:server   # game server only
```

> **Avoid backgrounding these with `&`.** A detached server is invisible when it
> dies, and `pgrep -f "tsx server/index.ts"` matches its own shell command line,
> so it reports "running" when nothing is listening. That combination has already
> caused a physics diagnostic to report `PASS` against a dead server.

Restart the game server after editing anything in `server/` or
`src/game/simulation/` — `tsx` does not hot-reload.

---

## Playing with real people

The deathmatch is the mode: **sixteen fighters, first to 21 frags, or the best
score in five minutes.** Full rules in
[specs/deathmatch.md](../specs/deathmatch.md).

1. Start both servers, and make sure port **8080** and port **9208** are both
   reachable from wherever the players are. The client connects to the game server
   at `location.hostname:9208`, so anyone typing your machine's address or hostname
   in the browser gets there — but `localhost` will not work from another machine.
2. Send everyone `http://<your-host>:8080/?online=true`.
3. Each player **types a name** in the popup and presses *Enter the arena*. It is
   remembered, so they only do it once per browser.
4. Empty seats are filled with named bots, and each bot leaves as a human takes its
   place. Nobody ever waits for a match to start.

While playing:

- **Hold Tab** for the scoreboard — every fighter, frags and deaths, your own row
  highlighted, bots marked `BOT`.
- The canvas HUD keeps your HP, your frags against the limit, and the clock.
- When the match ends, a **podium** shows first, second and third by name and the
  rest of the field in a table. The next match starts 15 seconds later, with scores
  zeroed and fresh bot personalities.

Sizing a room, if you want something other than sixteen:

```
http://<host>:8080/?online=true&fill=8    # a public room held at 8 fighters
http://<host>:8080/?bots=3                # your own private room, 3 bots
http://<host>:8080/?bots=0                # your own private empty room
```

## Game modes

**This game is online first.** Every mode below except the escape hatch runs
through the authoritative server — including single player, where the server
fills the other slot with a bot. Playing the game is dogfooding the netcode.

All are the same build, selected by URL. The game server on :9208 is required
for everything except `?offline=true`.

| Mode | URL | Tabs |
|---|---|---|
| Player vs AI (solo) | `http://localhost:8080/` | 1 |
| AI vs AI | `http://localhost:8080/?ai=true` | 1 |
| Player vs Player | `http://localhost:8080/?online=true` | 2 |
| AI vs AI, two clients | `http://localhost:8080/?online=true&ai=true` | 2 |
| Offline escape hatch | `http://localhost:8080/?offline=true` | 1 |

`?ai=true` makes *your* fighter AI-driven. `?online=true` asks for a human
opponent; without it the server supplies a bot.

### 1. Player vs AI (solo)

```
http://localhost:8080/
```

The default. You control the left fighter; the right one is a **server-hosted
bot** running the same `EnemyBrain`. This is a real online match — same rooms,
same authoritative tick, same prediction and reconciliation as PvP — so playing
solo exercises the whole netcode path.

### 2. AI vs AI

```
http://localhost:8080/?ai=true
```

Your fighter is AI-driven and the opponent is a server bot, so you get a full
AI vs AI match **in a single tab**. Both brains use randomised configs, so each
round plays differently. Press **P** to toggle your own fighter's AI, or call
`window.__toggleAIVsAI()`.

### 3. Player vs Player

```
http://localhost:8080/?online=true      # open in two tabs or two browsers
```

Waits for a second human rather than spawning a bot. You'll see
`[ONLINE] Matched in room room-N!` and the "Connecting..." overlay clears once
both are present.

This is the **public deathmatch**: the room holds sixteen fighters and is topped
up with bots, so it is never empty, and a bot gives up its seat as each human
arrives. Everyone shares the same room until it fills.

Every fighter is predicted locally and rolled back when the server disagrees —
yours from your own input, everyone else's from the last input the server reported
for them — so nothing on screen is drawn in the past. Measured client/server
disagreement for your own fighter is 0.00px. At 0 HP you are down for 2s and then
respawn at the point furthest from anyone alive; nobody else is interrupted.

> Local same-keyboard hotseat is **not** supported — PvP is online only. Two
> tabs on one machine is fine for testing.

### 4. AI vs AI across two clients

```
http://localhost:8080/?online=true&ai=true    # two tabs
```

Two real clients, each with an AI fighter. **This is the canonical mode for the
physics harness** — it exercises prediction, reconciliation, interpolation and
projectile rendering across two connections at once.

### 5. Offline escape hatch

```
http://localhost:8080/?offline=true&ai=true
```

Bypasses the server entirely, for working without one. **Not a supported mode**:
it skips prediction, reconciliation and server-owned bullets, so a clean result
here says nothing about the netcode.

> Online damage is applied server-side and is **not** logged as `[FIGHT]` — read
> HP from `window.__gameState()` to confirm a fight is really happening.

---

## Controls

### Movement

| Input | Action |
|---|---|
| **W** | Jump — hold for height, release early to cut the arc |
| **A** / **D** | Move left / right |
| Double-tap **A** / **D** | Dash |
| **Mouse** | Aim — **you face where you aim**, which is how you keep your guard toward an attacker while retreating |
| **P** | Toggle AI vs AI |

Jumping is forgiving on both sides of a ledge: 100ms of coyote time after
walking off, and a 120ms jump buffer before landing. While airborne and touching
a wall, jump again to wall jump — world edges count, so a flat wall can be
climbed with chained wall jumps.

### Combat

**Q** draws the sword, **E** the gun. **Sword is the default** — this is a sword
game, and the gun answers a range problem.

| Input | Sword | Gun |
|---|---|---|
| **Left click** (tap) | Slash | Fire |
| **Left click** (hold ~420ms, then release) | **Massive Strike** | Fire |
| **Right click** (hold) | **Block** | — |
| **F** | **Uppercut** | — |

The three things worth knowing before your first match:

- **Cancel your slash into a block.** Only the slash can be cancelled, and doing
  it the instant the swing lands cuts 330ms down to ~160ms while leaving you
  guarding. That is the *butterfly*, and it is the correct way to apply pressure.
- **Blocking early beats blocking late.** The first 140ms of a *fresh* block is a
  parry window: absorb a swing inside it and the attacker is guard-broken and you
  get a free Massive Strike. Holding block never re-arms it.
- **A guard only covers the side you face.** The answers to a turtle are the
  uppercut (unblockable, launches them) and simply getting behind them — a
  backstab ignores the guard entirely.

Heavy moves are a commitment: the Massive Strike and the uppercut cannot be
cancelled and root you where you stand, so whiffing one loses the exchange.

Full frame data and the reasoning behind every number is in
[`specs/melee.md`](../specs/melee.md).

---

## URL parameters

| Parameter | Effect |
|---|---|
| *(none)* | Your own room, one server-hosted bot |
| `?online=true` | The public 16-fighter deathmatch, shared with other humans |
| `?bots=N` | Bots in your own room, 0-15. `0` is an empty room |
| `?fill=N` | Hold a public room at N fighters instead of 16 |
| `?ai=true` | Make **your** fighter AI-driven (and skip the name prompt) |
| `?scoreLimit=N` | Frags to win. **Private rooms only** |
| `?timeLimit=S` | Match length in seconds. **Private rooms only** |
| `?training=true` | A scriptable practice dummy and its menu |
| `?offline=true` | Escape hatch: no server, no netcode (unsupported) |

`scoreLimit` and `timeLimit` are refused on a public room on purpose — one client
must not be able to end everybody else's match early.

---

## Debug console hooks

Open DevTools (F12):

```js
window.__gameState()            // HP, AI states, full playerPhys / enemyPhys
window.__matchState()           // scores, clock, winner, rollback and bandwidth
window.__setPlayerName("Bob")   // answer the name prompt from a script
window.__toggleAIVsAI()         // same as pressing P
window.__physicsDiagnostic(5000) // collect 5s of frames, print a JSON report
```

---

## Automated diagnostics

The feedback-loop harness drives real browsers, handles two-tab matchmaking and
prints a digest:

```bash
node scripts/diagnose.mjs --mode=online --runs=3  # the canonical duel
node scripts/deathmatch-probe.mjs                 # 16 AI fighters, played to a winner
npm run diagnose                                  # offline + online, 8s each
node scripts/verify-modes.mjs                     # smoke-check every launch mode
node scripts/probe-online.mjs                     # raw console from one online client
```

Diagnose **online**. An offline PASS skips prediction, reconciliation and
server-owned bullets, which is where the bugs have been.

A run is only healthy when `verdict` is `PASS` **and**
`collisionSummary.penetrationFrames` is 0. Also glance at `movementSummary` and
`playerMovement.xRange/yRange` — a fighter wedged in a corner is perfectly
jitter-free — and `bulletSummary`, where `teleportFrames`/`frozenFrames` must be
0 and `maxStepRatio` should sit near 1.0. See [the feedback-loop skill](../.agents/skills/feedback-loop/SKILL.md).

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
