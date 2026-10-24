#!/usr/bin/env node
/**
 * The on-screen deck's feedback loop.
 *
 * `pad-probe.ts` measures the physical gamepad and the two aim layers;
 * `diagnose.ts` is blind to both because a brain hands the simulation an angle
 * without touching a stick. This probe is the only thing that measures the
 * **two-thumb deck**: the layout a finger has to hit, and the simultaneous
 * actions a fight is actually made of.
 *
 * The gates come from the failures the old deck had, not from taste:
 *
 *   1. every target is at least 44px and no two overlap;
 *   2. the controls clear the safe area and the middle of the arena stays clear;
 *   3. move + attack, a three-link chain, and the butterfly all work;
 *   4. a charged Massive survives a jump and becomes a plunge bomb;
 *   5. a tap jump reaches near-full height (the old deck gave 76 of 136px);
 *   6. retreat-fire works: run left, shoot right;
 *   7. item drag-aims, and the ultimate arms on a hold, aims on a drag, casts on
 *      release — while a brush of the thumb spends nothing;
 *   8. nothing stays held after a release, and the Menu button does not open the
 *      wrong page through the finger that opened it.
 *
 * Every touch is CDP `Input.dispatchTouchEvent`, never `page.mouse`: synthetic
 * mouse events report `pointerType: "mouse"` even in a touch context, and the
 * whole point of this probe is to be a thumb.
 *
 *   tsx scripts/deck-probe.ts
 *   GOLPE_SERVER=localhost:9209 tsx scripts/deck-probe.ts
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { launchBrowser, probeQuery } from "./browser";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const OUT = "/tmp/opencode/deck-probe";

/** A phone-sized viewport, in CSS pixels. */
interface View {
	width: number;
	height: number;
	tag: string;
	portrait: boolean;
	safe?: string;
}

const VIEWS: View[] = [
	{ width: 844, height: 390, tag: "landscape", portrait: false },
	{ width: 390, height: 844, tag: "portrait", portrait: true },
	{ width: 667, height: 375, tag: "landscape-16-9", portrait: false },
	// The small phones are where a card over the hands or a menu over the HUD
	// is worst, and where the 44px floor starts to bite.
	{ width: 568, height: 320, tag: "landscape-se", portrait: false },
	{ width: 375, height: 667, tag: "portrait-16-9", portrait: true },
	{ width: 320, height: 568, tag: "portrait-se", portrait: true },
];

/** The deck's interactive controls, by their stable `data-deck` name. */
const CONTROLS = [
	"guard",
	"dash",
	"move",
	"stance-sword",
	"stance-gun",
	"ult",
	"item",
	"upper",
	"attack",
	"menu",
] as const;

type ControlName = (typeof CONTROLS)[number];

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
	right: number;
	bottom: number;
	cx: number;
	cy: number;
}

type Check = (name: string, ok: boolean, detail: string) => void;

// ---------------------------------------------------------------------------
// A real multi-touch finger
// ---------------------------------------------------------------------------

class Touch {
	private points = new Map<number, { x: number; y: number }>();

	constructor(
		private readonly cdp: CDPSession,
		private readonly page: Page,
	) {}

	private send(
		type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
		only?: number[],
	) {
		const list = [...this.points]
			.filter(([id]) => !only || only.includes(id))
			.map(([id, p]) => ({
				x: p.x,
				y: p.y,
				id,
				radiusX: 8,
				radiusY: 8,
				force: 1,
			}));
		return this.cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: list,
		}) as Promise<unknown>;
	}

	async down(id: number, x: number, y: number) {
		this.points.set(id, { x, y });
		await this.send("touchStart");
		await this.page.waitForTimeout(16);
	}

	async move(id: number, x: number, y: number, steps = 5) {
		const from = this.points.get(id);
		if (!from) throw new Error(`touch ${id} is not down`);
		for (let i = 1; i <= steps; i++) {
			this.points.set(id, {
				x: from.x + ((x - from.x) * i) / steps,
				y: from.y + ((y - from.y) * i) / steps,
			});
			await this.send("touchMove");
			await this.page.waitForTimeout(16);
		}
	}

	/** Chrome's touchEnd releases the points it is handed, not the ones missing. */
	async lift(id: number) {
		if (!this.points.has(id)) return;
		await this.send("touchEnd", [id]);
		this.points.delete(id);
		await this.page.waitForTimeout(16);
	}

	async liftAll() {
		if (this.points.size === 0) return;
		this.points.clear();
		await this.send("touchEnd");
		await this.page.waitForTimeout(16);
	}

	/** An OS/browser cancellation, not a deliberate release. */
	async cancel(id: number) {
		if (!this.points.has(id)) return;
		this.points.delete(id);
		await this.send("touchCancel");
		await this.page.waitForTimeout(16);
	}

	async tap(id: number, x: number, y: number, downMs = 70, gapMs = 70) {
		await this.down(id, x, y);
		await this.page.waitForTimeout(downMs);
		await this.lift(id);
		if (gapMs > 0) await this.page.waitForTimeout(gapMs);
	}
}

// ---------------------------------------------------------------------------
// Reading the game
// ---------------------------------------------------------------------------

interface Snapshot {
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
	stance: "sword" | "gun";
	action: string;
	combo: number;
	charge: number;
	massive: boolean;
	blocking: boolean;
	blockHeld: boolean;
	attackHeld: boolean;
	jumpHeld: boolean;
	uppercutHeld: boolean;
	plunging: boolean;
	plungeStuck: number;
	airJumps: number;
	stun: number;
	knockdown: number;
	hp: number;
	bullets: number;
	itemCharges: number;
	aim: number;
	blend: number;
	overriding: boolean;
	facing: number;
	deckVisible: boolean;
}

async function snapshot(page: Page): Promise<Snapshot> {
	return page.evaluate(() => {
		const s = window.__gameState!();
		const p = s.playerPhys;
		const i = window.__inputState!();
		return {
			x: Math.round(p.x),
			y: Math.round(p.y),
			vx: Math.round(p.vx),
			vy: Math.round(p.vy),
			grounded: p.grounded,
			stance: p.stance,
			action: p.meleeAction,
			combo: p.comboStep,
			charge: Math.round(p.chargeTimer),
			massive: p.massiveReady,
			blocking: p.blocking,
			blockHeld: p.blockHeld,
			attackHeld: p.attackHeld,
			jumpHeld: p.jumpHeld,
			uppercutHeld: p.uppercutHeld,
			plunging: p.plunging,
			plungeStuck: Math.round(p.plungeStuckTimer),
			airJumps: p.airJumps,
			stun: Math.round(p.stunTimer),
			knockdown: Math.round(p.knockdownTimer),
			hp: s.playerHP,
			bullets: s.bulletCount,
			itemCharges: s.itemCharges,
			aim: Math.round((i.aim.angle * 180) / Math.PI),
			blend: +i.aim.blend.toFixed(2),
			overriding: i.aim.overriding,
			facing: i.facing,
			deckVisible: i.deckVisible,
		};
	});
}

/** Wait until the local fighter is alive, on the floor and not in a stun. */
async function settle(page: Page, timeoutMs = 6000): Promise<Snapshot> {
	const started = Date.now();
	let last = await snapshot(page);
	while (Date.now() - started < timeoutMs) {
		if (
			last.hp > 0 &&
			last.grounded &&
			last.stun === 0 &&
			last.knockdown === 0 &&
			last.plungeStuck === 0 &&
			!last.plunging &&
			last.action === "none"
		) {
			return last;
		}
		await page.waitForTimeout(80);
		last = await snapshot(page);
	}
	return last;
}

/** Walk to a world x, using the pad and giving up after a few strokes. */
async function walkToX(
	page: Page,
	touch: Touch,
	move: Rect,
	target: number,
): Promise<Snapshot> {
	let last = await snapshot(page);
	for (let attempt = 0; attempt < 5; attempt++) {
		if (Math.abs(last.x - target) < 28) return last;
		const d = target > last.x ? 1 : -1;
		await touch.down(1, move.cx + d * move.width * 0.36, move.cy + 14);
		const ms = Math.min(
			1000,
			Math.max(120, (Math.abs(target - last.x) / 220) * 1000),
		);
		await page.waitForTimeout(ms);
		await touch.lift(1);
		await page.waitForTimeout(160);
		last = await snapshot(page);
	}
	return last;
}

async function box(page: Page, name: ControlName): Promise<Rect> {
	const b = await page.locator(`[data-deck="${name}"]`).first().boundingBox();
	if (!b) throw new Error(`no control ${name}`);
	return {
		x: b.x,
		y: b.y,
		width: b.width,
		height: b.height,
		right: b.x + b.width,
		bottom: b.y + b.height,
		cx: b.x + b.width / 2,
		cy: b.y + b.height / 2,
	};
}

async function openGame(
	browser: Browser,
	view: View,
	check: Check,
	options: { bots?: number; ultCharge?: number; safe?: string } = {},
): Promise<{
	ctx: BrowserContext;
	page: Page;
	touch: Touch;
	errors: string[];
}> {
	const ctx = await browser.newContext({
		viewport: { width: view.width, height: view.height },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
	});
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	const query = new URLSearchParams({
		bots: String(options.bots ?? 0),
		screen: "4",
		room: randomUUID(),
		mute: "1",
	});
	if (options.ultCharge !== undefined) {
		query.set("ultCharge", String(options.ultCharge));
	}
	if (options.safe) query.set("safe", options.safe);
	await page.goto(`${BASE_URL}/?${query.toString()}${probeQuery()}`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForFunction(() => typeof window.__inputState === "function", {
		timeout: 20000,
	});
	await page.evaluate(() => window.__setPlayerName?.("DeckProbe"));
	await page.waitForFunction(
		() => window.__matchState?.()?.connected === true,
		{ timeout: 20000 },
	);
	await page.waitForTimeout(1000);

	const cdp = await ctx.newCDPSession(page);
	const touch = new Touch(cdp, page);
	const initialDeck = (await snapshot(page)).deckVisible;
	check(
		`${view.tag}: a touch device starts in controller mode with the deck drawn`,
		initialDeck === true,
		`deckVisible=${initialDeck}`,
	);
	return { ctx, page, touch, errors };
}

/** Get the coach out of the way so it cannot sit over a measured control. */
async function dismissCoach(page: Page) {
	const coach = page.locator(".gg-coach-ok");
	if (await coach.count()) {
		await coach.tap();
		await page.waitForTimeout(200);
	}
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

async function measure(page: Page): Promise<Record<string, Rect>> {
	const out: Record<string, Rect> = {};
	for (const name of CONTROLS) out[name] = await box(page, name);
	return out;
}

function overlap(a: Rect, b: Rect): number {
	const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
	const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
	return x * y;
}

async function runLayout(
	browser: Browser,
	view: View,
	check: Check,
	safe?: string,
) {
	const { ctx, page, errors } = await openGame(
		browser,
		view,
		check,
		safe ? { safe } : {},
	);
	const rects = await measure(page);
	// Measure the coach **before** it is dismissed: it used to be the one
	// overlay that sat on top of the controls, and the old probe dismissed it
	// first, so the gate could never see it.
	const coachBox = await page.locator('[data-deck="coach"]').boundingBox();
	const coachOk = await page.locator('[data-deck="coach-ok"]').boundingBox();
	if (coachBox && coachOk) {
		const coachRect: Rect = {
			x: coachBox.x,
			y: coachBox.y,
			width: coachBox.width,
			height: coachBox.height,
			right: coachBox.x + coachBox.width,
			bottom: coachBox.y + coachBox.height,
			cx: coachBox.x + coachBox.width / 2,
			cy: coachBox.y + coachBox.height / 2,
		};
		check(
			`${view.tag}${safe ? ` ${safe}` : ""}: the coach's Got it is at least 44px`,
			coachOk.width >= 44 && coachOk.height >= 44,
			`${Math.round(coachOk.width)}x${Math.round(coachOk.height)}`,
		);
		for (const name of CONTROLS) {
			check(
				`${view.tag}${safe ? ` ${safe}` : ""}: the coach does not cover ${name}`,
				overlap(coachRect, rects[name]!) === 0,
				`${Math.round(overlap(coachRect, rects[name]!))}px²`,
			);
		}
	}
	await dismissCoach(page);
	const canvas = await page.locator("canvas").boundingBox();
	if (!canvas) throw new Error("no canvas");
	const suffix = safe ? ` ${safe}` : "";

	// 1. Every target is a fingertip.
	for (const name of CONTROLS) {
		const r = rects[name]!;
		const min = name === "attack" ? 96 : name === "move" ? 120 : 44;
		check(
			`${view.tag}${suffix}: ${name} is at least ${min}px`,
			name === "move"
				? r.width >= min && r.height >= 130
				: r.width >= min && r.height >= min,
			`${Math.round(r.width)}x${Math.round(r.height)}`,
		);
	}

	// 2. No two hit areas overlap. The jump cap is inside the move pad by
	// design, so it is the one nested pair.
	const names = CONTROLS.filter((n) => n !== "menu");
	for (let i = 0; i < names.length; i++) {
		for (let j = i + 1; j < names.length; j++) {
			const a = rects[names[i]!]!;
			const b = rects[names[j]!]!;
			check(
				`${view.tag}${suffix}: ${names[i]} and ${names[j]} do not overlap`,
				overlap(a, b) === 0,
				`${Math.round(overlap(a, b))}px²`,
			);
		}
	}

	// 3. Safe area: a notched phone's insets are not a suggestion.
	if (safe) {
		const [top, right, bottom, left] = safe.split(",").map(Number) as [
			number,
			number,
			number,
			number,
		];
		for (const name of CONTROLS) {
			const r = rects[name]!;
			check(
				`${view.tag}: ${name} clears the safe area`,
				r.x >= left - 0.5 &&
					r.right <= view.width - right + 0.5 &&
					r.y >= top - 0.5 &&
					r.bottom <= view.height - bottom + 0.5,
				`${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
			);
		}
	}

	// 4. The middle of the arena stays clear.
	const laneLeft = canvas.x + canvas.width * 0.28;
	const laneRight = canvas.x + canvas.width * 0.72;
	const lane: Rect = {
		x: laneLeft,
		y: canvas.y,
		width: laneRight - laneLeft,
		height: canvas.height,
		right: laneRight,
		bottom: canvas.y + canvas.height,
		cx: (laneLeft + laneRight) / 2,
		cy: canvas.y + canvas.height / 2,
	};
	for (const name of CONTROLS) {
		const r = rects[name]!;
		check(
			`${view.tag}: ${name} stays out of the centre lane`,
			overlap(r, lane) === 0,
			`${Math.round(overlap(r, lane))}px²`,
		);
	}

	// 5. Portrait keeps every control off the arena; landscape is allowed to lap
	// the bottom corners, but not to cover the action.
	if (view.portrait) {
		for (const name of CONTROLS) {
			const r = rects[name]!;
			check(
				`${view.tag}: ${name} is below the arena`,
				r.y >= canvas.y + canvas.height - 1,
				`control y=${Math.round(r.y)} canvas ends ${Math.round(canvas.y + canvas.height)}`,
			);
		}
	}

	// 6. The page does not scroll, and the arena keeps its shape.
	check(
		`${view.tag}: the page does not scroll`,
		await page.evaluate(
			() =>
				document.documentElement.scrollWidth <= window.innerWidth &&
				document.documentElement.scrollHeight <= window.innerHeight,
		),
		"",
	);
	check(
		`${view.tag}: the arena keeps 4:3`,
		Math.abs(canvas.width / canvas.height - 4 / 3) < 0.02,
		`${Math.round(canvas.width)}x${Math.round(canvas.height)}`,
	);
	// 7. The deck is an overlay, not a second page: the canvas is the biggest
	// thing on screen in landscape and still the full width in portrait.
	check(
		`${view.tag}: the arena is not pushed aside by the deck`,
		view.portrait
			? Math.abs(canvas.width - view.width) < 2
			: Math.abs(canvas.height - view.height) < 2,
		`${Math.round(canvas.width)}x${Math.round(canvas.height)} in ${view.width}x${view.height}`,
	);

	// 8. The keyboard hint and the duplicated bottom-right HUD are gone on a
	// device whose thumbs already carry those readouts.
	check(
		`${view.tag}: the keyboard hint is hidden`,
		await page.evaluate(() => {
			const el = document.querySelector(".vdh-hint");
			return !el || getComputedStyle(el).display === "none";
		}),
		"",
	);
	for (const sel of [".vdh-ammo", ".vdh-item", ".vdh-ult"]) {
		check(
			`${view.tag}: the HUD's ${sel} does not sit under the deck`,
			await page.evaluate((s) => {
				const el = document.querySelector(s);
				return !el || getComputedStyle(el).display === "none";
			}, sel),
			"",
		);
	}

	await page.screenshot({
		path: `${OUT}/${view.tag}${suffix ? "-safe" : ""}.png`,
	});
	if (errors.length)
		check(`${view.tag}: no page errors`, false, errors.join(" | "));
	await ctx.close();
}

// ---------------------------------------------------------------------------
// The fight
// ---------------------------------------------------------------------------

async function runFight(browser: Browser, check: Check) {
	const view: View = { width: 844, height: 390, tag: "fight", portrait: false };
	const { ctx, page, touch, errors } = await openGame(browser, view, check, {
		ultCharge: 100,
	});
	await dismissCoach(page);
	const rects = await measure(page);
	const move = rects.move!;
	const attack = rects.attack!;
	const guard = rects.guard!;
	const gun = rects["stance-gun"]!;
	const sword = rects["stance-sword"]!;
	const item = rects.item!;
	const ult = rects.ult!;

	// The jump cap is the top 44px of the move pad, not a separate control.
	const jumpPoint = { x: move.cx, y: move.y + 22 };
	const rightHold = { x: move.cx + move.width * 0.32, y: move.cy + 14 };
	const leftHold = { x: move.cx - move.width * 0.32, y: move.cy + 14 };

	// ---- 0. tap jump and the fast double jump ----
	// Measured at the spawn, before any walking: the spawn pen has the headroom a
	// height test needs, and a later platform would silently cap the arc.
	await settle(page);
	// ---- 5. a tap jump is a full jump ----
	await settle(page);
	const beforeJump = await snapshot(page);
	await touch.tap(1, jumpPoint.x, jumpPoint.y, 70, 0);
	let peak = beforeJump.y;
	for (let i = 0; i < 14; i++) {
		await page.waitForTimeout(50);
		peak = Math.min(peak, (await snapshot(page)).y);
	}
	const rise = beforeJump.y - peak;
	check(
		"a 70ms tap reaches near-full jump height",
		rise >= 110,
		`rose ${rise}px (full jump is ~136px; the old deck gave 76)`,
	);

	// ---- 6. a fast second tap is a double jump, not a swallowed press ----
	await page.waitForTimeout(700);
	await settle(page);
	const beforeDouble = await snapshot(page);
	await touch.tap(1, jumpPoint.x, jumpPoint.y, 70, 100);
	// A deliberately shorter second tap than the 45ms synthetic re-press.
	await touch.tap(1, jumpPoint.x, jumpPoint.y, 40, 0);
	let doublePeak = beforeDouble.y;
	let airJumps = beforeDouble.airJumps;
	for (let i = 0; i < 16; i++) {
		await page.waitForTimeout(50);
		const s = await snapshot(page);
		doublePeak = Math.min(doublePeak, s.y);
		airJumps = Math.min(airJumps, s.airJumps);
	}
	check(
		"two quick jump taps spend the air jump",
		airJumps === 0 && beforeDouble.y - doublePeak > 180,
		`airJumps ${beforeDouble.airJumps}→${airJumps}, rose ${beforeDouble.y - doublePeak}px`,
	);
	// The synthetic re-press must release itself when the finger was already up,
	// or the action stays held and the next jump is a no-op.
	await page.waitForTimeout(700);
	await settle(page);
	const beforeSingleAgain = await snapshot(page);
	await touch.tap(1, jumpPoint.x, jumpPoint.y, 70, 0);
	let singleAgainPeak = beforeSingleAgain.y;
	for (let i = 0; i < 12; i++) {
		await page.waitForTimeout(50);
		singleAgainPeak = Math.min(singleAgainPeak, (await snapshot(page)).y);
	}
	check(
		"a sub-repress double jump does not leave the next jump held",
		beforeSingleAgain.y - singleAgainPeak >= 100,
		`next jump rose ${beforeSingleAgain.y - singleAgainPeak}px`,
	);

	await page.waitForTimeout(300);
	await settle(page);

	// ---- 1. move + attack ----
	await settle(page);
	const start = await snapshot(page);
	await touch.down(1, rightHold.x, rightHold.y);
	await page.waitForTimeout(180);
	const running = await snapshot(page);
	await touch.down(2, attack.cx, attack.cy);
	await page.waitForTimeout(160);
	const cutting = await snapshot(page);
	await touch.lift(2);
	await page.waitForTimeout(120);
	await touch.lift(1);
	check(
		"move + attack: the fighter runs and swings at the same time",
		running.vx > 100 &&
			cutting.attackHeld &&
			cutting.combo >= 1 &&
			running.x > start.x,
		`vx=${running.vx} attackHeld=${cutting.attackHeld} combo=${cutting.combo} x ${start.x}→${running.x}`,
	);
	// Let any leftover combo expire: the chain test must start from neutral, or
	// the first tap advances a link that was already open.
	await page.waitForTimeout(600);
	await settle(page);

	// ---- 2. the three-link chain, while moving ----
	await touch.down(1, rightHold.x, rightHold.y);
	const combos: number[] = [];
	for (let i = 0; i < 4; i++) {
		await touch.tap(2, attack.cx, attack.cy, 55, 155);
		combos.push((await snapshot(page)).combo);
	}
	await touch.lift(1);
	check(
		"three taps walk the chain 1 → 2 → 3",
		combos[0] === 1 && combos[1] === 2 && combos[2] === 3,
		`combos=${combos.join(",")}`,
	);

	// ---- 3. the butterfly: guard held on the left, sword on the right ----
	await settle(page);
	await touch.down(1, guard.cx, guard.cy);
	await page.waitForTimeout(140);
	const guarding = await snapshot(page);
	await touch.down(2, attack.cx, attack.cy);
	await page.waitForTimeout(120);
	const swinging = await snapshot(page);
	await touch.lift(2);
	await page.waitForTimeout(500);
	const recovered = await snapshot(page);
	await touch.lift(1);
	check(
		"the butterfly: guard is up, drops for the swing, and re-raises itself",
		guarding.blocking && !swinging.blocking && recovered.blocking,
		`up=${guarding.blocking} during=${swinging.blocking} after=${recovered.blocking}`,
	);

	// ---- 3b. guard-walk: a normal-length walk can be guarded from ----
	await settle(page);
	// Walk away from the spawn pen's wall, whichever side has room.
	const beforeWalk = await snapshot(page);
	const gwDir = beforeWalk.x > 140 ? -1 : 1;
	const gwHold =
		gwDir > 0 ? rightHold : { x: move.cx - move.width * 0.32, y: move.cy + 14 };
	await touch.down(1, gwHold.x, gwHold.y);
	await page.waitForTimeout(400);
	await touch.lift(1);
	await touch.down(1, guard.cx, guard.cy);
	await page.waitForTimeout(220);
	const walkingGuard = await snapshot(page);
	await touch.lift(1);
	check(
		"guard-walk survives a normal-length walk before the guard",
		walkingGuard.blocking && walkingGuard.vx * gwDir > 20,
		`blocking=${walkingGuard.blocking} vx=${walkingGuard.vx} dir=${gwDir}`,
	);
	await page.waitForTimeout(200);

	// ---- 4. charged Massive + jump = plunge bomb ----
	await settle(page);
	await touch.down(2, attack.cx, attack.cy);
	await page.waitForTimeout(1750);
	const charged = await snapshot(page);
	await touch.down(1, jumpPoint.x, jumpPoint.y);
	await page.waitForTimeout(150);
	const airborne = await snapshot(page);
	await touch.lift(1);
	await touch.lift(2);
	await page.waitForTimeout(260);
	const bomb = await snapshot(page);
	await page.waitForTimeout(800);
	check(
		"a charged Massive + jump becomes the plunge bomb",
		charged.massive &&
			!airborne.grounded &&
			(bomb.plunging || bomb.plungeStuck > 0),
		`massive=${charged.massive} airborne=${!airborne.grounded} plunging=${bomb.plunging} stuck=${bomb.plungeStuck}`,
	);
	await settle(page);

	// ---- 6. retreat-fire: run left, shoot right ----
	await page.waitForTimeout(500);
	// A clear runway: the spawn pen has walls a few hundred pixels apart, and a
	// retreat test that starts against one measures the wall.
	await walkToX(page, touch, move, 120);
	await settle(page);
	await touch.tap(2, gun.cx, gun.cy, 60, 320);
	const gunStance = await snapshot(page);
	// A thumb landing off-centre is not an aim. The old absolute model fired this
	// tap at -90° because the thumb was near the top edge; a relative drag starts
	// at zero, so the shot goes with the fighter's facing.
	await touch.down(2, attack.cx, attack.y + 4);
	await page.waitForTimeout(120);
	const offCentre = await snapshot(page);
	await touch.lift(2);
	check(
		"an off-centre gun tap uses the facing, not the press offset",
		Math.abs(offCentre.aim) < 45 ||
			Math.abs(Math.abs(offCentre.aim) - 180) < 45,
		`aim=${offCentre.aim}° from a press 4px below centre`,
	);
	await touch.down(1, leftHold.x, leftHold.y);
	await page.waitForTimeout(220);
	const beforeFire = await snapshot(page);
	await touch.down(2, attack.cx, attack.cy);
	await touch.move(2, attack.cx + 34, attack.cy);
	await page.waitForTimeout(450);
	const firing = await snapshot(page);
	await touch.lift(2);
	await touch.lift(1);
	check(
		"retreat-fire: running left while the gun aims and fires right",
		gunStance.stance === "gun" &&
			beforeFire.vx < -100 &&
			firing.x < beforeFire.x &&
			firing.aim > -20 &&
			firing.aim < 20 &&
			firing.blend > 0.5 &&
			firing.bullets > beforeFire.bullets,
		`stance=${gunStance.stance} vx=${beforeFire.vx}→${firing.vx} x=${beforeFire.x}→${firing.x} aim=${firing.aim} blend=${firing.blend} bullets ${beforeFire.bullets}→${firing.bullets}`,
	);

	// ---- 7. item drag-aim, then throw on release ----
	await touch.tap(2, sword.cx, sword.cy, 60, 320);
	const beforeItem = await snapshot(page);
	await touch.down(2, item.cx, item.cy);
	await touch.move(2, item.cx + 30, item.cy - 22);
	await page.waitForTimeout(80);
	const aiming = await snapshot(page);
	await touch.lift(2);
	await page.waitForTimeout(180);
	const thrown = await snapshot(page);
	check(
		"the item drag-aims and spends exactly one charge on release",
		aiming.blend > 0.5 &&
			aiming.aim < -20 &&
			thrown.itemCharges === beforeItem.itemCharges - 1,
		`aim=${aiming.aim} blend=${aiming.blend} charges ${beforeItem.itemCharges}→${thrown.itemCharges}`,
	);

	// A thumb landing off-centre is a tap, not an aim: the item must use the
	// facing, exactly as the old absolute model failed to.
	const beforeTap = await snapshot(page);
	await touch.tap(2, item.cx, item.y + 4, 80, 0);
	await page.waitForTimeout(260);
	const tapThrow = await snapshot(page);
	check(
		"an off-centre item tap throws at the facing, not the press offset",
		(Math.abs(tapThrow.aim) < 45 ||
			Math.abs(Math.abs(tapThrow.aim) - 180) < 45) &&
			tapThrow.itemCharges === beforeTap.itemCharges - 1,
		`aim=${tapThrow.aim}° charges ${beforeTap.itemCharges}→${tapThrow.itemCharges}`,
	);

	// ---- 8. ult: a brush spends nothing; hold + drag + release casts ----
	await page.waitForTimeout(800);
	const ultBefore = await page.evaluate(() => window.__ultState!());
	await touch.tap(2, ult.cx, ult.cy, 120, 320);
	const afterBrush = await page.evaluate(() => window.__ultState!());
	check(
		"a brush of the ultimate arms nothing",
		afterBrush.charge >= ultBefore.charge - 1,
		`charge ${ultBefore.charge}→${afterBrush.charge}`,
	);

	// A cancelled touch (OS gesture, app switch) must not spend the charge.
	await touch.down(2, ult.cx, ult.cy);
	await page.waitForTimeout(330);
	await touch.cancel(2);
	await page.waitForTimeout(320);
	const cancelled = await page.evaluate(() => window.__ultState!());
	check(
		"a cancelled ultimate touch does not cast",
		cancelled.charge >= ultBefore.charge - 1 && cancelled.frozen === false,
		`charge=${cancelled.charge} frozen=${cancelled.frozen}`,
	);

	await touch.down(2, ult.cx, ult.cy);
	await page.waitForTimeout(330);
	const armed = await snapshot(page);
	await touch.move(2, ult.cx + 28, ult.cy - 14);
	await page.waitForTimeout(80);
	const aimed = await snapshot(page);
	await touch.lift(2);
	await page.waitForTimeout(300);
	const cast = await page.evaluate(() => window.__ultState!());
	check(
		"the ultimate arms on a hold and casts on the drag angle",
		armed.overriding === false &&
			aimed.blend > 0.5 &&
			aimed.aim < -10 &&
			cast.frozen,
		`armedOverriding=${armed.overriding} aim=${aimed.aim} blend=${aimed.blend} frozen=${cast.frozen}`,
	);
	await page.waitForTimeout(1200);

	// ---- 9. nothing stays held ----
	await touch.liftAll();
	await page.waitForTimeout(600);
	const clean = await snapshot(page);
	check(
		"nothing stays held after every thumb is lifted",
		!clean.attackHeld &&
			!clean.blockHeld &&
			!clean.uppercutHeld &&
			!clean.jumpHeld &&
			!clean.overriding,
		`attack=${clean.attackHeld} block=${clean.blockHeld} upper=${clean.uppercutHeld} jump=${clean.jumpHeld} aim=${clean.overriding}`,
	);

	// ---- 10a. the Menu opens while another thumb holds Guard ----
	await settle(page);
	const menu = rects.menu!;
	await touch.down(1, guard.cx, guard.cy);
	await touch.tap(2, menu.cx, menu.cy, 60, 0);
	await page.waitForTimeout(350);
	const menuWhileHeld = await page
		.getByRole("button", { name: "Resume" })
		.isVisible()
		.catch(() => false);
	await touch.lift(1);
	check(
		"the Menu opens even while another thumb holds Guard",
		menuWhileHeld,
		"",
	);
	await page
		.getByRole("button", { name: "Resume" })
		.click()
		.catch(() => {});
	await page.waitForTimeout(300);

	// ---- 10. the Menu button is not a trapdoor ----
	await page.locator('[data-deck="menu"]').tap();
	await page.waitForTimeout(250);
	// The old deck opened on pointerdown, and the compatibility click after
	// touchend landed on whichever card had just mounted under the finger — in
	// portrait, Heroes. `Resume` exists on the main card and nowhere else, so its
	// disappearance is exactly the click-through failure.
	const resume = page.getByRole("button", { name: "Resume" });
	const controlsVisible = await page
		.getByRole("button", { name: "Controls" })
		.isVisible()
		.catch(() => false);
	const resumeVisible = await resume.isVisible().catch(() => false);
	const dialog = await page.evaluate(() => {
		const card = document.querySelector(".gd-menu-card");
		const deck = document.querySelector(".gg-deck");
		return {
			role: card?.getAttribute("role"),
			modal: card?.getAttribute("aria-modal"),
			focusedInside: card?.contains(document.activeElement) ?? false,
			deckInert: deck?.hasAttribute("inert") ?? false,
		};
	});
	check(
		"the pause menu is a dialog and the deck is inert behind it",
		dialog.role === "dialog" &&
			dialog.modal === "true" &&
			dialog.focusedInside &&
			dialog.deckInert,
		`role=${dialog.role} modal=${dialog.modal} focus=${dialog.focusedInside} inert=${dialog.deckInert}`,
	);
	check(
		"the deck's Menu opens the menu, not the page underneath",
		controlsVisible && resumeVisible,
		`controls=${controlsVisible} resume=${resumeVisible}`,
	);
	await resume.click().catch(() => {});
	await page.waitForTimeout(200);

	// ---- 11. latency: a press reaches the simulation inside a frame or two ----
	const latency: number[] = [];
	for (let i = 0; i < 8; i++) {
		await settle(page, 2000);
		const t0 = Date.now();
		await touch.down(2, attack.cx, attack.cy);
		let seen = false;
		for (let poll = 0; poll < 30; poll++) {
			if ((await snapshot(page)).attackHeld) {
				seen = true;
				break;
			}
			await page.waitForTimeout(10);
		}
		latency.push(Date.now() - t0);
		await touch.lift(2);
		await page.waitForTimeout(180);
		if (!seen) break;
	}
	const p95 =
		latency.sort((a, b) => a - b)[Math.floor(latency.length * 0.95)] ?? 999;
	check(
		"a slash press is acknowledged within 100ms",
		p95 <= 100,
		`p95=${p95}ms samples=${latency.join(",")}`,
	);

	await page.screenshot({ path: `${OUT}/fight-end.png` });
	if (errors.length) check("fight: no page errors", false, errors.join(" | "));
	await ctx.close();
}

/**
 * The retreat-slash: run one way, swing at the foe behind.
 *
 * Desktop's cursor faces the enemy while A/D runs away. A thumb cannot point
 * opposite its own feet, so a held attack turns toward a foe in range. The
 * training room gives a stationary dummy 60px away, which is the one place this
 * is deterministic.
 */
async function runRetreatSlash(browser: Browser, check: Check) {
	const ctx = await browser.newContext({
		viewport: { width: 844, height: 390 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
	});
	const page = await ctx.newPage();
	await page.bringToFront();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(
		`${BASE_URL}/?training=true&room=${randomUUID()}&mute=1${probeQuery()}`,
		{ waitUntil: "domcontentloaded" },
	);
	await page.waitForFunction(() => typeof window.__inputState === "function", {
		timeout: 20000,
	});
	await page.waitForFunction(
		() => window.__matchState?.()?.connected === true,
		{ timeout: 20000 },
	);
	await page.waitForFunction(() => window.__training?.state() !== undefined, {
		timeout: 20000,
	});
	// The dummy's *body* reaches the client through the ordinary remote
	// snapshot; the training channel can be ready a beat before it, and the aim
	// assist can only see a body.
	await page.waitForFunction(
		() => {
			const g = window.__gameState!();
			return (
				g.enemyPhys !== null && Math.abs(g.enemyPhys.x - g.playerPhys.x) < 240
			);
		},
		{ timeout: 20000 },
	);
	await page.waitForTimeout(1200);
	const cdp = await ctx.newCDPSession(page);
	const touch = new Touch(cdp, page);

	const move = await box(page, "move");
	const attack = await box(page, "attack");
	const { dummyX, px } = await page.evaluate(() => ({
		dummyX: window.__training!.state().dummy.x,
		px: window.__gameState!().playerPhys.x,
	}));
	const toward = dummyX >= px ? 1 : -1;
	const dist = Math.abs(dummyX - px);
	await touch.down(1, move.cx - toward * move.width * 0.32, move.cy + 14);
	await page.waitForTimeout(260);
	const running = await snapshot(page);
	await touch.down(2, attack.cx, attack.cy);
	// Give a possibly-throttled page enough frames to run the fixed step the
	// press belongs to; 140ms was one frame in a backgrounded context.
	await page.waitForTimeout(320);
	const dbg = await page.evaluate(() => {
		const i = window.__inputState!();
		const g = window.__gameState!();
		return {
			facing: i.facing,
			face: i.face,
			aim: Math.round((i.aim.angle * 180) / Math.PI),
			scheme: i.scheme,
			assist: i.assist,
			attacking: i.attacking,
			deck: i.deckVisible,
			enemyX: g.enemyPhys?.x ?? null,
			playerX: g.playerPhys.x,
			stance: g.playerPhys.stance,
			blocking: g.playerPhys.blocking,
			blend: i.aim.blend,
			over: i.aim.overriding,
			action: g.playerPhys.meleeAction,
			attackHeld: g.playerPhys.attackHeld,
			hp: g.playerHP,
		};
	});
	await touch.lift(2);
	await touch.lift(1);
	check(
		"a held attack turns toward the foe while running away (retreat-slash)",
		dist < 240 && running.vx * -toward > 20 && dbg.facing === toward,
		`dist=${Math.round(dist)} vx=${running.vx} toward=${toward} ${JSON.stringify(dbg)}`,
	);
	if (errors.length)
		check("retreat-slash: no page errors", false, errors.join(" | "));
	await ctx.close();
}

/**
 * Turning the deck off must not strand a phone.
 *
 * The Menu button used to live inside the deck, so switching the deck Off — or
 * switching Aiming to Mouse, which auto-hides it — removed the only way back
 * into the menu on a device with no Escape key.
 */
async function runDeckOff(browser: Browser, check: Check) {
	const view: View = {
		width: 844,
		height: 390,
		tag: "deck-off",
		portrait: false,
	};
	const { ctx, page, errors } = await openGame(browser, view, check);
	await dismissCoach(page);
	await page.locator('[data-deck="menu"]').tap();
	await page.waitForTimeout(200);
	await page.getByRole("button", { name: "Controls" }).click();
	await page.waitForTimeout(150);
	const deckRow = page.locator(".gd-setting").filter({
		has: page.locator(".gd-setting-head", { hasText: "On-screen deck" }),
	});
	await deckRow.getByRole("button", { name: "Off" }).click();
	await page.waitForTimeout(150);
	const bareMenus = await page.locator('[data-deck="menu"]').count();
	check(
		"turning the deck off leaves a menu affordance",
		bareMenus === 1,
		`menu pills=${bareMenus}`,
	);
	await page.getByRole("button", { name: "Back" }).click();
	await page.getByRole("button", { name: "Resume" }).click();
	await page.waitForTimeout(300);
	check(
		"the deck's hands are gone after Off",
		(await page.locator('[data-deck="move"]').count()) === 0 &&
			(await page.locator('[data-deck="attack"]').count()) === 0,
		"",
	);
	const restored = await page.evaluate(() =>
		[".vdh-ammo", ".vdh-item", ".vdh-ult"].map((s) => {
			const el = document.querySelector(s);
			return el ? getComputedStyle(el).display : "missing";
		}),
	);
	check(
		"turning the deck off restores the HUD readouts",
		restored.every((d) => d !== "none" && d !== "missing"),
		restored.join(","),
	);
	const menu = page.locator('[data-deck="menu"]');
	check(
		"the menu pill survives with the deck hidden",
		await menu.isVisible().catch(() => false),
		"",
	);
	await menu.tap();
	await page.waitForTimeout(250);
	check(
		"and it still opens the menu",
		await page
			.getByRole("button", { name: "Resume" })
			.isVisible()
			.catch(() => false),
		"",
	);
	if (errors.length)
		check("deck-off: no page errors", false, errors.join(" | "));
	await ctx.close();
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function run() {
	mkdirSync(OUT, { recursive: true });
	const browser = await launchBrowser();
	const checks: { name: string; ok: boolean; detail: string }[] = [];
	const check: Check = (name, ok, detail) => checks.push({ name, ok, detail });

	for (const view of VIEWS) await runLayout(browser, view, check);
	await runLayout(browser, VIEWS[0]!, check, "0,59,21,59");
	await runLayout(browser, VIEWS[1]!, check, "47,0,34,0");
	await runFight(browser, check);
	await runRetreatSlash(browser, check);
	await runDeckOff(browser, check);
	await browser.close();

	const failures = checks.filter((c) => !c.ok);
	console.log("\n===== DECK =====");
	console.log(
		JSON.stringify(
			{
				verdict: failures.length ? "FAIL" : "PASS",
				passed: checks.length - failures.length,
				of: checks.length,
				failures,
				checks,
			},
			null,
			2,
		),
	);
	process.exit(failures.length ? 1 : 0);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
