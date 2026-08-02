/**
 * Team deathmatch: sides, the friendly-fire rule, and the wipe-out round.
 *
 * Pure and shared, like everything else in `simulation/`. The server is the only
 * judge of a kill and of a round ending, but *both* sides ask these functions —
 * a client predicts the black hole's pull through `fieldAffects`, and a client
 * that disagreed about who is a teammate would drag its own side into a hole the
 * server is not pulling them into.
 *
 * No wall-clock reads in here. Elapsed time arrives as a number, exactly as it
 * does in `Deathmatch.ts`.
 *
 * **The mode is a property of the room**, fixed by whoever created it. Deathmatch
 * is still the default; team deathmatch is what `?mode=tdm` asks for.
 */

/** Which ruleset a room plays. */
export type MatchMode = "ffa" | "tdm";

/**
 * A side. `null` is "no team", which is what every fighter in a free-for-all is
 * — and the value that makes the friendly-fire rule fall back to "everybody is
 * hostile" without a mode check at every call site.
 */
export type TeamId = 0 | 1;

export const TEAM_COUNT = 2;

/** What the scoreboard calls each side. Index is the team id. */
export const TEAM_NAMES = ["AZURE", "EMBER"] as const;

/**
 * Rounds that win a team deathmatch.
 *
 * Fifteen wipe-outs, not fifteen frags: a TDM round ends when one side is gone,
 * so a "point" is a whole team eliminated. At roughly 20-40s a round that is a
 * match of real length, and it is the number the mode is balanced around.
 */
export const TDM_SCORE_LIMIT = 15;

/**
 * How wide a team deathmatch room is, at minimum.
 *
 * Wipe-out rounds need somewhere to retreat to. On one 800px screen two teams
 * start inside each other's reach and the round is decided by the first exchange
 * — there is no flank, no regroup and no reason to hold ground. Three screens is
 * the smallest arena in which a team can lose a fight and still have a fight
 * left, which is why it is a floor rather than a default: `?screen=1` in a TDM
 * room is raised to 3, and a bigger number is honoured.
 */
export const TDM_MIN_SCREENS = 3;

/**
 * How long the arena holds after a wipe, before the next round is set up.
 *
 * The cooldown: five seconds to watch the last exchange land, read the score and
 * stop moving. The survivors keep playing through it — **the simulation is never
 * frozen for a scoring state**, for the same reason the free-for-all podium does
 * not freeze it.
 */
export const ROUND_RESET_DELAY_MS = 5000;

/**
 * How long fighters stand planted at their spawns before a round goes live.
 *
 * Counter-Strike's freezetime, and it is here for the reason CS has it: the
 * seconds before a round are where the round is *decided* — you look at where
 * your team is, where theirs will come from, and what you are going to do — and
 * the dead air is what makes the first exchange land like it matters. A round
 * that begins the instant the previous one is scored is a round nobody arrives
 * at.
 *
 * **Four seconds, not CS's ten.** CS spends its freezetime on a buy menu and a
 * plan for a two-minute round; there is nothing to buy here and a round lasts
 * half a minute, so ten seconds was mostly waiting. Four is long enough to find
 * your team, read the score and tense up, and short enough that fifteen of them
 * are not a minute of the match spent standing still.
 *
 * **It is not a pause.** Every client keeps simulating at sixty ticks a second;
 * the fighters simply take the neutral intent — see `PlayerPosition.freezeTimer`.
 * The match clock does not run during it, so fifteen rounds of freezetime cannot
 * quietly hand the match to the timer.
 */
export const ROUND_FREEZE_MS = 4000;

/** One fighter, as the round rules see it. */
export interface TeamMember {
	team: TeamId | null;
	alive: boolean;
}

/**
 * Are these two on the same side?
 *
 * `null` is nobody's teammate — including another `null`. That is what makes a
 * free-for-all fall out of the team rules for free: in FFA every fighter carries
 * `team: null`, so every pair is hostile without a single `mode === "ffa"` test
 * anywhere in the damage path.
 */
export function sameTeam(
	a: TeamId | null | undefined,
	b: TeamId | null | undefined,
): boolean {
	return a !== null && a !== undefined && a === b;
}

/**
 * **The friendly-fire rule, and the only place it is written.**
 *
 * Every weapon asks this rather than comparing teams itself: swords in
 * `resolveMeleeHits`, bullets in `tickBullets`, and the black hole through
 * `fieldAffects`. One predicate is what stops a mode being added and one damage
 * path quietly keeping the old behaviour — which in a team game is the bug that
 * loses the round for you.
 */
export function hostile(
	a: TeamId | null | undefined,
	b: TeamId | null | undefined,
): boolean {
	return !sameTeam(a, b);
}

/**
 * The side a new fighter joins: whichever is smaller, ties to the lower id.
 *
 * Deterministic rather than random, so a room seated in one order twice comes
 * out the same way — and so a probe can assert the split instead of hoping for
 * it. Counts arrive indexed by team id.
 */
export function balanceTeam(counts: readonly number[]): TeamId {
	let best: TeamId = 0;
	for (let t = 1; t < TEAM_COUNT; t++) {
		if ((counts[t] ?? 0) < (counts[best] ?? 0)) best = t as TeamId;
	}
	return best;
}

/** How many fighters each side has, indexed by team id. */
export function teamCounts(members: readonly TeamMember[]): number[] {
	const counts = new Array<number>(TEAM_COUNT).fill(0);
	for (const m of members) {
		if (m.team === null) continue;
		counts[m.team] = (counts[m.team] ?? 0) + 1;
	}
	return counts;
}

/** How many fighters each side still has standing, indexed by team id. */
export function aliveCounts(members: readonly TeamMember[]): number[] {
	const counts = new Array<number>(TEAM_COUNT).fill(0);
	for (const m of members) {
		if (m.team === null || !m.alive) continue;
		counts[m.team] = (counts[m.team] ?? 0) + 1;
	}
	return counts;
}

/**
 * How a round ended, if it has.
 *
 * `"win"` names the side left standing; `"draw"` is both sides gone on the same
 * tick, which a black hole makes perfectly possible and which scores nobody.
 * `null` means the round is still being fought.
 */
export type RoundResult =
	| { kind: "win"; team: TeamId }
	| { kind: "draw" }
	| null;

/**
 * Is this round over, and who took it?
 *
 * **A round ends by wipe-out, never by a timer.** That is the whole shape of the
 * mode: a dead fighter stays dead, so the last member of a side is playing for
 * their entire team and everyone else is watching them do it.
 *
 * Both sides must have had somebody in them to begin with. Without that check a
 * room with one fighter in it "wipes" the empty side sixty times a second and
 * wins the match before the second player has finished connecting.
 */
export function roundResult(members: readonly TeamMember[]): RoundResult {
	const seated = teamCounts(members);
	for (let t = 0; t < TEAM_COUNT; t++) {
		if ((seated[t] ?? 0) === 0) return null;
	}

	const alive = aliveCounts(members);
	const standing: TeamId[] = [];
	for (let t = 0; t < TEAM_COUNT; t++) {
		if ((alive[t] ?? 0) > 0) standing.push(t as TeamId);
	}
	if (standing.length === 0) return { kind: "draw" };
	if (standing.length === 1)
		return { kind: "win", team: standing[0] as TeamId };
	return null;
}

/**
 * Has a team won the match, and which one?
 *
 * Score first, then the clock — the same order `matchEndReason` uses, and for
 * the same reason: a round won on the final second is a won match rather than an
 * expired one.
 */
export function teamMatchWinner(
	scores: readonly number[],
	scoreLimit: number,
): TeamId | null {
	let best: TeamId | null = null;
	for (let t = 0; t < TEAM_COUNT; t++) {
		const score = scores[t] ?? 0;
		if (score < scoreLimit) continue;
		if (best === null || score > (scores[best] ?? 0)) best = t as TeamId;
	}
	return best;
}

/**
 * Who is ahead on rounds, ignoring the limit. `null` is a tie.
 *
 * What the podium shows when the clock runs out with nobody at the limit.
 */
export function teamAhead(scores: readonly number[]): TeamId | null {
	let best: TeamId = 0;
	let tied = false;
	for (let t = 1; t < TEAM_COUNT; t++) {
		const score = scores[t] ?? 0;
		const bestScore = scores[best] ?? 0;
		if (score > bestScore) {
			best = t as TeamId;
			tied = false;
		} else if (score === bestScore) {
			tied = true;
		}
	}
	return tied ? null : best;
}

/** The name of a side, for a scoreboard row or a battle message. */
export function teamName(team: TeamId | null | undefined): string {
	return team === null || team === undefined
		? ""
		: (TEAM_NAMES[team] ?? `TEAM ${team}`);
}
