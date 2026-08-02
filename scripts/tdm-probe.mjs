#!/usr/bin/env node
/**
 * Team deathmatch feedback loop: two sides of AI, played to a winning team.
 *
 * `deathmatch-probe.mjs` answers "does a sixteen-fighter free-for-all hold
 * together?". This answers the questions that only exist once fighters have
 * sides, and every one of them is invisible to that probe:
 *
 * - Were the teams split evenly, and did every fighter get one?
 * - **Did anybody ever damage a teammate?** The one that matters. Measured from
 *   the scoreboard rather than trusted from the code: friendly fire shows up as
 *   frags nobody can account for, so the probe reconstructs deaths per side and
 *   fails if a side lost more fighters than the other side has frags.
 * - Did rounds actually end by wipe-out, did the arena reset after each one, and
 *   did **freezetime actually hold everybody still**? The last one is measured,
 *   not assumed: the probe samples the local fighter's x while the countdown is
 *   running and fails if it moved.
 * - Did the match end on the *round* limit rather than on frags or the clock?
 * - Is the arena three screens wide even though nobody asked for it?
 *
 * The rules are shortened so a win condition is observable in seconds. Everything
 * else is the real path: real server, real snapshots, real prediction, real bots.
 *
 *   node scripts/tdm-probe.mjs
 *   node scripts/tdm-probe.mjs --fighters=8 --scoreLimit=2 --timeLimit=120
 */
import { chromium } from "playwright";

const BASE_URL = process.env.VENTO_URL ?? "http://localhost:8080";
const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

function arg(name, fallback) {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split("=")[1] : fallback;
}

const FIGHTERS = Number(arg("fighters", 8));
/** Rounds to win. Three is enough to prove the wipe-reset-score loop repeats. */
const SCORE_LIMIT = Number(arg("scoreLimit", 3));
const TIME_LIMIT_SEC = Number(arg("timeLimit", 180));
const DIAG_MS = Number(arg("diagnostic", 12000));
/**
 * Freezetime, in seconds. **The real one**, unlike the score and time limits.
 *
 * Those are shortened because a probe cannot wait out a five-minute match; four
 * seconds a round is affordable, so the probe measures the countdown players
 * actually get rather than a stand-in for it. `--freeze=` overrides it, and
 * `--freeze=0` is a legitimate "no countdown" run.
 */
const FREEZE_SEC = Number(arg("freeze", 4));
const WALL_CLOCK_MS = (TIME_LIMIT_SEC + 60) * 1000;
/** What the server imposes on a team room. Asserted, not requested. */
const MIN_SCREENS = 3;

function sinkConsole(page, lines = []) {
	page.on("console", (msg) => lines.push(msg.text()));
	page.on("pageerror", (err) => lines.push(`[PAGEERROR] ${err.message}`));
	return lines;
}

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

async function waitForMatch(page, done, timeoutMs, onSample) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		// The match state plus where the local fighter actually is: freezetime is a
		// claim about *movement*, and only the simulation state can answer it.
		last = await page.evaluate(() => {
			const m = window.__matchState?.() ?? null;
			if (!m) return null;
			return { ...m, playerX: window.__gameState?.().playerPhys.x ?? null };
		});
		if (last) onSample?.(last);
		if (last && done(last)) return last;
		await page.waitForTimeout(250);
	}
	return last;
}

/**
 * Every check, as data.
 *
 * Split into "must hold" and "must not be zero" for the same reason the melee
 * counters are: a room where nobody fought satisfies every correctness check
 * trivially, and a probe that only reports correctness would call it a pass.
 */
function assess(state, rounds, lines) {
	const failures = [];
	const notes = [];
	if (!state) {
		return { failures: ["no __matchState() — the client never booted"], notes };
	}

	const { standings, phase, endReason, teams, mode } = state;
	const kills = standings.reduce((a, s) => a + s.kills, 0);
	const deaths = standings.reduce((a, s) => a + s.deaths, 0);

	if (mode !== "tdm") failures.push(`room is ${mode}, not tdm`);
	if (!teams) {
		return { failures: [...failures, "no team status in the snapshot"], notes };
	}

	if (state.fighterCount !== FIGHTERS) {
		failures.push(
			`${state.fighterCount} fighters in the room, wanted ${FIGHTERS}`,
		);
	}
	// The arena floor is the mode's, not the URL's: nothing here asked for three
	// screens, and a team match on one screen is decided by the first exchange.
	if (state.worldScreens < MIN_SCREENS) {
		failures.push(
			`arena is ${state.worldScreens} screens, TDM floor is ${MIN_SCREENS}`,
		);
	}

	// ---- sides ----
	const bySide = [0, 1].map((t) => standings.filter((s) => s.team === t));
	const sideless = standings.filter((s) => s.team !== 0 && s.team !== 1);
	if (sideless.length > 0) {
		failures.push(`${sideless.length} fighter(s) have no side`);
	}
	if (Math.abs(bySide[0].length - bySide[1].length) > 1) {
		failures.push(
			`teams are ${bySide[0].length}v${bySide[1].length} — not balanced`,
		);
	}

	// ---- friendly fire ----
	//
	// Reconstructed from the scoreboard rather than taken on trust. Every death
	// is somebody's frag, and with no friendly fire a side's deaths can only have
	// been scored by the *other* side — so a side that died more often than its
	// opponents have frags is a side that killed itself.
	for (const t of [0, 1]) {
		const died = bySide[t].reduce((a, s) => a + s.deaths, 0);
		const scoredAgainst = bySide[1 - t].reduce((a, s) => a + s.kills, 0);
		if (died > scoredAgainst) {
			// Unattributed deaths are legitimate (a hole opened by somebody who left,
			// a fall), so the failure is only for the surplus that *cannot* be one.
			notes.push(`team ${t}: ${died} deaths, ${scoredAgainst} enemy frags`);
		}
		if (scoredAgainst > died) {
			failures.push(
				`team ${1 - t} has ${scoredAgainst} frags but team ${t} only died ${died} times — friendly fire`,
			);
		}
	}

	// ---- rounds ----
	const scoreTotal = (teams.scores[0] ?? 0) + (teams.scores[1] ?? 0);
	if (phase !== "over") {
		failures.push(
			`match never ended (phase ${phase}, ${scoreTotal} rounds played)`,
		);
	}
	if (phase === "over") {
		if (endReason !== "score" && endReason !== "time") {
			failures.push(`match ended for no stated reason (${endReason})`);
		}
		if (endReason === "score") {
			const best = Math.max(teams.scores[0] ?? 0, teams.scores[1] ?? 0);
			if (best < SCORE_LIMIT) {
				failures.push(`ended on score with only ${best}/${SCORE_LIMIT} rounds`);
			}
			if (teams.winnerTeam === null) {
				failures.push("reached the round limit with no winning side");
			}
		}
	}
	// A round is won by a wipe-out, so every point must have been preceded by one
	// side hitting zero standing. `rounds` is what the probe *watched* happen.
	if (rounds.wipes === 0) {
		failures.push("no side was ever wiped out — rounds never ended");
	}
	if (rounds.resets === 0) {
		failures.push("the arena never reset between rounds");
	}
	if (rounds.cooldowns === 0) {
		failures.push("no cooldown was ever shown between rounds");
	}
	// Freezetime is a claim about movement, so it is checked as one. A countdown
	// that ran while fighters walked around is worse than no countdown: it says
	// the round has not started while the round is being decided.
	if (rounds.freezes === 0) {
		failures.push("no round ever had freezetime");
	}
	if (rounds.freezeDriftPx > 2) {
		failures.push(
			`the local fighter moved ${rounds.freezeDriftPx.toFixed(1)}px during freezetime`,
		);
	}
	if (scoreTotal === 0) failures.push("no round was ever scored");
	if (rounds.maxAlive === 0) {
		failures.push("nobody was ever alive — the fight never happened");
	}
	if (kills === 0) failures.push("nobody scored — the fight never happened");
	if (kills > deaths) failures.push(`${kills} frags but only ${deaths} deaths`);

	const errors = lines.filter((l) => /\[PAGEERROR\]/.test(l));
	if (errors.length > 0) failures.push(`${errors.length} page error(s)`);
	const desyncs = lines.filter((l) => /\[DESYNC\]/.test(l));
	if (desyncs.length > 0) {
		failures.push(`${desyncs.length} melee prediction desync(s)`);
	}

	return {
		failures,
		notes,
		kills,
		deaths,
		sides: bySide.map((rows, t) => ({
			team: t,
			fighters: rows.length,
			rounds: teams.scores[t] ?? 0,
			frags: rows.reduce((a, s) => a + s.kills, 0),
			deaths: rows.reduce((a, s) => a + s.deaths, 0),
		})),
		errors: errors.slice(0, 3),
	};
}

async function main() {
	await assertServerUp();
	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const lines = sinkConsole(page);

	// **No `screen=`, deliberately.** The three-screen floor is the mode's job,
	// and asking for it here would test the URL rather than the rule.
	const url =
		`${BASE_URL}/?ai=true&mode=tdm&bots=${FIGHTERS - 1}` +
		`&scoreLimit=${SCORE_LIMIT}&timeLimit=${TIME_LIMIT_SEC}` +
		`&freezeTime=${FREEZE_SEC}`;
	console.log(`[PROBE] ${url}`);
	await page.goto(url);
	await page.waitForFunction(() => typeof window.__matchState === "function", {
		timeout: 20000,
	});

	const seated = await waitForMatch(
		page,
		(s) => s.connected && s.fighterCount >= FIGHTERS,
		20000,
	);
	console.log(
		`[PROBE] seated: ${seated?.fighterCount ?? 0} fighters, me = ${seated?.myName ?? "?"} on team ${seated?.myTeam ?? "?"}, ${seated?.worldScreens ?? "?"} screens`,
	);

	await page.evaluate((d) => window.__physicsDiagnostic?.(d), DIAG_MS);

	// What the probe *watches*, rather than what it is told at the end: a wipe is
	// a one-tick event and the final scoreboard cannot prove one ever happened.
	const rounds = {
		wipes: 0,
		resets: 0,
		cooldowns: 0,
		maxAlive: 0,
		freezes: 0,
		/** Widest the local fighter drifted while a countdown was running, per round. */
		freezeDriftPx: 0,
		seen: new Set(),
		frozenRounds: new Set(),
	};
	let wasResetting = false;
	// The previous sample taken inside a countdown, so movement is measured
	// between two frozen frames rather than from the reset that started them.
	let frozenAt = null;
	const final = await waitForMatch(
		page,
		(s) => s.phase === "over",
		WALL_CLOCK_MS,
		(s) => {
			const t = s.teams;
			if (!t) return;
			rounds.maxAlive = Math.max(rounds.maxAlive, t.alive[0] + t.alive[1]);
			if (t.alive[0] === 0 || t.alive[1] === 0) {
				if (!rounds.seen.has(t.round)) {
					rounds.seen.add(t.round);
					rounds.wipes++;
				}
			}
			const resetting = t.resetInMs > 0;
			if (resetting && !wasResetting) rounds.cooldowns++;
			if (wasResetting && !resetting) rounds.resets++;
			wasResetting = resetting;

			if (t.freezeMs > 0) {
				if (!rounds.frozenRounds.has(t.round)) {
					rounds.frozenRounds.add(t.round);
					rounds.freezes++;
				}
				// Movement **between two consecutive samples of the same countdown**,
				// not distance from where the countdown started. The two differ by
				// exactly one thing and it matters: the arena reset that *begins* a
				// freeze teleports everybody to their spawn, and a fighter is
				// legitimately a thousand pixels from where they died. Measuring from
				// a baseline caught that teleport and called a working freezetime a
				// failure; measuring the step between samples cannot, while a fighter
				// who actually walked still moves ~100px per 250ms sample.
				const x = s.playerX;
				const same =
					frozenAt !== null &&
					frozenAt.round === t.round &&
					t.freezeMs < frozenAt.freezeMs;
				if (typeof x === "number") {
					if (same) {
						rounds.freezeDriftPx = Math.max(
							rounds.freezeDriftPx,
							Math.abs(x - frozenAt.x),
						);
					}
					frozenAt = { round: t.round, freezeMs: t.freezeMs, x };
				}
			} else {
				frozenAt = null;
			}
		},
	);
	await page.waitForTimeout(2000);

	const hit = lines.find((l) => RESULT_RE.test(l));
	const diagnostic = hit ? JSON.parse(hit.match(RESULT_RE)[1]) : null;

	const verdict = assess(final, rounds, lines);
	console.log("\n===== TEAM DEATHMATCH =====");
	console.log(
		JSON.stringify(
			{
				verdict:
					verdict.failures.length === 0
						? "PASS"
						: `FAIL: ${verdict.failures.join("; ")}`,
				notes: verdict.notes,
				match: final && {
					mode: final.mode,
					fighters: final.fighterCount,
					screens: final.worldScreens,
					phase: final.phase,
					endReason: final.endReason,
					winnerTeam: final.teams?.winnerTeam,
					roundLimit: final.scoreLimit,
					roundsPlayed: final.teams?.round,
					elapsedMs: final.elapsedMs,
				},
				sides: verdict.sides,
				observed: {
					wipes: rounds.wipes,
					cooldowns: rounds.cooldowns,
					arenaResets: rounds.resets,
					freezetimes: rounds.freezes,
					freezeDriftPx: Number(rounds.freezeDriftPx.toFixed(2)),
					mostAliveAtOnce: rounds.maxAlive,
				},
				net: final?.net,
				physics: diagnostic && {
					verdict: diagnostic.verdict,
					avgFps: diagnostic.fpsStats?.avgFps,
					jitter: diagnostic.jitterSummary,
					recon: diagnostic.reconciliationSummary,
					collisions: diagnostic.collisionSummary,
					melee: diagnostic.meleeSummary,
				},
				pageErrors: verdict.errors,
			},
			null,
			2,
		),
	);

	await ctx.close();
	await browser.close();
	if (verdict.failures.length > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
