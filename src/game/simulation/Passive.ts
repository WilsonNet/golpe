/**
 * Hero passives, as pure functions of what the server knows. See
 * specs/ibiriki.md.
 *
 * Ibiriki's **bloodlust** is a reading of the room: the weakest hostile
 * fighter's HP fraction, mapped onto 0..1. The server computes it every tick
 * (only the server knows every HP) and writes it into the fighter's
 * `PlayerPosition.bloodlust`, which both sides' `tickPlayer` reads.
 */

import {
	BERSERK_DAMAGE_TAKEN,
	BERSERK_FRACTION,
	BLOODLUST_START_FRACTION,
	BLOODLUST_STEP,
} from "../../tweakables/passive.js";

export { BERSERK_DAMAGE_TAKEN };

/**
 * Bloodlust for the weakest foe at `fraction` of their HP: 0 at or above
 * `BLOODLUST_START_FRACTION`, 1 at or below `BERSERK_FRACTION`, linear in
 * between, quantised to `BLOODLUST_STEP`. No foe alive (`null`) is no prey.
 */
export function bloodlustFor(fraction: number | null): number {
	if (fraction === null) return 0;
	const t =
		(BLOODLUST_START_FRACTION - fraction) /
		(BLOODLUST_START_FRACTION - BERSERK_FRACTION);
	const clamped = Math.max(0, Math.min(1, t));
	return Math.round(clamped / BLOODLUST_STEP) * BLOODLUST_STEP;
}
