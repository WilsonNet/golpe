/**
 * The badge gate.
 *
 * Starts the packaged host on 9208, creates a real room through a named client,
 * then opens the menu and asks the server browser what it drew. The LAN row must
 * exist, be first, and carry the `LAN` badge; the badge is the visible half of
 * "the host's own page found its own game".
 *
 * Port 9208 is deliberate: the pack's menu derives the game endpoint from the
 * page's host and the compiled port. Stop the dev server before running this;
 * the probe fails loudly if something else already owns 9208.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { lanAddress } from "../lan/net";
import { launchBrowser } from "./browser";

const PORT = 9208;

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

async function waitForHealth(timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/health`);
			if (res.ok) return (await res.json()) as { build?: unknown };
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error("pack did not answer /health on :9208");
}

async function main() {
	const packRoot = join(process.cwd(), "build", "golpe-lan");
	const command =
		process.platform === "win32" ? "cmd.exe" : join(packRoot, "golpe-lan");
	const args =
		process.platform === "win32"
			? ["/c", join(packRoot, "golpe-lan.bat"), "--no-open", "--no-discovery"]
			: ["--no-open", "--no-discovery"];
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

	try {
		const health = await waitForHealth();
		if (health.build === "dev") {
			throw new Error("pack reported the dev build id");
		}

		const host = lanAddress();
		const browser = await launchBrowser();
		const roomCtx = await browser.newContext();
		const roomPage = await roomCtx.newPage();
		const room = `lan-badge-${Date.now().toString(36)}`;
		await roomPage.goto(
			`http://${host}:${PORT}/?online=true&room=${room}` +
				`&server=${host}:${PORT}&mute=1`,
		);
		let named = false;
		for (let i = 0; i < 40; i++) {
			const ready = await roomPage
				.evaluate(
					() =>
						typeof (window as unknown as { __setPlayerName?: unknown })
							.__setPlayerName === "function",
				)
				.catch(() => false);
			if (ready) {
				await roomPage.evaluate(() =>
					(
						window as unknown as { __setPlayerName: (n: string) => void }
					).__setPlayerName("LAN Host"),
				);
				named = true;
				break;
			}
			await roomPage.waitForTimeout(500);
		}
		if (!named) throw new Error("host client never installed its name hook");

		let hosted = false;
		for (let i = 0; i < 40; i++) {
			const data = (await fetch(`http://127.0.0.1:${PORT}/rooms`).then((r) =>
				r.json(),
			)) as { rooms?: { id?: string }[] };
			if (data.rooms?.some((r) => r.id === room)) {
				hosted = true;
				break;
			}
			await roomPage.waitForTimeout(500);
		}
		if (!hosted) throw new Error("host room never appeared in /rooms");

		const menuCtx = await browser.newContext();
		const menu = await menuCtx.newPage();
		await menu.goto(`http://${host}:${PORT}/`);
		await menu.waitForTimeout(1000);
		const skip = menu.getByRole("button", { name: "Skip for now" });
		if (await skip.count()) await skip.click();
		const join = menu.getByRole("button", { name: "Join a match" });
		if (await join.count()) await join.click();

		let rows: { text: string; lan: boolean; id: string; button: string }[] = [];
		for (let i = 0; i < 30; i++) {
			rows = await menu.locator(".gd-browser-row").evaluateAll((nodes) =>
				nodes.map((node) => ({
					text: (node as HTMLElement).innerText,
					lan: node.querySelector(".gd-badge-lan") !== null,
					id: node.querySelector(".gd-browser-id")?.textContent ?? "",
					button: node.querySelector("button")?.textContent ?? "",
				})),
			);
			if (rows.length > 0) break;
			await menu.waitForTimeout(500);
		}
		await browser.close();

		const first = rows[0];
		if (!first) throw new Error("server browser drew no rows");
		if (!first.lan) throw new Error("the host's own row is not badged LAN");
		if (!first.id.startsWith(room.slice(0, 8))) {
			throw new Error(`first row is not the host room: ${first.id}`);
		}
		if (first.button.trim() !== "Join") {
			throw new Error(
				`same-build LAN row should offer Join, got ${first.button}`,
			);
		}
		console.log(
			JSON.stringify(
				{
					ok: true,
					build: health.build,
					room,
					rows,
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error(output.slice(-4000));
		throw error;
	} finally {
		await stop(child);
	}
}

await main();
