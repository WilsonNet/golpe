/**
 * Which room this client is in, and keeping the address bar shareable.
 *
 * Rooms are addressed by id, not matchmade: `?room=<uuid>` puts you in that room,
 * and no `?room=` at all makes a new one. That is the whole of matchmaking — **to
 * play together, share the link** — which is why the id has to end up in the
 * address bar. A player who cannot copy their own URL cannot invite anybody.
 *
 * The client *proposes* an id and the server decides. They almost always agree;
 * when they do not (a malformed id, which the server replaces), the address bar
 * is rewritten from what came back rather than from what was asked for.
 */

const PARAM = "room";

/** Same charset the server validates against, so a proposal is rarely rejected. */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A v4-shaped id, without assuming a secure context.
 *
 * `crypto.randomUUID` is unavailable on a plain-HTTP origin — which is exactly
 * how this gets served to a room full of people on a LAN, so reaching for it
 * alone would leave every guest on `http://192.168.x.x:8080` unable to start a
 * match. `getRandomValues` has no such restriction.
 */
export function newRoomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		try {
			return crypto.randomUUID();
		} catch {
			// Non-secure context. Fall through.
		}
	}

	const bytes = new Uint8Array(16);
	if (typeof crypto !== "undefined" && crypto.getRandomValues) {
		crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	// Version 4, variant 1 — cosmetic here, but a well-formed uuid is easier to
	// recognise in a URL as "the bit you share".
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join("-");
}

/** The room id in the URL, or a fresh one if there is none worth using. */
export function requestedRoomId(): string {
	const raw = new URLSearchParams(window.location.search).get(PARAM);
	return raw !== null && ROOM_ID_RE.test(raw) ? raw : newRoomId();
}

/**
 * Put `id` in the address bar without reloading.
 *
 * `replaceState`, not `pushState`: this is the same page, and a back button that
 * walked out of the match a player is in would be a bug rather than history.
 */
export function showRoomInUrl(id: string) {
	const url = new URL(window.location.href);
	if (url.searchParams.get(PARAM) === id) return;
	url.searchParams.set(PARAM, id);
	window.history.replaceState(null, "", url.toString());
}

/** The link to send someone so they land in this room. */
export function roomLink(id: string): string {
	const url = new URL(window.location.href);
	url.searchParams.set(PARAM, id);
	return url.toString();
}
