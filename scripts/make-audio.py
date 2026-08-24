#!/usr/bin/env python3
"""
The soundtrack pipeline — MIDI in, WAV out.

The source of truth is a set of Standard MIDI Files in `audio/midi/`; the
loops under `public/audio/` are *rendered, mixed and mastered* by this
script. Edit the MIDI in any DAW, run the script, commit both. The manifest
in `audio/README.md` documents, per track: BPM, key, sections, which GM
program plays which part, the mix sheet (stem gain/pan in dB) and the master
path.

**Composition: the Terran-One / game-loop rules the arrangements obey**

The reference is StarCraft's Terran One (Glenn Stafford): A minor, ~135 BPM,
steady rock drums and synth bass carrying a hummable lead through sectioned
movements. The loop discipline comes from the game-composition literature
(composercode.com's loop tips, Sweet's *Writing Interactive Music*, the
Slay-the-Princess GDC debrief):

- Sections of 4-8 bars, each written to lead into the next (intro → A → B →
  C → outro), so the wrap reads as one piece with movements, not one bar.
- The loop seam lands on a dominant chord reaching back to the top's tonic —
  the wrap *is* the cadence. (Aeolian V, i.e. E major → A minor, is the
  harmonic-minor move; a plain VII → i works too.)
- Dynamic swells live mid-loop; nothing crescendos at the seam.
- No drum fill exactly on the wrap — it is the predictable, tiring trick.
  Fills sit on the *interior* section boundaries (end of A, end of B).
- The hummable line is the hero. Everything else (pad, arp, strings) is
  support under it.

**Mix & master: make it a record**

Every arrangement renders *per stem* (one instrument per render pass) so a
mix can happen after the fact: stem gains in dB, constant-power mid-side
pan, then a stereo bus: a simple RMS-follower compressor (the drum bus needs
chewing, everything else stays), 0.5 dB of tanh saturation for warmth, and a
true-peak normalise to −1 dBFS. Loudness is measured with the K-weighting
shape ITU-R BS.1770-3 defines (a ~4 dB shelf at 1.7 kHz + 38 Hz high-pass,
evaluated per FFT frame, gated mean of frame powers) and the pre-master gain
is set so every track lands at an integrated ≈ −23 LUFS — the
PlayStation/IESD game-mix target. The script prints the measured numbers so
every iteration of the mix is *observed*, never guessed.
"""

from __future__ import annotations

import struct
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path
from typing import Callable

import numpy as np
import tinysoundfont

ROOT = Path(__file__).resolve().parent.parent
MIDI_DIR = ROOT / "audio" / "midi"
OUT_DIR = ROOT / "public" / "audio"
SF_DIR = ROOT / "audio" / "soundfonts"

SOUNDFONT_NAME = "MuseScore_General.sf3"
SOUNDFONT_URL = (
    "https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/"
    "MuseScore_General.sf3"
)

SAMPLE_RATE = 22050
BARS = 16
TICKS = BARS * 16  # the loop, in 16ths

# --------------------------------------------------------------- MIDI writer

TPB = 480
TPB16 = TPB // 4


def varlen(value: int) -> bytes:
    if value < 0:
        raise ValueError("negative delta")
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(out))


class Track:
    """One named MIDI track: program on a channel, notes on the 16th grid."""

    def __init__(self, name: str, channel: int, program: int):
        self.name = name
        self.channel = channel
        self.program = program
        self.notes: list[tuple[int, int, int, int]] = []

    def note(self, t16: int, midi: int, vel: int, dur16: int = 1) -> "Track":
        self.notes.append((t16, midi, vel, dur16))
        return self

    def run(self, t16: int, notes: list[int], step: int, vel: int, dur16: int = 1) -> "Track":
        for i, midi in enumerate(notes):
            self.note(t16 + i * step, midi, vel, dur16)
        return self

    def chord(self, t16: int, midi: list[int], vel: int, dur16: int) -> "Track":
        for m in midi:
            self.note(t16, m, vel, dur16)
        return self

    def events(self) -> list[tuple[int, bytes]]:
        ev: list[tuple[int, bytes]] = [(0, bytes([0xC0 | self.channel, self.program]))]
        for t16, midi, vel, dur in sorted(self.notes):
            tick = t16 * TPB16
            ev.append((tick, bytes([0x90 | self.channel, midi, max(1, min(127, vel))])))
            ev.append((tick + dur * TPB16, bytes([0x80 | self.channel, midi, 0])))
        ev.sort(key=lambda e: (e[0], e[1][0] & 0x0F))
        return ev

    def blob(self) -> bytes:
        chunk = bytearray()
        last = 0
        name = self.name.encode("ascii", "wrap")
        for tick, data in [(0, bytes([0xFF, 0x03, len(name)]) + name)] + self.events():
            chunk += varlen(tick - last)
            chunk += data
            last = tick
        chunk += varlen(0) + bytes([0xFF, 0x2F, 0x00])
        return b"MTrk" + struct.pack(">I", len(chunk)) + chunk


def write_midi(tracks: list[Track], out: Path, bpm: int) -> None:
    conductor = bytearray()
    uspn = int(60_000_000 / bpm)
    conductor += varlen(0) + bytes([0xFF, 0x51, 0x03]) + struct.pack(">I", uspn)[1:]
    conductor += varlen(0) + bytes([0xFF, 0x58, 0x04, 4, 2, 24, 8])  # 4/4
    conductor += varlen(0) + bytes([0xFF, 0x2F, 0x00])
    conductor = b"MTrk" + struct.pack(">I", len(conductor)) + bytes(conductor)

    data = bytearray(b"MThd")
    data += struct.pack(">IHHH", 6, 1, len(tracks) + 1, TPB)
    data += conductor
    for t in tracks:
        data += t.blob()
    out.write_bytes(bytes(data))
    print(f"  wrote {out.name} — {BARS} bars @ {bpm} bpm, {len(tracks)} stems")


# ---------------------------------------------------------------- rendering

def render_stem(midi_path: Path, sf_path: Path, bpm: int) -> np.ndarray:
    """One instrument → one stereo buffer, mixed later. The Sequencer clock
    reads the file's own tempo, so the stem is in the arrangement's time."""
    synth = tinysoundfont.Synth(samplerate=SAMPLE_RATE)
    sfid = synth.sfload(str(sf_path))
    if sfid < 0:
        raise RuntimeError(f"couldn't load soundfont {sf_path}")
    seq = tinysoundfont.Sequencer(synth)
    seq.midi_load(str(midi_path))

    total = int(round(BARS * 4 * 60 / bpm * SAMPLE_RATE))
    out = np.empty((total, 2), dtype=np.float32)
    chunk = 1 << 16
    scratch = memoryview(bytearray(chunk * 2 * 4))
    wrote = 0
    while wrote < total:
        n = min(chunk, total - wrote)
        synth.generate(n, scratch)
        view = np.frombuffer(scratch, dtype=np.float32).reshape(chunk, 2)[:n]
        out[wrote : wrote + n] = view
        wrote += n
    return out


# ------------------------------------------------------------- mix & master

def gain_db(db: float) -> float:
    return 10.0 ** (db / 20)


def pan_mid_side(stem: np.ndarray, pan: float) -> np.ndarray:
    """Constant-power pan: a shifted instrument stays loud and the stereo
    image survives — cos^2 + sin^2 = 1 at every position."""
    theta = (min(max(pan, -1), 1) + 1) * np.pi / 4
    return stem * np.array([np.cos(theta), np.sin(theta)], dtype=np.float32)


def k_weighted_rms(x: np.ndarray) -> float:
    """ITU-R BS.1770-3 K-weighting (approximated in the FFT domain): a shelf
    that rises ~4 dB over 1.7 kHz and a 38 Hz 2nd-order high-pass, then the
    absolute gate (the −70 LU threshold) over 4 kHz-length frames. Values are
    comparable across tracks — which is what the manifest asserts."""
    win, hop = 4096, 2048
    window = np.blackman(win).astype(np.float32)
    f = np.fft.rfftfreq(win, d=1.0 / SAMPLE_RATE)
    shelf = np.sqrt((1 + (f / 1681.97) ** 2) / (1 + (f / 903.37) ** 2) * (10**0.4))
    hp = (f / 38.0) ** 2 / np.sqrt(1 + (f / 38.0) ** 4)
    weight = shelf * hp
    frame_powers: list[float] = []
    for start in range(0, len(x) - win, hop):
        mono = x[start : start + win, 0] + x[start : start + win, 1]
        spec = np.fft.rfft(mono * window) / win
        frame_powers.append(float(np.sum(np.abs(spec) ** 2 * weight**2)) * 2)
    if not frame_powers:
        return 0.0
    arr = np.array(frame_powers) + 1e-16
    thresh = 10 ** ((-70.0 + 0.691) / 10)
    gated = arr[np.abs(arr) >= thresh] if np.any(arr >= thresh) else arr
    return float(np.sqrt(np.mean(gated)))


def bus_compress(mix: np.ndarray, threshold_db: float, ratio: float) -> np.ndarray:
    """A single stereo bus compressor over an RMS envelope: windowed level
    follower, soft knee, ~10 ms attack, ~150 ms release. Not a substitute for
    a plug-in, but an honest glue pass for stems recorded at one gain."""
    window, hop = 2048, 1024
    n_windows = (len(mix) - window) // hop + 1
    env = np.zeros(n_windows)
    for i in range(n_windows):
        frame = mix[i * hop : i * hop + window].astype(np.float64)
        env[i] = np.sqrt(np.mean(frame**2)) if frame.size else 0.0
    gr = np.ones(n_windows)
    smoothed = env[0] if env.size else 0.0
    for i in range(env.size):
        over = max(0.0, 20 * np.log10(env[i] + 1e-16) - threshold_db)
        target = 10 ** (-over * (1 - 1 / ratio) / 20)
        if target < smoothed:
            smoothed += (target - smoothed) * 0.2  # attack
        else:
            smoothed += (target - smoothed) * 0.03  # release
        gr[i] = smoothed
    curve = np.interp(np.arange(len(mix)), np.arange(n_windows) * hop, gr)
    return mix * curve.reshape(-1, 1).astype(np.float32)


TARGET_LUFS = -20.0  # the game-mix target the master buses to (see module doc)


def master_chain(stems: list[np.ndarray], sheet: list[tuple[str, float, float]]) -> tuple[np.ndarray, float, float]:
    """The mix: stems → pan → gain (dB) → sum → bus glue → loudness target.
    Returns the master buffer plus its measured K-weighted RMS and true peak
    (dBFS). The K-weighting mirrors ITU-R BS.1770-3's shape; the target is
    the IESD/PlayStation game window, around −20 LUFS integrated."""
    mix = np.zeros_like(stems[0])
    for stem, (_, db, pan) in zip(stems, sheet):
        mix += pan_mid_side(stem, pan) * gain_db(db)
    mix = bus_compress(mix, threshold_db=-18.0, ratio=2.0)
    mix = np.tanh(mix * 1.4) / 1.4  # 0.5 dB of glue at the top of the bus
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = mix * (0.891 / peak)
    # Loudness-stage: bring the integrated level to the target without ever
    # letting the true peak pass −1 dBFS.
    rms = k_weighted_rms(mix)
    rms_target = 10 ** (TARGET_LUFS / 20)
    if rms > 0:
        scale = min(rms_target / rms, 0.891 / (float(np.max(np.abs(mix))) or 1e-9))
        mix = mix * scale
    # The seam's anti-click: the final 2048 samples fade to zero. The loop's
    # tail is the outro's resolved landing, already near-still by then, so the
    # fade is a shape, not a gap.
    fade = 2048
    if len(mix) > fade * 2:
        ramp = np.linspace(1.0, 0.0, fade, dtype=np.float32)
        mix[-fade:, 0] *= ramp
        mix[-fade:, 1] *= ramp
    final_peak = float(np.max(np.abs(mix)))
    return mix, k_weighted_rms(mix), 20 * np.log10(final_peak + 1e-12)


def write_wav(path: Path, data: np.ndarray) -> None:
    pcm = (np.clip(data, -1, 1) * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(pcm.tobytes())


# ------------------------------------------------------------------- notes

def n(name: str) -> int:
    """Note name → MIDI. 'A4' = 69. b/# supported: 'Eb3'."""
    letter = name[0].upper()
    semi = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[letter]
    idx = 1
    while idx < len(name) and name[idx] in "#b":
        semi += 1 if name[idx] == "#" else -1
        idx += 1
    return 12 * (int(name[idx:]) + 1) + semi


# ------------------------------------------------------------------ helpers

DR = {
    "kick": 36,
    "kick2": 35,
    "snare": 38,
    "esnare": 40,
    "clap": 39,
    "rim": 37,
    "hat": 42,
    "ohat": 46,
    "crash": 49,
}


def drums_4floor(d: Track, t0: int, bars: int, *, snare: int = DR["snare"],
                 hats: int = 8, hat_vel: int = 60, double_at: set[int] | None = None,
                 fill_at: set[int] | None = None, open_at: set[int] | None = None,
                 clap: bool = False, crash_at: int | None = None, no_hats: bool = False) -> None:
    """The steady engine: four-on-the-floor kick, snare 2 & 4, hats on `hats`
    (8 = eighth notes, 4 = sixteenths). `fill_at` and `double_at` are bar
    indexes *within* the span — the fills sit on interior section boundaries,
    never on the loop seam."""
    for k in range(bars):
        base = t0 + k * 16
        for beat in range(4):
            d.note(base + beat * 4, DR["kick"], 112)
        d.note(base + 4, snare, 108)
        d.note(base + 12, snare, 108)
        if clap:
            d.note(base + 4, DR["clap"], 70)
            d.note(base + 12, DR["clap"], 70)
        if not no_hats:
            step = max(1, 16 // hats)
            for i in range(0, 16, step):
                vel = hat_vel + (10 if (i // step) % 2 == 1 else 0)
                d.note(base + i, DR["hat"], vel)
        if double_at and k in double_at:
            d.note(base + 14, DR["kick2"], 96)
        if open_at and k in open_at:
            d.note(base + 14, DR["ohat"], 70, 3)
        if crash_at is not None and k == crash_at:
            d.note(base, DR["crash"], 84, 14)
        if fill_at and k in fill_at:
            d.note(base + 6, DR["kick2"], 92)
            d.note(base + 8, DR["rim"], 92)
            d.note(base + 10, DR["rim"], 96)
            d.note(base + 12, DR["rim"], 100)
            d.note(base + 14, snare, 106)


def bass_offbeat(b: Track, t0: int, bars: int, roots: list[int], *,
                 step: int = 2, runs_at: set[int] | None = None, vel: int = 104) -> None:
    """Synthwave bass: offbeat 8ths with an octave pop on the odd half-beat;
    a `run` in a bar's last two counts is the turn-around lick."""
    for k in range(bars):
        base = t0 + k * 16
        root = roots[k % len(roots)]
        for i in range(8):
            t = base + i * step
            octa = 12 if (i % 2 == 1) else 0
            b.note(t, root + octa, vel + (6 if i % 2 == 1 else 0), step)
        if runs_at and k in runs_at:
            b.note(base + 12, root + 12, 100, 1)
            b.note(base + 13, root + 7, 100, 1)
            b.note(base + 14, root + 12, 98, 2)


def bass_pump(b: Track, t0: int, bars: int, roots: list[int], vel: int = 104) -> None:
    """The engine's harder mode: every 16th, an octave pop on the offbeats."""
    for k in range(bars):
        base = t0 + k * 16
        root = roots[k % len(roots)]
        for i in range(16):
            octa = 12 if (i % 4 == 2) else 0
            b.note(base + i, root + octa, vel + (6 if i % 4 == 2 else 0))


def pad_bar(p: Track, t0: int, bars: int, chords: list[list[int]], vel: int = 56) -> None:
    for k in range(bars):
        p.chord(t0 + k * 16, chords[k % len(chords)], vel, 16)


# ------------------------------------------------------------------ tracks

def title_stems() -> tuple[int, list[Track], list[tuple[str, float, float]]]:
    """'Vento Aureo' — the main theme. A minor @ 108. A Terran-style
    narrative: sparse intro → the motif enters → strings breathe → the crest,
    lead an octave up → a dominant hand-off that the seam wraps back to A."""
    chords = ["Am", "F", "Am", "F", "C", "G", "F", "C", "G", "Am", "Am", "F", "C", "G", "Am", "E"]
    voice = {
        "Am": [57, 60, 64, 69],
        "F": [53, 57, 60, 65],
        "C": [55, 60, 64, 67],
        "G": [55, 59, 62, 67],
        "E": [52, 56, 59, 64],  # E major: V of A minor — the wrap's cadence
    }
    root = {"Am": 45, "F": 41, "C": 48, "G": 43, "E": 40}

    drums = Track("Drums", 9, 0)
    bass = Track("Bass", 2, 38)
    pads = Track("Pads", 3, 89)
    strings = Track("Strings", 4, 48)
    lead = Track("Lead", 5, 81)
    arp = Track("Arp", 6, 80)

    # Intro (0-1): the pads and strings open the room; a rim tick counts in.
    for bar in (0, 1):
        pad_bar(pads, bar * 16, 1, [voice[chords[bar]]], 54)
        strings.chord(bar * 16, [x for x in voice[chords[bar]] if x <= 60], 38, 16)
        bass_offbeat(bass, bar * 16, 1, [root[chords[bar]]], vel=88)
        if bar == 1:
            drums.note(8, DR["rim"], 80)
            drums.note(12, DR["rim"], 88)

    # A (2-5): the engine starts; the gold-wind motif plays bars 2 & 4, and a
    # run of arps answers in the gaps.
    for bar in range(2, 6):
        b = bar * 16
        grove_bar = bar - 2
        drums_4floor(drums, b, 1, fill_at={1} if grove_bar == 1 else None)
        bass_offbeat(bass, b, 1, [root[chords[bar]]], runs_at={0} if grove_bar in (1, 3) else None)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 56)
        if grove_bar in (0, 2):
            lead.run(b, [n("A4"), n("C5"), n("E5"), n("A5")], 3, 100, 2)
            lead.run(b + 8, [n("G4"), n("E4"), n("D4"), n("C4")], 2, 88, 2)
        else:
            arp.run(b, [69, 72, 76, 79] * 2, 2, 66, 2)

    # B (6-9): the strings carry; the lead listens — energy saved for the crest.
    for bar in range(6, 10):
        b = bar * 16
        grove_bar = bar - 6
        drums_4floor(drums, b, 1, fill_at={1} if grove_bar == 1 else None)
        bass_offbeat(bass, b, 1, [root[chords[bar]]])
        pad_bar(pads, b, 1, [voice[chords[bar]]], 58)
        strings.run(b + 4, [n("E5"), n("D5"), n("C5"), n("D5")], 2, 76, 2)
        if grove_bar == 2:
            strings.run(b + 8, [n("A4"), n("C5"), n("G4"), n("A4")], 3, 72, 2)

    # C (10-13): the crest. Lead an octave up, sixteenth hats, clap.
    for bar in range(10, 14):
        b = bar * 16
        grove_bar = bar - 10
        drums_4floor(drums, b, 1, hats=4, clap=grove_bar == 0, fill_at={1} if grove_bar == 1 else None)
        bass_offbeat(bass, b, 1, [root[chords[bar]]])
        pad_bar(pads, b, 1, [voice[chords[bar]]], 52)
        strings.chord(b, [x for x in voice[chords[bar]] if x >= 60], 64, 8)
        if grove_bar in (0, 2):
            lead.run(b, [n("A5"), n("E5"), n("C5"), n("A5")], 3, 104, 2)
            lead.run(b + 8, [n("G5"), n("E5"), n("D5"), n("E5")], 2, 96, 2)
        else:
            arp.run(b, [72, 76, 79, 84] * 2, 2, 68, 2)

    # Outro (14-15): Am then the E major hand-off. The fill is small; the wrap
    # is the cadence, and the seam must not announce itself with a drum.
    for bar in (14, 15):
        b = bar * 16
        drums_4floor(drums, b, 1, no_hats=True)
        bass_offbeat(bass, b, 1, [root[chords[bar]]], vel=96)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 50)
        strings.run(b, [n("A4"), n("C5"), n("E5")], 2, 60, 4)

    bpm = 108
    sheet = [
        ("drums", -6.0, 0.0),
        ("bass", -4.0, 0.0),
        ("pads", -11.0, 0.0),
        ("strings", -9.0, -0.25),
        ("lead", -5.0, 0.15),
        ("arp", -10.0, 0.4),
    ]
    return bpm, [drums, bass, pads, strings, lead, arp], sheet


def lia_stems() -> tuple[int, list[Track], list[tuple[str, float, float]]]:
    """Lia — 'Blade Pulse', A minor @ 124. Sword-duel energy: the square lead
    hacks the motif, the arp trembles under it, section B chimes out of the
    middle, the crest doubles down, and V cadences into the wrap."""
    chords = ["Am", "Am", "Am", "F", "G", "Am", "F", "C", "G", "F", "Am", "F", "G", "Am", "G", "E"]
    voice = {
        "Am": [57, 60, 64, 69],
        "F": [53, 57, 60, 65],
        "C": [55, 60, 64, 67],
        "G": [55, 59, 62, 67],
        "E": [52, 56, 59, 64],
    }
    root = {"Am": 45, "F": 41, "C": 48, "G": 43, "E": 40}

    drums = Track("Drums", 9, 0)
    bass = Track("Bass", 2, 38)
    pads = Track("Pads", 3, 89)
    lead = Track("Lead", 4, 80)  # square: the duel's steel
    arp = Track("Arp", 5, 81)

    # Intro 0-1: pulse without the kick; the arp opens.
    for bar in (0, 1):
        b = bar * 16
        bass_pump(bass, b, 1, [root[chords[bar]]], vel=92)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 52)
        arp.run(b, [69, 72, 76, 81], 2, 70, 2)
        if bar == 1:
            drums.note(8, DR["hat"], 62)
            drums.note(12, DR["hat"], 66)

    # A 2-5: four-floor + the motif, answered by an arp riff.
    for bar in range(2, 6):
        b = bar * 16
        g = bar - 2
        drums_4floor(drums, b, 1, fill_at={1} if g == 1 else None)
        bass_offbeat(bass, b, 1, [root[chords[bar]]], runs_at={0} if g == 1 else None)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 54)
        if g in (0, 2):
            lead.run(b, [n("A4"), n("C5"), n("D5"), n("C5")], 2, 104, 2)
            lead.run(b + 8, [n("E5"), n("D5"), n("C5"), n("A4")], 2, 96, 2)
        else:
            arp.run(b, [69, 76, 72, 79, 76, 84, 79, 88], 1, 74, 1)

    # B 6-9: open the harmony; strings of light, lead answers softly.
    for bar in range(6, 10):
        b = bar * 16
        g = bar - 6
        drums_4floor(drums, b, 1, hats=4 if g >= 2 else 8, fill_at={1} if g == 1 else None)
        bass_offbeat(bass, b, 1, [root[chords[bar]]])
        pad_bar(pads, b, 1, [voice[chords[bar]]], 58)
        arp.run(b + 2, [72, 79, 76, 84] * 2, 2, 66, 2)
        if g in (0, 2):
            lead.note(b, n("E5"), 96, 3)
            lead.run(b + 6, [n("D5"), n("C5"), n("A4")], 2, 88, 2)

    # C 10-13: the crest — octave-up motif, hats sixteenth, clap, heavier fills.
    for bar in range(10, 14):
        b = bar * 16
        g = bar - 10
        drums_4floor(drums, b, 1, hats=4, clap=g == 0, fill_at={1} if g == 1 else None,
                     double_at={0} if g in (1, 3) else None)
        bass_offbeat(bass, b, 1, [root[chords[bar]]], runs_at={0} if g == 2 else None)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 52)
        if g in (0, 2):
            lead.run(b, [n("A5"), n("C5"), n("D5"), n("C5")], 2, 106, 2)
            lead.run(b + 8, [n("E5"), n("D5"), n("C5")], 2, 98, 2)
        else:
            arp.run(b, [76, 81, 84, 88] * 2, 2, 70, 2)

    # Outro 14-15: G then the E cadence into the wrap; hats soft; no fill.
    for bar in (14, 15):
        b = bar * 16
        drums_4floor(drums, b, 1, no_hats=True)
        bass_offbeat(bass, b, 1, [root[chords[bar]]], vel=96)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 50)
        lead.note(b, n(["G4", "B4"][bar - 14]), 90, 4)

    bpm = 124
    sheet = [
        ("drums", -6.0, 0.0),
        ("bass", -4.0, 0.0),
        ("pads", -11.0, 0.0),
        ("lead", -5.5, 0.1),
        ("arp", -10.5, 0.35),
    ]
    return bpm, [drums, bass, pads, lead, arp], sheet


def anands_stems() -> tuple[int, list[Track], list[tuple[str, float, float]]]:
    """Anands — 'Dagger Storm', E minor @ 146. The storm: sixteen-note bass
    pump, sixteenth hats, a staccato saw; the middle vents (the one breath in
    the storm), and the crest doubles the kick. V = B major into the wrap."""
    chords = ["Em", "Em", "Em", "D", "C", "D", "Em", "D", "C", "D", "C", "D", "Em", "D", "Em", "B"]
    voice = {
        "Em": [52, 55, 59, 64],
        "D": [50, 54, 57, 62],
        "C": [48, 55, 60, 64],
        "B": [47, 51, 54, 59],
    }
    root = {"Em": 40, "D": 38, "C": 36, "B": 35}

    drums = Track("Drums", 9, 0)
    bass = Track("Bass", 2, 38)
    stabs = Track("Stabs", 3, 80)  # the square knife
    lead = Track("Lead", 4, 81)  # the saw whirl
    pads = Track("Pads", 5, 92)
    arp = Track("Arp", 6, 82)  # the glint of the storm

    # Intro 0-1: the storm rises — bass pump, hats, one stab.
    for bar in (0, 1):
        b = bar * 16
        bass_pump(bass, b, 1, [root[chords[bar]]], vel=90)
        for i in range(8):
            drums.note(b + i * 2, DR["hat"], 60 + (8 if i % 2 else 0))
        stabs.chord(b + 8, voice[chords[bar]], 80, 2)
        if bar == 1:
            drums.note(b + 12, DR["esnare"], 104)

    # A 2-5: full rate — pump, sixteenths, stabs on the offbeats, saw runs.
    for bar in range(2, 6):
        b = bar * 16
        g = bar - 2
        drums_4floor(drums, b, 1, hats=4, hat_vel=56, fill_at={1} if g == 1 else None,
                     open_at={3} if g == 1 else None)
        bass_pump(bass, b, 1, [root[chords[bar]]])
        for i in (2, 6, 10, 14):
            stabs.chord(b + i, voice[chords[bar]], 86, 1)
        if g in (0, 2):
            lead.run(b, [n("E5"), n("G5"), n("A5"), n("B5")], 1, 100, 1)
            lead.run(b + 8, [n("D5"), n("E5"), n("G5"), n("E5")], 1, 92, 1)
        else:
            arp.run(b, [n("C5"), n("B4"), n("G4"), n("E4")], 1, 84)

    # B 6-9: the vent — drums half out, the stabs echo, pads breathe.
    for bar in range(6, 10):
        b = bar * 16
        g = bar - 6
        if g < 2:
            drums.note(b, DR["kick"], 104)
            drums.note(b + 8, DR["kick"], 104)
            drums.note(b + 12, DR["esnare"], 92)
        else:
            drums_4floor(drums, b, 1, hats=4)
        bass_pump(bass, b, 1, [root[chords[bar]]], vel=96)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 56)
        stabs.chord(b + 8, voice[chords[bar]], 76, 2)
        if g in (2, 3):
            lead.note(b + 4, n("E4"), 78, 4)

    # C 10-13: the crest. Double kick, clap, saw at full height.
    for bar in range(10, 14):
        b = bar * 16
        g = bar - 10
        drums_4floor(drums, b, 1, hats=4, clap=True, fill_at={1} if g == 1 else None,
                     double_at={0, 2} if g >= 2 else None)
        bass_pump(bass, b, 1, [root[chords[bar]]])
        stabs.chord(b + 4, voice[chords[bar]], 90, 1)
        stabs.chord(b + 12, voice[chords[bar]], 90, 1)
        if g in (0, 2):
            lead.run(b, [n("E5"), n("F5"), n("E5"), n("B4"), n("C5"), n("B4"), n("A4"), n("B4")], 2, 102, 2)
            lead.run(b + 12, [n("E5"), n("G5")], 2, 98, 2)
        else:
            arp.run(b, [n("B5"), n("G5"), n("E5"), n("D5")], 1, 86)

    # Outro 14-15: Em, then B — V into the wrap. The storm is already spending.
    for bar in (14, 15):
        b = bar * 16
        bass_pump(bass, b, 1, [root[chords[bar]]], vel=94)
        drums.note(b, DR["kick"], 108)
        drums.note(b + 8, DR["kick"], 108)
        drums.note(b + 12, DR["esnare"], 96)
        stabs.chord(b + 4, voice[chords[bar]], 80, 1)

    bpm = 146
    sheet = [
        ("drums", -7.5, 0.0),
        ("bass", -3.5, 0.0),
        ("stabs", -7.0, -0.15),
        ("lead", -5.0, 0.2),
        ("pads", -12.0, 0.3),
        ("arp", -11.0, 0.4),
    ]
    return bpm, [drums, bass, stabs, lead, pads, arp], sheet


def jeffs_stems() -> tuple[int, list[Track], list[tuple[str, float, float]]]:
    """Jeffs — 'Executioner', F minor @ 100. Half-time heaviness: the guitar
    sobs an overdriven figure, the bass groans 16ths, the horn cries the
    theme; the middle doubles the tempo inside itself, and C (V of F minor)
    hands back to the top."""
    chords = ["Fm", "Fm", "Fm", "Ab", "Db", "Eb", "Fm", "Ab", "Db", "Eb", "Fm", "Fm", "Ab", "Ab", "Fm", "C"]
    voice = {
        "Fm": [53, 56, 60, 65],
        "Ab": [56, 60, 63, 68],
        "Db": [49, 61, 65, 70],
        "Eb": [51, 58, 62, 68],
        "C": [48, 55, 60, 64],
    }
    root = {"Fm": 41, "Ab": 44, "Db": 49, "Eb": 51, "C": 48}

    drums = Track("Drums", 9, 0)
    bass = Track("Bass", 2, 38)
    guitar = Track("Guitar", 3, 27)  # clean-tick: the figure
    horn = Track("Horn", 4, 60)  # the crying lead
    pads = Track("Pads", 5, 89)

    # Intro 0-1: the horn alone over pads — the room's darkness.
    for bar in (0, 1):
        b = bar * 16
        pad_bar(pads, b, 1, [voice[chords[bar]]], 54)
        if bar == 0:
            horn.note(b, n("F4"), 84, 8)
            horn.note(b + 8, n("Ab4"), 80, 8)
        else:
            horn.note(b, n("Db5"), 82, 6)
            horn.note(b + 6, n("C5"), 86, 10)
        bass.note(b + 2, root[chords[bar]], 88, 2)
        bass.note(b + 6, root[chords[bar]], 88, 2)

    # A 2-5: half-time — kick on 1, snare on 3, the figure chugs.
    for bar in range(2, 6):
        b = bar * 16
        g = bar - 2
        half_time(drums, b, 1, fill=g == 1)
        bass_pump(bass, b, 1, [root[chords[bar]]], vel=100)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 50)
        guitar.run(b, [n("F3"), n("C4"), n("F3"), n("C4"), n("F3"), n("C4"), n("Ab3"), n("C4")], 2, 92, 2)
        if g in (1, 3):
            horn.run(b + 4, [n("F4"), n("G4"), n("Ab4"), n("C5")], 4, 92, 3)

    # B 6-9: the strings of the storm stop, the double-time twist starts.
    for bar in range(6, 10):
        b = bar * 16
        g = bar - 6
        if g < 2:
            half_time(drums, b, 1, fill=g == 1)
        else:
            drums_4floor(drums, b, 1, hats=4, double_at={0} if g == 3 else None)
        bass_pump(bass, b, 1, [root[chords[bar]]], vel=104)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 54)
        guitar.run(b, [n("F3"), n("C4"), n("Db3"), n("C4"), n("F3"), n("C4"), n("Eb3"), n("C4")], 2, 86, 2)

    # C 10-13: full weight, horns doubled, hats sixteenth.
    for bar in range(10, 14):
        b = bar * 16
        g = bar - 10
        drums_4floor(drums, b, 1, hats=4, clap=g == 0, fill_at={1} if g == 1 else None, open_at={3} if g >= 2 else None)
        bass_pump(bass, b, 1, [root[chords[bar]]])
        pad_bar(pads, b, 1, [voice[chords[bar]]], 50)
        if g in (0, 2):
            horn.run(b + 4, [n("F4"), n("G4"), n("Ab4"), n("C5")], 4, 98, 3)
        guitar.run(b, [n("F3"), n("C4"), n("Ab3"), n("C4"), n("F3"), n("C4"), n("G3"), n("C4")], 2, 88, 2)

    # Outro 14-15: Fm, then C — V. The last long note is the seal.
    for bar in (14, 15):
        b = bar * 16
        drums_4floor(drums, b, 1, no_hats=True)
        bass_offbeat(bass, b, 1, [root[chords[bar]]], vel=92)
        pad_bar(pads, b, 1, [voice[chords[bar]]], 50)
        horn.note(b, n(["F4", "C5"][bar - 14]), 92, 14)

    bpm = 104
    sheet = [
        ("drums", -7.0, 0.0),
        ("bass", -3.5, 0.0),
        ("guitar", -9.0, -0.3),
        ("horn", -6.0, 0.15),
        ("pads", -11.5, 0.25),
    ]
    return bpm, [drums, bass, guitar, horn, pads], sheet


def half_time(d: Track, t0: int, bars: int, *, fill: bool = False) -> None:
    """Kick on 1, snare on 3 — the weight. `fill` puts the interior fill."""
    for k in range(bars):
        b = t0 + k * 16
        d.note(b, DR["kick"], 108)
        d.note(b + 8, DR["esnare"], 104, 2)
        for i in range(4):
            d.note(b + i * 4, DR["hat"], 54)
        if fill:
            d.note(b + 10, DR["rim"], 88)
            d.note(b + 12, DR["rim"], 94)
            d.note(b + 14, DR["esnare"], 102)


# -------------------------------------------------------------------- main

TRACKS: dict[str, Callable[[], tuple[int, list[Track], list[tuple[str, float, float]]]]] = {
    "title": title_stems,
    "lia": lia_stems,
    "anands": anands_stems,
    "jeffs": jeffs_stems,
}


def build(track_id: str, sf_path: Path) -> None:
    bpm, stems, sheet = TRACKS[track_id]()
    midi_path = MIDI_DIR / f"{track_id}-loop.mid"
    write_midi(stems, midi_path, bpm)

    # Per-stem renders through temporary single-stem MIDI files: the Sequencer
    # can't mute channels, so a stem is its own file. The arrangement file
    # above stays the artist's file; these are the mixing passes.
    buffers: list[np.ndarray] = []
    with tempfile.TemporaryDirectory() as tmp:
        for stem in stems:
            only = Track(stem.name, stem.channel, stem.program)
            only.notes = list(stem.notes)
            stem_path = Path(tmp) / f"{stem.name}.mid"
            write_midi([only], stem_path, bpm)
            buffers.append(render_stem(stem_path, sf_path, bpm))

    master, rms, peak_db = master_chain(buffers, sheet)
    out_path = OUT_DIR / f"{track_id}-loop.wav"
    write_wav(out_path, master)

    lufs = 20 * np.log10(rms + 1e-12)
    print(f"  mixed {out_path.name}: K-weighted integrated {lufs:.1f} LUFS, "
          f"true peak {peak_db:.1f} dBFS, {buffer_sec(master):.1f}s loop")

def buffer_sec(x: np.ndarray) -> float:
    return len(x) / SAMPLE_RATE


def main() -> None:
    SF_DIR.mkdir(parents=True, exist_ok=True)
    MIDI_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sf_path = SF_DIR / SOUNDFONT_NAME
    if not sf_path.exists():
        print(f"downloading {SOUNDFONT_NAME} from {SOUNDFONT_URL}")
        urllib.request.urlretrieve(SOUNDFONT_URL, sf_path)
    if sf_path.stat().st_size < 5_000_000:
        raise RuntimeError(f"{sf_path} looks truncated ({sf_path.stat().st_size} bytes)")

    only = None
    for arg in sys.argv[1:]:
        if arg.startswith("--only="):
            only = arg.split("=", 1)[1]

    for track_id in TRACKS:
        if only and track_id != only:
            continue
        print(f"[{track_id}]")
        build(track_id, sf_path)

    total_bytes = sum(p.stat().st_size for p in OUT_DIR.glob("*.wav"))
    print(f"payload: {total_bytes / 1e6:.2f} MB total")


if __name__ == "__main__":
    main()
