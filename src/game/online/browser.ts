/**
 * The server browser's pure half: what a row is, where it came from, and how
 * the list is ordered.
 *
 * Kept out of the React component so the two rules that matter can be tested
 * without a DOM:
 *
 * - **LAN is a group, not a sort value.** Every LAN row is above every internet
 *   row, and the player's chosen sort runs inside each group.
 * - **The build gate is a LAN rule.** A LAN row from another build is offered
 *   as a link to the host's own page (same build by construction), never as a
 *   `?server=` join that would land a different client on a deterministic
 *   server.
 */

import type { MatchMode } from "../simulation/Teams";
import { BUILD_ID } from "./build";
import { isPrivateHost, type LanRoomEntry } from "./lan";
import { buildMatches, PROTOCOL_VERSION } from "./protocol";
import { parseServerEndpoint } from "./regions";
import { GAME_SERVER_PORT } from "./types";

type RoomSource = "lan" | "internet";
export type BrowserSortKey = "ping" | "players" | "mode";
export type BrowserSortDir = "asc" | "desc";

/** One row, as it reaches the browser after `/rooms` or `/lan/rooms`. */
export interface BrowserRoom {
	id: string;
	mode: MatchMode;
	playerCount: number;
	humanCount: number;
	screens: number;
	region: string;
	pingMs: number | null;
	/**
	 * The `?server=` value that boots this room's match — null when it lives on
	 * the page's own server and needs no address in the URL.
	 */
	server: string | null;
	source: RoomSource;
	build: string | null;
	protocol: number | null;
	/** The host name a LAN peer advertised, for the row's tooltip. */
	hostName?: string;
}

/** The `/rooms` entry shape before the browser adds its provenance. */
export interface BrowserRoomEntry {
	id: string;
	mode: MatchMode;
	playerCount: number;
	humanCount: number;
	screens: number;
	region?: string;
	map?: string | null;
	build?: string | null;
	protocol?: number | null;
}

/** A row whose ping has not been measured sorts last within its group. */
const UNKNOWN_PING_MS = 9999;

/** The same id shape the server validates. */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function roomKey(
	room: BrowserRoom,
	local: { host: string; port: number },
): string {
	return `${room.server ?? `${local.host}:${local.port}`}:${room.id}`;
}

/**
 * Merge the two sources.
 *
 * LAN wins a duplicate: the same room reached through the host's own `/rooms`
 * and through a peer's `/lan/rooms` is one row, and the LAN label is the better
 * one. `local` is what makes a row on the page's own server key the same as one
 * discovered by its `host:port`.
 */
export function mergeBrowserRooms(
	internet: readonly BrowserRoom[],
	lan: readonly BrowserRoom[],
	local: { host: string; port: number },
): BrowserRoom[] {
	const merged = new Map<string, BrowserRoom>();
	for (const room of internet) merged.set(roomKey(room, local), room);
	for (const room of lan) merged.set(roomKey(room, local), room);
	return [...merged.values()];
}

/**
 * Pin LAN above internet, then apply the chosen sort inside each group.
 *
 * The pin is deliberately independent of the sort direction: "Players ↓" is a
 * question about players, not a licence to put a 200ms internet room above the
 * machine on the same switch.
 */
export function sortBrowserRooms(
	rooms: readonly BrowserRoom[],
	key: BrowserSortKey,
	dir: BrowserSortDir,
): BrowserRoom[] {
	return [...rooms].sort((a, b) => {
		const sourceRank =
			(a.source === "lan" ? 0 : 1) - (b.source === "lan" ? 0 : 1);
		if (sourceRank !== 0) return sourceRank;

		let cmp = 0;
		if (key === "ping") {
			cmp = (a.pingMs ?? UNKNOWN_PING_MS) - (b.pingMs ?? UNKNOWN_PING_MS);
		} else if (key === "players") {
			cmp = a.playerCount - b.playerCount;
		} else {
			cmp = a.mode.localeCompare(b.mode);
		}
		return dir === "asc" ? cmp : -cmp;
	});
}

/** Whether this page can seat itself in a room with that server. */
export function canJoinBrowserBuild(
	room: BrowserRoom,
	build = BUILD_ID,
	protocol = PROTOCOL_VERSION,
): boolean {
	// The hosted game deploys its client and server together and does not gate;
	// an internet row is a browser-cache question, not a different world.
	if (room.source !== "lan") return true;
	// A LAN server's build and protocol are mandatory: the pack reports both,
	// and the server's strict gate refuses a join that omits them. A row with
	// either missing is an older or non-conforming host, not a safe join.
	return buildMatches(room.build, room.protocol, build, protocol);
}

/** The host's own page, for a LAN row this client's build cannot join. */
export function hostPageForBrowserRoom(room: BrowserRoom): string | null {
	if (room.source !== "lan" || room.server === null) return null;
	const endpoint = parseServerEndpoint(room.server);
	if (!endpoint) return null;
	// A non-default pack port needs `?server=` too; a room link already boots
	// the match, so the extra launch key does not change what the guest sees.
	const server =
		endpoint.port === GAME_SERVER_PORT
			? ""
			: `&server=${endpoint.host}:${endpoint.port}`;
	return `http://${endpoint.host}:${endpoint.port}/?room=${encodeURIComponent(room.id)}${server}`;
}

/**
 * Validate one discovered peer room.
 *
 * The pack already checked its peers on the server, but a row that becomes a
 * clickable `?server=` is exactly where a second check belongs: the endpoint
 * must parse, the host must still be private, and the id must be a room id —
 * anything else is dropped rather than drawn.
 */
export function lanRoomToBrowserRoom(raw: LanRoomEntry): BrowserRoom | null {
	const endpoint = parseServerEndpoint(raw.server);
	if (!endpoint || !isPrivateHost(endpoint.host)) return null;
	if (typeof raw.id !== "string" || !ROOM_ID_RE.test(raw.id)) return null;
	return {
		id: raw.id,
		mode: raw.mode,
		playerCount: raw.playerCount,
		humanCount: raw.humanCount,
		screens: raw.screens,
		region: "lan",
		pingMs: raw.pingMs ?? null,
		server: `${endpoint.host}:${endpoint.port}`,
		source: "lan",
		build: raw.build ?? null,
		protocol: raw.protocol ?? null,
		...(raw.hostName === undefined ? {} : { hostName: raw.hostName }),
	};
}
