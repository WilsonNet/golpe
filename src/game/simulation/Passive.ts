/**
 * Hero passives, as pure functions of what the server knows. See
 * specs/ibiriki.md.
 *
 * Ibiriki's **bloodlust** is a reading of the room: every living hostile is
 * prey, and prey contributes a lure that grows as its HP falls and fades as it
 * gets farther away. The strongest single lure wins. The server computes it
 * every tick (only the server knows every HP and position) and writes it into
 * the fighter's `PlayerPosition.bloodlust`, which both sides' `tickPlayer`
 * reads.
 */

import {
	BERSERK_DAMAGE_TAKEN,
	BERSERK_FRACTION,
	BLOODLUST_FULL_RANGE_PX,
	BLOODLUST_START_FRACTION,
	BLOODLUST_STEP,
	BLOODLUST_ZERO_RANGE_PX,
} from "../../tweakables/passive.js";

export { BERSERK_DAMAGE_TAKEN };

/** One living hostile, read from Ibiriki's side of the room. */
export interface BloodlustPrey {
	/** HP as a fraction of max, 0..1. */
	fraction: number;
	/** Centre-to-centre distance from Ibiriki, world px. */
	distancePx: number;
}

/**
 * How much of a foe's lure survives the distance: 1 at or inside
 * `fullRangePx`, 0 at or beyond `BLOODLUST_ZERO_RANGE_PX`, linear in between.
 * `fullRangePx` is wider while already berserk, which is the hysteresis that
 * keeps the frenzy from blinking off at the edge of reach.
 */
export function bloodlustProximity(
	distancePx: number,
	fullRangePx: number = BLOODLUST_FULL_RANGE_PX,
): number {
	const span = BLOODLUST_ZERO_RANGE_PX - fullRangePx;
	const t = (BLOODLUST_ZERO_RANGE_PX - distancePx) / span;
	return Math.max(0, Math.min(1, t));
}

/** The HP share of one foe's lure: 0 at 90%, 1 at the berserk line. */
function hpLure(fraction: number): number {
	const t =
		(BLOODLUST_START_FRACTION - fraction) /
		(BLOODLUST_START_FRACTION - BERSERK_FRACTION);
	return Math.max(0, Math.min(1, t));
}

/**
 * The passive for a room of prey: the strongest single lure, where a lure is
 * the foe's HP share times its proximity share. Quantised to `BLOODLUST_STEP`
 * so the snapshot carries a short number and the client's speed matches the
 * server's exactly. No prey is no bloodlust.
 */
export function bloodlustFor(
	prey: readonly BloodlustPrey[],
	fullRangePx: number = BLOODLUST_FULL_RANGE_PX,
): number {
	let best = 0;
	for (const foe of prey) {
		best = Math.max(
			best,
			hpLure(foe.fraction) * bloodlustProximity(foe.distancePx, fullRangePx),
		);
	}
	return Math.round(best / BLOODLUST_STEP) * BLOODLUST_STEP;
}
