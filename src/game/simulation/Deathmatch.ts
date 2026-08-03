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

import type { TeamId } from "./Teams.js";
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from "./units.js";

/** Frags that end the match. */
export const SCORE_LIMIT = 21;

/** Wall-clock length of a match, when nobody reaches the score limit. */
/** A deathmatch runs for this many minutes, unless somebody hits the score limit. */
const DEFAULT_MATCH_MINUTES = 5;
export const TIME_LIMIT_MS =
	DEFAULT_MATCH_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** How long a fighter stays down before returning to the arena. */
export const RESPAWN_DELAY_MS = 2000;

/**
 * How long the end of a match lasts before the next one starts.
 *
 * **Thirty seconds, and it is not all podium.** The ceremony is two things now:
 * Play of the Game runs first — a title card, a pre-roll of camera work, the
 * footage itself and a card at the end, up to about twenty-one seconds for the
 * longest clip the server will cut — and only then does the podium go up. It
 * was fifteen seconds when the podium was the whole of it, and leaving it there
 * would have meant a new match starting underneath a replay of the last one.
 *
 * See specs/play-of-the-game.md for where the twenty-one seconds goes.
 */
export const MATCH_OVER_LINGER_MS = 30000;

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
	/**
	 * Which side, in team deathmatch. `null` in a free-for-all, and absent from
	 * anything that predates teams.
	 *
	 * Deliberately **not** part of the ranking. Individual standings stay
	 * individual in both modes — a TDM scoreboard groups these rows by side, but
	 * the order inside a group is the same order the same function produces for a
	 * free-for-all, so there is only ever one ranking to disagree about.
	 */
	team?: TeamId | null;
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
