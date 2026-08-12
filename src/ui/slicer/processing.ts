/**
 * The sprite workshop's pixel pipeline — pure image work, no React.
 *
 * The order matters and is what turns a messy board into game frames:
 *
 *   1. **erase** — a background colour (beige panels, white paper) is removed
 *      to transparency, so a JPEG's baked-in board cannot show through.
 *   2. **cells** — the board is carved into rects: a uniform grid, or
 *      hand-drawn rects around each pose.
 *   3. **trim** — each cell is cropped to its opaque content, which drops the
 *      panel borders and grid lines *between* poses.
 *   4. **pad** — every cell is re-centred in a uniform frame (auto-sized to
 *      the largest cell, or a fixed size to match an existing hero), so all
 *      frames line up and the sheet can be sliced by one cell size.
 *
 * Everything is a plain function over `HTMLCanvasElement`/`ImageBitmap`, so
 * the React component stays thin and the pipeline is testable.
 */

import type {
	AlignSpec,
	AtlasJson,
	ClipDef,
	EraseSpec,
	Rect,
	SliceSpec,
} from "./types";

/** An alpha below this counts as empty — JPEG halos round to a few units. */
const EMPTY_ALPHA = 12;

/** Load an image element from a URL (the caller sets crossOrigin if needed). */
export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`could not load ${src}`));
		img.src = src;
	});
}

/**
 * Erase every pixel within `tolerance` of the target colour, in RGB space.
 * Returns a fresh canvas the size of the source; the source is untouched.
 */
export function eraseColor(
	source: CanvasImageSource,
	width: number,
	height: number,
	spec: EraseSpec,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return canvas;
	ctx.drawImage(source, 0, 0);
	const data = ctx.getImageData(0, 0, width, height);
	const px = data.data;
	const t2 = spec.tolerance * spec.tolerance;
	for (let i = 0; i < px.length; i += 4) {
		const r = px[i] ?? 0;
		const g = px[i + 1] ?? 0;
		const b = px[i + 2] ?? 0;
		const dr = r - spec.r;
		const dg = g - spec.g;
		const db = b - spec.b;
		if (dr * dr + dg * dg + db * db <= t2) {
			px[i + 3] = 0;
		}
	}
	ctx.putImageData(data, 0, 0);
	return canvas;
}

/** The cell rects a spec carves out of a board of the given size. */
export function cellRects(spec: SliceSpec, imgW: number, imgH: number): Rect[] {
	if (spec.mode === "rects") {
		return spec.rects.map((r) => ({ ...r }));
	}
	const cols = Math.max(1, Math.floor(spec.cols));
	const rows = Math.max(1, Math.floor(spec.rows));
	const cellW =
		spec.cellW > 0
			? spec.cellW
			: Math.max(
					1,
					Math.floor((imgW - spec.offX - (cols - 1) * spec.gapX) / cols),
				);
	const cellH =
		spec.cellH > 0
			? spec.cellH
			: Math.max(
					1,
					Math.floor((imgH - spec.offY - (rows - 1) * spec.gapY) / rows),
				);
	const rects: Rect[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			rects.push({
				x: spec.offX + c * (cellW + spec.gapX),
				y: spec.offY + r * (cellH + spec.gapY),
				w: cellW,
				h: cellH,
			});
		}
	}
	return rects;
}

/** The opaque content bounds of an image region, or null when it is empty. */
function contentBounds(ctx: CanvasRenderingContext2D, rect: Rect): Rect | null {
	const { width, height } = ctx.canvas;
	const x0 = Math.max(0, Math.floor(rect.x));
	const y0 = Math.max(0, Math.floor(rect.y));
	const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
	const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
	if (x1 <= x0 || y1 <= y0) return null;
	const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
	let minX = x1;
	let minY = y1;
	let maxX = x0;
	let maxY = y0;
	for (let y = 0; y < y1 - y0; y++) {
		const row = y * (x1 - x0) * 4;
		for (let x = 0; x < x1 - x0; x++) {
			const a = data[row + x * 4 + 3] ?? 0;
			if (a > EMPTY_ALPHA) {
				if (x + x0 < minX) minX = x + x0;
				if (x + x0 + 1 > maxX) maxX = x + x0 + 1;
				if (y + y0 < minY) minY = y + y0;
				if (y + y0 + 1 > maxY) maxY = y + y0 + 1;
			}
		}
	}
	if (maxX <= minX || maxY <= minY) return null;
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** One processed frame: its pixels, and where content sits inside it. */
export interface ProcessedFrame {
	canvas: HTMLCanvasElement;
	/** The trimmed content rect within the frame (for the outline preview). */
	content: Rect | null;
}

/** The result of processing a board: frames plus the strip's cell size. */
export interface ProcessedSheet {
	frames: ProcessedFrame[];
	cellW: number;
	cellH: number;
}

/**
 * Run the whole pipeline on a board. `source` is the image to slice — the
 * raw board, or the erased copy when `spec.erase` is enabled.
 */
export function processFrames(
	source: CanvasImageSource,
	imgW: number,
	imgH: number,
	cells: Rect[],
	spec: SliceSpec,
): ProcessedSheet {
	// The board the cells are read from: erase first, so trim and pad never
	// see the background that was meant to be gone.
	const work = document.createElement("canvas");
	work.width = imgW;
	work.height = imgH;
	const workCtx = work.getContext("2d", { willReadFrequently: true });
	if (!workCtx) {
		return { frames: [], cellW: 0, cellH: 0 };
	}
	workCtx.drawImage(source, 0, 0);

	// Trim each cell to its content, remembering the content rects.
	const trimmed: (Rect | null)[] = cells.map((rect) => {
		if (!spec.trim) return rect;
		const bounds = contentBounds(workCtx, rect);
		if (!bounds) return null;
		return {
			...bounds,
			// The bounds are tight to the pixels; give the content a hair of
			// room so a semi-transparent halo is not cropped by the frame edge.
			x: bounds.x - 0.5,
			y: bounds.y - 0.5,
			w: bounds.w + 1,
			h: bounds.h + 1,
		};
	});

	const content = trimmed.filter((t): t is Rect => t !== null);
	if (content.length === 0) {
		return { frames: [], cellW: 0, cellH: 0 };
	}

	const maxW = Math.max(...content.map((c) => c.w));
	const maxH = Math.max(...content.map((c) => c.h));
	// The margin is breathing room around *trimmed* content. With trim off the
	// cells are already exact — padding them would grow the sheet by margin on
	// every side for no reason, which broke the lossless Aseprite round-trip.
	const autoW = maxW + (spec.trim ? spec.margin * 2 : 0);
	const autoH = maxH + (spec.trim ? spec.margin * 2 : 0);
	const cellW = spec.padW > 0 ? spec.padW : autoW;
	const cellH = spec.padH > 0 ? spec.padH : autoH;

	const frames: ProcessedFrame[] = cells.map((_, i) => {
		const frame = document.createElement("canvas");
		frame.width = Math.max(1, Math.floor(cellW));
		frame.height = Math.max(1, Math.floor(cellH));
		const ctx = frame.getContext("2d");
		if (!ctx) return { canvas: frame, content: null };
		const src = trimmed[i];
		if (!src) return { canvas: frame, content: null };
		const dx = alignOffset(cellW, src.w, spec.align);
		const dy = alignOffset(cellH, src.h, spec.align);
		ctx.drawImage(work, src.x, src.y, src.w, src.h, dx, dy, src.w, src.h);
		return {
			canvas: frame,
			content: { x: dx, y: dy, w: src.w, h: src.h },
		};
	});

	return { frames, cellW, cellH };
}

/** Where an axis' content starts inside the frame, per the alignment. */
function alignOffset(frame: number, content: number, align: AlignSpec): number {
	if (align === "top") return 0;
	if (align === "center") return Math.max(0, Math.floor((frame - content) / 2));
	return Math.max(0, Math.floor(frame - content));
}

/** Lay the frames into one horizontal strip of uniform cells. */
export function composeStrip(
	frames: ProcessedFrame[],
	cellW: number,
	cellH: number,
): HTMLCanvasElement {
	const strip = document.createElement("canvas");
	strip.width = Math.max(1, frames.length * cellW);
	strip.height = Math.max(1, cellH);
	const ctx = strip.getContext("2d");
	if (ctx) {
		frames.forEach((frame, i) => {
			ctx.drawImage(frame.canvas, i * cellW, 0);
		});
	}
	return strip;
}

/** The atlas JSON the game's loader accepts (see `assets.ts`). */
export function atlasJson(
	name: string,
	cells: Rect[],
	processed: ProcessedSheet,
	clips: ClipDef[],
): AtlasJson {
	return {
		name,
		cellW: processed.cellW,
		cellH: processed.cellH,
		frames: cells,
		clips: clips.map((c) => ({
			name: c.name,
			frames: [...c.frames],
			fps: c.fps,
			loop: c.loop,
		})),
	};
}

/** Download a canvas as a PNG. */
export function downloadCanvas(
	canvas: HTMLCanvasElement,
	fileName: string,
): void {
	canvas.toBlob((blob) => {
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(url);
	}, "image/png");
}

/** Download a JSON object as a file. */
export function downloadJson(data: unknown, fileName: string): void {
	const blob = new Blob([JSON.stringify(data, null, "\t")], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	a.click();
	URL.revokeObjectURL(url);
}

/** A safe file-name base: lowercase, word characters only. */
export function sheetName(raw: string): string {
	const base = raw.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
	return base.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "sheet";
}
