/**
 * Where the map maker keeps things between visits.
 *
 * - **Maps** live in `localStorage` as JSON — small, synchronous, and the same
 *   store the rest of the game's per-player settings use.
 * - **Captured media** (the play-test video, the screenshots) are blobs of a
 *   few megabytes, which `localStorage` cannot hold, so they live in IndexedDB
 *   keyed by the map's local id. A player who records a clip, closes the tab
 *   and comes back tomorrow to publish still has it.
 *
 * Every access is wrapped: a private window, a full quota or a blocked store
 * costs persistence, never the editor.
 */

import { sanitizeTilemap } from "../../game/simulation/Tilemap";
import { type EditorMap, fromSpec } from "./model";

const MAPS_KEY = "golpe:mapmaker:maps";
const CURRENT_KEY = "golpe:mapmaker:current";

export function loadMaps(): EditorMap[] {
	try {
		const raw = window.localStorage.getItem(MAPS_KEY);
		const list = raw ? (JSON.parse(raw) as EditorMap[]) : [];
		return Array.isArray(list)
			? list.filter((m) => m && typeof m.localId === "string")
			: [];
	} catch {
		return [];
	}
}

function writeMaps(list: EditorMap[]): void {
	try {
		window.localStorage.setItem(MAPS_KEY, JSON.stringify(list));
	} catch {
		// Quota or a blocked store: the editor keeps working on the open map.
	}
}

export function saveMap(map: EditorMap): void {
	const list = loadMaps().filter((m) => m.localId !== map.localId);
	writeMaps([map, ...list]);
	try {
		window.localStorage.setItem(CURRENT_KEY, map.localId);
	} catch {
		// See writeMaps.
	}
}

export function deleteMap(localId: string): void {
	writeMaps(loadMaps().filter((m) => m.localId !== localId));
	void clearMedia(localId);
}

/** The map that was open last, so a reload lands where the player left off. */
export function currentMap(): EditorMap | null {
	try {
		const id = window.localStorage.getItem(CURRENT_KEY);
		return loadMaps().find((m) => m.localId === id) ?? loadMaps()[0] ?? null;
	} catch {
		return null;
	}
}

/** Read a `.json` map file a player dropped or picked. */
export function importMapFile(text: string): EditorMap | null {
	try {
		const spec = sanitizeTilemap(JSON.parse(text));
		return spec ? fromSpec(spec) : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Media (IndexedDB)
// ---------------------------------------------------------------------------

type MediaKind = "overview" | "shot" | "video";

export interface MediaItem {
	id: string;
	mapId: string;
	kind: MediaKind;
	blob: Blob;
	/** For a video: its length. For a shot: when in the session it was taken. */
	seconds: number;
	createdAt: number;
	/** Picked for the pull request. */
	selected: boolean;
}

const DB_NAME = "golpe-mapmaker";
const STORE = "media";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const store = req.result.createObjectStore(STORE, { keyPath: "id" });
			store.createIndex("mapId", "mapId");
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function tx<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const t = db.transaction(STORE, mode);
		const req = run(t.objectStore(STORE));
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
		t.oncomplete = () => db.close();
	});
}

export async function listMedia(mapId: string): Promise<MediaItem[]> {
	try {
		const items = await tx<MediaItem[]>("readonly", (s) =>
			s.index("mapId").getAll(IDBKeyRange.only(mapId)),
		);
		return items.sort((a, b) => a.createdAt - b.createdAt);
	} catch {
		return [];
	}
}

export async function putMedia(item: MediaItem): Promise<void> {
	try {
		await tx("readwrite", (s) => s.put(item));
	} catch {
		// Quota: the clip is lost on reload, but it is still in this session.
	}
}

export async function removeMedia(id: string): Promise<void> {
	try {
		await tx("readwrite", (s) => s.delete(id));
	} catch {
		// Nothing to undo.
	}
}

async function clearMedia(mapId: string): Promise<void> {
	for (const item of await listMedia(mapId)) await removeMedia(item.id);
}
