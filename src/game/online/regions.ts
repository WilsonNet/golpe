/**
 * Regions: where the game's servers live, and how a client picks one.
 *
 * A realtime fight cannot be played across an ocean — the simulation ticks at
 * 60Hz and every input is a round trip, so the only answer is to run the same
 * game-server binary in every player population (SA, US-E, EU for launch) and
 * let the player choose the closest one. There is deliberately no cross-region
 * machinery underneath this:
 *
 * - **Rooms never leave their region.** A room is created, played and reaped
 *   inside one game server. Nothing replicates, migrates or proxies gameplay
 *   state between regions — the snapshot is the only authority on who is
 *   present, and it never crosses a region boundary.
 * - **Region selection is client-side.** `?server=host[:port]` names the exact
 *   game server to dial (like `?room=` names the room); absent, the client
 *   dials the host the page came from, exactly as before. `?region=` is only
 *   the server browser's filter hint — it never changes where a match boots.
 * - **The directory aggregates; game servers never call each other.** The
 *   control-plane service in `directory/` fans out to each region's `/rooms`
 *   and merges the listings. A game server only knows its own `GOLPE_REGION`.
 *
 * This module is shared by client and server, so it touches neither the DOM
 * nor `process` directly — every environment value arrives as an argument.
 * That is what keeps the client and the server reading the same format.
 */

import { GAME_SERVER_PORT } from "./types.js";

/** What a region id may look like — on the wire, in URLs and in env. */
const REGION_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** The region id a server reports when nobody told it which one it is. */
export const DEFAULT_REGION = "local";

/** Lowest and highest TCP/UDP port a `?server=` endpoint may name. */
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** What a `?server=` host may look like: a bare hostname or IPv4 address. */
const SERVER_HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;

/** One game server an operator runs: the region it serves and where it is. */
export interface RegionEndpoint {
	/** The region id the server advertises in `/health` and `/rooms`. */
	region: string;
	/** Bare host — no scheme, no path — so a URL cannot smuggle one in. */
	host: string;
	/** TCP/HTTP + WebRTC signalling port. */
	port: number;
}

/** A validated region id, or null when nothing usable was asked for. */
export function parseRegion(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	return REGION_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * A validated `?server=` value, or null when it names nothing usable.
 *
 * Accepts `host` or `host:port`. Anything else — a scheme, a path, a query —
 * is rejected rather than interpreted, because the value becomes the address
 * the game's traffic is sent to.
 */
export function parseServerEndpoint(raw: unknown): RegionEndpoint | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.includes("/")) return null;
	const [host = "", portRaw] = trimmed.split(":");
	if (!SERVER_HOST_RE.test(host)) return null;
	if (portRaw === undefined) {
		return { region: DEFAULT_REGION, host, port: GAME_SERVER_PORT };
	}
	if (!/^\d+$/.test(portRaw)) return null;
	const port = Number.parseInt(portRaw, 10);
	if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
		return null;
	}
	return { region: DEFAULT_REGION, host, port };
}

/**
 * One `region=host:port` (or bare `host:port`) entry of a server list, or null.
 *
 * The same format configures the directory (`GOLPE_SERVERS`) and the client
 * (`VITE_GOLPE_SERVERS`), so the operator writes the fleet once and both ends
 * read it. A bare `host:port` without a region takes the host as its label —
 * a single-server setup needs no ceremony.
 */
function parseServerListEntry(raw: string): RegionEndpoint | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return null;
	const eq = trimmed.indexOf("=");
	if (eq === -1) {
		const endpoint = parseServerEndpoint(trimmed);
		if (!endpoint) return null;
		return { ...endpoint, region: endpoint.host };
	}
	const region = parseRegion(trimmed.slice(0, eq));
	const endpoint = parseServerEndpoint(trimmed.slice(eq + 1));
	if (!region || !endpoint) return null;
	return { ...endpoint, region };
}

/** Split a comma-separated server list into its usable endpoints. */
export function parseServerList(raw: unknown): RegionEndpoint[] {
	if (typeof raw !== "string") return [];
	return raw
		.split(",")
		.map((entry) => parseServerListEntry(entry))
		.filter((entry): entry is RegionEndpoint => entry !== null);
}

/**
 * Which game server this client dials.
 *
 * `?server=` wins outright — an explicit endpoint is intent, like `?room=`.
 * Otherwise the page's own host on the game port, which is exactly what the
 * client did before regions existed. `?region=` deliberately plays no part:
 * it is the browser's filter hint, not an address.
 */
export function resolveGameEndpoint(
	search: string,
	locationHost: string,
): RegionEndpoint {
	const override = parseServerEndpoint(
		new URLSearchParams(search).get("server"),
	);
	if (override) return override;
	return { region: DEFAULT_REGION, host: locationHost, port: GAME_SERVER_PORT };
}

/** `http(s)://host:port` for menu fetches and the POTG footage. */
export function httpBaseFor(
	endpoint: Pick<RegionEndpoint, "host" | "port">,
	protocol: string,
): string {
	const scheme = protocol === "https:" ? "https:" : "http:";
	return `${scheme}//${endpoint.host}:${endpoint.port}`;
}

/**
 * `http(s)://host` for the WebRTC signalling client, which takes the port
 * separately. Kept apart from `httpBaseFor` on purpose: folding the port into
 * both would dial it twice.
 */
export function signallingUrlFor(
	endpoint: Pick<RegionEndpoint, "host">,
	protocol: string,
): string {
	const scheme = protocol === "https:" ? "https:" : "http:";
	return `${scheme}//${endpoint.host}`;
}

/**
 * The endpoint list a server browser fans out to: the page's own server
 * first, then every configured one, deduplicated by host and port.
 *
 * Local-first is deliberate: a bare dev setup lists exactly one server, and
 * an operator's fleet appears beside it with no other switch to flip.
 */
export function buildEndpointList(
	local: RegionEndpoint,
	configured: RegionEndpoint[],
): RegionEndpoint[] {
	const seen = new Set([`${local.host}:${local.port}`]);
	const out = [local];
	for (const endpoint of configured) {
		const key = `${endpoint.host}:${endpoint.port}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(endpoint);
	}
	return out;
}
