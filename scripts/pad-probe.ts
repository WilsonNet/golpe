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
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import type { GameStateSnapshot } from "../src/types/global";

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
	return `${BASE_URL}/?bots=0&room=${randomUUID()}&mute=1`;
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

/**
 * The on-screen gamepad, on a phone-shaped browser.
 *
 * A separate context because the deck is decided by `(pointer: coarse)`, which
 * is a property of the *context* — `hasTouch` is what makes Chromium answer that
 * query the way a phone does, and it cannot be changed on a live page.
 *
 * The deck's controls are ordinary DOM, so this taps them the way a thumb does
 * and reads the simulation back. It is the same argument as `controls-probe.ts`
 * pressing real keys: an emitted event proves the wiring, a tap proves the game.
 */
async function runTouchDeck(browser: Browser, check: Check) {
	const ctx = await browser.newContext({
		// A portrait phone: the whole reason the deck exists is the empty half of
		// the screen a 4:3 game leaves below itself here.
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
	});
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	/**
	 * A real finger, not a synthetic mouse.
	 *
	 * `page.mouse.*` reports `pointerType: "mouse"` even inside a `hasTouch`
	 * context, and the two are **not** interchangeable here: the relative-mouse aim
	 * layer is filtered on exactly that field, so a probe that drove the deck with
	 * `page.mouse` would be blind to every bug in the filter. CDP touch events are
	 * the only way to get a pointer the game will agree is a thumb.
	 */
	const cdp = await ctx.newCDPSession(page);
	const touch = {
		start: (x: number, y: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y }],
			}),
		move: (x: number, y: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x, y }],
			}),
		end: () =>
			cdp.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			}),
	};
	/** Hold a point for `ms`, sample, and lift. */
	const holdTouch = async (x: number, y: number, ms = 500) => {
		await touch.start(x, y);
		await page.waitForTimeout(ms);
		const sample = {
			game: await gameState(page),
			input: await inputState(page),
		};
		await touch.end();
		await page.waitForTimeout(200);
		return sample;
	};

	await page.goto(gameUrl());
	await waitForGame(page);

	const state = await inputState(page);
	check(
		"a touch device starts in controller mode",
		state.scheme === "controller",
		`scheme=${state.scheme}`,
	);
	check(
		"and is given an on-screen gamepad",
		state.deckVisible === true,
		`deckVisible=${state.deckVisible}`,
	);

	const deck = page.locator(".gg-deck");
	check("the deck is drawn", (await deck.count()) === 1, "");

	// The screen and the controls each get a share of the phone. Neither may spill
	// off it, which is the failure this layout exists to avoid.
	const canvas = await page.locator("canvas").boundingBox();
	const deckBox = await deck.boundingBox();
	if (!canvas || !deckBox) throw new Error("deck or canvas not laid out");
	check(
		"the game and the deck both fit on the screen",
		canvas.y + canvas.height <= deckBox.y + 1 &&
			deckBox.y + deckBox.height <= 845,
		`canvas ends at ${Math.round(canvas.y + canvas.height)}, deck ${Math.round(deckBox.y)}–${Math.round(deckBox.y + deckBox.height)}`,
	);
	check(
		"the game keeps its 4:3 shape",
		Math.abs(canvas.width / canvas.height - 4 / 3) < 0.02,
		`${Math.round(canvas.width)}x${Math.round(canvas.height)}`,
	);
	check(
		"the page does not scroll sideways",
		(await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		)) === true,
		"",
	);

	// A thumb on the right arm of the cross. One control, eight sectors — so the
	// touch point decides the direction, not which of four buttons was hit.
	const cross = await page.locator(".gg-cross").boundingBox();
	if (!cross) throw new Error("cross not laid out");
	const before = await gameState(page);
	const walking = await holdTouch(
		cross.x + cross.width * 0.88,
		cross.y + cross.height / 2,
	);
	check(
		"a thumb on the cross walks the fighter",
		walking.game.playerPhys.x - before.playerPhys.x > 20,
		`moved ${Math.round(walking.game.playerPhys.x - before.playerPhys.x)}px`,
	);
	check(
		"the left stick is drawn as an analog pad, not a d-pad",
		(await page.locator(".gg-cross-nub").count()) === 1 &&
			(await page.locator(".gg-cross-arm").count()) === 0,
		"",
	);

	/**
	 * **A thumb drag is not a trackpad stroke.**
	 *
	 * `movementX`/`movementY` are populated for *touch* pointers too, so the
	 * relative-mouse fine-aim layer — which exists for a laptop with no controller
	 * — was being driven by every thumb that slid across the d-pad. Pressing *up*
	 * on the cross reported an aim of 76° with the fine layer fully engaged: the
	 * travel of the thumb across the glass beat the direction it was pressing.
	 *
	 * Only reachable with a real touch pointer, which is why this section uses CDP
	 * rather than `page.mouse`.
	 */
	await settle(page);
	// The thumb slides *rightward along the left arm* — so the direction it is
	// pressing (left) and the direction it is travelling (right) disagree. That
	// disagreement is the only thing that separates a correct build from the bug:
	// a drag toward a d-pad arm points the virtual stick the same way the arm does,
	// and the two agree by accident.
	const armY = cross.y + cross.height * 0.5;
	await touch.start(cross.x + cross.width * 0.03, armY);
	for (const t of [0.09, 0.15, 0.21, 0.27, 0.3]) {
		await touch.move(cross.x + cross.width * t, armY);
		await page.waitForTimeout(35);
	}
	await page.waitForTimeout(400);
	const slid = await inputState(page);
	await touch.end();
	await page.waitForTimeout(250);
	check(
		"a thumb sliding across the cross does not steer the aim",
		Math.abs(angleGap(slid.aim.angle, Math.PI)) <= ANGLE_TOLERANCE_DEG,
		`aimed ${deg(slid.aim.angle)}° while holding left and dragging right, wanted 180°`,
	);
	check(
		"and a thumb drag never engages the fine layer",
		slid.aim.blend === 0,
		`blend=${slid.aim.blend.toFixed(2)} — the deck's thumb pad is the touch fine-aim, not the glass`,
	);

	/**
	 * **Every deck button used to also swing the sword.**
	 *
	 * `Input` listens for `pointerdown` on `window` — it has to, so a drag that
	 * starts on the canvas keeps being tracked when it leaves — and button 0 is
	 * `Mouse0`, which is attack. The deck is DOM sitting on that same window, so a
	 * thumb on Jump jumped *and* slashed, and so did the d-pad, the stance pills
	 * and the menu button. `preventDefault` in the deck's handler cannot fix it: it
	 * stops the browser's default, not another listener on the same event.
	 *
	 * Checked on Jump, because a button whose real action is obvious is the one
	 * where a spurious second action hides.
	 */
	const jump = await page.locator(".gg-btn.jump").boundingBox();
	if (!jump) throw new Error("jump button not laid out");
	await settle(page);
	const jumping = await holdTouch(
		jump.x + jump.width / 2,
		jump.y + jump.height / 2,
		140,
	);
	check(
		"a deck button does not also swing the sword",
		jumping.game.playerPhys.meleeAction === "none",
		`meleeAction=${jumping.game.playerPhys.meleeAction}`,
	);
	check(
		"and still does its own job",
		jumping.game.playerPhys.grounded === false ||
			jumping.game.playerPhys.vy < 0,
		`vy=${Math.round(jumping.game.playerPhys.vy)} grounded=${jumping.game.playerPhys.grounded}`,
	);

	// Same trap, one layer out: the d-pad is a plain div on the same window.
	await settle(page);
	const crossHeld = await holdTouch(
		cross.x + cross.width * 0.88,
		cross.y + cross.height / 2,
		140,
	);
	check(
		"nor does the d-pad",
		crossHeld.game.playerPhys.meleeAction === "none",
		`meleeAction=${crossHeld.game.playerPhys.meleeAction}`,
	);

	// The screen is the whole width of the phone: no bezel, no padding, no
	// rounding. 20px of frame is 5% of a 390px arena a player then cannot see.
	check(
		"the game screen reaches both edges of the phone",
		canvas.x <= 1 && canvas.width >= 388,
		`canvas x=${Math.round(canvas.x)} w=${Math.round(canvas.width)}`,
	);

	// The thumb pad is the fine layer, and on a touchscreen it is the *only* fine
	// layer: absolute, full 360, and it recentres. The deck is in sword stance by
	// default, so a thumb on the pad must aim without slashing.
	const stick = await page.locator(".gg-stick").boundingBox();
	if (!stick) throw new Error("thumb pad not laid out");
	await touch.start(stick.x + stick.width / 2, stick.y + stick.height / 2);
	await touch.move(stick.x + stick.width / 2, stick.y - 40);
	await page.waitForTimeout(500);
	const aiming = await inputState(page);
	check(
		"the thumb pad aims where the thumb is",
		Math.abs(angleGap(aiming.aim.angle, -Math.PI / 2)) <= ANGLE_TOLERANCE_DEG,
		`aimed ${deg(aiming.aim.angle)}°, wanted -90°`,
	);
	check(
		"and it is the fine layer doing it",
		aiming.aim.blend > 0.9,
		`blend=${aiming.aim.blend.toFixed(2)}`,
	);
	const swordHold = await gameState(page);
	check(
		"and does not slash while the stance is sword",
		swordHold.playerPhys.meleeAction === "none",
		`meleeAction=${swordHold.playerPhys.meleeAction}`,
	);
	await touch.end();
	await page.waitForTimeout(700);
	check(
		"letting go of the thumb pad hands the aim back",
		(await inputState(page)).aim.overriding === false,
		"",
	);

	// ---- in gun mode the aim stick is the trigger too ----
	// On a phone the right thumb is on this pad, and there is no spare finger for
	// the fire button — so in gun stance the pad aims *and* fires, which is what
	// makes a phone gun a twin-stick shooter. The stance pill is real DOM, so a
	// tap proves the path a player takes. The stance also decides which face
	// buttons are worth drawing: block and uppercut are sword moves, so a gunner
	// should not be shown buttons that do nothing.
	check(
		"sword stance draws the sword-only buttons",
		(await page.locator(".gg-btn.block").count()) === 1 &&
			(await page.locator(".gg-btn.upper").count()) === 1,
		"",
	);
	await settle(page);
	await page.locator(".gg-pill").filter({ hasText: "Gun" }).tap();
	await page.waitForTimeout(300);
	const gunBefore = await gameState(page);
	check(
		"the deck's Gun pill switched the stance",
		gunBefore.playerPhys.stance === "gun",
		`stance=${gunBefore.playerPhys.stance}`,
	);
	check(
		"gun stance hides the sword-only buttons",
		(await page.locator(".gg-btn.block").count()) === 0 &&
			(await page.locator(".gg-btn.upper").count()) === 0,
		"",
	);
	await touch.start(stick.x + stick.width / 2, stick.y + stick.height / 2);
	await touch.move(stick.x + stick.width / 2, stick.y - 40);
	// A bullet is live only while it is inside the world, and the client sees it
	// once the server's snapshot arrives — so poll a few times and take the peak
	// rather than gambling on one sample landing inside that window.
	let peakBullets = gunBefore.bulletCount;
	for (let i = 0; i < 4; i++) {
		await page.waitForTimeout(150);
		peakBullets = Math.max(peakBullets, (await gameState(page)).bulletCount);
	}
	await touch.end();
	await page.waitForTimeout(150);
	check(
		"in gun mode the aim stick fires the gun",
		peakBullets > gunBefore.bulletCount,
		`bullets ${gunBefore.bulletCount} → ${peakBullets}`,
	);

	// ---- the cross is the deck's left stick: continuous, not just eight ----
	// The sector code still *moves* the fighter in eight directions, but the raw
	// thumb position is the Contra aim, so a thumb at 30° aims at 30° — the same
	// analog deal a physical left stick gets.
	await settle(page);
	const ccx = cross.x + cross.width / 2;
	const ccy = cross.y + cross.height / 2;
	const r30 = (Math.PI / 180) * 30;
	const thumbR = cross.width * 0.3;
	await touch.start(ccx + Math.cos(r30) * thumbR, ccy - Math.sin(r30) * thumbR);
	await page.waitForTimeout(500);
	const crossAim = await inputState(page);
	await touch.end();
	await page.waitForTimeout(200);
	check(
		"a thumb at 30° on the cross aims at 30°, not the nearest sector",
		Math.abs(angleGap(crossAim.aim.angle, -Math.PI / 6)) <= ANGLE_TOLERANCE_DEG,
		`aimed ${deg(crossAim.aim.angle)}°, wanted -30°`,
	);
	check(
		"and it is the Contra layer doing it",
		crossAim.aim.blend === 0,
		`blend=${crossAim.aim.blend.toFixed(2)}`,
	);

	// And the whole thing has to be undoable, or choosing it on a phone is a trap.
	await page.locator(".gg-menu").click();
	await page.getByRole("button", { name: "Controls" }).click();
	await page.locator(".gd-choice").first().getByText("Mouse").click();
	await page.waitForTimeout(150);
	check(
		"the deck's own menu button can send the deck away",
		(await page.locator(".gg-deck").count()) === 0,
		"a phone has no Escape key, so this is the only way back",
	);

	if (errors.length)
		check("no page errors on mobile", false, errors.join(" | "));
	await ctx.close();
}

/** One named pass/fail assertion. */
type Check = (name: string, ok: boolean, detail: string) => void;

async function run() {
	const browser = await chromium.launch();
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

	if (errors.length) check("no page errors", false, errors.join(" | "));
	await ctx.close();

	await runTouchDeck(browser, check);
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
