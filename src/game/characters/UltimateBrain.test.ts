import { describe, expect, it } from "vitest";
import {
	GRENADE_GRAVITY,
	GRENADE_MAX_RANGE_PX,
	GRENADE_SPEED,
} from "../simulation/Ultimate.js";
import { lobAngle } from "./UltimateBrain.js";

/**
 * The lob solver is the whole aim of the ultimate, and it is pure math — so it
 * gets the deterministic treatment. The property under test: a grenade launched
 * at `lobAngle(dx, dy)` from (0, 0) lands at (dx, dy) under the simulation's
 * own gravity.
 */
function landsAt(angle: number, dx: number, dy: number): boolean {
	const vx = Math.cos(angle) * GRENADE_SPEED;
	const vy = Math.sin(angle) * GRENADE_SPEED;
	// The projectile equation: y(t) = vy·t − ½g·t². Solve for the landing t
	// (the positive root), then check x(t).
	const a = -GRENADE_GRAVITY / 2;
	const b = vy;
	const c = -dy;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return false;
	const t = (-b - Math.sqrt(disc)) / (2 * a);
	if (t < 0) return false;
	return Math.abs(vx * t - dx) < 0.5;
}

describe("lobAngle", () => {
	it("lands on the target at short range, where the throw is nearly flat", () => {
		for (const dx of [60, 120, 250, 400, 500]) {
			const angle = lobAngle(dx, 0);
			expect(landsAt(angle, dx, 0)).toBe(true);
			// A short throw is a flat throw, not a sky hook.
			expect(Math.abs(angle)).toBeLessThan(0.5);
		}
	});

	it("lands on the target at long range, with a steep lob", () => {
		for (const dx of [650, 700]) {
			const angle = lobAngle(dx, 0);
			expect(landsAt(angle, dx, 0)).toBe(true);
		}
	});

	it("still lands when the target holds the high ground", () => {
		// A target 400px away and 80px up — the flight is short, so the low arc
		// is flatter than the ground-level lob, but it must land exactly there.
		expect(landsAt(lobAngle(400, -80), 400, -80)).toBe(true);
		expect(landsAt(lobAngle(250, -120), 250, -120)).toBe(true);
		expect(landsAt(lobAngle(600, -40), 600, -40)).toBe(true);
	});

	it("degrades to the maximum lob past the grenade's maximum range", () => {
		expect(lobAngle(GRENADE_MAX_RANGE_PX + 1, 0)).toBeCloseTo(Math.PI / 4, 3);
	});

	it("throws straight up at zero horizontal distance", () => {
		expect(lobAngle(0, -10)).toBeCloseTo(Math.PI / 2, 3);
	});
});
