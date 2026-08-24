---
name: game-audio
description: "CRITICAL: Use when touching the soundtrack, a music loop, the SFX bank, the mixer, or anything under audio/, scripts/make-audio.py, src/game/sound/ or the Sound menus. The music is MIDI-first and edit-and-render: never hand-tune a rendered WAV in the browser; the source of truth is the MIDI in audio/midi/ and the manifest in audio/README.md. Covers game-composition rules (Terran-One-style sectioned loops, dominant seam handling), the per-stem render + mix + master pipeline (stem gains, bus compression, K-weight LUFS target), the client audio engine (track latching, ducking, distance-attenuated SFX cues), and how to verify with scripts/audio-probe.ts. Triggers on: music, soundtrack, theme, loop, song, SFX, sound effect, sound menu, mixer, volume, mute, audio, master, muffle, silence, quiet, LUFS, soundfont, MIDI."
license: MIT
---

# Game Audio

This project's audio is **edit-and-render, mixed and mastered in code**. The
music's source of truth is Standard MIDI Files in `audio/midi/`; the SFX are
synthesized in the client. Never hand-tune a rendered WAV in a browser or an
editor — the render must be the only way a `.wav` changes, both because
rendering is deterministic and because the manifest's printed numbers are
then always true.

## The pipeline, in one breath

```
audio/midi/<track>-loop.mid         ← the editable source (a DAW opens it)
        │ scripts/make-audio.py
        ▼
per-stem render (tinysoundfont) → mix sheet (dB gain + constant-power pan)
→ bus compression (RMS follower, −18 dBFS, 2:1) → tanh glue → ≈ −20 LUFS
(K-weighted) with true peak ≤ −1 dBFS → end-fade 2048 samples
        ▼
public/audio/<track>-loop.wav       ← what the game plays (WAV, committed)
```

Re-render: `python3 scripts/make-audio.py` (or `--only=<track>` to iterate on
one). Needed once: `pip install -r scripts/requirements-audio.txt` into a
venv; the soundfont (`audio/soundfonts/MuseScore_General.sf3`, MIT, 36MB, not
committed) downloads itself on first run.

## The audio pipeline's rules

1. **A rendered loop change = a MIDI change.** If you want a different
   sound, first change the manifest's instrument table (the GM program in
   the MIDI) or swap the soundfont — never the WAV.
2. **Keep the loop's composition rules** (they are why repetition isn't
   torture): sections (intro / A / B / crest / outro) within 16 bars (or a
   multiple); the LAST bar is the dominant chord of the key (V → i across the
   seam); fills on interior section boundaries only, never on the wrap; no
   crescendo at the seam; the hummable lead rides above support layers; the
   louder, denser section sits mid-loop, not at the end.
3. **A stem is its own mix decision.** If a part is too loud, change the
   stem's dB in the mix sheet and re-render — not the MIDI velocities
   (velocity is the performance; the sheet is the mix).
4. **Observe the master, never guess.** `make-audio.py` prints LUFS and peak
   per track. Target: ≈ −20 LUFS integrated (game-mix window), peak ≤ −1
   dBFS. If a change moves a track off the target, the loudness stage
   re-scales it — the printed numbers must stay the ones declared.
5. **The seam's anti-click fade (2048 samples) lives in the master chain.**
   If you rearrange the end of a loop, keep the fade last and keep the
   outro's final notes resolving before the final beat.

## The client engine (`src/game/sound/`)

- `mixer.ts` — the store: master/music/sfx volumes + mutes, persisted
  (`golpe.audio`), sanitised on load. Pure — unit-tested.
- `engine.ts` — the one AudioContext, lazy + unlocked on first gesture;
  the music player crossfades between tracks (240 ms) and ducks
  (`sound.duck(ms)`) for the ultimate's freeze, a deny, fanfares.
- `sfx.ts` — the one-shots, synthesized as oscillator/filtered-noise recipes
  (per-name 36 ms cooldown; `SfxOpts.gain` = distance attenuation from
  `Match`). This is art-tuning code — `biome.json` scopes `noMagicNumbers`
  off for `src/game/sound/**`, exactly like `render/` for colours.
- `facade.ts` — the one import the rest of the game needs
  (`sound.play / setMusic / duck / mixer`), plus the delegated UI-click and
  hover listeners over `<button>`s.
- Track selection: the root menu → `"title"`; a match → the **local
  fighter's hero** (`Match` calls `sound.setMusic(hero)` at boot and on
  every `onLocalHero` echo). `Match.destroy()` returns the menu to the title
  theme.

## Adding or retuning a sound effect

1. Add a recipe to the `patches` table in `src/game/sound/sfx.ts` — `osc`
   and `noise` are the two verbs; both take pan and schedule in ms with
   exponential envelopes. Layer a body (pitched low transient) plus a detail
   (filtered noise crack), and stagger layers 2-10 ms so transients don't
   stack — the grammar game sound design uses.
2. Fire it from the right place: `Match.scrubAudioCues()` for state-edge
   sounds (they must be read off the snapshots — never the sim), the server
   event callbacks (`onMeleeEvent` for a landed hit by outcome, `onKill` for
   your own frag, etc.), or the delegated UI listener.
3. Add it to `audio-probe.ts`'s expectations only if the probe must assert
   on it.

## Verifying a change (the measurement loop)

`tsx scripts/audio-probe.ts` — asserts the context reaches running after a
gesture, the title theme and the pinned hero theme both latch, real combat
SFX fire in a live bot match (not just menu clicks), and the mixer write
persists across a reload. It is the only thing that can hear anything: the
other probes stop reading at the frame the match ends and never listen at
all.

For music content itself: re-render, look at the printed LUFS/peak and the
per-second RMS stability (no dead seconds, no clipping), listen through the
game page, and only ship if the manuscript still matches the audible result.

## The research this skill encodes

Game loops must be seamless, sectioned and structured start-to-end (see the
GDC horizontal-resequencing literature and loop craft articles), with the
wrap on a dominant-to-tonic cadence and fills/dynamics placed away from the
seam. Terran One (Glenn Stafford, StarCraft) is the reference: A minor, ~135
BPM, steady drums + synth bass carrying the hummable lead through sectioned
movements. Game loudness: master music to ≈ −20 LUFS (the IESD/PlayStation
window; Wwise's mastering recipes assume ≈ −24) with true peak never above
−1 dBFS, and keep dialogue/SFX priority through bus structure and ducking.
