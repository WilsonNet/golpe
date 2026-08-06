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
 * **Forty-four seconds, and it is not all podium.** The end of a match is a
 * four-beat ceremony now, and every beat gets its time: a few seconds of the
 * arena holding the last moment, a victory card, Play of the Game — a title
 * card, ten seconds of pre-roll camera work, the footage itself and a card at
 * the end, up to about twenty-seven seconds — and only then the podium. It
 * was fifteen seconds when the podium was the whole of it, and leaving it
 * there would have meant a new match starting underneath a replay of the last
 * one.
 *
 * See specs/play-of-the-game.md for where the time goes.
 */
export const MATCH_OVER_LINGER_MS = 44000;

/**
 * How long the arena is left alone after the last frag, before the victory
 * card lands.
 *
 * This is the *breathing*: the fight is over, the winner is standing, and for
 * three seconds the game does not say anything about it. A cut straight from
 * the winning blow to a full-screen card reads as an interruption; the silence
 * is what makes the card an answer instead of a shout. Pacing is
 * presentation, which is why these two live beside the linger budget rather
 * than in a component: the ceremony's parts have to fit the whole, and a
 * card that quietly doubled would push the next match's first seconds under
 * a replay of the last one.
 */
export const VICTORY_BREATHING_MS = 3000;

/** How long the victory card owns the screen, from its slam to the curtain. */
export const VICTORY_HOLD_MS = 3500;

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
 * MVP weights: the Play-of-the-Game table applied to a whole match.
 *
 * The two honours must agree about what is worth remembering. A frag is the
 * unit; a **deny** outscores it outright because taking somebody's ultimate
 * away is the rarest thing in the game; damage and blocked damage are
 * burst-priced and cheap, because they *colour* a performance — a fighter who
 * merely farmed a health bar of damage should never out-score one who closed
 * a kill. Kills stay the largest part of the score; these numbers decide the
 * order behind the frag leader, and are the whole reason a TDM support with
 * three denies can be the MVP over their side's cleanest fragger.
 */
const MVP_KILL_WEIGHT = 100;
const MVP_DENY_WEIGHT = 140;
export const MVP_DAMAGE_PER_BURST = 20;
export const MVP_BLOCKED_PER_BURST = 10;
/** Damage points per burst for the two burst rows, like `POTG_DAMAGE_BURST`. */
export const MVP_STAT_BURST = 100;

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
