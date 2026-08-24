# golpe's soundtrack — the editable source

The game ships four orchestrated loops (the title theme, one theme per hero)
and a bank of synthesized sound effects. **The music's source of truth is
MIDI; the SFX are synthesized in the client.**

Everything about the music lives and dies in this folder + one script:

```
audio/
├── README.md            this manifest — instruments, mix sheet, master path
├── midi/                the editable source — Standard MIDI Files
│   ├── title-loop.mid   the main theme (title screen)
│   ├── lia-loop.mid     Lia's theme
│   ├── anands-loop.mid  Anands' theme
│   └── jeffs-loop.mid   Jeffs' theme
└── soundfonts/          the instrument banks (gitignored — downloaded once,
    │                    see below; do not commit, 36 MB)
    └── MuseScore_General.sf3
```

`public/audio/*.wav` are the *rendered, mixed and mastered* loops the game
plays. They are generated — `scripts/make-audio.py` reads a MIDI, renders it
through the soundfont **per stem**, mixes and masters it, writes the WAV.
**Edit the MIDI in a DAW; never the rendered file.**

## The manifest

| Track | Source | BPM | Key | Bars | Loop | Rendered |
|---|---|---|---|---|---|---|
| "Vento Aureo" (title) | `midi/title-loop.mid` | 108 | A minor | 16 | 35.6s | `public/audio/title-loop.wav` |
| "Blade Pulse" (Lia) | `midi/lia-loop.mid` | 124 | A minor | 16 | 31.0s | `public/audio/lia-loop.wav` |
| "Dagger Storm" (Anands) | `midi/anands-loop.mid` | 146 | E minor | 16 | 26.3s | `public/audio/anands-loop.wav` |
| "Executioner" (Jeffs) | `midi/jeffs-loop.mid` | 104 | F minor | 16 | 36.9s | `public/audio/jeffs-loop.wav` |

**Structure (all four):** intro 2 bars → A 4 → B 4 → C 4 (the crest, densest
texture) → outro 2, where the last bar is the dominant (E major for A minor,
B major for E minor, C major for F minor) so the seam is the cadence back to
the top's tonic — the game-loop rule: *end on the dominant, never announce
the seam with a fill*. Fills sit on interior section boundaries only.

### Which synth plays what — one soundfont, one version, all tracks

Every instrument the MIDI names is a General MIDI program on the soundfont's
bank 0. This is the answer to "what synth made this sound":

| Soundfont | Version | License | Source |
|---|---|---|---|
| MuseScore_General.sf3 | bundled with MuseScore 3.6+ (S. Christian Collins) | [MIT](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md) | [osuosl mirror](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3) |

### The voices (GM programs) per track

**title** — heroic synthwave, 6 stems:

| Stem | Program | Voice |
|---|---|---|
| Drums | 0 Standard kit | kick 36, snare 38, rim 37, clap 39, open hat 46, crash 49 |
| Bass | 38 Synth Bass 1 | the offbeat engine |
| Pads | 89 Pad 2 (warm) | sustained chords, per-bar voicing |
| Strings | 48 String Ensemble 1 | the counter-theme in section B |
| Lead | 81 Lead 2 (sawtooth) | the gold-wind motif — the hummable line |
| Arp | 80 Lead 1 (square) | the sparkle fills |

**lia** — duel energy, 5 stems: drums, bass(38), pads(89), lead(80 square),
arp(81 saw). **anands** — storm at 146: drums, bass(38), stabs(80 square
knife), lead(81 saw whirl), pads(92 bowed), arp(82 calliope glint).
**jeffs** — half-time weight: drums, bass(38), guitar(27 clean), horn(60
French horn), pads(89).

### The mixed & mastered numbers

`make-audio.py` renders **per stem**, then performs the mix in code — this is
why the manifest can state actual numbers instead of vibes:

- **Mix sheet** (in `make-audio.py`, per track): stem gain in dB and
  constant-power pan. The drums sit at −(6..7.5) dB with the bass at
  −(3.5..4) dB (the floor is the engine; everything is tuned relative to
  it), pads −(11..12) dB, leads −(5..5.5) dB, strings/guitar −9 dB·panned
  out, arps far to the side at −11 dB.
- **Bus:** a single stereo RMS-follower compressor on the sum (threshold
  −18 dBFS, 2:1, ~10 ms attack, ~150 ms release — the "console glue"),
  then 0.5 dB of tanh saturation.
- **Master:** every track is scaled so its integral is **≈ −20 LUFS
  (K-weighted, ITU-R BS.1770-3's shape implemented per-FFT-frame in the
  script — see `k_weighted_rms`)**, with true peak never above −1 dBFS (all
  four land between −4.7 and −5.8 dBFS after the gain stage). The script
  prints measured LUFS and dBFS per run: **the mix is observed, never
  guessed** — change the sheet, re-render, remeasure.

## How to edit

1. **Open the MIDI in any DAW** (MuseScore, GarageBand, FL Studio). Keep the
   GM program numbers — they are what the soundfont voices switch on. Keep
   bar counts in whole bars: the loop is 16 bars, and the render cuts at the
   bar boundary. Keep the seam rules: the last bar is the dominant, no fill
   exactly on the wrap, no crescendo at the seam, and the drum/bass patterns
   never gain layers at bar 14-15 that the top doesn't carry.
2. Re-render (needs `scripts/requirements-audio.txt` — tinysoundfont +
   numpy, plus the sf3 downloaded once by the script):
   ```bash
   python3 -m venv .venv-audio
   .venv-audio/bin/pip install -r scripts/requirements-audio.txt
   .venv-audio/bin/python scripts/make-audio.py            # all four
   .venv-audio/bin/python scripts/make-audio.py --only=lia # one to iterate
   ```
3. Listen to `public/audio/*.wav`; commit the MIDI **and** the WAVs together.
   The render is deterministic: same MIDI + same sf3 = same bytes.

Want a different *voice* without rewriting the music? Swap the soundfont:
put another MIT/CC-BY `.sf2/.sf3` in `audio/soundfonts/`, change
`SOUNDFONT_NAME`, re-render, update this sheet.

## The SFX side

All one-shots are synthesized in the client at play time
(`src/game/sound/sfx.ts`) — zero payload. They follow the layering grammar
game sound design uses (body + detail + tail; stacked transients staggered
in ms; player-vs-distant tiering via distance attenuation in `Match`).

## Why MIDI + SoundFont, not a sample pack or a browser livecoder

- **MIDI is the most durable editable form there is** — every DAW on earth
  speaks it forever, with zero runtime; a `.js` pattern chain needs the
  Strudel runtime just to be *heard*.
- **The voice is a documented file, not a mystery.** The table above is one
  sentence per track: program, soundfont, license.
- **Rendering is a plain `pip install`** (tinysoundfont, MIT, sf2/sf3/sfo)
  and takes ~a minute. No ffmpeg, no browser, no server.
- The whole pipeline is deterministic and therefore auditable: a mix
  decision is a number in `make-audio.py`, not a slider.

## Licensing

- The compositions are original, released under the repo's MIT license.
- MuseScore_General.sf3: MIT (S. Christian Collins).
- tinysoundfont-pybind: MIT.
- The rendered WAVs ship under the repo's MIT license: original MIDI music
  played through an MIT-licensed bank.
