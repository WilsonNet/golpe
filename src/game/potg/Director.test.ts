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
/** A beat as `{t, kind}` or just a `t` (a plain kill), whichever the test wants. */
type BeatArg =
	| number
	| { t: number; kind: PotgClip["beats"][number]["kind"]; victimName: string };

function clip(durationMs = 8000, beats: BeatArg[] = [4000, 5200]): PotgClip {
	const normalised = beats.map((b): PotgClip["beats"][number] =>
		typeof b === "number"
			? { t: b, kind: "kill", victimName: "Foe" }
			: { t: b.t, kind: b.kind, victimName: b.victimName },
	);
	return {
		version: POTG_CLIP_VERSION,
		roomId: "r",
		hz: 20,
		durationMs,
		// The server cuts 4000ms of lead-in before the first scoring moment; the
		// clip factory mirrors that so the pre-roll's budget is measured against
		// the real one.
		actionAtMs: 4000,
		protagonist: { id: "a", name: "A", team: null, bot: false },
		beats: normalised,
		score: 100,
		kills: 1,
		stats: { kills: 1, damage: 0, denies: 0, absorbed: 0 },
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

const still = () => ({ x: 400, y: 300, vx: 0, facing: 1 });

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
			"orbit",
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

	it("orbits the fighter: one arc in both axes", () => {
		// The orbit is the pre-roll's hero shot — a crane that swings in an arc
		// around the subject. It has to actually move, in *both* axes: a circle
		// flattened to a straight line is not a circle, and on a one-screen
		// arena the lateral half of it would clamp away entirely, which is
		// exactly why the vertical leg is there.
		const director = new PotgDirector(clip(), still);
		const shots = run(director).filter((s) => s.phase === "orbit");
		const xs = shots.map((s) => s.focusX - 400);
		const ys = shots.map((s) => s.focusY - 300);
		expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60);
		expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(120);
		// And the lateral swing is a hill, not a ramp: furthest from the subject
		// at the middle of the arc, back beside them at both ends — the camera
		// passes *around* them, not past them.
		const mid = xs[Math.floor(xs.length / 2)] ?? 0;
		expect(mid).toBeGreaterThan(Math.max(xs[0] ?? 0, xs[xs.length - 1] ?? 0));
	});

	it("frames the establish ahead of the fighter's facing", () => {
		// Rule of thirds, applied to "whose play is this": a fighter looking
		// right is framed on the left, looking across the shot. The intro parks
		// on the same framing, so the wipe reveals the composition it will hold.
		const right = new PotgDirector(clip(), still);
		const rightFirst = run(right).find((s) => s.phase === "establish");
		const left = new PotgDirector(clip(), () => ({
			x: 400,
			y: 300,
			vx: 0,
			facing: -1,
		}));
		const leftFirst = run(left).find((s) => s.phase === "establish");
		expect((rightFirst?.focusX ?? 0) - 400).toBeGreaterThan(100);
		expect((leftFirst?.focusX ?? 0) - 400).toBeLessThan(-100);
	});

	it("gives the roll looking-room when the fighter stands still", () => {
		// A dead-centre subject is a fighter on a poster, not a fighter about to
		// act. Standing still, the camera sits slightly toward the facing.
		const director = new PotgDirector(clip(), still);
		const shots = run(director).filter((s) => s.phase === "roll");
		expect((shots[0]?.focusX ?? 0) - 400).toBeGreaterThan(10);
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
			facing: 1,
		}));
		const shots = run(moving).filter((s) => s.phase === "roll");
		const last = shots[shots.length - 1];
		expect((last?.focusX ?? 0) - 400).toBeGreaterThan(20);
	});

	it("coils before a beat so the punch has something to contrast with", () => {
		// Anticipation: the zoom eases *out* over the footage just before a
		// beat, and the punch then lands as a contrast instead of a twitch. A
		// roll that jumped straight into the punch would satisfy every other
		// check and read as a nervous camera.
		const c = clip(8000, [4000]);
		const director = new PotgDirector(c, still);
		const shots = run(director).filter((s) => s.phase === "roll");
		const coiling = shots.filter(
			(s) => s.clipMs < 4000 && 4000 - s.clipMs < 320,
		);
		expect(coiling.length).toBeGreaterThan(0);
		expect(Math.min(...coiling.map((s) => s.zoom))).toBeLessThan(1.1);
	});

	it("punches harder on a beat that mattered more", () => {
		// A deny ends a fighter's ultimate; a plain frag is Tuesday. The punch
		// scales with the beat's kind, so the reel's emphasis matches what the
		// server thought was unusual.
		const deny = new PotgDirector(
			clip(8000, [{ t: 4000, kind: "deny", victimName: "Foe" }]),
			still,
		);
		const denyMax = Math.max(
			...run(deny)
				.filter(
					(s) => s.phase === "roll" && s.clipMs >= 4000 && s.clipMs < 4200,
				)
				.map((s) => s.zoom),
		);
		const plain = new PotgDirector(clip(8000, [4000]), still);
		const plainMax = Math.max(
			...run(plain)
				.filter(
					(s) => s.phase === "roll" && s.clipMs >= 4000 && s.clipMs < 4200,
				)
				.map((s) => s.zoom),
		);
		expect(denyMax).toBeGreaterThan(1.5);
		expect(plainMax).toBeLessThan(denyMax);
	});

	it("ends immediately when skipped", () => {
		const director = new PotgDirector(clip(), still);
		director.step(16);
		director.skip();
		expect(director.step(16).phase).toBe("done");
	});

	it("spends a known amount of wall clock before the play", () => {
		// The pre-roll's length is a budget: `MATCH_OVER_LINGER_MS` has to cover
		// the title card, the camera work, the longest clip the server will cut,
		// the outro *and* a podium. The build-up is ten seconds by design —
		// Overwatch's own ceremony runs seventeen — and a movement that quietly
		// doubled would push the next match's first seconds under a replay of the
		// last one.
		expect(POTG_PREROLL_MS).toBeGreaterThan(9000);
		expect(POTG_PREROLL_MS).toBeLessThan(10500);
	});
});
