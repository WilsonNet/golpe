/**
 * The production game server.
 *
 * Everything that makes a room — the rooms, the netcode, the HTTP surface — is
 * in `GameServer.ts`, because the LAN pack runs the same factory. This entry is
 * only the environment: which port, which region, which ICE setup, and which
 * build id the health check should report.
 */

import { parseRegion } from "../src/game/online/regions.js";
import { GAME_SERVER_PORT } from "../src/game/online/types.js";
import { createGameServer } from "./GameServer.js";

/** Lowest and highest TCP/UDP port this process may bind. */
const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * One environment value, by name.
 *
 * Indexed by variable rather than by literal: `process.env.PORT` does not
 * typecheck (`noPropertyAccessFromIndexSignature`) and `process.env["PORT"]`
 * does not lint (`useLiteralKeys`), so the one helper both call sites share
 * is the only place that touches the shape.
 */
function env(name: string): string | undefined {
	return process.env[name];
}

/**
 * The UDP port WebRTC ICE binds, when the host must be reachable through a
 * firewall.
 *
 * Empty in local development: the OS picks a port, so three regions can run
 * side by side on one machine. Production pins it to the same number the
 * reverse proxy publishes, because a cloud security list cannot open a port
 * range nobody wrote down.
 */
function icePort(): number | null {
	const raw = env("GOLPE_ICE_PORT");
	if (raw === undefined) return null;
	const port = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
		return null;
	}
	return port;
}

/**
 * STUN servers the WebRTC stack asks for its public reflexive address.
 *
 * A game server behind a cloud NAT only knows its private address, so the
 * browser cannot dial it without a candidate that names the public one.
 * Comma-separated `stun:` / `turn:` URLs; empty for a LAN, where the host
 * candidate is the address itself.
 */
function stunServers(): { urls: string }[] {
	const raw = env("GOLPE_STUN");
	if (raw === undefined) return [];
	return raw
		.split(",")
		.map((url) => url.trim())
		.filter((url) => url.length > 0)
		.map((urls) => ({ urls }));
}

/**
 * Which port this process binds: `PORT` (or `GAME_SERVER_PORT`) when it names
 * a real one, the compiled default otherwise. The override is what lets three
 * regions run side by side on one machine for a local test.
 */
function serverPort(): number {
	const raw = env("PORT") ?? env("GAME_SERVER_PORT");
	if (raw === undefined) return GAME_SERVER_PORT;
	const port = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
		return GAME_SERVER_PORT;
	}
	return port;
}

/**
 * Which region this process serves: `GOLPE_REGION=sa` in São Paulo,
 * `us-east` in US-E, `eu` in Europe, `local` when nobody says.
 *
 * A region is an identity, not a behaviour switch — every game server runs
 * the same binary and the same rules. It is advertised in `/health` and on
 * every `/rooms` entry so the directory and the server browser can say where
 * a room lives. Rooms never leave the region they were created in.
 */
const REGION = parseRegion(env("GOLPE_REGION")) ?? "local";

const PORT = serverPort();
const BUILD = env("GOLPE_BUILD") ?? "dev";

const server = createGameServer({
	port: PORT,
	region: REGION,
	build: BUILD,
	icePort: icePort(),
	stun: stunServers(),
	enableGithub: true,
});

server
	.listen()
	.then((port) => {
		console.log(
			`[SERVER] golpe server listening on port ${port} (region ${REGION})`,
		);
		console.log(
			"[SERVER] rooms are addressed by id — share the link to share a room",
		);
	})
	.catch((error: unknown) => {
		console.error(`[SERVER] Could not listen on port ${PORT}:`, error);
		process.exitCode = 1;
	});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		void server.close().then(() => process.exit(0));
	});
}
