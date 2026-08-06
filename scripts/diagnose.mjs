#!/usr/bin/env node
/**
 * Physics feedback-loop harness.
 *
 * Drives the game in a real browser, triggers `window.__physicsDiagnostic()`,
 * and prints the structured JSON reports so they can be diffed across fixes.
 *
 *   node scripts/diagnose.mjs                  # offline + online, 8s each
 *   node scripts/diagnose.mjs --mode=offline
 *   node scripts/diagnose.mjs --mode=online --duration=10000 --runs=3
 */
import { chromium } from "playwright";

const BASE_URL = process.env.VENTO_URL ?? "http://localhost:8080";
const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

function arg(name, fallback) {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split("=")[1] : fallback;
}

const MODE = arg("mode", "both");
// 8s was barely two engagements — long enough to prove the mechanics are legal,
// too short to prove the arena and the ranged game get used at all.
const DURATION = Number(arg("duration", 14000));
const RUNS = Number(arg("runs", 1));
// How many 800px screens wide the arena is. `?screen=N` widens the map and
// engages the follow camera — which is the whole point of measuring with it:
// camera scroll is read as a jitter signal, so a multi-screen run proves the
// follow cam never moves fast enough to read as a defect.
const SCREENS = Math.max(1, Number(arg("screens", 1)) || 1);
// `?ultCharge=N` arms everybody from the start. A duel over 14s never earns an
// ultimate the long way (~285s of passive charge), so the bots' ultimate use is
// measured with `--ultCharge=100` and read from `ultimateSummary.localCasts`.
const ULT_CHARGE = Math.max(0, Number(arg("ultCharge", 0)) || 0);
// `--hero=anands` makes both duellists play the dagger — the canonical run
// stays the sword game, and this is how the dagger's AI-vs-AI behaviour is
// measured without changing what `diagnose.mjs` proves by default.
const HERO = arg("hero", "");
const URL_PARAMS =
	`${SCREENS > 1 ? `&screen=${SCREENS}` : ""}` +
	`${ULT_CHARGE > 0 ? `&ultCharge=${ULT_CHARGE}` : ""}` +
	`${HERO ? `&hero=${HERO}` : ""}`;

/** Attach a console sink to a page and return the collected lines. */
function sinkConsole(page, lines = []) {
	page.on("console", (msg) => lines.push(msg.text()));
	page.on("pageerror", (err) => lines.push(`[PAGEERROR] ${err.message}`));
	return lines;
}

/** Wait until the game scene has installed its debug hooks. */
async function waitForGame(page) {
	await page.waitForFunction(
		() => typeof window.__physicsDiagnostic === "function",
		{
			timeout: 20000,
		},
	);
	// A human-controlled client waits for a name before it connects. Answering
	// through the same event the modal fires keeps this on the path a player
	// takes; a client running as AI has already named itself and ignores this.
	await page.evaluate(() => window.__setPlayerName?.("Diagnostic"));
}

/** Poll __gameState() during a run, to see what the fighters were actually doing. */
async function sampleStates(page, durationMs, samples = 5) {
	const out = [];
	const gap = Math.floor(durationMs / samples);
	for (let i = 0; i < samples; i++) {
		await page.waitForTimeout(gap);
		try {
			out.push(
				await page.evaluate(() => {
					const s = window.__gameState();
					const round = (p) =>
						p
							? {
									x: Math.round(p.x),
									y: Math.round(p.y),
									g: p.grounded,
									w: p.wallTouch,
								}
							: null;
					return {
						pState: s.playerState,
						eState: s.enemyState,
						hp: `${s.playerHP}v${s.enemyHP}`,
						player: round(s.playerPhys),
					};
				}),
			);
		} catch {
			/* page may be mid-navigation */
		}
	}
	return out;
}

/** Run one diagnostic on an already-prepared page and parse the report. */
async function runDiagnostic(page, lines, durationMs) {
	await page.evaluate((d) => window.__physicsDiagnostic(d), durationMs);
	const states = await sampleStates(page, durationMs);
	await page.waitForTimeout(1500);

	const hit = lines.find((l) => RESULT_RE.test(l));
	if (!hit) throw new Error("no __DIAGNOSTIC_RESULT__ found in console output");
	const report = JSON.parse(hit.match(RESULT_RE)[1]);
	report.states = states;
	return report;
}

/**
 * Is the AI actually fighting?
 *
 * Offline damage is applied client-side and logged as [FIGHT]; online damage is
 * applied by the server and never logged, so HP change is the portable signal.
 */
function activitySummary(lines, states = []) {
	const count = (re) => lines.filter((l) => re.test(l)).length;
	const hps = states.map((s) => s.hp).filter(Boolean);
	return {
		bulletHits: count(/\[FIGHT\].*hit/),
		defeats: count(/\[FIGHT\].*defeated/),
		resets: count(/FIGHT RESET/),
		errors: count(/\[PAGEERROR\]/),
		// e.g. ["100v100", "50v30"] — proves damage is being dealt in either mode.
		hpTrace: [...new Set(hps)],
		fighting: new Set(hps).size > 1,
	};
}

async function offlineRun(browser, durationMs) {
	const page = await browser.newPage();
	const lines = sinkConsole(page);
	await page.goto(BASE_URL);
	await waitForGame(page);
	await page.evaluate(() => window.__toggleAIVsAI());
	await page.waitForTimeout(2000);

	const report = await runDiagnostic(page, lines, durationMs);
	report.activity = activitySummary(lines, report.states);
	await page.close();
	return report;
}

/**
 * Fail loudly if the game server is down.
 *
 * A dead server produces a diagnostic with no snapshots, no reconciliation and
 * therefore no jitter — a false PASS that looks like a clean bill of health.
 */
async function assertServerUp() {
	const res = await fetch("http://localhost:9208/.wrtc/v2/connections", {
		method: "POST",
	}).catch(() => null);
	if (!res) {
		throw new Error(
			"game server unreachable on :9208 — start it with `npm run dev:server`",
		);
	}
}

async function onlineRun(browser, durationMs) {
	await assertServerUp();
	const ctx = await browser.newContext();
	// **The same `room` for both tabs, or they are not in the same match.** Rooms
	// are addressed rather than matchmade, so a client with no `?room=` makes a new
	// one — two tabs opened at the same URL would sit in two separate rooms and the
	// report would be about a client fighting a bot on its own.
	//
	// A fresh id per run, so consecutive runs cannot land in each other's room.
	//
	// No `fill`: bots are opt-in, so two clients in one room *are* two fighters.
	// That keeps this run a duel, which is what it is for — prediction,
	// reconciliation and projectiles are cleanest to read against one opponent.
	// `scripts/deathmatch-probe.mjs` is the sixteen-fighter measurement.
	const room = `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const url = `${BASE_URL}/?online=true&ai=true&room=${room}${URL_PARAMS}`;

	const a = await ctx.newPage();
	const linesA = sinkConsole(a);
	await a.goto(url);
	await waitForGame(a);

	const b = await ctx.newPage();
	sinkConsole(b);
	await b.goto(url);
	await waitForGame(b);

	// Both clients must be in the room before physics means anything.
	await a.waitForTimeout(3000);

	const report = await runDiagnostic(a, linesA, durationMs);
	report.activity = activitySummary(linesA, report.states);
	await ctx.close();

	// No reconciliation at all means no snapshots were ever applied: the client
	// was simulating alone, so the numbers say nothing about the netcode.
	if (!report.reconciliationSummary) {
		report.verdict = "INVALID: no server snapshots received";
	}
	return report;
}

/** Condense a report down to the numbers that decide pass/fail. */
function digest(r) {
	return {
		verdict: r.verdict,
		frames: r.totalFrames,
		avgFps: r.fpsStats?.avgFps,
		pctZeroStep: r.physicsStepDistribution?.pctZeroStep,
		jitter: r.jitterSummary,
		travelPx: r.playerMovement?.totalTravelPx,
		xRange: r.playerMovement?.xRange,
		yRange: r.playerMovement?.yRange,
		movement: r.movementSummary,
		arena: r.arenaSummary,
		bullets: r.bulletSummary,
		melee: r.meleeSummary,
		ult: r.ultimateSummary,
		team: r.teamSummary,
		recon: r.reconciliationSummary,
		net: r.netSummary,
		collisions: r.collisionSummary,
		penetrations: r.penetrationEvents?.slice(0, 3),
		activity: r.activity,
	};
}

async function main() {
	const browser = await chromium.launch();
	const modes = MODE === "both" ? ["offline", "online"] : [MODE];

	for (const mode of modes) {
		for (let run = 1; run <= RUNS; run++) {
			const report =
				mode === "offline"
					? await offlineRun(browser, DURATION)
					: await onlineRun(browser, DURATION);
			console.log(`\n===== ${mode.toUpperCase()} run ${run}/${RUNS} =====`);
			console.log(JSON.stringify(digest(report), null, 2));
			if (report.jitterEvents?.length) {
				console.log(
					"first jitter events:",
					JSON.stringify(report.jitterEvents.slice(0, 8)),
				);
			}
		}
	}

	await browser.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
