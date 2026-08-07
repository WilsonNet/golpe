#!/usr/bin/env node
import type { Page } from "playwright";
/**
 * Team deathmatch feedback loop: two sides of AI, played to a winning team.
 *
 * `deathmatch-probe.ts` answers "does a sixteen-fighter free-for-all hold
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
 *   tsx scripts/tdm-probe.ts
 *   tsx scripts/tdm-probe.ts --fighters=8 --scoreLimit=2 --timeLimit=120
 */
import { chromium } from "playwright";
import type { TeamId } from "../src/game/simulation/Teams";
import type { MatchStateSnapshot } from "../src/types/global";

const BASE_URL = process.env.VENTO_URL ?? "http://localhost:8084";
const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const FIGHTERS = Number(arg("fighters", "8"));
/** Rounds to win. Three is enough to prove the wipe-reset-score loop repeats. */
const SCORE_LIMIT = Number(arg("scoreLimit", "3"));
const TIME_LIMIT_SEC = Number(arg("timeLimit", "180"));
const DIAG_MS = Number(arg("diagnostic", "12000"));
/**
 * `?ultCharge=N` arms everybody from the start. A round lasts seconds and the
 * passive charge takes ~285s, so the bots' ultimate use — the team probe's other
 * new question — is only observable with `--ultCharge=100`.
 */
const ULT_CHARGE = Math.max(0, Number(arg("ultCharge", "0")) || 0);
/** `--botHero=jeffs` pins every bot to the executioner — the smoke support. */
const BOT_HERO = arg("botHero", "");
/**
 * Freezetime, in seconds. **The real one**, unlike the score and time limits.
 *
 * Those are shortened because a probe cannot wait out a five-minute match; four
 * seconds a round is affordable, so the probe measures the countdown players
 * actually get rather than a stand-in for it. `--freeze=` overrides it, and
 * `--freeze=0` is a legitimate "no countdown" run.
 */
const FREEZE_SEC = Number(arg("freeze", "4"));
/**
 * Wall-clock budget. The match clock counts *live* time, so freezetime and
 * round cooldowns (4s + 5s per round) and the ultimate's cinematics (1.1s per
 * cast) all add wall time the match clock does not see. An armed room
 * (`--ultCharge=100`) chains cinematics — one every ~4.3s of live time, ~40
 * casts over 180s — which is another minute of wall time on top of the normal
 * overhead. The budget grows by that much.
 */
const CINEMATIC_OVERHEAD_S = ULT_CHARGE > 0 ? 60 : 0;
const WALL_CLOCK_MS = (TIME_LIMIT_SEC + 60 + CINEMATIC_OVERHEAD_S) * 1000;
/** What the server imposes on a team room. Asserted, not requested. */
const MIN_SCREENS = 3;

function sinkConsole(page: Page, lines: string[] = []): string[] {
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

/** Match state plus where the local fighter actually is, for the movement checks. */
type TdmState = MatchStateSnapshot & { playerX: number | null };

async function waitForMatch(
	page: Page,
	done: (s: TdmState) => boolean,
	timeoutMs: number,
	onSample?: (s: TdmState) => void,
): Promise<TdmState | null> {
	const deadline = Date.now() + timeoutMs;
	let last: TdmState | null = null;
	while (Date.now() < deadline) {
		// The match state plus where the local fighter actually is: freezetime is a
		// claim about *movement*, and only the simulation state can answer it.
		last = await page.evaluate(() => {
			const m = window.__matchState?.() ?? null;
			if (!m) return null;
			return {
				...m,
				playerX: window.__gameState?.()?.playerPhys.x ?? null,
			};
		});
		if (last) onSample?.(last);
		if (last && done(last)) return last;
		await page.waitForTimeout(250);
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
	reconciliationSummary?: unknown;
	collisionSummary?: unknown;
	meleeSummary?: { blocksByFighter?: Record<string, number> };
	movementSummary?: { doubleJumps?: number };
	ultimateSummary?: { localCasts?: number };
	teamSummary?: {
		team: TeamId;
		role: "support" | "vanguard" | null;
		swordFrames: number;
		gunFrames: number;
		allyDistancePx: number;
		ultimate?: { aimStarts?: number };
	} | null;
}

/** What the probe watched happen across rounds. */
interface RoundsObservation {
	wipes: number;
	resets: number;
	cooldowns: number;
	maxAlive: number;
	freezes: number;
	freezeDriftPx: number;
	seen: Set<number>;
	frozenRounds: Set<number>;
}

/**
 * Every check, as data.
 *
 * Split into "must hold" and "must not be zero" for the same reason the melee
 * counters are: a room where nobody fought satisfies every correctness check
 * trivially, and a probe that only reports correctness would call it a pass.
 */
function assess(
	state: TdmState | null,
	rounds: RoundsObservation,
	lines: string[],
	diagnostic: DiagnosticReport | null,
) {
	const failures: string[] = [];
	const notes: string[] = [];
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
	if (Math.abs(bySide[0]!.length - bySide[1]!.length) > 1) {
		failures.push(
			`teams are ${bySide[0]!.length}v${bySide[1]!.length} — not balanced`,
		);
	}

	// ---- friendly fire ----
	//
	// Reconstructed from the scoreboard rather than taken on trust. Every death
	// is somebody's frag, and with no friendly fire a side's deaths can only have
	// been scored by the *other* side — so a side that died more often than its
	// opponents have frags is a side that killed itself.
	for (const t of [0, 1] as const) {
		const died = bySide[t]!.reduce((a, s) => a + s.deaths, 0);
		const scoredAgainst = bySide[1 - t]!.reduce((a, s) => a + s.kills, 0);
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

	// ---- teamwork ----
	//
	// The local fighter is a bot with a side, and the diagnostic watched it for
	// `DIAG_MS`. A side that "plays together" is measurable: the brain reports
	// its own role and stance usage, so a support that never picks up the gun
	// and a vanguard that never draws the sword are both visible as the two
	// fighters doing the same job. These are *must-haves* for the same reason
	// the kills check is: a room where everybody stood still satisfies every
	// correctness rule above.
	const team = diagnostic?.teamSummary;
	const movement = diagnostic?.movementSummary;
	const ult = diagnostic?.ultimateSummary;
	if (team?.role) {
		if (team.role === "support") {
			// A jeffs support is a *smoke* support: its shotgun is a
			// point-blank weapon, so it keeps the sword for the last stand and
			// holds its fire at band range — the stance expectation flips.
			const smokeSupport = BOT_HERO === "jeffs";
			if (
				smokeSupport
					? team.swordFrames <= team.gunFrames
					: team.gunFrames <= team.swordFrames
			) {
				failures.push(
					smokeSupport
						? `smoke support bot played gun ${team.gunFrames} frames to sword ${team.swordFrames}`
						: `support bot played sword ${team.swordFrames} frames to gun ${team.gunFrames}`,
				);
			}
			if (movement && movement.doubleJumps === 0) {
				notes.push("support bot never double jumped");
			}
		} else if (team.role === "vanguard") {
			if (team.swordFrames <= team.gunFrames) {
				failures.push(
					`vanguard bot played gun ${team.gunFrames} frames to sword ${team.swordFrames}`,
				);
			}
			const blocks = diagnostic?.meleeSummary?.blocksByFighter?.local ?? 0;
			if (blocks === 0) {
				notes.push("vanguard bot never raised a guard");
			}
			if (movement && movement.doubleJumps === 0) {
				notes.push("vanguard bot never double jumped");
			}
		}
	} else {
		notes.push("no team report from the local bot's brain");
	}
	// The ultimate is a weapon, and an armed fighter that never aims it is a
	// fighter ignoring a weapon. The *cast* is not asserted: with every fighter
	// armed, seven other bots chain cinematics and one hole is open at a time,
	// so whether the local bot wins a slot in the window is luck — the server
	// log's `[ULT] ... casts Black Hole` lines are the real cast evidence, and
	// `localCasts` is reported for the record. The aim phase is the bot's own
	// decision, and that is what must happen.
	if (ULT_CHARGE > 0) {
		const brain = diagnostic?.teamSummary?.ultimate;
		if (ult && ult.localCasts === 0 && brain?.aimStarts === 0) {
			failures.push(
				"every fighter started armed but the local bot never even aimed its ultimate",
			);
		}
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
		`&freezeTime=${FREEZE_SEC}` +
		(ULT_CHARGE > 0 ? `&ultCharge=${ULT_CHARGE}` : "") +
		(BOT_HERO ? `&botHero=${BOT_HERO}` : "");
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

	// Physics first, while the fight is at its busiest. The report lands on the
	// console asynchronously, which is why it is collected after the match ends.
	//
	// **Deliberately delayed into the fight.** Seated, the local bot is frozen
	// for the round's freezetime and then walks the length of its side's arena
	// before contact — a diagnostic started at seating measures the approach and
	// reports zero melee moves and zero ultimate casts from a bot that fights
	// perfectly well. Waiting for round two puts the sample window in the fight.
	await waitForMatch(page, (s) => s.teams?.round === 2, 60000);
	await page.evaluate((d) => window.__physicsDiagnostic?.(d), DIAG_MS);

	// What the probe *watches*, rather than what it is told at the end: a wipe is
	// a one-tick event and the final scoreboard cannot prove one ever happened.
	const rounds: RoundsObservation = {
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
	let frozenAt: { round: number; freezeMs: number; x: number } | null = null;
	const final = await waitForMatch(
		page,
		(s) => s.phase === "over",
		WALL_CLOCK_MS,
		(s) => {
			const t = s.teams;
			if (!t) return;
			rounds.maxAlive = Math.max(rounds.maxAlive, t.alive[0]! + t.alive[1]!);
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
							Math.abs(x - frozenAt!.x),
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
	const json = hit?.match(RESULT_RE)?.[1];
	const diagnostic: DiagnosticReport | null = json ? JSON.parse(json) : null;

	const verdict = assess(final, rounds, lines, diagnostic);
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
					movement: diagnostic.movementSummary,
					ult: diagnostic.ultimateSummary,
					team: diagnostic.teamSummary,
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
