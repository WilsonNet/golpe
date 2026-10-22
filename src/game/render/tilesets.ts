/**
 * The platform tilesets' runtime assets — one per map theme.
 *
 * Every theme's atlas is loaded once, beside the hero sheets: they are a few
 * hundred bytes each, and a map that changes theme mid-session (the editor's
 * play-test, a room seated on an authored map) must not wait on a fetch to
 * draw its floor. A tile is addressed by the **name** in
 * `<theme>-platforms.json`, never by a numeric index, so the art can be re-cut,
 * padded or re-ordered without changing a renderer line. Every theme carries
 * the same names (`scripts/tilesets/themes.py` recolours the Waterfront's maps),
 * so the 9-slice in `PlatformArt` never asks which theme it is drawing.
 *
 * The JSON's `version` is the PNG's content hash and is appended to the image
 * URL: a cached atlas paired with a new JSON crops every tile at the wrong
 * rect, the same trap the packed hero sheets hit.
 */

import { Assets, Rectangle, Texture } from "pixi.js";
import { MAP_THEMES, type MapTheme } from "../simulation/Tilemap";

type FrameTuple = [x: number, y: number, w: number, h: number];

interface TilesetManifest {
	name: string;
	image: string;
	version?: string;
	tileWidth: number;
	tileHeight: number;
	tiles: Record<string, FrameTuple>;
	props: {
		image: string;
		version?: string;
		frames: Record<string, FrameTuple>;
	};
}

export interface TileArtState {
	loaded: boolean;
	name: string;
	tiles: number;
	props: number;
	tileWidth: number;
	tileHeight: number;
}

interface LoadedTileset {
	manifest: TilesetManifest;
	atlas: Texture;
	props: Texture;
	frames: Map<string, Texture>;
}

const loaded = new Map<MapTheme, LoadedTileset>();
let loadPromise: Promise<void> | null = null;

function manifestUrl(theme: MapTheme): string {
	return `assets/tilesets/${theme}-platforms.json`;
}

async function loadTheme(theme: MapTheme): Promise<void> {
	const url = manifestUrl(theme);
	const res = await fetch(url, { cache: "no-cache" });
	if (!res.ok) {
		throw new Error(`platform tileset: missing ${url} (${res.status})`);
	}
	const def = (await res.json()) as TilesetManifest;
	if (!def.tiles || Object.keys(def.tiles).length === 0) {
		throw new Error(`platform tileset: ${url} has no tiles`);
	}
	const [atlas, props] = await Promise.all([
		Assets.load<Texture>({
			alias: `tileset:${theme}:platforms`,
			src: withVersion(def.image, def.version),
			parser: "texture",
		}),
		Assets.load<Texture>({
			alias: `tileset:${theme}:props`,
			src: withVersion(def.props.image, def.props.version),
			parser: "texture",
		}),
	]);
	atlas.source.scaleMode = "nearest";
	props.source.scaleMode = "nearest";
	loaded.set(theme, { manifest: def, atlas, props, frames: new Map() });
}

/**
 * Load every theme's JSON and atlases. Safe to call on every boot. A theme
 * that fails to load is reported and skipped: its maps fall back to the flat
 * blocks, exactly as a missing Waterfront always did.
 */
export function loadTileArt(): Promise<void> {
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		const results = await Promise.allSettled(MAP_THEMES.map(loadTheme));
		const failed = results.flatMap((r) =>
			r.status === "rejected" ? [String(r.reason)] : [],
		);
		if (failed.length === MAP_THEMES.length) throw new Error(failed.join("; "));
		for (const reason of failed) console.warn(`[tiles] ${reason}`);
	})();
	return loadPromise;
}

function withVersion(src: string, version?: string): string {
	return version ? `${src}?v=${version}` : src;
}

/** True only when the theme's atlases and manifest are ready to draw. */
export function tileArtReady(theme: MapTheme = "waterfront"): boolean {
	return loaded.has(theme);
}

/**
 * One tile, optionally cropped to the last partial cell of a platform.
 *
 * The crop is taken from the **outer** edge when the caller asks for it: a
 * 2px-wide piece of the right cap must show the cap's right outline, not its
 * left mortar line. A full tile is returned unchanged.
 */
export function tileTexture(
	theme: MapTheme,
	name: string,
	width?: number,
	height?: number,
	alignX: "left" | "right" = "left",
	alignY: "top" | "bottom" = "top",
): Texture | null {
	const set = loaded.get(theme);
	const frame = set?.manifest.tiles[name];
	if (!set || !frame) return null;
	const [fx, fy, fw, fh] = frame;
	const w = Math.max(1, Math.min(width ?? fw, fw));
	const h = Math.max(1, Math.min(height ?? fh, fh));
	const x = fx + (alignX === "right" ? fw - w : 0);
	const y = fy + (alignY === "bottom" ? fh - h : 0);
	if (w === fw && h === fh)
		return tileCache(set, name, set.atlas, fx, fy, fw, fh);
	return tileCache(
		set,
		`${name}@${w}x${h}:${alignX}:${alignY}`,
		set.atlas,
		x,
		y,
		w,
		h,
	);
}

/** One named prop frame, full size. Props are placed by the prop layer. */
export function propTexture(theme: MapTheme, name: string): Texture | null {
	const set = loaded.get(theme);
	const frame = set?.manifest.props.frames[name];
	if (!set || !frame) return null;
	const [x, y, w, h] = frame;
	return tileCache(set, `prop:${name}`, set.props, x, y, w, h);
}

/** The frame size of a prop, for flipping around its own axis. */
export function propSize(
	theme: MapTheme,
	name: string,
): { w: number; h: number } | null {
	const frame = loaded.get(theme)?.manifest.props.frames[name];
	return frame ? { w: frame[2], h: frame[3] } : null;
}

export function tileArtState(theme: MapTheme = "waterfront"): TileArtState {
	const manifest = loaded.get(theme)?.manifest;
	return {
		loaded: tileArtReady(theme),
		name: manifest?.name ?? "",
		tiles: manifest ? Object.keys(manifest.tiles).length : 0,
		props: manifest ? Object.keys(manifest.props.frames).length : 0,
		tileWidth: manifest?.tileWidth ?? 0,
		tileHeight: manifest?.tileHeight ?? 0,
	};
}

function tileCache(
	set: LoadedTileset,
	key: string,
	source: Texture,
	x: number,
	y: number,
	w: number,
	h: number,
): Texture {
	const made = set.frames.get(key);
	if (made) return made;
	const texture = new Texture({
		source: source.source,
		frame: new Rectangle(x, y, w, h),
	});
	texture.source.scaleMode = "nearest";
	set.frames.set(key, texture);
	return texture;
}
