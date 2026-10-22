#!/usr/bin/env node
/**
 * Connection-loss probe: the game server dies under a live match.
 *
 * AI vs AI never loses its link — the server is on the same machine and
 * outlives every run — so a dropped seat was untested, and it used to leave a
 * frozen match under "Disconnected from server" with no way forward. This
 * spawns a private game server, seats a client, kills the server, and requires
 * the connection-lost prompt; then restarts it and requires Rejoin to boot back
 * into the room the URL names.
 *
 *   tsx scripts/connection-probe.ts        # needs vite on :8084; owns :9212
 */
import { type ChildProcess, spawn } from "node:child_process";
import { launchBrowser } from "./browser";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const PORT = "9212";

function startServer(): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const child = spawn("pnpm", ["exec", "tsx", "server/index.ts"], {
			env: { ...process.env, PORT },
			detached: true,
		});
		child.stdout?.on("data", (d) => {
			if (/listening/.test(String(d))) resolve(child);
		});
		child.on("exit", (code) => reject(new Error(`server exited (${code})`)));
	});
}

function kill(child: ChildProcess) {
	if (child.pid) process.kill(-child.pid, "SIGKILL");
}

const failures: string[] = [];
let server = await startServer();
const browser = await launchBrowser();
try {
	const page = await browser.newPage();
	await page.goto(
		`${BASE_URL}/?ai=true&bots=1&mute=1&server=localhost:${PORT}`,
	);
	await page.waitForFunction(() => /room=/.test(location.search), null, {
		timeout: 20000,
	});
	const room = new URL(page.url()).searchParams.get("room");
	await page.waitForTimeout(3000);

	const killedAt = Date.now();
	kill(server);
	const prompt = page.getByRole("alertdialog");
	await prompt.waitFor({ timeout: 30000 }).catch(() => {
		failures.push("no connection-lost prompt within 30s of the server dying");
	});
	const promptMs = Date.now() - killedAt;

	server = await startServer();
	await page.getByRole("button", { name: "Rejoin" }).click();
	await page.waitForFunction(() => /room=/.test(location.search), null, {
		timeout: 20000,
	});
	await page.waitForTimeout(4000);
	const rejoinedRoom = new URL(page.url()).searchParams.get("room");
	if (rejoinedRoom !== room) {
		failures.push(`Rejoin landed in ${rejoinedRoom}, not ${room}`);
	}
	if (await prompt.isVisible()) failures.push("the prompt survived Rejoin");

	console.log(
		JSON.stringify(
			{
				verdict: failures.length ? `FAIL: ${failures.join("; ")}` : "PASS",
				promptMs,
				room,
				rejoinedRoom,
			},
			null,
			2,
		),
	);
} finally {
	kill(server);
	await browser.close();
}
if (failures.length) process.exit(1);
