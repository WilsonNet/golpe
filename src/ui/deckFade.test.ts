import { describe, expect, it } from "vitest";
import {
	fadedHandFor,
	HAND_FADE_Y,
	HAND_LEFT_X,
	HAND_RIGHT_X,
} from "./deckFade";

describe("fadedHandFor", () => {
	it("fades the hand over a fighter in the bottom corners", () => {
		expect(fadedHandFor(0.1, 0.8)).toBe("left");
		expect(fadedHandFor(0.9, 0.8)).toBe("right");
	});

	it("leaves the middle of the arena alone", () => {
		expect(fadedHandFor(0.5, 0.8)).toBeNull();
	});

	it("does not fade a control the fighter is above", () => {
		expect(fadedHandFor(0.1, HAND_FADE_Y - 0.01)).toBeNull();
		expect(fadedHandFor(0.9, HAND_FADE_Y - 0.01)).toBeNull();
	});

	it("uses the corner thresholds exactly", () => {
		expect(fadedHandFor(HAND_LEFT_X - 0.01, 0.9)).toBe("left");
		expect(fadedHandFor(HAND_LEFT_X, 0.9)).toBeNull();
		expect(fadedHandFor(HAND_RIGHT_X + 0.01, 0.9)).toBe("right");
		expect(fadedHandFor(HAND_RIGHT_X, 0.9)).toBeNull();
	});
});
