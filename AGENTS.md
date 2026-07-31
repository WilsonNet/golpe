# Vento Áureo

An online-first 2D sword-fighting game: GunZ: The Duel's K-Style, rebuilt in two
dimensions on a deterministic simulation shared by client and server.

**This file is an index.** It holds only what every session needs; everything
else lives one link away and is loaded when it is actually relevant.

## ████████████████████████████████████████████████████
## ██  THE FEEDBACK LOOP IS THE MOST IMPORTANT PART  ██
## ██  ALL FIXES MUST BE VERIFIED THROUGH MEASUREMENT ██
## ████████████████████████████████████████████████████

**Never guess at a fix. Measure, change, measure again** — and the second
measurement must move the metric you targeted.

**If there is no instrumentation to measure it, build the instrumentation.**
That is the first step of the loop, not a preliminary to it. Jitter alone could
not see moon-gravity jumps, players walking through walls, an AI wedged in a
corner, stuttering projectiles, or a sword system whose blocks and parries never
once happened. Every metric exists because a bug was invisible without it.

**Test online, in AI vs AI.** `node scripts/diagnose.mjs --mode=online --runs=3`
is the canonical run. An offline PASS proves nothing about prediction,
reconciliation or projectiles, which is where the real bugs live.

**And test in a room full of AI.** `node scripts/deathmatch-probe.mjs` plays
sixteen bots to a winner. A duel cannot see what only breaks at scale — snapshot
size, a quadratic hitbox pass, fighters joining mid-match, or a metric that
silently assumed there was exactly one opponent.

```
skill({ name: "feedback-loop" })    # the full workflow
```

## Where to look

| Question | File |
|---|---|
| What should the game *do*? | [`specs/`](specs/README.md) — the source of truth |
| What rule will I break if I'm careless? | [`docs/invariants.md`](docs/invariants.md) |
| Where does this code live, and who owns it? | [`docs/architecture.md`](docs/architecture.md) |
| How do I measure anything? | [`docs/diagnostics.md`](docs/diagnostics.md) + the `feedback-loop` skill |
| How do I run the game? | [`docs/running-the-game.md`](docs/running-the-game.md) |
| Why are there symlinks everywhere? | [`docs/agent-config.md`](docs/agent-config.md) |

**`specs/` is the source of truth for behaviour.** Code is volatile; intent
stated in English survives. **Change behaviour, change the spec, in the same
commit** — and tuning a constant counts as changing behaviour. Read the relevant
spec before implementing: [movement](specs/movement.md) ·
[combat](specs/combat.md) · [melee](specs/melee.md) · [arena](specs/arena.md) ·
[deathmatch](specs/deathmatch.md) · [netcode](specs/netcode.md) ·
[training room](specs/training-room.md).

## Tech Stack

PixiJS 8 (rendering) · miniplex (ECS, entity + render layer only) · React 19 (UI
overlay) · Vite 6 · TypeScript 5.7 strict · Geckos.io (WebRTC) authoritative
server · Vitest · Playwright.

**Custom AABB physics in `src/game/simulation/`.** Pixi draws; it does not
simulate. Input, the game loop and the camera are ours too — see the `pixi-*`
skills for what the engine does and does not provide.

**ECS stops at the entity and presentation layer.** The simulation stays plain
data and pure functions, because that is what makes rewind-and-replay a
three-line loop. Load the `ecs-architecture` skill before adding an entity,
component or system.

## The rules that bite

One line each; the war story behind every one is in
[`docs/invariants.md`](docs/invariants.md).

- **One simulation.** `src/game/simulation/` never imports a rendering engine,
  touches the DOM, or reads wall-clock time. Client and server run the same
  `tickPlayer`.
- **Systems read the simulation and write only presentation.** A system that
  wrote back into `body` would change authoritative state outside `tickPlayer`.
- **`specs/` is the source of truth.** Update it in the same commit.
- **Draw from the collider data**, and position sprites via `syncSpriteToBody` —
  bodies are top-left, sprites are centre-origin.
- **The server is the only judge of a hit**, bullet or sword. The client predicts
  the swing, never the outcome.
- **Never simulate a tick the client did not send.** That includes a *remote*
  fighter: `input: null` in a snapshot means the server froze it, so freeze it too.
- **Every fighter is simulated at the present instant.** Remotes carry their last
  known input forward and are rewound on each snapshot; nothing is interpolated
  into the past. Rollback depth is the local player's pending input count.
- **Anything drawn from a position the simulation did not produce is
  depenetrated first.** The render smoother offsets sprites off their bodies on
  purpose, and that offset can put one inside a ledge.
- **The snapshot is the only authority on who is present.** `roster` carries names
  and nothing else — datagrams are unordered, and a stale roster deleted fighters
  the newest snapshot contained.
- **A metric about "the opponent" must pin which opponent**, or the subject
  changes between frames and the metric reports the gap between two fighters as
  jitter. Check `rollback.primarySwitches` before believing `enemy_x`/`enemy_y`.
- **Add a field to `PlayerPosition` and the wire packer stops compiling.** That is
  deliberate: see `src/game/online/wire.ts`.
- **Anything `server/` reaches through must be an explicit named export** — both
  `export default` and `export *` silently resolve to the wrong thing, and `tsc`
  cannot see either.
- **Never freeze frames on impact.** Hitstop desyncs; fake it in the renderer.
- **A link's hitstun is set by the gap to the next link's hitbox.** Shorten one and
  the combo silently stops being a combo — nothing reports it but a defender who
  blocks the second hit. The chain also pierces melee iframes, and only the chain.
- **A landed hit must be visible on the fighter that took it.** A disabled state
  with no sprite for it read as nothing happening for an entire playtest.
- **Changing gravity or jump velocity changes level reachability** — and retunes
  combat, because the uppercut's launch is derived from the jump.
- **Anything that moves a fighter travels in the intent.** A dash applied
  straight to predicted state was erased by the next reconciliation.
- **AI vs AI cannot test aim.** The brains hand the simulation an angle and never
  touch a cursor, so anything about the mouse must be measured with
  `scripts/aim-probe.mjs`, at `--dpr=2`.
- **The dummy is an input source, never a simulation flag.** The training room
  adds a third input source beside the network queue and `EnemyBrain`, and
  nothing else. It is server-side because a client-side dummy would bypass the
  netcode it exists to test through.
- **A clean run is not a good run.** Read `arenaSummary` and the `meleeSummary`
  counters: every must-be-zero metric is satisfied by a build where nothing
  happens.

## Commands

```bash
npm run dev:herdr        # both servers in visible panes, waits for the ports
npm run dev:herdr:logs   # read their output
npm run dev:herdr:down

npm run verify           # typecheck (client AND server) + tests + build
npm run lint             # biome, across src/ server/ scripts/
node scripts/diagnose.mjs --mode=online --runs=3       # the feedback loop, in a duel
node scripts/deathmatch-probe.mjs                      # sixteen AI fighters, to a winner
node scripts/verify-modes.mjs                          # smoke-check every mode
node scripts/aim-probe.mjs                             # cursor, facing and shot direction
node scripts/training-probe.mjs                        # one interaction, against a scripted dummy
```

- Ports: Vite **8080**, Geckos **9208**.
- **`npm run typecheck` covers two projects.** `tsconfig.json` is client-only;
  `tsconfig.server.json` covers `server/`. Running bare `tsc` checks half the
  game — which is how the server's bots silently lost the ability to evade.
- **Restart the server after touching `server/`, `src/game/simulation/`,
  `src/game/characters/` or `src/game/training/`** — all four are inside
  `tsconfig.server.json` and tsx does not hot-reload. The client *does* reload,
  which makes a stale server look like a bug in your change.
- **Never background the servers with `&`.** A detached server is invisible when
  it dies, and `pgrep -f "tsx server/index.ts"` matches its own shell. Load the
  `herdr-dev-workspace` skill.

## Controls

**WASD** move/jump (**W again in the air** = double jump) · **double-tap A/D**
dash · **LMB** slash (hold 420ms then release = Massive Strike) · **RMB** block ·
**F** uppercut · **Q/E** sword/gun stance · **P** toggle AI vs AI · **hold Tab**
scoreboard. Sword is the default stance.

**A slash is the first of three.** Tap again as each swing's hitbox closes and the
chain runs right-to-left diagonal → left-to-right diagonal → overhead finisher,
which knocks down for a little bonus damage. **The chain needs both feet on the
floor**, the first two links cancel into a block and the finisher does not, and it
ends in neutral by construction. Every landed sword hit disables its target and is
drawn that way. See [specs/melee.md](specs/melee.md).

**An airborne dash is a flat line** — no gravity, same Y throughout — and the
**air jump refills only on landing**. Both change reachability, which is a rule
that bites: see [specs/movement.md](specs/movement.md).

**Every fighter carries a nameplate** — name and health bar, drawn in the world
above its head, keyed by the id the server scores it under. It reads the *drawn*
position, not the body, or it drifts by exactly the correction the render
smoother is hiding.

**A human client asks for a name before it connects** and remembers it in
`localStorage`. A script answers with `window.__setPlayerName(name)` — the same
event the modal fires. A client with `?ai=true` names itself and never blocks,
which is why every probe runs that way.

**Deathmatch is the mode.** Up to sixteen fighters, 21 frags or 5 minutes,
individual respawns.

**Bots are opt-in.** A room has none unless asked: `?bots=N` seats N to fight,
`?fill=N` keeps the room at N fighters with bots as ballast, and neither means
humans only — still up to sixteen of them. `?scoreLimit`/`?timeLimit` shorten a
match for a probe. All four are honoured only for the client that *creates* the
room. See [specs/deathmatch.md](specs/deathmatch.md).

**Rooms are addressed, not matchmade.** `?room=<uuid>` joins that room; no
`?room=` makes a new one, and the client writes the id into the address bar so the
URL is the invitation. **Two tabs at the same URL are in two different rooms unless
that URL names one** — every multi-client script passes an explicit `room`, with a
fresh id per run so consecutive runs cannot collide.

**`?training=true`** opens the training room: a scriptable practice dummy, a DOM
menu over the canvas, and `window.__training` for agents. No key toggles the
panel — it is a URL mode, and its header collapses it. See
[specs/training-room.md](specs/training-room.md).

**You face the cursor**, except through a swing's startup and active frames and
while stunned; the gun fires along the same angle. See
[movement](specs/movement.md) and [melee](specs/melee.md).

Buttons are passed to the simulation raw — it does its own press-edge detection,
and edge-detecting in the scene too would desync client and server.

## Skills

Every skill lives in `.agents/skills/<name>/SKILL.md` and is loaded with
`skill({ name: "<name>" })`. Keep this list in sync — the `knowledge-sharpener`
skill verifies it.

- **`feedback-loop`** — Diagnosing physics jitter, network desync, projectile or
  combat bugs. The canonical test is online AI vs AI; the training probe is the
  scalpel for a single interaction.
- **`herdr-dev-workspace`** — Starting, inspecting or stopping the dev servers in
  visible herdr panes instead of background processes.
- **`specs`** — Keeping `specs/` authoritative: read before implementing, update
  in the same commit as any behaviour change.
- **`knowledge-sharpener`** — Run at the END of a substantial session: fold what
  was learned into the docs and skills, verify the indexes, and review the
  routine itself — the run is evidence about the routine, and step 6 fixes it in
  the same commit.

### Engine and architecture reference

- **`ecs-architecture`** — Adding an entity, component or system, and the
  boundary that keeps the simulation out of ECS.
- **`pixi-application`** — The Pixi app, async init, the ticker, React mounting,
  and the Vite dep-optimiser trap.
- **`pixi-scene-graph`** — Containers, anchors, draw order, layers and the camera.
- **`pixi-assets`** — Loading textures, slicing sheets, generating placeholder art.
- **`pixi-graphics`** — The v8 shape-then-style API, and when to bake to a texture.
- **`pixi-effects`** — Particles, blend modes, filters, screen shake, and why
  hitstop is unavailable here.
- **`pixi-text-and-ui`** — Text, HUD layers, and the canvas/DOM split.
- **`pixi-input`** — Keyboard and pointer input, world coordinates, and why edge
  detection belongs in the simulation.
