/**
 * Deathmatch rules: scoring, the win condition and the standings order.
 *
 * Pure and shared, like everything else in `simulation/`. The server is the only
 * judge of a kill, but the *ordering* has to be identical on both sides or the
 * scoreboard a player reads mid-match disagrees with the podium they are shown
 * at the end — which looks exactly like the server cheating them out of second
 * place.
 *
 * No wall-clock reads in here. Elapsed time arrives as a number.
 */

/** Frags that end the match. */
export const SCORE_LIMIT = 21;

/** Wall-clock length of a match, when nobody reaches the score limit. */
export const TIME_LIMIT_MS = 5 * 60 * 1000;

/** How long a fighter stays down before returning to the arena. */
export const RESPAWN_DELAY_MS = 2000;

/** How long the podium stays up before the next match starts. */
export const MATCH_OVER_LINGER_MS = 15000;

export type MatchPhase = "live" | "over";

/** Why the match ended. `null` while it is still running. */
export type MatchEndReason = "score" | "time" | null;

export interface ScoreEntry {
	id: string;
	name: string;
	kills: number;
	deaths: number;
	/** True for a server-hosted bot, so the UI can say so. */
	bot: boolean;
}

/** A ranked entry: the standings plus the place it came in. */
export interface Standing extends ScoreEntry {
	/** 1-based. Shared by nobody — ties are broken until the order is total. */
	place: number;
}

/**
 * Rank the standings.
 *
 * The tie-break chain is deliberately total: kills, then fewest deaths, then
 * name, then id. Anything less leaves the order dependent on iteration order,
 * which differs between the server's `Map` and whatever the client rebuilt from
 * a snapshot — and two clients would then draw two different podiums from
 * identical data.
 */
export function rankScores(entries: readonly ScoreEntry[]): Standing[] {
	return [...entries]
		.sort(
			(a, b) =>
				b.kills - a.kills ||
				a.deaths - b.deaths ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id),
		)
		.map((entry, i) => ({ ...entry, place: i + 1 }));
}

/**
 * Has the match ended, and why?
 *
 * Score is checked before time so a frag landing on the final second reads as a
 * won match rather than an expired one.
 */
export function matchEndReason(
	entries: readonly ScoreEntry[],
	elapsedMs: number,
	scoreLimit = SCORE_LIMIT,
	timeLimitMs = TIME_LIMIT_MS,
): MatchEndReason {
	for (const entry of entries) {
		if (entry.kills >= scoreLimit) return "score";
	}
	return elapsedMs >= timeLimitMs ? "time" : null;
}

/** The winner: first place, or null in an empty match. */
export function matchWinner(entries: readonly ScoreEntry[]): Standing | null {
	return rankScores(entries)[0] ?? null;
}

/** Time left on the clock, floored at zero. */
export function timeLeftMs(elapsedMs: number, timeLimitMs = TIME_LIMIT_MS) {
	return Math.max(0, timeLimitMs - elapsedMs);
}
