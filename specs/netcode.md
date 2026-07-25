# Netcode

**Intent:** the game is **online first**. Every match runs through the
authoritative server, including single player, so playing the game is dogfooding
the netcode. There is no easier second code path for single player to hide
behind.

The target is not "acceptable lag compensation" — it is **zero measured
disagreement** between client and server, which is achievable because the
simulation is deterministic.

## Model

- **Server authoritative.** `server/GameRoom.ts` owns positions, bullets, damage
  and round lifecycle. Tick **60Hz**, snapshots **20Hz**.
- **One simulation.** `src/game/simulation/` is imported unchanged by the server.
  It must never touch the rendering engine, the DOM or wall-clock time —
  determinism is what makes reconciliation converge instead of rubber-band. It
  survived a whole renderer swap untouched.
- **Anything the server imports must be a named export.** A default export
  resolves to the module *namespace object* under the server's ESM/CJS interop,
  which crashed the process with "EnemyBrain is not a constructor".

## Match kinds

| URL | Opponent |
|---|---|
| `/` | Server-hosted bot (solo) |
| `/?ai=true` | Server bot, and your own fighter is AI too |
| `/?online=true` | A second human |
| `/?online=true&ai=true` | A second client, both AI — the canonical test mode |
| `/?offline=true` | None. Escape hatch, bypasses all of this. Unsupported. |

The client sends `join {solo}` on connect; the server holds placement until it
knows which kind of match is wanted (1.5s grace, then it assumes human
matchmaking).

**A bot is an ordinary player** to the simulation: same `PlayerPosition`, same
`tickPlayer`, same bullets. Only its input source differs — it reads
`EnemyBrain` instead of a network queue, and never starves.

## Local player: predict and replay

- Every fixed step the client sends `{seq, ...intent, aimAngle}` and simulates it
  immediately. `PlayerInput` extends `PlayerIntent`, so a field added to the
  simulation cannot be silently left out of the packet.
- The server echoes the highest `seq` it has consumed, with the full
  `PlayerPosition`.
- On a snapshot the client **rewinds to the authoritative state and replays every
  unacknowledged input**. It is not a blend. Because the simulation is
  deterministic, a correct prediction replays to exactly where the client already
  was, so nothing moves.
- **Measured error: 0.00px.** The old blind 15% lerp produced a permanent ~14px
  standing error and 1790px of cumulative drift per 8s.
- Residual error is smoothed visually over a few frames; corrections beyond 100px
  are real teleports (respawns) and snap.

## Never simulate a tick the client did not send

When the server's input queue starves it **freezes that player** for up to 6
ticks rather than repeating the last input. Every invented tick is a permanent
error the client cannot replay away — roughly 8px per tick while falling, which
measured as ~24px of correction per snapshot and left the player never landing.

## Remote fighters: interpolate

- Rendered **150ms in the past**, interpolated between the two snapshots
  straddling that time. Two snapshot intervals was not enough headroom — one
  dropped datagram emptied the buffer and the remote teleported ~100px.
- Interpolated positions are depenetrated before drawing: a straight line between
  two legal snapshots can still clip a corner.
- **Respawns are announced, not inferred.** The server broadcasts `round-reset`
  and the client drops all interpolation history. Blending across a respawn drew
  the remote sliding through the arena.

## Melee: predict the swing, never the hit

Sword combat splits cleanly along the line prediction can safely follow.

- **The state machine is predicted.** Startup, active, recovery, charge and block
  all live in `PlayerPosition` and are advanced by `tickPlayer`, so a swing draws
  on the frame the button is pressed and replays deterministically.
- **The outcome is not.** Whether a swing connected, was blocked, was parried or
  landed from behind depends on *both* fighters, and only the server sees both
  authoritatively. Damage, stun, launch and knockback are applied server-side.
- They meet in the replayed state: stun and launch are ordinary fields, so the
  client rewinds into a stunned state and replays its inputs, which the
  simulation discards on both sides. Nothing special is needed to make a stunned
  prediction converge — that is the payoff for putting stun in the simulation
  rather than beside it.
- **Impact effects are events, not state.** The server appends a melee event
  (hit, blocked, parried, guard break, backstab, launch) to the snapshot; the
  client fires particles from it. Events are one-shot, so a client that misses a
  datagram loses a spark, not a life.
- **Never freeze frames on impact.** Hitstop is the standard way to sell a heavy
  hit, and it is unavailable here: pausing the simulation on one side desyncs it.
  Impact is sold with camera shake and sprite scale instead, purely in the
  renderer.

## Projectiles: dead-reckon, never interpolate

A bullet has constant velocity, no gravity and no collision response, so its
position is a closed-form function of time. Every technique used for players is
wrong for bullets.

- **Extrapolate, don't interpolate.** Interpolation renders a bullet 150ms in the
  past — latency added to the thing that most needs to feel sharp.
- **Anchor once, then fly off the local clock.** Re-deriving position from the
  newest snapshot each frame moves the extrapolation base every 50ms, producing a
  sawtooth: a jump forward, then a stall.
- **Key sprites by bullet id.** The server splices dead bullets out of its array,
  so a sprite indexed by array position jumps to a different bullet mid-flight.
- **Occlusion is permanent.** A bullet whose extrapolated position reaches
  geometry has already been destroyed server-side; retire it. Letting it reappear
  past the platform made bullets blink.

Target: `teleportFrames` 0, `frozenFrames` 0, `maxPathDeviationPx` 0,
`maxStepRatio` ≈ 1.0.

## Verification

Online AI vs AI is the canonical test — an offline PASS proves nothing about any
of the above:

```bash
node scripts/diagnose.mjs --mode=online --runs=3
```

A run with no `reconciliationSummary` means no snapshots arrived; the harness
marks it `INVALID` rather than letting a dead server read as a pass.

## Not implemented

- More than 2 players per room.
- Lag compensation / rewind for hit detection (the server hits against present
  positions).
- Reconnection to an in-progress match.
- Spectators, matchmaking rating, or persistence.
