/**
 * Drawing a map for the map maker: the live canvas and the overview image the
 * pull request leads with are both this one function at two transforms.
 *
 * Layers, back to front: the theme's sky, the screen seams, the grid, the
 * jump-reach band, platforms, props, spawns, the checks' markers, the
 * selection and the active tool's ghost. Everything is in world pixels under
 * one `setTransform`, so a zoom never has to be threaded through a draw call.
 */

import { type MapIssue, REACH_RISE_PX } from "../../game/maps/checks";
import { THEME_SKY } from "../../game/render/ThemeSky";
import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	SCREEN_W,
} from "../../game/simulation/Arena";
import { JUMP_HEIGHT_PX } from "../../game/simulation/Physics";
import { cssColor, drawPropArt, platformArt } from "./art2d";
import {
	boundsOf,
	type EditorMap,
	GRID,
	MAP_H,
	mapWidth,
	propRect,
	type Selection,
} from "./model";

export interface View {
	/** Screen pixels per world pixel. */
	zoom: number;
	/** The world point at the canvas's top-left. */
	panX: number;
	panY: number;
	/** The canvas's size in CSS pixels. */
	width: number;
	height: number;
}

export type Ghost =
	| { kind: "rect"; rect: Rect }
	| { kind: "spawn"; x: number; y: number; facing: number }
	| { kind: "prop"; type: string; x: number; y: number }
	| { kind: "erase"; x: number; y: number };

export interface SceneOptions {
	grid: boolean;
	reach: boolean;
	/** Flat competitive blocks instead of the theme's tiles. */
	flat: boolean;
	issues: readonly MapIssue[];
	selection: Selection | null;
	hover: Selection | null;
	ghost: Ghost | null;
	/** Screen labels and spawn numbers — off for the clean overview image. */
	labels: boolean;
	/** The issue the checks panel is pointing at, drawn louder. */
	focus: Rect | null;
}

const HANDLE_PX = 8;
/**
 * On-canvas labels, in screen pixels: divided by the zoom so they read the
 * same at every zoom, and on the editor's 13px secondary step.
 */
const LABEL_PX = 13;
const LABEL_BOX_PX = 19;
const LABEL_PAD_PX = 5;
const FLAT_FILL = "#3d7a4a";
const FLAT_EDGE = "#2a5a35";
const SPAWN_FILL = "rgba(255, 209, 102, 0.28)";
const SPAWN_EDGE = "#ffd166";
const SELECT = "#0ec3c9";
const ERROR = "#ff5d5d";
const WARN = "#ffb547";

export function drawScene(
	ctx: CanvasRenderingContext2D,
	map: EditorMap,
	view: View,
	opts: SceneOptions,
): void {
	const W = mapWidth(map);
	const { zoom } = view;
	ctx.save();
	ctx.imageSmoothingEnabled = false;
	// Outside the map: the workbench, not the world.
	ctx.fillStyle = "#0c0f14";
	ctx.fillRect(0, 0, view.width, view.height);
	ctx.setTransform(
		ctx.getTransform().a * zoom,
		0,
		0,
		ctx.getTransform().d * zoom,
		ctx.getTransform().e - view.panX * zoom * ctx.getTransform().a,
		ctx.getTransform().f - view.panY * zoom * ctx.getTransform().d,
	);

	// Sky: the theme's stops as 8px bands, like the backdrop's.
	const stops = THEME_SKY[map.theme];
	for (let y = 0; y < MAP_H; y += GRID) {
		const t = (y / MAP_H) * (stops.length - 1);
		const i = Math.min(stops.length - 2, Math.floor(t));
		ctx.fillStyle = cssColor(mix(stops[i] ?? 0, stops[i + 1] ?? 0, t - i));
		// One pixel of overlap: at a fractional zoom abutting bands leave a seam.
		ctx.fillRect(0, y, W, GRID + 1);
	}

	if (opts.grid) drawGrid(ctx, W, zoom);

	// Screen seams: the unit the game is authored in, and the unit a team
	// match spawns by.
	ctx.strokeStyle = "rgba(255,255,255,0.35)";
	ctx.lineWidth = 1 / zoom;
	ctx.setLineDash([6 / zoom, 6 / zoom]);
	for (let x = SCREEN_W; x < W; x += SCREEN_W) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, MAP_H);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	if (opts.labels) {
		ctx.fillStyle = "rgba(255,255,255,0.55)";
		ctx.font = `${LABEL_PX / zoom}px monospace`;
		for (let s = 0; s * SCREEN_W < W; s++) {
			ctx.fillText(`SCREEN ${s + 1}`, s * SCREEN_W + 10 / zoom, 20 / zoom);
		}
	}

	if (opts.reach) drawReach(ctx, map, opts, zoom);

	for (const p of map.platforms) {
		const art = opts.flat ? null : platformArt(map.theme, p.w, p.h);
		if (art) ctx.drawImage(art, p.x, p.y);
		else {
			ctx.fillStyle = FLAT_FILL;
			ctx.fillRect(p.x, p.y, p.w, p.h);
			ctx.strokeStyle = FLAT_EDGE;
			ctx.lineWidth = 2 / zoom;
			ctx.strokeRect(p.x, p.y, p.w, p.h);
		}
	}

	if (!opts.flat) {
		for (const p of map.props)
			drawPropArt(ctx, map.theme, p.type, p.x, p.y, p.flip);
	}

	map.spawns.forEach((s, i) => {
		drawSpawn(ctx, s.x, s.y, s.facing, zoom, opts.labels ? i + 1 : null, 1);
	});

	for (const issue of opts.issues) {
		if (!issue.at || issue.level === "info") continue;
		ctx.strokeStyle = issue.level === "error" ? ERROR : WARN;
		ctx.lineWidth = 2 / zoom;
		ctx.setLineDash([4 / zoom, 3 / zoom]);
		ctx.strokeRect(
			issue.at.x - 2 / zoom,
			issue.at.y - 2 / zoom,
			issue.at.w + 4 / zoom,
			issue.at.h + 4 / zoom,
		);
		ctx.setLineDash([]);
	}
	if (opts.focus) {
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 3 / zoom;
		const pad = 6 / zoom;
		ctx.strokeRect(
			opts.focus.x - pad,
			opts.focus.y - pad,
			opts.focus.w + pad * 2,
			opts.focus.h + pad * 2,
		);
	}

	const hover =
		opts.hover && !sameSel(opts.hover, opts.selection)
			? boundsOf(map, opts.hover)
			: null;
	if (hover) {
		ctx.strokeStyle = "rgba(14,195,201,0.6)";
		ctx.lineWidth = 1.5 / zoom;
		ctx.strokeRect(hover.x, hover.y, hover.w, hover.h);
	}
	const sel = boundsOf(map, opts.selection);
	if (sel) {
		ctx.strokeStyle = SELECT;
		ctx.lineWidth = 2 / zoom;
		ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
		if (opts.selection?.kind === "platform") {
			ctx.fillStyle = SELECT;
			for (const h of handles(sel)) {
				const s = HANDLE_PX / zoom;
				ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s);
			}
		}
		if (opts.labels) {
			ctx.fillStyle = "rgba(0,0,0,0.75)";
			const label = `${sel.w}×${sel.h}  @ ${sel.x},${sel.y}`;
			ctx.font = `${LABEL_PX / zoom}px monospace`;
			const tw = ctx.measureText(label).width;
			const above = sel.y - (LABEL_BOX_PX + 4) / zoom;
			const ly = above < 0 ? sel.y + sel.h + 4 / zoom : above;
			ctx.fillRect(
				sel.x,
				ly,
				tw + (LABEL_PAD_PX * 2) / zoom,
				LABEL_BOX_PX / zoom,
			);
			ctx.fillStyle = "#fff";
			ctx.fillText(
				label,
				sel.x + LABEL_PAD_PX / zoom,
				ly + (LABEL_BOX_PX - 5) / zoom,
			);
		}
	}

	drawGhost(ctx, map, opts.ghost, zoom, opts.flat);

	// The map's edge, so the end of the world is never a surprise.
	ctx.strokeStyle = "rgba(255,209,102,0.7)";
	ctx.lineWidth = 2 / zoom;
	ctx.strokeRect(0, 0, W, MAP_H);
	ctx.restore();
}

function sameSel(a: Selection | null, b: Selection | null): boolean {
	return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, zoom: number) {
	// Fine cells only when they are big enough to aim at; the 32px grid always.
	const fine = zoom >= 1.5;
	ctx.lineWidth = 1 / zoom;
	ctx.beginPath();
	if (fine) {
		ctx.strokeStyle = "rgba(255,255,255,0.06)";
		for (let x = 0; x <= W; x += GRID) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, MAP_H);
		}
		for (let y = 0; y <= MAP_H; y += GRID) {
			ctx.moveTo(0, y);
			ctx.lineTo(W, y);
		}
		ctx.stroke();
		ctx.beginPath();
	}
	ctx.strokeStyle = "rgba(255,255,255,0.12)";
	for (let x = 0; x <= W; x += GRID * 4) {
		ctx.moveTo(x, 0);
		ctx.lineTo(x, MAP_H);
	}
	for (let y = 0; y <= MAP_H; y += GRID * 4) {
		ctx.moveTo(0, y);
		ctx.lineTo(W, y);
	}
	ctx.stroke();
}

/**
 * How high a fighter standing on a surface can get: the single jump's band and
 * the double jump's above it. Drawn over the selected platform (or the floor
 * under the ghost), because "can I get up there?" is the question every ledge
 * placement asks.
 */
function drawReach(
	ctx: CanvasRenderingContext2D,
	map: EditorMap,
	opts: SceneOptions,
	zoom: number,
) {
	const sel =
		opts.selection?.kind === "platform" ? boundsOf(map, opts.selection) : null;
	const surfaces: Rect[] = sel
		? [sel]
		: map.platforms.filter((p) => p.y + p.h >= MAP_H - GRID * 6);
	for (const s of surfaces) {
		const reach = 240;
		const x = Math.max(0, s.x - reach);
		const w = Math.min(mapWidth(map), s.x + s.w + reach) - x;
		ctx.fillStyle = "rgba(124, 230, 140, 0.16)";
		ctx.fillRect(x, s.y - JUMP_HEIGHT_PX, w, JUMP_HEIGHT_PX);
		ctx.fillStyle = "rgba(124, 200, 230, 0.12)";
		ctx.fillRect(x, s.y - REACH_RISE_PX, w, REACH_RISE_PX - JUMP_HEIGHT_PX);
		ctx.strokeStyle = "rgba(124, 230, 140, 0.6)";
		ctx.lineWidth = 1 / zoom;
		ctx.setLineDash([3 / zoom, 3 / zoom]);
		ctx.beginPath();
		ctx.moveTo(x, s.y - JUMP_HEIGHT_PX);
		ctx.lineTo(x + w, s.y - JUMP_HEIGHT_PX);
		ctx.moveTo(x, s.y - REACH_RISE_PX);
		ctx.lineTo(x + w, s.y - REACH_RISE_PX);
		ctx.stroke();
		ctx.setLineDash([]);
	}
}

/** A fighter-sized silhouette with a facing arrow — what a spawn really occupies. */
function drawSpawn(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	facing: number,
	zoom: number,
	n: number | null,
	alpha: number,
) {
	ctx.globalAlpha = alpha;
	ctx.fillStyle = SPAWN_FILL;
	ctx.strokeStyle = SPAWN_EDGE;
	ctx.lineWidth = 1.5 / zoom;
	const r = 6;
	ctx.beginPath();
	ctx.roundRect(x, y, PLAYER_WIDTH, PLAYER_HEIGHT, r);
	ctx.fill();
	ctx.stroke();
	// Head.
	ctx.beginPath();
	ctx.arc(x + PLAYER_WIDTH / 2, y + 11, 7, 0, Math.PI * 2);
	ctx.fillStyle = SPAWN_EDGE;
	ctx.fill();
	// Facing.
	const cy = y + PLAYER_HEIGHT * 0.6;
	const cx = x + PLAYER_WIDTH / 2;
	ctx.beginPath();
	ctx.moveTo(cx + facing * 12, cy);
	ctx.lineTo(cx - facing * 4, cy - 7);
	ctx.lineTo(cx - facing * 4, cy + 7);
	ctx.closePath();
	ctx.fill();
	if (n !== null) {
		ctx.fillStyle = "#1b1b24";
		ctx.font = "bold 12px monospace";
		ctx.textAlign = "center";
		ctx.fillText(String(n), cx, y + 15);
		ctx.textAlign = "start";
	}
	ctx.globalAlpha = 1;
}

function drawGhost(
	ctx: CanvasRenderingContext2D,
	map: EditorMap,
	ghost: Ghost | null,
	zoom: number,
	flat: boolean,
) {
	if (!ghost) return;
	if (ghost.kind === "rect") {
		const r = ghost.rect;
		const art = flat ? null : platformArt(map.theme, r.w, r.h);
		ctx.globalAlpha = 0.75;
		if (art) ctx.drawImage(art, r.x, r.y);
		else {
			ctx.fillStyle = FLAT_FILL;
			ctx.fillRect(r.x, r.y, r.w, r.h);
		}
		ctx.globalAlpha = 1;
		ctx.strokeStyle = SELECT;
		ctx.lineWidth = 1.5 / zoom;
		ctx.strokeRect(r.x, r.y, r.w, r.h);
		ctx.fillStyle = "rgba(0,0,0,0.75)";
		ctx.font = `${LABEL_PX / zoom}px monospace`;
		const label = `${r.w}×${r.h}`;
		ctx.fillRect(
			r.x + r.w + 4 / zoom,
			r.y + r.h + 4 / zoom,
			ctx.measureText(label).width + (LABEL_PAD_PX * 2) / zoom,
			LABEL_BOX_PX / zoom,
		);
		ctx.fillStyle = "#fff";
		ctx.fillText(
			label,
			r.x + r.w + (4 + LABEL_PAD_PX) / zoom,
			r.y + r.h + (4 + LABEL_BOX_PX - 5) / zoom,
		);
	} else if (ghost.kind === "spawn") {
		drawSpawn(ctx, ghost.x, ghost.y, ghost.facing, zoom, null, 0.6);
	} else if (ghost.kind === "prop") {
		ctx.globalAlpha = 0.7;
		if (!drawPropArt(ctx, map.theme, ghost.type, ghost.x, ghost.y)) {
			const r = propRect({ id: "", type: ghost.type, x: ghost.x, y: ghost.y });
			ctx.fillStyle = "#c9852f";
			ctx.fillRect(r.x, r.y, r.w, r.h);
		}
		ctx.globalAlpha = 1;
	} else {
		ctx.strokeStyle = ERROR;
		ctx.lineWidth = 2 / zoom;
		const s = 10 / zoom;
		ctx.beginPath();
		ctx.moveTo(ghost.x - s, ghost.y - s);
		ctx.lineTo(ghost.x + s, ghost.y + s);
		ctx.moveTo(ghost.x + s, ghost.y - s);
		ctx.lineTo(ghost.x - s, ghost.y + s);
		ctx.stroke();
	}
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function handles(r: Rect): { id: Handle; x: number; y: number }[] {
	const cx = r.x + r.w / 2;
	const cy = r.y + r.h / 2;
	return [
		{ id: "nw", x: r.x, y: r.y },
		{ id: "n", x: cx, y: r.y },
		{ id: "ne", x: r.x + r.w, y: r.y },
		{ id: "e", x: r.x + r.w, y: cy },
		{ id: "se", x: r.x + r.w, y: r.y + r.h },
		{ id: "s", x: cx, y: r.y + r.h },
		{ id: "sw", x: r.x, y: r.y + r.h },
		{ id: "w", x: r.x, y: cy },
	];
}

function mix(a: number, b: number, t: number): number {
	const ar = (a >> 16) & 0xff;
	const ag = (a >> 8) & 0xff;
	const ab = a & 0xff;
	const r = Math.round(ar + (((b >> 16) & 0xff) - ar) * t);
	const g = Math.round(ag + (((b >> 8) & 0xff) - ag) * t);
	const bl = Math.round(ab + ((b & 0xff) - ab) * t);
	return (r << 16) | (g << 8) | bl;
}

/**
 * The whole map, at 1:1, as a PNG — the pull request's first screenshot and
 * the menu's map card. No grid, no labels, no selection: the map as it plays.
 */
export async function renderOverview(map: EditorMap): Promise<Blob> {
	const W = mapWidth(map);
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = MAP_H;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d context");
	drawScene(
		ctx,
		map,
		{ zoom: 1, panX: 0, panY: 0, width: W, height: MAP_H },
		{
			grid: false,
			reach: false,
			flat: false,
			issues: [],
			selection: null,
			hover: null,
			ghost: null,
			labels: false,
			focus: null,
		},
	);
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error("overview encode failed"))),
			"image/png",
		),
	);
}
