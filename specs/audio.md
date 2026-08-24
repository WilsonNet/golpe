# Audio

The game has a soundtrack and a sound design, and a mixer to balance them.
Music is *rendered*, SFX are *synthesized* — and all of it is client-side
presentation. The simulation never hears a sound: nothing about volume, mute
or which track is playing reaches the wire, and a desynced sound is a
presentation bug that cannot affect a single hit.

## Model

The title screen's theme, one theme per hero, one synthesized sound bank,
three mixer channels.

- **Music** is four seamless WAV loops served from `public/audio/` — the
  title theme, then Lia's, Anands' and Jeffs' themes, each ~26-37s of
  16-bar arrangement (intro, A, B, crest, dominant hand-off; see
  [audio/README.md](../audio/README.md) for the per-track manifest —
  soundfont, programs, mix sheet) — played through
  `AudioBufferSource.loop`. The rendered source of truth is the Standard MIDI
  Files in `audio/midi/`.
- **SFX** are synthesized at play time in `src/game/sound/sfx.ts`:
  oscillators and filtered noise, no files, no payload, no decode latency.
  Every sound is one recipe in a bank keyed by name.
- **The mixer** is `src/game/sound/mixer.ts`: `master`, `music`, `sfx`, each
  a 0..1 volume and a mute, persisted to `localStorage` under `golpe.audio`.
  Defaults: master 1, music 0.5, sfx 0.9, nothing muted. The Sound menu (root
  menu and Esc menu, one shared component) writes it; the engine applies.

## The page's music

The root menu plays the title theme; a match plays **the local fighter's
theme** — the hero the player brought is the hero the score follows, so the
music is picked at boot from the same `?hero=` a launch request carries and
re-pointed when the Esc menu's hero change echoes back. The engine
crossfades over ~240ms — a boot never slams one track into another. The
browser's autoplay policy is respected: sound starts on the first pointer or
key press anywhere, and the context resumes on any subsequent one.

## What plays when

- **Combat cues** are *edges in state*, not extra messages: a swing starts
  when a fighter's `meleeAction` changes, a shot when its ammo drops, a
  reload when its reload timer starts, a jump/land/dash/roll on the
  corresponding state transitions (both sides of prediction feed the same
  client-side scrubber — `Match.scrubAudioCues`). This is presentation-only,
  exactly like the smoke-reveal logic that reads the same edges.
- **Server-judged moments** use the server's own events: a landed melee hit
  (`hit`/`backstab`/`blast`/`bomb` — the outcome names the thump), a guard
  that breaks the attacker, an explosion, a root, a deny, an ultimate cast
  (the boom; and the music ducks for the whole cinematic freeze), the hole
  opening, a round won/lost/drawn ("FIGHT!" on round-live), a frag you made,
  a match over, and the play-of-the-game sting and fanfare.
- **The mixer's distance rule**: a sound at a world position is attenuated by
  distance from the local fighter and panned by its sideways offset — a
  swing two screens away is a faint, displaced whoosh; your own swing is full
  volume. Sounds are unheard past ~900px.
- **UI sounds** are delegated once (`installUiSounds`): a pointerdown on any
  `<button>` clicks, a pointermove over a button hovers. No component
  remembers to play anything.

## Always

- The gameplay never waits for audio; a dead audio engine (no browser
  support, blocked context, fetch failure) is counted in diagnostics and
  otherwise silent.
- The music's duck is the volume analog of the cinematic freeze: the most
  theatrical moments (an ultimate, a deny, the podium) lower the music and
  bring it back on their own.
- SFX rate-limit per name (36ms): a sixteen-fighter room reads as a scuffle,
  not as one blur.
- **The loops are authored around their seam**: the last bar is the
  dominant chord of the top's tonic, fills never land on the wrap, nothing
  crescendos at it — the wrap must read as a phrase boundary inside one
  piece, never as a machine cycling.

## Not implemented

- No per-voice 3D positional audio beyond stereo pan; no HRTF, no reverb of
  its own (the pads' space is the soundfont's).
- No interactive layering (no per-layer stems at runtime): one arrangement
  per theme, chosen by hero. The score is *composed* to carry a whole match,
  like StarCraft's non-interactive skirmish themes.
- Music is not written as OGG/MP3: the loops are WAV so the loop seam is
  sample-exact (see the render script's end-fade).
