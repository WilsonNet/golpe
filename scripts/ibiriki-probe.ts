#!/usr/bin/env node
/**
 * Ibiriki, measured online. See specs/ibiriki.md.
 *
 * The physics diagnostic reads positions: it cannot see an axe stick in a
 * wall, a bot walk back to pick it up, a guard crushed by the Sunder, a room
 * standing still under the rupture or a predator going berserk. This plays two
 * AI Ibirikis in one room against two server bots (so the curse has a crowd to
 * bleed, and the proximity-fed bloodlust has time to line up with a nearby low
 * foe), armed from the start (`ultCharge=150`, the meter Rupture's cap actually
 * asks for), and asserts every part of the kit actually happened — and that
 * nothing desynced while it did.
 *
 * Run: `tsx scripts/ibiriki-probe.ts [--duration=60000]` with both dev servers up.
 */
import type { BrowserContext, Page } from "playwright";
import { launchBrowser } from "./browser";

const BASE = "http://localhost:8084";
const arg = (name: string, fallback: string) =>
	process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ??
	fallback;
const DURATION = Number(arg("duration", "60000"));
const ROOM = `ibiprobe-${Date.now().toString(36)}`;

type State = NonNullable<ReturnType<NonNullable<Window["__ibirikiState"]>>>;

const consoleLines: string[] = [];

async function boot(page: Page, url: string, errors: string[]) {
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		consoleLines.push(m.text());
		if (m.type() === "error") errors.push(m.text());
	});
	await page.goto(url);
	await page.waitForFunction(
		() => typeof window.__ibirikiState === "function",
		{
			timeout: 20000,
		},
	);
}

/**
 * Measure the two halves of the passive in the one room where distance is a
 * controlled variable: a training dummy at 25% HP at the far edge (660px away)
 * and then 180px away. The far dummy must feed a faded meter — not the full
 * one — while the near one fills it. Both are in view in a one-screen practice
 * room, so both carry a prey pin; the edge clamp itself is unit-tested by
 * `PreyMarkers.test.ts`. See specs/ibiriki.md.
 */
async function measurePrey(ctx: BrowserContext) {
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?training=true&mute=1&hero=ibiriki&ultCharge=150`);
	await page.waitForFunction(() => !!window.__training, { timeout: 20000 });
	const seated = await page.evaluate(() => window.__training!.ready(20000));
	if (!seated) throw new Error("training room never seated");

	const place = async (dummyX: number) => {
		await page.evaluate(async (x) => {
			await window.__training!.set({
				behaviour: "idle",
				dummyHp: 25,
				dummyInvincible: true,
				playerInvincible: true,
				spawn: { player: { x: 100, y: 480 }, dummy: { x, y: 480 } },
			});
			await window.__training!.reset();
		}, dummyX);
	};
	const read = () =>
		page.evaluate(() => {
			const hud = document.querySelector(".vdh-hud")?.getBoundingClientRect();
			return {
				bloodlust: window.__gameState?.().playerPhys?.bloodlust ?? -1,
				pins: Array.from(document.querySelectorAll(".vdh-prey")).map((el) => {
					const r = el.getBoundingClientRect();
					return hud
						? {
								x: (r.left + r.width / 2 - hud.left) / hud.width,
								y: (r.top + r.height / 2 - hud.top) / hud.height,
							}
						: { x: -1, y: -1 };
				}),
			};
		});

	await place(760);
	await page.waitForFunction(
		() => (window.__gameState?.().playerPhys?.bloodlust ?? -1) > 0.5,
		null,
		{ timeout: 8000 },
	);
	await page.waitForTimeout(500);
	const far = await read();

	await place(280);
	await page.waitForFunction(
		() => (window.__gameState?.().playerPhys?.bloodlust ?? -1) === 1,
		null,
		{ timeout: 8000 },
	);
	await page.waitForTimeout(500);
	const near = await read();

	await page.close();
	return {
		farBloodlust: far.bloodlust,
		nearBloodlust: near.bloodlust,
		farPins: far.pins.length,
		nearPins: near.pins.length,
		farPinOnPrey: far.pins.some((p) => p.x > 0.8),
		nearPinOnPrey: near.pins.some((p) => p.x > 0.2 && p.x < 0.5),
	};
}

async function main() {
	const browser = await launchBrowser();
	const ctx = await browser.newContext({
		viewport: { width: 800, height: 600 },
	});
	const errors: string[] = [];
	// The creator asks for the crowd: two server bots playing Lia, so the
	// rupture always has more than one body to bleed. `ultCharge=150` is
	// Rupture's own cap — with the old universal 100 the room would seat every
	// Ibiriki 50 short of a cast, which is the bug this line exists to catch.
	const creator = `${BASE}/?online=true&ai=true&mute=1&room=${ROOM}&hero=ibiriki&ultCharge=150&bots=2&botHero=lia&scoreLimit=99`;
	const joiner = `${BASE}/?online=true&ai=true&mute=1&room=${ROOM}&hero=ibiriki`;
	const a = await ctx.newPage();
	await boot(a, creator, errors);
	const b = await ctx.newPage();
	await boot(b, joiner, errors);

	await a.waitForTimeout(2500);
	await a.evaluate((ms) => {
		window.__physicsDiagnostic?.(ms);
	}, DURATION - 3000);
	await a.waitForTimeout(DURATION);
	const states: State[] = [];
	for (const p of [a, b]) {
		const s = await p.evaluate(() => window.__ibirikiState?.());
		if (s) states.push(s);
	}
	const diagText =
		consoleLines.find((l) => l.includes("__DIAGNOSTIC_RESULT__")) ?? "";
	const prey = await measurePrey(ctx);
	await ctx.close();
	await browser.close();

	const sum = (f: (s: State) => number) => states.reduce((n, s) => n + f(s), 0);
	const mine = (k: string) => sum((s) => s.myAxeEvents[k] ?? 0);
	const report = {
		throws: mine("stuck") + mine("hit") + mine("blocked") + mine("crushed"),
		axeHits: mine("hit"),
		axeCrushes: mine("crushed"),
		axeBlocked: mine("blocked"),
		axesStuck: mine("stuck"),
		pickups: mine("pickup"),
		ruptures: Math.max(...states.map((s) => s.ruptures)),
		cursedFrames: sum((s) => s.cursedFrames),
		berserkFrames: sum((s) => s.berserkFrames),
		maxBloodlust: Math.max(...states.map((s) => s.maxBloodlust)),
		sunderChargeFrames: sum((s) => s.sunderChargeFrames),
		throwChargeFrames: sum((s) => s.throwChargeFrames),
		stompFrames: sum((s) => s.stompFrames),
		berserkGunFrames: sum((s) => s.berserkGunFrames),
		berserkThrowChargeFrames: sum((s) => s.berserkThrowChargeFrames),
		frenzyHits: sum((s) => s.frenzyHits),
		frenzyChips: sum((s) => s.frenzyChips),
		frenzyGuardBreaks: sum((s) => s.frenzyGuardBreaks),
		axesInWorldAtEnd: states[0]?.axesInWorld ?? 0,
		prey,
		errors: errors.slice(0, 5),
	};

	// The physics diagnostic's own netcode verdict for the same run.
	const m = /__DIAGNOSTIC_RESULT__(.*)__END__/s.exec(diagText);
	const parsed = m?.[1] ? JSON.parse(m[1]) : null;
	const melee = parsed?.melee ?? parsed?.meleeSummary;
	const net = {
		verdict: parsed?.verdict ?? "no diagnostic",
		meleeDesyncFrames: melee?.meleeDesyncFrames ?? -1,
		illegalActions: melee?.illegalActions ?? -1,
		frameDataViolations: melee?.frameDataViolations ?? -1,
	};
	console.log(JSON.stringify({ report, net }, null, 2));

	const checks: [string, boolean][] = [
		["axes were thrown", report.throws > 0],
		["an axe hit a body", report.axeHits + report.axeCrushes > 0],
		["an axe stuck in the world", report.axesStuck > 0],
		["an axe was picked back up", report.pickups > 0],
		["the axe throw charged", report.throwChargeFrames > 0],
		["the Sunder charged", report.sunderChargeFrames > 0],
		["the rupture was cast", report.ruptures > 0],
		["the stomp played", report.stompFrames > 0],
		["somebody was cursed", report.cursedFrames > 0],
		["bloodlust rose", report.maxBloodlust > 0],
		["berserk happened", report.berserkFrames > 0],
		["bloodlust fades with distance", prey.farBloodlust > 0 && prey.nearBloodlust === 1 && prey.farBloodlust < prey.nearBloodlust],
		["a bleeding prey gets a pin", prey.farPins > 0 && prey.nearPins > 0],
		["the pin sits over the prey", prey.farPinOnPrey && prey.nearPinOnPrey],
		["the frenzy landed", report.frenzyHits + report.frenzyChips > 0],
		["berserk never held the ranged stance", report.berserkGunFrames === 0],
		["berserk never wound up a throw", report.berserkThrowChargeFrames === 0],
		["no guard ever broke the frenzy", report.frenzyGuardBreaks === 0],
		["no page errors", report.errors.length === 0],
		["no melee desyncs", net.meleeDesyncFrames === 0],
		["no illegal actions", net.illegalActions === 0],
	];
	let failed = 0;
	for (const [label, ok] of checks) {
		console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
		if (!ok) failed++;
	}
	console.log(
		failed === 0
			? "\nIBIRIKI PROBE: PASS"
			: `\nIBIRIKI PROBE: ${failed} FAILED`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
