/**
 * Two LAN packs on one machine: one hosts a room, the other discovers it.
 *
 * This is the end-to-end proof that the host pack's mDNS advertisement, its
 * `/lan/rooms` merge and the peer's `/rooms` fetch agree. The browser cannot
 * browse mDNS, so the host is also the only place a LAN listing can come from;
 * this probe exercises exactly that path.
 *
 * The host client is a *human* client (`?ai=true` creates a probe room, which
 * `GameRoom.isOpen` deliberately hides). It names itself through the same
 * `__setPlayerName` hook the modal uses, then opens a room.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { lanAddress } from "../lan/net";
import { launchBrowser } from "./browser";

function freePort(from = 9410): Promise<number> {
	return new Promise((resolve, reject) => {
		let candidate = from;
		const attempt = () => {
			if (candidate > 9469) {
				reject(new Error("no free port in 9410-9469"));
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
	build?: unknown;
	protocol?: unknown;
}

async function waitForHealth(port: number, timeoutMs = 20000): Promise<Health> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/health`);
			if (res.ok) return (await res.json()) as Health;
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

interface Room {
	id?: unknown;
	server?: unknown;
	build?: unknown;
	protocol?: unknown;
	hostName?: unknown;
}

async function roomsOn(port: number): Promise<Room[]> {
	const res = await fetch(`http://127.0.0.1:${port}/lan/rooms`);
	if (!res.ok) return [];
	const data = (await res.json()) as { rooms?: unknown };
	return Array.isArray(data.rooms) ? (data.rooms as Room[]) : [];
}

async function main() {
	const hostPort = await freePort();
	const peerPort = await freePort(hostPort + 1);
	const packs: ChildProcess[] = [];
	const packRoot = join(process.cwd(), "build", "golpe-lan");
	const start = (port: number) => {
		const command =
			process.platform === "win32" ? "cmd.exe" : join(packRoot, "golpe-lan");
		const args =
			process.platform === "win32"
				? [
						"/c",
						join(packRoot, "golpe-lan.bat"),
						"--port",
						String(port),
						"--no-open",
					]
				: ["--port", String(port), "--no-open"];
		const child = spawn(command, args, {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.once("error", (error) => {
			console.error(`[lan-discovery] spawn error: ${error.message}`);
		});
		packs.push(child);
		return child;
	};
	const hostPack = start(hostPort);
	const peerPack = start(peerPort);
	let hostOutput = "";
	hostPack.stdout?.on("data", (chunk: Buffer) => {
		hostOutput += chunk.toString();
	});
	hostPack.stderr?.on("data", (chunk: Buffer) => {
		hostOutput += chunk.toString();
	});
	let peerOutput = "";
	peerPack.stdout?.on("data", (chunk: Buffer) => {
		peerOutput += chunk.toString();
	});
	peerPack.stderr?.on("data", (chunk: Buffer) => {
		peerOutput += chunk.toString();
	});

	try {
		const [hostHealth, peerHealth] = await Promise.all([
			waitForHealth(hostPort),
			waitForHealth(peerPort),
		]);
		if (peerHealth.build !== hostHealth.build) {
			throw new Error("the two packs were not built from the same commit");
		}
		const host = lanAddress();
		const browser = await launchBrowser();
		const ctx = await browser.newContext();
		const room = `lan-discovery-${Date.now().toString(36)}`;
		const page = await ctx.newPage();
		await page.goto(
			`http://${host}:${hostPort}/?online=true&room=${room}` +
				`&server=${host}:${hostPort}&mute=1`,
		);
		// The name gate is the same one a player sees. The page installs the hook
		// once the scene exists; poll from Node so the renderer is not starved.
		let named = false;
		for (let i = 0; i < 30; i++) {
			const ready = await page
				.evaluate(
					() =>
						typeof (window as unknown as { __setPlayerName?: unknown })
							.__setPlayerName === "function",
				)
				.catch(() => false);
			if (ready) {
				await page.evaluate(() =>
					(
						window as unknown as { __setPlayerName: (n: string) => void }
					).__setPlayerName("LAN Host"),
				);
				named = true;
				break;
			}
			await page.waitForTimeout(500);
		}
		if (!named) throw new Error("host client never installed its name hook");

		// The room must exist on the host before discovery can see it.
		let hosted = false;
		for (let i = 0; i < 30; i++) {
			const res = await fetch(`http://127.0.0.1:${hostPort}/rooms`);
			const data = (await res.json()) as { rooms?: { id?: string }[] };
			if (data.rooms?.some((r) => r.id === room)) {
				hosted = true;
				break;
			}
			await page.waitForTimeout(500);
		}
		if (!hosted) throw new Error("host room never appeared in /rooms");

		let found: Room | null = null;
		const deadline = Date.now() + 20000;
		while (Date.now() < deadline) {
			const rooms = await roomsOn(peerPort);
			found =
				rooms.find(
					(r) =>
						r.server === `${host}:${hostPort}` &&
						r.build === hostHealth.build &&
						r.protocol === hostHealth.protocol,
				) ?? null;
			if (found) break;
			await page.waitForTimeout(500);
		}
		await browser.close();
		if (!found) {
			throw new Error(
				`peer did not discover the host room\n` +
					`peer /lan/rooms: ${JSON.stringify(await roomsOn(peerPort))}\n` +
					`host pack (tail):\n${hostOutput.slice(-3000)}\n` +
					`peer pack (tail):\n${peerOutput.slice(-3000)}`,
			);
		}
		console.log(
			JSON.stringify(
				{
					ok: true,
					hostPort,
					peerPort,
					room,
					discovered: found,
				},
				null,
				2,
			),
		);
	} finally {
		await Promise.all(packs.map((child) => stop(child)));
	}
}

await main();
