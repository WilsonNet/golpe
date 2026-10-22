/**
 * The arena's map format.
 *
 * The simulation owns the **collision rectangles**; this module owns the data
 * that describes where they are and how a renderer should dress them. Keeping
 * those two statements separate is what lets the same map be drawn as the
 * Waterfront's stone quay or as the original flat competitive blocks without
 * touching a single collider.
 *
 * The current arena is still authored in `Arena.ts`. `tilemapFromWorld` turns
 * its rectangles into the same shape a future map editor will save, so the
 * renderer already consumes the format rather than a private layout. A map
 * maker can replace the `platforms` object layer with a `solid` cell grid;
 * `solidRectsFromTilemap` turns either into the rectangles physics expects.
 *
 * ## Why rectangles and a 9-slice
 *
 * The arena is made of axis-aligned rectangles: a ground strip, six ledges and
 * two pillars. The tile-art literature has a name for this case — a rectangle
 * or panel wants a **9-slice**, while organic terrain wants a 47-tile blob or a
 * 16-tile Wang set (Tilesetter; TonyStr's autotiling article; the "Pixeli"
 * autotiling rules). A 47-blob set here would spend its budget on inner
 * corners that a 24px ledge can never show. The renderer therefore chooses a
 * 3x3 tile role from a cell's position in its rectangle and stretches the
 * middle with a `TilingSprite`.
 */

import {
	MAX_SCREENS,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	SCREEN_W,
	type SpawnPoint,
	WORLD_BOTTOM,
	WORLD_LEFT,
	WORLD_TOP,
	type World,
} from "./Arena.js";

/** The map's native cell. 8px divides both 24px ledges and the 32px ground. */
export const TILE_SIZE = 8;

/** A standable object, in world pixels. The collider is exactly this rect. */
export type PlatformObject = Rect;

/**
 * A decoration. `type` names a frame in the tileset's prop atlas; props never
 * collide and never enter the simulation.
 */
export interface PropObject {
	type: string;
	x: number;
	y: number;
	/** Mirror about the frame's own vertical axis. */
	flip?: boolean;
}

interface PlatformsLayer {
	name: string;
	type: "platforms";
	objects: readonly PlatformObject[];
}

interface PropsLayer {
	name: string;
	type: "props";
	objects: readonly PropObject[];
}

/**
 * A global solid-cell grid, for maps that are painted rather than assembled
 * from rectangles. Non-zero means solid. This is the layer a map maker edits
 * with a brush, and it is deliberately the only collision authority in the
 * format — there is no second, invisible hitbox layer.
 */
interface SolidLayer {
	name: string;
	type: "solid";
	width: number;
	height: number;
	data: readonly number[];
}

/**
 * Where fighters enter an authored map. Each point is a fighter's body
 * top-left, exactly like `SpawnPoint`, so the simulation reads the layer
 * verbatim.
 */
interface SpawnsLayer {
	name: string;
	type: "spawns";
	objects: readonly SpawnPoint[];
}

type TilemapLayer = PlatformsLayer | PropsLayer | SolidLayer | SpawnsLayer;

/**
 * The look a map wears. A theme names a platform tileset and a backdrop; it
 * never changes a collider, so the same rectangles play identically in every
 * theme and in the Flat competitive style.
 */
export const MAP_THEMES = ["waterfront", "castle", "meadow", "snow"] as const;
export type MapTheme = (typeof MAP_THEMES)[number];

function isMapTheme(value: unknown): value is MapTheme {
	return (MAP_THEMES as readonly unknown[]).includes(value);
}

/** Who made a map and what it is called. Presentation only. */
interface MapMeta {
	/** The map's slug — `maps/<id>/map.json` in the repo. */
	id: string;
	name: string;
	author?: string;
	description?: string;
}

/**
 * A complete map description.
 *
 * `width`/`height` are in cells. They are optional for an object-only map but
 * a grid layer needs them, and a future editor shows the same bounds.
 */
export interface TilemapSpec {
	format: "golpe-tilemap";
	version: 1;
	tileSize: number;
	/** The tileset id the renderer resolves in its art manifest. */
	tileset: string;
	width: number;
	height: number;
	layers: readonly TilemapLayer[];
	/** Absent means the Waterfront, which is what every map before themes wore. */
	theme?: MapTheme;
	/** Absent on the generated arenas; every authored map carries one. */
	meta?: MapMeta;
}

/** The shipped tileset id. A themed map names its theme's instead. */
const WATERFRONT_TILESET = "waterfront-platforms";

/** The tileset a theme draws its platforms with. */
export function tilesetForTheme(theme: MapTheme): string {
	return `${theme}-platforms`;
}

/** The theme a map wears, defaulting the way the format always has. */
export function themeOf(map: TilemapSpec): MapTheme {
	return map.theme ?? "waterfront";
}

const VINE_MIN_WIDTH = 100;
const VINE_INSET = 6;
const VINE_GAP_FROM_RIGHT = 14;
const VINE_FLOWER_EVERY = 3;
const SOLID = 0;

/**
 * The current arena as the map format.
 *
 * The rectangles are copied, not aliased: a room that learns its authoritative
 * width mutates `world.platforms` in place, and a map captured for one draw
 * must not change under the renderer mid-frame.
 */
export function tilemapFromWorld(world: World): TilemapSpec {
	// An authored map already *is* the format: hand back what was authored
	// (its props, theme and name) rather than re-deriving the classic vines.
	if (world.source) return world.source;
	return {
		format: "golpe-tilemap",
		version: 1,
		tileSize: TILE_SIZE,
		tileset: WATERFRONT_TILESET,
		width: Math.ceil(world.right / TILE_SIZE),
		height: Math.ceil(world.bottom / TILE_SIZE),
		layers: [
			{
				name: "platforms",
				type: "platforms",
				objects: world.platforms.map((p) => ({ ...p })),
			},
			{
				name: "props",
				type: "props",
				objects: propsFromWorld(world),
			},
		],
	};
}

/**
 * The decorations the current arena places.
 *
 * Vines hang under the wide ledges only: one per ledge, alternating sides. They
 * are below the collider, so they dress the space a fighter jumps through
 * without ever suggesting that the vine itself is solid. The ground and the
 * pillars get none — a vine under the floor would be below the world.
 */
function propsFromWorld(world: World): PropObject[] {
	const props: PropObject[] = [];
	let side = 0;
	for (const p of world.platforms) {
		if (p.w < VINE_MIN_WIDTH) continue;
		if (p.y + p.h >= world.bottom) continue;
		const atLeft = side % 2 === 0;
		side++;
		props.push({
			type: side % VINE_FLOWER_EVERY === 0 ? "vineFlower" : "vine",
			x: p.x + (atLeft ? VINE_INSET : p.w - VINE_GAP_FROM_RIGHT),
			y: p.y + p.h,
			flip: !atLeft,
		});
	}
	return props;
}

/**
 * Turn any map layer into the collision rectangles the simulation understands.
 *
 * A `solid` grid is reduced to **maximal rectangles**, not one collider per
 * cell: a floor painted 100 cells wide should be one solid, both because that
 * is what a human drew and because collision against a wall of adjacent cells
 * is a needless pile of seams. The object layer passes through unchanged.
 */
export function solidRectsFromTilemap(map: TilemapSpec): Rect[] {
	const rects: Rect[] = [];
	for (const layer of map.layers) {
		if (layer.type === "platforms") {
			rects.push(...layer.objects.map((p) => ({ ...p })));
			continue;
		}
		if (layer.type !== "solid") continue;
		rects.push(...solidLayerRects(layer, map.tileSize));
	}
	return rects;
}

interface Run {
	x: number;
	w: number;
	y: number;
	h: number;
}

function solidLayerRects(layer: SolidLayer, tileSize: number): Rect[] {
	const { width, height, data } = layer;
	if (data.length !== width * height) {
		throw new Error(
			`solid layer "${layer.name}": expected ${width * height} cells, got ${data.length}`,
		);
	}

	// Rows become horizontal runs first, then runs with the same x and width
	// merge vertically. That gives a floor one collider rather than one per
	// cell, while keeping a ledge and the pillar under it as separate solids.
	const runs: Run[] = [];
	let active = new Map<string, Run>();
	for (let y = 0; y < height; y++) {
		const next = new Map<string, Run>();
		for (let x = 0; x < width; x++) {
			if (data[y * width + x] === SOLID) continue;
			let end = x + 1;
			while (end < width && data[y * width + end] !== SOLID) end++;
			const w = end - x;
			const key = `${x}:${w}`;
			const previous = active.get(key);
			const run =
				previous && previous.y + previous.h === y
					? previous
					: { x, w, y, h: 0 };
			run.h++;
			if (!previous || run !== previous) runs.push(run);
			next.set(key, run);
			x = end - 1;
		}
		active = next;
	}

	return runs.map((run) => ({
		x: run.x * tileSize,
		y: run.y * tileSize,
		w: run.w * tileSize,
		h: run.h * tileSize,
	}));
}

// ---------------------------------------------------------------------------
// Authored maps
//
// A map from the map maker travels from the creator's client to the server in
// the join message, and from the server to every other client in the `match`
// message. It is therefore **untrusted input on the server**: everything below
// parses `unknown`, clamps every number to the arena, caps every list, and
// either returns a map both sides can build the same world from or null.
// ---------------------------------------------------------------------------

/** One map screen in cells: 800px / 8px. */
const SCREEN_CELLS = SCREEN_W / TILE_SIZE;
/** One map screen's height in cells: 600px / 8px. A map is 1–MAX_MAP_ROWS of them. */
export const MAP_HEIGHT_CELLS = WORLD_BOTTOM / TILE_SIZE;
/** Upper bound on a map's rows of screens: a vertical map is at most four screens tall. */
export const MAX_MAP_ROWS = 4;
/**
 * Caps on what a map may carry. Generous for a hand-made map, and small
 * enough that the whole map rides in one reliable message (a map at every cap
 * is under 48KB of JSON — `Tilemap.test.ts` measures it).
 */
export const MAX_MAP_PLATFORMS = 256;
export const MAX_MAP_SPAWNS = 48;
export const MAX_MAP_PROPS = 512;
/** Thinner than a tile is not a surface anybody can see or stand on. */
const MIN_PLATFORM_SIZE = TILE_SIZE;
const MAX_TEXT = 80;
const MAX_DESCRIPTION = 400;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** A spawn sits this far above the surface, like the classic arena's 518 over 568. */
export const SPAWN_CLEARANCE_PX = 2;
/** The floor fallback spawns sit a quarter of the way in from each end. */
const FLOOR_SPAWN_DIVISOR = 4;

/** How many 800px screens wide a map is. */
export function mapScreens(map: TilemapSpec): number {
	return Math.max(
		1,
		Math.min(MAX_SCREENS, Math.round(map.width / SCREEN_CELLS)),
	);
}

/** How many 600px screens tall a map is. */
export function mapRows(map: TilemapSpec): number {
	return Math.max(
		1,
		Math.min(MAX_MAP_ROWS, Math.round(map.height / MAP_HEIGHT_CELLS)),
	);
}

/** The spawns an authored map declares (empty for the generated arenas). */
export function spawnsFromTilemap(map: TilemapSpec): SpawnPoint[] {
	const out: SpawnPoint[] = [];
	for (const layer of map.layers) {
		if (layer.type === "spawns")
			out.push(...layer.objects.map((s) => ({ ...s })));
	}
	return out;
}

/** Every prop of a map, in draw order. */
export function propsFromTilemap(map: TilemapSpec): PropObject[] {
	const out: PropObject[] = [];
	for (const layer of map.layers) {
		if (layer.type === "props")
			out.push(...layer.objects.map((p) => ({ ...p })));
	}
	return out;
}

/**
 * Spawn points for a map that declared none: one on top of every surface a
 * fighter fits on, facing the middle. A map is still playable before its
 * author has placed a single spawn — the editor's checks nag, the game plays.
 */
function autoSpawns(
	platforms: readonly Rect[],
	right: number,
	bottom: number,
): SpawnPoint[] {
	const out: SpawnPoint[] = [];
	for (const p of platforms) {
		if (p.w < PLAYER_WIDTH || p.y - PLAYER_HEIGHT < WORLD_TOP) continue;
		const x = Math.round(p.x + p.w / 2 - PLAYER_WIDTH / 2);
		const y = p.y - PLAYER_HEIGHT - SPAWN_CLEARANCE_PX;
		const box = { x, y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
		if (platforms.some((q) => q !== p && rectsTouch(box, q))) continue;
		out.push({ x, y, facing: x + PLAYER_WIDTH / 2 < right / 2 ? 1 : -1 });
	}
	if (out.length > 0) return out;
	// No top a fighter fits on: the world's floor always holds one. Two points,
	// a quarter in from each end, so even this map is never a spawn-on-spawn.
	// If a solid sits there too, the first tick depenetrates — a bad landing,
	// never an empty spawn list for `pickSpawn` to index.
	const floorY = bottom - PLAYER_HEIGHT - SPAWN_CLEARANCE_PX;
	return [
		{ x: Math.round(right / FLOOR_SPAWN_DIVISOR), y: floorY, facing: 1 },
		{
			x: Math.round(right - right / FLOOR_SPAWN_DIVISOR - PLAYER_WIDTH),
			y: floorY,
			facing: -1,
		},
	];
}

function rectsTouch(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

/**
 * The world an authored map plays in.
 *
 * Deterministic, and shared verbatim by client and server — the same promise
 * `buildWorld` makes. The map keeps a reference to itself in `source` so the
 * renderer draws *its* props and theme rather than the classic vines.
 */
export function worldFromTilemap(map: TilemapSpec): World {
	const screens = mapScreens(map);
	const right = screens * SCREEN_W;
	const bottom = mapRows(map) * WORLD_BOTTOM;
	const platforms = solidRectsFromTilemap(map);
	const declared = spawnsFromTilemap(map);
	return {
		screens,
		left: WORLD_LEFT,
		top: WORLD_TOP,
		right,
		bottom,
		platforms,
		spawnPoints:
			declared.length > 0 ? declared : autoSpawns(platforms, right, bottom),
		source: map,
	};
}

/** Rebuild `target` in place as an authored map — `applyWorld`'s twin. */
export function applyTilemapWorld(target: World, map: TilemapSpec): World {
	const next = worldFromTilemap(map);
	target.screens = next.screens;
	target.left = next.left;
	target.top = next.top;
	target.right = next.right;
	target.bottom = next.bottom;
	target.platforms = next.platforms;
	target.spawnPoints = next.spawnPoints;
	target.source = map;
	return target;
}

/**
 * A short, stable identity for a map's *content*, so a client can tell
 * whether the map the server seated it in is the one it already built.
 * FNV-1a over the canonical JSON: not cryptographic, and it does not need to be.
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX = 16;
const KEY_DIGITS = 8;

export function mapKey(map: TilemapSpec): string {
	const text = JSON.stringify(map);
	let hash = FNV_OFFSET;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return (hash >>> 0).toString(HEX).padStart(KEY_DIGITS, "0");
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

function snap(n: number): number {
	return Math.round(n / TILE_SIZE) * TILE_SIZE;
}

function text(value: unknown, max: number): string | undefined {
	if (typeof value !== "string") return undefined;
	// Control characters are never part of a name; strip them rather than
	// reject the map, so a pasted name with a stray tab still loads.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point.
	const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return clean.length > 0 ? clean.slice(0, max) : undefined;
}

/** An untrusted map object: every field the parser reads, none of them trusted. */
interface RawObject {
	x?: unknown;
	y?: unknown;
	w?: unknown;
	h?: unknown;
	type?: unknown;
	flip?: unknown;
	facing?: unknown;
}

interface RawMap {
	format?: unknown;
	version?: unknown;
	tileSize?: unknown;
	width?: unknown;
	height?: unknown;
	layers?: unknown;
	theme?: unknown;
	meta?: unknown;
}

interface RawLayer {
	type?: unknown;
	objects?: unknown;
}

interface RawMeta {
	id?: unknown;
	name?: unknown;
	author?: unknown;
	description?: unknown;
}

function records(value: unknown, max: number): RawObject[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((v): v is RawObject => typeof v === "object" && v !== null)
		.slice(0, max);
}

/**
 * Parse an untrusted map into one both sides can build the same world from,
 * or null when it is not a map at all.
 *
 * Everything is **repaired rather than rejected** where a repair is obvious —
 * a platform hanging off the edge is clipped, coordinates are snapped to the
 * 8px grid, an over-long list is truncated — because the editor's checks are
 * where an author learns what was wrong. The server's only job is to never
 * build a world that differs from what a client would build from the same
 * bytes, and never one that is unplayable: a map with no surface at all is
 * refused.
 */
export function sanitizeTilemap(raw: unknown): TilemapSpec | null {
	if (typeof raw !== "object" || raw === null) return null;
	const m = raw as RawMap;
	if (m.format !== "golpe-tilemap" || m.version !== 1) return null;
	if (m.tileSize !== TILE_SIZE) return null;

	const widthCells = finite(m.width);
	if (widthCells === null) return null;
	const screens = clamp(Math.round(widthCells / SCREEN_CELLS), 1, MAX_SCREENS);
	const right = screens * SCREEN_W;
	// A map with no `height` is one screen tall, which is every map before
	// vertical maps existed.
	const heightCells = finite(m.height) ?? MAP_HEIGHT_CELLS;
	const rows = clamp(
		Math.round(heightCells / MAP_HEIGHT_CELLS),
		1,
		MAX_MAP_ROWS,
	);
	const bottom = rows * WORLD_BOTTOM;
	const layers = Array.isArray(m.layers) ? m.layers : [];

	const platforms: PlatformObject[] = [];
	const props: PropObject[] = [];
	const spawns: SpawnPoint[] = [];
	for (const layerRaw of layers) {
		if (typeof layerRaw !== "object" || layerRaw === null) continue;
		const layer = layerRaw as RawLayer;
		if (layer.type === "platforms") {
			for (const o of records(layer.objects, MAX_MAP_PLATFORMS)) {
				if (platforms.length >= MAX_MAP_PLATFORMS) break;
				const x = finite(o.x);
				const y = finite(o.y);
				const w = finite(o.w);
				const h = finite(o.h);
				if (x === null || y === null || w === null || h === null) continue;
				const x0 = clamp(snap(x), 0, right);
				const y0 = clamp(snap(y), 0, bottom);
				const x1 = clamp(snap(x + w), 0, right);
				const y1 = clamp(snap(y + h), 0, bottom);
				if (x1 - x0 < MIN_PLATFORM_SIZE || y1 - y0 < MIN_PLATFORM_SIZE)
					continue;
				platforms.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
			}
		} else if (layer.type === "props") {
			for (const o of records(layer.objects, MAX_MAP_PROPS)) {
				if (props.length >= MAX_MAP_PROPS) break;
				const type = text(o.type, MAX_TEXT);
				const x = finite(o.x);
				const y = finite(o.y);
				if (!type || x === null || y === null) continue;
				props.push({
					type,
					x: clamp(Math.round(x), 0, right),
					y: clamp(Math.round(y), 0, bottom),
					...(o.flip === true ? { flip: true } : {}),
				});
			}
		} else if (layer.type === "spawns") {
			for (const o of records(layer.objects, MAX_MAP_SPAWNS)) {
				if (spawns.length >= MAX_MAP_SPAWNS) break;
				const x = finite(o.x);
				const y = finite(o.y);
				if (x === null || y === null) continue;
				spawns.push({
					x: clamp(Math.round(x), 0, right - PLAYER_WIDTH),
					y: clamp(Math.round(y), 0, bottom - PLAYER_HEIGHT),
					facing:
						finite(o.facing) !== null && (o.facing as number) < 0 ? -1 : 1,
				});
			}
		}
		// A `solid` grid is part of the format, but the editor never paints
		// one and nothing on the wire needs it; an authored map is objects.
	}
	if (platforms.length === 0) return null;

	const theme = isMapTheme(m.theme) ? m.theme : "waterfront";
	const metaRaw: RawMeta =
		typeof m.meta === "object" && m.meta !== null ? (m.meta as RawMeta) : {};
	const id =
		typeof metaRaw.id === "string" && SLUG.test(metaRaw.id)
			? metaRaw.id
			: "untitled";
	const author = text(metaRaw.author, MAX_TEXT);
	const description = text(metaRaw.description, MAX_DESCRIPTION);
	return {
		format: "golpe-tilemap",
		version: 1,
		tileSize: TILE_SIZE,
		tileset: tilesetForTheme(theme),
		width: screens * SCREEN_CELLS,
		height: rows * MAP_HEIGHT_CELLS,
		theme,
		meta: {
			id,
			name: text(metaRaw.name, MAX_TEXT) ?? "Untitled map",
			...(author ? { author } : {}),
			...(description ? { description } : {}),
		},
		layers: [
			{ name: "platforms", type: "platforms", objects: platforms },
			{ name: "spawns", type: "spawns", objects: spawns },
			{ name: "props", type: "props", objects: props },
		],
	};
}
