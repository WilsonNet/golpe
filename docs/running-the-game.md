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

Node.js is required. Two ports are used, and **both bind every interface**, so
either is reachable from another machine on the network:

| Port | Process | Needed for |
|---|---|---|
| 8080 | Vite dev server | everything |
| 9208 | Geckos.io game server | every mode except `?offline=true` |

The client connects to the game server at `location.hostname:9208`, so whatever
address a player loads the page from is the address their game traffic uses too.
That is why `localhost` works only on the host machine.

Your LAN address:

```bash
ip -4 addr show scope global | grep inet     # Linux
```

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

**Rooms are addressed, not matchmade.** Opening the game with no `?room=` makes a
new room; opening it with `?room=<id>` puts you in *that* room. So one person
hosts and everyone else follows their link.

1. Start both servers, and make sure port **8080** and port **9208** are both
   reachable from wherever the players are. The client connects to the game server
   at `location.hostname:9208`, so anyone typing your machine's address or hostname
   in the browser gets there — but `localhost` will not work from another machine.
2. **One person opens** `http://<your-host>:8080/?online=true`. The address bar
   immediately gains a `?room=<uuid>`, and the name popup shows that link with a
   **Copy** button.
3. **They send that link to everyone else.** Anyone who opens it lands in the same
   room. Opening the bare URL instead makes a *different* room — that is the one
   mistake to watch for, and holding Tab shows the room id so it is easy to check.
4. Each player **types a name** and presses *Enter the arena*. It is remembered, so
   they only do it once per browser.

**Bots are opt-in**, so the room holds exactly the people in it. If you would
rather not wait around for a full arena, the host adds bots when they create the
room — they are named, they play like anyone else, and each one leaves as a human
takes its seat:

```
http://<host>:8080/?fill=16     # keep the arena at 16 fighters, bots as ballast
http://<host>:8080/?fill=8      # ...or 8
```

Only the host's link decides. Everyone else just follows it.

> On a plain-HTTP address the browser blocks the modern clipboard API, so **Copy**
> falls back to selecting the link — press Ctrl+C if it says to. The link in the
> address bar is always correct either way.

While playing:

- **Hold Tab** for the scoreboard — every fighter, frags and deaths, your own row
  highlighted, bots marked `BOT`, and the room id in the header so you can tell
  whether the friend who said "I'm in" is in *this* room.
- The fight HUD — a minimal DOM overlay in the arena's own colours — keeps your
  HP, your frags against the limit, the clock, your stance and your ultimate
  charge, with a mirrored panel for your opponent in a duel.
- When the match ends, a **podium** shows first, second and third by name and the
  rest of the field in a table. The next match starts 15 seconds later, with scores
  zeroed and fresh bot personalities.


## Game modes

**This game is online first.** Every mode below except the escape hatch runs
through the authoritative server — including single player, where the server
fills the other slot with a bot. Playing the game is dogfooding the netcode.

All are the same build, selected by URL. The game server on :9208 is required
for everything except `?offline=true`.

| Mode | URL | Tabs |
|---|---|---|
| Empty room | `http://localhost:8080/` | 1 |
| Player vs AI (solo) | `http://localhost:8080/?bots=1` | 1 |
| AI vs AI | `http://localhost:8080/?ai=true&bots=1` | 1 |
| Sixteen-fighter deathmatch | `http://localhost:8080/?ai=true&bots=15` | 1 |
| Player vs Player | `http://localhost:8080/?online=true` + the room link | 2 |
| AI vs AI, two clients | `?online=true&ai=true&room=x` | 2 |
| Offline escape hatch | `http://localhost:8080/?offline=true` | 1 |

`?ai=true` makes *your* fighter AI-driven. **`?bots=N` is what puts bots in the
room** — without it there are none, so the bare URL is an empty arena. Two tabs
only share a match if they share a `?room=`.

### 1. Player vs AI (solo)

```
http://localhost:8080/?bots=1
```

You control your fighter; the other is a **server-hosted bot** running the same
`EnemyBrain`. This is a real online match — same rooms, same authoritative tick,
same prediction and reconciliation as PvP — so playing solo exercises the whole
netcode path.

**`?bots=1` is required, not decoration.** Bots are opt-in, so the bare URL gives
you an empty room. That is a legitimate mode of its own — fully served, predicted
and reconciled, with nobody else in it — and it is what `aim-probe.mjs` measures
in, because a bot closing to melee range eats the measurement.

### 2. AI vs AI

```
http://localhost:8080/?ai=true&bots=1
```

Your fighter is AI-driven and the opponent is a server bot, so you get a full
AI vs AI match **in a single tab**. Both brains use randomised configs, so each
match plays differently. Press **P** to toggle your own fighter's AI, or call
`window.__toggleAIVsAI()`.

For a whole arena of it, ask for more: `?ai=true&bots=15` is the canonical
sixteen-fighter test.

### 3. Player vs Player

```
http://localhost:8080/?online=true                       # the host opens this
http://localhost:8080/?online=true&room=<the same uuid>   # everyone else follows
```

The host's address bar gains a `?room=<uuid>`; **that link is the invitation.**
Two tabs at the bare URL are two separate rooms, because rooms are addressed
rather than matchmade. No bots unless the host asked for them.

The room holds up to sixteen fighters. Add `&fill=16` when creating it if you want
bots making up the numbers until people arrive — each one gives up its seat as a
human takes it.

Every fighter is predicted locally and rolled back when the server disagrees —
yours from your own input, everyone else's from the last input the server reported
for them — so nothing on screen is drawn in the past. Measured client/server
disagreement for your own fighter is 0.00px. At 0 HP you are down for 2s and then
respawn at the point furthest from anyone alive; nobody else is interrupted.

> Local same-keyboard hotseat is **not** supported — PvP is online only. Two
> tabs on one machine is fine for testing.

### 4. AI vs AI across two clients

```
http://localhost:8080/?online=true&ai=true&room=duel    # both tabs, same room
```

Two real clients, each with an AI fighter. **This is the canonical mode for the
physics harness** — it exercises prediction, reconciliation, remote rollback and
projectile rendering across two connections at once. No bots, so the room holds
exactly the two clients.

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
| **W** / **Space** | Jump — hold for height, release early to cut the arc |
| **A** / **D** | Move left / right |
| Double-tap **A** / **D** | Dash |
| **Mouse** | Aim — **you face where you aim**, which is how you keep your guard toward an attacker while retreating |
| **Arrows** | The keyboard's d-pad: left/right move, up/down aim in controller mode |
| **P** | Toggle AI vs AI |
| **Esc** | Menu — and the controls dialog, where every button here can be rebound |

A gamepad, a trackpad and a touchscreen all play this too — see *Playing with a
controller, a trackpad, or a phone* below.

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
| **Shift** (hold) | **Block** | — |
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

### Playing with a controller, a trackpad, or a phone

**Esc → Controls → Aiming** switches between the two schemes.

- **Mouse** — you face the cursor. The default on anything with a real pointer.
- **Controller** — the d-pad or left stick aims with the same
  input that moves you. An analog stick aims at the angle it is pushed — more
  than eight directions — while the d-pad is stuck with eight; and the right
  stick overrides it with the full 360° until
  you let go. On a laptop with no controller, *sliding the mouse* drives that
  right stick, which is what makes the game playable on a trackpad.

A gamepad works with no setup beyond flipping that switch: the defaults put jump
on A, slash on X, uppercut on Y, block on the left trigger and the stances on the
shoulders, and the controls dialog will capture a pad button into any slot.

**Controller mode draws a beam** out of your fighter showing where it is aiming —
gold for the Contra aim, turning cyan while the right stick (or the
thumb pad) is overriding it, and fading back to gold as that hands over. Mouse
mode has no beam, because the cursor is already telling you the same thing.

**On a phone**, the game starts in controller mode and draws a Game Boy-shaped
deck in the half of a portrait screen the 4:3 arena leaves empty; turn the phone
sideways and the controls move into the letterbox margins instead. The deck has
its own **Menu** button, because a phone has no Escape key. The left thumb works
a round analog pad — move, and aim at whatever angle it is held — and the right
thumb works the aim pad, which overrides the aim with the full 360° *and*, in gun
mode, fires the gun: there is no spare finger for a fire button, so the pad is
the trigger too, and a phone gun plays as a twin-stick shooter. The deck also
**swaps its buttons with the stance**: block and uppercut are sword moves, so a
gunner is not shown buttons that do nothing.

**Attach a Bluetooth keyboard and mouse to that phone** and you can go straight
back to the normal scheme: set *Aiming* to Mouse, or set *On-screen gamepad* to
Off. They are two separate settings precisely so that this works.

### Rebinding

**Esc** opens the menu, and *Controls* opens the binding dialog: click a slot,
press the key, mouse button or gamepad button you want, and that is the binding.
Escape cancels a capture, right-click clears a slot, and *Reset to defaults* puts
everything back. There are three slots per action — a key, an alternate and a pad
button — and bindings are kept in `localStorage` per browser.

The menu **does not pause the match** — the server is authoritative and the other
fifteen fighters are still swinging. What it does is take the keyboard away from
the game, so choosing a key does not also play the game with it.

Defaults and the reasoning behind them are in
[`specs/controls.md`](../specs/controls.md).

---

## URL parameters

| Parameter | Effect |
|---|---|
| *(none)* | A new room, one server-hosted bot |
| `?room=<id>` | Play in that room. **This is how two people meet** |
| `?online=true` | Vestigial — every room is online. Kept for older links |
| `?bots=N` | **N bots to fight. Absent means none** |
| `?fill=N` | Keep the room at N fighters, bots as ballast |
| `?ai=true` | Make **your** fighter AI-driven (and skip the name prompt) |
| `?mode=tdm` | **Team deathmatch**: two sides, no friendly fire, wipe-out rounds, first to 15. Forces the arena to at least 3 screens |
| `?freezeTime=S` | Seconds of freezetime before each team round (default 4, `0` for none) |
| `?screen=N` | Widen the arena to N 800px screens (1-8) |
| `?scoreLimit=N` | Frags to win — **rounds** to win in `tdm` |
| `?timeLimit=S` | Match length in seconds |
| `?training=true` | A scriptable practice dummy and its menu |
| `?offline=true` | Escape hatch: no server, no netcode (unsupported) |

`mode`, `screen`, `freezeTime`, `fill`, `scoreLimit` and `timeLimit` are honoured **only for
the client that creates the room** — everyone arriving later gets the room as it already is. One
player must not be able to resize or end a match everybody else is playing.

---

## Debug console hooks

Open DevTools (F12):

```js
window.__gameState()            // HP, AI states, full playerPhys / enemyPhys
window.__matchState()           // scores, clock, winner, rollback and bandwidth
window.__setPlayerName("Bob")   // answer the name prompt from a script
window.__toggleAIVsAI()         // same as pressing P
window.__physicsDiagnostic(5000) // collect 5s of frames, print a JSON report
window.__aimState()             // cursor, aim angle, facing and live shot headings
window.__inputState()           // scheme, deck, and both controller aim layers
window.__setInputScheme("controller")  // the same store the Esc menu writes
```

---

## Automated diagnostics

The feedback-loop harness drives real browsers, handles two-tab matchmaking and
prints a digest:

```bash
node scripts/diagnose.mjs --mode=online --runs=3  # the canonical duel
node scripts/deathmatch-probe.mjs                 # 16 AI fighters, played to a winner
node scripts/tdm-probe.mjs                       # two sides, wipe-out rounds, no friendly fire
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
