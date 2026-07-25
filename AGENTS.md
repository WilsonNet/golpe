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
[netcode](specs/netcode.md).

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
- **Never simulate a tick the client did not send.**
- **Anything `server/` reaches through must be an explicit named export** — both
  `export default` and `export *` silently resolve to the wrong thing, and `tsc`
  cannot see either.
- **Never freeze frames on impact.** Hitstop desyncs; fake it in the renderer.
- **Changing gravity or jump velocity changes level reachability** — and retunes
  combat, because the uppercut's launch is derived from the jump.

## Commands

```bash
npm run dev:herdr        # both servers in visible panes, waits for the ports
npm run dev:herdr:logs   # read their output
npm run dev:herdr:down

npx tsc --noEmit && npx vitest run && npx vite build   # after any change
node scripts/diagnose.mjs --mode=online --runs=3       # the feedback loop
node scripts/verify-modes.mjs                          # smoke-check every mode
```

- Ports: Vite **8080**, Geckos **9208**.
- **Restart the server after touching `server/` or `src/game/simulation/`** —
  tsx does not hot-reload.
- **Never background the servers with `&`.** A detached server is invisible when
  it dies, and `pgrep -f "tsx server/index.ts"` matches its own shell. Load the
  `herdr-dev-workspace` skill.

## Controls

**WASD** move/jump · **LMB** slash (hold 420ms then release = Massive Strike) ·
**RMB** block · **F** uppercut · **Q/E** sword/gun stance · **P** toggle AI vs AI.
Sword is the default stance.

Buttons are passed to the simulation raw — it does its own press-edge detection,
and edge-detecting in the scene too would desync client and server.

## Skills

Every skill lives in `.agents/skills/<name>/SKILL.md` and is loaded with
`skill({ name: "<name>" })`. Keep this list in sync — the `knowledge-sharpener`
skill verifies it.

- **`feedback-loop`** — Diagnosing physics jitter, network desync, projectile or
  combat bugs. The canonical test is online AI vs AI.
- **`herdr-dev-workspace`** — Starting, inspecting or stopping the dev servers in
  visible herdr panes instead of background processes.
- **`specs`** — Keeping `specs/` authoritative: read before implementing, update
  in the same commit as any behaviour change.
- **`knowledge-sharpener`** — Run at the END of a substantial session: fold what
  was learned into the docs and skills, and verify the indexes.

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
