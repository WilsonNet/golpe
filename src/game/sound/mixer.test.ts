import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	AUDIO_CHANNELS,
	AudioMixer,
	isDefaultAudio,
	sanitiseAudio,
} from "./mixer";

/**
 * Whatever was in storage, `sanitiseAudio` must produce preferences that are
 * *usable*: every volume finite and clamped to [0,1], every muted flag a real
 * boolean. A NaN or out-of-range volume would either throw in the Web Audio
 * graph or pin a channel silently wrong.
 */
test.prop([fc.anything()])(
	"sanitiseAudio always yields finite, in-range volumes and boolean mutes",
	(raw) => {
		const prefs = sanitiseAudio(raw);
		for (const ch of AUDIO_CHANNELS) {
			expect(Number.isFinite(prefs.volumes[ch])).toBe(true);
			expect(prefs.volumes[ch]).toBeGreaterThanOrEqual(0);
			expect(prefs.volumes[ch]).toBeLessThanOrEqual(1);
			expect(typeof prefs.muted[ch]).toBe("boolean");
		}
	},
);

describe("sanitiseAudio", () => {
	it("keeps good values and clamps out-of-range ones", () => {
		const prefs = sanitiseAudio({
			volumes: { master: 2, music: -1, sfx: 0.3 },
			muted: { master: true, music: false, sfx: false },
		});
		expect(prefs.volumes.master).toBe(1);
		expect(prefs.volumes.music).toBe(0);
		expect(prefs.volumes.sfx).toBe(0.3);
		expect(prefs.muted.master).toBe(true);
		expect(prefs.muted.music).toBe(false);
	});

	it("falls back to defaults for junk", () => {
		expect(sanitiseAudio(null).volumes.master).toBe(1);
		expect(sanitiseAudio("garbage").volumes.sfx).toBe(0.9);
		const missing = sanitiseAudio({ volumes: {} });
		expect(missing.volumes.music).toBe(0.5);
		expect(missing.muted.sfx).toBe(false);
	});
});

describe("AudioMixer", () => {
	it("notifies subscribers and remembers", () => {
		const mixer = new AudioMixer();
		let seen = 0;
		mixer.subscribe(() => (seen += 1));
		mixer.setVolume("sfx", 0.25);
		expect(seen).toBe(1);
		expect(mixer.snapshot().volumes.sfx).toBe(0.25);
		mixer.setMuted("music", true);
		expect(seen).toBe(2);
		expect(mixer.snapshot().muted.music).toBe(true);
	});

	it("clamps writes and refuses NaN", () => {
		const mixer = new AudioMixer();
		mixer.setVolume("master", 7);
		expect(mixer.snapshot().volumes.master).toBe(1);
		mixer.setVolume("master", Number.NaN);
		expect(mixer.snapshot().volumes.master).toBe(1);
	});

	it("reset returns to the defaults", () => {
		const mixer = new AudioMixer();
		mixer.setVolume("music", 0.1);
		mixer.setMuted("sfx", true);
		mixer.reset();
		const prefs = mixer.snapshot();
		expect(isDefaultAudio(prefs)).toBe(true);
		for (const ch of AUDIO_CHANNELS) {
			expect(prefs.muted[ch]).toBe(false);
		}
	});

	it("isDefaultAudio sees drift", () => {
		const mixer = new AudioMixer();
		expect(isDefaultAudio(mixer.snapshot())).toBe(true);
		mixer.setVolume("music", 0.4);
		expect(isDefaultAudio(mixer.snapshot())).toBe(false);
	});
});
