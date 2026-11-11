/**
 * A baked effect has one world size, whatever the display's pixel ratio.
 *
 * The bug this pins: `extract.canvas` returns **device** pixels while a
 * `CanvasSource` defaults to resolution 1, so every generated effect was
 * `devicePixelRatio` times too large on a phone — the grenade became a
 * beach ball, the trap pad a car tire, and the sword's arc a white slab,
 * while the PNG hero sheets (which carry their own resolution) stayed the
 * right size. Nothing in the simulation could see it; only a screenshot at
 * DPR > 1 could.
 */

import { Container, type Renderer } from "pixi.js";
import { describe, expect, it } from "vitest";
import { bakeShared } from "./assets";

const PIXELS_AT_1X = 48;
/** The trap pad's authored rectangle (see `createItemTextures`). */
const TRAP_W = 40;
const TRAP_H = 16;

/** A renderer that bakes `width x height` logical pixels at `resolution`. */
function fakeRenderer(
	resolution: number,
	width = PIXELS_AT_1X,
	height = PIXELS_AT_1X,
): Renderer {
	const canvas = {
		width: width * resolution,
		height: height * resolution,
	} as HTMLCanvasElement;
	return {
		generateTexture: () => ({
			source: { resolution },
			destroy: () => {},
		}),
		extract: { canvas: () => canvas },
	} as unknown as Renderer;
}

describe("bakeShared", () => {
	it("keeps the same logical size at 1x and 3x", () => {
		const standard = bakeShared(fakeRenderer(1), new Container());
		const retina = bakeShared(fakeRenderer(3), new Container());

		expect(standard.width).toBe(PIXELS_AT_1X);
		expect(retina.width).toBe(PIXELS_AT_1X);
	});

	it("keeps the trap pad mine-sized on a 3x display", () => {
		const standard = bakeShared(fakeRenderer(1, TRAP_W, TRAP_H), new Container());
		const retina = bakeShared(fakeRenderer(3, TRAP_W, TRAP_H), new Container());

		expect(retina.width).toBe(standard.width);
		expect(retina.height).toBe(standard.height);
		expect(retina.width).toBe(TRAP_W);
		expect(retina.height).toBe(TRAP_H);
	});
});
