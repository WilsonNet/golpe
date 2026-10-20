/**
 * What the arena's standable surfaces are drawn as.
 *
 * This is deliberately **independent of the skybox**. A player who wants the
 * plain competitive background has not also asked for the platforms to become
 * flat blocks, and a player who likes the city has not asked for every surface
 * to be painted. Both choices live in the same Graphics menu and both apply
 * live.
 *
 * The style is a presentation store, like the bindings and the mixer: it lives
 * in `localStorage`, never on the wire, and the simulation only ever sees the
 * rectangles in `World.platforms`.
 */

import { EventBus } from "../EventBus";

export type TileStyle = "art" | "flat";

const STORAGE_KEY = "golpe:tiles";
const DEFAULT_TILE_STYLE: TileStyle = "art";

let choice: TileStyle | null = null;

function isTileStyle(value: string): value is TileStyle {
	return value === "art" || value === "flat";
}

function storedTileStyle(): TileStyle | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw && isTileStyle(raw) ? raw : null;
	} catch {
		return null;
	}
}

/** `?tiles=art|flat`; otherwise the stored style; otherwise the Waterfront art. */
export function tileStyleChoice(): TileStyle {
	if (choice) return choice;
	const raw =
		typeof window === "undefined"
			? ""
			: (
					new URLSearchParams(window.location.search).get("tiles") ?? ""
				).toLowerCase();
	choice = isTileStyle(raw) ? raw : (storedTileStyle() ?? DEFAULT_TILE_STYLE);
	return choice;
}

function storeTileStyle(value: TileStyle): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// Private mode is still a playable game.
	}
	choice = value;
}

/**
 * Change the style and tell the live match to redraw only the platform layer.
 *
 * The skybox container, camera and simulation are untouched; this is the whole
 * reason `drawPlatforms` exists separately from `drawArena`.
 */
export function applyTileStyle(value: TileStyle): void {
	storeTileStyle(value);
	EventBus.emit("tile-style-changed");
}
