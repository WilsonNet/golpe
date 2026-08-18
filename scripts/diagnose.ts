#!/usr/bin/env node
import type { Browser, Page } from "playwright";
/**
 * Physics feedback-loop harness.
 *
 * Drives the game in a real browser, triggers `window.__physicsDiagnostic()`,
 * and prints the structured JSON reports so they can be diffed across fixes.
 *
 *   tsx scripts/diagnose.ts                  # offline + online, 8s each
 *   tsx scripts/diagnose.ts --mode=offline
 *   tsx scripts/diagnose.ts --mode=online --duration=10000 --runs=3
 */
import { chromium } from "playwright";
import type { AIState } from "../src/game/characters/EnemyBrain";
import type { WallSide } from "../src/game/simulation/Physics";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

/**
 * The fields of the diagnostic report the digest reads. The game emits the full
 * report as JSON on the console; this is the contract `diagnose.ts` consumes,
 * so a renamed metric breaks the probe build rather than the measurement.
 */
interface DiagnosticReport {
	mode?: string;
	verdict?: string;
	totalFrames?: number;
	fpsStats?: { avgFps?: number };
	physicsStepDistribution?: { pctZeroStep?: number };
	jitterSummary?: unknown;
	jitterEvents?: unknown[];
	playerMovement?: {
		xRange?: [number, number];
		yRange?: [number, number];
		totalTravelPx?: number;
	};
	movementSummary?: unknown;
	arenaSummary?: unknown;
	bulletSummary?: unknown;
	meleeSummary?: unknown;
	ultimateSummary?: unknown;
	teamSummary?: unknown;
	reconciliationSummary?: unknown;
	netSummary?: unknown;
	collisionSummary?: unknown;
	penetrationEvents?: unknown[];
	states?: StateSample[];
	activity?: ReturnType<typeof activitySummary>;
}

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const MODE = arg("mode", "both");
// 8s was barely two engagements — long enough to prove the mechanics are legal,
// too short to prove the arena and the ranged game get used at all.
const DURATION = Number(arg("duration", "14000"));
const RUNS = Number(arg("runs", "1"));
// How many 800px screens wide the arena is. `?screen=N` widens the map and
// engages the follow camera — which is the whole point of measuring with it:
// camera scroll is read as a jitter signal, so a multi-screen run proves the
// follow cam never moves fast enough to read as a defect.
const SCREENS = Math.max(1, Number(arg("screens", "1")) || 1);
// `?ultCharge=N` arms everybody from the start. A duel over 14s never earns an
// ultimate the long way (~285s of passive charge), so the bots' ultimate use is
// measured with `--ultCharge=100` and read from `ultimateSummary.localCasts`.
const ULT_CHARGE = Math.max(0, Number(arg("ultCharge", "0")) || 0);
// `--hero=anands` makes both duellists play the dagger — the canonical run
// stays the sword game, and this is how the dagger's AI-vs-AI behaviour is
// measured without changing what `diagnose.ts` proves by default.
const HERO = arg("hero", "");
const URL_PARAMS =
	`${SCREENS > 1 ? `&screen=${SCREENS}` : ""}` +
	`${ULT_CHARGE > 0 ? `&ultCharge=${ULT_CHARGE}` : ""}` +
	`${HERO ? `&hero=${HERO}` : ""}`;

/** Attach a console sink to a page and return the collected lines. */
function sinkConsole(page: Page, lines: string[] = []): string[] {
	page.on("console", (msg) => lines.push(msg.text()));
	page.on("pageerror", (err) => lines.push(`[PAGEERROR] ${err.message}`));
	return lines;
}

/** Wait until the game scene has installed its debug hooks. */
async function waitForGame(page: Page) {
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

/** A sample of what the fighters were doing at one point in a run. */
interface StateSample {
	pState: AIState | undefined;
	eState: AIState | undefined;
	hp: string;
	player: { x: number; y: number; g: boolean; w: WallSide } | null;
}

/** Poll __gameState() during a run, to see what the fighters were actually doing. */
async function sampleStates(
	page: Page,
	durationMs: number,
	samples = 5,
): Promise<StateSample[]> {
	const out: StateSample[] = [];
	const gap = Math.floor(durationMs / samples);
	for (let i = 0; i < samples; i++) {
		await page.waitForTimeout(gap);
		try {
			out.push(
				await page.evaluate(() => {
					const s = window.__gameState!();
					// No named inner function here: esbuild's keepNames decorates a
					// named arrow with `__name(fn, "fn")`, and Playwright serializes
					// that call into the browser context, where `__name` does not
					// exist — which silently emptied every state sample since the
					// harness moved to TypeScript.
					const p = s.playerPhys;
					return {
						pState: s.playerState,
						eState: s.enemyState,
						hp: `${s.playerHP}v${s.enemyHP}`,
						player: p
							? {
									x: Math.round(p.x),
									y: Math.round(p.y),
									g: p.grounded,
									w: p.wallTouch,
								}
							: null,
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
async function runDiagnostic(page: Page, lines: string[], durationMs: number) {
	await page.evaluate((d) => window.__physicsDiagnostic!(d), durationMs);
	const states = await sampleStates(page, durationMs);
	await page.waitForTimeout(1500);

	const hit = lines.find((l) => RESULT_RE.test(l));
	if (!hit) throw new Error("no __DIAGNOSTIC_RESULT__ found in console output");
	const json = hit.match(RESULT_RE)?.[1];
	if (!json) throw new Error("empty __DIAGNOSTIC_RESULT__ payload");
	const report = JSON.parse(json) as DiagnosticReport;
	report.states = states;
	return report;
}

/**
 * Is the AI actually fighting?
 *
 * Offline damage is applied client-side and logged as [FIGHT]; online damage is
 * applied by the server and never logged, so HP change is the portable signal.
 */
function activitySummary(lines: string[], states: StateSample[] = []) {
	const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
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

async function offlineRun(browser: Browser, durationMs: number) {
	const page = await browser.newPage();
	const lines = sinkConsole(page);
	// `?offline=true` is the escape hatch's launch key — the root URL shows the
	// menu and never boots a match, so the probe must ask for one. `ai=true`
	// starts the AI-vs-AI brains at boot (the `__toggleAIVsAI` call below would
	// toggle them back off, so it is not made here).
	await page.goto(`${BASE_URL}/?offline=true&ai=true`);
	await waitForGame(page);

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
			"game server unreachable on :9208 — start it with `pnpm run dev:server`",
		);
	}
}

async function onlineRun(browser: Browser, durationMs: number) {
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
	// `scripts/deathmatch-probe.ts` is the sixteen-fighter measurement.
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
function digest(r: DiagnosticReport) {
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
