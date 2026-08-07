#!/usr/bin/env node
import type { Page } from "playwright";
/**
 * Multi-screen smoke probe: the `?screen=N` arena, online.
 *
 * Two checks, one room:
 *
 * 1. **The room is as wide as the creator asked.** Two AI clients open the
 *    same `?screen=3` room; both must report a 3-screen (2400px) world, the
 *    fighters must spawn across it, and the follow camera must scroll while
 *    staying inside the world.
 * 2. **A latecomer adopts the room's size, not its own URL.** A third client
 *    joins with `?screen=1` — the room was already created at 2 screens, so
 *    the server's `match` message must rebuild it to the room's world.
 *
 * The camera is the point of measuring here: camera scroll is read as a
 * jitter signal by the diagnostic, so `diagnose.ts --screens=N` proves the
 * follow cam never moves fast enough to read as a defect.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:8084";
const ROOM = `screenprobe-${Date.now().toString(36)}`;
const WIDE_URL = `${BASE}/?online=true&ai=true&room=${ROOM}&screen=3`;

function sink(page: Page) {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	return errors;
}

async function gameState(page: Page) {
	return page.evaluate(() => {
		const g = window.__gameState!();
		const m = window.__matchState?.();
		return {
			screens: g.worldScreens,
			width: g.worldWidth,
			x: Math.round(g.playerPhys?.x ?? -1),
			cameraX: Math.round(g.cameraX),
			cameraY: Math.round(g.cameraY),
			roomId: m?.roomId,
			fighters: m?.fighterCount,
		};
	});
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const a = await ctx.newPage();
const b = await ctx.newPage();
const errorsA = sink(a);
const errorsB = sink(b);

await a.goto(WIDE_URL);
await b.goto(WIDE_URL);
for (const p of [a, b]) {
	await p.waitForFunction(() => typeof window.__gameState === "function");
}
// Wait for seating + first snapshot.
await a.waitForTimeout(4000);

// --- Check 1: the 3-screen room ---
const samplesA = [];
const samplesB = [];
let cameraMoved = false;
for (let i = 0; i < 12; i++) {
	samplesA.push(await gameState(a));
	samplesB.push(await gameState(b));
	if (samplesA[samplesA.length - 1]!.cameraX > 5) cameraMoved = true;
	await a.waitForTimeout(1000);
}

const xs = [...samplesA.map((s) => s.x), ...samplesB.map((s) => s.x)];
const firstA = samplesA[0]!;
const firstB = samplesB[0]!;
const wide = {
	errors: [...errorsA, ...errorsB],
	screens: firstA.screens,
	width: firstA.width,
	roomMatch: firstA.roomId === firstB.roomId,
	fighters: firstA.fighters,
	cameraMoved,
	cameraMin: Math.min(...samplesA.map((s) => s.cameraX)),
	cameraMax: Math.max(...samplesA.map((s) => s.cameraX)),
	xMin: Math.min(...xs),
	xMax: Math.max(...xs),
};

const fail = [];
if (wide.errors.length) fail.push(`page errors: ${wide.errors}`);
if (wide.screens !== 3) fail.push(`worldScreens=${wide.screens}, want 3`);
if (wide.width !== 2400) fail.push(`worldWidth=${wide.width}, want 2400`);
if (!wide.roomMatch) fail.push("clients in different rooms");
// The bots converge to fight, so mid-run range is not the spawn distance — but
// a range wider than one screen proves the world was actually being crossed.
if (wide.xMax - wide.xMin <= 800) {
	fail.push(
		`fighters never left one screen (x range ${wide.xMin}..${wide.xMax})`,
	);
}
if (!wide.cameraMoved) fail.push("camera never scrolled on a 3-screen map");
if (wide.cameraMax > 1600)
	fail.push(`camera ran past the world (${wide.cameraMax})`);

// --- Check 2: the latecomer's world is the room's, not its URL's ---
const c = await ctx.newPage();
const errorsC = sink(c);
await c.goto(`${BASE}/?online=true&ai=true&room=${ROOM}&screen=1`);
await c.waitForFunction(() => typeof window.__gameState === "function");
await c.waitForTimeout(4000);
const latecomer = await gameState(c);
const join = {
	errors: errorsC,
	screens: latecomer.screens,
	width: latecomer.width,
};
if (join.errors.length) fail.push(`latecomer page errors: ${join.errors}`);
if (latecomer.screens !== 3 || latecomer.width !== 2400) {
	fail.push(
		`latecomer on a ${latecomer.screens}-screen world, want the room's 3`,
	);
}

console.log(JSON.stringify({ wide, join }, null, 2));
if (fail.length) {
	console.error(`FAIL:\n${fail.join("\n")}`);
	process.exit(1);
}
console.log(
	"PASS: wide room, spawns spread, camera scrolled, latecomer corrected",
);
await browser.close();
