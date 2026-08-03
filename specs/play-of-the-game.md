# Play of the Game

**Intent:** end every match by showing the room the best thing that happened in
it, and show it in a way that makes clear *whose* it was before anything
happens. A match that simply cuts to a scoreboard throws away the one moment
everybody was going to talk about.

The reference is **Overwatch**, and the important half of that reference is not
the replay — it is the **pre-roll**. A replay run with the ordinary follow
camera answers "what happened" and nothing else: you watch a fight you just
watched, from the same distance, with no idea which of the sixteen fighters on
screen the ceremony is about. The camera has to say who to look at before the
play starts.

## The shape of it, in order

1. The match ends. Before the podium, the server picks the best **play** of the
   match and sends one reliable message naming it: who, what it was called, and
   what it scored.
2. The client puts the **splash card** up immediately and fetches the footage
   over HTTP in the background.
3. The **pre-roll** runs: five camera movements over the seconds of footage
   *before* the play, with the title card and then the name card over them.
4. The **roll**: the footage itself, at speed, the camera leading the
   protagonist, dropping into slow motion and punching the zoom on every scoring
   beat.
5. The **outro**: the last frame held, camera pulled back, the name card
   returned.
6. Only then does the **podium** appear.

The whole ceremony fits inside `MATCH_OVER_LINGER_MS` (28s), which was raised
from 15s to make room for it — see [deathmatch.md](deathmatch.md).

## What counts as a play

**The unit is a play, not a kill.** A play is a run of *one fighter's* scoring
moments with no gap longer than **5000ms** between them. That is the whole idea:
three frags in four seconds is a story and three frags across a minute is a
scoreboard, and a system that ranked individual kills could not tell them apart.

- A run is capped at **9000ms** of span. Whatever comes after starts a new play
  that has to win on its own merit.
- Runs are tracked **per fighter**, so two people trading kills across the same
  five seconds are two plays. A protagonist who is in half of their own
  highlight is the wrong answer.
- The best play wins on score, and a **tie is kept by the earlier play**. Any
  other rule makes the winner depend on the order plays happen to close in, and
  two identical matches would produce two different cinematics.
- A match where nobody scored produces **no ceremony at all**. That is a real
  outcome, and it is better said by silence than by an empty card.

### What a moment is worth

A frag is the unit; everything else is priced against it. Every frag emits one
`kill` plus a **modifier** for each thing that was notable about it, all sharing
one timestamp.

| Moment | Weight | Why |
|---|---|---|
| `kill` | 100 | The unit. |
| `deny` | 140 | Rarest thing in the game, and the only one *both* players remember. Killed mid-hold, or the grenade guarded. |
| `wipeKill` | +90 | The frag that emptied a side. It ended a round. |
| `ultimateKill` | +80 | Credited to the black hole. |
| `clutchKill` | +60 | The killer was on 30 HP or less — one exchange from losing it. |
| `finisherKill` | +45 | Landed with the combo's overhead finisher or a Massive Strike. |
| `airKill` | +30 | The victim never touched the floor. |

Modifiers are **additive, not exclusive**: an airborne finisher that wiped a
side and left the killer on 12 HP is worth all four, which is exactly the moment
a highlight reel should be fighting to show.

**Each successive frag in a run is worth more than the last** — +45% per frag
already in the run, capped at 3x. That escalation is the entire reason a play
beats a scoreboard: one double kill must outscore two unrelated frags, and it
does.

### What it is called

The headline is what a player would say out loud afterwards.

- 2/3/4 frags → `DOUBLE KILL` / `TRIPLE KILL` / `QUADRUPLE KILL`; 5+ → `RAMPAGE`.
- A multikill **outranks** whatever was unusual about it.
- A single frag falls through to what *was* unusual: `DENIED`, `BLACK HOLE`,
  `LAST ONE STANDING`, `FINISHER`, `ON THE ROPES`, `OUT OF THE AIR`.
- Only a completely ordinary kill gets the ordinary name. A play whose headline
  nobody would say out loud is a play that should have lost to a different one.

## The footage

**Only the server can decide this**, for the same reason only the server may
decide a hit landed: a play is made of kills, denies and round wipes, and no
client knows about all of them. A client-side reel would give every player a
different Play of the Game, which is the one thing the ceremony cannot survive.

- The recorder keeps a **ring buffer** of the last **19.5s** of broadcast frames
  — exactly the lead-in, the longest possible play and the silence that closes
  it. Trimmed on every capture; bounded by construction.
- **A frame is the broadcast, not a second recording.** Each one is built from
  the `GameSnapshot` the room had already composed for its clients, so a replay
  is a rerun of what the room actually sent. A parallel encoding would have
  drifted the first time a field was added to `PlayerPosition`.
- A fighter in a frame is a **`PackedState`** — the same wire encoding the
  snapshot uses. The replay unpacks it into a real `PlayerPosition` and the
  ordinary animation, sprite-sync, nameplate, shadow and sword-effect systems
  draw it. That reuse is why a replay shows guard sparks and swing trails at
  all, with no second renderer to keep in step.
- Bullets, grenades and the open singularity are recorded per frame too, so an
  ultimate replays as an ultimate.
- Coordinates are rounded to **two decimals** — a tenth of a pixel, past what a
  replay can show, and roughly half the JSON.
- A clip is cut **the moment its play closes**, not at the end of the match: by
  then the footage of a play from four minutes ago is long gone.
- The clip runs from **2500ms before** the first scoring moment to **2200ms
  after** the last, capped at 13.7s.
- A clip shorter than **10 frames** is not cut at all. The announcement still
  names the player, which is the part that mattered.

### The two roads

**The announcement** is a small reliable datagram (`potg`) sent the instant the
match ends. It carries everything the splash card needs, so the ceremony is
identical whether the footage arrives, arrives late, or never arrives.

**The footage** is fetched with `GET /potg/<roomId>` on the game server's own
HTTP port (9208) — the same port the WebRTC signalling and the menu's health
check already use. A clip is a few hundred kilobytes, three orders of magnitude
past what a datagram wants; the rule that made the snapshot a packed array says
a ten-second replay does not belong on the realtime channel at all.

**Every fetch failure is survivable.** A 404, a timeout, a version mismatch or
malformed JSON all cost the replay and leave the splash card exactly as it was.
A design where the announcement *was* the clip could only fail silently.

## The camera edit

Five movements. The timings are wall clock; the footage runs at its own,
variable speed underneath them.

| Movement | Length | What it does |
|---|---|---|
| **Establish** | 1200ms | Wide, slightly off the protagonist, drifting onto them. Title card over it. The only moment the whole arena is legible. |
| **Push** | 1000ms | A hard push in to a tight framing (1.8x), name card sliding under it. The sentence "it was *this* one". |
| **Whip** | 700ms | A fast pan that overshoots by 150px and swings back, easing out to the roll's framing. |
| **Roll** | the footage | The play, at speed. Camera leads the fighter's movement; slow motion and a zoom punch on every beat. |
| **Outro** | 1800ms | The last frame held, camera pulled back, name card returned. |

- The footage **crawls at 0.35x through the pre-roll**, so the world is alive
  while the camera works and the pre-roll only eats about 1.2s of the 2.5s
  lead-in. The play still arrives with footage to spare.
- At a scoring beat the footage drops to **0.32x**, ramping in and out over
  420ms either side. A hard cut to 0.32x reads as a dropped frame; the ramp is
  what makes it read as emphasis.
- The zoom **punches +0.28** at a beat and decays over 520ms, with a 9px shake.
  The shake fires **once per beat**, counted rather than time-windowed — slow
  motion holds a beat inside its window for a dozen frames, and a re-triggered
  shake is a rattle instead of an impact.
- Beats are **moments, not events**: several modifiers sharing one instant are
  one beat, or a single frag would be emphasised six times.
- The roll's camera **leads** a moving fighter by 0.22px per px/s of velocity,
  capped at 110px.
- The camera **never goes wider than the world**. The director asks for 0.82x;
  the replay floors it at the zoom that still fills the arena, because this
  game's world is exactly one viewport tall and a wider shot would frame the
  ceremony with a border of void.

**The camera edit is a pure function of time.** It owns no renderer, reads no
clock and draws nothing — it is fed a delta and a way to ask where the
protagonist was, and answers with a shot. That is what makes it testable without
a canvas, and it is why the replay's plumbing has no timing logic of its own to
disagree with.

## The overlay

Bars, a title, a name card and a way out — all DOM, like the ultimate's
cutscene, because a tracked heading and a sliding card are things CSS does
better than a `Graphics` call.

- **Letterbox bars** (8% each) frame the ceremony, sliding in over 400ms and out
  at the end. Bars rather than a dim: the arena underneath is the point.
- **"PLAY OF THE GAME"** over the establish, gone by the time the push lands.
  Behind it, a gold sunburst generated by `scripts/make-potg-art.py`, and a
  laurel-and-blade medal.
- **The name card** — headline, name, subtitle — slides in under the push and
  returns for the outro, tinted to the protagonist's side in a team match.
- **A `REPLAY · <name>` tag** is the only thing on screen through the roll. A
  replay that said nothing at all is a replay a player cannot tell from a live
  match they have lost control of.
- **Skip** ends the ceremony immediately rather than fast-forwarding it —
  somebody who skips wants the scoreboard, not the same footage sooner.
- The overlay **decides nothing**. If it never mounted, the replay would play
  identically with no words on it.

## Rules that bite

- **The replay is a projector, not a simulation.** It never calls `tickPlayer`,
  never predicts and never reconciles. Re-simulating from recorded inputs would
  need exact server tick alignment, and the first floating-point difference
  would have the replay diverge from the match it is a replay of.
- **The live match keeps running underneath.** The session keeps predicting,
  reconciling and sending input; the replay only re-points the entities at
  recorded state *after* the live update has re-pointed them at predicted state.
  It is the last writer, and the moment it stops running the live bindings are
  back with no restore step to forget.
- **Fighters the clip does not contain are hidden**, and their nameplates and
  shadows with them. Somebody who joined after the play was cut is still in the
  room and still being predicted; leaving them standing would put a fighter in
  the footage who was demonstrably not there.
- **A cast member who has left the room is conjured as a ghost.** A replay
  missing the person who was killed in it is not a replay of that play.
- **The podium waits.** `match-over` and the announcement arrive in the same
  breath, so the winner screen is deferred until the ceremony ends — up over
  the replay of how it was won makes both of them pointless.
- **A match reset cancels everything.** A replay of the last match still running
  over a live one would be showing fighters at positions the arena has already
  moved them away from.
- **The winning frag has no tail.** The kill that ends a match ends it
  instantly, so the last play's clip stops on the blow. The outro holding the
  final frame for 1800ms is what turns that into a freeze on the winning hit
  rather than a cut.

## Measuring it

```bash
node scripts/potg-probe.mjs
node scripts/potg-probe.mjs --ultCharge=100     # ...with a black hole in the reel
node scripts/potg-probe.mjs --mode=tdm --scoreLimit=2
```

**No other probe can see any of this.** Every one of them stops reading at
`phase === "over"`, which is the exact frame the ceremony begins. A server that
scored nobody, a clip that never downloaded, a pre-roll that degraded into a
static wide shot, a replay drawing zero fighters — all of it leaves `diagnose`,
`deathmatch` and `tdm` green.

The probe asserts, in one run: a play was announced with a headline and a
protagonist; the footage was fetchable over HTTP and is a real clip; every
movement ran, in order; the establish was wide, the push pushed and the whip
actually swung; the footage slowed at a beat and shook once per beat rather than
once per frame; the replay drew fighters rather than an empty arena; the HUD and
the podium stayed down; and the podium then arrived.

## Not implemented

- **Saving or sharing a clip.** The footage lives on the room and dies with it.
- **Watching somebody else's play of the game later.** There is no archive.
- **A player-chosen camera.** The edit is the edit.
- **Highlights during a match** ("that was a triple kill!"). Only the end.
