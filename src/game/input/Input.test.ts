/**
 * The cursor→world conversion, in isolation.
 *
 * `scripts/aim-probe.mjs` proves this end to end in a real browser, which is the
 * only place device pixel ratio exists. These tests pin the arithmetic itself so
 * the regression that started it all — dividing by the canvas backing store,
 * which is the logical size times the pixel ratio — cannot come back silently.
 */

import { describe, expect, it } from "vitest";
import {
	DASH_DOUBLE_TAP_MS,
	DoubleTapDash,
	normalisePointer,
	type Viewport,
	viewToWorld,
} from "./Input";

const VIEW: Viewport = { width: 800, height: 600, cameraX: 0, cameraY: 0 };

/** A canvas displayed at 1600x1200 CSS pixels, offset inside the page. */
const RECT = { left: 40, top: 20, width: 1600, height: 1200 };

describe("normalisePointer", () => {
	it("maps the canvas corners to 0 and 1", () => {
		expect(normalisePointer(40, 20, RECT)).toEqual({ u: 0, v: 0 });
		expect(normalisePointer(1640, 1220, RECT)).toEqual({ u: 1, v: 1 });
	});

	it("is unaffected by how large the canvas is displayed", () => {
		const half = { left: 40, top: 20, width: 800, height: 600 };
		expect(normalisePointer(440, 320, half)).toEqual(
			normalisePointer(840, 620, RECT),
		);
	});

	it("survives a zero-sized canvas instead of returning NaN", () => {
		expect(
			normalisePointer(10, 10, { left: 0, top: 0, width: 0, height: 0 }),
		).toEqual({ u: 0, v: 0 });
	});
});

describe("viewToWorld", () => {
	it("maps a fraction onto the logical world, not the backing store", () => {
		// The whole bug: a 2x display makes the canvas backing store 1600x1200,
		// and dividing by it put this point at 800,600 — off the right edge of an
		// 800x600 world, so the fighter believed the cursor was always to its right.
		expect(viewToWorld(0.5, 0.5, VIEW)).toEqual({ x: 400, y: 300 });
	});

	it("adds the camera, because the pointer is a screen fact", () => {
		const scrolled: Viewport = { ...VIEW, cameraX: 250, cameraY: -80 };
		expect(viewToWorld(0.5, 0.5, scrolled)).toEqual({ x: 650, y: 220 });
	});

	it("agrees with the aim angle a fighter at world centre would compute", () => {
		const p = viewToWorld(1, 0.5, VIEW);
		expect(Math.atan2(p.y - 300, p.x - 400)).toBeCloseTo(0, 10);
	});
});

/**
 * The dash gesture, against a fake clock.
 *
 * The window is a *feel* constant — it was widened from 200ms because dashing at
 * the peak of a jump means releasing the direction you jumped with and landing
 * both taps before the apex passes, which 200ms made genuinely hard. A feel
 * constant nothing pins gets retuned by accident, so it is pinned here.
 */
describe("DoubleTapDash", () => {
	it("does not dash on a single tap", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		expect(g.consume()).toBe(0);
	});

	it("dashes on two taps inside the window", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		g.press(1, DASH_DOUBLE_TAP_MS - 1);
		expect(g.consume()).toBe(1);
	});

	it("reports the direction of the key that was tapped", () => {
		const g = new DoubleTapDash();
		g.press(-1, 0);
		g.press(-1, 50);
		expect(g.consume()).toBe(-1);
	});

	it("ignores two taps that straddle the window", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		g.press(1, DASH_DOUBLE_TAP_MS);
		expect(g.consume()).toBe(0);
	});

	/**
	 * The point of the change. At 200ms this pair was a dash only if the player
	 * beat a window they kept missing mid-jump; the tuning exists so a comfortable
	 * double-tap counts.
	 */
	it("accepts a comfortable, unhurried double-tap", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		g.press(1, 260);
		expect(g.consume()).toBe(1);
	});

	/**
	 * The ceiling. Deliberate stepping — tapping a direction to move a little —
	 * comes at roughly this cadence, and an unwanted dash across the arena is a far
	 * worse failure than a missed one.
	 */
	it("still reads deliberate stepping as steps, not a dash", () => {
		const g = new DoubleTapDash();
		for (const t of [0, 350, 700, 1050]) g.press(1, t);
		expect(g.consume()).toBe(0);
	});

	it("does not chain a dash off every subsequent tap", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		g.press(1, 100);
		expect(g.consume()).toBe(1);
		// The third tap starts a fresh gesture rather than completing another pair.
		g.press(1, 200);
		expect(g.consume()).toBe(0);
	});

	it("keeps the two directions apart", () => {
		const g = new DoubleTapDash();
		g.press(-1, 0);
		g.press(1, 50);
		expect(g.consume()).toBe(0);
	});

	it("hands the gesture over exactly once", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		g.press(1, 100);
		expect(g.consume()).toBe(1);
		expect(g.consume()).toBe(0);
	});

	/** A dash held over a window switch would fire whenever the player came back. */
	it("forgets a landed gesture on reset", () => {
		const g = new DoubleTapDash();
		g.press(1, 0);
		g.press(1, 100);
		g.reset();
		expect(g.consume()).toBe(0);
	});
});
