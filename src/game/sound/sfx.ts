/**
 * The SFX bank: every one-shot in the game, synthesized at play time.
 *
 * All sound is generated — no samples, no files, no decode latency, and no
 * payload. Each patch is a small recipe of oscillators and filtered noise
 * shaped by gain envelopes, the classic game-synth grammar: a strike is a
 * pitched-down body hit plus a noise crack, a swing is a band-swept whoosh, a
 * reload is two clicks of a rack.
 *
 * **This is art, not logic** — the numbers (frequencies, times, gains) are
 * frame data the way a sprite's colours are. `biome.json` scopes
 * `noMagicNumbers` off for this folder for exactly the reason it is off for
 * `render/`: nobody tunes a filter with named constants.
 *
 * `playSfx` is the one entry point. It rate-limits per name so a 16-fighter
 * room full of swinging blades reads as a scuffle rather than a roar of a
 * single 25Hz blur, and then defers to the engine's diagnostics counters.
 */

import { audioKit } from "./engine";

export interface SfxOpts {
	/** 0..1 attenuation — used for distance falloff from the local fighter. */
	gain?: number;
	/** 0.5..2 — pitch the whole patch (gun kind, muscle of a swing). */
	pitch?: number;
	/** -1..1 — stereo placement, from the local fighter's position. */
	pan?: number;
}

type Kit = { ctx: AudioContext; out: GainNode; noise: AudioBuffer };

/** Same-name gap; longer makes chains of hits smear into a single rumble. */
const NAME_COOLDOWN_MS = 36;
/** A whole swing's whenClocked attack; below that snap loses its snap. */
const ATTACK_MS = 5;

const clamp = (v: number, lo: number, hi: number): number =>
	Math.max(lo, Math.min(hi, v));

/** A per-play gain node between the patch and the sfx bus: distance falloff. */
function kitOf(opts: SfxOpts): Kit | null {
	const ctx = audioKit.ensure();
	const bus = audioKit.sfxOutput;
	const noise = audioKit.noise();
	if (!ctx || !bus || !noise) return null;
	const out = ctx.createGain();
	out.gain.value = Math.max(0.0001, clamp(opts.gain ?? 1, 0, 1));
	out.connect(bus);
	return { ctx, out, noise };
}

interface OscCfg {
	type: OscillatorType;
	f0: number;
	f1?: number;
	durMs: number;
	peak: number;
	whenMs?: number;
	pan?: number | undefined;
	detune?: number;
}

function osc(k: Kit, cfg: OscCfg): void {
	const { ctx, out } = k;
	const t0 = ctx.currentTime + (cfg.whenMs ?? 0) / 1000;
	const pan = ctx.createStereoPanner();
	pan.pan.setValueAtTime(clamp(cfg.pan ?? 0, -1, 1), t0);
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, t0);
	gain.gain.exponentialRampToValueAtTime(
		Math.max(0.0001, cfg.peak),
		t0 + ATTACK_MS / 1000,
	);
	gain.gain.exponentialRampToValueAtTime(0.0001, t0 + cfg.durMs / 1000);
	const node = ctx.createOscillator();
	node.type = cfg.type;
	node.frequency.setValueAtTime(cfg.f0, t0);
	if (cfg.f1 !== undefined) {
		node.frequency.exponentialRampToValueAtTime(
			Math.max(20, cfg.f1),
			t0 + cfg.durMs / 1000,
		);
	}
	if (cfg.detune) node.detune.value = cfg.detune;
	node.connect(gain);
	gain.connect(pan);
	pan.connect(out);
	node.start(t0);
	node.stop(t0 + cfg.durMs / 1000 + 0.03);
}

interface NoiseCfg {
	filter: BiquadFilterType;
	f0: number;
	f1?: number;
	q: number;
	durMs: number;
	peak: number;
	whenMs?: number;
	pan?: number | undefined;
}

function noise(k: Kit, cfg: NoiseCfg): void {
	const { ctx, out, noise } = k;
	const t0 = ctx.currentTime + (cfg.whenMs ?? 0) / 1000;
	const pan = ctx.createStereoPanner();
	pan.pan.setValueAtTime(clamp(cfg.pan ?? 0, -1, 1), t0);
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, t0);
	gain.gain.exponentialRampToValueAtTime(
		Math.max(0.0001, cfg.peak),
		t0 + ATTACK_MS / 1000,
	);
	gain.gain.exponentialRampToValueAtTime(0.0001, t0 + cfg.durMs / 1000);
	const filter = ctx.createBiquadFilter();
	filter.type = cfg.filter;
	filter.Q.value = cfg.q;
	filter.frequency.setValueAtTime(cfg.f0, t0);
	if (cfg.f1 !== undefined) {
		filter.frequency.exponentialRampToValueAtTime(
			Math.max(40, cfg.f1),
			t0 + cfg.durMs / 1000,
		);
	}
	const source = ctx.createBufferSource();
	source.buffer = noise;
	source.loop = true;
	source.connect(filter);
	filter.connect(gain);
	gain.connect(pan);
	pan.connect(out);
	source.start(t0, Math.random() * 0.5);
	source.stop(t0 + cfg.durMs / 1000 + 0.03);
}

type Patch = (k: Kit, o: SfxOpts) => void;

const patches: Record<string, Patch> = {
	// ------------------------------------------------ UI
	"ui-hover": (k) =>
		osc(k, { type: "sine", f0: 880, f1: 720, durMs: 40, peak: 0.1 }),
	"ui-click": (k) =>
		osc(k, { type: "triangle", f0: 340, f1: 460, durMs: 70, peak: 0.26 }),
	"ui-back": (k) =>
		osc(k, { type: "triangle", f0: 420, f1: 240, durMs: 90, peak: 0.24 }),

	// ------------------------------------------------ melee
	swing: (k, o) =>
		noise(k, {
			filter: "bandpass",
			f0: 700,
			f1: 2800,
			q: 1.4,
			durMs: 150,
			peak: 0.38,
			pan: o.pan,
		}),
	"swing-stab": (k, o) =>
		noise(k, {
			filter: "bandpass",
			f0: 1200,
			f1: 2600,
			q: 1.6,
			durMs: 100,
			peak: 0.3,
			pan: o.pan,
		}),
	thrust: (k, o) =>
		noise(k, {
			filter: "bandpass",
			f0: 400,
			f1: 3200,
			q: 1.1,
			durMs: 220,
			peak: 0.44,
			pan: o.pan,
		}),
	uppercut: (k, o) => {
		noise(k, {
			filter: "bandpass",
			f0: 300,
			f1: 4200,
			q: 1.0,
			durMs: 260,
			peak: 0.5,
			pan: o.pan,
		});
		osc(k, {
			type: "sawtooth",
			f0: 160,
			f1: 520,
			durMs: 220,
			peak: 0.16,
			pan: o.pan,
		});
	},
	"massive-swing": (k, o) =>
		noise(k, {
			filter: "bandpass",
			f0: 220,
			f1: 1400,
			q: 0.9,
			durMs: 420,
			peak: 0.55,
			pan: o.pan,
		}),
	hit: (k, o) => {
		osc(k, {
			type: "triangle",
			f0: 230,
			f1: 90,
			durMs: 150,
			peak: 0.9,
			pan: o.pan,
		});
		noise(k, {
			filter: "bandpass",
			f0: 2400,
			f1: 700,
			q: 1.1,
			durMs: 110,
			peak: 0.42,
			pan: o.pan,
		});
	},
	"hit-heavy": (k, o) => {
		osc(k, {
			type: "sine",
			f0: 150,
			f1: 55,
			durMs: 280,
			peak: 1.0,
			pan: o.pan,
		});
		noise(k, {
			filter: "lowpass",
			f0: 900,
			f1: 180,
			q: 0.8,
			durMs: 240,
			peak: 0.65,
			pan: o.pan,
		});
		osc(k, {
			type: "sawtooth",
			f0: 90,
			f1: 40,
			durMs: 200,
			peak: 0.3,
			pan: o.pan,
		});
	},
	guard: (k, o) => {
		noise(k, {
			filter: "highpass",
			f0: 4200,
			q: 0.9,
			durMs: 70,
			peak: 0.26,
			pan: o.pan,
		});
		osc(k, {
			type: "triangle",
			f0: 1600,
			f1: 900,
			durMs: 90,
			peak: 0.3,
			pan: o.pan,
		});
	},
	parry: (k, o) => {
		noise(k, {
			filter: "highpass",
			f0: 6000,
			q: 1.2,
			durMs: 120,
			peak: 0.32,
			pan: o.pan,
		});
		osc(k, {
			type: "sine",
			f0: 2400,
			f1: 1200,
			durMs: 220,
			peak: 0.42,
			pan: o.pan,
		});
	},
	guardbreak: (k, o) => {
		noise(k, {
			filter: "highpass",
			f0: 8000,
			q: 0.7,
			durMs: 260,
			peak: 0.5,
			pan: o.pan,
		});
		osc(k, {
			type: "sawtooth",
			f0: 1400,
			f1: 300,
			durMs: 300,
			peak: 0.36,
			pan: o.pan,
		});
	},

	// ------------------------------------------------ movement
	dash: (k, o) =>
		noise(k, {
			filter: "bandpass",
			f0: 420,
			f1: 1900,
			q: 1.2,
			durMs: 170,
			peak: 0.4,
			pan: o.pan,
		}),
	roll: (k, o) =>
		noise(k, {
			filter: "lowpass",
			f0: 380,
			f1: 130,
			q: 0.8,
			durMs: 230,
			peak: 0.42,
			pan: o.pan,
		}),
	jump: (k, o) =>
		osc(k, {
			type: "sine",
			f0: 300,
			f1: 560,
			durMs: 90,
			peak: 0.22,
			pan: o.pan,
		}),
	"jump-air": (k, o) =>
		osc(k, {
			type: "sine",
			f0: 400,
			f1: 720,
			durMs: 100,
			peak: 0.24,
			pan: o.pan,
		}),
	land: (k, o) => {
		osc(k, {
			type: "sine",
			f0: 150,
			f1: 70,
			durMs: 70,
			peak: 0.32,
			pan: o.pan,
		});
		noise(k, {
			filter: "lowpass",
			f0: 600,
			f1: 200,
			q: 0.8,
			durMs: 60,
			peak: 0.2,
			pan: o.pan,
		});
	},
	spawn: (k) =>
		osc(k, { type: "sine", f0: 440, f1: 880, durMs: 160, peak: 0.22 }),

	// ------------------------------------------------ ranged
	shot: (k, o) => {
		osc(k, {
			type: "square",
			f0: 190,
			f1: 80,
			durMs: 110,
			peak: 0.75,
			pan: o.pan,
		});
		noise(k, {
			filter: "bandpass",
			f0: 2200,
			f1: 600,
			q: 1.0,
			durMs: 90,
			peak: 0.4,
			pan: o.pan,
		});
	},
	"shot-heavy": (k, o) => {
		osc(k, {
			type: "sine",
			f0: 220,
			f1: 55,
			durMs: 320,
			peak: 1.0,
			pan: o.pan,
		});
		noise(k, {
			filter: "lowpass",
			f0: 2500,
			f1: 300,
			q: 0.7,
			durMs: 260,
			peak: 0.7,
			pan: o.pan,
		});
	},
	reload: (k) => {
		noise(k, {
			filter: "bandpass",
			f0: 1800,
			q: 2.0,
			durMs: 30,
			peak: 0.24,
		});
		noise(k, {
			filter: "bandpass",
			f0: 1600,
			q: 1.8,
			durMs: 34,
			peak: 0.3,
			whenMs: 120,
		});
	},
	"reload-shell": (k) => {
		noise(k, {
			filter: "lowpass",
			f0: 500,
			q: 1.0,
			durMs: 70,
			peak: 0.34,
		});
		noise(k, {
			filter: "bandpass",
			f0: 2000,
			q: 2.0,
			durMs: 26,
			peak: 0.22,
			whenMs: 150,
		});
	},
	dry: (k) =>
		noise(k, {
			filter: "bandpass",
			f0: 2600,
			q: 2.0,
			durMs: 26,
			peak: 0.2,
		}),

	// ------------------------------------------------ items and ultimate
	throw: (k, o) =>
		noise(k, {
			filter: "bandpass",
			f0: 600,
			f1: 2400,
			q: 1.2,
			durMs: 170,
			peak: 0.3,
			pan: o.pan,
		}),
	explosion: (k, o) => {
		osc(k, { type: "sine", f0: 90, f1: 38, durMs: 500, peak: 1.0, pan: o.pan });
		noise(k, {
			filter: "lowpass",
			f0: 3000,
			f1: 140,
			q: 0.6,
			durMs: 520,
			peak: 0.85,
			pan: o.pan,
		});
	},
	root: (k, o) => {
		osc(k, {
			type: "sawtooth",
			f0: 700,
			f1: 260,
			durMs: 200,
			peak: 0.5,
			pan: o.pan,
		});
		noise(k, {
			filter: "highpass",
			f0: 3000,
			q: 1.0,
			durMs: 170,
			peak: 0.3,
			pan: o.pan,
		});
	},
	"ult-ready": (k) => {
		osc(k, { type: "sine", f0: 523, durMs: 90, peak: 0.22 });
		osc(k, { type: "sine", f0: 659, durMs: 90, peak: 0.22, whenMs: 100 });
		osc(k, { type: "sine", f0: 784, durMs: 160, peak: 0.26, whenMs: 200 });
	},
	"ult-cast": (k, o) => {
		osc(k, { type: "sine", f0: 60, f1: 32, durMs: 900, peak: 1.0, pan: o.pan });
		noise(k, {
			filter: "bandpass",
			f0: 500,
			f1: 3800,
			q: 0.8,
			durMs: 600,
			peak: 0.6,
			pan: o.pan,
		});
	},
	"hole-open": (k, o) => {
		osc(k, { type: "sine", f0: 50, f1: 80, durMs: 700, peak: 0.8, pan: o.pan });
		noise(k, {
			filter: "lowpass",
			f0: 300,
			f1: 120,
			q: 1.0,
			durMs: 700,
			peak: 0.6,
			pan: o.pan,
		});
	},
	blossom: (k, o) => {
		osc(k, {
			type: "sawtooth",
			f0: 120,
			f1: 800,
			durMs: 380,
			peak: 0.5,
			pan: o.pan,
		});
		noise(k, {
			filter: "bandpass",
			f0: 900,
			f1: 3200,
			q: 0.9,
			durMs: 320,
			peak: 0.5,
			pan: o.pan,
		});
	},
	deny: (k, o) => {
		osc(k, {
			type: "square",
			f0: 392,
			f1: 311,
			durMs: 200,
			peak: 0.4,
			pan: o.pan,
		});
		noise(k, {
			filter: "bandpass",
			f0: 3200,
			f1: 1000,
			q: 1.4,
			durMs: 160,
			peak: 0.3,
			pan: o.pan,
		});
	},

	// ------------------------------------------------ the kill and the match
	kill: (k, o) => {
		osc(k, {
			type: "sine",
			f0: 660,
			f1: 990,
			durMs: 140,
			peak: 0.34,
			pan: o.pan,
		});
		noise(k, {
			filter: "bandpass",
			f0: 1600,
			f1: 3000,
			q: 1.0,
			durMs: 130,
			peak: 0.3,
			pan: o.pan,
		});
	},
	die: (k, o) => {
		osc(k, {
			type: "sawtooth",
			f0: 300,
			f1: 60,
			durMs: 380,
			peak: 0.5,
			pan: o.pan,
		});
		osc(k, {
			type: "sine",
			f0: 180,
			f1: 50,
			durMs: 400,
			peak: 0.5,
			pan: o.pan,
		});
	},
	fight: (k) => {
		for (const f of [220, 261.6, 329.6]) {
			osc(k, { type: "sawtooth", f0: f, durMs: 320, peak: 0.4, detune: 6 });
		}
	},
	"round-win": (k) => {
		for (const [note, ms] of [
			[440, 0],
			[554, 120],
			[659, 240],
		] as const) {
			osc(k, { type: "square", f0: note, durMs: 150, peak: 0.3, whenMs: ms });
		}
		osc(k, { type: "square", f0: 880, durMs: 340, peak: 0.3, whenMs: 260 });
	},
	"round-lose": (k) => {
		osc(k, { type: "triangle", f0: 392, f1: 370, durMs: 280, peak: 0.34 });
		osc(k, {
			type: "triangle",
			f0: 311,
			f1: 294,
			durMs: 340,
			peak: 0.32,
			whenMs: 160,
		});
	},
	draw: (k) => osc(k, { type: "sine", f0: 330, durMs: 300, peak: 0.3 }),
	"match-over": (k) => {
		for (const [note, ms] of [
			[523, 0],
			[659, 150],
			[784, 300],
			[1046, 450],
		] as const) {
			osc(k, {
				type: "sawtooth",
				f0: note,
				durMs: 260,
				peak: 0.36,
				whenMs: ms,
			});
		}
	},
	"potg-announce": (k) => {
		noise(k, {
			filter: "bandpass",
			f0: 800,
			f1: 2400,
			q: 1.0,
			durMs: 260,
			peak: 0.3,
		});
	},
	potg: (k) => {
		for (const [note, ms] of [
			[587, 0],
			[659, 120],
			[880, 240],
			[1174, 420],
		] as const) {
			osc(k, { type: "sawtooth", f0: note, durMs: 300, peak: 0.3, whenMs: ms });
		}
	},
};

const lastBy = new Map<string, number>();

/**
 * Play one of the bank's sounds.
 *
 * `gain` is an attenuation (the distance falloff the Match computes), `pitch`
 * the variant (who fired, who swung), `pan` the stereo placement. A patch
 * firing inside `NAME_COOLDOWN_MS` of itself is dropped — chains, streams and
 * ultimates read as their movement, not as a single 25Hz buzz.
 */
export function playSfx(name: string, opts: SfxOpts = {}): void {
	const patch = patches[name];
	if (!patch) return;
	const now = performance.now();
	const last = lastBy.get(name) ?? -Infinity;
	if (now - last < NAME_COOLDOWN_MS) return;
	lastBy.set(name, now);

	const kit = kitOf(opts);
	if (!kit) return;
	patch(kit, opts);
	audioKit.notePlayed(name);
}
