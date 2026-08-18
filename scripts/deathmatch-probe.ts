#!/usr/bin/env node
import type { Page } from "playwright";
/**
 * Deathmatch feedback loop: a room full of AI, played to a winner.
 *
 * `diagnose.ts` answers "is the physics clean in a duel?". This answers the
 * questions a duel cannot ask at all — does a sixteen-fighter room stay
 * consistent, does rollback predict fifteen strangers well enough to be worth
 * having, does the scoreboard add up, and does the match actually *end*.
 *
 * The rules are shortened so a win condition is observable in seconds rather
 * than five minutes. Everything else is the real path: real server, real
 * snapshots, real prediction, real bots.
 *
 *   tsx scripts/deathmatch-probe.ts
 *   tsx scripts/deathmatch-probe.ts --fighters=16 --scoreLimit=5 --timeLimit=90
 *   tsx scripts/deathmatch-probe.ts --scoreLimit=999 --timeLimit=20   # test the clock
 */
import { chromium } from "playwright";
import type { MatchStateSnapshot } from "../src/types/global";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const FIGHTERS = Number(arg("fighters", "16"));
const SCORE_LIMIT = Number(arg("scoreLimit", "5"));
const TIME_LIMIT_SEC = Number(arg("timeLimit", "120"));
/** How long the physics diagnostic samples for, inside the match. */
const DIAG_MS = Number(arg("diagnostic", "12000"));
/** Give up rather than hang if the match never ends. */
const WALL_CLOCK_MS = (TIME_LIMIT_SEC + 60) * 1000;
/** How many 800px screens wide the arena is. Defaults to the classic one. */
const SCREENS = Math.max(1, Number(arg("screens", "1")) || 1);
/** `--hero=anands` plays the whole room as the dagger hero. */
const HERO = arg("hero", "");
/** `--botHero=anands` seats every bot as the dagger hero. */
const BOT_HERO = arg("botHero", "");

function sinkConsole(page: Page, lines: string[] = []): string[] {
	page.on("console", (msg) => lines.push(msg.text()));
	page.on("pageerror", (err) => lines.push(`[PAGEERROR] ${err.message}`));
	return lines;
}

/**
 * Fail loudly if the game server is down.
 *
 * A dead server produces a match that never starts, no snapshots and therefore
 * no misprediction — a false PASS that looks like a clean bill of health.
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

/** Poll `__matchState()` until `done` says stop, or the wall clock runs out. */
async function waitForMatch(
	page: Page,
	done: (s: MatchStateSnapshot) => boolean,
	timeoutMs: number,
): Promise<MatchStateSnapshot | null> {
	const deadline = Date.now() + timeoutMs;
	let last: MatchStateSnapshot | null = null;
	while (Date.now() < deadline) {
		last = await page.evaluate(() => window.__matchState?.() ?? null);
		if (last && done(last)) return last;
		await page.waitForTimeout(500);
	}
	return last;
}

/**
 * The fields of the diagnostic report this probe reads.
 */
interface DiagnosticReport {
	verdict?: string;
	fpsStats?: { avgFps?: number };
	jitterSummary?: unknown;
	jitterEvents?: unknown[];
	reconciliationSummary?: unknown;
	collisionSummary?: unknown;
	meleeSummary?: unknown;
	bulletSummary?: unknown;
	netSummary?: MatchStateSnapshot["net"];
}

/**
 * Every check the report makes, as data.
 *
 * Split into "must hold" and "must not be zero" for the same reason the melee
 * counters are: a room where nobody ever fought satisfies every correctness
 * check trivially, and a probe that only reports correctness would call it a
 * pass.
 */
function assess(
	state: MatchStateSnapshot | null,
	diagnostic: DiagnosticReport | null,
	lines: string[],
) {
	const failures: string[] = [];
	const notes: string[] = [];
	if (!state) {
		return { failures: ["no __matchState() — the client never booted"], notes };
	}

	const { standings, phase, endReason, winnerId, winnerName } = state;
	const kills = standings.reduce((a, s) => a + s.kills, 0);
	const deaths = standings.reduce((a, s) => a + s.deaths, 0);
	const places = standings.map((s) => s.place);

	if (state.fighterCount !== FIGHTERS) {
		failures.push(
			`${state.fighterCount} fighters in the room, wanted ${FIGHTERS}`,
		);
	}
	if (phase !== "over") {
		failures.push(
			`match never ended (phase ${phase}, ${state.timeLeftMs}ms left)`,
		);
	}
	if (phase === "over") {
		if (!winnerId) failures.push("match ended with no winner");
		if (!winnerName) failures.push("winner has no name");
		if (endReason !== "score" && endReason !== "time") {
			failures.push(`match ended for no stated reason (${endReason})`);
		}
		const winner = standings.find((s) => s.id === winnerId);
		if (winner && winner.place !== 1) {
			failures.push(`winner is ranked ${winner.place}, not 1st`);
		}
		if (endReason === "score" && winner && winner.kills < state.scoreLimit) {
			failures.push(
				`ended on score with only ${winner.kills}/${state.scoreLimit} frags`,
			);
		}
	}

	// Places must be a total order: 1..n, each exactly once. A shared place means
	// the tie-break chain is not total, and two clients would draw two different
	// podiums from identical data.
	const expected = standings.map((_, i) => i + 1);
	if (JSON.stringify(places) !== JSON.stringify(expected)) {
		failures.push(`places are not 1..${standings.length}: ${places.join(",")}`);
	}
	if (standings.some((s) => !s.name)) {
		failures.push("a fighter has no name on the scoreboard");
	}
	if (new Set(standings.map((s) => s.name)).size !== standings.length) {
		failures.push("two fighters share a name");
	}

	// Every death is somebody's frag, unless nobody was credited. Kills can never
	// exceed deaths — that would be a frag awarded for a death that never happened.
	if (kills > deaths) failures.push(`${kills} frags but only ${deaths} deaths`);
	if (deaths > kills) notes.push(`${deaths - kills} unattributed death(s)`);

	// A clean run is not a good run: all of the above holds in a room where
	// sixteen fighters stood still.
	if (kills === 0) failures.push("nobody scored — the fight never happened");

	const net = diagnostic?.netSummary ?? state.net;
	if (!net || net.snapshots === 0) {
		failures.push("no snapshots arrived — the client simulated alone");
	}
	const rollback = net?.rollback;
	if (rollback && rollback.rollbacks === 0) {
		failures.push("no rollbacks — remote fighters were never corrected");
	}

	const errors = lines.filter((l) => /\[PAGEERROR\]/.test(l));
	if (errors.length > 0) failures.push(`${errors.length} page error(s)`);
	const desyncs = lines.filter((l) => /\[DESYNC\]/.test(l));
	if (desyncs.length > 0) {
		failures.push(`${desyncs.length} melee prediction desync(s)`);
	}

	return { failures, notes, kills, deaths, net, errors: errors.slice(0, 3) };
}

async function main() {
	await assertServerUp();
	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const lines = sinkConsole(page);

	// A private room the probe owns, filled with bots, on shortened rules. `ai=true`
	// makes the local fighter a bot too, so the whole room is AI — and skips the
	// name prompt, which is gated on exactly that.
	const url =
		`${BASE_URL}/?ai=true&bots=${FIGHTERS - 1}` +
		`&scoreLimit=${SCORE_LIMIT}&timeLimit=${TIME_LIMIT_SEC}` +
		(SCREENS > 1 ? `&screen=${SCREENS}` : "") +
		(HERO ? `&hero=${HERO}` : "") +
		(BOT_HERO ? `&botHero=${BOT_HERO}` : "");
	console.log(`[PROBE] ${url}`);
	await page.goto(url);
	await page.waitForFunction(() => typeof window.__matchState === "function", {
		timeout: 20000,
	});

	// Wait for the room to actually fill before measuring anything about it.
	const seated = await waitForMatch(
		page,
		(s) => s.connected && s.fighterCount >= FIGHTERS,
		20000,
	);
	console.log(
		`[PROBE] seated: ${seated?.fighterCount ?? 0} fighters, me = ${seated?.myName ?? "?"}`,
	);

	// Physics first, while the fight is at its busiest. The report lands on the
	// console asynchronously, which is why it is collected after the match ends.
	await page.evaluate((d) => window.__physicsDiagnostic?.(d), DIAG_MS);

	const final = await waitForMatch(
		page,
		(s) => s.phase === "over",
		WALL_CLOCK_MS,
	);
	// Let the diagnostic's own timer fire if the match beat it to the finish.
	await page.waitForTimeout(2000);

	const hit = lines.find((l) => RESULT_RE.test(l));
	const json = hit?.match(RESULT_RE)?.[1];
	const diagnostic: DiagnosticReport | null = json ? JSON.parse(json) : null;

	const verdict = assess(final, diagnostic, lines);
	console.log("\n===== DEATHMATCH =====");
	console.log(
		JSON.stringify(
			{
				verdict:
					verdict.failures.length === 0
						? "PASS"
						: `FAIL: ${verdict.failures.join("; ")}`,
				notes: verdict.notes,
				match: final && {
					fighters: final.fighterCount,
					phase: final.phase,
					endReason: final.endReason,
					winner: final.winnerName,
					scoreLimit: final.scoreLimit,
					elapsedMs: final.elapsedMs,
					frags: verdict.kills,
					deaths: verdict.deaths,
				},
				podium: final?.standings
					.slice(0, 3)
					.map((s) => `${s.place}. ${s.name} ${s.kills}/${s.deaths}`),
				tail: final?.standings
					.slice(-3)
					.map((s) => `${s.place}. ${s.name} ${s.kills}/${s.deaths}`),
				net: verdict.net,
				physics: diagnostic && {
					verdict: diagnostic.verdict,
					avgFps: diagnostic.fpsStats?.avgFps,
					jitter: diagnostic.jitterSummary,
					recon: diagnostic.reconciliationSummary,
					collisions: diagnostic.collisionSummary,
					melee: diagnostic.meleeSummary,
					bullets: diagnostic.bulletSummary,
				},
				pageErrors: verdict.errors,
			},
			null,
			2,
		),
	);

	// The events themselves, not just the count. A jitter total is a prompt to
	// look; these are what you look at.
	if (diagnostic?.jitterEvents?.length) {
		console.log(
			"first jitter events:",
			JSON.stringify(diagnostic.jitterEvents.slice(0, 8)),
		);
	}

	await ctx.close();
	await browser.close();
	if (verdict.failures.length > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
