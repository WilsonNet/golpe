/**
 * The readability audit: is a fighter separable from the world behind it?
 *
 * The question is not "is the background pretty" but "can a player find the
 * body in a glance" — and that is measurable. The method is the one the game-art
 * literature has used for years (Game Developer's value analysis, the silhouette
 * test, atmospheric perspective):
 *
 * - **Value structure**: the actors should occupy a different brightness band
 *   from the background. A grayscale screenshot is the cheap audit.
 * - **Local contrast**: the background directly behind an actor must not be
 *   in the same colour family at the same lightness.
 * - **Silhouette**: the edge of the body is what the eye finds first. A strong
 *   outline survives even when the interior matches.
 * - **Detail budget**: the combat band should be the quietest part of the
 *   background; detail belongs at the frame's edges.
 *
 * The probe supplies two renders of the same frame: one with the fighter
 * sprites, one without. Their difference is the body mask, and the
 * without-fighters render is exactly the background the body occludes. That
 * makes the comparison honest — no guessed bounding box, no colour picked from
 * a palette file.
 *
 * This module is pure and testable: it takes two pixel buffers, not a renderer.
 */

export interface PixelBuffer {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

export interface ReadabilityMetrics {
	/** Opaque pixels in the largest fighter component. */
	pixels: number;
	bounds: { x: number; y: number; w: number; h: number };
	/**
	 * WCAG-style luminance ratio between the mean body and the background it
	 * covers. The Xbox accessibility guidance puts large visual elements at
	 * 3:1; a fighting-game body is exactly that class of element.
	 */
	contrastRatio: number;
	/** Mean CIELAB lightness difference between body and the covered background. */
	valueContrast: number;
	/** Mean CIELAB lightness of the body and of the background it covers. */
	foregroundL: number;
	backgroundL: number;
	/** Median ΔE (CIE76) between the body and the exact background behind it. */
	interiorContrast: number;
	/** The worst quarter of the body, where a busy background hides it. */
	interiorP25: number;
	/** Median ΔE at the silhouette's outside edge. */
	silhouetteContrast: number;
	/** Fraction of silhouette pixels with an outside edge ΔE >= 20. */
	silhouetteCoverage: number;
	/**
	 * The same edge measured one pixel inside the mask, where the solid ink
	 * line is. The outermost pixel of a filtered sprite is a soft blend; a thin
	 * dark coat can read as a low edge there even when the line itself is
	 * strong. This is the honest silhouette number for a pixel-art body.
	 */
	silhouetteCoreContrast: number;
	silhouetteCoreCoverage: number;
	/** Local background lightness spread inside the body's neighbourhood. */
	backgroundLumaStd: number;
	/** Fraction of high-gradient pixels in that neighbourhood; a detail budget. */
	backgroundDetail: number;
}

/** One measured frame, as the readability probe reads it. */
export interface ReadabilitySnapshot {
	cameraX: number;
	variant: string;
	metrics: ReadabilityMetrics | null;
	/** The same frame with and without fighter sprites, for visual review. */
	withFighters: string;
	background: string;
	combatants: { id: string; x: number; y: number; w: number; h: number }[];
}

const DIFF_THRESHOLD = 12;
/** Below this many differing pixels, nothing useful was captured. */
const MIN_COMPONENT_PIXELS = 32;
/** ΔE 20 is a clearly visible colour step at this pixel scale. */
const SILHOUETTE_VISIBLE_DE = 20;
/** A "busy" background pixel is one whose local lightness gradient is large. */
const DETAIL_GRADIENT = 18;

/**
 * Compare a frame with its fighters to the same frame without them.
 *
 * Returns null when the difference is not a body — a missing renderer, an
 * all-black frame, or an extraction that changed the whole scene (the probe
 * should treat that as a failed measurement, never as a passing score).
 */
export function measureReadability(
	withFighters: PixelBuffer,
	background: PixelBuffer,
): ReadabilityMetrics | null {
	if (
		withFighters.width !== background.width ||
		withFighters.height !== background.height
	)
		return null;
	const w = withFighters.width;
	const h = withFighters.height;
	const n = w * h;
	const a = withFighters.data;
	const b = background.data;
	if (a.length < n * 4 || b.length < n * 4) return null;

	const mask = new Uint8Array(n);
	let maskCount = 0;
	for (let i = 0, p = 0; i < n; i++, p += 4) {
		const d = Math.max(
			Math.abs((a[p] ?? 0) - (b[p] ?? 0)),
			Math.abs((a[p + 1] ?? 0) - (b[p + 1] ?? 0)),
			Math.abs((a[p + 2] ?? 0) - (b[p + 2] ?? 0)),
		);
		if (d > DIFF_THRESHOLD) {
			mask[i] = 1;
			maskCount++;
		}
	}
	// A fighter is a few hundred pixels at 800x600. A quarter of the frame
	// means the two renders differ in something other than the actors.
	if (maskCount < MIN_COMPONENT_PIXELS || maskCount > n * 0.2) return null;

	const component = largestComponent(mask, w, h);
	if (!component || component.pixels.length < MIN_COMPONENT_PIXELS) return null;

	const { x0, y0, x1, y1, pixels } = component;
	let minX = w;
	let minY = h;
	let maxX = 0;
	let maxY = 0;
	for (const i of pixels) {
		const x = i % w;
		const y = (i / w) | 0;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}

	const inside = new Set(pixels);
	const interior: number[] = [];
	const silhouette: number[] = [];
	let fgL = 0;
	let bgL = 0;
	let fgY = 0;
	let bgY = 0;
	for (const i of pixels) {
		const p = i * 4;
		const fg = labAt(a, p);
		const bg = labAt(b, p);
		const x = i % w;
		const y = (i / w) | 0;
		fgL += fg.L;
		bgL += bg.L;
		fgY += fg.Y;
		bgY += bg.Y;
		interior.push(deltaE(fg, bg));

		let edge = 0;
		for (const [nx, ny] of [
			[x - 1, y],
			[x + 1, y],
			[x, y - 1],
			[x, y + 1],
		] as const) {
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			const ni = ny * w + nx;
			if (inside.has(ni)) continue;
			const q = ni * 4;
			edge = Math.max(edge, deltaE(fg, labAt(b, q)));
		}
		if (edge > 0) silhouette.push(edge);
	}

	const count = pixels.length;
	const fgMeanY = fgY / count;
	const bgMeanY = bgY / count;
	const contrastRatio =
		(Math.max(fgMeanY, bgMeanY) + 0.05) / (Math.min(fgMeanY, bgMeanY) + 0.05);
	const valueContrast = Math.abs(fgL / count - bgL / count);

	// One-pixel erosion. The solid core is the ink line and the body, not the
	// soft anti-aliased skirt of a filtered sprite.
	const solid = new Uint8Array(n);
	for (const i of pixels) {
		const x = i % w;
		const y = (i / w) | 0;
		if (
			x > 0 &&
			x < w - 1 &&
			y > 0 &&
			y < h - 1 &&
			inside.has(i - 1) &&
			inside.has(i + 1) &&
			inside.has(i - w) &&
			inside.has(i + w)
		)
			solid[i] = 1;
	}
	const core: number[] = [];
	for (const i of pixels) {
		if (!solid[i]) continue;
		const x = i % w;
		const y = (i / w) | 0;
		let edge = false;
		for (const [nx, ny] of [
			[x - 1, y],
			[x + 1, y],
			[x, y - 1],
			[x, y + 1],
		] as const) {
			if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
			if (!solid[ny * w + nx]) {
				edge = true;
				break;
			}
		}
		if (!edge) continue;
		const p = i * 4;
		core.push(deltaE(labAt(a, p), labAt(b, p)));
	}

	// The background neighbourhood: a small ring around the body. This is the
	// "detail budget" the eye is competing with, not the whole screen.
	const pad = 10;
	const bx0 = Math.max(0, minX - pad);
	const by0 = Math.max(0, minY - pad);
	const bx1 = Math.min(w - 1, maxX + pad);
	const by1 = Math.min(h - 1, maxY + pad);
	const luma: number[] = [];
	let detailPixels = 0;
	let detailCount = 0;
	for (let y = by0; y <= by1; y++) {
		for (let x = bx0; x <= bx1; x++) {
			const i = y * w + x;
			if (inside.has(i)) continue;
			const p = i * 4;
			const here = labAt(b, p).L;
			luma.push(here);
			const left = x > bx0 ? labAt(b, p - 4).L : here;
			const right = x < bx1 ? labAt(b, p + 4).L : here;
			const up = y > by0 ? labAt(b, p - w * 4).L : here;
			const down = y < by1 ? labAt(b, p + w * 4).L : here;
			const gradient = Math.abs(right - left) + Math.abs(down - up);
			detailCount++;
			if (gradient > DETAIL_GRADIENT) detailPixels++;
		}
	}

	return {
		pixels: count,
		bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
		contrastRatio,
		valueContrast,
		foregroundL: fgL / count,
		backgroundL: bgL / count,
		interiorContrast: median(interior),
		interiorP25: quantile(interior, 0.25),
		silhouetteContrast: median(silhouette),
		silhouetteCoverage:
			silhouette.filter((d) => d >= SILHOUETTE_VISIBLE_DE).length /
			Math.max(1, silhouette.length),
		silhouetteCoreContrast: median(core),
		silhouetteCoreCoverage:
			core.filter((d) => d >= SILHOUETTE_VISIBLE_DE).length /
			Math.max(1, core.length),
		backgroundLumaStd: stddev(luma),
		backgroundDetail: detailCount ? detailPixels / detailCount : 0,
	};
}

interface Component {
	pixels: number[];
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** The largest 4-connected component of the diff mask. */
function largestComponent(
	mask: Uint8Array,
	w: number,
	h: number,
): Component | null {
	const seen = new Uint8Array(mask.length);
	let best: Component | null = null;
	const stack: number[] = [];
	for (let seed = 0; seed < mask.length; seed++) {
		if (!mask[seed] || seen[seed]) continue;
		const pixels: number[] = [];
		let x0 = w;
		let y0 = h;
		let x1 = 0;
		let y1 = 0;
		stack.length = 0;
		stack.push(seed);
		seen[seed] = 1;
		while (stack.length) {
			const i = stack.pop() as number;
			pixels.push(i);
			const x = i % w;
			const y = (i / w) | 0;
			if (x < x0) x0 = x;
			if (y < y0) y0 = y;
			if (x > x1) x1 = x;
			if (y > y1) y1 = y;
			if (x > 0 && mask[i - 1] && !seen[i - 1]) {
				seen[i - 1] = 1;
				stack.push(i - 1);
			}
			if (x < w - 1 && mask[i + 1] && !seen[i + 1]) {
				seen[i + 1] = 1;
				stack.push(i + 1);
			}
			if (y > 0 && mask[i - w] && !seen[i - w]) {
				seen[i - w] = 1;
				stack.push(i - w);
			}
			if (y < h - 1 && mask[i + w] && !seen[i + w]) {
				seen[i + w] = 1;
				stack.push(i + w);
			}
		}
		if (!best || pixels.length > best.pixels.length)
			best = { pixels, x0, y0, x1, y1 };
	}
	return best;
}

/** sRGB → CIELAB (D65), with the relative luminance carried along for WCAG. */
function labAt(data: Uint8ClampedArray, p: number) {
	return lab(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0);
}

function lab(r: number, g: number, b: number) {
	const lr = linear(r);
	const lg = linear(g);
	const lb = linear(b);
	const Y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
	const X = 0.4124 * lr + 0.3576 * lg + 0.1805 * lb;
	const Z = 0.0193 * lr + 0.1192 * lg + 0.9505 * lb;
	const fx = labF(X / 0.95047);
	const fy = labF(Y);
	const fz = labF(Z / 1.08883);
	return {
		L: 116 * fy - 16,
		a: 500 * (fx - fy),
		b: 200 * (fy - fz),
		Y,
	};
}

function linear(c: number): number {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
	return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function deltaE(
	a: { L: number; a: number; b: number },
	b: { L: number; a: number; b: number },
): number {
	return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

function median(values: number[]): number {
	return quantile(values, 0.5);
}

function quantile(values: number[], q: number): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((x, y) => x - y);
	const at = Math.min(sorted.length - 1, Math.max(0, q * (sorted.length - 1)));
	const lo = Math.floor(at);
	const hi = Math.ceil(at);
	const t = at - lo;
	return (sorted[lo] ?? 0) * (1 - t) + (sorted[hi] ?? 0) * t;
}

function stddev(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((s, v) => s + v, 0) / values.length;
	const varSum =
		values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
	return Math.sqrt(varSum);
}
