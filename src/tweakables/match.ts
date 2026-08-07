import { MS_PER_SECOND, SECONDS_PER_MINUTE } from "../game/simulation/units.js";

/**
 * The match lifecycle: frag limits, timers, the end-of-match ceremony budget,
 * the MVP weights, and team deathmatch's round rules.
 */

/** Frags that end the match. */
export const SCORE_LIMIT = 21;

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
export const MVP_KILL_WEIGHT = 100;

export const MVP_DENY_WEIGHT = 140;

export const MVP_DAMAGE_PER_BURST = 20;

export const MVP_BLOCKED_PER_BURST = 10;

/** Damage points per burst for the two burst rows, like `POTG_DAMAGE_BURST`. */
export const MVP_STAT_BURST = 100;

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
