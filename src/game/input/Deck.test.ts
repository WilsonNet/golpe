/**
 * The deck's pure geometry: the move rocker, the jump cap and the aim drag.
 *
 * These are the numbers a thumb feels. They live outside the React component so
 * they can be pinned without a DOM — the probe proves the wiring, these prove
 * the edges a thumb keeps landing on.
 */

import { describe, expect, it } from "vitest";
import {
	DRAG_DEADZONE,
	dragVector,
	inJumpBand,
	MOVE_PRESS_PX,
	MOVE_RELEASE_PX,
	moveDirection,
} from "./Deck";

describe("moveDirection", () => {
	it("walks from the first 14 pixels of thumb travel", () => {
		expect(moveDirection(0)).toBe(0);
		expect(moveDirection(MOVE_PRESS_PX - 0.1)).toBe(0);
		expect(moveDirection(MOVE_PRESS_PX)).toBe(1);
		expect(moveDirection(-MOVE_PRESS_PX)).toBe(-1);
	});

	it("keeps a direction until the thumb is well inside the release line", () => {
		// Hysteresis: a thumb parked exactly on the press line must not stutter
		// left/right at frame rate, which would read as a broken pad.
		expect(moveDirection(MOVE_RELEASE_PX + 1, 1)).toBe(1);
		expect(moveDirection(MOVE_RELEASE_PX - 0.1, 1)).toBe(0);
		expect(moveDirection(-MOVE_RELEASE_PX - 1, -1)).toBe(-1);
		expect(moveDirection(-MOVE_RELEASE_PX + 0.1, -1)).toBe(0);
	});

	it("does not let the release band flip a held direction", () => {
		// A thumb held right crossing the centre must release, not jump straight
		// to left on the first pixel past the line.
		expect(moveDirection(-MOVE_RELEASE_PX - 1, 1)).toBe(0);
		expect(moveDirection(-MOVE_PRESS_PX, 1)).toBe(-1);
	});
});

describe("inJumpBand", () => {
	it("reads the painted cap, whatever the pad's height", () => {
		// A 180px pad: the cap's bottom is 90 - 44 = 46px above the centre.
		expect(inJumpBand(-47, 180)).toBe(true);
		expect(inJumpBand(-46, 180)).toBe(true);
		expect(inJumpBand(-45, 180)).toBe(false);
		expect(inJumpBand(40, 180)).toBe(false);
	});

	it("scales with the pad, so the cap and the trigger cannot drift apart", () => {
		// A 204px pad in portrait: the cap bottom is 102 - 44 = 58px above centre.
		expect(inJumpBand(-58, 204)).toBe(true);
		expect(inJumpBand(-57, 204)).toBe(false);
	});
});

describe("dragVector", () => {
	it("turns an offset from a button centre into a unit aim vector", () => {
		const v = dragVector(15, 0, 30);
		expect(v.x).toBeCloseTo(0.5);
		expect(v.y).toBeCloseTo(0);
		expect(v.magnitude).toBeCloseTo(0.5);
	});

	it("clamps a drag past the rim without losing its angle", () => {
		const v = dragVector(30, -30, 30);
		expect(v.x).toBeCloseTo(Math.SQRT1_2);
		expect(v.y).toBeCloseTo(-Math.SQRT1_2);
		expect(v.magnitude).toBe(1);
	});

	it("reports a tap at the centre as no aim", () => {
		const v = dragVector(0, 0, 30);
		expect(v.magnitude).toBe(0);
		expect(v.magnitude).toBeLessThan(DRAG_DEADZONE);
	});
});
