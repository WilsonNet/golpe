import {
	CP_CAPTURE_MS,
	CP_DECAY_MS,
	CP_OVERTIME_DECAY_MULTIPLIER,
	CP_POINT_COUNT,
	CP_RESPAWN_ADVANTAGE_MS,
	CP_RESPAWN_MIN_MS,
	CP_RESPAWN_MS,
} from "../../tweakables/control.js";
import { TEAM_COUNT, type TeamId } from "./Teams.js";

/**
 * Control points: the line, its locks, and the capture tick.
 *
 * Pure and shared, like `Teams.ts` and `Deathmatch.ts`. The server is the only
 * judge of who owns a point, but the *rules* have to be askable by anything —
 * a client draws the locks from the same predicate the server captures with, so
 * a pad that looks open is a pad the server would accept.
 *
 * No wall-clock reads in here. Time arrives as a delta, exactly as it does in
 * `tickPlayer`.
 *
 * **The model is TF2's symmetric 5CP.** Five points in a line, a team owning a
 * prefix from its base and the other a suffix, a neutral middle. A point is
 * capturable by a team when the point between it and that team's base is
 * already theirs — which is the whole of the lock rule, and the reason a push
 * can never skip a point.
 */

/** One point on the line. Mutated in place by `stepControlPoints`. */
export interface ControlPointState {
	/** The side that holds it, or null while it is neutral. */
	owner: TeamId | null;
	/** The side whose capture is in progress, or null when none is. */
	attacker: TeamId | null;
	/** 0..1 toward `attacker`'s control. Zero when nobody has progress. */
	progress: number;
	/** Both sides on the pad: progress is frozen, not decaying. */
	contested: boolean;
}

export type ControlPointStates = ControlPointState[];

/** A capture that completed this tick. */
export interface CaptureEvent {
	/** Index on the line, 0 at AZURE's base end. */
	point: number;
	team: TeamId;
	/** The point was neutral when the capture began. */
	fromNeutral: boolean;
	/** This was the enemy's last point — the capture that wins the round. */
	last: boolean;
}

/**
 * The line at the start of a round: each side owns the two points by its base,
 * the middle is neutral.
 *
 * The two points by each base start owned *and locked* — the lock falls out of
 * `unlockedFor`, not out of a flag: EMBER's nearest point cannot be taken
 * while the middle is neutral.
 */
export function initialControlPoints(): ControlPointStates {
	const middle = (CP_POINT_COUNT - 1) / 2;
	const points: ControlPointStates = [];
	for (let i = 0; i < CP_POINT_COUNT; i++) {
		points.push({
			owner: i < middle ? 0 : i > middle ? 1 : null,
			attacker: null,
			progress: 0,
			contested: false,
		});
	}
	return points;
}

/**
 * **The lock rule, and the only place it is written.**
 *
 * A point is unlocked for a team when the point between it and that team's base
 * is owned by that team. Everything TF2's 5CP does about locks falls out of
 * this sentence: the middle is open to both at the start (the points behind it
 * are each side's own), taking the middle unlocks the next enemy point, and
 * taking *that* re-locks the one behind it — so at most two points are ever
 * open, one step for each side.
 */
export function unlockedFor(
	points: readonly ControlPointState[],
	index: number,
	team: TeamId,
): boolean {
	const neighbour = index + (team === 0 ? -1 : 1);
	if (neighbour < 0 || neighbour >= points.length) return false;
	return points[neighbour]?.owner === team;
}

/** Can this team make progress on this point right now? */
export function capturableBy(
	points: readonly ControlPointState[],
	index: number,
	team: TeamId,
): boolean {
	const point = points[index];
	if (!point) return false;
	if (point.owner === team) return false;
	return unlockedFor(points, index, team);
}

/** The harmonic capture multiplier for `n` fighters: 1, 1.5, 1.833, 2.083… */
export function harmonicMultiplier(fighters: number): number {
	let sum = 0;
	for (let i = 1; i <= fighters; i++) sum += 1 / i;
	return sum;
}

/** Pad geometry, top-left origin like every other rectangle in the world. */
export interface ControlPad {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Is a fighter's body (top-left, like the simulation's) standing on this pad? */
export function onPad(
	pad: ControlPad,
	bodyX: number,
	bodyY: number,
	bodyW: number,
	bodyH: number,
): boolean {
	const cx = bodyX + bodyW / 2;
	const cy = bodyY + bodyH / 2;
	return (
		cx >= pad.x && cx <= pad.x + pad.w && cy >= pad.y && cy <= pad.y + pad.h
	);
}

/**
 * How close to empty a bar counts as empty.
 *
 * A build and a revert at the same rate are exact inverses only on paper: in
 * floats a 41-step fill followed by a 41-step unwind leaves ~2e-16 of bar,
 * and without this the claim would survive a full reversion and the HUD would
 * draw a hairline nobody can clear. One millionth of a bar is not a state.
 */
const EMPTY_PROGRESS = 1e-6;

/**
 * Advance every point one tick.
 *
 * `present[t][i]` is how many living fighters of team `t` stood on point `i`
 * this tick. Mutates `points` (the room owns the array) and returns the
 * captures that completed, so the caller can announce them without diffing.
 *
 * The three states of a pad, and there are only three:
 *
 * - **Contested** — both sides on it. Frozen; the argument is settled with
 *   weapons, not with the bar.
 * - **Attacked** — one side on it, and the point is not theirs. Progress runs
 *   at that side's harmonic rate, which grows with every extra body.
 * - **Abandoned** — nobody on it. Progress decays toward zero, six times as
 *   fast in overtime. A neutral point is the exception: the *other* team
 *   unwinds it at capture speed (TF2's reversion rule), because a neutral
 *   point has no owner's progress to be patient with.
 */
export function stepControlPoints(
	points: ControlPointStates,
	present: readonly (readonly number[])[],
	dtMs: number,
	overtime: boolean,
	/** Per-point capture times, indexed like `points`. The room may shorten them. */
	captureMs: readonly number[] = CP_CAPTURE_MS,
): CaptureEvent[] {
	const events: CaptureEvent[] = [];
	const decayPerMs =
		(1 / CP_DECAY_MS) * (overtime ? CP_OVERTIME_DECAY_MULTIPLIER : 1);

	for (let i = 0; i < points.length; i++) {
		const point = points[i];
		if (!point) continue;
		const countA = present[0]?.[i] ?? 0;
		const countB = present[1]?.[i] ?? 0;
		point.contested = countA > 0 && countB > 0;
		if (point.contested) continue;

		const actor: TeamId | null = countA > 0 ? 0 : countB > 0 ? 1 : null;
		const count = actor === 0 ? countA : actor === 1 ? countB : 0;

		if (actor === null) {
			// Nobody is arguing for the point. Progress bleeds away at the decay
			// rate; the attacker keeps the claim until the bar is empty.
			if (point.progress > 0) {
				point.progress = Math.max(0, point.progress - decayPerMs * dtMs);
				if (point.progress <= EMPTY_PROGRESS) {
					point.progress = 0;
					point.attacker = null;
				}
			}
			continue;
		}

		if (point.attacker !== null && point.attacker !== actor) {
			// The other team is unwinding this capture. A neutral point reverts at
			// the reverter's own capture speed (TF2: a neutral point has no owner to
			// be patient for); an owned point does not — a defender standing on
			// their own point only blocks, and only while the attacker is there.
			if (point.owner === null) {
				const rate =
					(1 / (captureMs[i] ?? CP_CAPTURE_MS[i] ?? 1)) *
					harmonicMultiplier(count);
				point.progress -= rate * dtMs;
				if (point.progress <= EMPTY_PROGRESS) {
					point.progress = 0;
					point.attacker = actor;
				}
			}
			continue;
		}

		if (!capturableBy(points, i, actor)) continue;

		if (point.attacker === null) point.attacker = actor;
		const rate =
			(1 / (captureMs[i] ?? CP_CAPTURE_MS[i] ?? 1)) * harmonicMultiplier(count);
		const fromNeutral = point.owner === null;
		point.progress = Math.min(1, point.progress + rate * dtMs);
		if (point.progress >= 1) {
			events.push({
				point: i,
				team: actor,
				fromNeutral,
				last: isLastPointFor(points.length, actor, i),
			});
			point.owner = actor;
			point.attacker = null;
			point.progress = 0;
		}
	}
	return events;
}

/** Is index `i` the enemy's last point, for `team`? */
function isLastPointFor(count: number, team: TeamId, i: number): boolean {
	return i === (team === 0 ? count - 1 : 0);
}

/**
 * The round is over when a team holds the enemy's last point — which, by the
 * adjacency rule, can only happen after it has taken every point in between.
 */
export function controlRoundWinner(
	points: readonly ControlPointState[],
): TeamId | null {
	const last = points.length - 1;
	if (last < 0) return null;
	if (points[last]?.owner === 0) return 0;
	if (points[0]?.owner === 1) return 1;
	return null;
}

/** How many points a side holds. */
export function pointsOwned(
	points: readonly ControlPointState[],
	team: TeamId,
): number {
	let n = 0;
	for (const point of points) if (point.owner === team) n++;
	return n;
}

/**
 * Who is ahead on the line, or null on a tie.
 *
 * What the round ends on when the clock runs out with nothing in progress.
 */
export function controlTiebreak(
	points: readonly ControlPointState[],
): TeamId | null {
	const a = pointsOwned(points, 0);
	const b = pointsOwned(points, 1);
	if (a === b) return null;
	return a > b ? 0 : 1;
}

/** Is any capture in progress? The question overtime's existence hangs on. */
export function controlInProgress(
	points: readonly ControlPointState[],
): boolean {
	return points.some((p) => p.progress > 0 || p.attacker !== null);
}

/**
 * What the match clock says at this instant.
 *
 * - `"none"` — the clock has not run out; play on.
 * - `"overtime"` — it ran out with a capture in progress: hold the clock and
 *   let the push finish. **The server calls this once and remembers the flag**;
 *   the function itself is pure and stateless, so both the decision and the
 *   "is overtime over" question are answerable in a test.
 * - `"time"` — the clock is out and nothing is in progress (or overtime's
 *   progress has fully reverted): the round is decided on points held.
 */
export type ControlClockOutcome = "none" | "overtime" | "time";

export function controlClockOutcome(
	points: readonly ControlPointState[],
	elapsedMs: number,
	timeLimitMs: number,
	overtime: boolean,
): ControlClockOutcome {
	if (elapsedMs < timeLimitMs) return "none";
	if (overtime) return controlInProgress(points) ? "none" : "time";
	return controlInProgress(points) ? "overtime" : "time";
}

/**
 * How long this side waits to respawn, decided when the fighter fell.
 *
 * The side with fewer points gets bodies back sooner — the respawn advantage,
 * and the whole comeback mechanic. TF2 asks the same question on a ten-second
 * wave; here it is a flat two-to-four seconds that the deficit shaves down.
 */
export function controlRespawnDelayMs(
	points: readonly ControlPointState[],
	team: TeamId,
): number {
	const mine = pointsOwned(points, team);
	const leader = Math.max(pointsOwned(points, 0), pointsOwned(points, 1));
	const deficit = Math.max(0, leader - mine);
	return Math.max(
		CP_RESPAWN_MIN_MS,
		CP_RESPAWN_MS - deficit * CP_RESPAWN_ADVANTAGE_MS,
	);
}

/**
 * The screen this side spawns on: **the screen of its furthest-forward point**.
 *
 * One point per screen makes "behind the front line" a precise thing: the
 * front line is the boundary between the team's furthest-forward point and the
 * next one, so the friendly side of it *is* the frontier screen. A team owns
 * the ground it stands on; that is where it comes back.
 *
 * It was tempting to spawn one screen further back — the classic "spawn behind
 * your lines" — and the probe showed why it is wrong on this map: with the
 * enemy's last point two screens from the attacker's spawn and the defender's
 * spawn on it, no push ever landed. The last hold lasted forever because the
 * walk was 1600px against a 2s respawn. Spawning on the frontier makes the
 * last push a fight at the point rather than a run at it.
 *
 * AZURE's line is a prefix, EMBER's a suffix, so this is pure arithmetic on
 * ownership — no per-mode spawn tables anywhere.
 */
export function controlSpawnScreen(
	points: readonly ControlPointState[],
	screens: number,
	team: TeamId,
): number {
	const last = screens - 1;
	if (last <= 0) return 0;
	if (team === 0) {
		let frontier = -1;
		for (let i = 0; i < points.length; i++) {
			if (points[i]?.owner === 0) frontier = i;
		}
		if (frontier < 0) return 0;
		return Math.min(last, Math.max(0, frontier));
	}
	let frontier = points.length;
	for (let i = points.length - 1; i >= 0; i--) {
		if (points[i]?.owner === 1) frontier = i;
	}
	if (frontier >= points.length) return last;
	return Math.min(last, Math.max(0, frontier));
}

/** The per-point shape the snapshot carries. */
interface ControlPointStatus {
	owner: TeamId | null;
	attacker: TeamId | null;
	progress: number;
	contested: boolean;
	/** Per team, the adjacency rule. A team's own point reads false; combine. */
	unlocked: [boolean, boolean];
}

/** Control state as the client sees it, inside `TeamStatus`. */
export interface ControlStatus {
	points: ControlPointStatus[];
	overtime: boolean;
	/** Captures this match, for the probe and the scoreboard. */
	captures: number;
}

/** Build the snapshot view of the line. */
export function controlStatus(
	points: readonly ControlPointState[],
	overtime: boolean,
	captures: number,
): ControlStatus {
	return {
		points: points.map((point, i) => {
			const unlocked: [boolean, boolean] = [false, false];
			for (let t = 0; t < TEAM_COUNT; t++) {
				unlocked[t] = unlockedFor(points, i, t as TeamId);
			}
			return {
				owner: point.owner,
				attacker: point.attacker,
				progress: point.progress,
				contested: point.contested,
				unlocked,
			};
		}),
		overtime,
		captures,
	};
}
