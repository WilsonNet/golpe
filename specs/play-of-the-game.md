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

Overwatch's ending is also the shape of this one: the match stops, the verdict
lands (**VICTORY**), and only then does the highlight run. The first version of
this ceremony cut from the winning blow straight to the title card, and it read
as an interruption — which is why the verdict card and the breathing around it
exist. The whole ending is a single escalating sequence: silence, the verdict,
the hyping, the reel, and last of all the podium.

## The shape of it, in order

1. The match ends. **Nothing is said for a few seconds** — the arena holds the
   last moment, and that silence is the whole of the breathing. A cut straight
   from the winning blow to a full-screen card reads as an interruption of the
   fight, not as a verdict on it.
2. The **victory card** lands: VICTORY or DEFEAT, the name of the fighter (or
   side) it belongs to, and how it was decided. It is a card, not a screen —
   no buttons, nothing to decide; the podium is where the information lives,
   later.
3. Behind the card, the server picks the best **play** of the match and sends
   one reliable message naming it: who, what it was called, and what it scored.
4. The **curtain closes over the card** — the same bars that framed the arena
   swallow the victory card and the title card slams up — wordmark, medal,
   flare, the line "<name> · TRIPLE KILL", and the play's **stat line** — while
   the client fetches the footage over HTTP behind it.
5. The curtain **wipes open** into the letterbox bars, and the **pre-roll**'s
   camera movements run over the seconds of footage *before* the play.
6. The **roll**: the footage itself, at speed, the camera leading the
   protagonist, dropping into slow motion and punching the zoom on every scoring
   beat.
7. The **outro**: the last frame held, camera pulled back, the name card
   returned.
8. Only then does the **podium** appear.

The whole ending fits inside `MATCH_OVER_LINGER_MS` (44s), which was raised
from 15s and again from 30s to make room for all of it — see
[deathmatch.md](deathmatch.md). The pacing is three constants that must move
together: `VICTORY_BREATHING_MS` (3s of silence), `VICTORY_HOLD_MS` (3.5s of
card), and the ceremony itself, up to about twenty-seven seconds for the
longest clip the server will cut.

**The title card is the part that does the hyping, and it is not optional.** The
first version of this had no card at all: it faded the words in *over* an
already-playing replay, and the result read as a subtitle on footage rather than
as an event. Overwatch's ceremony turns on a card that owns the screen first and
then gets out of the way — and the getting out of the way is a wipe, not a fade.
The `curtain` number in the shot is exactly that difference, and the probe
asserts it reaches 1.

## What counts as a play

**The unit is a play, not a kill.** A play is a run of *one fighter's* scoring
moments with no gap longer than **5000ms** between them. That is the whole idea:
three frags in four seconds is a story and three frags across a minute is a
scoreboard, and a system that ranked individual kills could not tell them apart.

- A run is capped at **8000ms** of span. Whatever comes after starts a new play
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
| `ultimateKill` | +80 | Credited to an ultimate — the headline names which (`BLACK HOLE`, `DRAGON THRUST`, `DEATH BLOSSOM`). |
| `clutchKill` | +60 | The killer was on 30 HP or less — one exchange from losing it. |
| `finisherKill` | +45 | Landed with the combo's overhead finisher or a Massive Strike. |
| `airKill` | +30 | The victim never touched the floor. |
| `damageDealt` | 20 | One burst per ~100 damage dealt (a health bar). Cheap on purpose: a fighter who was merely present must never out-score one who closed a kill. |
| `damageAbsorbed` | 10 | One burst per ~100 damage the sword guard turned away. The cheapest thing the reel scores, because blocking well is *true* but reads as nothing on a screen. |

Modifiers are **additive, not exclusive**: an airborne finisher that wiped a
side and left the killer on 12 HP is worth all four, which is exactly the moment
a highlight reel should be fighting to show.

**The ultimate pays nobody.** An ultimate's damage never fires a `damageDealt`
burst — the same gate the ultimate meter uses, so "the ultimate feeds nothing" is
one rule with one home.

**Each successive frag in a run is worth more than the last** — +45% per frag
already in the run, capped at 3x. That escalation is the entire reason a play
beats a scoreboard: one double kill must outscore two unrelated frags, and it
does — and even a play that somehow held eight full bursts of damage pressure
would still lose to that double.

**Every play carries a stat line.** The score is the judgement; the stats are
the receipt — `kills`, `damage`, `denies` and `absorbed` summed from the
play's events. They travel in the announcement and the clip, and the title card
renders them as "3 KILLS · 1,240 DMG · 2 DENIES · 310 BLOCKED", so a ceremony
says what the play was, not only what it was called.

### What it is called

The headline is what a player would say out loud afterwards.

- 2/3/4 frags → `DOUBLE KILL` / `TRIPLE KILL` / `QUADRUPLE KILL`; 5+ → `RAMPAGE`.
- A multikill **outranks** whatever was unusual about it.
- A single frag falls through to what *was* unusual: `DENIED`, `BLACK HOLE` /
  `DRAGON THRUST` / `DEATH BLOSSOM` (whichever ult landed it),
  `LAST ONE STANDING`, `FINISHER`, `ON THE ROPES`, `OUT OF THE AIR`.
- A play that won on pressure alone is named for the pressure: `BARRAGE` for
  four-plus bursts of damage dealt, `THE WALL` for absorbed damage that beat
  the damage dealt — the rarest way to win, and the one that reads worst, so it
  gets the rarest name.
- Only a completely ordinary kill gets the ordinary name. A play whose headline
  nobody would say out loud is a play that should have lost to a different one.

## The footage

**Only the server can decide this**, for the same reason only the server may
decide a hit landed: a play is made of kills, denies and round wipes, and no
client knows about all of them. A client-side reel would give every player a
different Play of the Game, which is the one thing the ceremony cannot survive.

- The recorder keeps a **ring buffer** of the last **17s** of broadcast frames
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
- The clip runs from **4000ms before** the first scoring moment to **2200ms
  after** the last, capped at 14.2s. The lead-in grew with the pre-roll: ten
  seconds of camera work before the play needs footage to hold on, and at the
  pre-roll's crawl rate it eats nearly two seconds of it before the roll
  starts.
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

Seven movements — **ten seconds of buildup** before the play itself, close
enough to Overwatch's own seventeen-second ceremony that the difference is the
footage, not the appetite. The timings are wall clock; the footage runs at its
own, variable speed underneath them.

| Movement | Length | What it does |
|---|---|---|
| **Intro** | 4500ms | The arena is **hidden** — and with it the victory card. The title card slams in over a flare, and the curtain wipes off in the last 550ms. |
| **Establish** | 1500ms | The reveal: wide, slightly off the protagonist, drifting onto them — on the side their facing points, so they are framed on the rule-of-thirds line, looking across the shot. The only moment the whole arena is legible. |
| **Orbit** | 1500ms | The hero shot: the camera cranes up and swings in an arc around the fighter — high on one side, through eye level in front of them, high on the other. It climbs as it turns, because on a single-screen level a pure lateral swing would clamp into no pan at all; the vertical leg is what the arc is made of. |
| **Push** | 1400ms | A hard push in to a tight framing (1.8x), name card sliding under it. The sentence "it was *this* one". |
| **Whip** | 800ms | A fast pan that overshoots by 150px and swings back, easing out to the roll's framing. |
| **Roll** | the footage | The play, at speed. Camera leads the fighter's movement — and holds looking-room toward their facing when they stand still; it **coils** (a slow zoom-out over the 320ms of footage before each beat, so the punch has something to contrast with); and it drops into slow motion, punching the zoom on every beat, harder for a deny or a round-wipe than for a plain frag. |
| **Outro** | 2200ms | The last frame held, camera pulled back, name card returned. |

- **The intro holds the footage completely still.** The lead-in is a 4s budget
  and there is nothing on screen to spend it on; a crawling clip behind an opaque
  card is a clip spent on nobody.
- The camera is **parked on the establishing framing** for the whole intro, so
  the wipe reveals a composed frame rather than a camera arriving into one.
- The footage **crawls at 0.35x through the rest of the pre-roll**, so the world
  is alive while the camera works and it only eats about 1.8s of the lead-in. The
  play still arrives with footage to spare.
- At a scoring beat the footage drops to **0.32x**, ramping in and out over
  420ms either side. A hard cut to 0.32x reads as a dropped frame; the ramp is
  what makes it read as emphasis.
- The zoom **punches +0.28** at a beat and decays over 520ms, with a 9px shake.
  **The punch is scaled by what the beat was** — 1.4x for a deny, 1.3x for a
  round-wipe, 1.2x for an ultimate — so the reel's emphasis matches what the server
  thought mattered. The shake fires **once per beat**, counted rather than
  time-windowed — slow motion holds a beat inside its window for a dozen frames,
  and a re-triggered shake is a rattle instead of an impact.
- Beats are **moments, not events**: several modifiers sharing one instant are
  one beat, or a single frag would be emphasised six times.
- The roll's camera **leads** a moving fighter by 0.22px per px/s of velocity,
  capped at 110px, and sits 22px toward their facing when they are standing
  still — a dead-centre subject is a fighter on a poster, not a fighter about
  to act.
- The camera **never goes wider than the world**. The director asks for 0.8x;
  the replay floors it at the zoom that still fills the arena, because this
  game's world is exactly one viewport tall and a wider shot would frame the
  ceremony with a border of void.

**The camera edit is a pure function of time.** It owns no renderer, reads no
clock and draws nothing — it is fed a delta and a way to ask where the
protagonist was, and answers with a shot. That is what makes it testable without
a canvas, and it is why the replay's plumbing has no timing logic of its own to
disagree with.

## The overlay

Three layers, all DOM: the victory card, the Play of the Game bars-and-card,
and the way out.

- **The victory card is the first thing said after the fight.** One word —
  VICTORY in gold, DEFEAT in a cold silver (the verdict's tone read from the
  colour before a word is legible) — the name of the fighter or side it belongs
  to, and a line about how it was decided. It sits **under** the Play of the
  Game overlay on purpose: the curtain closing is its exit, so the handoff is a
  cover rather than two cards fighting. It is a card, not a screen — no
  buttons, nothing to decide, and it never blocks the podium, which is where
  the information lives.
- **The victory word is art, like the wordmark** — same condensed face, same
  recipe, different metal. `scripts/make-potg-art.py` bakes VICTORY, DEFEAT and
  DRAW beside the four wordmark words, so the two cards are recognisably the
  same family of moment.
- **The letterbox bars are also the curtain.** One pair of elements does both
  jobs: at `curtain: 1` the two halves meet in the middle and the arena is gone;
  at 0 they are exactly the 8% bars. The reveal is therefore not a fade but a
  curtain opening into the frame it was always going to be.
- **The wordmark is art, not text**, and one PNG per word. Overwatch sets this
  card in Big Noodle Too — a condensed uppercase grotesque — and there is no
  such face present on Windows, macOS and Linux alike; a CSS stack would have
  looked right on one machine and like Arial Bold on the next. Rendering it in
  `scripts/make-potg-art.py` also bakes in the gold gradient and the outline,
  neither of which CSS does well on text, and one file per word is what lets
  each one arrive on its own.
- **The card's entrance:** a beat of black, a white flash and a scale-slam, then
  PLAY / OF / THE / GAME each arriving from the left with motion blur and a
  slight overshoot, 170ms apart; a light sweep across them; the byline and its
  rule; and the **stat line** — "3 KILLS · 1,240 DMG · 2 DENIES · 310 BLOCKED" —
  last, in the card's gold, only the buckets that have anything in them. Behind
  it all, a gold sunburst and drifting diagonal speed lines.
- **The card's timings are CSS keyframes, and that is legal here.** Everything
  else in the ceremony is driven by the director because it runs against footage
  at a variable speed — but the intro has a *fixed* length, exactly like the
  ultimate's 1100ms cutscene. `Director.test.ts` asserts the card's whole
  animation budget fits inside the intro with the wipe still to come, so the two
  cannot drift.
- **The name card** — headline, name, subtitle — slides in under the push and
  returns for the outro, bottom-left, on a **gradient plate with a gold left
  edge**: the roll is exactly when the frame fills up, and a black hole, a sword
  arc and a headline all claiming the same pixels is a headline that lost. It is
  tinted to the protagonist's side in a team match.
- **A `REPLAY · <name>` tag** is the only thing on screen through the roll. A
  replay that said nothing at all is a replay a player cannot tell from a live
  match they have lost control of.
- **Skip** ends the ceremony immediately rather than fast-forwarding it —
  somebody who skips wants the scoreboard, not the same footage sooner.
- The overlay **decides nothing**. If it never mounted, the replay would play
  identically with no words on it.

## Rules that bite

- **The ending has a clock, and one owner.** The breathing, the victory card
  and the reel are paced by the client's game loop off `VICTORY_BREATHING_MS` /
  `VICTORY_HOLD_MS`, and the whole of it must fit `MATCH_OVER_LINGER_MS` with
  the podium still to come. The announcement and the standings arrive in the
  same breath, so the announcement **waits in line** behind the card — and the
  podium waits for everything.
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
  breath, so the winner screen is deferred until the card and the replay are
  done — up over the verdict of how the match was won makes both of them
  pointless.
- **A match reset cancels everything.** A replay of the last match still running
  over a live one would be showing fighters at positions the arena has already
  moved them away from.
- **The winning frag has no tail.** The kill that ends a match ends it
  instantly, so the last play's clip stops on the blow. The outro holding the
  final frame for 1800ms is what turns that into a freeze on the winning hit
  rather than a cut.

## Measuring it

```bash
node scripts/potg-probe.ts
node scripts/potg-probe.ts --ultCharge=100     # ...with a black hole in the reel
node scripts/potg-probe.ts --mode=tdm --scoreLimit=2
```

**No other probe can see any of this.** Every one of them stops reading at
`phase === "over"`, which is the exact frame the ending begins. A server that
scored nobody, a clip that never downloaded, a pre-roll that degraded into a
static wide shot, a replay drawing zero fighters — all of it leaves `diagnose`,
`deathmatch` and `tdm` green.

The probe asserts, in one run: the victory card appeared, **not before the
breathing** (a card that cut in on the winning blow is the exact abruptness the
breathing exists to fix) and gone by the replay; a play was announced with a
headline, a protagonist and a **stat line** whose kills agree with the
headline; the footage was fetchable over HTTP and is a real clip; every
movement ran, in order, and each one actually moved — the establish was wide,
the **orbit swung around the fighter**, the push pushed and the whip actually
swung; the curtain reached 1 and then opened, so the card was a card and not a
caption; the intro held the footage still and stood for at least 3.5s; the
footage slowed at a beat and shook once per beat rather than once per frame;
the replay drew fighters rather than an empty arena; the HUD and the podium
stayed down; and the podium then arrived.

## Not implemented

- **Saving or sharing a clip.** The footage lives on the room and dies with it.
- **Watching somebody else's play of the game later.** There is no archive.
- **A player-chosen camera.** The edit is the edit.
- **Highlights during a match** ("that was a triple kill!"). Only the end.
