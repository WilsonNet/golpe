/**
 * The directory: one listing over every region's game servers.
 *
 * Gameplay never touches this service — rooms live and die inside one region's
 * game server, and the simulation tick must never wait on anything outside it.
 * This is the control plane's first process: it fans out to each configured
 * game server's `/rooms`, tags every entry with its region, and serves the
 * merged listing the menu's server browser and quick match read instead of
 * asking one server. A region that is down contributes nothing; it never fails
 * the whole listing.
 *
 * This is also where the non-game backend grows up: auth, persistence (Turso
 * + Drizzle when the database arrives), leaderboards and match history all
 * belong here, beside the game servers rather than inside them. It stays
 * TypeScript — same types, same validation, same monorepo — until a measured
 * bottleneck says otherwise. See `docs/regions.md` for the decision record.
 *
 * Zero dependencies: `node:http` only, like the game server's own endpoint.
 * Run it with `tsx directory/index.ts` or `pnpm run dev:directory`.
 */

import http from "node:http";
import { parseServerList } from "../src/game/online/regions.js";

/** The port this process binds when `PORT` names nothing usable. */
const DEFAULT_PORT = 9308;
/** Lowest and highest TCP port this process may bind. */
const MIN_PORT = 1;
const MAX_PORT = 65535;
/** How long one merged listing is served before it is re-fetched, in ms. */
const DEFAULT_CACHE_MS = 3000;
/** Lowest and highest cache lifetime the env may ask for, in ms. */
const MIN_CACHE_MS = 500;
const MAX_CACHE_MS = 30000;
/** How long one region may take to answer before it is skipped, in ms. */
const UPSTREAM_TIMEOUT_MS = 2500;
/** HTTP answers the menu can read without any client-side help. */
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function configuredPort(): number {
	const raw = env("PORT");
	if (raw === undefined) return DEFAULT_PORT;
	const port = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
		return DEFAULT_PORT;
	}
	return port;
}

function cacheMs(): number {
	const raw = env("CACHE_MS");
	if (raw === undefined) return DEFAULT_CACHE_MS;
	const ms = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(ms) || ms < MIN_CACHE_MS || ms > MAX_CACHE_MS) {
		return DEFAULT_CACHE_MS;
	}
	return ms;
}

/**
 * One environment value, by name — indexed by variable so the access
 * typechecks and lints (see the same helper in `server/index.ts`).
 */
function env(name: string): string | undefined {
	return process.env[name];
}

/**
 * The fleet, in the one format both ends read (`region=host:port,...`).
 *
 * Parsed with the same function the client's server browser uses, so the
 * operator writes the fleet once and the directory and the menu cannot
 * disagree about what it says.
 */
const SERVERS = parseServerList(env("GOLPE_SERVERS"));

interface DirectoryRoom {
	id: string;
	mode: string;
	playerCount: number;
	humanCount: number;
	screens: number;
	region: string;
}

async function fetchRooms(
	region: string,
	host: string,
	port: number,
): Promise<DirectoryRoom[]> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
	try {
		const res = await fetch(`http://${host}:${port}/rooms`, {
			signal: ctrl.signal,
		});
		if (!res.ok) return [];
		const data = (await res.json()) as {
			rooms?: (Omit<DirectoryRoom, "region"> & { region?: string })[] | null;
		};
		return (data.rooms ?? []).map((room) => ({
			...room,
			region: room.region ?? region,
		}));
	} catch {
		// A down region contributes nothing. It never fails the listing.
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** The merged listing, busiest first — the same order one server uses. */
async function mergedRooms(): Promise<DirectoryRoom[]> {
	const lists = await Promise.all(
		SERVERS.map((server) =>
			fetchRooms(server.region, server.host, server.port),
		),
	);
	return lists.flat().sort((a, b) => b.playerCount - a.playerCount);
}

let cachedAt = 0;
let cached: DirectoryRoom[] = [];

async function rooms(): Promise<DirectoryRoom[]> {
	const now = Date.now();
	if (now - cachedAt < cacheMs()) return cached;
	cached = await mergedRooms();
	cachedAt = Date.now();
	return cached;
}

const server = http.createServer((req, res) => {
	const path = (req.url ?? "").split("?")[0] ?? "";
	if (req.method === "GET" && (path === "/health" || path === "/health/")) {
		res.writeHead(HTTP_OK, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		});
		res.end(JSON.stringify({ ok: true, servers: SERVERS.length }));
		return;
	}
	if (req.method === "GET" && (path === "/regions" || path === "/regions/")) {
		res.writeHead(HTTP_OK, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		});
		res.end(
			JSON.stringify({
				ok: true,
				regions: SERVERS.map((s) => ({
					region: s.region,
					host: s.host,
					port: s.port,
				})),
			}),
		);
		return;
	}
	if (req.method === "GET" && (path === "/rooms" || path === "/rooms/")) {
		void rooms().then((listed) => {
			res.writeHead(HTTP_OK, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			});
			res.end(JSON.stringify({ ok: true, rooms: listed }));
		});
		return;
	}
	res.writeHead(HTTP_NOT_FOUND);
	res.end();
});

const port = configuredPort();
server.listen(port);
console.log(
	`[DIRECTORY] golpe directory on port ${port} (${SERVERS.length} game servers)`,
);
for (const s of SERVERS) {
	console.log(`[DIRECTORY]   ${s.region} -> ${s.host}:${s.port}`);
}
