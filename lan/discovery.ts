/**
 * LAN discovery for the host pack.
 *
 * The pack is the only machine that runs the binary, so it is also the only
 * machine that can search the LAN: browsers cannot browse mDNS, and asking a
 * guest to install a second helper would make the badge a client feature. The
 * host advertises its game server, browses for the others, and publishes the
 * merged room list at `/lan/rooms` on the same origin as the client it serves.
 *
 * mDNS is an address book, not a source of truth. A discovered service only
 * contributes `host:port`; the room list is fetched from that host's `/rooms`,
 * the same endpoint quick match reads. A peer that stops answering disappears
 * from the next refresh even if its mDNS record lingers.
 */

import type http from "node:http";
import os from "node:os";
import Bonjour from "bonjour-service";
import {
	isPrivateHost,
	LAN_ROOMS_PATH,
	type LanRoomEntry,
} from "../src/game/online/lan.js";
import type { MatchMode } from "../src/game/simulation/Teams.js";

/** The DNS-SD service type, without the `._tcp` suffix bonjour adds. */
const SERVICE_TYPE = "golpe";

/** How long a discovery result is reused. The browser refreshes every 5s. */
const CACHE_MS = 1000;

/** How long one peer's `/rooms` may take before it is skipped. */
const PEER_TIMEOUT_MS = 1200;

/** Bounds the work a hostile or broken LAN can create. */
const MAX_PEERS = 32;
const MAX_ROOMS = 128;

/** Same shape the server validates, so a peer cannot smuggle a key. */
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The hosted origins allowed to read the LAN list, for a future web bridge. */
const ALLOWED_ORIGINS = new Set([
	"https://golpe.quest",
	"https://golpe.gg",
	"http://localhost:8084",
	"http://127.0.0.1:8084",
]);

interface Peer {
	host: string;
	port: number;
	name: string;
}

interface RoomsResponse {
	ok?: unknown;
	build?: unknown;
	protocol?: unknown;
	rooms?: unknown;
}

function serviceName(port: number): string {
	const base = os
		.hostname()
		.replace(/[^A-Za-z0-9-]/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	// The port makes the instance unique when two packs share a host (the
	// discovery probe does); bonjour rejects a duplicate instance name outright.
	return `${base.length > 0 ? base : "golpe"}-${port}`;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function asCount(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.round(value))
		: 0;
}

function asMode(value: unknown): MatchMode {
	if (value === "tdm" || value === "5cp") return value;
	return "ffa";
}

/** The fields this side trusts from a peer's room; everything else is ignored. */
interface RawRoom {
	id?: unknown;
	mode?: unknown;
	humanCount?: unknown;
	playerCount?: unknown;
	screens?: unknown;
}

/** One room from a peer's `/rooms`, or null when it is not a room at all. */
function asLanRoom(
	raw: unknown,
	peer: Peer,
	build: string | null,
	protocol: number | null,
	pingMs: number,
): LanRoomEntry | null {
	if (typeof raw !== "object" || raw === null) return null;
	const room = raw as RawRoom;
	const id = asString(room.id);
	if (id === null || !ROOM_ID_RE.test(id)) return null;
	const humanCount = asCount(room.humanCount);
	const playerCount = Math.max(humanCount, asCount(room.playerCount));
	return {
		id,
		mode: asMode(room.mode),
		playerCount,
		humanCount,
		screens: Math.max(1, asCount(room.screens)),
		region: "lan",
		server: `${peer.host}:${peer.port}`,
		build,
		protocol,
		hostName: peer.name,
		pingMs,
	};
}

export class LanDiscovery {
	private bonjour: Bonjour | null = null;
	private service: ReturnType<Bonjour["publish"]> | null = null;
	private browser: ReturnType<Bonjour["find"]> | null = null;
	private port = 0;
	private name = "";
	private cache: { at: number; rooms: LanRoomEntry[] } | null = null;
	private inflight: Promise<LanRoomEntry[]> | null = null;
	private stopped = false;

	constructor(
		private readonly build: string,
		private readonly protocol: number,
	) {}

	/** Advertise this server and start browsing for the others. */
	start(port: number): void {
		this.port = port;
		this.name = serviceName(port);
		try {
			this.bonjour = new Bonjour();
			this.service = this.bonjour.publish({
				name: this.name,
				type: SERVICE_TYPE,
				port,
				protocol: "tcp",
				txt: { v: "1", b: this.build, p: String(this.protocol) },
				// A second pack on the same host gets a renamed instance instead of
				// failing the publish; the port suffix already makes that unlikely.
				probe: true,
				// IPv4 keeps the pack's story simple: one printed address, one
				// firewall number, one thing a guest can type.
				disableIPv6: true,
			});
			this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: "tcp" });
		} catch (error) {
			// A network without multicast still has a usable host room. Discovery
			// is an optimisation; failing it must not take the pack down.
			console.warn(
				`[LAN] mDNS unavailable — peer discovery is off: ${String(error)}`,
			);
			this.service = null;
			this.browser = null;
		}
	}

	stop(): void {
		this.stopped = true;
		this.browser?.stop();
		this.service?.stop();
		this.bonjour?.destroy();
	}

	private peers(): Peer[] {
		if (this.browser === null) return [];
		const seen = new Set<string>();
		const peers: Peer[] = [];
		for (const service of this.browser.services) {
			if (peers.length >= MAX_PEERS) break;
			if (
				service.fqdn === this.service?.fqdn ||
				(service.name === this.name && service.port === this.port)
			) {
				continue;
			}
			const host = (service.addresses ?? []).find(
				(address) => !address.includes(":") && isPrivateHost(address),
			);
			if (host === undefined || service.port <= 0) continue;
			const key = `${host}:${service.port}`;
			if (seen.has(key)) continue;
			seen.add(key);
			peers.push({ host, port: service.port, name: service.name });
		}
		return peers;
	}

	private async peerRooms(peer: Peer): Promise<LanRoomEntry[]> {
		const started = Date.now();
		try {
			const res = await fetch(`http://${peer.host}:${peer.port}/rooms`, {
				signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
			});
			if (!res.ok) return [];
			const data = (await res.json()) as RoomsResponse;
			const build = asString(data.build);
			const protocol =
				typeof data.protocol === "number" && Number.isFinite(data.protocol)
					? data.protocol
					: null;
			if (!Array.isArray(data.rooms)) return [];
			const pingMs = Math.max(0, Date.now() - started);
			return data.rooms
				.map((room) => asLanRoom(room, peer, build, protocol, pingMs))
				.filter((room): room is LanRoomEntry => room !== null);
		} catch {
			return [];
		}
	}

	private async discover(): Promise<LanRoomEntry[]> {
		// Parallel, not one peer after another: a stalled host must cost one
		// timeout, not one timeout multiplied by the room's hosts.
		const lists = await Promise.all(
			this.peers().map((peer) => this.peerRooms(peer)),
		);
		return lists.flat().slice(0, MAX_ROOMS);
	}

	/** The merged room list, cached for one browser refresh tick. */
	async rooms(): Promise<LanRoomEntry[]> {
		if (this.stopped) return [];
		if (this.cache !== null && Date.now() - this.cache.at < CACHE_MS) {
			return this.cache.rooms;
		}
		if (this.inflight !== null) return this.inflight;
		this.inflight = this.discover()
			.then((rooms) => {
				this.cache = { at: Date.now(), rooms };
				return rooms;
			})
			.finally(() => {
				this.inflight = null;
			});
		return this.inflight;
	}
}

function allowOrigin(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): void {
	const origin = req.headers.origin;
	if (typeof origin === "string" && ALLOWED_ORIGINS.has(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
		res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
	}
}

/**
 * `GET /lan/rooms` on the pack's origin.
 *
 * Same-origin in the normal flow: the page and this route are served by the
 * same process. The allow-list is for a future hosted-page bridge, and it is a
 * list rather than `*` so a random website cannot use a player's pack to map
 * their LAN.
 */
export function lanRoomsRoute(
	discovery: LanDiscovery,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
	return (req, res) => {
		const path = (req.url ?? "").split("?")[0] ?? "";
		if (path !== LAN_ROOMS_PATH) return false;

		allowOrigin(req, res);
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return true;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
			res.end();
			return true;
		}

		res.setHeader("Content-Type", "application/json");
		res.setHeader("Cache-Control", "no-store");
		if (req.method === "HEAD") {
			res.writeHead(200);
			res.end();
			return true;
		}
		void discovery
			.rooms()
			.then((rooms) => {
				res.writeHead(200);
				res.end(JSON.stringify({ ok: true, rooms }));
			})
			.catch(() => {
				res.writeHead(200);
				res.end(JSON.stringify({ ok: true, rooms: [] }));
			});
		return true;
	};
}
