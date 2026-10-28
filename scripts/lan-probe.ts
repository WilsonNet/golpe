/**
 * The LAN pack probe.
 *
 * The canonical online probes run against the dev server, which is the same
 * code but not the same *distribution*: the pack stages a build, serves the
 * client and the game from one port, and pins ICE. This probe starts the pack,
 * proves `/health` and `/rooms` answer with the build identity, then seats two
 * AI clients in one room over that one port.
 *
 * It deliberately does not use `GOLPE_SERVER` routing: the page must dial the
 * pack's own address through `?server=`, exactly as a guest's browser does.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { lanAddress } from "../lan/net";
import { launchBrowser } from "./browser";

/**
 * A free TCP port in the registered range.
 *
 * Deliberately not `listen(0)`: on macOS an ephemeral port (49152+) made the
 * page origin answer HTTP while the WebRTC data channel never completed, and the
 * same pack on 9408 was fine. The pack's real port is 9208; the probe uses the
 * same neighbourhood so it measures the distribution, not an OS quirk.
 */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		let candidate = 9400;
		const attempt = () => {
			if (candidate > 9499) {
				reject(new Error("no free port in 9400-9499"));
				return;
			}
			const port = candidate++;
			const server = createServer();
			server.once("error", () => attempt());
			server.listen(port, "127.0.0.1", () => {
				server.close(() => resolve(port));
			});
		};
		attempt();
	});
}

interface Health {
	ok?: unknown;
	build?: unknown;
	protocol?: unknown;
	rooms?: unknown;
}

interface Rooms {
	build?: unknown;
	rooms?: unknown;
}

async function waitForHealth(port: number, timeoutMs = 20000): Promise<Health> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/health`);
			if (res.ok) return (await res.json()) as Record<string, unknown>;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`pack did not answer /health on :${port}`);
}

function stop(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.killed) {
			resolve();
			return;
		}
		child.once("exit", () => resolve());
		child.kill("SIGTERM");
		setTimeout(() => {
			if (child.exitCode === null) child.kill("SIGKILL");
		}, 3000).unref();
	});
}

async function main() {
	const port = await freePort();
	const usePack = process.argv.includes("--pack");
	const packRoot = join(process.cwd(), "build", "golpe-lan");
	const command = usePack
		? process.platform === "win32"
			? "cmd.exe"
			: join(packRoot, "golpe-lan")
		: "node_modules/.bin/tsx";
	const args = usePack
		? process.platform === "win32"
			? [
					"/c",
					join(packRoot, "golpe-lan.bat"),
					"--port",
					String(port),
					"--no-open",
					"--no-discovery",
				]
			: ["--port", String(port), "--no-open", "--no-discovery"]
		: ["lan/main.ts", "--port", String(port), "--no-open", "--no-discovery"];
	const child = spawn(command, args, {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.once("error", (error) => {
		output += `spawn error: ${error.message}\n`;
	});
	child.stdout?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	child.once("exit", (code) => {
		if (code !== 0 && code !== null) {
			console.error(`[lan-probe] pack exited with ${code}`);
			console.error(output.slice(-4000));
		}
	});

	try {
		const health = await waitForHealth(port);
		if (health.ok !== true) throw new Error("health did not say ok");
		if (typeof health.build !== "string")
			throw new Error("health has no build");
		if (typeof health.protocol !== "number")
			throw new Error("health has no protocol");
		if (usePack && health.build === "dev") {
			throw new Error("a packaged run reported the dev build id");
		}

		const rooms = (await fetch(`http://127.0.0.1:${port}/rooms`).then((res) =>
			res.json(),
		)) as Rooms;
		if (rooms.build !== health.build) {
			throw new Error("/rooms and /health disagree about the build");
		}

		const browser = await launchBrowser();
		const ctx = await browser.newContext();
		const room = `lan-probe-${Date.now().toString(36)}`;
		const host = lanAddress();
		const url =
			`http://${host}:${port}/?online=true&ai=true&room=${room}` +
			`&server=${host}:${port}&mute=1`;
		const errors: string[] = [];
		const logs: string[] = [];
		const a = await ctx.newPage();
		a.on("pageerror", (e) => errors.push(`A: ${e.message}`));
		a.on("console", (m) => logs.push(`A: ${m.text()}`));
		await a.goto(url);
		const b = await ctx.newPage();
		b.on("pageerror", (e) => errors.push(`B: ${e.message}`));
		b.on("console", (m) => logs.push(`B: ${m.text()}`));
		await b.goto(url);

		// Poll from Node, never with `waitForFunction`: an in-page poll runs on
		// the renderer's main thread, and two pages in one context share it. The
		// first version of this probe starved the second page's WebSocket setup
		// and read one fighter forever, which looked exactly like a netcode bug.
		type GameState = { fighterCount?: number; onlineMode?: boolean };
		const readState = (page: typeof a) =>
			page
				.evaluate(
					() =>
						(
							window as unknown as { __gameState?: () => GameState }
						).__gameState?.() as GameState | undefined,
				)
				.catch(() => undefined);
		let stateA: GameState | undefined;
		let stateB: GameState | undefined;
		const deadline = Date.now() + 20000;
		while (Date.now() < deadline) {
			stateA = await readState(a);
			stateB = await readState(b);
			if (stateA?.fighterCount === 2 && stateB?.fighterCount === 2) break;
			await a.waitForTimeout(1000);
		}
		await browser.close();

		if (errors.length > 0) {
			throw new Error(`page errors:\n${errors.join("\n")}`);
		}
		if (errors.length > 0) {
			throw new Error(`page errors:\n${errors.join("\n")}`);
		}
		if (stateA?.fighterCount !== 2 || stateB?.fighterCount !== 2) {
			throw new Error(
				`expected 2 fighters on both clients, got A=${String(stateA?.fighterCount)} B=${String(stateB?.fighterCount)}\n` +
					`console (tail):\n${logs.slice(-80).join("\n")}\n` +
					`pack (tail):\n${output.slice(-3000)}`,
			);
		}
		if (stateA.onlineMode !== true || stateB.onlineMode !== true) {
			throw new Error("a client did not boot online");
		}
		console.log(
			JSON.stringify(
				{
					ok: true,
					port,
					build: health.build,
					protocol: health.protocol,
					roomsBeforeJoin: Array.isArray(rooms.rooms) ? rooms.rooms.length : 0,
					fighterCountA: stateA.fighterCount,
					fighterCountB: stateB.fighterCount,
				},
				null,
				2,
			),
		);
	} finally {
		await stop(child);
	}
}

await main();
