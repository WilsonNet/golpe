/**
 * The audio mixer: volumes and mutes for the master, music and sfx channels.
 *
 * A single mutable store rather than React state passed down: the Web Audio
 * engine reads it imperatively on every gain change and the mixer UI writes it,
 * and those two live on opposite sides of a DOM boundary. Subscribers exist so
 * the UI re-renders; the engine needs none, because it applies every write
 * directly.
 *
 * **Persistence:** `localStorage`, keyed `golpe.audio`. Nothing about sound
 * reaches the wire — like rebinding, this is the sort of thing a player sets
 * once and never again, and the simulation never sees it.
 *
 * **The React Compiler rule:** a component must not read this store mid-render
 * (see docs/invariants.md). The mixer UI snapshots into state — see
 * `SoundMixer.tsx` — and asks the snapshot with the pure `isDefaultAudio`.
 */

/** The three channels of the mixer. */
export const AUDIO_CHANNELS = ["master", "music", "sfx"] as const;
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];

export interface AudioPreferences {
	/** 0..1 per channel. The engine squares these for perceptual drift. */
	volumes: Record<AudioChannel, number>;
	muted: Record<AudioChannel, boolean>;
}

export function isDefaultAudio(p: AudioPreferences): boolean {
	return AUDIO_CHANNELS.every(
		(ch) => p.volumes[ch] === DEFAULT_VOLUMES[ch] && p.muted[ch] === false,
	);
}

/** The defaults: master loud, music under the fight, sfx near full. */
const DEFAULT_VOLUMES: Record<AudioChannel, number> = {
	master: 1,
	music: 0.5,
	sfx: 0.9,
};

const DEFAULT_MUTED: Record<AudioChannel, boolean> = {
	master: false,
	music: false,
	sfx: false,
};

const DEFAULTS: AudioPreferences = {
	volumes: DEFAULT_VOLUMES,
	muted: DEFAULT_MUTED,
};

const STORAGE_KEY = "golpe.audio";

/** The persisted shape: every field optional, so an earlier save survives. */
interface StoredAudio {
	volumes?: Record<AudioChannel, number>;
	muted?: Record<AudioChannel, boolean>;
}

/** Take whatever was in storage and make it usable preferences. */
export function sanitiseAudio(raw: unknown): AudioPreferences {
	const out: AudioPreferences = {
		volumes: { ...DEFAULT_VOLUMES },
		muted: { ...DEFAULT_MUTED },
	};
	if (!raw || typeof raw !== "object") return out;
	const src = raw as StoredAudio;
	if (src.volumes && typeof src.volumes === "object") {
		for (const ch of AUDIO_CHANNELS) {
			const v = Number(src.volumes[ch]);
			if (Number.isFinite(v)) {
				out.volumes[ch] = Math.max(0, Math.min(1, v));
			}
		}
	}
	if (src.muted && typeof src.muted === "object") {
		for (const ch of AUDIO_CHANNELS) {
			out.muted[ch] = src.muted[ch] === true;
		}
	}
	return out;
}

export class AudioMixer {
	private prefs: AudioPreferences;
	private readonly listeners = new Set<() => void>();

	constructor(initial: AudioPreferences = DEFAULTS) {
		this.prefs = sanitiseAudio(initial);
	}

	snapshot(): AudioPreferences {
		return {
			volumes: { ...this.prefs.volumes },
			muted: { ...this.prefs.muted },
		};
	}

	setVolume(channel: AudioChannel, value: number): void {
		if (!Number.isFinite(value)) return;
		this.prefs.volumes[channel] = Math.max(0, Math.min(1, value));
		this.changed();
	}

	setMuted(channel: AudioChannel, muted: boolean): void {
		this.prefs.muted[channel] = muted;
		this.changed();
	}

	/** Back to the defaults, wholesale. */
	reset(): void {
		this.prefs = {
			volumes: { ...DEFAULT_VOLUMES },
			muted: { ...DEFAULT_MUTED },
		};
		this.changed();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private changed() {
		for (const listener of [...this.listeners]) listener();
	}
}

/**
 * Does this page ask for silence?
 *
 * `?mute` presence is the signal, exactly like a launch key's presence — that
 * is how a Playwright probe runs a whole match without the game's music and
 * combat sounds playing over whatever else the machine is doing. It starts
 * every channel muted at load and, being an `AudioMixer.constructor` input
 * rather than a `setMuted` write, it never touches `golpe.audio` — nothing a
 * test mutes is something it persists.
 *
 * Deliberately **not** a launch key: `?mute=1` on the bare root URL must still
 * show the menu, not seat a stranger in an arena.
 */
function urlMuted(): boolean {
	try {
		if (typeof window === "undefined") return false;
		return new URLSearchParams(window.location.search).has("mute");
	} catch {
		return false;
	}
}

function load(): AudioPreferences {
	let prefs: AudioPreferences;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		prefs = raw ? sanitiseAudio(JSON.parse(raw)) : DEFAULTS;
	} catch {
		// Private browsing, disabled storage, or a corrupted value. The defaults
		// are a far better failure than a game that starts muted or silent.
		prefs = DEFAULTS;
	}
	if (urlMuted()) {
		prefs = {
			volumes: { ...prefs.volumes },
			muted: { master: true, music: true, sfx: true },
		};
	}
	return prefs;
}

/** The instance the engine and the mixer UI share. */
export const audioMixer = new AudioMixer(
	typeof window === "undefined" ? DEFAULTS : load(),
);

// Persist on every change, in one place: the UI mutates the store and does not
// have to remember to save — exactly like the bindings store.
if (typeof window !== "undefined") {
	audioMixer.subscribe(() => {
		try {
			window.localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(audioMixer.snapshot()),
			);
		} catch {
			/* not fatal — see load() */
		}
	});
}
