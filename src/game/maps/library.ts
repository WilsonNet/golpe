/**
 * Where an authored map comes from, on the client.
 *
 * Two sources and one parser:
 *
 * - **The library** — `maps/<id>/map.json` at the repository root. Every map a
 *   player contributed through the map maker's pull request lands there, and
 *   Vite bundles the whole folder at build time, so a merged map is in the
 *   next deploy's menu without a line of code.
 * - **The play-test slot** — `?map=draft`, the map the editor is testing right
 *   now, handed over through `localStorage` (the editor and the game it embeds
 *   share an origin).
 *
 * Both are run through `sanitizeTilemap`, the same function the server uses,
 * so a map the menu offers is a map the server will accept.
 */

import { sanitizeTilemap, type TilemapSpec } from "../simulation/Tilemap";

const SPECS = import.meta.glob<unknown>("/maps/*/map.json", {
	eager: true,
	import: "default",
});
const THUMBNAILS = import.meta.glob<string>("/maps/*/screenshot-1.png", {
	eager: true,
	query: "?url",
	import: "default",
});

/** A map in the repository's library. */
export interface LibraryMap {
	id: string;
	spec: TilemapSpec;
	/** The PR's first screenshot, which doubles as the menu card. */
	thumbnail: string | null;
}

/** `/maps/<id>/map.json` → `<id>`. */
function folderOf(path: string): string {
	return path.split("/").at(-2) ?? "";
}

/** Every library map, by name. A file that does not parse is left out. */
export const LIBRARY: readonly LibraryMap[] = Object.entries(SPECS)
	.flatMap(([path, raw]) => {
		const id = folderOf(path);
		const spec = sanitizeTilemap(raw);
		if (!spec) {
			console.warn(`[maps] ${path} is not a readable map`);
			return [];
		}
		const thumb = THUMBNAILS[`/maps/${id}/screenshot-1.png`] ?? null;
		// The folder is the id; the file's own `meta.id` is advisory.
		return [
			{
				id,
				spec: { ...spec, meta: { ...spec.meta, id } } as TilemapSpec,
				thumbnail: thumb,
			},
		];
	})
	.sort((a, b) =>
		(a.spec.meta?.name ?? a.id).localeCompare(b.spec.meta?.name ?? b.id),
	);

/** `?map=draft` — the editor's play-test slot. */
export const PLAYTEST_MAP_ID = "draft";
const PLAYTEST_KEY = "golpe:mapmaker:playtest";

/** Hand a map to the game the editor is about to boot. */
export function storePlaytestMap(map: TilemapSpec): void {
	try {
		window.localStorage.setItem(PLAYTEST_KEY, JSON.stringify(map));
	} catch {
		// A private window still edits; it just cannot play-test across reloads.
	}
}

function readPlaytestMap(): TilemapSpec | null {
	try {
		const raw = window.localStorage.getItem(PLAYTEST_KEY);
		return raw ? sanitizeTilemap(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

/**
 * The spec a `?map=` id names, or null when it names nothing playable. A
 * null is not an error the player sees: the room simply plays the classic
 * arena, exactly like a typo in any other launch key.
 */
export function resolveMap(id: string | null): TilemapSpec | null {
	if (id === null) return null;
	if (id === PLAYTEST_MAP_ID) return readPlaytestMap();
	return LIBRARY.find((m) => m.id === id)?.spec ?? null;
}
