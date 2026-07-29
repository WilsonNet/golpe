# Training Room

**Intent:** a Street Fighter–style practice mode where the opponent is a
*scriptable dummy* rather than a fighting brain, reachable at `?training=true`.

It exists for two reasons beyond practice.

1. **Inputs become measurable.** Every input feature so far — the dash
   double-tap, analogue jump, aim, block, the butterfly — was validated by
   watching two brains fight, which is indirect and noisy. A dummy that does
   exactly one thing on command turns *"does RMB actually guard a slash coming
   from the left?"* into a deterministic, repeatable observation.
2. **It gives the feedback loop a scalpel.** `scripts/diagnose.mjs` measures a
   whole chaotic match; the training room measures **one interaction**. Neither
   replaces the other.

**The training room changes nothing about the game.** It adds an input source
and a way to ask the server for a reset; it adds no mechanics, no rules and no
second combat path. Anything it can show you, a real match can do.

## The shape of it

- **The dummy is server-side, and a training room is an ordinary online match.**
  Same rooms, same 60Hz authoritative tick, same prediction, reconciliation and
  server-owned bullets as any other match. A client-side dummy would have been
  easy and worthless: it would bypass exactly the netcode a training session is
  used to test other things through.
- **The dummy is an input source, not a fighter.** It has the same contract
  `EnemyBrain` has — `decide(input, nowMs, dtMs) => AIOutput` — so `GameRoom`
  picks an input source rather than growing a second pipeline. Nothing in
  `src/game/simulation/` knows the training room exists.
- **A training room is single-human by construction.** It is created on demand,
  filled with a dummy immediately, and never offered to matchmaking.
- **Deterministic.** The dummy uses no randomness and no wall clock, only
  accumulated `dtMs`. The same script from the same spawn produces the same
  events twice — see *Verification*.

## Entry

| URL | Meaning |
|---|---|
| `?training=true` | Training room. `?training-room=true` is an accepted alias. |
| `?training=true&ai=true` | Your fighter is AI-driven too, against a scripted dummy. |

Training implies **online and solo**: `?offline=true&training=true` is not a
mode, because the dummy lives on the server.

## Behaviours

Anything that does not need to *see* the game is compiled to a beat script;
the rest is reactive. That split is the design: a script is a recording of a
controller, and a controller cannot see the game.

| Behaviour | Meaning |
|---|---|
| `idle` | Stands still. Never attacks, never blocks, never moves. **The default.** |
| `blockAll` | Holds block permanently — front only, per [melee.md](melee.md). |
| `blockAfterFirstHit` | Idle until it takes a hit, then guards for `blockMs`, then idle again. |
| `jump` | Full-height jump every `periodMs`. |
| `walk` | Paces between `walkLeftX` and `walkRightX`. |
| `slash` / `uppercut` / `massive` | That move, once per `periodMs`. |
| `butterfly` | Slash cancelled into block, repeatedly. |
| `counterAttack` | Swings `delayMs` after your move goes *active*. Punish practice. |
| `mirror` | Repeats your input from `mirrorDelayMs` ago. |
| `record` / `playback` | Records your input stream (up to `recordMaxMs`), then loops it back. |
| `script` | Runs an explicit beat list. The primitive; every row above is one. |

**Crouching is deliberately absent.** The simulation has no ducking, and the
training room exposes the game rather than extending it.

`blockAfterFirstHit` reads "was hit" from the **stun edge**, not from HP: a
practice dummy is normally invincible, so its HP bar never moves, but
`applyMeleeResult` still stuns it.

## The script format

A script is a list of beats. Buttons are **held for the whole beat**, and
anything omitted is released.

```ts
interface DummyBeat {
  ms: number;                 // how long this beat lasts
  hold?: { moveLeft?, moveRight?, jump?, attack?, block?, uppercut? };
  swordStance?: boolean;      // absolute; defaults to the configured stance
  face?: number;              // -1 | 1; 0 leaves the configured facing
  dash?: -1 | 0 | 1;          // one-shot impulse, applied on the beat's first tick
  aimAngle?: number;          // radians, for the gun
}
interface DummyScript { beats: DummyBeat[]; loop?: boolean }  // loop defaults to true
```

The correspondence with time *is* the format: a 55ms `attack` beat is a press, a
470ms one charges and releases a Massive Strike. The simulation edge-detects its
own buttons, so **the gaps carry as much meaning as the presses** — a beat list
that holds `attack` forever produces exactly one swing.

Three rhythms have numbers that are not free:

- **A jump beat must hold ~240ms and then release ~60ms.** Jump height is
  analogue and edge-triggered; scattered single-frame presses can only hop.
- **A Massive beat must hold past `MASSIVE_CHARGE_MS` (420ms)** and then
  release, because the release is what fires it. The default holds 470ms.
- **The butterfly's block must land at `SLASH_CANCELLED_MS` (160ms).** Earlier
  than the end of startup and the cancel is illegal; during the active frames it
  throws the hit away. Worse, an ignored block press leaves the guard *held*, and
  the cancel is checked on the press edge only — measured, a butterfly that
  pressed block at 55ms produced 7 swings where 15 were intended.

A beat of `0ms` is dropped rather than played: playback advances by elapsed
time, so a zero-length beat is entered and left on the same tick, forever.

## Configuration

```ts
interface TrainingConfig {
  behaviour: DummyBehaviour;
  script?: DummyScript;
  dummyHp: number;            // 100
  dummyInvincible: boolean;   // true
  playerInvincible: boolean;  // true
  disableRoundReset: boolean; // true — a session is not a round
  spawn: { player: {x,y}; dummy: {x,y} };
  dummyStance: "sword" | "gun";
  facing: "foe" | "away" | "left" | "right";
  timing: { periodMs, delayMs, blockMs, walkLeftX, walkRightX,
            mirrorDelayMs, recordMaxMs };
}
```

Patches merge group by group, so a panel that only knows about `periodMs` cannot
wipe the walk bounds. Every change applies **live** — no reconnect.

### Numbers that are load-bearing

- **Default spawn: player `x=360`, dummy `x=420`, both `y=480`.** They are 60px
  apart on the clear stretch of ground between the two pillars. A slash reaches
  42px past a 32px body, so it connects without anyone walking; and 60px is
  comfortably past `BACKSTAB_MIN_SEPARATION_PX`, so a dummy facing away can
  actually be backstabbed. The obvious alternatives are both wrong: the match's
  ordinary spawns are half an arena apart, and `x=300` puts the dummy on top of
  `PILLAR_LEFT`, 100px above the player and unreachable by any attack.
- **Default walk bounds 330–470** keep a pacing dummy between the pillars, on
  the floor it started on.
- **`facing: "away"`** exists so a guard can be pointed the wrong way. Without
  it the backstab rules are not expressible as a test.
- **Damage is counted before invincibility refills the bar**, so a session with
  both fighters invincible still reports exactly what landed.

## The agent interface

`window.__training` is a **first-class deliverable, equal to the UI**, typed in
`src/types/global.d.ts` alongside `__gameState` and `__physicsDiagnostic`.

```ts
set(config): Promise<TrainingState>     // merge a patch, live
script(script): Promise<TrainingState>  // load and run a beat list
clearRecording(): Promise<TrainingState>
state(): TrainingState                  // synchronous: config, dummy, you
reset(): Promise<void>                  // respawn, clear bullets, zero counters
input(intent, holdMs, aimAngle?): Promise<void>   // drive your own fighter
report(): TrainingReport                // everything since the last reset
run(scenario): Promise<TrainingReport>  // a whole test in one call
ready(timeoutMs?): Promise<boolean>     // resolves once a dummy is seated
```

`input()` is what makes this agentic. Playwright can press a key, but it cannot
express *"hold attack for exactly 420ms and release on this frame"* — which is
the whole of the Massive Strike, and half of the frame data. It is routed
through `Input`'s override layer, which sits **above** the keyboard rather than
beside it, so what an agent tests is what a player gets.

Two ordering rules it enforces, both learned the hard way:

- **Aim, then swing.** Facing is locked through a swing's startup and active
  frames, and `tickMelee` starts the move *before* facing is applied. Aiming and
  attacking on the same tick commits the fighter to whichever way it was already
  facing, and the aim is silently ignored for the whole move. `input()` leads
  with the aim for 50ms — and does not release in between, because a released
  frame hands the fighter back to the cursor, which turns it straight back.
- **Release between holds.** Moves start from neutral only. Two holds back to
  back read as one continuous press, and a step fired during the previous move's
  recovery is simply swallowed. Chain moves with a step's `restMs`.

A scenario is a whole test in one call: config, then `reset()`, then the steps,
then a settle. The reset comes **after** the config because spawn positions are
part of the configuration.

`TrainingReport` is a **filtered view of `PhysicsDiagnostics`**, never a second
implementation — a second measurement stack that disagreed with the first would
be worse than no second stack, because this is the instrument other results are
taken with. Damage and bullet counters come from the server, which is the only
thing that sees a projectile connect or a hit land through invincibility.

## The menu

A DOM panel over the canvas, visible only in training mode. It is a *client* of
`window.__training`, not a second way in: it renders the server's echoed config
rather than its own optimistic copy, and everything it does an agent can do with
the same call.

It shows a live readout of what the dummy is doing (behaviour, beat index,
`meleeAction` and phase) and the **frame data for the last exchange** — measured
phase timings against the `MOVES` table, plus the outcome the server judged.

**It must not steal the keyboard.** Keystrokes into a form field are not
gameplay, so `Input` ignores keydown on editable elements, and any click into
the canvas blurs the panel. A menu that swallows WASD makes the mode useless.

## Verification

```bash
node scripts/training-probe.mjs        # the battery, one interaction at a time
node scripts/diagnose.mjs --mode=online --runs=3   # still the canonical run
```

Every row's expectation is derivable from [melee.md](melee.md): a slash on an
idle dummy deals 7; a block stops it; an uppercut beats the block for 11 and
launches; a Massive beats it for 24; a guard facing away is backstabbed, and one
facing away at less than a body width is *not*.

**Determinism is the load-bearing row.** If the same script produces different
events on two runs, the training room cannot be used to verify anything — that
is a bug in this feature, not flakiness to retry around.

## Not implemented

- Hitbox and hurtbox visualisation, and an input-history display.
- Saving or sharing scenarios beyond the panel's `localStorage`.
- Any training mode under `?offline=true`. It bypasses the netcode and would
  prove nothing about it.
