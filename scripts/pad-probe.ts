#!/usr/bin/env node
/**
 * Controller-mode feedback-loop harness.
 *
 * Nothing else in the loop can see any of this. `diagnose.ts` runs AI vs AI and
 * the brains hand the simulation an angle directly — no stick is ever touched —
 * and `aim-probe.ts` measures the *cursor*, which controller mode does not use.
 * Playwright cannot press a physical gamepad button at all. So this probe stubs
 * `navigator.getGamepads` before the page loads and drives the game the way a
 * controller would, exactly as `controls-probe.ts` presses real keys.
 *
 * **The on-screen deck is not this probe's job any more.** It has its own
 * contract, its own layout and its own two-thumb sequences; `scripts/deck-probe.ts`
 * drives it with CDP touch and measures the gates that matter there. This file
 * still measures the physical pad, the two aim layers and mouse-as-stick.
 *
 * It measures the claims the scheme is made of:
 *
 *   1. the d-pad aims in eight directions, and the horizontal one is the same
 *      input that moves you, while the *left stick* aims continuously — a stick
 *      pushed at 30° aims at 30°, not at the nearest of eight (Contra),
 *   2. the right stick overrides that, at any angle, so you can run one way and
 *      aim the other,
 *   3. letting go of the right stick falls back to the d-pad's direction,
 *   4. sliding the mouse acts as a right stick — including running *up the arc*
 *      past 45°, which is the whole reason the rim rotates instead of clamping.
 *
 * Plus the two that make it a mode rather than a demo: pad buttons reach the
 * simulation through the ordinary bindings, and switching back to Mouse gives
 * the cursor its say again.
 *
 *   tsx scripts/pad-probe.ts
 *   GOLPE_URL=http://localhost:8084 tsx scripts/pad-probe.ts
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { GameStateSnapshot } from "../src/types/global";
import { launchBrowser, probeQuery } from "./browser";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";

/** Angle error worth reporting. Well below what a player can see. */
const ANGLE_TOLERANCE_DEG = 3;
/** A jump has to clear this much to count as one. A full jump peaks at 136px. */
const JUMP_RISE_PX = 60;

const DEG = 180 / Math.PI;
const deg = (rad: number): number => Math.round(rad * DEG * 10) / 10;

/** Signed smallest difference between two angles, in degrees. */
function angleGap(a: number, b: number): number {
	let d = ((a - b) * DEG) % 360;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}

/**
 * An empty room, and a fresh one per run.
 *
 * Bots are opt-in and a bot here would be pure noise: a fighter stunned by
 * somebody else cannot aim, and a frozen angle would be reported as a broken
 * scheme. Two runs sharing a room id would land in the same match.
 */
function gameUrl() {
	return `${BASE_URL}/?bots=0&room=${randomUUID()}&mute=1${probeQuery()}`;
}

/**
 * A fake standard-mapping gamepad, installed before any page script runs.
 *
 * The Gamepad API is polled rather than evented, so a stub is genuinely
 * equivalent to a real pad from the game's point of view: `readPads` gets the
 * same snapshot shape it would get from hardware, on the same schedule.
 *
 * Delivered as a *string*, like dash-probe's fake frame: esbuild's keepNames
 * decorates every inner arrow with `__name(fn, "name")`, Playwright serializes
 * that into the page, and the browser has no `__name` — the init script throws
 * and `window.__pad` is never installed. A string is serialized verbatim.
 */
const PAD_STUB = `
(() => {
	const state = { buttons: new Set(), axes: [0, 0, 0, 0] };
	window.__pad = {
		press: (i) => state.buttons.add(i),
		release: (i) => state.buttons.delete(i),
		clear: () => state.buttons.clear(),
		axis: (i, v) => {
			state.axes[i] = v;
		},
		axes: (values) => {
			state.axes = values;
		},
	};
	const snapshot = () => ({
		id: "probe pad (STANDARD GAMEPAD)",
		index: 0,
		connected: true,
		mapping: "standard",
		timestamp: performance.now(),
		vibrationActuator: null,
		axes: [...state.axes],
		buttons: Array.from({ length: 17 }, (_, i) => ({
			pressed: state.buttons.has(i),
			touched: state.buttons.has(i),
			value: state.buttons.has(i) ? 1 : 0,
		})),
	});
	navigator.getGamepads = () => [
		snapshot(),
		null,
		null,
		null,
	];
})();
`;

const inputState = (page: Page) => page.evaluate(() => window.__inputState!());
const gameState = (page: Page) => page.evaluate(() => window.__gameState!());

async function waitForGame(page: Page) {
	await page.waitForFunction(() => typeof window.__inputState === "function", {
		timeout: 20000,
	});
	// The same event the name modal fires — the path a player takes rather than a
	// bypass nobody plays.
	await page.evaluate(() => window.__setPlayerName?.("PadProbe"));
	await page.waitForFunction(
		() => window.__matchState?.()?.connected === true,
		{
			timeout: 20000,
		},
	);
	await settle(page);
}

/** Wait until the fighter is alive and standing still on the floor. */
async function settle(page: Page) {
	for (let i = 0; i < 80; i++) {
		const s = await gameState(page);
		if (s.playerHP > 0 && s.playerPhys.grounded) return s;
		await page.waitForTimeout(100);
	}
	return gameState(page);
}

/** Hold a set of pad buttons, sample, and release them. */
async function holdPad(page: Page, buttons: number[], ms = 220) {
	await page.evaluate((b) => {
		for (const i of b) window.__pad!.press(i);
	}, buttons);
	await page.waitForTimeout(ms);
	const during = { input: await inputState(page), game: await gameState(page) };
	await page.evaluate(() => window.__pad!.clear());
	await page.waitForTimeout(150);
	return during;
}

/** Push the right stick to an angle and report where the game ended up aiming. */
async function fineAimAt(page: Page, angleDeg: number, ms = 400) {
	const rad = angleDeg / DEG;
	await page.evaluate(
		([x, y]: number[]) => window.__pad!.axes([0, 0, x!, y!]),
		[Math.cos(rad), Math.sin(rad)],
	);
	await page.waitForTimeout(ms);
	return inputState(page);
}

async function recentreStick(page: Page) {
	await page.evaluate(() => window.__pad!.axes([0, 0, 0, 0]));
}

/**
 * Tilt the left stick to an angle and report where the game ended up aiming.
 *
 * The left stick is the *analog* Contra layer: it moves you through the same
 * quantised codes a d-pad uses, but it aims at exactly the angle it is pushed.
 * Sampling this is the only way to separate that from a stick that is just a
 * d-pad with extra steps.
 */
async function contraAimAt(page: Page, angleDeg: number, ms = 400) {
	const rad = angleDeg / DEG;
	await page.evaluate(
		([x, y]: number[]) => window.__pad!.axes([x!, y!, 0, 0]),
		[Math.cos(rad), Math.sin(rad)],
	);
	await page.waitForTimeout(ms);
	const input = await inputState(page);
	await page.evaluate(() => window.__pad!.axes([0, 0, 0, 0]));
	await page.waitForTimeout(150);
	return input;
}

/** One named pass/fail assertion. */
type Check = (name: string, ok: boolean, detail: string) => void;

async function run() {
	const browser = await launchBrowser();
	const ctx = await browser.newContext({
		viewport: { width: 900, height: 900 },
	});
	await ctx.addInitScript(PAD_STUB);
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	await page.goto(gameUrl());
	await waitForGame(page);

	const checks: { name: string; ok: boolean; detail: string }[] = [];
	const check: Check = (name, ok, detail) => checks.push({ name, ok, detail });
	const checkAngle = (
		name: string,
		got: number,
		wantDeg: number,
		extra = "",
	) => {
		const gap = Math.abs(angleGap(got, wantDeg / DEG));
		check(
			name,
			gap <= ANGLE_TOLERANCE_DEG,
			`aimed ${deg(got)}°, wanted ${wantDeg}°${extra ? ` (${extra})` : ""}`,
		);
	};

	// The arena is the largest 4:3 box the window allows, and the HUD overlays
	// exactly that box. Sizing used to come from the canvas's *intrinsic* pixels
	// (800 x devicePixelRatio), which made the same game too big on a retina
	// laptop and too small on a plain monitor, and its percentage max-height
	// never resolved against an auto-height parent — so a short window cropped
	// the arena instead of scaling it.
	const layout = await page.evaluate(() => {
		const canvas = document.querySelector("canvas");
		const box = document.getElementById("game-container");
		if (!canvas || !box) throw new Error("no canvas box");
		const c = canvas.getBoundingClientRect();
		const b = box.getBoundingClientRect();
		return {
			canvas: { x: c.x, y: c.y, width: c.width, height: c.height },
			box: { width: b.width, height: b.height },
			window: { width: window.innerWidth, height: window.innerHeight },
			scrollWidth: document.documentElement.scrollWidth,
		};
	});
	const shortAxis = Math.min(
		layout.window.height,
		layout.window.width * (3 / 4),
	);
	check(
		"the arena is a 4:3 box over the whole HUD box",
		Math.abs(layout.canvas.width / layout.canvas.height - 4 / 3) < 0.01 &&
			Math.abs(layout.canvas.width - layout.box.width) < 0.5 &&
			Math.abs(layout.canvas.height - layout.box.height) < 0.5,
		`${Math.round(layout.canvas.width)}x${Math.round(layout.canvas.height)}`,
	);
	check(
		"and it fills the short axis without leaving the window",
		Math.abs(layout.canvas.height - shortAxis) < 1 &&
			layout.canvas.x >= -0.5 &&
			layout.canvas.y >= -0.5 &&
			layout.canvas.x + layout.canvas.width <= layout.window.width + 1 &&
			layout.canvas.y + layout.canvas.height <= layout.window.height + 1 &&
			layout.scrollWidth <= layout.window.width,
		`${Math.round(layout.canvas.width)}x${Math.round(layout.canvas.height)} in ${layout.window.width}x${layout.window.height}`,
	);

	// ---- the scheme is a choice, and it starts on the mouse ----
	const initial = await inputState(page);
	check(
		"a desktop client starts on mouse aim",
		initial.scheme === "mouse",
		`scheme=${initial.scheme}`,
	);
	check(
		"no on-screen gamepad on a device with a real pointer",
		initial.deckVisible === false,
		`deckVisible=${initial.deckVisible}`,
	);

	await page.evaluate(() => window.__setInputScheme?.("controller"));
	await page.waitForTimeout(120);
	check(
		"the scheme switches",
		(await inputState(page)).scheme === "controller",
		"",
	);

	// ---- 1. the Contra layer: eight directions off the d-pad ----
	// 12 up, 13 down, 14 left, 15 right.
	const up = await holdPad(page, [12]);
	checkAngle("d-pad up aims straight up", up.input.aim.angle, -90);
	check(
		"aiming straight up does not snap the facing",
		up.input.face === 0,
		`face=${up.input.face}`,
	);

	const upRight = await holdPad(page, [12, 15]);
	checkAngle(
		"d-pad up+right aims on the diagonal",
		upRight.input.aim.angle,
		-45,
	);
	check(
		"the horizontal half of the aim is the same input that moves you",
		upRight.game.playerPhys.vx > 0,
		`vx=${Math.round(upRight.game.playerPhys.vx)}`,
	);

	await settle(page);
	const downLeft = await holdPad(page, [13, 14]);
	checkAngle(
		"d-pad down+left aims on the other diagonal",
		downLeft.input.aim.angle,
		135,
	);

	await settle(page);
	const released = await inputState(page);
	checkAngle(
		"releasing the d-pad keeps the direction it was pointing",
		released.aim.angle,
		135,
		"letting go must not make a fighter forget where it was looking",
	);

	// ---- the left stick aims continuously, not just in eights ----
	// A d-pad has eight directions and cannot help it; a stick pushed at 30° must
	// aim at 30°. The number that separates an analog Contra from a quantised one
	// is exactly this angle in between two of the eight.
	await settle(page);
	const tilted = await contraAimAt(page, 30);
	checkAngle(
		"a left stick pushed at 30° aims at 30°, not the nearest diagonal",
		tilted.aim.angle,
		30,
	);
	check(
		"and it is the Contra layer doing it",
		tilted.aim.blend === 0,
		`blend=${tilted.aim.blend.toFixed(2)}`,
	);

	await settle(page);
	const tiltedDown = await contraAimAt(page, -67);
	checkAngle(
		"a left stick pushed the other way aims continuously too",
		tiltedDown.aim.angle,
		-67,
	);

	// ---- 2. the fine layer overrides it, at any angle ----
	// Walk away from the right wall first. The point of this block is that the
	// fighter keeps *running* while it aims elsewhere, and a fighter pressed into
	// a wall has vx 0 for a reason that has nothing to do with aiming.
	await page.evaluate(() => window.__pad!.press(14));
	await page.waitForTimeout(900);
	await page.evaluate(() => window.__pad!.clear());
	await page.waitForTimeout(200);

	await page.evaluate(() => window.__pad!.press(15)); // run right
	let running: GameStateSnapshot | null = null;
	for (const want of [-90, -135, 180, 22.5, 67]) {
		const s = await fineAimAt(page, want);
		checkAngle(
			`the right stick aims at ${want}° while running right`,
			s.aim.angle,
			want,
		);
		// Sampled on the first angle, not after all five: two seconds of running
		// puts the fighter into the right-hand wall, and a fighter pressed into a
		// wall has vx 0 for a reason that has nothing to do with aiming.
		running ??= await gameState(page);
	}
	check(
		"the fighter is still running the other way while it aims",
		running!.playerPhys.vx > 0,
		`vx=${Math.round(running!.playerPhys.vx)}`,
	);

	// ---- 3. letting go falls back to the d-pad ----
	await recentreStick(page);
	// Hold: the ease-out is deliberately not instant.
	await page.waitForTimeout(600);
	const back = await inputState(page);
	checkAngle(
		"releasing the right stick falls back to the Contra aim",
		back.aim.angle,
		0,
		"running right, so the d-pad says right",
	);
	check(
		"and stops overriding entirely",
		back.aim.overriding === false,
		`blend=${back.aim.blend.toFixed(2)}`,
	);
	await page.evaluate(() => window.__pad!.clear());
	await settle(page);

	// ---- 4. the mouse as a right stick, for a trackpad ----
	const canvas = await page.locator("canvas").boundingBox();
	if (!canvas) throw new Error("no canvas to slide on");
	const cx = canvas.x + canvas.width / 2;
	const cy = canvas.y + canvas.height / 2;

	/**
	 * Slide the pointer by a delta, in small steps like a real hand.
	 *
	 * The pointer's position is tracked here rather than re-homed each time,
	 * because in this scheme the mouse is *relative*: jumping it back to the
	 * centre between strokes would itself be an enormous flick, and the second
	 * stroke would start from wherever that landed. It is also why the arc tests
	 * below run one after another — they are one continuous hand movement.
	 */
	let px = cx;
	let py = cy;
	const slide = async (dx: number, dy: number, steps = 12) => {
		for (let i = 1; i <= steps; i++) {
			await page.mouse.move(px + (dx * i) / steps, py + (dy * i) / steps);
			await page.waitForTimeout(12);
		}
		px += dx;
		py += dy;
		await page.waitForTimeout(200);
	};

	// Home the pointer, then wait out the hold and the ease-out, so the stroke
	// under test starts from a stick at rest rather than from the flick that
	// getting there was.
	await page.mouse.move(px, py);
	await page.waitForTimeout(1400);

	// Aim right first, from the d-pad, so the arc has somewhere to start.
	await page.evaluate(() => window.__pad!.press(15));
	await page.waitForTimeout(200);
	await page.evaluate(() => window.__pad!.clear());

	await slide(160, 0);
	const slidRight = await inputState(page);
	checkAngle("sliding the mouse right aims right", slidRight.aim.angle, 0);

	// The whole feature. From the rim, a stroke straight up must *run up the arc*
	// rather than crawl: a clamping implementation is at 63° after two radii and
	// never arrives.
	await slide(0, -200);
	const slidUp = await inputState(page);
	check(
		"a stroke upward from the right runs up the arc past 45°",
		deg(slidUp.aim.angle) < -75,
		`reached ${deg(slidUp.aim.angle)}° (a clamping stick stalls around -63°)`,
	);

	await slide(-200, 0);
	const slidLeft = await inputState(page);
	check(
		"the stroke carries on round rather than stopping at vertical",
		Math.abs(deg(slidLeft.aim.angle)) > 100,
		`reached ${deg(slidLeft.aim.angle)}°`,
	);

	// ---- the mouse has no spring, so a hold window decides when it lets go ----
	await page.evaluate(() => window.__pad!.press(15)); // Contra says right
	await page.waitForTimeout(200);
	const holding = await inputState(page);
	check(
		"a mouse left alone keeps its aim for the hold window",
		holding.aim.overriding === true,
		`blend=${holding.aim.blend.toFixed(2)} after 200ms`,
	);
	await page.waitForTimeout(1400);
	const decayed = await inputState(page);
	checkAngle(
		"and then resets to the Contra aim on its own",
		decayed.aim.angle,
		0,
	);
	await page.evaluate(() => window.__pad!.clear());
	await settle(page);

	// ---- pad buttons reach the simulation through the ordinary bindings ----
	const blocked = await holdPad(page, [6]); // LT
	check(
		"the left trigger blocks",
		blocked.game.playerPhys.blocking === true,
		`blocking=${blocked.game.playerPhys.blocking}`,
	);

	await settle(page);
	const before = await gameState(page);
	await page.evaluate(() => window.__pad!.press(0)); // A
	let peak = before.playerPhys.y;
	for (let i = 0; i < 8; i++) {
		await page.waitForTimeout(60);
		peak = Math.min(peak, (await gameState(page)).playerPhys.y);
	}
	await page.evaluate(() => window.__pad!.clear());
	const rise = Math.round(before.playerPhys.y - peak);
	check(
		"the pad's bottom face button jumps",
		rise >= JUMP_RISE_PX,
		`rose ${rise}px`,
	);

	await settle(page);
	const stance = await holdPad(page, [5]); // RB
	check(
		"a shoulder button swaps stance",
		stance.game.playerPhys.stance === "gun",
		`stance=${stance.game.playerPhys.stance}`,
	);
	await holdPad(page, [4]);

	// ---- and the mouse gets its say back ----
	await page.evaluate(() => window.__setInputScheme?.("mouse"));
	await page.waitForTimeout(150);
	const aim = await page.evaluate(() => window.__aimState!());
	await page.mouse.move(
		canvas.x + (aim.centreX / 800) * canvas.width,
		canvas.y + ((aim.centreY - 200) / 600) * canvas.height,
	);
	await page.waitForTimeout(200);
	const backToMouse = await page.evaluate(() => window.__aimState!());
	checkAngle(
		"switching back to Mouse gives the cursor its say again",
		backToMouse.aimAngle,
		-90,
	);

	// ---- it survives a reload, like every other preference ----
	await page.evaluate(() => window.__setInputScheme?.("controller"));
	await page.waitForTimeout(120);
	await page.goto(gameUrl());
	await waitForGame(page);
	check(
		"the scheme survives a reload",
		(await inputState(page)).scheme === "controller",
		"",
	);

	// ---- native zoom scales the pinned arena ----
	//
	// A viewport-sized box re-fits at every zoom level, so Ctrl/Cmd +/- fills the
	// window exactly as before and reads as broken. A zoom is emulated the way a
	// browser performs it: the CSS viewport shrinks while the physical viewport
	// (CSS size x devicePixelRatio) stays put. The pinned box keeps its CSS size,
	// which means zoom in grows it past the window and scrolls.
	const beforeZoom = await page.evaluate(() => {
		const box = document.getElementById("game-container");
		if (!box) throw new Error("no canvas box");
		const rect = box.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	});
	const cdp = await ctx.newCDPSession(page);
	const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: Math.round(900 / 1.25),
		height: Math.round(900 / 1.25),
		deviceScaleFactor: dpr * 1.25,
		mobile: false,
	});
	await page.waitForTimeout(300);
	const zoomed = await page.evaluate(() => {
		const box = document.getElementById("game-container");
		const app = document.getElementById("app");
		if (!box || !app) throw new Error("no canvas box");
		const rect = box.getBoundingClientRect();
		return {
			width: rect.width,
			height: rect.height,
			scrollable:
				app.scrollWidth > app.clientWidth ||
				app.scrollHeight > app.clientHeight,
			zoomedClass: app.classList.contains("is-zoomed"),
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
		};
	});
	check(
		"browser zoom scales the arena instead of re-fitting it",
		Math.abs(zoomed.width - beforeZoom.width) < 1 &&
			Math.abs(zoomed.height - beforeZoom.height) < 1 &&
			zoomed.zoomedClass &&
			zoomed.scrollable,
		`${Math.round(zoomed.width)}x${Math.round(zoomed.height)} in ${zoomed.innerWidth}x${zoomed.innerHeight}`,
	);

	if (errors.length) check("no page errors", false, errors.join(" | "));
	await ctx.close();

	await browser.close();

	const failures = checks.filter((c) => !c.ok);
	return {
		verdict: failures.length ? "FAIL" : "PASS",
		passed: checks.length - failures.length,
		of: checks.length,
		checks,
	};
}

run()
	.then((report) => {
		console.log("\n===== CONTROLLER =====");
		console.log(JSON.stringify(report, null, 2));
		process.exit(report.verdict === "FAIL" ? 1 : 0);
	})
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
