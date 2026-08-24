/**
 * The audio engine: the one `AudioContext`, the three-gain mixer it feeds, the
 * music loop player, and the diagnostics every probe reads.
 *
 * **Everything here is presentation.** No simulation module may import this
 * file; sound cues are fired from `Match` and the UI, and the mixer writes
 * never reach the wire. Browsers will not start audio before a user gesture,
 * so the context is created lazily and unlocked on the *first* pointer or key
 * event anywhere — the same autoplay policy every browser enforces.
 *
 * The music is a rendered WAV loop (see `audio/README.md` — MIDI source,
 * soundfont, render script) played through `BufferSource.loop`, so the seam is
 * sample-exact: the render script fades the loop's final 2048 samples and the
 * file's first sample is the downbeat, so the cut lands near silence and the
 * beat never wavers. Switching tracks crossfades (old clips fade out under the
 * new one fading in) so a match boot does not slam the menu groove into the
 * fight groove.
 *
 * The `duck` is the mixer's answer to hitstop's absence: the ultimate's
 * cinematic freeze is a frame *pause*, not a volume change, so the music ducks
 * under the loudest things (the freeze's boom, the podium fanfare) and comes
 * back on its own.
 */

import { type AudioChannel, type AudioPreferences, audioMixer } from "./mixer";

export type MusicTrack = "title" | "lia" | "anands" | "jeffs";

export interface AudioKitState {
	/** "running" once a user gesture unlocked the context; "suspended" before. */
	contextState: string;
	/** The track currently selected, or null. */
	track: MusicTrack | null;
	/** True once that track's buffer is decoded and its source playing. */
	playing: boolean;
	/** True while a duck (the ultimate's freeze, a fanfare) is active. */
	ducked: boolean;
	/** Sounds that have ever played, by name — what the probe asserts on. */
	byName: Record<string, number>;
	soundsPlayed: number;
	/** Decode or network failures: a probe must tell "no sound" from "broken". */
	musicErrors: number;
	preferences: AudioPreferences;
}

/** The length of the crossfade when the track switches, ms. */
const TRACK_CROSSFADE_MS = 240;
/** How loud the duck bottoms out at, 0..1 of the music channel. */
const DUCK_LEVEL = 0.16;
/** Longest a music fetch may take before it is a counted failure, ms. */
const MUSIC_FETCH_TIMEOUT_MS = 8000;
/** Gain smoothing when the mixer is written, s. */
const GAIN_SMOOTH_S = 0.04;

/** Perceptual loudness: squared, so a half-loud slider reads half as loud. */
function perceptual(value: number): number {
	return value * value;
}

let noiseBuffer: AudioBuffer | null = null;

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
	const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

class AudioKit {
	private ctx: AudioContext | null = null;
	private masterBus: GainNode | null = null;
	private musicBus: GainNode | null = null;
	private sfxBus: GainNode | null = null;

	// Music state.
	private current: MusicTrack | null = null;
	private source: AudioBufferSourceNode | null = null;
	private readonly buffers = new Map<MusicTrack, AudioBuffer>();
	private fetching: Promise<AudioBuffer | null> | null = null;
	private duckTimer: number | undefined;
	private duckedDown = false;

	// Counters for the diagnostics contract.
	private byName: Record<string, number> = {};
	private total = 0;
	private musicErrors = 0;

	/** Ensure the context exists and the graph is wired. No-op outside a browser. */
	ensure(): AudioContext | null {
		if (this.ctx) return this.ctx;
		if (typeof window === "undefined") return null;
		const Ctor =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!Ctor) return null;
		const ctx = new Ctor();
		this.ctx = ctx;

		// master → destination; music and sfx → master. One graph, three knobs.
		const master = ctx.createGain();
		const music = ctx.createGain();
		const sfx = ctx.createGain();
		music.connect(master);
		sfx.connect(master);
		master.connect(ctx.destination);
		this.masterBus = master;
		this.musicBus = music;
		this.sfxBus = sfx;

		// The browser's autoplay policy. Listen permanently on capture: any
		// pointer or key press anywhere (menu, canvas, deck) resumes the
		// context — a tab the OS suspended does too.
		window.addEventListener("pointerdown", this.resumeForPolicy, {
			capture: true,
		});
		window.addEventListener("keydown", this.resumeForPolicy, { capture: true });

		// The engine is the subscriber that *applies* the mixer; the UI's
		// subscribers live in SoundMixer.
		audioMixer.subscribe(() => this.applyMixer());
		this.applyMixer();
		return ctx;
	}

	private readonly resumeForPolicy = () => {
		if (this.ctx && this.ctx.state !== "running") {
			void this.ctx.resume();
		}
		this.applyMixer();
	};

	/** Apply the mixer preferences to the gain graph right now. */
	private applyMixer(): void {
		if (!this.ctx || !this.masterBus || !this.musicBus || !this.sfxBus) return;
		const prefs = audioMixer.snapshot();
		this.smoothTo(this.masterBus, prefs, "master");
		// Music honours only the *mixer* channel, not the duck: the duck writes
		// to the same gain, so a mixer write would fight it. The duck owns the
		// music bus between its fade-down and its release.
		if (!this.duckedDown) this.smoothTo(this.musicBus, prefs, "music");
		this.smoothTo(this.sfxBus, prefs, "sfx");
		// ...and also fold the master's volume into the buses when the master
		// knob moves — perceptual power combines, per-channel it multiplies.
		const masterGain = prefs.muted.master
			? 0
			: perceptual(prefs.volumes.master);
		const t = this.ctx.currentTime;
		this.masterBus.gain.setTargetAtTime(masterGain, t, GAIN_SMOOTH_S);
	}

	private smoothTo(
		bus: GainNode,
		prefs: AudioPreferences,
		channel: AudioChannel,
	): void {
		if (!this.ctx) return;
		const target = prefs.muted[channel]
			? 0
			: perceptual(prefs.volumes[channel]);
		bus.gain.setTargetAtTime(target, this.ctx.currentTime, GAIN_SMOOTH_S);
	}

	/** The sfx bus, for the synth bank to wire into. */
	get sfxOutput(): GainNode | null {
		return this.sfxBus;
	}

	/** The noise buffer every synth patch shares — 1s of white noise, cached. */
	noise(): AudioBuffer | null {
		const ctx = this.ensure();
		if (!ctx) return null;
		if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
			noiseBuffer = makeNoiseBuffer(ctx);
		}
		return noiseBuffer;
	}

	/** Count a played one-shot for the diagnostics. */
	notePlayed(name: string): void {
		this.byName[name] = (this.byName[name] ?? 0) + 1;
		this.total += 1;
	}

	/**
	 * Switch the (loop) music track. Loads and decodes lazily; a decode failure
	 * is counted, not fatal — the game makes noise without music rather than
	 * not at all. Re-selecting the current track is a no-op, so the boot path
	 * can re-assert it freely.
	 */
	setMusic(track: MusicTrack): void {
		const ctx = this.ensure();
		if (!ctx) return;
		if (this.current === track && this.buffers.has(track)) return;
		this.current = track;
		void this.loadMusic(track).then((buffer) => {
			if (!this.ctx || !this.musicBus) return;
			if (this.current !== track) return; // switched again while decoding
			if (!buffer) {
				this.musicErrors += 1;
				return;
			}
			this.buffers.set(track, buffer);
			this.startMusic(buffer);
		});
	}

	private loadMusic(track: MusicTrack): Promise<AudioBuffer | null> {
		const cached = this.buffers.get(track);
		if (cached) return Promise.resolve(cached);
		if (this.fetching) return this.fetching;
		this.fetching = this.fetchMusic(track).then(async (bits) => {
			this.fetching = null;
			const ctx = this.ctx;
			if (!bits || !ctx) {
				this.musicErrors += 1;
				return null;
			}
			try {
				return await ctx.decodeAudioData(bits);
			} catch {
				this.musicErrors += 1;
				return null;
			}
		});
		return this.fetching;
	}

	private startMusic(buffer: AudioBuffer): void {
		if (!this.ctx || !this.musicBus) return;
		const now = this.ctx.currentTime;
		const old = this.source;
		const fadeIn = this.ctx.createGain();

		// The new track fades in over the old; the old is stopped at the end of
		// the window, so the switch is one smooth crossfade, not a cut.
		fadeIn.connect(this.musicBus);
		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		source.loop = true;
		source.connect(fadeIn);
		fadeIn.gain.setValueAtTime(0.0001, now);
		fadeIn.gain.exponentialRampToValueAtTime(
			1,
			now + TRACK_CROSSFADE_MS / 1000,
		);

		source.onended = () => {
			if (this.source === source) this.source = null;
		};
		source.start(now, 0);
		this.source = source;

		if (old) {
			old.onended = null;
			old.stop(now + TRACK_CROSSFADE_MS / 1000);
		}
	}

	private async fetchMusic(track: MusicTrack): Promise<ArrayBuffer | null> {
		try {
			const ctrl = new AbortController();
			const timer = window.setTimeout(
				() => ctrl.abort(),
				MUSIC_FETCH_TIMEOUT_MS,
			);
			const res = await fetch(
				new URL(`audio/${track}-loop.wav`, window.location.href).href,
				{ signal: ctrl.signal },
			);
			window.clearTimeout(timer);
			if (!res.ok) return null;
			return res.arrayBuffer();
		} catch {
			return null;
		}
	}

	/**
	 * Duck the music for the biggest moments (the ultimate's freeze, the podium
	 * fanfare): fade down, hold, fade back. Safe to call again mid-hold — the
	 * timer restarts from the new call.
	 */
	duck(holdMs: number): void {
		if (!this.ctx || !this.musicBus) return;
		const prefs = audioMixer.snapshot();
		const target = prefs.muted.music
			? 0
			: perceptual(prefs.volumes.music) * DUCK_LEVEL;
		this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
		this.duckedDown = true;
		window.clearTimeout(this.duckTimer);
		this.duckTimer = window.setTimeout(() => {
			if (!this.ctx || !this.musicBus) return;
			this.duckedDown = false; // the mixer may own the bus again
			this.applyMixer();
		}, holdMs);
	}

	/** Current diagnostics, for the harness and the audio probe. */
	state(): AudioKitState {
		return {
			contextState: this.ctx ? this.ctx.state : "uninitialised",
			track: this.current,
			playing: this.source !== null,
			ducked: this.duckedDown,
			byName: { ...this.byName },
			soundsPlayed: this.total,
			musicErrors: this.musicErrors,
			preferences: audioMixer.snapshot(),
		};
	}
}

export const audioKit = new AudioKit();
