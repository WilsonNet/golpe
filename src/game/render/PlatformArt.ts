/**
 * The platform layer: the Waterfront tileset, or the flat competitive blocks.
 *
 * The map's rectangles come from `tilemapFromWorld`; this module never invents
 * geometry. Art is applied with a **9-slice autotile** — fixed corner and edge
 * tiles around a repeated middle — because these platforms are rectangles. The
 * middle is a `TilingSprite`, so an 8-screen ground is still nine display
 * objects rather than a thousand 8px sprites.
 *
 * The style switch is deliberately its own exported function. `drawArena`
 * rebuilds the whole world (it owns the backdrop too), but a player choosing
 * Art/Flat in the Esc menu must not lose the skybox, camera or fighters.
 */

import { type Container, Sprite, type Texture, TilingSprite } from "pixi.js";
import type { World } from "../simulation/Arena";
import {
	type MapTheme,
	type PlatformObject,
	type PropObject,
	TILE_SIZE,
	themeOf,
	tilemapFromWorld,
} from "../simulation/Tilemap";
import { TEX, tex } from "./assets";
import type { TileStyle } from "./tileStyle";
import {
	propSize,
	propTexture,
	type TileArtState,
	tileArtReady,
	tileArtState,
	tileTexture,
} from "./tilesets";

const TILE = TILE_SIZE;
/** Break the repeated top edge every seven tiles, aligned to the tile grid. */
const TOP_VARIETY_STEP = 7 * TILE;
/** One face detail every six tiles, on a three-row cycle. */
const FILL_VARIETY_STEP = 6 * TILE;
const FILL_VARIETY_ROWS = 3;
/** Underside detail. */
const BOTTOM_VARIETY_STEP = 9 * TILE;

export interface TilemapDebugState {
	style: TileStyle;
	/** The map's theme — which tileset the art style drew with. */
	theme: MapTheme;
	artReady: boolean;
	/** Standable objects in the map. */
	platforms: number;
	/** Prop objects actually drawn. */
	props: number;
	/** Display objects added to the arena container. */
	sprites: number;
	tileset: TileArtState;
}

let last: TilemapDebugState = {
	style: "art",
	theme: "waterfront",
	artReady: false,
	platforms: 0,
	props: 0,
	sprites: 0,
	tileset: tileArtState(),
};
let warnedMissingArt = false;

/** What the last draw did — the probe's evidence, not a screenshot guess. */
export function platformArtDebug(): TilemapDebugState {
	return last;
}

/**
 * Clear and redraw only the arena container.
 *
 * Re-entrant and simulation-free: changing the style calls exactly this, so a
 * live match keeps its tick, camera and every fighter where they were.
 */
export function drawPlatforms(
	arena: Container,
	world: World,
	style: TileStyle,
): TilemapDebugState {
	for (const child of arena.removeChildren()) {
		child.destroy({ children: true });
	}

	const map = tilemapFromWorld(world);
	const theme = themeOf(map);
	const platforms: PlatformObject[] = [];
	const props: PropObject[] = [];
	for (const layer of map.layers) {
		if (layer.type === "platforms") platforms.push(...layer.objects);
		else if (layer.type === "props") props.push(...layer.objects);
	}

	let sprites = 0;
	let drawnProps = 0;
	if (style === "art" && tileArtReady(theme)) {
		for (const platform of platforms) {
			sprites += drawTiledPlatform(arena, theme, platform);
		}
		for (const prop of props) {
			if (drawProp(arena, theme, prop)) {
				sprites++;
				drawnProps++;
			}
		}
	} else {
		if (style === "art" && !warnedMissingArt) {
			warnedMissingArt = true;
			console.warn(
				`[tiles] ${theme} platform art is unavailable — drawing the flat blocks`,
			);
		}
		for (const platform of platforms) {
			sprites += drawFlatPlatform(arena, platform);
		}
	}

	last = {
		style,
		theme,
		artReady: tileArtReady(theme),
		platforms: platforms.length,
		props: drawnProps,
		sprites,
		tileset: tileArtState(theme),
	};
	return last;
}

/** The original monochrome green block, derived from the same rectangle. */
function drawFlatPlatform(arena: Container, p: PlatformObject): number {
	const sprite = new Sprite(tex(TEX.platform));
	sprite.anchor.set(0.5);
	sprite.position.set(p.x + p.w / 2, p.y + p.h / 2);
	sprite.width = p.w;
	sprite.height = p.h;
	arena.addChild(sprite);
	return 1;
}

/**
 * Nine slices: four fixed corners, four edge strips and a repeated middle.
 *
 * `midW`/`midH` may be less than a tile only for a future map's tiny solid;
 * those fall back to one cropped tile rather than producing negative sizes.
 */
function drawTiledPlatform(
	arena: Container,
	theme: MapTheme,
	p: PlatformObject,
): number {
	const midW = p.w - TILE * 2;
	const midH = p.h - TILE * 2;
	if (midW < 0 || midH < 0) {
		const texture = tileTexture(
			theme,
			"fillA",
			Math.max(1, p.w),
			Math.max(1, p.h),
		);
		return place(arena, texture, p.x, p.y, Math.max(1, p.w), Math.max(1, p.h));
	}

	let count = 0;
	count += tileAt(arena, theme, "topLeft", p.x, p.y);
	count += tileAt(arena, theme, "topRight", p.x + p.w - TILE, p.y);
	count += tileAt(
		arena,
		theme,
		"bottomLeft",
		p.x,
		p.y + p.h - TILE,
		"left",
		"bottom",
	);
	count += tileAt(
		arena,
		theme,
		"bottomRight",
		p.x + p.w - TILE,
		p.y + p.h - TILE,
		"right",
		"bottom",
	);

	count += tiled(arena, theme, "topA", p.x + TILE, p.y, midW, TILE);
	count += tiled(arena, theme, "midLeft", p.x, p.y + TILE, TILE, midH);
	count += tiled(arena, theme, "fillA", p.x + TILE, p.y + TILE, midW, midH);
	count += tiled(
		arena,
		theme,
		"midRight",
		p.x + p.w - TILE,
		p.y + TILE,
		TILE,
		midH,
	);
	count += tiled(
		arena,
		theme,
		"bottomA",
		p.x + TILE,
		p.y + p.h - TILE,
		midW,
		TILE,
	);

	// The repeated edges are deliberately broken at tile-aligned intervals.
	// The overlays are full 8px tiles from the same family, so their top lip
	// and mortar lines land on the repeated tile's grid rather than across it.
	count += topVariety(arena, theme, p, midW);
	count += fillVariety(arena, theme, p, midW, midH);
	count += bottomVariety(arena, theme, p, midW);
	return count;
}

function topVariety(
	arena: Container,
	theme: MapTheme,
	p: PlatformObject,
	midW: number,
): number {
	let count = 0;
	let index = 0;
	for (let dx = TOP_VARIETY_STEP; dx + TILE <= midW; dx += TOP_VARIETY_STEP) {
		const name = index % 3 === 0 ? "topB" : "topMoss";
		count += tileAt(arena, theme, name, p.x + TILE + dx, p.y);
		index++;
	}
	return count;
}

function fillVariety(
	arena: Container,
	theme: MapTheme,
	p: PlatformObject,
	midW: number,
	midH: number,
): number {
	if (midH < TILE) return 0;
	const rows = Math.max(1, Math.floor(midH / TILE));
	let count = 0;
	let index = 0;
	for (let dx = 2 * TILE; dx + TILE <= midW; dx += FILL_VARIETY_STEP) {
		const row = index % Math.min(FILL_VARIETY_ROWS, rows);
		const name =
			index % 4 === 0
				? "fillMoss"
				: index % 3 === 0
					? "fillCrack"
					: index % 2 === 0
						? "fillB"
						: "fillC";
		count += tileAt(
			arena,
			theme,
			name,
			p.x + TILE + dx,
			p.y + TILE + row * TILE,
		);
		index++;
	}
	return count;
}

function bottomVariety(
	arena: Container,
	theme: MapTheme,
	p: PlatformObject,
	midW: number,
): number {
	let count = 0;
	let index = 0;
	for (
		let dx = BOTTOM_VARIETY_STEP;
		dx + TILE <= midW;
		dx += BOTTOM_VARIETY_STEP
	) {
		const name = index % 2 === 0 ? "bottomMoss" : "bottomB";
		count += tileAt(
			arena,
			theme,
			name,
			p.x + TILE + dx,
			p.y + p.h - TILE,
			"left",
			"bottom",
		);
		index++;
	}
	return count;
}

function tileAt(
	arena: Container,
	theme: MapTheme,
	name: string,
	x: number,
	y: number,
	alignX: "left" | "right" = "left",
	alignY: "top" | "bottom" = "top",
): number {
	const texture = tileTexture(theme, name, TILE, TILE, alignX, alignY);
	return place(arena, texture, x, y, TILE, TILE);
}

function tiled(
	arena: Container,
	theme: MapTheme,
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
): number {
	if (width <= 0 || height <= 0) return 0;
	const texture = tileTexture(theme, name, TILE, TILE);
	if (!texture) return 0;
	const sprite = new TilingSprite({ texture, width, height });
	sprite.position.set(x, y);
	arena.addChild(sprite);
	return 1;
}

function place(
	arena: Container,
	texture: Texture | null,
	x: number,
	y: number,
	width: number,
	height: number,
): number {
	if (!texture) return 0;
	const sprite = new Sprite(texture);
	sprite.position.set(x, y);
	sprite.width = width;
	sprite.height = height;
	arena.addChild(sprite);
	return 1;
}

function drawProp(
	arena: Container,
	theme: MapTheme,
	prop: PropObject,
): boolean {
	const texture = propTexture(theme, prop.type);
	const size = propSize(theme, prop.type);
	if (!texture || !size) return false;
	const sprite = new Sprite(texture);
	sprite.y = prop.y;
	if (prop.flip) {
		sprite.scale.x = -1;
		sprite.x = prop.x + size.w;
	} else {
		sprite.x = prop.x;
	}
	arena.addChild(sprite);
	return true;
}
