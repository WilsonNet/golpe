/**
 * The cursor→world conversion, in isolation.
 *
 * `scripts/aim-probe.mjs` proves this end to end in a real browser, which is the
 * only place device pixel ratio exists. These tests pin the arithmetic itself so
 * the regression that started it all — dividing by the canvas backing store,
 * which is the logical size times the pixel ratio — cannot come back silently.
 */

import { describe, expect, it } from "vitest";
import { normalisePointer, type Viewport, viewToWorld } from "./Input";

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
