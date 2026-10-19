import { describe, expect, it } from "vitest";
import { measureReadability, type PixelBuffer } from "./Readability";

const W = 64;
const H = 64;

function buffer(fill: [number, number, number]): PixelBuffer {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		data[i * 4] = fill[0];
		data[i * 4 + 1] = fill[1];
		data[i * 4 + 2] = fill[2];
		data[i * 4 + 3] = 255;
	}
	return { data, width: W, height: H };
}

/** Paint a rect into a copy of a buffer. */
function withRect(
	base: PixelBuffer,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	fill: [number, number, number],
): PixelBuffer {
	const data = new Uint8ClampedArray(base.data);
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const i = (y * W + x) * 4;
			data[i] = fill[0];
			data[i + 1] = fill[1];
			data[i + 2] = fill[2];
			data[i + 3] = 255;
		}
	}
	return { data, width: W, height: H };
}

describe("measureReadability", () => {
	it("finds a body, its box, and its silhouette", () => {
		const bg = buffer([90, 100, 110]);
		const fg = withRect(bg, 22, 18, 42, 50, [240, 230, 200]);
		const m = measureReadability(fg, bg);
		expect(m).not.toBeNull();
		expect(m?.pixels).toBe(20 * 32);
		expect(m?.bounds).toEqual({ x: 22, y: 18, w: 20, h: 32 });
		expect(m?.contrastRatio).toBeGreaterThan(4.5);
		expect(m?.valueContrast).toBeGreaterThan(30);
		expect(m?.silhouetteCoverage).toBe(1);
	});

	it("reports a low-contrast body as hard to separate", () => {
		const bg = buffer([100, 100, 100]);
		const fg = withRect(bg, 22, 18, 42, 50, [116, 116, 116]);
		const m = measureReadability(fg, bg);
		expect(m).not.toBeNull();
		expect(m?.contrastRatio).toBeLessThan(1.6);
		expect(m?.valueContrast).toBeLessThan(8);
		expect(m?.silhouetteCoverage).toBe(0);
	});

	it("measures an outline as the separation that saves a low-contrast body", () => {
		const bg = buffer([100, 100, 100]);
		const body = withRect(bg, 22, 18, 42, 50, [116, 116, 116]);
		const outlined = withRect(body, 22, 18, 42, 50, [116, 116, 116]);
		// A one-pixel dark rim around the body.
		for (let y = 18; y < 50; y++) {
			for (let x = 22; x < 42; x++) {
				if (x > 22 && x < 41 && y > 18 && y < 49) continue;
				const i = (y * W + x) * 4;
				outlined.data[i] = 20;
				outlined.data[i + 1] = 20;
				outlined.data[i + 2] = 30;
			}
		}
		const plain = measureReadability(body, bg);
		const rimmed = measureReadability(outlined, bg);
		expect(plain).not.toBeNull();
		expect(rimmed).not.toBeNull();
		expect(rimmed?.silhouetteCoverage ?? 0).toBeGreaterThan(
			plain?.silhouetteCoverage ?? 0,
		);
		expect(rimmed?.silhouetteContrast ?? 0).toBeGreaterThan(20);
	});

	it("refuses a whole-frame difference as a body measurement", () => {
		const bg = buffer([60, 60, 60]);
		const fg = buffer([180, 180, 180]);
		expect(measureReadability(fg, bg)).toBeNull();
	});

	it("refuses buffers of different sizes", () => {
		const bg = buffer([60, 60, 60]);
		const fg = { ...bg, width: 32 };
		expect(measureReadability(fg, bg)).toBeNull();
	});
});
