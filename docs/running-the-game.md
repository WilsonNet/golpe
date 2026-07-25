# Running the Game

Every way to launch Vento Áureo, and what each one is for.

- [Prerequisites](#prerequisites)
- [Starting the dev servers](#starting-the-dev-servers)
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

Your fighter is predicted locally and reconciled by rewind-and-replay, so it
responds instantly; the opponent is interpolated 150ms in the past for
smoothness. Measured client/server disagreement is 0.00px. At 0 HP the server
waits 1.5s, resets both fighters and broadcasts `round-reset`.

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
| *(none)* | Solo match against a server-hosted bot |
| `?online=true` | Wait for a human opponent instead of a bot |
| `?ai=true` | Make **your** fighter AI-driven |
| `?offline=true` | Escape hatch: no server, no netcode (unsupported) |

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
node scripts/diagnose.mjs --mode=online --runs=3  # the canonical run
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
