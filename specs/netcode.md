# Netcode

**Intent:** the game is **online first**. Every match runs through the
authoritative server, including single player, so playing the game is dogfooding
the netcode. There is no easier second code path for single player to hide
behind.

The target is not "acceptable lag compensation" — it is **zero measured
disagreement** between client and server, which is achievable because the
simulation is deterministic.

## Model

- **Server authoritative, rollback everywhere.** Every fighter on screen — the
  local one and up to fifteen others — is simulated at the *present instant* and
  corrected when the server disagrees. Nothing is drawn in the past.
- **Server authoritative.** `server/GameRoom.ts` owns positions, bullets, damage
  and match lifecycle. Tick **60Hz**, snapshots **20Hz**. Up to **16 fighters**
  per room.
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
| `/` | **Nobody.** A new, empty room — bots are opt-in |
| `/?bots=N` | N server-hosted bots to fight |
| `/?fill=N` | Whoever turns up, topped up to N with bots |
| `/?ai=true&bots=1` | A bot, and your own fighter is AI too |
| `/?room=<id>` | Whoever is in **that** room — this is how two people play together |
| `/?online=true&ai=true&room=x` | Two AI clients in one room — the canonical netcode test |
| `/?ai=true&bots=15` | A room full of AI — the canonical deathmatch test |
| `/?offline=true` | None. Escape hatch, bypasses all of this. Unsupported. |
| `/?training=true` | A scriptable practice dummy — see [training-room.md](training-room.md) |

The client sends `join {room, password, private, solo, training, ai, name,
bots, fill, scoreLimit, timeLimitMs}` on connect; the server holds placement until
it knows which kind of match is wanted (1.5s grace, then it places anyway). `ai`
is the probe's flag: a room whose **creator** is brain-driven (`?ai=true`) is
marked as a probe room, and quick match never sends a stranger into it. See
[deathmatch.md](deathmatch.md) for room sizing and the name gate.

## Rooms are addressed, not matchmade

**`?room=<id>` puts you in that room. No `?room=` makes a new one.** That is the
whole of matchmaking, and it replaced a shared waiting queue where everybody who
opened the game landed in the same match whether they meant to or not.

- **To play together, share the link.** The id therefore has to reach the address
  bar, or a player cannot invite anybody: the client writes it there with
  `replaceState` before it has even connected, so a host can copy the URL while
  they are still typing their name. The name prompt shows the link with a Copy
  button for the same reason.
- **The client proposes an id; the server decides.** Ids arrive from clients,
  become `Map` keys and get logged, so they are validated (`[A-Za-z0-9_-]{1,64}`)
  and anything else is replaced. The id the server *used* comes back in
  `match.roomId`, and the address bar is rewritten from that rather than from the
  proposal.
- **Uuid generation cannot assume a secure context.** `crypto.randomUUID` is
  unavailable on a plain-HTTP origin, which is exactly how this gets served to a
  room full of people on a LAN — so it falls back to `getRandomValues`. Copying the
  link has the same problem and the same shape of answer: `navigator.clipboard`
  first, then `execCommand`, then telling the player to press Ctrl+C.
- **Whoever creates the room sets its size and its rules.** `fill`, `scoreLimit`
  and `timeLimitMs` are read only when the room does not exist yet; later joins
  rebalance to the stored `fillTarget`. Otherwise the last person through the door
  could resize or shorten a match everybody else was already playing.
- **A room can be private, and a private room can have a password.** `?private=true`
  makes the room unlisted — friends can still join by link, but strangers will
  not be sent there. `?password=<text>` makes it locked as well as unlisted: a
  password implies private (a lock a stranger can discover from a listing is a
  lock that advertises itself). Both are creator-only, like the room's size, and
  a late joiner's values are ignored. The converse is not true — a private room
  with no password is a valid room too, and then the link is the whole
  invitation, only undiscoverable. `GameRoom.isOpen` excludes private rooms, so
  quick match and any future server listing never see them.
- **A password is a room property at creation and a key afterwards.** The creator's
  text is salted and hashed (scrypt) and stored as `passwordHash`; every join
  after carries its own password and the server compares it there. By default the
  password never appears in the address bar — the host form and the prompt hand
  it off via `sessionStorage` so history and a copied link do not leak it, with
  an opt-in "Include password in invite link" to make the link carry
  `?password=`. A wrong or missing one is answered with `room-locked` rather
  than a seat, and the client shows a prompt that stores the key and reloads.
  A manually typed `?password=` still works for old share links.
- **A room lives as long as it has a human in it**, then it and its id are
  released. The same link afterwards creates a fresh room. A room of nothing but
  bots is reaped with the human who asked for them — the id is never held by
  bots alone.
- **Quick match is the one exception to "identified, not searched for", and it
  is still a link join.** `GET /rooms` lists the rooms a stranger may be sent to
  (`GameRoom.isOpen`: a human in the room, a free seat, and not a probe room, a
  training room, private, or one sitting out the post-match ceremony, sorted
  busiest first). The menu asks, picks one, and commits `?room=<id>` — the game
  boots exactly as if the link had been shared, so there is still no queue to sit
  in. With none open, quick match creates a `?bots=1` duel, which is itself an open
  room for the next player.
- **A probe room stays out of reach of quick match for its whole life.** The
  `ai` flag of the client that *created* the room marks it; a human joining a
  probe room later does not clear it, because a diagnostic mid-run does not want
  a stranger added to the measurement.
- **A training room always gets its own fresh id** and ignores the one it was
  given. It is single-human by construction.
- **A room already holding sixteen humans answers `room-full`** rather than
  leaving a client connected, receiving nothing and looking broken. A locked room
  answers `room-locked` on the same terms — the only answer this connection will
  ever get, so the client knows to ask for the key rather than sit on
  "Connecting…".
- **Two tabs at the same URL are not in the same match** unless that URL names a
  room. Every multi-client script therefore passes an explicit `room` — and giving
  each one a *fresh* id also stopped consecutive runs joining the room the previous
  one had not finished leaving, which used to report four fighters in a room that
  asked for two.

**An empty room is a supported mode, not a degenerate one** — and it is now the
default, because bots are opt-in. It is still fully served, predicted and
reconciled, and it is the only way to measure something about the local fighter —
aim, facing, a shot's heading — without a bot closing to melee range and turning
the measurement into noise. `aim-probe.ts` relies on it, and half its runs used to
fail for reasons that had nothing to do with aim.

**`?online=true` is vestigial**, along with the `solo` flag it sets. Rooms are
addressed by id, so there is no placement left for it to choose, and bots are
opt-in, so it no longer decides how a room is filled. It survives for the status
line and for older clients.

**A bot is an ordinary player** to the simulation: same `PlayerPosition`, same
`tickPlayer`, same bullets. Only its input source differs — it reads
`EnemyBrain` instead of a network queue, and never starves.

**A training dummy is a third input source into the same pipeline**, not a
second pipeline. `GameRoom` picks between a network queue, an `EnemyBrain` and a
`TrainingDummy`; everything downstream of that choice is identical.

## The wire format

At two fighters a snapshot could afford to be the state objects verbatim. At
sixteen it cannot: a full `PlayerPosition` is ~400 bytes of JSON, so sixteen of
them at 20Hz is ~128 KB/s per client and a datagram well past any sane MTU.

- **A fighter's state is twenty-two numbers**, and its intent is one integer.
  `online/wire.ts` packs and unpacks; measured cost is ~800 bytes a snapshot for a
  duel (~16 KB/s) and ~3.4 KB for sixteen fighters (~66 KB/s).
- **The field list is checked by the compiler.** `STATE_FIELDS` is asserted to
  cover every key of `PlayerPosition`, so adding a field to the simulation fails
  to build until it is also on the wire. Same guarantee `PlayerInput extends
  PlayerIntent` gives the input path, for the same reason: a field the server
  simulates and does not send is a divergence nothing else can see.
- **Pack and unpack are inverses, and a test proves it** over states reached by
  actually simulating — a fresh `createPlayerState` has every timer at zero and
  round-trips fine through a packer that forgot half the fields. The test that
  matters replays 30 ticks from both the original and the unpacked state and
  requires them identical.
- **Input is sent unpacked.** It is one small message per client per tick, and
  the bandwidth is not worth a layer of encoding between the button a player
  pressed and the input the server simulates.
- **Scores travel as numbers; names travel once.** The snapshot carries kills,
  deaths and alive per fighter; `roster` carries names. Ranking is a pure function
  both sides call, so the standings are never sent.
- **A team travels in the snapshot, beside `hp` — not in the roster.** It looks
  like a name-shaped fact and is not: teams are an *argument to `tickPlayer`*,
  because the black hole's friendly-fire rule is applied on the client for every
  fighter it predicts and replayed on every reconciliation. The roster is sent on
  change with a 2s heartbeat, so a client that lost one would spend two seconds
  dragging its own side into a hole the server is not pulling them into — a
  divergence with nothing in any metric to explain it. See
  [team-deathmatch.md](team-deathmatch.md).

## What does not go on the wire at all

**The Play of the Game footage is fetched over HTTP**, not pushed as datagrams.
A clip is a few hundred kilobytes of packed fighter state — three orders of
magnitude past what a datagram wants, and the same argument that made the
snapshot a packed array in the first place says a ten-second replay does not
belong on the realtime channel.

- `GET /potg/<roomId>` on the game server's own HTTP port (9208), the same one
  the WebRTC signalling and the menu's health check already use. No second
  address, no second origin.
- The *announcement* (`potg`) is an ordinary reliable datagram and carries
  everything the splash card needs, so the ceremony is identical whether the
  footage arrives, arrives late, or never arrives at all. Every fetch failure —
  404, timeout, version mismatch, malformed JSON — costs the replay and nothing
  else. A design where the announcement *was* the clip could only fail silently.
- The footage reuses `packState`, so a replay unpacks into a real
  `PlayerPosition` and is drawn by the same systems a live fighter is. See
  [play-of-the-game.md](play-of-the-game.md).

## Training rooms

Two extra messages, and they are the *only* ones. Both are training-specific and
neither touches the snapshot path.

| Message | Direction | Carries |
|---|---|---|
| `training-config` | client → server | `{ config?, reset?, clearRecording? }` |
| `training-state` | server → client | resolved config, dummy status, server-side counters |

- **`training-state` is sent on change**, alongside the snapshot broadcast and
  never per tick. Position is deliberately outside the change signature: it is
  already in the snapshot, and including it would turn "on change" into "every
  broadcast" the moment the dummy walks.
- **The server echoes the resolved config**, so the UI and the agent API reflect
  what the room actually is rather than what they asked for.
- **Config changes apply live.** Requiring a reconnect would make the menu
  useless and stop an agent running a battery.
- **A training room is single-human by construction.** It is created on demand,
  filled with a dummy immediately — and therefore already full — and never
  offered to matchmaking. Seating a stranger in somebody's practice session has
  no upside: the second slot is the thing under their control.
- **Damage and bullet counters are server-side.** A client never learns why a
  projectile disappeared, and invincibility hides HP changes; counting at the
  point of resolution is the only honest source.

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

## Remote fighters: roll back, never interpolate

Interpolation was the old answer and is gone. Remote fighters were drawn 150ms in
the past, blended between the two snapshots straddling that time — smooth, correct,
and wrong for this game: **a swing you see 150ms late is a swing you cannot react
to, and reacting is the whole game.**

They are predicted instead, the way GGPO does it:

1. **Carry the last known input forward.** The snapshot carries the exact intent
   the server advanced each fighter with. The client keeps pressing it. Players
   change input far less often than 60 times a second, so this is right most ticks.
2. **Simulate them on the client's own fixed step**, through the same
   deterministic `tickPlayer` — once per local physics step, so every fighter on
   screen is on the same tick.
3. **Rewind and re-simulate on every snapshot.** Adopt the authoritative state,
   adopt the input the server actually used, replay forward to now. A correct
   prediction replays to exactly where the fighter already was, so nothing moves —
   the same property the local player relies on.

**The two differences from peer-to-peer GGPO both come from the server being
authoritative**, and both are why this scales to sixteen where lockstep rollback
does not:

- **Nothing waits.** There is no lockstep and no confirmed frame shared between
  peers, so one slow connection hurts only itself. Peer-to-peer rollback is
  impractical past about four players for exactly the reason this is not.
- **Outcomes are never predicted.** Whether a swing connected remains the
  server's call alone. We predict where fighters *are*, never what happened to
  them.

### How far forward is "now"

`leadTicks` is **the local player's count of unacknowledged inputs**, not a
latency estimate. The server reported its state at the tick it consumed seq *N*,
and the client holds inputs *N+1..N+k* — so the local fighter is exactly *k* ticks
ahead of that snapshot, and advancing remotes by the same *k* puts every fighter on
one tick by construction, with no clock estimate to be wrong about.

That also makes the depth self-limiting: a laggy connection has more pending input
and predicts further, which is the trade rollback exists to make. Capped at
**9 ticks (150ms)** — past that range the misprediction introduced is larger and
more frequent than the latency it hides.

### What it costs, measured

Rollback trades a fixed visual delay for occasional misprediction, so the trade
has to be measured or it is just a preference. `netSummary.rollback` reports it.
Observed on localhost:

| | duel | 16 fighters |
|---|---|---|
| avg correction | 1.6-8px | 2.8-5.2px |
| max correction | 57-79px | 90-99px |
| corrections over 1px | ~12% of rollbacks | ~20% |
| resim depth | 0-4 ticks | 0-2 ticks |
| visible jitter | **0** | **0** |

The corrections are real and the visible jitter is zero because the **render
smoother** absorbs them: the simulation snaps to the authoritative answer
immediately so gameplay stays correct, while the sprite is drawn at an offset that
decays over ~60ms. Corrections past 100px are discontinuities and snap.

### Rules that hold this together

- **A frozen fighter stays frozen.** `input: null` in a snapshot means the server
  starved and did not advance that fighter. The client reproduces the freeze.
  Inventing a tick of motion here is the same mistake as the server inventing one,
  and costs the same permanent error.
- **Anything drawn from a position the simulation did not produce is
  depenetrated first.** The smoother deliberately offsets a sprite off its body,
  and that offset can put it inside a ledge the body never touched. The old
  interpolator needed this for the same reason; forgetting it turned zero jitter
  into six collision penetrations.
- **Freezetime is simulation state, not a message.** `PlayerPosition.freezeTimer`
  rides the packed snapshot like every other timer, so a client *predicts* the
  tick a round goes live instead of waiting to be told and lurching a frame
  later. `round-live` is sent as well, but only so the banner lands together —
  it carries nothing a client could not already derive. **The ultimate's
  cinematic freeze would have been the wrong tool**: that stops the simulation on
  both sides and parks every input in the queue, which is safe for 1.1s and
  nothing like safe for four seconds.
- **A wipe-out and the reset that follows it are two messages.** `round-won`
  announces the round (reliably, so the banner cannot be lost) and the survivors
  keep fighting for 2.6s; `round-reset` arrives when the arena actually resets
  and is what breaks prediction continuity. Conflating them would drop every
  fighter's rollback history on a frame where the fight is still going on.
- **Respawns are announced, not inferred.** `respawn { id }` for one fighter,
  `round-reset` for the whole arena. Both drop that fighter's prediction outright
  instead of smoothing across it — easing over 600px turns one honest jump into a
  long smear of fake motion. The message races the snapshot carrying the respawned
  state, so a correction past 100px is *also* treated as a discontinuity.
- **The snapshot is the only authority on who is present.** The `roster` message
  supplies names, nothing else. Taking it as the truth about presence let a stale,
  unordered datagram delete a fighter the newest snapshot contained — destroying
  its entity and sprite, rebuilding them a frame later, and throwing away its
  prediction on the way through. The roster is re-sent every 2s as well as on
  change, so a lost one heals instead of leaving raw ids on the scoreboard forever.
- **Diagnostics read the authoritative state for combat and the drawn position
  for movement.** A remote fighter is predicted, so its melee state is a guess;
  asking whether a move honoured the frame data table is only answerable about the
  server's copy. Judging the prediction reported a mispredicted uppercut as an
  uncancellable move ending 500ms early. Positions are the opposite way round: the
  drawn one is what a player saw, and the raw corrections are reported separately
  in `netSummary.rollback` so smoothing them hides nothing.
- **The primary remote's identity is pinned.** `remoteState`, `remoteHp` and the
  diagnostic's `enemy_x`/`enemy_y` metrics are all about one chosen fighter. Deriving
  that choice per call from the front of the roster looked stable and was not: the
  subject changed between frames, and a metric comparing this frame to the last
  reported the gap between two fighters standing in different places as 45-75px of
  jitter from a fighter that had not moved. Switches are announced as
  discontinuities and counted in `rollback.primarySwitches` — because "did the
  subject change?" is the first thing to ask of a suspicious reading.

## Melee: predict the swing, never the hit

Sword combat splits cleanly along the line prediction can safely follow.

- **The state machine is predicted.** Startup, active, recovery, charge and block
  all live in `PlayerPosition` and are advanced by `tickPlayer`, so a swing draws
  on the frame the button is pressed and replays deterministically.
- **The outcome is not.** Whether a swing connected, was parried (guard-broken),
  landed from behind, or simply blew up the floor under everyone depends on
  *both* fighters — or on the whole room, for a blast — and only the server sees
  all of it authoritatively. Damage, stun, launch and knockback are applied
  server-side.
- They meet in the replayed state: stun and launch are ordinary fields, so the
  client rewinds into a stunned state and replays its inputs, which the
  simulation discards on both sides. Nothing special is needed to make a stunned
  prediction converge — that is the payoff for putting stun in the simulation
  rather than beside it.
- **Impact effects are events, not state.** The server appends a melee event
  (hit, parry/guard break, backstab, blast, bomb) to the snapshot; the
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
node scripts/diagnose.ts --mode=online --runs=3     # a duel: prediction, projectiles
node scripts/deathmatch-probe.ts                    # sixteen fighters, to a winner
```

**Both, because they fail differently.** The duel is where prediction,
reconciliation and projectile trajectories are cleanest to read. Sixteen fighters
is where everything that only breaks at scale breaks: snapshot size, a quadratic
hitbox pass, fighters joining and leaving mid-match, and every metric that
silently assumed there was exactly one opponent.

A run with no `reconciliationSummary` means no snapshots arrived; the harness
marks it `INVALID` rather than letting a dead server read as a pass. Likewise
`netSummary.snapshots: 0` or `rollback.rollbacks: 0` means the client was
simulating alone and every other number in the report is a statement about
nothing.

## Not implemented

- More than 16 fighters per room. A room that is full turns a client away with
  `room-full`; there is no queue, and no overflow into a second room.
- Any matchmaking at all. Rooms are addressed by id — see above.
- Lag compensation / rewind for hit detection (the server hits against present
  positions).
- Reconnection to an in-progress match.
- Input delay as a rollback smoothing option, and input decay on carried-forward
  intent. Both are standard and neither was needed at the measured error.
- Interest management. Every fighter is in every snapshot, which is correct for
  one 800x600 arena and would not be for a larger map.
- Spectators, matchmaking rating, or persistence.
