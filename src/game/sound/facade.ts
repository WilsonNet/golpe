/**
 * The sound facade: the one import the rest of the game needs.
 *
 * Everything under `src/game/sound/` is presentation, and everything it knows
 * how to say is in one place:
 *
 * - `sound.play(name, {gain, pan, pitch})` — a one-shot from the SFX bank
 *   (`sfx.ts`). `Match` computes the attenuation and the pan from the *server
 *   event's* position, so a swing two screens away is a faint, displaced
 *   whoosh and your own swing is front and centre.
 * - `sound.setMusic("menu" | "fight")` — the loop the page promotes. The root
 *   menu plays the menu groove; a match plays the fight groove. The engine
 *   crossfades between them.
 * - `sound.duck(ms)` — drop the music for the ultimate's freeze or a fanfare
 *   and bring it back.
 * - `sound.mixer` — the persisted volume/mute store the mixer UI writes.
 *
 * The delegated `installUiSounds` is how every `button` in the game clicks and
 * hums without the components having to remember anything: pointerdown on a
 * button = click, pointermove over a button = hover. The canvas is never a
 * button, so a swing's trigger doesn't click the menu — and the API surface
 * stays tiny because buttons are the only affordance in this game.
 */

import { type AudioKitState, audioKit, type MusicTrack } from "./engine";
import { type AudioChannel, audioMixer } from "./mixer";
import { playSfx, type SfxOpts } from "./sfx";

export const sound = {
	mixer: audioMixer,
	play(name: string, opts?: SfxOpts): void {
		playSfx(name, opts);
	},
	setMusic(track: MusicTrack): void {
		audioKit.setMusic(track);
	},
	duck(holdMs: number): void {
		audioKit.duck(holdMs);
	},
	state(): AudioKitState {
		return audioKit.state();
	},
};

let uiSoundsInstalled = false;

/**
 * The menu's audio: every button click and hover, wired once.
 *
 * Delegated on `document` so an individual component never has to remember to
 * play a sound on every one of its buttons — the thing the SoundMixer probe is
 * checking is just this listener firing. Capture phase, because a button's own
 * handler may otherwise swallow the event before it gets here.
 */
export function installUiSounds(): void {
	if (uiSoundsInstalled || typeof document === "undefined") return;
	uiSoundsInstalled = true;

	document.addEventListener(
		"pointerdown",
		(e) => {
			const target = e.target;
			if (!(target instanceof Element)) return;
			if (!target.closest("button")) return;
			playSfx("ui-click");
		},
		{ capture: true },
	);

	let lastHoverMs = 0;
	document.addEventListener(
		"pointermove",
		(e) => {
			const target = e.target;
			if (!(target instanceof Element)) return;
			if (!target.closest("button")) return;
			const now = performance.now();
			if (now - lastHoverMs < 80) return;
			lastHoverMs = now;
			playSfx("ui-hover");
		},
		{ passive: true },
	);
}

if (typeof window !== "undefined") {
	window.__audioState = () => audioKit.state();
	window.__audioPlay = (name: string) => playSfx(name);
	window.__audioSetVolume = (channel: AudioChannel, value: number) =>
		audioMixer.setVolume(channel, value);
}
