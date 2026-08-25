#!/usr/bin/env node
/**
 * Dash reliability probe.
 *
 * The one-shot dash is delivered at the fixed-step boundary, but a rendered
 * frame can run zero physics steps (on a 120Hz+ display, roughly half of them).
 * This probe drives a fake `requestAnimationFrame` so every frame's dt is
 * exactly 8ms — a frame rate where half the frames run zero steps — then
 * double-taps a direction and asks whether the dash impulse reached the
 * simulation (`dashTimer` set), which is exactly the thing that used to be
 * dropped. 8ms frames at 60Hz physics = 52% zero-step frames.
 *
 *   tsx scripts/dash-probe.ts               # current build
 *   tsx scripts/dash-probe.ts --trials=40
 */
import { chromium } from "playwright";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const TRIALS = Number(
	process.argv.find((a) => a.startsWith("--trials="))?.split("=")[1] ?? 30,
);

// Control every rendered frame's dt: fake rAF + performance.now. The game's
// ticker, the gesture clock and Pixi all read these, so a frame of exactly 8ms
// is what the simulation actually sees. `waitForFunction` polls via rAF, which
// this fakes into silence — the probe polls with real timers instead.
const FAKE_FRAME = `
(() => {
	if (window.__fakeFrameInstalled) return;
	window.__fakeFrameInstalled = true;
	const callbacks = new Map();
	let nextId = 1;
	let fakeNow = 0;
	window.performance.now = () => fakeNow;
	window.requestAnimationFrame = (cb) => {
		const id = nextId++;
		callbacks.set(id, cb);
		return id;
	};
	window.cancelAnimationFrame = (id) => callbacks.delete(id);
	window.__frame = (dtMs) => {
		fakeNow += dtMs;
		const list = [...callbacks.values()];
		callbacks.clear();
		for (const cb of list) cb(fakeNow);
	};
})();
`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(FAKE_FRAME);
const page = await ctx.newPage();
const lines: string[] = [];
page.on("console", (m) => lines.push(m.text()));
page.on("pageerror", (e) => lines.push(`[PAGEERROR] ${e.message}`));

await page.goto(`${BASE_URL}/?offline=true&mute=1`);
for (
	let i = 0;
	i < 60 &&
	!(await page.evaluate(() => typeof window.__gameState === "function"));
	i++
) {
	await page.waitForTimeout(250);
}
await page.evaluate(() => window.__setPlayerName?.("DashProbe"));

const pump = (dtMs: number, n: number) =>
	page.evaluate(
		({ dt: d, n: k }) => {
			for (let i = 0; i < k; i++) window.__frame!(d);
		},
		{ dt: dtMs, n },
	);

await pump(8, 40); // settle into a standing, alive fighter

// Report the actual frame/step split, so the exposure is a measured fact.
await page.evaluate(() => window.__physicsDiagnostic!(2000));
await pump(8, 250);
await page.waitForTimeout(2300);
const hit = lines.find((l) => l.includes("__DIAGNOSTIC_RESULT__"));
let zeroPct = "n/a";
if (hit) {
	const json = hit.match(/__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s)?.[1];
	if (json) {
		const rep = JSON.parse(json) as {
			physicsStepDistribution?: { pctZeroStep: number };
		};
		zeroPct = String(rep.physicsStepDistribution?.pctZeroStep ?? "n/a");
	}
}

const doubleTap = async (key: string) => {
	// Two taps with nothing pumped between them: the fake clock does not move,
	// so both land well inside the double-tap window.
	await page.keyboard.down(key);
	await page.keyboard.up(key);
	await page.keyboard.down(key);
	await page.keyboard.up(key);
};

const dashApplied = () =>
	page.evaluate(() => {
		const p = window.__gameState!().playerPhys;
		// `dashTimer` is set whenever the simulation accepted a dash impulse,
		// even one the arena wall immediately eats — it is the delivery signal.
		return p.dashTimer > 0;
	});

let ok = 0;
const misses = [];
for (let trial = 0; trial < TRIALS; trial++) {
	await doubleTap("d");
	let landed = false;
	for (let f = 0; f < 8 && !landed; f++) {
		await pump(8, 1);
		if (await dashApplied()) landed = true;
	}
	if (landed) ok++;
	else misses.push(trial);
	// Clear the 250ms lockout: ~31 steps; at 8ms frames a step runs every two
	// frames, so ~64 frames. 90 is comfortable.
	await pump(8, 90);
}

console.log(
	JSON.stringify(
		{
			zeroStepFramesPct: zeroPct,
			trials: TRIALS,
			dashDelivered: ok,
			missedTrials: misses,
		},
		null,
		2,
	),
);

await ctx.close();
await browser.close();
