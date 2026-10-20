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

import type { Rect, World } from "./Arena.js";

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

type TilemapLayer = PlatformsLayer | PropsLayer | SolidLayer;

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
}

/** The shipped tileset id. A future map may name a different one. */
const WATERFRONT_TILESET = "waterfront-platforms";

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
