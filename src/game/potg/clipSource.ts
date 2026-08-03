/**
 * Fetching the Play of the Game footage.
 *
 * The clip is a plain `GET` against the game server's own HTTP port — the same
 * port the WebRTC signalling and the menu's health check already use, so no new
 * address, no new origin, and nothing to configure. It is not on the game
 * channel because it is hundreds of kilobytes; see `types.ts`.
 *
 * **Every failure returns null and none of them are fatal.** The ceremony is
 * driven by the announcement datagram, which has already arrived by the time
 * this is called: a clip that 404s, times out or comes back malformed costs the
 * replay and leaves the splash card exactly as it was. That is the whole reason
 * the two are separate messages.
 */

import { GAME_SERVER_PORT } from "../online/types";
import { POTG_CLIP_VERSION, type PotgClip } from "./types";

/** Give up rather than hold the ceremony open on a server that is not answering. */
const FETCH_TIMEOUT_MS = 4000;

function potgClipUrl(roomId: string): string {
	return `${location.protocol}//${location.hostname}:${GAME_SERVER_PORT}/potg/${encodeURIComponent(roomId)}`;
}

export async function fetchPotgClip(roomId: string): Promise<PotgClip | null> {
	if (!roomId) return null;
	const abort = new AbortController();
	const timer = window.setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(potgClipUrl(roomId), { signal: abort.signal });
		if (!res.ok) return null;
		const clip = (await res.json()) as PotgClip;
		// A version check rather than trust: a client left open across a server
		// restart can be a build behind, and a frame whose fields have moved would
		// draw sixteen fighters at the origin rather than fail.
		if (clip?.version !== POTG_CLIP_VERSION) return null;
		if (!Array.isArray(clip.frames) || clip.frames.length === 0) return null;
		return clip;
	} catch {
		return null;
	} finally {
		window.clearTimeout(timer);
	}
}
