/**
 * The projector's interpolation.
 *
 * A replay is drawn at whatever the display runs at over footage recorded at
 * the server's 20Hz, so everything that moves has to be placed *between* the
 * two bracketing frames rather than snapped to the earlier one. Snapping was
 * the first version's bug for bullets and grenades: fighters glided while
 * projectiles stepped forward 40px at a time, which is precisely the "does not
 * look like the match" a replay is not allowed to have.
 *
 * The director owns the footage cursor and the camera edit, so these tests
 * drive the real `PotgReplay` and simply step it like the game loop does.
 */

import { describe, expect, it } from "vitest";
import { packState } from "../online/wire";
import { createPlayerState } from "../simulation/Physics";
import { PotgReplay, type ReplaySample } from "./Replay";
import { POTG_CLIP_VERSION, type PotgClip, type PotgFrame } from "./types";

const STEP_MS = 1000 / 60;

function player(x: number, y: number): PotgFrame["p"][number] {
	return { c: 0, s: packState(createPlayerState(x, y)), hp: 100, a: 1 };
}

function frame(
	t: number,
	body: PotgFrame["p"][number],
	bullets: number[],
	grenades: number[] = [],
): PotgFrame {
	return { t, p: [body], b: bullets, g: grenades, h: null };
}

function clip(frames: PotgFrame[]): PotgClip {
	const member = { id: "a", name: "A", team: null, bot: false };
	return {
		version: POTG_CLIP_VERSION,
		roomId: "r",
		hz: 20,
		durationMs: frames[frames.length - 1]?.t ?? 0,
		actionAtMs: 0,
		protagonist: member,
		beats: [],
		score: 100,
		kills: 1,
		stats: { kills: 1, damage: 0, denies: 0, absorbed: 0 },
		cast: [member],
		frames,
		screens: 1,
	};
}

/** Step the projector until the footage cursor passes `untilMs`. */
function run(replay: PotgReplay, untilMs: number): ReplaySample[] {
	const samples: ReplaySample[] = [];
	for (let i = 0; i < 2000; i++) {
		const sample = replay.step(STEP_MS);
		if (!sample) break;
		samples.push(sample);
		if (sample.shot.clipMs >= untilMs) break;
	}
	return samples;
}

describe("PotgReplay", () => {
	it("interpolates a fighter between the bracketing frames", () => {
		const replay = new PotgReplay(
			clip([
				frame(0, player(100, 300), []),
				frame(50, player(140, 300), []),
				frame(100, player(180, 300), []),
			]),
		);
		const xs = run(replay, 100).map((s) => s.fighters[0]?.state.x ?? 0);
		// At least one frame was drawn strictly between two recordings, and the
		// drawn path never steps backwards.
		expect(xs.some((x) => x > 101 && x < 139)).toBe(true);
		for (let i = 1; i < xs.length; i++) {
			expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] ?? 0);
		}
	});

	it("interpolates a bullet between the frames that carry its id", () => {
		const replay = new PotgReplay(
			clip([
				frame(0, player(100, 300), [7, 100, 200]),
				frame(50, player(100, 300), [7, 140, 200]),
				frame(100, player(100, 300), [7, 180, 200]),
			]),
		);
		const xs = run(replay, 100).map((s) => s.bullets[0]?.x ?? 0);
		expect(xs.some((x) => x > 101 && x < 139)).toBe(true);
		for (let i = 1; i < xs.length; i++) {
			expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] ?? 0);
		}
	});

	it("never chases a bullet that only the later frame has", () => {
		const replay = new PotgReplay(
			clip([
				frame(0, player(100, 300), [7, 100, 200]),
				frame(50, player(100, 300), [8, 400, 200]),
			]),
		);
		// Bullet 7 is gone and bullet 8 is somebody else's: while the earlier
		// frame is still the bracket's left edge, the drawn position must stay
		// where it was recorded, not glide toward an unrelated bullet 300px away.
		const xs = run(replay, 40).map((s) => s.bullets[0]?.x ?? 0);
		expect(Math.max(...xs)).toBe(100);
	});

	it("rejects a grenade slot that jumped because a grenade exploded", () => {
		const replay = new PotgReplay(
			clip([
				// Two grenades in the air; the first explodes between the frames, so
				// the second slides into slot 0 in the later recording.
				frame(0, player(100, 300), [], [100, 100, 500, 100]),
				frame(50, player(100, 300), [], [510, 100]),
			]),
		);
		const mid = run(replay, 60).find((s) => s.shot.clipMs > 5);
		// A slot-keyed lerp with no distance guard would draw it halfway to 510
		// (~305px); a replay that slides a grenade across the arena is worse than
		// one that steps it, so the jump is refused.
		expect(mid?.grenades[0]?.x ?? 0).toBeLessThan(130);
	});
});
