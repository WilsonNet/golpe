# golpe

An online-first 2D hero shooter: GunZ: The Duel's K-Style, rebuilt in two
dimensions on a deterministic simulation shared by client and server. Every
fighter is a **hero** — a composition of a melee weapon, a ranged weapon, a
unique ultimate and an item (see `specs/heroes.md`). Lia is the sword-and-rifle
reference kit; Anands is the dagger storm (see `specs/anands.md`).

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

**Test online, in AI vs AI.** `tsx scripts/diagnose.ts --mode=online --runs=3`
is the canonical run. An offline PASS proves nothing about prediction,
reconciliation or projectiles, which is where the real bugs live.

**And test in a room full of AI.** `tsx scripts/deathmatch-probe.ts` plays
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
| **Where do the balance numbers live?** | [`src/tweakables/`](src/tweakables/README.md) — every tuning constant, one folder |
| Who are the heroes, and how do kits work? | [`specs/heroes.md`](specs/heroes.md) · [`specs/anands.md`](specs/anands.md) |
| How do heroes interact with each other? | [`specs/interactions.md`](specs/interactions.md) — attributes, statuses, predicates, and the one rule for matchup exceptions |
| What are items, and how do charges work? | [`specs/items.md`](specs/items.md) |
| What should the menu do? | [`specs/menu.md`](specs/menu.md) — when it shows, and how choices become URLs |
| What happens when a match ends? | [`specs/play-of-the-game.md`](specs/play-of-the-game.md) — the reel, the camera edit, then the podium |
| What should the game sound like, and where does the music come from? | [`specs/audio.md`](specs/audio.md) · [`audio/README.md`](audio/README.md) — MIDI sources, the soundfont per track, the mixer |
| What rule will I break if I'm careless? | [`docs/invariants.md`](docs/invariants.md) |
| Where does this code live, and who owns it? | [`docs/architecture.md`](docs/architecture.md) |
| How do I measure anything? | [`docs/diagnostics.md`](docs/diagnostics.md) + the `feedback-loop` skill |
| How do I run the game? | [`docs/running-the-game.md`](docs/running-the-game.md) |
| How do I slice a raw art board into a game sheet? | [`docs/sprite-slicer.md`](docs/sprite-slicer.md) — the `?slicer=true` workshop |
| Why are there symlinks everywhere? | [`docs/agent-config.md`](docs/agent-config.md) |

# The same rules do not apply to every file — read the section that matches
# what you are about to touch. This is the index for the rest of the repo.

**`specs/` is the source of truth for behaviour.** Code is volatile; intent
stated in English survives. **Change behaviour, change the spec, in the same
commit** — and tuning a constant counts as changing behaviour. Read the relevant
spec before implementing: [movement](specs/movement.md) ·
[combat](specs/combat.md) · [melee](specs/melee.md) · [arena](specs/arena.md) ·
[deathmatch](specs/deathmatch.md) · [team deathmatch](specs/team-deathmatch.md) ·
[netcode](specs/netcode.md) ·
[controls](specs/controls.md) · [training room](specs/training-room.md) ·
[ultimate](specs/ultimate.md) ·
[play of the game](specs/play-of-the-game.md).

## Tech Stack

PixiJS 8 (rendering) · miniplex (ECS, entity + render layer only) · React 19 (UI
overlay, **auto-memoised by the React Compiler**) · Vite 8 · TypeScript 7 strict
· Geckos.io (WebRTC) authoritative server · Vitest · Playwright.

**The React overlay is compiled, not hand-optimised.** `babel-plugin-react-compiler`
runs in both vite configs through `@vitejs/plugin-react`'s `reactCompilerPreset`
plus `@rolldown/plugin-babel`, so components and hooks in `src/ui/` are memoised
automatically. Do not hand-write `useCallback`/`useMemo` for performance — write
plain components and let the compiler earn its keep; the pre-existing ones stay
until they are touched, not because they are wanted.

- **A compiled component must not read an external store mid-render.** The
  compiler memoises on the values a render reads; a `bindings.codesFor`-style
  read off a module singleton is invisible to it and freezes at first render,
  and a change event arriving at an *unread* `[, bump]` state changes nothing
  the JSX depends on. Snapshot the store into state
  (`useState(() => store.snapshot())` + resubscribe) and ask the snapshot with
  a pure predicate (`isDefaultBindings`, `deckVisibleFor`) — never the live
  store. War story: docs/invariants.md.
- **If the compiler memoises a closure an effect depends on, Biome still
  fires** — `useExhaustiveDependencies` cannot see the compiler. Suppress with
  a *single-line* parameterised comment directly above the deps line
  (`// biome-ignore lint/correctness/useExhaustiveDependencies(fn): closes
  over setters only — the compiler memoises it stably.`); a multi-line block
  or any other placement is reported as unused.

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
- **The hero kit is an argument to `tickPlayer`, never state.** The hero is a
  static property of the fighter, like the name — it travels in the snapshot
  beside `team`, and both sides pass `kitFor(hero)` into every tick and every
  replay. A kit applied on top of predicted state would be erased by the next
  reconciliation.
- **The hero is data; an interaction is a predicate over state and declared
  attributes.** No `hero === "anands"` anywhere in `simulation/` or `GameRoom`
  — a pairwise matrix is the O(n²) trap, and `Interactions.test.ts` greps for
  the first cell. A matchup exception is a tag on the move or ultimate (see
  [specs/interactions.md](specs/interactions.md)); presentation (HUD, menu,
  cinematic, the AI's animation picks) is the only place a per-hero branch
  belongs.
- **The stance enum is the slot, not the weapon.** `"sword" | "gun"` means
  melee weapon out or ranged weapon out; which weapon that slot means is the
  hero's business. The wire format never changes when a hero does.
- **The moves table is global; the weapon names its moves.** `stab` is the
  dagger's, `slash` is the sword's — the shared `MOVES` table keeps the
  phases, hitboxes and diagnostics weapon-agnostic, and `MeleeWeaponDef`
  decides which moves a weapon can start, whether Shift blocks or thrusts,
  and whether a charge exists.
- **Changing hero resets the ultimate meter.** Ultimates are unique per hero,
  and a free dragon thrust would be a cheese. The Esc menu's hero change goes
  to the server (reliable) and is **queued for the next new life** — the next
  respawn or the next round — never applied mid-fight; the echo comes home in
  the snapshot's `hero` the life the new kit actually starts.
- **Item charges are a per-life resource, server-owned like the ultimate's
  charge.** A use spends one charge on the press edge — there is no aim phase —
  and the charges travel in the snapshot beside `ult`. They reset on respawn
  and round reset, never in between; a hero change spends them for the new kit.
  The trap's *root* is `rootTimer` in `PlayerPosition` (both sides simulate it,
  like `freezeTimer`); the trap is single-use — the server destroys it the tick
  it springs, and the burst and "ROOTED!" caption are the server's alone. The
  catch zeroes the victim's velocity and burst state, so a dash, tumble or
  lunge caught mid-flight stops dead — no momentum carries a caught fighter
  out of the patch — and the root discards buffered jumps. It counters the
  dagger's body-carrying moves (thrust, shoryuken) but not the dragon-thrust
  ride: a rooted Anands can still cast her ultimate.
  Friendly traps (your own and teammates') are drawn faded, so the side a mine
  belongs to is read at a glance.
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
  `export default` and `export *` silently resolve to the wrong thing, and
  neither `tsc` nor knip can see through them: the explicit re-export block in
  `simulation/Physics.ts` is what keeps the server's imports compiling *and*
  keeps dead-code analysis honest.
- **Never freeze frames on impact.** Hitstop desyncs; fake it in the renderer.
  The ultimate's cinematic is the one exception, and only because the *server*
  declares the frozen tick range and nobody simulates through it.
- **The black hole's pull is an argument to `tickPlayer`**, and the friendly-fire
  rule is one predicate (`fieldAffects`). A pull applied on top of predicted
  state is erased by the next reconciliation.
- **A dragon cast is never zero ticks long, and each sweep latch belongs to one
  move.** The obstacle-end is committed to 200ms (`DRAGON_MIN_RIDE_MS`) in
  `tickPlayer`, so a release into the floor at your feet is a dug-in slam, not a
  spent ultimate that never fired; and the thrust's and dragon's one-hit-per-cast
  latches live apart, because sharing one meant each resolver deleted the other's
  the tick it was born and the dragon hit at 30 damage a tick.
- **Friendly fire is one predicate too, and every weapon asks it.** `hostile()`
  in `simulation/Teams.ts`. A weapon that compares teams itself is a weapon that
  disagrees with the sword the day the rule changes — and `team: null` is hostile
  to everything, which is the whole of how free-for-all keeps working unbranched.
- **Freezetime discards intent; it never stops the simulation.** A timer in
  `PlayerPosition` that both sides tick, exactly like death being a stun. The one
  legal frame freeze in this game is 1.1s long and server-declared for a reason.
- **A team is snapshot state, not roster state.** It is an argument to
  `tickPlayer` through the black hole; the roster is on a 2s heartbeat, so a lost
  one would mean seconds of dragging your own side into a hole.
- **A TDM round ends by wipe-out, and only once both sides have somebody in
  them.** Otherwise a room with one fighter wipes the empty side sixty times a
  second and wins before the second player has connected.
- **A team tint blends, it never replaces**, and the health bar is never tinted
  at all. Every combat colour is frame data; paint it flat and you know whose
  swing it was and no longer what it was.
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
  `scripts/aim-probe.ts` at `--dpr=2`, and controller mode with
  `scripts/pad-probe.ts`.
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
- **The Play of the Game replay is a projector, never a simulation.** It draws
  recorded `PackedState`, re-pointing the live entities *after* the live update
  has pointed them at prediction — last writer wins, and the next live frame
  restores itself. Re-simulating from recorded input would diverge from the match
  it is a replay of on the first floating-point difference.
- **Only the server may decide what the play was.** A play is kills, denies and
  round wipes, and no client sees all of them; a client-side reel gives sixteen
  people sixteen different ceremonies.
- **The announcement is a datagram; the footage is an HTTP fetch.** Every way the
  fetch can fail costs the replay and leaves the splash card standing. A clip on
  the realtime channel would be a few hundred kilobytes in a datagram.
- **The root URL is a menu; the menu is a URL generator, never a matchmaker.**
  It writes the launch request to the query string and the game boots because
  the URL now carries one — one parser (`online/launch.ts`) serves menu, boot
  and probes, so they cannot disagree. A launch key in the URL always boots
  straight into the match it asks for, menu or no menu: agents and shared links
  never see a click.

## Commands

```bash
pnpm run dev:herdr        # both servers in visible panes, waits for the ports
pnpm run dev:herdr:logs   # read their output
pnpm run dev:herdr:down

pnpm run verify           # typecheck (client AND server) + tests + build + dead-code (knip)
pnpm run lint             # biome, across src/ server/ scripts/
pnpm run knip             # unused exports/files/dependencies — run before believing the tree is lean
tsx scripts/diagnose.ts --mode=online --runs=3       # the feedback loop, in a duel
tsx scripts/diagnose.ts --mode=online --ultCharge=100 # ...and the bots cast their ultimates
tsx scripts/deathmatch-probe.ts                      # sixteen AI fighters, to a winner
tsx scripts/tdm-probe.ts                             # two sides, wipe-out rounds, no friendly fire
tsx scripts/tdm-probe.ts --ultCharge=100             # ...and the teams throw black holes
tsx scripts/verify-modes.ts                          # smoke-check every mode
tsx scripts/aim-probe.ts                             # cursor, facing and shot direction
tsx scripts/pad-probe.ts                             # controller aim, gamepad and the phone deck
tsx scripts/training-probe.ts                        # one interaction, against a scripted dummy
tsx scripts/training-probe.ts --hero=anands          # ...as the dagger (its rows are dagger-only)
tsx scripts/menu-probe.ts                            # the root menu: every click a URL, boots a match
tsx scripts/dash-probe.ts                            # double-tap dash delivery, at a forced frame rate
tsx scripts/screens-probe.ts                         # ?screen=N room: spawn spread + follow camera
tsx scripts/ultimate-probe.ts                        # the black hole: hold to aim, release to cast, freeze, capture
tsx scripts/potg-probe.ts                            # play of the game: the reel, the camera edit, the podium waiting
tsx scripts/audio-probe.ts                           # the sound loop: music latches, combat sfx fire, the mixer persists
python3 scripts/make-audio.py                        # re-render the music loops from their MIDI sources (→ public/audio/)
python3 scripts/make-potg-art.py                       # regenerate the ceremony's sunburst and medal
python3 scripts/make-anands-art.py                       # compose the second hero's hand-drawn art into the shipped sheets
python3 scripts/make-roll-art.py                      # regenerate the tumble strip from a hero sheet
```

Both `diagnose.ts` and `deathmatch-probe.ts` take `--screens=N` to run their
measurement on a wide arena — the follow camera and the wide-world spawns are
part of what they must prove.

- Ports: Vite **8084**, Geckos **9208**.
- **`pnpm run typecheck` covers two projects.** `tsconfig.json` is client-only;
  `tsconfig.server.json` covers `server/`. Running bare `tsc` checks half the
  game — which is how the server's bots silently lost the ability to evade.
- **Restart the server after touching `server/`, `src/game/simulation/`,
  `src/game/characters/`, `src/game/training/` or `src/game/online/wire.ts`** —
  all of them are inside `tsconfig.server.json` and tsx does not hot-reload. The
  wire is the nastiest: a stale server and a fresh client disagree about every
  packed field after the one you added, and it surfaces as a storm of melee
  prediction desyncs rather than as anything to do with the wire.
- **A dev pane that died still holds the port open.** `dev:herdr` polls the port
  and will report `ready :9208` for a server that exited with `EADDRINUSE` behind
  a zombie process — so the room you connect to is running your *previous* code.
  Read `tsx scripts/dev-herdr.ts logs server` before believing a probe that
  suddenly fails everywhere. And **never `pkill -f "tsx server/index.ts"`**: the
  pattern matches the agent's own shell, kills it mid-chain, and silently skips
  every command after it. The client *does* reload,
  which makes a stale server look like a bug in your change.
- **Never background the servers with `&`.** A detached server is invisible when
  it dies, and `pgrep -f "tsx server/index.ts"` matches its own shell. Load the
  `herdr-dev-workspace` skill.

## Controls

**WASD/Space** move/jump (**jump again in the air** = double jump) ·
**double-tap A/D** dash (melee stance) or tumble (gun stance) · **LMB** the
melee weapon's attack (hold 1.6s then release = Massive Strike for Lia — a
floor slam, or the plunge bomb if airborne) · **Shift** block (Lia) — or the
**thrust**, a knockdown lunge (Anands: the dagger has no block) · **Space**
uppercut (Lia) — or the **shoryuken** anti-air (Anands) · **F** the item —
Lia's HE grenade, Anands' floor trap (2 and 3 uses per life; see
[specs/items.md](specs/items.md)) · **Q/E**
sword/gun stance · **P** toggle AI vs AI · **hold Tab** scoreboard · **Esc**
menu. Sword is the default stance.

**Every gun has a magazine and an auto-reload, and ammo is finite per life**
— no manual key (R is the ultimate). Every weapon carries **`magazinesPerLife`
magazines** (all three ship at 4, tuned in `tweakables/ranged.ts`): one loaded,
the rest a reserve the reload draws from, so a **dry** gun (empty magazine, no
reserve) is done until the next life — the game's way of forcing the fight back
to the sword. The reload is the **TF2 pair**. **Clip weapons reload the whole
magazine in one action — full magazine or nothing** (the rifle's 890ms, the
machine gun's 1860ms): a single timer runs and the ammo does not move until it
completes, so an interruption produces nothing — a mid-reload stance switch
*resets all progress*, and a one-round top-up costs the same rack an
empty-to-full one does. **Shell weapons load one round per cycle** (the
shotgun: 1300ms for the rack from empty, 1200ms per shell after), and a landed
round is a real round — the partial reload that can shoot. The reload starts when the trigger is
released (or instantly on an empty magazine, even while held — the held
trigger fires the moment rounds land), firing aborts
it (TF2's clip-abort-by-fire: the rounds the magazine holds stay and the shot
goes, the load in progress is discarded), and a stance switch,
stun or death cancels it too — for a clip weapon nothing is kept and the next
reload starts from zero when the gun comes back out; the shotgun's loaded
shells survive a stance switch and its reload restarts from them. The ammo
count, reserve and reload bar live in the HUD's bottom-right corner — the count
reads **loaded/behind** (`12/36`), and DRY flashes where it stood when both hit
zero — and
`ammo` / `reserveRounds` / `reloadTimer` ride the wire **server-ticked only** —
the client draws them, never simulates them, exactly like the ultimate meter.
(The offline escape
hatch mirrors its own counters onto the body so the firing animation — an
ammo drop — reads the same in both modes.)

**Every button is rebindable, and these are only the defaults.** Esc → Controls
captures the key, mouse button *or gamepad button* you press — and the root
menu's *Options* opens the same dialog before a match exists, because a new
player should not have to guess that. Bindings live in
`localStorage`, never on the wire — the simulation is handed `block`, never
`ShiftLeft`. A DOM overlay that takes the keyboard must emit `input-suspended`,
or the canvas keeps playing the game with keys meant for the dialog. Nothing in
AI vs AI presses a key, so bindings are measured with
`scripts/controls-probe.ts`. See [specs/controls.md](specs/controls.md).

**The *Move list* is a Guilty Gear-style command list** — opened by the root
menu's Learn & settings (for the hero picked there) and the Esc menu's *Moves*
item: one move at a time, a category rail, live-keycap commands from the
player's *actual* bindings, a stat card, and a preview stage whose timeline
tracks the move's real frame data. It is a presentation module
(`src/ui/moveData.ts` + `src/ui/MoveList.tsx`) that reads the tuning constants
and never touches the simulation. See [specs/menu.md](specs/menu.md).

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

**The guard is strong, and the Massive is a 1.6-second commitment.** Every block
that stops a sword attack guard-breaks the attacker — a full second of the
helpless pose — and grants the defender a free Massive (fires on click, cyan,
4s to spend). The charge roots your walk while it fills (after 250ms) but keeps
dash and double-jump even then — and once it completes, walking returns: the
armed massive is carried, not endured, and delivery is the strategy. It dies to
a release before 1.6s, a hit, a stance switch or an ult. Released on the ground it
slams 56px in front and blasts 100px front *and back* of the slam point (the
**back massive**: turn away from a turtle and the blast stuns through their
guard); released in the air it becomes the **plunge bomb** — a 1500 px/s dive
that blasts bigger with the fall, stuns and knocks up through guards, and
plants the bomber in the ground afterwards (stuck, freed only by a melee hit).
The dive itself is a weapon: it **catches airborne enemies** in its column and
carries them down to be pinned by the landing blast, and it **cannot be
anti-aired** — a diving fighter is immune to melee, so the shoryuken and the
uppercut lose to it (only the black hole and the dragon thrust can stop a
dive). The swing itself is blockable: a front massive into a read guard is a gift, and
the uppercut is the third answer to a turtle. Sword damage pays double ultimate
charge.

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

**`?mode=tdm` is team deathmatch, and it is a different game.** Two sides
(AZURE/EMBER), **no friendly fire**, and a round that ends when one side is
**wiped out** — a dead fighter stays dead until it does. First to 15 rounds, and
a round is **4s of CS-style freezetime → the fight → a 5s cooldown → the arena
resets**. The arena has a **three-screen floor** and each side spawns on its own
**end screen**, because a losing team needs somewhere to retreat to.
Creator-only, like `?screen=`; `?freezeTime=S` shortens the countdown for a
probe. **Freezetime is not a pause** — it is `PlayerPosition.freezeTimer`
discarding the intent inside `tickPlayer`, so both sides predict the tick a round
goes live; the ultimate's simulation freeze is safe for 1.1s and would park
four seconds of input here. **The match clock stops during freezetime and cooldown,
but the win condition is still checked** — pausing both cost a whole extra round
before it was caught. **The friendly-fire rule is one
predicate** (`hostile` in `simulation/Teams.ts`) and every weapon asks it; a
fighter with `team: null` — every fighter in a free-for-all — is hostile to
everybody, so FFA falls out of the same code with no mode check in any damage
path. **Bots know by construction**: `nearestFoe` only ever hands a brain a
living enemy, so a teammate is not a target the AI declines, it is a fighter the
AI is never told about. **Teams travel in the snapshot, not the roster** — they
are an argument to `tickPlayer`. See
[specs/team-deathmatch.md](specs/team-deathmatch.md).

**Team colour is a feature, and it is a blend, never a replacement.** Every
combat colour already means something (white = first slash, amber = finisher,
violet = ultimate), so a tint pulls it toward the side at a strength from
`src/game/teamPalette.ts` — light where the colour was information, heavy where
it was neutral, full for names, bullets and shadows. **The health bar keeps
green-amber-red always.** Every fighter also casts a **team-tinted shadow** onto
the surface below them (`render/Shadows.ts`, its own Stage layer), which doubles
as the game's only altitude cue.

**Every hero has one ultimate, and every cast gets the announcement.** Lia's is
a black hole grenade, on R. Earned Overwatch-style
(0.35 charge/s passive, 0.2 per point of damage dealt, 3 a kill — 4x slower
than before, and **the hole itself pays nobody**: the ultimate is the one
weapon that cannot feed the ultimate meter). It survives death — except the
death that is a **deny**: killed while holding the button, the whole meter is
lost, and the killer gets a comic-book **DENY** caption popped over their
head. The other deny is the sword guard: a blocking fighter facing the throw
catches the grenade like a bullet, and the blocked ultimate is simply gone.
Spent at the **release** of a hold: holding R raises a special aim — the
grenade's own arc traced to its landing — and releasing casts. The cast
**freezes the whole room for 1100ms** behind a portrait card — the only legal
frame freeze in the game, and legal only because
the *server* declares the tick range and neither side simulates through it.
**Anands' dragon thrust gets the same freeze and card** — every ultimate
announces itself, and the portrait draws the caster's own sheet. The
freeze ends, the grenade launches along the angle you released on, and it arcs:
780 px/s under 860 px/s² gravity, so **707px is as far as it can be thrown** and
choosing the arc is the skill. Where it lands, a singularity holds for **4400ms** —
168px event horizon (caught: no gravity, no steering, stunned), 260px outer reach
(a tug you can dash out of), 7 damage every 250ms — 123 over a full hold. **The
caster is immune to
their own hole**, and that exclusion is one predicate. The pull is an argument to
`tickPlayer`, so a caught fighter's own client predicts it. `?ultCharge=N` is a
creator-only charge floor — the practice-room flag. See
[specs/ultimate.md](specs/ultimate.md).

**A match ends with a four-beat ceremony, and only then the podium.** First a
few seconds of breathing — the arena holds the last moment and nothing is said.
Then a **victory card** (VICTORY struck in gold, DEFEAT in silver, the same
generated wordmark face), then **Play of the Game**, then the podium. The
server films itself: a **17s ring buffer** of the snapshots it already
broadcast, plus a running score of every fighter's **plays** — a run of one
fighter's kills, denies, round wipes, **damage bursts and blocked damage** with
no gap over 5s, escalating +45% per frag so a double kill beats two unrelated
ones. **The ultimate pays nobody** — its damage never fires a burst event, the
same gate the meter uses. The best play's clip is cut **the moment the run
closes**, while the footage still exists. The announcement is a reliable
datagram; **the footage is `GET /potg/<roomId>` over the game server's HTTP
port**, because a clip is hundreds of kilobytes. The client replays it as a
projector — recorded `PackedState` re-pointed onto the live entities, drawn by
the ordinary animation, nameplate, shadow and sword-effect systems — under a
**seven-movement camera edit**: a 4.5s **title card that closes a curtain over
the arena and the victory card with it** (wordmark, medal, flare, staggered
word slam, the byline, a **stat line** — "3 KILLS · 1,240 DMG · 2 DENIES ·
310 BLOCKED" — then a wipe), establish wide on the rule-of-thirds line, an
**orbit** that cranes in an arc around the fighter, push in to 1.8x, a whip pan
that overshoots and swings back, the roll with slow motion, a zoom punch on
each beat (scaled by what the beat was — a deny punches hardest) and a **coil**
that winds the zoom out in the 320ms before it, then an outro holding the last
frame. **The curtain is the whole difference between a title card and a
caption** — the first version faded words in over a playing replay and read as
a subtitle. The wordmark and the verdict words are generated PNGs, because
their condensed uppercase face exists on no platform by default.
`MATCH_OVER_LINGER_MS` is **44s** because the breathing, the card, the ceremony
and the podium share it. Measured with `scripts/potg-probe.ts` — no other
probe can see any of it, because they all stop reading at the frame it begins.
See [specs/play-of-the-game.md](specs/play-of-the-game.md).

**Bots are opt-in.** A room has none unless asked: `?bots=N` seats N to fight,
`?fill=N` keeps the room at N fighters with bots as ballast, and neither means
humans only — still up to sixteen of them. `?scoreLimit`/`?timeLimit` shorten a
match for a probe. All four are honoured only for the client that *creates* the
room. **`?screen=N` widens the arena to N 800px screens** (1–8) — the same
creator-only rule, with the follow camera capping at 12px/frame so scroll never
reads as camera jitter. See [specs/deathmatch.md](specs/deathmatch.md) and
[specs/arena.md](specs/arena.md).

**Bots play the whole game, in modules.** `EnemyBrain` is a coordinator over four
tactic modules (`characters/`): melee rhythms, the jump controller (scripted
double jumps for high ground), the ultimate (hold, aim a solved lob, release)
and team play. A team room splits each side into **vanguards** (blades, the cover
line) and **supports** (gun, kiting bounded at their own end screen) — and the
roles are **hero-aware**: the side's support is its most ranged kit, and a jeffs
support is a *smoke* support that keeps the sword for the last stand and smokes
a rushed vanguard. Jeffs' own brain is the executioner's: the sword is the
default at every range and the shotgun is a point-blank finisher (pulled on a
reeling foe, holstered after one blast), the blossom waits out a readied
knockdown and casts into its own smoke, and the smoke has three plays — the
blossom combo, the team save, the panic button. Measured complementary roles,
not mirror fighters. A future weapon is a new module, never
a new branch. The brain decides inside the same gaps the server's tick allows:
a client brain that kept deciding through an ultimate's cinematic freeze held
and released while no input could leave the client, so it is gated on the freeze
exactly like the fixed steps.

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

## Sound

Four music loops — the title theme plus one per hero — and one synthesized
SFX bank, mixed on three channels in the **Sound** menu (root menu *and* Esc
menu — one component, one store, one `localStorage`). See
[specs/audio.md](specs/audio.md) and
[`audio/README.md`](audio/README.md).

- **The music is edit-and-render, never hand-tuned in the browser.** The
  source is a set of MIDI files (one per theme) in `audio/midi/`;
  `scripts/make-audio.py` renders each through the manifest's soundfont
  (`MuseScore_General.sf3`, MIT) **per stem, then mixes and masters in code**
  (mix sheet in dB, bus compression, ≈ −20 LUFS target, ≤ −1 dBFS true
  peak) into `public/audio/*.wav`. Want a new drum sound or a different
  voice? Swap the soundfont or edit the MIDI — never the WAV. The manifest's
  instrument table tells you exactly which synth voices each track.
- **The loop's seam is a composed thing.** 16-bar arrangements: intro, A, B,
  a crest, and a dominant hand-off bar that the wrap resolves (see the
  manifest's structure rules). Fills sit on section boundaries, never on the
  wrap.
- **A match plays the local fighter's theme** — `?hero=` (or the Esc menu
  hero change) picks it, like the kit. The title theme belongs to the root
  menu.
- **Combat sounds detect state edges, exactly like the smoke reveal.**
  `Match.scrubAudioCues` reads `meleeAction`, ammo, reload, grounded, dash and
  tumble transitions from the same snapshots the renderer reads; server events
  supply the rest (hits, blocks, explosions, ultimates, rounds). Every
  world-positioned sound is distance-attenuated and panned — the mixer never
  skips the fight, it mixes it.
- **The SFX bank is art-tuned code** (`src/game/sound/sfx.ts`) — that is why
  `biome.json` scopes `noMagicNumbers` off for `src/game/sound/**`, the same
  scope `render/` gets for colours. A sound is a recipe, not numbers to name.
- **The audio loop is measured** by `scripts/audio-probe.ts` (context reaches
  running after a gesture, the title theme and the hero theme both latch, real
  combat sounds fire, the mixer write persists across reload). Load the
  `game-audio` skill before touching the soundtrack.

## Skills

Every skill lives in `.agents/skills/<name>/SKILL.md` and is loaded with
`skill({ name: "<name>" })`. Keep this list in sync — the `knowledge-sharpener`
skill verifies it.

- **`feedback-loop`** — Diagnosing physics jitter, network desync, projectile or
  combat bugs. The canonical test is online AI vs AI; the training probe is the
  scalpel for a single interaction.
- **`game-audio`** — The soundtrack: editing the MIDI source, the per-stem
  render/mix/master pipeline (LUFS targets, seam rules), retuning the SFX bank
  and the client engine, verified with the audio probe.
- **`herdr-dev-workspace`** — Starting, inspecting or stopping the dev servers in
  visible herdr panes instead of background processes.
- **`hud-design`** — The in-match HUD: the canvas/DOM split, the Chrono Trigger /
  Fire Emblem design language, the `hud-state` contract, container-unit sizing,
  damage feedback, and the gotchas that made the first HUD invisible.
- **`specs`** — Keeping `specs/` authoritative: read before implementing, update
  in the same commit as any behaviour change.
- **`ux-menu`** — The root menu and every pre-match screen: Norman's principles
  and Nielsen's heuristics applied, the URL-as-state model, the host/join
  nesting rules, and the menu probe.
- **`knowledge-sharpener`** — Run at the END of a substantial session: fold what
  was learned into the docs and skills, verify the indexes, and review the
  routine itself — the run is evidence about the routine, and step 6 fixes it in
  the same commit.
- **`tidying-up`** — A maintenance day: knip-driven dead-code removal, constants
  and single source of truth, the noMagicNumbers art/logic scoping, the
  performance verdicts (esbuild, no worker_threads, no SoA), and the docs pass.
  Ends with the online probes proving the cleanup changed nothing.

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
