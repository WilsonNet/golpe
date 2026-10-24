#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import type { MatchStateSnapshot } from "../src/types/global";
import { gameServerUrl, launchBrowser } from "./browser";

/**
 * The scoreboard's ping column, measured end to end.
 *
 * A latency number is easy to fake and easy to break silently: an HTTP probe
 * that never leaves this machine reads ~0, a stale map reads a plausible
 * constant, and a formatted `NaN` reads as `NaNms` on a row nobody looks at.
 * This probe proves the number is about the *fight's* link:
 *
 *   1. the server's `pings` map has an entry for each human and none for bots,
 *   2. a client with `?netsim=40/...` reads roughly 80ms — twice the shaped
 *      one-way latency — while its unshaped neighbour reads single digits,
 *   3. the Tab scoreboard draws the same numbers, with a dash for every bot,
 *   4. no HTTP request goes to the game server while the counter is running,
 *      which is the "no fetch, no CORS preflight" half of the design,
 *   5. holding Tab for several seconds does not stop the match.
 *
 *   tsx scripts/ping-probe.ts
 *   tsx scripts/ping-probe.ts --runs=2
 */
const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const SERVER = process.env.GOLPE_SERVER ?? "";
/** One-way latency on the shaped client. A round trip is twice this. */
const SHAPED_MS = 40;
const SHAPED_JITTER_MS = 5;

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const RUNS = Math.max(1, Number(arg("runs", "1")) || 1);
const OUT = ".playwright-mcp/ping";
const TIMEOUT_MS = 20_000;

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(58)} ${detail}`);
	if (!ok) failed = true;
};

async function assertServerUp() {
	const res = await fetch(`${gameServerUrl()}/health`).catch(() => null);
	if (!res) {
		throw new Error(
			`game server unreachable on ${gameServerUrl()} — start it with \`pnpm run dev:herdr\``,
		);
	}
}

function gameUrl(
	room: string,
	/** Total fighters the creator asks the room to keep filled with bots. */
	fill: number | null,
	netsim: boolean,
): string {
	const server = SERVER ? `&server=${SERVER}` : "";
	const shape = netsim
		? `&netsim=${SHAPED_MS}/${SHAPED_JITTER_MS}/0`
		: "";
	const seats = fill === null ? "" : `&fill=${fill}`;
	return (
		`${BASE_URL}/?ai=true&hero=lia&room=${room}&mute=1` +
		`&scoreLimit=999&timeLimit=120${seats}${server}${shape}`
	);
}

/** Wait until this page has a channel id and is seated, not just booted. */
async function waitForSeated(
	page: Page,
	timeoutMs: number,
): Promise<MatchStateSnapshot | null> {
	const deadline = Date.now() + timeoutMs;
	let last: MatchStateSnapshot | null = null;
	while (Date.now() < deadline) {
		last = await page.evaluate(() => window.__matchState?.() ?? null);
		if (last?.connected && last.myId !== "") return last;
		await page.waitForTimeout(200);
	}
	return last;
}

async function waitForPings(
	page: Page,
	ids: string[],
	timeoutMs: number,
): Promise<MatchStateSnapshot | null> {
	const deadline = Date.now() + timeoutMs;
	let last: MatchStateSnapshot | null = null;
	while (Date.now() < deadline) {
		last = await page.evaluate(() => window.__matchState?.() ?? null);
		const pings = last?.net?.pings ?? {};
		if (last?.connected && ids.every((id) => typeof pings[id] === "number")) {
			return last;
		}
		await page.waitForTimeout(200);
	}
	return last;
}

/** One reading of the live scoreboard, row by row. */
interface BoardRow {
	name: string;
	ping: string;
	me: boolean;
	bot: boolean;
}

async function readBoard(page: Page): Promise<BoardRow[]> {
	return page.locator(".gd-board .gd-table tbody tr").evaluateAll((rows) =>
		rows.map((row) => {
			const cells = row.querySelectorAll("td");
			return {
				name: (cells[1]?.textContent ?? "").trim(),
				ping: (row.querySelector(".gd-ping")?.textContent ?? "").trim(),
				me: row.classList.contains("gd-me"),
				bot: row.querySelector(".gd-tag") !== null,
			};
		}),
	);
}

async function run(browser: Browser, shaped: boolean) {
	const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
	const page = await ctx.newPage();
	const other = await ctx.newPage();
	const errors: string[] = [];
	for (const p of [page, other]) {
		p.on("pageerror", (e) => errors.push(e.message));
		p.on("console", (m) => {
			if (m.type() === "error") errors.push(m.text());
		});
	}

	const room = `ping-${shaped ? "shaped" : "local"}-${randomUUID().slice(0, 8)}`;
	await page.goto(gameUrl(room, 4, shaped));
	await page.waitForFunction(() => typeof window.__matchState === "function", {
		timeout: TIMEOUT_MS,
	});
	const first = await waitForSeated(page, TIMEOUT_MS);
	await other.goto(gameUrl(room, null, false));
	await other.waitForFunction(() => typeof window.__matchState === "function", {
		timeout: TIMEOUT_MS,
	});

	const second = await waitForSeated(other, TIMEOUT_MS);
	if (!first || !second) {
		check(false, `${shaped ? "shaped" : "local"}: both clients booted`);
		await ctx.close();
		return;
	}
	const ids = [first.myId, second.myId];
	const state = await waitForPings(page, ids, TIMEOUT_MS);
	const pings = state?.net?.pings ?? {};
	const mine = pings[first.myId];
	const neighbour = pings[second.myId];

	console.log(
		`\n=== ${shaped ? `shaped +${SHAPED_MS}ms each way` : "localhost"} · room ${room} ===`,
	);
	check(state?.connected === true, "the client is seated and receiving snapshots");
	check(typeof mine === "number", "the server measured this client's ping", `${mine}`);
	check(
		typeof neighbour === "number",
		"the server measured the other human's ping",
		`${neighbour}`,
	);
	if (shaped) {
		check(
			(mine ?? 0) >= SHAPED_MS * 2 - 20,
			`the shaped client reads ~${SHAPED_MS * 2}ms`,
			`${mine}ms`,
		);
		check(
			(neighbour ?? Infinity) < 60,
			"its unshaped neighbour stays on single-digit localhost latency",
			`${neighbour}ms`,
		);
	} else {
		check(
			(mine ?? Infinity) < 60,
			"localhost reads under 60ms",
			`${mine}ms`,
		);
		check(
			(neighbour ?? Infinity) < 60,
			"and so does the other client",
			`${neighbour}ms`,
		);
	}

	// Bots are server-hosted: no channel, no round trip, no fabricated zero.
	const bots = state?.standings.filter((s) => s.bot) ?? [];
	check(bots.length >= 2, "the room has bots to prove the dash with", `${bots.length}`);
	check(
		bots.every((bot) => typeof pings[bot.id] !== "number"),
		"bots are absent from the ping map",
	);

	// While the scoreboard is open, watch the game server's HTTP port. A fetch
	// ping — with or without a CORS preflight — would show up here.
	const gamePort = new URL(gameServerUrl()).port;
	const http: string[] = [];
	let counting = false;
	page.on("request", (req) => {
		if (!counting) return;
		try {
			const url = new URL(req.url());
			if (url.port !== gamePort) return;
			// WebRTC trickles ICE candidates over its own signalling path; that is
			// the connection being alive, not a latency probe. Everything else on
			// this port would be a fetch — which is exactly what must not exist.
			if (url.pathname.startsWith("/.wrtc/")) return;
			http.push(req.url());
		} catch {
			// A non-URL request cannot be one of ours.
		}
	});

	await page.keyboard.down("Tab");
	await page.waitForSelector(".gd-board .gd-ping", { timeout: 5000 });
	const before = await page.evaluate(() => window.__matchState?.() ?? null);

	counting = true;
	await page.waitForTimeout(2500);
	counting = false;

	const after = await page.evaluate(() => window.__matchState?.() ?? null);
	const rows = await readBoard(page);
	// The server may have deduplicated the name it assigned; the standings row
	// is the name the scoreboard actually drew.
	const secondName =
		state?.standings.find((s) => s.id === second.myId)?.name ?? second.myName;
	const me = rows.find((r) => r.me);
	const them = rows.find(
		(r) => !r.me && !r.bot && r.name.includes(secondName),
	);
	const dashes = rows.filter((r) => r.bot && r.ping === "—").length;

	check(rows.length >= 4, "the scoreboard drew every fighter", `${rows.length} rows`);
	check(
		me !== undefined && Number.isFinite(Number.parseInt(me.ping, 10)),
		"this player's row shows a numeric ping",
		me?.ping ?? "no row",
	);
	check(
		them !== undefined && Number.isFinite(Number.parseInt(them.ping, 10)),
		"the other human's row shows a numeric ping",
		them?.ping ?? "no row",
	);
	check(
		dashes === bots.length,
		"every bot row shows a dash, not 0ms",
		`${dashes} dashes / ${bots.length} bots`,
	);
	check(
		http.length === 0,
		"no HTTP request to the game server while timing",
		http.length === 0 ? "0 requests" : http.join(", "),
	);
	check(
		(after?.elapsedMs ?? 0) > (before?.elapsedMs ?? 0),
		"the match kept running with the scoreboard held",
		`${before?.elapsedMs ?? 0} -> ${after?.elapsedMs ?? 0}ms`,
	);
	check(errors.length === 0, "no page errors", errors.slice(0, 2).join(" | "));

	await page.screenshot({ path: `${OUT}/${shaped ? "shaped" : "local"}.png` });
	await page.keyboard.up("Tab");
	await ctx.close();
}

async function main() {
	await assertServerUp();
	await mkdir(OUT, { recursive: true });
	const browser = await launchBrowser();
	try {
		for (let i = 1; i <= RUNS; i++) {
			console.log(`\n[PROBE] run ${i}/${RUNS}`);
			await run(browser, false);
			await run(browser, true);
		}
	} finally {
		await browser.close();
	}
	if (failed) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
