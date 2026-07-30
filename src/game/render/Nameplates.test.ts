/**
 * The health colour ramp.
 *
 * A bar that is the wrong colour is worse than no bar: it is the one thing a
 * player reads without looking, and reading it wrong gets them killed.
 */

import { describe, expect, it } from "vitest";
import { healthColour } from "./Nameplates";

const channels = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

describe("healthColour", () => {
	it("is green at full health and red at empty", () => {
		const [, fullG] = channels(healthColour(1));
		const [emptyR, emptyG] = channels(healthColour(0));
		expect(fullG).toBeGreaterThan(180);
		expect(emptyR).toBeGreaterThan(180);
		expect(emptyG).toBeLessThan(120);
	});

	/**
	 * Two segments through yellow rather than one green→red blend, which passes
	 * through a muddy brown at exactly the half-health moment that matters most.
	 */
	it("is bright at half health, not muddy", () => {
		const [r, g, b] = channels(healthColour(0.5));
		expect(r).toBeGreaterThan(200);
		expect(g).toBeGreaterThan(180);
		expect(b).toBeLessThan(100);
	});

	it("darkens toward red as health falls", () => {
		const greens = [1, 0.75, 0.5, 0.25, 0].map(
			(f) => channels(healthColour(f))[1] ?? 0,
		);
		for (let i = 1; i < greens.length; i++) {
			expect(greens[i]).toBeLessThanOrEqual(greens[i - 1] ?? 0);
		}
	});

	it("clamps rather than producing a colour outside the ramp", () => {
		expect(healthColour(-3)).toBe(healthColour(0));
		expect(healthColour(9)).toBe(healthColour(1));
	});
});
