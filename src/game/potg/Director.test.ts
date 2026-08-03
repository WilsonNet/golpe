import { describe, expect, it } from "vitest";
import { POTG_CARD_MS } from "../../ui/potgStyles.js";
import {
	POTG_INTRO_MS,
	POTG_PREROLL_MS,
	POTG_WIPE_MS,
	PotgDirector,
	type PotgShot,
} from "./Director.js";
import { POTG_CLIP_VERSION, type PotgClip } from "./types.js";

/**
 * A clip with no frames in it.
 *
 * The director never reads frames — it is handed a `subjectAt` callback and
 * asks that where the protagonist was. Which is the point of testing it this
 * way: the whole camera edit is exercised without a renderer, a canvas or a
 * recording.
 */
function clip(durationMs = 8000, beats: number[] = [4000, 5200]): PotgClip {
	return {
		version: POTG_CLIP_VERSION,
		roomId: "r",
		hz: 20,
		durationMs,
		actionAtMs: 2500,
		protagonist: { id: "a", name: "A", team: null, bot: false },
		beats: beats.map((t) => ({ t, kind: "kill" as const, victimName: "Foe" })),
		score: 100,
		kills: 1,
		cast: [{ id: "a", name: "A", team: null, bot: false }],
		frames: [],
		screens: 1,
	};
}

/** Run the whole sequence at 60fps, collecting every shot. */
function run(director: PotgDirector, maxMs = 90_000): PotgShot[] {
	const shots: PotgShot[] = [];
	const step = 1000 / 60;
	for (let t = 0; t < maxMs; t += step) {
		if (director.done) break;
		shots.push(director.step(step));
	}
	return shots;
}

const still = () => ({ x: 400, y: 300, vx: 0 });

describe("PotgDirector", () => {
	it("runs the movements in order and finishes", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		// `done` is the terminator the projector watches for, not a movement: it
		// carries no framing and `Replay` stops on it rather than drawing it.
		const phases = [...new Set(shots.map((s) => s.phase))].filter(
			(p) => p !== "done",
		);
		expect(phases).toEqual([
			"intro",
			"establish",
			"push",
			"whip",
			"roll",
			"outro",
		]);
		expect(director.done).toBe(true);
	});

	it("hides the arena behind the title card, then opens it", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		const intro = shots.filter((s) => s.phase === "intro");
		// Fully covered for most of the intro. This is the difference between a
		// title card and a caption: something has to own the screen before it can
		// hand it over, and the first version faded a title in over a replay that
		// was already playing.
		expect(intro.filter((s) => s.curtain > 0.99).length).toBeGreaterThan(
			intro.length / 2,
		);
		expect(intro[intro.length - 1]?.curtain ?? 1).toBeLessThan(0.2);
		// And nothing is covered once the ceremony is actually showing anything.
		expect(
			shots.filter((s) => s.phase !== "intro").every((s) => s.curtain === 0),
		).toBe(true);
	});

	it("holds the footage still while the card is up", () => {
		// The lead-in is a 2.5s budget; spending any of it behind an opaque card
		// is spending it on nobody.
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		const intro = shots.filter((s) => s.phase === "intro");
		expect(intro.every((s) => s.rate === 0)).toBe(true);
		expect(intro.every((s) => s.clipMs === 0)).toBe(true);
	});

	it("gives the card time to finish arriving before the curtain opens", () => {
		// The stylesheet animates the wordmark on fixed CSS keyframes because the
		// intro is the one movement with a fixed length. A card still in flight
		// when the reveal starts is the one way this looks broken without anything
		// throwing, so the budget is asserted rather than eyeballed.
		expect(POTG_CARD_MS).toBeLessThan(POTG_INTRO_MS - POTG_WIPE_MS);
	});

	it("pushes in: the establish is wide and the push is tight", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		const widest = Math.min(
			...shots.filter((s) => s.phase === "establish").map((s) => s.zoom),
		);
		const tightest = Math.max(
			...shots.filter((s) => s.phase === "push").map((s) => s.zoom),
		);
		expect(widest).toBeLessThan(1);
		// The push is the sentence "it was *this* one" — if it does not end
		// meaningfully closer than the establishing shot, the pre-roll has silently
		// become a static wide shot and nothing else in the game would notice.
		expect(tightest).toBeGreaterThan(widest * 1.8);
	});

	it("swings the whip pan off the subject and back onto it", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director).filter((s) => s.phase === "whip");
		const offsets = shots.map((s) => Math.abs(s.focusX - 400));
		expect(Math.max(...offsets)).toBeGreaterThan(40);
		// And it lands back on them: a pan that ended off-subject would hand the
		// roll a camera pointing at empty arena.
		expect(offsets[offsets.length - 1] ?? 0).toBeLessThan(
			Math.max(...offsets) / 2,
		);
	});

	it("keeps the pre-roll's footage crawling, then runs it at speed", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		const pre = shots.filter((s) => s.phase !== "roll" && s.phase !== "outro");
		expect(Math.max(...pre.map((s) => s.rate))).toBeLessThan(1);
		expect(Math.max(...shots.map((s) => s.rate))).toBe(1);
	});

	it("reaches the play with footage left to show", () => {
		// The pre-roll eats into the lead-in, and it must not eat all of it — a
		// cinematic that arrives after the kill it is announcing is a cut, not a
		// highlight.
		const c = clip();
		const director = new PotgDirector(c, still);
		const shots = run(director);
		const firstRoll = shots.find((s) => s.phase === "roll");
		expect(firstRoll?.clipMs ?? 0).toBeLessThan(c.actionAtMs);
	});

	it("drops into slow motion at a scoring beat", () => {
		const c = clip(8000, [4000]);
		const director = new PotgDirector(c, still);
		const shots = run(director).filter((s) => s.phase === "roll");
		const atBeat = shots.filter((s) => Math.abs(s.clipMs - 4000) < 200);
		expect(atBeat.length).toBeGreaterThan(0);
		expect(Math.min(...atBeat.map((s) => s.rate))).toBeLessThan(0.6);
	});

	it("shakes exactly once per beat", () => {
		const c = clip(8000, [3500, 5000, 6200]);
		const director = new PotgDirector(c, still);
		const shakes = run(director).filter((s) => s.shake > 0);
		// Once each, even though slow motion holds the beat inside its own window
		// for a dozen frames — a re-triggered shake is a rattle, not an impact.
		expect(shakes).toHaveLength(3);
	});

	it("frames the whole ceremony and unframes it at the end", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		expect(shots[0]?.letterbox ?? 1).toBeLessThan(0.5);
		expect(Math.max(...shots.map((s) => s.letterbox))).toBeGreaterThan(0.95);
		expect(shots[shots.length - 1]?.letterbox ?? 1).toBeLessThan(0.5);
	});

	it("shows the title first and the name card after it", () => {
		const director = new PotgDirector(clip(), still);
		const shots = run(director);
		const titlePeak = shots.findIndex((s) => s.title > 0.9);
		const cardPeak = shots.findIndex((s) => s.card > 0.9);
		expect(titlePeak).toBeGreaterThanOrEqual(0);
		expect(cardPeak).toBeGreaterThan(titlePeak);
	});

	it("holds the last frame through the outro", () => {
		const c = clip();
		const director = new PotgDirector(c, still);
		const shots = run(director).filter((s) => s.phase === "outro");
		expect(shots.every((s) => s.rate === 0)).toBe(true);
		expect(shots.every((s) => s.clipMs === c.durationMs)).toBe(true);
	});

	it("leads a moving fighter rather than centring them", () => {
		const moving = new PotgDirector(clip(), () => ({
			x: 400,
			y: 300,
			vx: 400,
		}));
		const shots = run(moving).filter((s) => s.phase === "roll");
		const last = shots[shots.length - 1];
		expect((last?.focusX ?? 0) - 400).toBeGreaterThan(20);
	});

	it("ends immediately when skipped", () => {
		const director = new PotgDirector(clip(), still);
		director.step(16);
		director.skip();
		expect(director.step(16).phase).toBe("done");
	});

	it("spends a known amount of wall clock before the play", () => {
		// The pre-roll's length is a budget: `MATCH_OVER_LINGER_MS` has to cover the
		// title card, the camera work, the longest clip the server will cut, the
		// outro *and* a podium. A movement that quietly doubled would push the next
		// match's first seconds under a replay of the last one.
		expect(POTG_PREROLL_MS).toBeGreaterThan(POTG_INTRO_MS);
		expect(POTG_PREROLL_MS).toBeLessThan(6500);
	});
});
