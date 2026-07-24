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
const DURATION = Number(arg("duration", 8000));
const RUNS = Number(arg("runs", 1));

/** Attach a console sink to a page and return the collected lines. */
function sinkConsole(page, lines = []) {
	page.on("console", (msg) => lines.push(msg.text()));
	page.on("pageerror", (err) => lines.push(`[PAGEERROR] ${err.message}`));
	return lines;
}

/** Wait until the game scene has installed its debug hooks. */
async function waitForGame(page) {
	await page.waitForFunction(() => typeof window.__physicsDiagnostic === "function", {
		timeout: 20000,
	});
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
						p ? { x: Math.round(p.x), y: Math.round(p.y), g: p.grounded, w: p.wallTouch } : null;
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
	const url = `${BASE_URL}/?online=true&ai=true`;

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
		bullets: r.bulletSummary,
		recon: r.reconciliationSummary,
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
				console.log("first jitter events:", JSON.stringify(report.jitterEvents.slice(0, 8)));
			}
		}
	}

	await browser.close();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
