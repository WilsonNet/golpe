#!/usr/bin/env node
/**
 * Aim feedback-loop harness.
 *
 * `diagnose.mjs` cannot see aim at all: AI vs AI is the canonical run, and the
 * brains hand the simulation an angle directly — no cursor is ever involved. So
 * a broken screen→world conversion, or a facing that refuses to follow the
 * pointer, shows up nowhere in that report and only as "the game struggles to
 * follow the mouse".
 *
 * This drives a real cursor around a real canvas and checks three things:
 *
 *   1. the cursor maps to the right world point,
 *   2. the fighter faces the side the cursor is on,
 *   3. a shot leaves along the cursor's angle.
 *
 * `--dpr` is load-bearing: the conversion has to divide by the *logical* size,
 * and every backing-store bug hides at devicePixelRatio 1. Run it at 2.
 *
 *   node scripts/aim-probe.mjs                 # dpr 1 and 2
 *   node scripts/aim-probe.mjs --dpr=2
 *   node scripts/aim-probe.mjs --mode=offline
 */
import { chromium } from "playwright";

const BASE_URL = process.env.VENTO_URL ?? "http://localhost:8084";

/** The logical world the game is authored in. Must match `app.ts`. */
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

/** Angle error worth reporting. A degree is well below what a player can see. */
const ANGLE_TOLERANCE_RAD = (1.5 * Math.PI) / 180;
/** Cursor mapping error worth reporting, in world pixels. */
const POINTER_TOLERANCE_PX = 2;
/** Straight above the fighter there is no side to face. */
const FACING_DEADZONE_PX = 6;
/**
 * How long the fighter may take to turn to a cursor on its other side while
 * attacking. One slash's recovery (170ms) plus a snapshot interval of slack:
 * long enough that a committed swing still lands where it was aimed, short
 * enough that the pointer is never ignored for a noticeable beat.
 */
const TURN_TOLERANCE_MS = 260;

function arg(name, fallback) {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split("=")[1] : fallback;
}

const MODE = arg("mode", "online");
const DPRS = arg("dpr") ? [Number(arg("dpr"))] : [1, 2];

/** Signed smallest difference between two angles. */
function angleDelta(a, b) {
	let d = a - b;
	while (d > Math.PI) d -= 2 * Math.PI;
	while (d < -Math.PI) d += 2 * Math.PI;
	return d;
}

const deg = (rad) => Math.round(((rad * 180) / Math.PI) * 10) / 10;

async function waitForGame(page) {
	await page.waitForFunction(() => typeof window.__aimState === "function", {
		timeout: 20000,
	});
}

/** Canvas rect in CSS pixels — the only frame Playwright's mouse speaks. */
async function canvasRect(page) {
	const r = await page.evaluate(() => {
		const c = document.querySelector("canvas");
		const b = c.getBoundingClientRect();
		return {
			x: b.x,
			y: b.y,
			width: b.width,
			height: b.height,
			innerWidth: window.innerWidth,
			innerHeight: window.innerHeight,
		};
	});
	if (r.y + r.height > r.innerHeight + 1 || r.x + r.width > r.innerWidth + 1) {
		throw new Error(
			`canvas ${Math.round(r.width)}x${Math.round(r.height)} does not fit the ` +
				`${r.innerWidth}x${r.innerHeight} window — the cursor cannot reach all ` +
				"of it, and the samples it cannot reach would read as aim bugs",
		);
	}
	return r;
}

/**
 * Move the cursor to a world point and report what the game made of it.
 *
 * The expected world point is computed here, from the canvas rect and the
 * authored world size — deliberately independent of the code under test, so the
 * probe cannot agree with a bug by sharing its arithmetic.
 */
async function sampleAt(page, rect, worldX, worldY) {
	const clientX = rect.x + (worldX / GAME_WIDTH) * rect.width;
	const clientY = rect.y + (worldY / GAME_HEIGHT) * rect.height;
	await page.mouse.move(clientX, clientY);
	// One frame for the intent to be built and one physics step to consume it.
	await page.waitForTimeout(120);

	const state = await page.evaluate(() => window.__aimState());
	const gap = worldX + state.cameraX - state.centreX;
	const wantAngle = Math.atan2(worldY + state.cameraY - state.centreY, gap);
	// Directly above or below the fighter there is no side to face, and demanding
	// one would report a coin flip as a bug.
	const wantSide = Math.abs(gap) < FACING_DEADZONE_PX ? 0 : Math.sign(gap);

	return {
		want: { x: worldX, y: worldY, angle: wantAngle, side: wantSide },
		got: state,
		pointerErrPx: Math.hypot(
			state.pointerX - (worldX + state.cameraX),
			state.pointerY - (worldY + state.cameraY),
		),
		angleErrRad: Math.abs(angleDelta(state.aimAngle, wantAngle)),
		facingOk: wantSide === 0 || state.facing === wantSide,
	};
}

/**
 * Fire one shot at a world point and measure the heading it left with.
 *
 * Retried, because the opponent is a live server bot: a fighter that is dead
 * cannot shoot, and a run that happened to sample during the 1.5s respawn wait
 * reported "no shot" as though aim were broken.
 */
async function shootAt(page, rect, worldX, worldY, attempts = 3) {
	for (let i = 0; i < attempts; i++) {
		const shot = await tryShoot(page, rect, worldX, worldY);
		if (shot.fired) return shot;
		await page.waitForTimeout(2000);
	}
	return tryShoot(page, rect, worldX, worldY);
}

async function tryShoot(page, rect, worldX, worldY) {
	// A dead fighter cannot fire. Wait out the server's respawn rather than
	// recording the corpse as an aim failure.
	for (let i = 0; i < 60; i++) {
		const s = await page.evaluate(() => window.__aimState());
		if (s.hp > 0) break;
		await page.waitForTimeout(100);
	}
	await page.keyboard.press("KeyE"); // gun stance
	const before = await sampleAt(page, rect, worldX, worldY);
	const known = new Set(before.got.bullets.map((b) => b.id));

	await page.mouse.down();
	await page.waitForTimeout(90);
	await page.mouse.up();

	// Server-owned bullets arrive on the next 20Hz snapshot.
	let fresh = [];
	for (let i = 0; i < 12 && fresh.length === 0; i++) {
		await page.waitForTimeout(60);
		const now = await page.evaluate(() => window.__aimState());
		fresh = now.bullets.filter((b) => !known.has(b.id));
	}
	await page.keyboard.press("KeyQ"); // back to sword

	if (fresh.length === 0) {
		return { fired: false, hp: before.got.hp, stance: before.got.stance };
	}
	const errs = fresh.map((b) =>
		Math.abs(angleDelta(b.angle, before.want.angle)),
	);
	return {
		fired: true,
		bullets: fresh.length,
		angleErrRad: Math.min(...errs),
		want: before.want.angle,
		got: fresh[0].angle,
	};
}

/**
 * Walk the fighter toward the middle of the arena before shooting.
 *
 * From the spawn at x=100 a shot aimed left leaves the world in under 200ms —
 * less than the 20Hz snapshot interval — so the bullet was never observed and
 * the leftward half of projectile aim went untested while reporting "no shot".
 */
async function walkToCentre(page) {
	await page.keyboard.down("KeyD");
	for (let i = 0; i < 40; i++) {
		const s = await page.evaluate(() => window.__aimState());
		if (s.centreX > 360) break;
		await page.waitForTimeout(100);
	}
	await page.keyboard.up("KeyD");
	await page.waitForTimeout(300);
}

/**
 * How long the fighter takes to turn to a cursor that crossed to its other side
 * *while it is swinging*.
 *
 * This is the half of "follow the mouse" that a static cursor sample cannot see:
 * with the attack button held the fighter chains slashes, so if facing is frozen
 * for the whole of a move the pointer is simply not obeyed for as long as the
 * player keeps attacking.
 */
async function attackTurnLatency(page, rect, centre) {
	await page.keyboard.press("KeyQ"); // sword
	const left = { x: Math.max(8, centre.x - 200), y: centre.y };
	const right = { x: Math.min(GAME_WIDTH - 8, centre.x + 200), y: centre.y };
	const toClient = (p) => [
		rect.x + (p.x / GAME_WIDTH) * rect.width,
		rect.y + (p.y / GAME_HEIGHT) * rect.height,
	];

	await page.mouse.move(...toClient(right));
	await page.waitForTimeout(200);
	await page.mouse.down(); // hold: chain slashes for the whole measurement
	const results = [];

	for (let i = 0; i < 6; i++) {
		const want = i % 2 === 0 ? -1 : 1;
		await page.mouse.move(...toClient(want < 0 ? left : right));
		const t0 = Date.now();
		let ms = null;
		while (Date.now() - t0 < 1500) {
			const s = await page.evaluate(() => window.__aimState());
			// A fighter the bot has stunned is not refusing to turn; it is stunned.
			if (s.hp <= 0) break;
			if (s.facing === want) {
				ms = Date.now() - t0;
				break;
			}
			await page.waitForTimeout(16);
		}
		results.push({ want, ms });
	}

	await page.mouse.up();
	await page.keyboard.press("KeyQ");
	return results;
}

/** A ring of cursor positions around the fighter, plus the four quadrants. */
function probePoints(centre) {
	const r = 220;
	const ring = [];
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * 2 * Math.PI;
		ring.push({
			x: Math.min(GAME_WIDTH - 8, Math.max(8, centre.x + Math.cos(a) * r)),
			y: Math.min(GAME_HEIGHT - 8, Math.max(8, centre.y + Math.sin(a) * r)),
		});
	}
	return ring;
}

async function runOne(browser, dpr) {
	// The window must be tall enough to show the whole canvas: Playwright clamps
	// a mouse move to the viewport, so any part of the canvas below the fold
	// silently returns the *previous* cursor position and every sample there
	// reports a stale world point that looks exactly like a conversion bug.
	const ctx = await browser.newContext({
		deviceScaleFactor: dpr,
		viewport: { width: 900, height: 900 },
	});
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));

	// No `ai=true`: the local fighter must be human-controlled, or the brain
	// overwrites the aim angle and the probe measures nothing.
	// An empty room, which is now simply the default: bots are opt-in, so asking
	// for none means asking for nothing.
	//
	// It matters here. Aim is measured against a cursor, and a server bot that
	// closes to melee range within seconds stuns the fighter, kills it, and eats the
	// shots this probe needs to see leave — half the runs used to fail for reasons
	// that had nothing to do with aim. An empty room removes the noise and none of
	// the netcode: it is still served, predicted and reconciled.
	const url = MODE === "offline" ? `${BASE_URL}/?offline=true` : BASE_URL;
	await page.goto(url);
	await waitForGame(page);
	// A human-controlled client is asked for a name before it connects, and the
	// prompt is a DOM modal over the canvas — so an unanswered prompt means both
	// no match and no cursor reaching the game. Answering it is the same event the
	// modal fires, so this is the path a player takes, not a bypass.
	await page.evaluate(() => window.__setPlayerName?.("AimProbe"));
	await page.waitForTimeout(MODE === "offline" ? 1000 : 3000);

	const rect = await canvasRect(page);
	await walkToCentre(page);
	const first = await page.evaluate(() => window.__aimState());

	// Shoot before the ring samples, and shoot *upward*. The opponent is a live
	// server bot that closes to melee range within seconds; a shot fired into a
	// fighter standing on top of you is destroyed by the server in the same tick
	// and never reaches a 20Hz snapshot, which the probe can only report as "no
	// shot fired".
	const shots = [];
	for (const p of [
		{ x: first.centreX + 240, y: first.centreY - 220 },
		{ x: first.centreX - 240, y: first.centreY - 220 },
	]) {
		shots.push(
			await shootAt(
				page,
				rect,
				Math.min(GAME_WIDTH - 8, Math.max(8, p.x)),
				Math.min(GAME_HEIGHT - 8, Math.max(8, p.y)),
			),
		);
	}

	const samples = [];
	for (const p of probePoints({ x: first.centreX, y: first.centreY })) {
		samples.push(await sampleAt(page, rect, p.x, p.y));
	}

	const turns = await attackTurnLatency(page, rect, {
		x: first.centreX,
		y: first.centreY,
	});

	await ctx.close();

	const worstPointer = Math.max(...samples.map((s) => s.pointerErrPx));
	const worstAngle = Math.max(...samples.map((s) => s.angleErrRad));
	const facingMisses = samples.filter((s) => !s.facingOk);
	const firedShots = shots.filter((s) => s.fired);
	const worstShot = firedShots.length
		? Math.max(...firedShots.map((s) => s.angleErrRad))
		: null;

	const failures = [];
	if (worstPointer > POINTER_TOLERANCE_PX) {
		failures.push(
			`cursor maps ${worstPointer.toFixed(1)}px off in world space`,
		);
	}
	if (worstAngle > ANGLE_TOLERANCE_RAD) {
		failures.push(`aim angle off by up to ${deg(worstAngle)}°`);
	}
	if (facingMisses.length) {
		failures.push(`${facingMisses.length}/${samples.length} facing mismatches`);
	}
	if (firedShots.length === 0) {
		failures.push("no shot was observed — projectile aim untested");
	} else if (worstShot > ANGLE_TOLERANCE_RAD) {
		failures.push(`bullet heading off by up to ${deg(worstShot)}°`);
	}
	const turnMs = turns.map((t) => t.ms).filter((m) => m !== null);
	const worstTurn = turnMs.length ? Math.max(...turnMs) : null;
	if (turnMs.length < turns.length / 2) {
		failures.push("fighter never turned to the cursor while attacking");
	} else if (worstTurn > TURN_TOLERANCE_MS) {
		failures.push(`took ${worstTurn}ms to face the cursor while attacking`);
	}
	if (errors.length) failures.push(`page errors: ${errors.length}`);

	return {
		dpr,
		mode: MODE,
		verdict: failures.length ? "FAIL" : "PASS",
		failures,
		viewport: { width: first.viewWidth, height: first.viewHeight },
		attackTurn: {
			worstMs: worstTurn,
			missed: turns.length - turnMs.length,
			samples: turns,
		},
		worstPointerErrPx: Math.round(worstPointer * 10) / 10,
		worstAimErrDeg: deg(worstAngle),
		facing: `${samples.length - facingMisses.length}/${samples.length} correct`,
		facingMisses: facingMisses.map((s) => ({
			cursor: `${Math.round(s.want.x)},${Math.round(s.want.y)}`,
			wantSide: s.want.side,
			facing: s.got.facing,
			phase: s.got.phase,
		})),
		shots: shots.map((s) =>
			s.fired
				? {
						bullets: s.bullets,
						errDeg: deg(s.angleErrRad),
						want: deg(s.want),
						got: deg(s.got),
					}
				: { fired: false, hp: s.hp, stance: s.stance },
		),
		samples: samples.map((s) => ({
			cursor: `${Math.round(s.want.x)},${Math.round(s.want.y)}`,
			world: `${Math.round(s.got.pointerX)},${Math.round(s.got.pointerY)}`,
			errPx: Math.round(s.pointerErrPx * 10) / 10,
			aimErrDeg: deg(s.angleErrRad),
			facing: s.got.facing,
		})),
	};
}

async function main() {
	const browser = await chromium.launch();
	let failed = false;
	for (const dpr of DPRS) {
		const report = await runOne(browser, dpr);
		console.log(`\n===== AIM ${report.mode} dpr=${dpr} =====`);
		console.log(JSON.stringify(report, null, 2));
		if (report.verdict === "FAIL") failed = true;
	}
	await browser.close();
	process.exit(failed ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
