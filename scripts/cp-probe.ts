#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
/**
 * Control points feedback loop: two sides of AI fighting over the line.
 *
 * The other probes cannot see this mode. `tdm-probe.ts` asserts wipe-out
 * rounds; this asserts the things that only exist when the map is the score:
 *
 * - The room is the control map — five screens, one pad per screen — whatever
 *   the URL asked for.
 * - The line starts exactly as TF2's 5CP does: each side owns the two points by
 *   its base, the middle is neutral, and every owned point is locked. The
 *   **lock flags** come from the snapshot, so a client that drew a pad open
 *   that the server would refuse is a failure here.
 * - Captures actually happen: progress is seen moving, points change hands,
 *   and the front line advances.
 * - **Forward spawns.** Every respawn is checked against the line: a fighter
 *   returning to the arena must land on its side's front-line screen, one step
 *   behind its furthest-owned point — the comeback geometry, verified from the
 *   bodies rather than trusted from the code.
 * - Rounds end by a capture of the enemy's last point, and the match by the
 *   capture limit — with friendly fire still off, reconstructed from the
 *   scoreboard the way `tdm-probe.ts` does it.
 *
 * Rules are shortened (`?capTime=1`) so a round is observable in seconds.
 * Everything else is the real path: real server, real snapshots, real
 * prediction, real bots.
 *
 *   tsx scripts/cp-probe.ts
 *   tsx scripts/cp-probe.ts --fighters=8 --scoreLimit=1 --timeLimit=300
 *   tsx scripts/cp-probe.ts --ultCharge=100     # and the black holes come too
 */
import { chromium } from "playwright";
import { CONTROL_SCREEN_SPAWNS } from "../src/game/simulation/ControlMap";
import {
	type ControlStatus,
	controlSpawnScreen,
} from "../src/game/simulation/ControlPoints";
import type { TeamId } from "../src/game/simulation/Teams";
import type { MatchStateSnapshot } from "../src/types/global";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

/**
 * Seven fighters, not eight: a 4v3.
 *
 * An even AI match is a genuine tug of war — the line crosses twice a minute
 * and can honestly draw, which is 5CP working. The probe's job is to exercise
 * the whole capture ladder to a win, and one extra body on a side is what
 * makes that happen inside a run.
 */
const FIGHTERS = Number(arg("fighters", "7"));
/** Captures to win. One is enough to prove the whole round loop. */
const SCORE_LIMIT = Number(arg("scoreLimit", "1"));
const TIME_LIMIT_SEC = Number(arg("timeLimit", "300"));
/** The middle point's seconds, shortened so a round is seconds not minutes. */
const CAP_TIME_S = Number(arg("capTime", "1"));
const FREEZE_SEC = Number(arg("freeze", "1"));
const ULT_CHARGE = Math.max(0, Number(arg("ultCharge", "0")) || 0);
const DIAG_MS = Number(arg("diagnostic", "12000"));
/** Wall-clock budget: the match clock is live time; freeze and cooldown are not. */
const WALL_CLOCK_MS = (TIME_LIMIT_SEC + 90) * 1000;

/** The control map's fixed shape, asserted rather than requested. */
const SCREENS = 5;
const WIDTH = 4000;
/** A fighter may walk this far between the spawn tick and the sample. */
const SPAWN_SLACK_PX = 240;

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
			"game server unreachable on :9208 — start it with `pnpm run dev:herdr`",
		);
	}
}

/** What the probe watched across the match. */
interface Observation {
	initialOwners: string | null;
	initialUnlocks: string | null;
	initialRound: number | null;
	screens: number;
	width: number;
	captures: number;
	flips: number;
	progressMax: number;
	contestedSeen: boolean;
	overtimeSeen: boolean;
	maxRound: number;
	scores: [number, number];
	/** Respawns: the screen(s) the line implied around the jump, and where it landed. */
	spawnChecks: { expected: number[]; landedX: number }[];
	/**
	 * The local fighter's x at round start, the screen the line implied, the
	 * exact spawn x the table names, and whether the fighter was still frozen.
	 */
	initialSpawn: {
		team: TeamId;
		x: number;
		expected: number;
		expectedX: number;
		frozen: boolean;
	} | null;
	hudBar: boolean;
	hudPips: number;
	hudOvertime: boolean;
}

/**
 * The dedicated overtime rooms.
 *
 * Overtime only exists at the instant the clock runs out *with a capture in
 * progress*, so it cannot be requested — it has to be arranged: fifteen seconds
 * of clock with no freezetime, which lands the whistle mid-cap nearly every
 * run. What happens next is a fight, so the phase asserts the deterministic
 * half — **the clock is held while overtime runs** (it must not creep past the
 * limit) — and up to three rooms are played to try to catch the bonus itself:
 * a capture completing in overtime pays a minute back and the clock goes
 * *backwards*. The pushing side being wiped reverts the bar instead, which is a
 * legitimate ending, so a run that never sees a payback says so in its notes
 * rather than failing; the bonus arithmetic is pinned by unit test.
 */
interface OvertimeObservation {
	seen: boolean;
	paidBack: boolean;
	captures: number;
	/** The furthest the clock moved while overtime was declared, in ms. */
	clockDriftMs: number;
	attempts: number;
}

/**
 * The spawn screen the line implies for a side, asked of the **real rule**.
 *
 * A local copy of the frontier arithmetic was wrong for team 1 (it took the
 * base-most owned index instead of the forward-most) and only ever passed
 * because the probe's creator is always seated on team 0. Importing the
 * server's own function means the oracle cannot drift from it again.
 */
function expectedSpawnScreen(
	control: ControlStatus | null | undefined,
	myTeam: TeamId,
): number | null {
	if (!control) return null;
	return controlSpawnScreen(control.points, SCREENS, myTeam);
}

/**
 * Every check, as data.
 *
 * Split into "must hold" and "must not be zero" — a room where nobody fought
 * satisfies every correctness check trivially, and a probe that only reports
 * correctness would call it a pass.
 */
function assess(
	state: MatchStateSnapshot | null,
	obs: Observation,
	overtime: OvertimeObservation,
	lines: string[],
	diagnostic: { verdict?: string } | null,
) {
	const failures: string[] = [];
	const notes: string[] = [];
	if (!state) {
		return { failures: ["no __matchState() — the client never booted"], notes };
	}

	const { standings, phase, endReason, teams, mode } = state;
	const kills = standings.reduce((a, s) => a + s.kills, 0);
	const deaths = standings.reduce((a, s) => a + s.deaths, 0);

	if (mode !== "5cp") failures.push(`room is ${mode}, not 5cp`);
	if (state.fighterCount !== FIGHTERS) {
		failures.push(
			`${state.fighterCount} fighters in the room, wanted ${FIGHTERS}`,
		);
	}
	if (!teams?.control) {
		return {
			failures: [...failures, "no control line in the snapshot"],
			notes,
		};
	}

	// ---- the map is the mode ----
	if (obs.screens !== SCREENS || state.worldScreens !== SCREENS) {
		failures.push(
			`arena is ${state.worldScreens} screens (probe saw ${obs.screens}), the control map is ${SCREENS}`,
		);
	}
	if (obs.width !== WIDTH || state.worldWidth !== WIDTH) {
		failures.push(
			`arena is ${state.worldWidth}px wide, the control map is ${WIDTH}px`,
		);
	}

	// ---- the line starts as TF2's does ----
	if (obs.initialOwners !== "0,0,null,1,1") {
		failures.push(
			`round started with owners [${obs.initialOwners}] — wanted [0,0,null,1,1]`,
		);
	}
	// Unlock flags per point, per team, from the snapshot: middle open to both;
	// each side's yard open to itself; the enemy's yard locked for both.
	const wantedUnlocks = JSON.stringify([
		[false, false],
		[true, false],
		[true, true],
		[false, true],
		[false, false],
	]);
	if (obs.initialUnlocks !== wantedUnlocks) {
		failures.push(
			`the opening locks were ${obs.initialUnlocks} — wanted ${wantedUnlocks}`,
		);
	}
	if (obs.initialRound !== 1) {
		failures.push(`the match did not start at round 1 (${obs.initialRound})`);
	}

	// ---- captures actually happened ----
	if (obs.captures === 0) failures.push("no point was ever captured");
	if (obs.flips === 0) failures.push("no point ever changed hands");
	if (obs.progressMax < 0.05) {
		failures.push(
			`no capture progress was ever visible (max ${obs.progressMax})`,
		);
	}
	if (!obs.contestedSeen) {
		notes.push(
			"no pad was ever contested — the fights never stood on the line",
		);
	}

	// ---- the life is a 5CP life: individuals come back, forward ----
	//
	// The opening spawn is guaranteed to have happened, so it carries the
	// deterministic half of the proof: the server chose the frontier screen the
	// opening line implies. The respawn checks below are the other half,
	// opportunistic — they need this particular bot to die.
	if (!obs.initialSpawn) {
		failures.push("the local fighter was never observed at its opening spawn");
	} else {
		const s = obs.initialSpawn;
		if (s.frozen) {
			// Still planted by the countdown: the body is on the exact table
			// entry the picker returns for an empty arena, so the check is
			// against that x, not a screen-wide band that would hide a wrong
			// screen.
			if (Math.abs(s.x - s.expectedX) > 32) {
				failures.push(
					`the opening spawn stood at x=${Math.round(s.x)} — screen ${s.expected}'s spawn is x=${Math.round(s.expectedX)}`,
				);
			}
		} else {
			const lo = s.expected * 800 - SPAWN_SLACK_PX;
			const hi = s.expected * 800 + 800 + SPAWN_SLACK_PX;
			if (s.x < lo || s.x > hi) {
				failures.push(
					`the opening spawn landed at x=${Math.round(s.x)} — screen ${s.expected} expected (${lo}..${hi})`,
				);
			}
		}
	}
	if (obs.spawnChecks.length === 0) {
		notes.push(
			"no respawn was observed, so forward spawns are only proven at round start",
		);
	}
	for (const check of obs.spawnChecks) {
		// Accepted against any screen the line implied around the jump: the
		// respawn tick and the sample can straddle a capture at this pace.
		const inBand = check.expected.some(
			(screen) =>
				check.landedX >= screen * 800 - SPAWN_SLACK_PX &&
				check.landedX <= screen * 800 + 800 + SPAWN_SLACK_PX,
		);
		if (!inBand) {
			failures.push(
				`a respawn landed at x=${Math.round(check.landedX)} — screen ${check.expected.join(" or ")} expected`,
			);
		}
	}

	// ---- the ladder reached the last point ----
	//
	// The announcement is a reliable datagram and the client logs it, so this
	// proves a last-point capture happened even on a run whose *match* ended on
	// the clock rather than on the capture limit.
	const lastCapture = lines.some((l) =>
		/\[CP\] point [A-E] -> .+\(last\)/.test(l),
	);
	if (!lastCapture) {
		failures.push("no last-point capture was ever announced");
	}

	// ---- rounds and the match ----
	const scoreTotal = (teams.scores[0] ?? 0) + (teams.scores[1] ?? 0);
	if (phase !== "over") {
		failures.push(
			`match never ended (phase ${phase}, ${scoreTotal} round(s) played)`,
		);
	} else {
		if (endReason !== "score") {
			notes.push(`match ended on ${endReason}, not the capture limit`);
		}
		if (scoreTotal === 0) failures.push("no round was ever won");
		if (endReason === "score") {
			const best = Math.max(teams.scores[0] ?? 0, teams.scores[1] ?? 0);
			if (best < SCORE_LIMIT) {
				failures.push(
					`ended on captures with only ${best}/${SCORE_LIMIT} rounds`,
				);
			}
			if (teams.winnerTeam === null) {
				failures.push("reached the capture limit with no winning side");
			}
		}
	}
	if (obs.maxRound < 1) failures.push("no round was ever in progress");
	if (kills === 0)
		failures.push("nobody scored a frag — the fight never happened");
	if (kills > deaths) failures.push(`${kills} frags but only ${deaths} deaths`);

	// ---- friendly fire, reconstructed from the scoreboard ----
	const bySide = [0, 1].map((t) => standings.filter((s) => s.team === t));
	const sideless = standings.filter((s) => s.team !== 0 && s.team !== 1);
	if (sideless.length > 0)
		failures.push(`${sideless.length} fighter(s) have no side`);
	if (Math.abs(bySide[0]!.length - bySide[1]!.length) > 1) {
		failures.push(
			`teams are ${bySide[0]!.length}v${bySide[1]!.length} — not balanced`,
		);
	}
	for (const t of [0, 1] as const) {
		const died = bySide[t]!.reduce((a, s) => a + s.deaths, 0);
		const scoredAgainst = bySide[1 - t]!.reduce((a, s) => a + s.kills, 0);
		if (scoredAgainst > died) {
			failures.push(
				`team ${1 - t} has ${scoredAgainst} frags but team ${t} only died ${died} times — friendly fire`,
			);
		}
	}

	// ---- overtime, arranged rather than hoped for ----
	//
	// The deterministic half is the clock: it must be **held** while overtime
	// runs, not merely not-scored. A clock that kept counting made the 60s bonus
	// a subtraction from an overshot number — a long push bought nothing, and a
	// completed capture could leave time expired and award the round twice. The
	// bonus itself only shows when the arranged fight lets the capture finish,
	// so that is reported: a reversion is a legitimate ending, not a failure.
	if (!overtime.seen) {
		failures.push("the overtime room never reached overtime");
	}
	if (overtime.clockDriftMs > 1500) {
		failures.push(
			`the clock ran during overtime (drifted ${Math.round(overtime.clockDriftMs)}ms)`,
		);
	}
	if (overtime.paidBack) {
		notes.push("a capture in overtime paid the clock back");
	} else if (overtime.seen) {
		notes.push(
			"overtime ended by reversion in every attempt — legitimate, and the bonus arithmetic is unit-tested",
		);
	}
	if (overtime.captures === 0) {
		failures.push("the overtime room never captured anything");
	}

	// ---- the HUD showed the war ----
	if (!obs.hudBar) failures.push("the control bar never rendered");
	if (obs.hudPips !== 5) {
		failures.push(`the control bar drew ${obs.hudPips} pips, wanted 5`);
	}
	if (obs.overtimeSeen && !obs.hudOvertime) {
		notes.push("overtime happened but the HUD label was not sampled");
	}

	// ---- the netcode under it all ----
	if (diagnostic?.verdict?.startsWith("FAIL")) {
		failures.push(`physics diagnostic failed: ${diagnostic.verdict}`);
	}
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

/**
 * Run the overtime rooms and report what happened.
 *
 * **Up to three rooms**, because overtime's ending is a fight and not a
 * script: if the pushing side is wiped the bar reverts (correctly) and the
 * round is decided on points instead. The clock-hold check is taken from every
 * attempt; the payback only needs to happen once.
 */
async function runOvertimePhase(
	browser: Awaited<ReturnType<typeof chromium.launch>>,
	lines: string[],
): Promise<OvertimeObservation> {
	let best: OvertimeObservation = {
		seen: false,
		paidBack: false,
		captures: 0,
		clockDriftMs: 0,
		attempts: 0,
	};
	for (let attempt = 0; attempt < 3; attempt++) {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		sinkConsole(page, lines);
		const url =
			`${BASE_URL}/?ai=true&mode=5cp&bots=3&mute=1&scoreLimit=2` +
			`&timeLimit=15&freezeTime=0&capTime=1&room=${randomUUID()}`;
		console.log(`[PROBE] overtime room ${attempt + 1}: ${url}`);
		const obs: OvertimeObservation = {
			seen: false,
			paidBack: false,
			captures: 0,
			clockDriftMs: 0,
			attempts: 1,
		};
		try {
			await page.goto(url);
			await page.waitForFunction(
				() => typeof window.__matchState === "function",
				{
					timeout: 20000,
				},
			);
			let lastElapsed = 0;
			let lastCaptures = 0;
			let otMin = Number.POSITIVE_INFINITY;
			let otMax = 0;
			const deadline = Date.now() + 90_000;
			while (Date.now() < deadline) {
				const s = await page.evaluate(() => window.__matchState?.() ?? null);
				const control = s?.teams?.control ?? null;
				if (s && control) {
					obs.seen ||= control.overtime;
					obs.captures = Math.max(obs.captures, control.captures);
					if (control.overtime) {
						otMin = Math.min(otMin, s.elapsedMs);
						otMax = Math.max(otMax, s.elapsedMs);
					} else if (otMax > 0) {
						// Overtime just ended: how far the clock moved while it ran.
						obs.clockDriftMs = Math.max(obs.clockDriftMs, otMax - otMin);
						otMin = Number.POSITIVE_INFINITY;
						otMax = 0;
					}
					// The clock went backwards while a point fell: that is the
					// overtime bonus, and nothing else in the mode does that.
					if (
						control.captures > lastCaptures &&
						lastElapsed - s.elapsedMs > 3000
					) {
						obs.paidBack = true;
					}
					lastCaptures = control.captures;
					lastElapsed = s.elapsedMs;
				}
				if (obs.paidBack) break;
				if (s?.phase === "over") break;
				await page.waitForTimeout(150);
			}
			// A window that never closed before the match ended still counts.
			if (otMax > 0 && Number.isFinite(otMin)) {
				obs.clockDriftMs = Math.max(obs.clockDriftMs, otMax - otMin);
			}
		} finally {
			await ctx.close();
		}
		best = {
			seen: best.seen || obs.seen,
			paidBack: best.paidBack || obs.paidBack,
			captures: Math.max(best.captures, obs.captures),
			clockDriftMs: Math.max(best.clockDriftMs, obs.clockDriftMs),
			attempts: attempt + 1,
		};
		if (obs.paidBack) break;
	}
	return best;
}

async function main() {
	await assertServerUp();
	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const lines = sinkConsole(page);

	// No `screen=`, deliberately: the control map's shape is the mode's job.
	const url =
		`${BASE_URL}/?ai=true&mode=5cp&bots=${FIGHTERS - 1}&mute=1` +
		`&scoreLimit=${SCORE_LIMIT}&timeLimit=${TIME_LIMIT_SEC}` +
		`&freezeTime=${FREEZE_SEC}&capTime=${CAP_TIME_S}` +
		(ULT_CHARGE > 0 ? `&ultCharge=${ULT_CHARGE}` : "");
	console.log(`[PROBE] ${url}`);
	await page.goto(url);
	await page.waitForFunction(() => typeof window.__matchState === "function", {
		timeout: 20000,
	});

	const obs: Observation = {
		initialOwners: null,
		initialUnlocks: null,
		initialRound: null,
		screens: 0,
		width: 0,
		captures: 0,
		flips: 0,
		progressMax: 0,
		contestedSeen: false,
		overtimeSeen: false,
		maxRound: 0,
		scores: [0, 0],
		spawnChecks: [],
		initialSpawn: null,
		hudBar: false,
		hudPips: 0,
		hudOvertime: false,
	};

	// The HUD watcher runs on its own cadence: the bar is DOM, the rest is state.
	let finished = false;
	const domWatcher = (async () => {
		while (!finished) {
			const seen = await page
				.evaluate(() => ({
					bar: !!document.querySelector(".vdh-cap-bar"),
					pips: document.querySelectorAll(".vdh-cap-pip").length,
					overtime: !!document.querySelector(".vdh-cap-overtime"),
				}))
				.catch(() => null);
			if (seen) {
				obs.hudBar ||= seen.bar;
				obs.hudPips = Math.max(obs.hudPips, seen.pips);
				obs.hudOvertime ||= seen.overtime;
			}
			await page.waitForTimeout(300);
		}
	})();

	let lastOwners = "";
	let lastX: number | null = null;
	/** The previous sample's line, for accepting a respawn against either side of a capture. */
	let lastControlPoints: ControlStatus["points"] | null = null;
	let sawDead = false;
	let diagnosticStarted = false;
	let diagnostic: { verdict?: string } | null = null;
	let state: MatchStateSnapshot | null = null;
	/** The state at the final whistle, before the next match restarts. */
	let finalState: MatchStateSnapshot | null = null;
	const deadline = Date.now() + WALL_CLOCK_MS;

	while (Date.now() < deadline) {
		const sample = await page.evaluate(() => {
			const m = window.__matchState?.() ?? null;
			const g = window.__gameState?.() ?? null;
			return {
				m,
				hp: g?.playerHP ?? null,
				x: g?.playerPhys?.x ?? null,
			};
		});
		state = sample.m;
		if (!state) {
			await page.waitForTimeout(250);
			continue;
		}
		const control = state.teams?.control ?? null;

		if (control) {
			if (obs.initialOwners === null && state.teams) {
				obs.initialOwners = state.teams
					.control!.points.map((p) =>
						p.owner === null ? "null" : String(p.owner),
					)
					.join(",");
				obs.initialUnlocks = JSON.stringify(
					state.teams.control!.points.map((p) => p.unlocked),
				);
				obs.initialRound = state.teams.round;
				obs.screens = state.worldScreens;
				obs.width = state.worldWidth;
			}
			obs.captures = Math.max(obs.captures, control.captures);
			obs.overtimeSeen ||= control.overtime;
			obs.maxRound = Math.max(obs.maxRound, state.teams?.round ?? 0);
			if (state.teams)
				obs.scores = [state.teams.scores[0] ?? 0, state.teams.scores[1] ?? 0];
			for (const point of control.points) {
				obs.progressMax = Math.max(obs.progressMax, point.progress);
				obs.contestedSeen ||= point.contested;
			}
			const owners = control.points
				.map((p) => (p.owner === null ? "null" : String(p.owner)))
				.join(",");
			if (lastOwners !== "" && owners !== lastOwners) obs.flips++;
			lastOwners = owners;

			// Forward spawns: a full-health sample after a death, with a jump the
			// size of a screen or more, is a respawn — and the line says where it
			// was allowed to be. The line can move between the respawn tick and
			// the sample (at `capTime=1` captures take a tenth of a second), so
			// the landing is accepted against the previous sample's line as well
			// as the current one.
			const myTeam = state.myTeam;
			const prevControl = lastControlPoints;
			// The initial spawn is the one spawn that always happens, and with the
			// freeze still running the fighter has not walked yet: the first sample
			// names the screen the server chose — checked against the exact table
			// entry the spawn picker would return on an empty arena.
			if (
				obs.initialSpawn === null &&
				myTeam !== null &&
				myTeam !== undefined &&
				sample.x !== null
			) {
				const expected = expectedSpawnScreen(control, myTeam);
				if (expected !== null) {
					const first = CONTROL_SCREEN_SPAWNS[expected]?.[0];
					obs.initialSpawn = {
						team: myTeam,
						x: sample.x,
						expected,
						expectedX: first?.x ?? expected * 800,
						frozen: (state.teams?.freezeMs ?? 0) > 0,
					};
				}
			}
			if (sample.hp !== null && sample.hp <= 0) sawDead = true;
			if (sawDead && sample.hp === 100 && sample.x !== null && lastX !== null) {
				if (
					Math.abs(sample.x - lastX) > 260 &&
					myTeam !== null &&
					myTeam !== undefined
				) {
					const candidates: number[] = [];
					const now = expectedSpawnScreen(control, myTeam);
					if (now !== null) candidates.push(now);
					if (prevControl) {
						const before = controlSpawnScreen(prevControl, SCREENS, myTeam);
						if (!candidates.includes(before)) candidates.push(before);
					}
					if (candidates.length > 0) {
						obs.spawnChecks.push({ expected: candidates, landedX: sample.x });
					}
				}
				sawDead = false;
			}
			lastControlPoints = control.points;
			lastX = sample.x;

			// Start a diagnostic once the fight is real (a capture has landed) or
			// after a grace period — a diagnostic from tick zero measures approach.
			if (!diagnosticStarted && (obs.captures > 0 || state.elapsedMs > 15000)) {
				diagnosticStarted = true;
				void page
					.evaluate((d) => window.__physicsDiagnostic?.(d), DIAG_MS)
					.catch(() => null);
			}
		}
		if (state.phase === "over") {
			finalState = state;
			const hit = lines.map((l) => RESULT_RE.exec(l)).find((m) => m?.[1]);
			if (hit?.[1]) {
				try {
					diagnostic = JSON.parse(hit[1]) as { verdict?: string };
				} catch {
					diagnostic = null;
				}
			}
			break;
		}
		await page.waitForTimeout(250);
	}
	finished = true;
	await domWatcher;

	// The dedicated overtime room, once the main line has had its run.
	const overtime = await runOvertimePhase(browser, lines);

	// The verdict is the state at the *whistle*, not a later read: the room
	// restarts a new match 44 seconds after the podium, and the overtime phase
	// takes longer than that — a re-read would grade a fresh 0-0.
	const verdict = assess(finalState ?? state, obs, overtime, lines, diagnostic);

	console.log("\n===== CONTROL POINTS =====");
	console.log(
		JSON.stringify(
			{
				verdict:
					verdict.failures.length === 0
						? "PASS"
						: `FAIL: ${verdict.failures.join("; ")}`,
				notes: verdict.notes,
				line: {
					start: obs.initialOwners,
					locks: obs.initialUnlocks,
					screens: obs.screens,
					width: obs.width,
				},
				flow: {
					captures: obs.captures,
					flips: obs.flips,
					progressMax: Number(obs.progressMax.toFixed(2)),
					contested: obs.contestedSeen,
					overtime: obs.overtimeSeen,
					rounds: obs.scores,
					respawnsChecked: obs.spawnChecks.length,
				},
				overtime: {
					seen: overtime.seen,
					clockPaidBack: overtime.paidBack,
					clockDriftMs: Math.round(overtime.clockDriftMs),
					attempts: overtime.attempts,
					captures: overtime.captures,
				},
				hud: {
					bar: obs.hudBar,
					pips: obs.hudPips,
					overtimeLabel: obs.hudOvertime,
				},
				match: {
					phase: state?.phase ?? null,
					endReason: state?.endReason ?? null,
					winnerTeam: state?.teams?.winnerTeam ?? null,
					scores: state?.teams?.scores ?? null,
				},
				fight: {
					kills: verdict.kills,
					deaths: verdict.deaths,
					sides: verdict.sides,
				},
				diagnostic: diagnostic?.verdict ?? "(not collected)",
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
