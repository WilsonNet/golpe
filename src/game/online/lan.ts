/**
 * The LAN side of the server browser.
 *
 * A LAN room is a room on a game server that sits on the same local network as
 * the page. The badge is a *derived* fact, never a claim: it is either
 *
 * - the page's own server, when the page was loaded from a private or loopback
 *   address (the LAN pack serves the client and the game from one origin), or
 * - a peer discovered on the local network, whose advertised address is itself
 *   private and validated here.
 *
 * Nothing in this module reads a query parameter or trusts a `lan: true` field
 * from a server. A public site that claims to be LAN stays an internet room.
 */

import type { MatchMode } from "../simulation/Teams.js";

/** Where the LAN pack publishes the rooms its discovery browser found. */
export const LAN_ROOMS_PATH = "/lan/rooms";

/** The room fields discovery adds on top of the ordinary `/rooms` shape. */
export interface LanRoomEntry {
	id: string;
	mode: MatchMode;
	playerCount: number;
	humanCount: number;
	screens: number;
	/** The server hosting this room, as `host:port`. */
	server: string;
	/** The region label the server reports, or `"lan"` for a discovered peer. */
	region?: string;
	build?: string | null;
	protocol?: number | null;
	hostName?: string;
	pingMs?: number | null;
}

/** A hostname suffix that only resolves on a local network. */
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".internal", ".localhost"];

function parseIpv4(host: string): number[] | null {
	const parts = host.split(".");
	if (parts.length !== 4) return null;
	const octets: number[] = [];
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const n = Number.parseInt(part, 10);
		if (n > 255) return null;
		octets.push(n);
	}
	return octets;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
	const [a = -1, b = -1] = octets;
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		// Carrier-grade NAT is shared address space: Tailscale and some ISPs put
		// a machine there, and it is still not the public internet.
		(a === 100 && b >= 64 && b <= 127)
	);
}

function isPrivateIpv6(host: string): boolean {
	const bare = host.replace(/^\[/, "").replace(/\]$/, "").split("%")[0] ?? "";
	const lower = bare.toLowerCase();
	if (lower === "::1") return true;
	// IPv4-mapped: ::ffff:192.168.0.1
	if (lower.startsWith("::ffff:")) {
		const mapped = parseIpv4(lower.slice("::ffff:".length));
		return mapped !== null && isPrivateIpv4(mapped);
	}
	// fc00::/7 (unique local) and fe80::/10 (link local).
	if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
	if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
	return false;
}

/**
 * Whether a host names something on the local network.
 *
 * Accepts an IP literal, a loopback name, or a single-label / reserved-suffix
 * hostname. A public DNS name that *happens* to resolve to a private address is
 * not detected here — the pack prints its IP URL for exactly that reason, and
 * the server's own `lan` mode is the other signal.
 */
export function isPrivateHost(host: string): boolean {
	const trimmed = host.trim().toLowerCase();
	if (trimmed.length === 0) return false;
	if (trimmed === "localhost") return true;
	if (LOCAL_SUFFIXES.some((suffix) => trimmed.endsWith(suffix))) return true;

	const ipv4 = parseIpv4(trimmed);
	if (ipv4 !== null) return isPrivateIpv4(ipv4);
	if (trimmed.includes(":")) return isPrivateIpv6(trimmed);
	return false;
}

/**
 * Whether a `host:port` endpoint is on the local network.
 *
 * The discovery browser hands the client an endpoint, not a URL, so this is the
 * one gate between "some peer on the LAN said so" and a `LAN` row that can be
 * clicked. It is deliberately strict about the address and irrelevant to the
 * port.
 */
export function isPrivateEndpoint(endpoint: {
	host: string;
	port: number;
}): boolean {
	return (
		Number.isSafeInteger(endpoint.port) &&
		endpoint.port > 0 &&
		endpoint.port <= 65535 &&
		isPrivateHost(endpoint.host)
	);
}
