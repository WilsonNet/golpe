/**
 * The sprite workshop's data model.
 *
 * A *board* is a raw image the game cannot use — Gemini art, reference
 * paintings, labelled collages. The workshop's job is to turn it into a
 * *sheet*: a clean horizontal strip of uniform cells plus a small atlas JSON,
 * exactly the format `src/game/render/assets.ts` slices from today. Everything
 * here is plain data; the processing lives in `processing.ts`.
 */

/** A rectangle in source-image space, in pixels. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * How cells are carved out of the board.
 *
 * `"grid"` — a uniform rows × cols lattice, for boards that already are a
 * grid (or an export you want to re-slice). `"rects"` — each cell drawn by
 * hand, for the labelled collages Gemini and reference boards tend to be.
 */
export type SliceMode = "grid" | "rects";

/** The erase-to-transparent pass: a colour and how close a pixel may be. */
export interface EraseSpec {
	r: number;
	g: number;
	b: number;
	tolerance: number;
	/** When off, the board is used as-is (the eyedropper still remembers). */
	enabled: boolean;
}

/** How trimmed content sits inside its padded frame. */
export type AlignSpec = "bottom" | "center" | "top";

export interface SliceSpec {
	mode: SliceMode;
	/** Grid mode: lattice geometry. `cellW`/`cellH` of 0 mean "fit the board". */
	cols: number;
	rows: number;
	cellW: number;
	cellH: number;
	offX: number;
	offY: number;
	gapX: number;
	gapY: number;
	/** Rects mode: the hand-drawn cells. */
	rects: Rect[];
	/**
	 * Trim each cell to its opaque content before padding. The one toggle that
	 * turns a labelled board into clean frames: it drops the beige panels, the
	 * charcoal frames and the grid lines that separate poses.
	 */
	trim: boolean;
	/**
	 * A fixed frame size for the export, or 0,0 for "auto" — the largest
	 * trimmed cell (plus margin). A fixed size is how a sheet matches an
	 * existing hero's cells (e.g. Anands' 168×152).
	 */
	padW: number;
	padH: number;
	/** Extra transparent padding around trimmed content, in auto mode. */
	margin: number;
	/** How trimmed content lines up inside the frame. */
	align: AlignSpec;
	erase: EraseSpec | null;
}

export const DEFAULT_SPEC: SliceSpec = {
	mode: "grid",
	cols: 9,
	rows: 1,
	cellW: 0,
	cellH: 0,
	offX: 0,
	offY: 0,
	gapX: 0,
	gapY: 0,
	rects: [],
	trim: true,
	padW: 0,
	padH: 0,
	margin: 2,
	align: "bottom",
	erase: null,
};

/** A named animation over the sliced cells. */
export interface ClipDef {
	name: string;
	/** Cell indices, in playback order. */
	frames: number[];
	/** Playback rate, in frames per second. */
	fps: number;
	/** Loop, or play once and hold the last frame. */
	loop: boolean;
}

/**
 * The exported atlas. This is the contract with the game: `cellW`/`cellH` are
 * the strip's cells (what `SHEET_CELLS` holds for the shipped heroes), and the
 * clips are the frame runs `HERO_CLIPS` is written from.
 */
export interface AtlasJson {
	name: string;
	cellW: number;
	cellH: number;
	/** The source rects, in cell order — informational, and how re-slicing works. */
	frames: Rect[];
	clips: ClipDef[];
}

/** The board files the workshop offers, from `/unprocessed/list.json`. */
export interface BoardEntry {
	name: string;
	size: number;
	mtime: number;
}
