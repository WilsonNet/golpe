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

import {
	MATCH_OVER_LINGER_MS,
	MVP_BLOCKED_PER_BURST,
	MVP_DAMAGE_PER_BURST,
	MVP_DENY_WEIGHT,
	MVP_KILL_WEIGHT,
	MVP_STAT_BURST,
	RESPAWN_DELAY_MS,
	SCORE_LIMIT,
	TIME_LIMIT_MS,
	VICTORY_BREATHING_MS,
	VICTORY_HOLD_MS,
} from "../../tweakables/match.js";
import type { TeamId } from "./Teams.js";

export {
	MATCH_OVER_LINGER_MS,
	MVP_BLOCKED_PER_BURST,
	MVP_DAMAGE_PER_BURST,
	MVP_STAT_BURST,
	RESPAWN_DELAY_MS,
	SCORE_LIMIT,
	TIME_LIMIT_MS,
	VICTORY_BREATHING_MS,
	VICTORY_HOLD_MS,
};

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
	 * Damage points dealt, counted by the server only — no client sees a hit
	 * land. Travels in the snapshot beside the frags, like they do.
	 */
	damage: number;
	/**
	 * Ultimate denies: a kill while the victim held the cast, or a guard that
	 * caught the grenade. Both spent the caster's whole meter, and both credit
	 * the fighter who stopped them.
	 */
	denies: number;
	/**
	 * Damage the sword guard turned away. "Blocked", never "absorbed": it is
	 * what a defender took off their own HP bar.
	 */
	blocked: number;
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
 * One fighter's whole-match worth. Integer arithmetic only — damage runs to
 * four digits, and floating point is how two clients end up disagreeing about
 * a tie.
 */
export function mvpScore(entry: ScoreEntry): number {
	return (
		entry.kills * MVP_KILL_WEIGHT +
		entry.denies * MVP_DENY_WEIGHT +
		Math.floor(entry.damage / MVP_STAT_BURST) * MVP_DAMAGE_PER_BURST +
		Math.floor(entry.blocked / MVP_STAT_BURST) * MVP_BLOCKED_PER_BURST
	);
}

/**
 * The most valuable fighter of the match, not the one who happened to land the
 * most frags. Frags still lead, and the tie-break chain is the same total one
 * `rankScores` uses, so two clients cannot disagree about who it is.
 */
export function mvpOf(entries: readonly ScoreEntry[]): Standing | null {
	if (entries.length === 0) return null;
	const ranked = [...entries]
		.sort(
			(a, b) =>
				mvpScore(b) - mvpScore(a) ||
				b.kills - a.kills ||
				a.deaths - b.deaths ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id),
		)
		.map((entry, i) => ({ ...entry, place: i + 1 }));
	return ranked[0] ?? null;
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
