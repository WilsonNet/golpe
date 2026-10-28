/**
 * The LAN pack's launcher.
 *
 * One process serves the built client, the game server and the discovery
 * endpoint from one port. The host runs this; guests only need a browser and the
 * URL it prints.
 *
 * There is deliberately no second game here. `createGameServer` is the same
 * factory the production entry calls; the routes below add files and a peer
 * list, never a rule. That is what keeps a LAN pack from drifting into a fork.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGameServer } from "../server/GameServer.js";
import { PROTOCOL_VERSION } from "../src/game/online/protocol.js";
import { GAME_SERVER_PORT } from "../src/game/online/types.js";
import { LanDiscovery, lanRoomsRoute } from "./discovery.js";
import { lanAddress } from "./net.js";
import { staticRoutes } from "./static.js";

const DEFAULT_PORT = GAME_SERVER_PORT;
const MAX_PORT = 65535;
const HELP = `golpe LAN host

Usage: golpe-lan [options]

  --port <n>        Listen on n (default ${DEFAULT_PORT}). A non-default port
                    puts ?server= in the printed URL, which boots a match.
  --static <dir>    The built client to serve (default: the pack's dist/).
  --no-open         Print the URL instead of opening a browser.
  --no-discovery    Do not advertise or browse mDNS (the host room still works).
  --help            This text.

The host opens the printed LAN URL. Guests open the same URL. Nothing is
installed on their machines.`;

interface BuildInfo {
	build: string;
	protocol: number;
}

function argValue(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function env(name: string): string | undefined {
	return process.env[name];
}

function readBuildInfo(): BuildInfo {
	// Dev runs from `lan/`; the pack runs from `build/lan/server/lan/`. The
	// build manifest sits at the repo root in neither case — only the pack has
	// one — so try the pack's location first and fall back honestly.
	const manifest = [
		new URL("../../build.json", import.meta.url),
		new URL("../build.json", import.meta.url),
	].find((url) => existsSync(url));
	try {
		if (manifest === undefined) throw new Error("no build manifest");
		const raw = JSON.parse(readFileSync(manifest, "utf8")) as {
			build?: unknown;
			protocol?: unknown;
		};
		return {
			build:
				typeof raw.build === "string" && raw.build.length > 0
					? raw.build
					: (env("GOLPE_BUILD") ?? "dev"),
			protocol:
				typeof raw.protocol === "number" &&
				Number.isSafeInteger(raw.protocol) &&
				raw.protocol === PROTOCOL_VERSION
					? raw.protocol
					: PROTOCOL_VERSION,
		};
	} catch {
		return {
			build: env("GOLPE_BUILD") ?? "dev",
			protocol: PROTOCOL_VERSION,
		};
	}
}

function parsePort(raw: string): number {
	const port = Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(port) || port < 1 || port > MAX_PORT) {
		throw new Error(`--port must be 1..${MAX_PORT}`);
	}
	return port;
}

function defaultStaticRoot(): string {
	// Same two layouts as the manifest: `dist/` beside the repo in dev, and
	// `build/lan/dist/` beside the staged server in a pack.
	const candidates = [
		new URL("../../dist/", import.meta.url),
		new URL("../dist/", import.meta.url),
	];
	return fileURLToPath(
		candidates.find((url) => existsSync(url)) ?? (candidates[1] as URL),
	);
}

function openBrowser(url: string): void {
	const platform = process.platform;
	const command =
		platform === "darwin"
			? ["open", [url]]
			: platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	try {
		const child = spawn(command[0] as string, command[1] as string[], {
			stdio: "ignore",
			detached: true,
		});
		child.unref();
	} catch {
		// No browser opener is not a failure: the URL is printed either way.
	}
}

async function main(): Promise<void> {
	if (hasFlag("help")) {
		console.log(HELP);
		return;
	}

	const port = parsePort(argValue("port", String(DEFAULT_PORT)));
	const staticRoot = argValue("static", defaultStaticRoot());
	if (!existsSync(join(resolve(staticRoot), "index.html"))) {
		console.error(
			`[LAN] No client build at ${staticRoot}. Run \`pnpm build\` or the packager first.`,
		);
		process.exitCode = 1;
		return;
	}
	const build = readBuildInfo();
	const discoveryEnabled = !hasFlag("no-discovery");
	const discovery = new LanDiscovery(build.build, build.protocol);
	const serveStatic = staticRoutes(staticRoot);
	const lanRoute = lanRoomsRoute(discovery);

	const server = createGameServer({
		port,
		region: "lan",
		build: build.build,
		protocol: build.protocol,
		// The LAN gate: this pack serves its own client, so a mismatch means a
		// guest is running something else. Refuse it rather than desync.
		strictBuild: true,
		// One number for TCP and UDP keeps a LAN-party firewall rule to one line.
		// The probe used a fixed registered port and proved this binds (a random
		// ephemeral port was the thing that did not).
		icePort: port,
		stun: [],
		enableGithub: false,
		routes: (req, res) => lanRoute(req, res) || serveStatic(req, res),
	});

	let actualPort: number;
	try {
		actualPort = await server.listen();
	} catch (error) {
		console.error(
			`[LAN] Could not listen on port ${port}. Is another golpe server already running?`,
		);
		console.error(String(error));
		process.exitCode = 1;
		return;
	}

	if (discoveryEnabled) discovery.start(actualPort);

	const host = lanAddress();
	const url =
		actualPort === DEFAULT_PORT
			? `http://${host}:${actualPort}/`
			: `http://${host}:${actualPort}/?server=${host}:${actualPort}`;

	console.log("");
	console.log("  golpe LAN host");
	console.log(`  build ${build.build} · protocol ${build.protocol}`);
	console.log(`  ${url}`);
	console.log("");
	console.log("  Open that URL here, then share it with the LAN.");
	console.log(
		discoveryEnabled
			? "  Other packs on this network will appear in the server browser."
			: "  mDNS discovery is off; only this host is listed.",
	);
	console.log("  Ctrl+C to stop.");
	console.log("");

	if (!hasFlag("no-open")) openBrowser(url);

	let closing = false;
	const shutdown = async () => {
		if (closing) return;
		closing = true;
		discovery.stop();
		await server.close();
		process.exit(0);
	};
	process.once("SIGINT", () => void shutdown());
	process.once("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
	console.error("[LAN] Failed to start:", error);
	process.exitCode = 1;
});
