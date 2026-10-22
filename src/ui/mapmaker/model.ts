/**
 * The map maker's document model: what the editor edits, and the pure
 * operations on it.
 *
 * The editor works on an `EditorMap` — the same three things the map format
 * carries (platforms, spawns, props) plus a stable id per object, because a
 * selection has to survive an undo and a list index does not. `toSpec` turns it
 * into the `TilemapSpec` the game plays and the pull request commits, and that
 * spec goes through the same `sanitizeTilemap` the server runs, so what the
 * editor shows is exactly what the room will build.
 *
 * Everything here is a pure function of its arguments. The React shell owns
 * the state; this module owns the rules.
 */

import {
	MAX_SCREENS,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	SCREEN_W,
	WORLD_BOTTOM,
} from "../../game/simulation/Arena";
import {
	MAP_HEIGHT_CELLS,
	MAX_MAP_PLATFORMS,
	MAX_MAP_ROWS,
	MAX_MAP_PROPS,
	MAX_MAP_SPAWNS,
	type MapTheme,
	SPAWN_CLEARANCE_PX,
	sanitizeTilemap,
	TILE_SIZE,
	type TilemapSpec,
	tilesetForTheme,
} from "../../game/simulation/Tilemap";
import { PROP_CATALOG, propDef } from "../../game/maps/props";

export const GRID = TILE_SIZE;
/** One row of screens, in px. A map is `rows` of them. */
export const SCREEN_H = WORLD_BOTTOM;

export interface EPlatform extends Rect {
	id: string;
}
export interface ESpawn {
	id: string;
	x: number;
	y: number;
	facing: number;
}
export interface EProp {
	id: string;
	type: string;
	x: number;
	y: number;
	flip?: boolean;
}

export interface EditorMap {
	/** Local identity in this browser's library — not the published slug. */
	localId: string;
	/** The slug the pull request will use: `maps/<slug>/`. */
	slug: string;
	name: string;
	author: string;
	description: string;
	theme: MapTheme;
	screens: number;
	/** Rows of screens, stacked: 1 is the classic one-screen-tall arena. */
	rows: number;
	platforms: EPlatform[];
	spawns: ESpawn[];
	props: EProp[];
	updatedAt: number;
}

type ObjectKind = "platform" | "spawn" | "prop";
export interface Selection {
	kind: ObjectKind;
	id: string;
}

/** Every prop the tilesets carry, in the palette's order. */
export const PROP_TYPES = PROP_CATALOG;

export const THEME_LABELS: Record<MapTheme, string> = {
	waterfront: "Waterfront",
	castle: "Castle",
	meadow: "Meadow",
	snow: "Snow",
};

let counter = 0;
export function uid(prefix = "o"): string {
	counter = (counter + 1) % 1e9;
	return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function snap(n: number): number {
	return Math.round(n / GRID) * GRID;
}

export function mapWidth(map: EditorMap): number {
	return map.screens * SCREEN_W;
}

export function mapHeight(map: EditorMap): number {
	return (map.rows ?? 1) * SCREEN_H;
}

/** A URL- and folder-safe slug from a name. */
export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug.length > 0 ? slug : "untitled-map";
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export function toSpec(map: EditorMap): TilemapSpec {
	return {
		format: "golpe-tilemap",
		version: 1,
		tileSize: TILE_SIZE,
		tileset: tilesetForTheme(map.theme),
		width: map.screens * (SCREEN_W / TILE_SIZE),
		height: (map.rows ?? 1) * MAP_HEIGHT_CELLS,
		theme: map.theme,
		meta: {
			id: map.slug,
			name: map.name.trim() || "Untitled map",
			...(map.author.trim() ? { author: map.author.trim() } : {}),
			...(map.description.trim()
				? { description: map.description.trim() }
				: {}),
		},
		layers: [
			{
				name: "platforms",
				type: "platforms",
				objects: map.platforms.map(({ x, y, w, h }) => ({ x, y, w, h })),
			},
			{
				name: "spawns",
				type: "spawns",
				objects: map.spawns.map(({ x, y, facing }) => ({ x, y, facing })),
			},
			{
				name: "props",
				type: "props",
				objects: map.props.map(({ type, x, y, flip }) => ({
					type,
					x,
					y,
					...(flip ? { flip: true } : {}),
				})),
			},
		],
	};
}

/** The spec exactly as the server will build it. */
export function playableSpec(map: EditorMap): TilemapSpec | null {
	return sanitizeTilemap(toSpec(map));
}

export function fromSpec(spec: TilemapSpec, localId = uid("m")): EditorMap {
	const platforms: EPlatform[] = [];
	const spawns: ESpawn[] = [];
	const props: EProp[] = [];
	for (const layer of spec.layers) {
		if (layer.type === "platforms") {
			for (const p of layer.objects) platforms.push({ ...p, id: uid("p") });
		} else if (layer.type === "spawns") {
			for (const s of layer.objects) spawns.push({ ...s, id: uid("s") });
		} else if (layer.type === "props") {
			for (const p of layer.objects) props.push({ ...p, id: uid("r") });
		}
	}
	const name = spec.meta?.name ?? "Untitled map";
	return {
		localId,
		slug:
			spec.meta?.id && spec.meta.id !== "untitled"
				? spec.meta.id
				: slugify(name),
		name,
		author: spec.meta?.author ?? "",
		description: spec.meta?.description ?? "",
		theme: spec.theme ?? "waterfront",
		screens: Math.max(
			1,
			Math.min(MAX_SCREENS, Math.round(spec.width / (SCREEN_W / TILE_SIZE))),
		),
		rows: Math.max(
			1,
			Math.min(
				MAX_MAP_ROWS,
				Math.round((spec.height ?? MAP_HEIGHT_CELLS) / MAP_HEIGHT_CELLS),
			),
		),
		platforms,
		spawns,
		props,
		updatedAt: Date.now(),
	};
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function spawnRect(s: { x: number; y: number }): Rect {
	return { x: s.x, y: s.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
}

export function propRect(p: { type: string; x: number; y: number }): Rect {
	const def = propDef(p.type);
	return { x: p.x, y: p.y, w: def?.w ?? 8, h: def?.h ?? 8 };
}

export function inRect(x: number, y: number, r: Rect, pad = 0): boolean {
	return (
		x >= r.x - pad &&
		x <= r.x + r.w + pad &&
		y >= r.y - pad &&
		y <= r.y + r.h + pad
	);
}

export function rectFrom(x0: number, y0: number, x1: number, y1: number): Rect {
	return {
		x: Math.min(x0, x1),
		y: Math.min(y0, y1),
		w: Math.abs(x1 - x0),
		h: Math.abs(y1 - y0),
	};
}

/** Keep a rect on the grid and inside the map. */
export function clampRect(r: Rect, map: EditorMap): Rect {
	const W = mapWidth(map);
	const H = mapHeight(map);
	let x0 = Math.max(0, Math.min(W, snap(r.x)));
	let y0 = Math.max(0, Math.min(H, snap(r.y)));
	let x1 = Math.max(0, Math.min(W, snap(r.x + r.w)));
	let y1 = Math.max(0, Math.min(H, snap(r.y + r.h)));
	if (x1 - x0 < GRID) {
		if (x1 >= W) x0 = x1 - GRID;
		else x1 = x0 + GRID;
	}
	if (y1 - y0 < GRID) {
		if (y1 >= H) y0 = y1 - GRID;
		else y1 = y0 + GRID;
	}
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Move a rect by a snapped delta, keeping its size and keeping it on the map. */
export function moveRect(
	r: Rect,
	dx: number,
	dy: number,
	map: EditorMap,
): Rect {
	const W = mapWidth(map);
	return {
		...r,
		x: Math.max(0, Math.min(W - r.w, snap(r.x + dx))),
		y: Math.max(0, Math.min(mapHeight(map) - r.h, snap(r.y + dy))),
	};
}

/**
 * The top of the surface under a point: the highest platform top at or below
 * `y` that spans `x0..x1`, or the floor. Spawns and standing props drop onto it.
 */
function surfaceBelow(
	map: EditorMap,
	x0: number,
	x1: number,
	y: number,
): number {
	let best = mapHeight(map);
	for (const p of map.platforms) {
		if (x1 <= p.x || x0 >= p.x + p.w) continue;
		if (p.y >= y && p.y < best) best = p.y;
	}
	return best;
}

/** The underside of the ceiling above a point, for hanging props. */
function ceilingAbove(
	map: EditorMap,
	x0: number,
	x1: number,
	y: number,
): number | null {
	let best: number | null = null;
	for (const p of map.platforms) {
		if (x1 <= p.x || x0 >= p.x + p.w) continue;
		const bottom = p.y + p.h;
		if (bottom <= y && (best === null || bottom > best)) best = bottom;
	}
	return best;
}

/** A spawn dropped at a point: standing on whatever is under it, facing the middle. */
export function spawnAt(map: EditorMap, x: number, y: number): ESpawn {
	const W = mapWidth(map);
	const sx = Math.max(
		0,
		Math.min(W - PLAYER_WIDTH, Math.round(x - PLAYER_WIDTH / 2)),
	);
	const top = surfaceBelow(map, sx, sx + PLAYER_WIDTH, y);
	return {
		id: uid("s"),
		x: sx,
		y: Math.max(0, top - PLAYER_HEIGHT - SPAWN_CLEARANCE_PX),
		facing: sx + PLAYER_WIDTH / 2 < W / 2 ? 1 : -1,
	};
}

/** The smallest platform under a point — the one a wall prop mounts on. */
function platformAt(
	map: EditorMap,
	x: number,
	y: number,
): EPlatform | null {
	let best: EPlatform | null = null;
	for (const p of map.platforms) {
		if (!inRect(x, y, p)) continue;
		if (!best || p.w * p.h < best.w * best.h) best = p;
	}
	return best;
}

/**
 * Where a wall prop sits on its platform: inside the face, centred on the
 * point, and below the walkable lip (the top tile row) whenever the face is
 * tall enough to leave it showing — a window over the moss reads as a hole
 * in the floor.
 */
export function mountOnFace(
	host: Rect,
	w: number,
	h: number,
	cx: number,
	cy: number,
): { x: number; y: number } {
	const lip = host.h - h >= GRID ? GRID : Math.max(0, host.h - h);
	const x =
		w >= host.w
			? Math.round(host.x + (host.w - w) / 2)
			: Math.max(host.x, Math.min(host.x + host.w - w, Math.round(cx - w / 2)));
	const y =
		h >= host.h - lip
			? host.y + lip
			: Math.max(
					host.y + lip,
					Math.min(host.y + host.h - h, Math.round(cy - h / 2)),
				);
	return { x, y };
}

/**
 * A prop dropped at a point, by how it attaches: stood on the surface below,
 * hung from the ceiling above, mounted on the platform under the cursor, or
 * left in the air exactly there.
 */
export function propAt(
	map: EditorMap,
	type: string,
	x: number,
	y: number,
): EProp {
	const def = propDef(type);
	const w = def?.w ?? 8;
	const h = def?.h ?? 8;
	const W = mapWidth(map);
	const H = mapHeight(map);
	const px = Math.max(0, Math.min(W - w, Math.round(x - w / 2)));
	const free = Math.max(0, Math.min(H - h, Math.round(y - h / 2)));
	switch (def?.attach ?? "stand") {
		case "hang": {
			const ceiling = ceilingAbove(map, px, px + w, y);
			return { id: uid("r"), type, x: px, y: ceiling ?? free };
		}
		case "wall": {
			const host = platformAt(map, x, y);
			const at = host ? mountOnFace(host, w, h, x, y) : { x: px, y: free };
			return { id: uid("r"), type, ...at };
		}
		case "air":
			return { id: uid("r"), type, x: px, y: free };
		default: {
			const floor = surfaceBelow(map, px, px + w, y);
			return { id: uid("r"), type, x: px, y: floor - h };
		}
	}
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export function addPlatform(
	map: EditorMap,
	r: Rect,
): { map: EditorMap; id: string | null } {
	if (map.platforms.length >= MAX_MAP_PLATFORMS) return { map, id: null };
	const p = { ...clampRect(r, map), id: uid("p") };
	return { map: { ...map, platforms: [...map.platforms, p] }, id: p.id };
}

export function addSpawn(
	map: EditorMap,
	s: ESpawn,
): { map: EditorMap; id: string | null } {
	if (map.spawns.length >= MAX_MAP_SPAWNS) return { map, id: null };
	return { map: { ...map, spawns: [...map.spawns, s] }, id: s.id };
}

export function addProp(
	map: EditorMap,
	p: EProp,
): { map: EditorMap; id: string | null } {
	if (map.props.length >= MAX_MAP_PROPS) return { map, id: null };
	return { map: { ...map, props: [...map.props, p] }, id: p.id };
}

export function removeObject(map: EditorMap, sel: Selection): EditorMap {
	if (sel.kind === "platform")
		return { ...map, platforms: map.platforms.filter((p) => p.id !== sel.id) };
	if (sel.kind === "spawn")
		return { ...map, spawns: map.spawns.filter((s) => s.id !== sel.id) };
	return { ...map, props: map.props.filter((p) => p.id !== sel.id) };
}

export function findObject(
	map: EditorMap,
	sel: Selection | null,
): EPlatform | ESpawn | EProp | null {
	if (!sel) return null;
	if (sel.kind === "platform")
		return map.platforms.find((p) => p.id === sel.id) ?? null;
	if (sel.kind === "spawn")
		return map.spawns.find((s) => s.id === sel.id) ?? null;
	return map.props.find((p) => p.id === sel.id) ?? null;
}

export function boundsOf(map: EditorMap, sel: Selection | null): Rect | null {
	const o = findObject(map, sel);
	if (!o || !sel) return null;
	if (sel.kind === "platform") return o as EPlatform;
	if (sel.kind === "spawn") return spawnRect(o as ESpawn);
	return propRect(o as EProp);
}

/** Replace one object's fields. */
export function updateObject(
	map: EditorMap,
	sel: Selection,
	patch: Partial<EPlatform & ESpawn & EProp>,
): EditorMap {
	if (sel.kind === "platform") {
		return {
			...map,
			platforms: map.platforms.map((p) =>
				p.id === sel.id
					? { ...p, ...clampRect({ ...p, ...patch }, map), id: p.id }
					: p,
			),
		};
	}
	if (sel.kind === "spawn") {
		const W = mapWidth(map);
		return {
			...map,
			spawns: map.spawns.map((s) =>
				s.id === sel.id
					? {
							...s,
							...patch,
							x: Math.max(
								0,
								Math.min(W - PLAYER_WIDTH, Math.round(patch.x ?? s.x)),
							),
							y: Math.max(
								0,
								Math.min(
									mapHeight(map) - PLAYER_HEIGHT,
									Math.round(patch.y ?? s.y),
								),
							),
							id: s.id,
						}
					: s,
			),
		};
	}
	return {
		...map,
		props: map.props.map((p) =>
			p.id === sel.id ? { ...p, ...patch, id: p.id } : p,
		),
	};
}

/** A copy of an object, offset so it is visibly a second one. */
export function duplicateObject(
	map: EditorMap,
	sel: Selection,
): { map: EditorMap; sel: Selection | null } {
	const o = findObject(map, sel);
	if (!o) return { map, sel: null };
	const OFFSET = GRID * 4;
	if (sel.kind === "platform") {
		const p = o as EPlatform;
		const r = addPlatform(map, moveRect(p, OFFSET, -OFFSET, map));
		return { map: r.map, sel: r.id ? { kind: "platform", id: r.id } : null };
	}
	if (sel.kind === "spawn") {
		const s = o as ESpawn;
		const r = addSpawn(map, {
			...s,
			id: uid("s"),
			x: Math.min(mapWidth(map) - PLAYER_WIDTH, s.x + OFFSET),
		});
		return { map: r.map, sel: r.id ? { kind: "spawn", id: r.id } : null };
	}
	const p = o as EProp;
	const r = addProp(map, {
		...p,
		id: uid("r"),
		x: Math.min(mapWidth(map) - 8, p.x + OFFSET),
	});
	return { map: r.map, sel: r.id ? { kind: "prop", id: r.id } : null };
}

/**
 * Make the map mirror-symmetric: everything on the left half is copied onto
 * the right, replacing what was there. A competitive arena is symmetric so
 * neither spawn side is the better one; this is the one-click version of
 * building half a map twice.
 */
export function mirrorLeftToRight(map: EditorMap): EditorMap {
	const W = mapWidth(map);
	const mid = W / 2;
	const keepP = map.platforms.filter((p) => p.x + p.w / 2 <= mid);
	// A platform that straddles the middle stays, but is made symmetric itself.
	const straddle = keepP.filter((p) => p.x + p.w > mid);
	const leftP = keepP.filter((p) => !straddle.includes(p));
	const centred = straddle.map((p) => ({ ...p, w: (mid - p.x) * 2 }));
	const platforms = [
		...leftP,
		...centred,
		...leftP.map((p) => ({ ...p, id: uid("p"), x: W - p.x - p.w })),
	];
	const leftS = map.spawns.filter((s) => s.x + PLAYER_WIDTH / 2 < mid);
	const spawns = [
		...leftS,
		...leftS.map((s) => ({
			...s,
			id: uid("s"),
			x: W - s.x - PLAYER_WIDTH,
			facing: -s.facing,
		})),
	];
	const leftR = map.props.filter((p) => p.x + propRect(p).w / 2 < mid);
	const props = [
		...leftR,
		...leftR.map((p) => ({
			...p,
			id: uid("r"),
			x: W - p.x - propRect(p).w,
			flip: !p.flip,
		})),
	];
	return {
		...map,
		platforms: platforms.slice(0, MAX_MAP_PLATFORMS),
		spawns: spawns.slice(0, MAX_MAP_SPAWNS),
		props: props.slice(0, MAX_MAP_PROPS),
	};
}

/**
 * Change the map's width. Growing extends the floor (any platform that ran the
 * full old width) to the new edge; shrinking drops whatever no longer fits.
 */
export function resize(map: EditorMap, screens: number): EditorMap {
	const next = Math.max(1, Math.min(MAX_SCREENS, Math.round(screens)));
	if (next === map.screens) return map;
	const oldW = mapWidth(map);
	const W = next * SCREEN_W;
	const platforms = map.platforms
		.map((p) => (p.x === 0 && p.x + p.w === oldW ? { ...p, w: W } : p))
		.filter((p) => p.x < W)
		.map((p) => ({ ...p, w: Math.min(p.w, W - p.x) }))
		.filter((p) => p.w >= GRID);
	return {
		...map,
		screens: next,
		platforms,
		spawns: map.spawns.filter((s) => s.x + PLAYER_WIDTH <= W),
		props: map.props.filter((p) => p.x + propRect(p).w <= W),
	};
}

/**
 * Change the map's height in rows of screens. Rows are added and removed at
 * the **top**: the floor a map stands on stays the floor, and everything on it
 * moves down by a screen so the new row opens up above it — a map grows into
 * a climb. Shrinking drops whatever was in the removed rows.
 */
export function resizeRows(map: EditorMap, rows: number): EditorMap {
	const next = Math.max(1, Math.min(MAX_MAP_ROWS, Math.round(rows)));
	const current = map.rows ?? 1;
	if (next === current) return map;
	const dy = (next - current) * SCREEN_H;
	const H = next * SCREEN_H;
	const platforms = map.platforms
		.map((p) => ({ ...p, y: p.y + dy }))
		.filter((p) => p.y + p.h > 0)
		.map((p) => (p.y < 0 ? { ...p, h: p.h + p.y, y: 0 } : p))
		.filter((p) => p.h >= GRID && p.y < H);
	return {
		...map,
		rows: next,
		platforms,
		spawns: map.spawns
			.map((s) => ({ ...s, y: s.y + dy }))
			.filter((s) => s.y >= 0),
		props: map.props
			.map((p) => ({ ...p, y: p.y + dy }))
			.filter((p) => p.y >= 0),
	};
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface History {
	past: EditorMap[];
	present: EditorMap;
	future: EditorMap[];
}

const HISTORY_LIMIT = 200;

export function historyOf(map: EditorMap): History {
	return { past: [], present: map, future: [] };
}

/** Record an edit. A no-op edit (same object) records nothing. */
export function commit(h: History, next: EditorMap): History {
	if (next === h.present) return h;
	return {
		past: [...h.past, h.present].slice(-HISTORY_LIMIT),
		present: { ...next, updatedAt: Date.now() },
		future: [],
	};
}

/**
 * Replace the present without a history entry — for the frames of a drag,
 * whose undo is one step back to before the drag began.
 */
export function preview(h: History, next: EditorMap): History {
	return { ...h, present: next };
}

export function undo(h: History): History {
	const prev = h.past.at(-1);
	if (!prev) return h;
	return {
		past: h.past.slice(0, -1),
		present: prev,
		future: [h.present, ...h.future],
	};
}

export function redo(h: History): History {
	const next = h.future[0];
	if (!next) return h;
	return {
		past: [...h.past, h.present],
		present: next,
		future: h.future.slice(1),
	};
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface Template {
	id: string;
	label: string;
	blurb: string;
	build: (
		screens: number,
		rows: number,
	) => {
		platforms: Rect[];
		spawns: { x: number; y: number }[];
	};
	/** Rows a new map from this template starts with, when not asked. */
	rows?: number;
}

const FLOOR_Y = 568;
const floor = (W: number): Rect => ({
	x: 0,
	y: FLOOR_Y,
	w: W,
	h: WORLD_BOTTOM - FLOOR_Y,
});
/** Every template draws one row; a taller map stands it on the bottom row. */
const onBottomRow = <T extends { y: number }>(rows: number, list: T[]): T[] =>
	list.map((o) => ({ ...o, y: o.y + (rows - 1) * SCREEN_H }));
const standOn = (x: number, top: number) => ({
	x,
	y: top - PLAYER_HEIGHT - SPAWN_CLEARANCE_PX,
});

export const TEMPLATES: readonly Template[] = [
	{
		id: "blank",
		label: "Blank floor",
		blurb: "Just the ground. Draw everything yourself.",
		build: (screens) => {
			const W = screens * SCREEN_W;
			const spawns = [];
			for (let x = 40; x < W - 40; x += 200) spawns.push(standOn(x, FLOOR_Y));
			return { platforms: [floor(W)], spawns };
		},
	},
	{
		id: "classic",
		label: "Classic arena",
		blurb: "The original golpe layout, ready to remix.",
		build: (screens) => {
			const W = screens * SCREEN_W;
			const platforms: Rect[] = [floor(W)];
			const spawns: { x: number; y: number }[] = [];
			const base: Rect[] = [
				{ x: 88, y: 448, w: 128, h: 24 },
				{ x: 584, y: 448, w: 128, h: 24 },
				{ x: 328, y: 360, w: 144, h: 24 },
				{ x: 56, y: 248, w: 128, h: 24 },
				{ x: 616, y: 248, w: 128, h: 24 },
				{ x: 352, y: 168, w: 96, h: 24 },
				{ x: 280, y: 472, w: 24, h: 96 },
				{ x: 496, y: 472, w: 24, h: 96 },
			];
			for (let s = 0; s < screens; s++) {
				const ox = s * SCREEN_W;
				for (const p of base) platforms.push({ ...p, x: ox + p.x });
				spawns.push(
					standOn(ox + 40, FLOOR_Y),
					standOn(ox + 380, FLOOR_Y),
					standOn(ox + 720, FLOOR_Y),
					standOn(ox + 120, 448),
					standOn(ox + 620, 448),
					standOn(ox + 384, 360),
				);
			}
			return { platforms, spawns };
		},
	},
	{
		id: "towers",
		label: "Twin towers",
		blurb: "Two climbable towers and a bridge between them.",
		build: (screens) => {
			const W = screens * SCREEN_W;
			const platforms: Rect[] = [floor(W)];
			const spawns: { x: number; y: number }[] = [];
			for (let s = 0; s < screens; s++) {
				const ox = s * SCREEN_W;
				platforms.push(
					{ x: ox + 120, y: 344, w: 32, h: 224 },
					{ x: ox + 648, y: 344, w: 32, h: 224 },
					{ x: ox + 64, y: 456, w: 56, h: 24 },
					{ x: ox + 680, y: 456, w: 56, h: 24 },
					{ x: ox + 152, y: 400, w: 72, h: 24 },
					{ x: ox + 576, y: 400, w: 72, h: 24 },
					{ x: ox + 88, y: 320, w: 96, h: 24 },
					{ x: ox + 616, y: 320, w: 96, h: 24 },
					{ x: ox + 280, y: 248, w: 240, h: 24 },
				);
				spawns.push(
					standOn(ox + 24, FLOOR_Y),
					standOn(ox + 384, FLOOR_Y),
					standOn(ox + 744, FLOOR_Y),
					standOn(ox + 120, 320),
					standOn(ox + 648, 320),
					standOn(ox + 384, 248),
				);
			}
			return { platforms, spawns };
		},
	},
	{
		id: "islands",
		label: "Sky islands",
		blurb: "Scattered floating ledges over a thin floor.",
		build: (screens) => {
			const W = screens * SCREEN_W;
			const platforms: Rect[] = [floor(W)];
			const spawns: { x: number; y: number }[] = [];
			for (let s = 0; s < screens; s++) {
				const ox = s * SCREEN_W;
				const isles: Rect[] = [
					{ x: 48, y: 456, w: 112, h: 32 },
					{ x: 240, y: 384, w: 120, h: 32 },
					{ x: 440, y: 440, w: 112, h: 32 },
					{ x: 624, y: 368, w: 128, h: 32 },
					{ x: 120, y: 272, w: 104, h: 32 },
					{ x: 352, y: 216, w: 112, h: 32 },
					{ x: 560, y: 248, w: 96, h: 32 },
				];
				for (const p of isles) {
					platforms.push({ ...p, x: ox + p.x });
					spawns.push(standOn(ox + p.x + p.w / 2 - PLAYER_WIDTH / 2, p.y));
				}
			}
			return { platforms, spawns };
		},
	},
	{
		id: "climb",
		label: "Sky tower",
		blurb: "Three screens tall: a zig-zag climb to a summit arena.",
		rows: 3,
		build: (screens, rows) => {
			const W = screens * SCREEN_W;
			const H = rows * SCREEN_H;
			const platforms: Rect[] = [{ ...floor(W), y: H - 32 }];
			const spawns: { x: number; y: number }[] = [];
			// A ledge every 112px of height — inside one jump (136px) — walking
			// side to side, so the climb is a route and not a ladder.
			const RISE = 112;
			for (let s = 0; s < screens; s++) {
				const ox = s * SCREEN_W;
				spawns.push(standOn(ox + 120, H - 32), standOn(ox + 648, H - 32));
				let y = H - 32 - RISE;
				for (let i = 0; y > 160; i++, y -= RISE) {
					const ledge: Rect = {
						x: ox + (i % 2 === 0 ? 96 : 472),
						y,
						w: 232,
						h: 24,
					};
					platforms.push(ledge);
					if (i % 3 === 2) spawns.push(standOn(ledge.x + 100, y));
				}
				// The summit, one rise above the last ledge: a wide bridge with
				// two lookout perches either side of it.
				const top = y;
				platforms.push(
					{ x: ox + 200, y: top, w: 400, h: 24 },
					{ x: ox + 32, y: top + 56, w: 96, h: 24 },
					{ x: ox + 672, y: top + 56, w: 96, h: 24 },
				);
				spawns.push(standOn(ox + 384, top));
			}
			return { platforms, spawns };
		},
	},
];

export function newMap(
	templateId: string,
	theme: MapTheme,
	screens: number,
	name = "Untitled map",
	rowsAsked?: number,
): EditorMap {
	const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
	const rows = Math.max(
		1,
		Math.min(MAX_MAP_ROWS, rowsAsked ?? template?.rows ?? 1),
	);
	const raw = template?.build(screens, rows) ?? { platforms: [], spawns: [] };
	// Templates authored a row tall are stood on the bottom row of a taller map.
	const built =
		template?.rows === undefined
			? {
					platforms: onBottomRow(rows, raw.platforms),
					spawns: onBottomRow(rows, raw.spawns),
				}
			: raw;
	const W = screens * SCREEN_W;
	return {
		localId: uid("m"),
		slug: slugify(name),
		name,
		author: "",
		description: "",
		theme,
		screens,
		rows,
		platforms: built.platforms.map((p) => ({ ...p, id: uid("p") })),
		spawns: built.spawns.map((s) => ({
			...s,
			id: uid("s"),
			facing: s.x + PLAYER_WIDTH / 2 < W / 2 ? 1 : -1,
		})),
		props: [],
		updatedAt: Date.now(),
	};
}
