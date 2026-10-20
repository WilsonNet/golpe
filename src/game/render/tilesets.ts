/**
 * The platform tileset's runtime assets.
 *
 * The atlas is loaded once, beside the hero sheets. A tile is addressed by the
 * **name** in `waterfront-platforms.json`, never by a numeric index, so the art
 * can be re-cut, padded or re-ordered without changing a renderer line. The
 * JSON's `version` is the PNG's content hash and is appended to the image URL:
 * a cached atlas paired with a new JSON crops every tile at the wrong rect, the
 * same trap the packed hero sheets hit.
 */

import { Assets, Rectangle, Texture } from "pixi.js";

const TILESET_JSON = "assets/tilesets/waterfront-platforms.json";
const TILESET_ALIAS = "tileset:waterfront:platforms";
const PROPS_ALIAS = "tileset:waterfront:props";

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

let manifest: TilesetManifest | null = null;
let atlas: Texture | null = null;
let props: Texture | null = null;
let loadPromise: Promise<void> | null = null;
const frames = new Map<string, Texture>();

/** Load the JSON, then both atlases. Safe to call on every boot. */
export function loadTileArt(): Promise<void> {
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		const res = await fetch(TILESET_JSON, { cache: "no-cache" });
		if (!res.ok) {
			throw new Error(
				`platform tileset: missing ${TILESET_JSON} (${res.status})`,
			);
		}
		const def = (await res.json()) as TilesetManifest;
		if (!def.tiles || Object.keys(def.tiles).length === 0) {
			throw new Error("platform tileset: manifest has no tiles");
		}
		const [atlasTexture, propsTexture] = await Promise.all([
			Assets.load<Texture>({
				alias: TILESET_ALIAS,
				src: withVersion(def.image, def.version),
				parser: "texture",
			}),
			Assets.load<Texture>({
				alias: PROPS_ALIAS,
				src: withVersion(def.props.image, def.props.version),
				parser: "texture",
			}),
		]);
		atlasTexture.source.scaleMode = "nearest";
		propsTexture.source.scaleMode = "nearest";
		manifest = def;
		atlas = atlasTexture;
		props = propsTexture;
	})();
	return loadPromise;
}

function withVersion(src: string, version?: string): string {
	return version ? `${src}?v=${version}` : src;
}

/** True only when both atlases and their manifest are ready to draw. */
export function tileArtReady(): boolean {
	return manifest !== null && atlas !== null && props !== null;
}

/**
 * One tile, optionally cropped to the last partial cell of a platform.
 *
 * The crop is taken from the **outer** edge when the caller asks for it: a
 * 2px-wide piece of the right cap must show the cap's right outline, not its
 * left mortar line. A full tile is returned unchanged.
 */
export function tileTexture(
	name: string,
	width?: number,
	height?: number,
	alignX: "left" | "right" = "left",
	alignY: "top" | "bottom" = "top",
): Texture | null {
	if (!manifest || !atlas) return null;
	const frame = manifest.tiles[name];
	if (!frame) return null;
	const [fx, fy, fw, fh] = frame;
	const w = Math.max(1, Math.min(width ?? fw, fw));
	const h = Math.max(1, Math.min(height ?? fh, fh));
	const x = fx + (alignX === "right" ? fw - w : 0);
	const y = fy + (alignY === "bottom" ? fh - h : 0);
	if (w === fw && h === fh) return tileCache(name, atlas, fx, fy, fw, fh);
	return tileCache(`${name}@${w}x${h}:${alignX}:${alignY}`, atlas, x, y, w, h);
}

/** One named prop frame, full size. Props are placed by the prop layer. */
export function propTexture(name: string): Texture | null {
	if (!manifest || !props) return null;
	const frame = manifest.props.frames[name];
	if (!frame) return null;
	const [x, y, w, h] = frame;
	return tileCache(`prop:${name}`, props, x, y, w, h);
}

/** The frame size of a prop, for flipping around its own axis. */
export function propSize(name: string): { w: number; h: number } | null {
	const frame = manifest?.props.frames[name];
	return frame ? { w: frame[2], h: frame[3] } : null;
}

export function tileArtState(): TileArtState {
	return {
		loaded: tileArtReady(),
		name: manifest?.name ?? "",
		tiles: manifest ? Object.keys(manifest.tiles).length : 0,
		props: manifest ? Object.keys(manifest.props.frames).length : 0,
		tileWidth: manifest?.tileWidth ?? 0,
		tileHeight: manifest?.tileHeight ?? 0,
	};
}

function tileCache(
	key: string,
	source: Texture,
	x: number,
	y: number,
	w: number,
	h: number,
): Texture {
	const made = frames.get(key);
	if (made) return made;
	const texture = new Texture({
		source: source.source,
		frame: new Rectangle(x, y, w, h),
	});
	texture.source.scaleMode = "nearest";
	frames.set(key, texture);
	return texture;
}
