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
[controls](specs/controls.md) · [training room](specs/training-room.md) ·
[ultimate](specs/ultimate.md).

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
  The ultimate's cinematic is the one exception, and only because the *server*
  declares the frozen tick range and nobody simulates through it.
- **The black hole's pull is an argument to `tickPlayer`**, and the friendly-fire
  rule is one predicate (`fieldAffects`). A pull applied on top of predicted
  state is erased by the next reconciliation.
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
  touch a cursor or a stick, so the mouse must be measured with
  `scripts/aim-probe.mjs` at `--dpr=2`, and controller mode with
  `scripts/pad-probe.mjs`.
- **Every input device speaks one alphabet.** Keys, `Mouse0`, `Pad0`/`PadUp` and
  the on-screen deck are all code strings in one namespace, so an action asks "is
  any of my codes held" once. A device with its own code path is a device that
  quietly stops being rebindable.
- **The gamepad has no events — it is polled**, in `Input.poll`, once per frame
  before anything reads an aim. Press edges are derived against the previous
  frame's set, or holding a direction reads as a dash sixty times a second.
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
node scripts/pad-probe.mjs                             # controller aim, gamepad and the phone deck
node scripts/training-probe.mjs                        # one interaction, against a scripted dummy
node scripts/dash-probe.mjs                            # double-tap dash delivery, at a forced frame rate
node scripts/screens-probe.mjs                         # ?screen=N room: spawn spread + follow camera
node scripts/ultimate-probe.mjs                        # the black hole: hold to aim, release to cast, freeze, capture
```

Both `diagnose.mjs` and `deathmatch-probe.mjs` take `--screens=N` to run their
measurement on a wide arena — the follow camera and the wide-world spawns are
part of what they must prove.

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

**WASD/Space** move/jump (**jump again in the air** = double jump) ·
**double-tap A/D** dash · **LMB** slash (hold 420ms then release = Massive
Strike) · **Shift** block · **F** uppercut · **Q/E** sword/gun stance · **P**
toggle AI vs AI · **hold Tab** scoreboard · **Esc** menu. Sword is the default
stance.

**Every button is rebindable, and these are only the defaults.** Esc → Controls
captures the key, mouse button *or gamepad button* you press. Bindings live in
`localStorage`, never on the wire — the simulation is handed `block`, never
`ShiftLeft`. A DOM overlay that takes the keyboard must emit `input-suspended`,
or the canvas keeps playing the game with keys meant for the dialog. Nothing in
AI vs AI presses a key, so bindings are measured with
`scripts/controls-probe.mjs`. See [specs/controls.md](specs/controls.md).

**Aiming is a scheme, and there are two.** *Mouse* points at a place. *Controller*
is two layers: the d-pad or left stick gives Contra directions with the
same input that moves you — an analog stick aims at the angle it is pushed,
more than eight directions; only the d-pad is stuck with eight — and the right
stick, or a **relative mouse** for a trackpad, overrides it with the full 360°,
then eases back after **900ms**. The
virtual stick **rotates along the rim** rather than clamping, which is what lets a
straight stroke reach the ceiling instead of crawling at 63°; it is Steam Input's
Mouse Joystick, and it is in `src/game/input/Aim.ts`. Switching scheme mid-match
cannot desync — the simulation gets an angle with no provenance.

**Controller mode draws the aim.** A beam out of the local fighter's chest —
**gold** for Contra, **cyan** while the fine layer overrides — because facing is
one bit and a controller has no cursor. Mouse mode does not get one: the cursor
already is the reticle. `src/game/render/AimLine.ts`, drawn from the *drawn*
position like the nameplates.

**Mobile is controller mode plus a deck.** `pointer: coarse` starts a client in
controller mode with an on-screen gamepad: a Game Boy shell filling the half of a
portrait phone a 4:3 game leaves empty, dissolving into the letterbox margins in
landscape. The screen itself has **no bezel** — a fixed 800x600 arena scaled to
fit means every framed pixel is arena nobody can see. **The deck emits `Pad…`
codes**, the same ones a real controller sends, so it is rebindable for free. It
is a **separate setting** from the scheme so that a phone with a Bluetooth
keyboard can turn it off — and it carries its own menu button, because a phone has
no Escape key.

**DOM the player presses is not the game surface.** `Input`'s `pointerdown` is on
`window`, and `Mouse0` is attack — so until it was gated on `e.target === canvas`,
every button on the deck swung the sword as well as doing its own job. Likewise
`movementX` exists on *touch* pointers, so the relative-mouse aim layer is
filtered to `pointerType === "mouse"` or a thumb sliding on the d-pad aims 180°
wrong. Both are only reachable with real touch events — drive the deck with CDP,
never `page.mouse`.

**A slash is the first of three.** Tap again as each swing's hitbox closes and the
chain runs right-to-left diagonal → left-to-right diagonal → overhead finisher,
which knocks down for a little bonus damage. **The chain needs both feet on the
floor**, the first two links cancel into a block and the finisher does not, **and
a cancel always drops the chain** — so the butterfly is an endless opener loop and
walking the chain is a separate decision. It ends in neutral by construction.
Every landed sword hit disables its target and is drawn that way. See [specs/melee.md](specs/melee.md).

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

**There is one ultimate: a black hole grenade, on R.** Earned Overwatch-style
(1.4 charge/s passive, 0.8 per point of damage dealt, 12 a kill; it survives
death), spent at the **release** of a hold: holding R raises a special aim — the
grenade's own arc traced to its landing — and releasing casts. The cast
**freezes the whole room for 1100ms** behind a portrait card — the only legal
frame freeze in the game, and legal only because
the *server* declares the tick range and neither side simulates through it. The
freeze ends, the grenade launches along the angle you released on, and it arcs:
780 px/s under 860 px/s² gravity, so **707px is as far as it can be thrown** and
choosing the arc is the skill. Where it lands, a singularity holds for 2200ms —
168px event horizon (caught: no gravity, no steering, stunned), 260px outer reach
(a tug you can dash out of), 5 damage every 250ms. **The caster is immune to
their own hole**, and that exclusion is one predicate. The pull is an argument to
`tickPlayer`, so a caught fighter's own client predicts it. `?ultCharge=N` is a
creator-only charge floor — the practice-room flag. See
[specs/ultimate.md](specs/ultimate.md).

**Bots are opt-in.** A room has none unless asked: `?bots=N` seats N to fight,
`?fill=N` keeps the room at N fighters with bots as ballast, and neither means
humans only — still up to sixteen of them. `?scoreLimit`/`?timeLimit` shorten a
match for a probe. All four are honoured only for the client that *creates* the
room. **`?screen=N` widens the arena to N 800px screens** (1–8) — the same
creator-only rule, with the follow camera capping at 12px/frame so scroll never
reads as camera jitter. See [specs/deathmatch.md](specs/deathmatch.md) and
[specs/arena.md](specs/arena.md).

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
- **`hud-design`** — The in-match HUD: the canvas/DOM split, the Chrono Trigger /
  Fire Emblem design language, the `hud-state` contract, container-unit sizing,
  damage feedback, and the gotchas that made the first HUD invisible.
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
