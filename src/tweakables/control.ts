import { MS_PER_SECOND, SECONDS_PER_MINUTE } from "../game/simulation/units.js";

/**
 * Control points: TF2's symmetric 5CP, scaled to this game's pace.
 *
 * Every number here is a tuning constant and lives here rather than in
 * `simulation/ControlPoints.ts` — the rules are the code, the values are the
 * game. The TF2 numbers each one descends from are in the comments, because
 * the *ratios* are the design and the absolute values are this game's.
 */

/** Points on the line. Five is the mode. */
export const CP_POINT_COUNT = 5;

/**
 * How wide the control arena is, in 800px screens: one screen per point.
 *
 * The mode's map is fixed-width on purpose. A capture point is the thing the
 * arena is spaced around, so "one point per screen" is the map's unit of
 * modularity — the odd modules are mirrors of the even ones, exactly like the
 * classic arena's tiled screens.
 */
export const CP_SCREENS = 5;

/**
 * Seconds to capture each point at one fighter, left to right.
 *
 * TF2's real 5CP times are 4s (last points), 12–16s (yards) and 18–24s (mid)
 * at one player; this game's map is crossed in twenty seconds and a fighter
 * respawns in four, so the whole ladder is scaled to roughly a third. The
 * shape is the point: **the last point falls fastest, the middle slowest** —
 * the map gets easier to take the further you have pushed, which is what makes
 * a coast-to-coast push possible.
 */
const CP_CAPTURE_SECONDS: readonly number[] = [2, 5, 8, 5, 2];

/** Capture times in ms, indexed by point. */
export const CP_CAPTURE_MS: readonly number[] = CP_CAPTURE_SECONDS.map(
	(s) => s * MS_PER_SECOND,
);

/**
 * The middle point's capture seconds, and the range `?capTime=S` may ask for.
 *
 * A creator-only practice-room flag, like `?ultCharge`: the other four points
 * scale by their ratios, so `capTime=1` turns a whole round into a thing a
 * probe can play out.
 */
export const CP_CAP_TIME_DEFAULT_S = CP_CAPTURE_SECONDS[2] ?? 8;
export const CP_CAP_TIME_MIN_S = 1;
export const CP_CAP_TIME_MAX_S = 30;

/**
 * Time from a full capture bar to zero when the attackers leave.
 *
 * TF2's is 90s; scaled like the capture times, and deliberately slower than
 * the capture itself so a push that was driven off leaves a real head start
 * for the next one.
 */
export const CP_DECAY_MS = 30000;

/**
 * How much faster decay and reversion run in overtime.
 *
 * TF2's exact rule: 90s becomes 15s. A stalled push that time ran out on has
 * seconds to finish, not half a minute — the clock is the pressure again.
 */
export const CP_OVERTIME_DECAY_MULTIPLIER = 6;

/**
 * Time handed back to the clock when a capture completes in overtime.
 *
 * The capture that was in progress when the whistle blew is allowed to finish
 * what it started; the minute is the round continuing afterwards.
 */
export const CP_OVERTIME_BONUS_MS = 60 * MS_PER_SECOND;

/**
 * Rounds that win a control match.
 *
 * A round is a whole line captured — a full coast-to-coast push — so three of
 * them is a war rather than a skirmish. TF2 competitive's winlimit is five
 * halves of this length; three fits this game's ten-minute budget.
 */
export const CP_SCORE_LIMIT = 3;

/** A control match runs this many minutes unless a team takes the rounds. */
const DEFAULT_CONTROL_MINUTES = 10;

export const CP_TIME_LIMIT_MS =
	DEFAULT_CONTROL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** How long a dead fighter waits, at even points. */
export const CP_RESPAWN_MS = 4000;

/**
 * How much of that wait each point of deficit takes away.
 *
 * TF2's respawn advantage: the side being pushed gets bodies back sooner, and
 * that is the whole comeback mechanic. Asked at the moment of death, so the
 * delay is a fact about the line when the fighter fell. Four points behind is
 * the most a side can be without the round already over, and it lands on the
 * floor — the clamp is what a death during the winning cooldown reads, and the
 * floor exists so no future tuning can make an advantage spawn a fighter
 * instantly.
 */
export const CP_RESPAWN_ADVANTAGE_MS = 700;

/** The floor the advantage can never cross. */
export const CP_RESPAWN_MIN_MS = 1500;

/**
 * The capture pad's size, in world px.
 *
 * Wide enough that a fighter standing beside it is not accidentally on it,
 * tall enough to hold a fighter (48px) with a little headroom: a jump clears
 * the pad, walking onto it captures. The drawn pad and the capture zone are
 * this same rectangle, so the art cannot lie about what counts.
 */
export const CP_ZONE_W = 180;
export const CP_ZONE_H = 64;

/** Spawn points a module must carry, so a full side can always spawn spread. */
export const CP_SPAWNS_PER_MODULE = 8;
