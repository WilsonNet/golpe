import { describe, expect, it } from "vitest";
import {
	MASSIVE_CHARGE_MS,
	MOVES,
	moveDuration,
	SLASH_CANCELLED_MS,
} from "../simulation/Physics.js";
import {
	JUMP_HOLD_MS,
	MASSIVE_HOLD_MS,
	normaliseScript,
	PRESS_MS,
	scriptFor,
} from "./scripts.js";
import { DEFAULT_TRAINING_TIMING, type DummyBehaviour } from "./types.js";

const TIMING = DEFAULT_TRAINING_TIMING;

/** Behaviours that must be beat lists, and those that must be reactive. */
const SCRIPTED: DummyBehaviour[] = [
	"blockAll",
	"butterfly",
	"slash",
	"uppercut",
	"massive",
	"jump",
];
const REACTIVE: DummyBehaviour[] = [
	"idle",
	"walk",
	"blockAfterFirstHit",
	"counterAttack",
	"mirror",
	"record",
	"playback",
];

describe("scriptFor", () => {
	it("compiles every canned rhythm to a looping beat list", () => {
		for (const behaviour of SCRIPTED) {
			const script = scriptFor(behaviour, TIMING);
			expect(script, behaviour).not.toBeNull();
			expect(script?.loop, behaviour).toBe(true);
			expect(script?.beats.length, behaviour).toBeGreaterThan(0);
		}
	});

	it("has no rhythm for the behaviours that must see the game", () => {
		for (const behaviour of REACTIVE) {
			expect(scriptFor(behaviour, TIMING), behaviour).toBeNull();
		}
	});

	/**
	 * The rule the whole format rests on: a beat holds buttons, so a rhythm that
	 * never releases can only ever produce one press edge.
	 */
	it("releases the attack button between slashes", () => {
		const beats = scriptFor("slash", TIMING)?.beats ?? [];
		expect(beats.some((b) => b.hold?.attack)).toBe(true);
		expect(beats.some((b) => !b.hold?.attack)).toBe(true);
	});

	it("holds a Massive past the charge threshold, then releases it", () => {
		const beats = scriptFor("massive", TIMING)?.beats ?? [];
		const charging = beats[0];
		expect(charging?.hold?.attack).toBe(true);
		expect(charging?.ms).toBeGreaterThan(MASSIVE_CHARGE_MS);
		expect(MASSIVE_HOLD_MS).toBeGreaterThan(MASSIVE_CHARGE_MS);
		expect(beats[1]?.hold?.attack).toBeFalsy();
	});

	/** Jump height is analogue: a single-frame press can only ever hop. */
	it("holds the jump button long enough for a full-height jump", () => {
		const beats = scriptFor("jump", TIMING)?.beats ?? [];
		expect(beats[0]?.hold?.jump).toBe(true);
		expect(beats[0]?.ms).toBe(JUMP_HOLD_MS);
		expect(beats[1]?.hold?.jump).toBeFalsy();
	});

	it("keeps the guard held across the blockAll loop boundary", () => {
		const beats = scriptFor("blockAll", TIMING)?.beats ?? [];
		expect(beats.every((b) => b.hold?.block)).toBe(true);
	});

	/**
	 * The butterfly is a slash cancelled into a block — and *when* the block
	 * lands decides whether it is a butterfly at all. Too early and the cancel is
	 * illegal (startup) or throws the hit away (active frames).
	 */
	it("presses the butterfly's block exactly when the hitbox closes", () => {
		const beats = scriptFor("butterfly", TIMING)?.beats ?? [];
		expect(beats[0]?.hold?.attack).toBe(true);
		expect(beats[1]?.hold).toBeUndefined();
		expect(beats[2]?.hold?.block).toBe(true);
		expect(beats[3]?.hold).toBeUndefined();

		const blockAt = (beats[0]?.ms ?? 0) + (beats[1]?.ms ?? 0);
		expect(blockAt).toBe(SLASH_CANCELLED_MS);
		expect(blockAt).toBeGreaterThanOrEqual(
			MOVES.slash.startupMs + MOVES.slash.activeMs,
		);
		expect(blockAt).toBeLessThan(moveDuration("slash"));
	});

	it("uses a custom script only for the script behaviour", () => {
		const custom = { beats: [{ ms: 10, hold: { block: true } }] };
		expect(scriptFor("script", TIMING, custom)?.beats).toHaveLength(1);
		expect(scriptFor("idle", TIMING, custom)).toBeNull();
		expect(scriptFor("script", TIMING)).toBeNull();
	});

	it("presses for long enough to survive a coarse server tick", () => {
		expect(PRESS_MS).toBeGreaterThan(1000 / 60);
	});
});

describe("normaliseScript", () => {
	/** A zero-length beat is entered and left in the same tick, forever. */
	it("drops beats that cannot advance", () => {
		const script = normaliseScript({
			beats: [
				{ ms: 0, hold: { attack: true } },
				{ ms: Number.NaN },
				{ ms: -5 },
				{ ms: 20 },
			],
		});
		expect(script.beats).toHaveLength(1);
		expect(script.beats[0]?.ms).toBe(20);
	});

	it("loops by default", () => {
		expect(normaliseScript({ beats: [{ ms: 5 }] }).loop).toBe(true);
		expect(normaliseScript({ beats: [{ ms: 5 }], loop: false }).loop).toBe(
			false,
		);
	});
});
