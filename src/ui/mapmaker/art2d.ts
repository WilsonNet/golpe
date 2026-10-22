/**
 * The map maker's canvas art: the game's own tilesets, drawn with Canvas 2D.
 *
 * The editor is WYSIWYG on purpose — a player choosing a theme should see the
 * castle's flagstones, not grey boxes — but it is not a match, and it does not
 * boot Pixi. This module reads the same `<theme>-platforms.json` manifests the
 * game reads and draws the same 9-slice `PlatformArt` draws (corners, edges, a
 * repeated middle, the same variety overlays at the same tile intervals), so a
 * platform here and a platform in the play-test look like one platform.
 *
 * A platform's art depends only on its theme and size, so each one is drawn
 * once into an offscreen canvas and blitted every frame after that.
 */

import type { MapTheme } from "../../game/simulation/Tilemap";

type Frame = [number, number, number, number];

interface Manifest {
	image: string;
	version?: string;
	tiles: Record<string, Frame>;
	props: { image: string; version?: string; frames: Record<string, Frame> };
}

interface Art {
	manifest: Manifest;
	atlas: HTMLImageElement;
	props: HTMLImageElement;
}

const TILE = 8;
const TOP_VARIETY_STEP = 7 * TILE;
const FILL_VARIETY_STEP = 6 * TILE;
const FILL_VARIETY_ROWS = 3;
const BOTTOM_VARIETY_STEP = 9 * TILE;

const loaded = new Map<MapTheme, Art>();
const pending = new Map<MapTheme, Promise<Art | null>>();
const platformCache = new Map<string, HTMLCanvasElement>();

function image(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`map maker: could not load ${src}`));
		img.src = src;
	});
}

function versioned(src: string, version?: string): string {
	return version ? `${src}?v=${version}` : src;
}

/** Load one theme's art; resolves null (flat fallback) if it is missing. */
export function loadArt(theme: MapTheme): Promise<Art | null> {
	const ready = loaded.get(theme);
	if (ready) return Promise.resolve(ready);
	const inflight = pending.get(theme);
	if (inflight) return inflight;
	const p = (async () => {
		try {
			const res = await fetch(`assets/tilesets/${theme}-platforms.json`, {
				cache: "no-cache",
			});
			const manifest = (await res.json()) as Manifest;
			const [atlas, props] = await Promise.all([
				image(versioned(manifest.image, manifest.version)),
				image(versioned(manifest.props.image, manifest.props.version)),
			]);
			const art = { manifest, atlas, props };
			loaded.set(theme, art);
			return art;
		} catch (err) {
			console.warn(String(err));
			return null;
		}
	})();
	pending.set(theme, p);
	return p;
}

export function artReady(theme: MapTheme): boolean {
	return loaded.has(theme);
}

function tile(
	ctx: CanvasRenderingContext2D,
	art: Art,
	name: string,
	x: number,
	y: number,
	w = TILE,
	h = TILE,
	alignX: "left" | "right" = "left",
	alignY: "top" | "bottom" = "top",
) {
	const f = art.manifest.tiles[name];
	if (!f || w <= 0 || h <= 0) return;
	const cw = Math.min(w, f[2]);
	const ch = Math.min(h, f[3]);
	const sx = f[0] + (alignX === "right" ? f[2] - cw : 0);
	const sy = f[1] + (alignY === "bottom" ? f[3] - ch : 0);
	ctx.drawImage(art.atlas, sx, sy, cw, ch, x, y, cw, ch);
}

/** A tile repeated over an area, cropped at its far edges — a TilingSprite. */
function tiled(
	ctx: CanvasRenderingContext2D,
	art: Art,
	name: string,
	x: number,
	y: number,
	w: number,
	h: number,
) {
	for (let ty = 0; ty < h; ty += TILE) {
		for (let tx = 0; tx < w; tx += TILE) {
			tile(
				ctx,
				art,
				name,
				x + tx,
				y + ty,
				Math.min(TILE, w - tx),
				Math.min(TILE, h - ty),
			);
		}
	}
}

function drawNineSlice(
	ctx: CanvasRenderingContext2D,
	art: Art,
	w: number,
	h: number,
) {
	const midW = w - TILE * 2;
	const midH = h - TILE * 2;
	if (midW < 0 || midH < 0) {
		tiled(ctx, art, "fillA", 0, 0, w, h);
		return;
	}
	tile(ctx, art, "topLeft", 0, 0);
	tile(ctx, art, "topRight", w - TILE, 0);
	tile(ctx, art, "bottomLeft", 0, h - TILE, TILE, TILE, "left", "bottom");
	tile(
		ctx,
		art,
		"bottomRight",
		w - TILE,
		h - TILE,
		TILE,
		TILE,
		"right",
		"bottom",
	);
	tiled(ctx, art, "topA", TILE, 0, midW, TILE);
	tiled(ctx, art, "midLeft", 0, TILE, TILE, midH);
	tiled(ctx, art, "fillA", TILE, TILE, midW, midH);
	tiled(ctx, art, "midRight", w - TILE, TILE, TILE, midH);
	tiled(ctx, art, "bottomA", TILE, h - TILE, midW, TILE);

	// The same variety `PlatformArt` lays over the repeat, at the same steps.
	let i = 0;
	for (let dx = TOP_VARIETY_STEP; dx + TILE <= midW; dx += TOP_VARIETY_STEP) {
		tile(ctx, art, i % 3 === 0 ? "topB" : "topMoss", TILE + dx, 0);
		i++;
	}
	if (midH >= TILE) {
		const rows = Math.max(1, Math.floor(midH / TILE));
		i = 0;
		for (let dx = 2 * TILE; dx + TILE <= midW; dx += FILL_VARIETY_STEP) {
			const row = i % Math.min(FILL_VARIETY_ROWS, rows);
			const name =
				i % 4 === 0
					? "fillMoss"
					: i % 3 === 0
						? "fillCrack"
						: i % 2 === 0
							? "fillB"
							: "fillC";
			tile(ctx, art, name, TILE + dx, TILE + row * TILE);
			i++;
		}
	}
	i = 0;
	for (
		let dx = BOTTOM_VARIETY_STEP;
		dx + TILE <= midW;
		dx += BOTTOM_VARIETY_STEP
	) {
		tile(
			ctx,
			art,
			i % 2 === 0 ? "bottomMoss" : "bottomB",
			TILE + dx,
			h - TILE,
			TILE,
			TILE,
			"left",
			"bottom",
		);
		i++;
	}
}

/** A platform's art as a canvas of exactly its size, or null until the theme loads. */
export function platformArt(
	theme: MapTheme,
	w: number,
	h: number,
): HTMLCanvasElement | null {
	const art = loaded.get(theme);
	if (!art) return null;
	const key = `${theme}:${w}x${h}`;
	const cached = platformCache.get(key);
	if (cached) return cached;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, w);
	canvas.height = Math.max(1, h);
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.imageSmoothingEnabled = false;
	drawNineSlice(ctx, art, w, h);
	// Bounded: a long session of resizing would otherwise keep every size ever drawn.
	if (platformCache.size > 600) platformCache.clear();
	platformCache.set(key, canvas);
	return canvas;
}

/** Draw a prop frame at a world position (top-left), mirrored if asked. */
export function drawPropArt(
	ctx: CanvasRenderingContext2D,
	theme: MapTheme,
	type: string,
	x: number,
	y: number,
	flip = false,
): boolean {
	const art = loaded.get(theme);
	const f = art?.manifest.props.frames[type];
	if (!art || !f) return false;
	if (flip) {
		ctx.save();
		ctx.translate(x + f[2], y);
		ctx.scale(-1, 1);
		ctx.drawImage(art.props, f[0], f[1], f[2], f[3], 0, 0, f[2], f[3]);
		ctx.restore();
	} else {
		ctx.drawImage(art.props, f[0], f[1], f[2], f[3], x, y, f[2], f[3]);
	}
	return true;
}

export function cssColor(n: number, alpha = 1): string {
	const r = (n >> 16) & 0xff;
	const g = (n >> 8) & 0xff;
	const b = n & 0xff;
	return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}
