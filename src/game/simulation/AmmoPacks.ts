import {
	CP_AMMO_PACK_ITEM_CHARGES,
	CP_AMMO_PACK_MAGAZINES,
	CP_AMMO_PACK_REACH_PX,
} from "../../tweakables/control.js";
import type { ItemDef } from "../../tweakables/items.js";
import type { RangedWeaponDef } from "../../tweakables/ranged.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "./Arena.js";
import { reserveRoundsFor } from "./Physics.js";

/**
 * Ammo packs: the map's answer to `magazinesPerLife`.
 *
 * The guns are a per-life economy — a dry gun is dry until death, which is
 * what forces the fight back to the sword. TF2's answer to that pressure is
 * the ammo pack, and the reason is simple once you have played without one:
 * a push that cannot reload is a push that cannot happen, and every fight
 * after the first magazine is decided by attrition rather than by play. A pack
 * puts **two magazines** back in the reserve and **one item charge** back in
 * the kit, at a spot both sides can reach, so the walk to it is a decision
 * made under pressure.
 *
 * Pure and shared, like everything in `simulation/`. The server owns where the
 * packs are and who touched one; this file owns what touching one *means*.
 */

/** Where a pack floats. Pickup measures from this centre. */
export interface AmmoPackSpot {
	x: number;
	y: number;
}

/** The fighter state a pack reads and writes: reserve rounds and charges. */
export interface AmmoPackFighter {
	reserveRounds: number;
	itemCharges: number;
}

/**
 * Is a fighter's body close enough to a floating pack to take it?
 *
 * Centre-to-centre with a generous reach, because the pack hovers where a
 * fighter runs *through* it — a pixel-accurate pickup would be collected by
 * the AI by accident and missed by a player by a step.
 */
export function ammoPackReach(
	spot: AmmoPackSpot,
	bodyX: number,
	bodyY: number,
): boolean {
	const cx = bodyX + PLAYER_WIDTH / 2;
	const cy = bodyY + PLAYER_HEIGHT / 2;
	return Math.hypot(cx - spot.x, cy - spot.y) <= CP_AMMO_PACK_REACH_PX;
}

/**
 * Would this pack do anything for this fighter?
 *
 * **A full fighter leaves the pack on the ground.** TF2's pickups work the
 * same way, and the alternative is worse than it sounds: bots and players
 * brushing past a full kit would drain the map's supply without gaining
 * anything, and the pack would be gone the moment somebody who actually
 * needed it arrived.
 */
export function ammoPackUseful(
	state: AmmoPackFighter,
	ranged: RangedWeaponDef,
	item: ItemDef,
): boolean {
	return (
		state.reserveRounds < reserveRoundsFor(ranged) ||
		state.itemCharges < item.maxCharges
	);
}

/**
 * Take the pack: two magazines into the reserve, capped at the life's own
 * reserve, and one item charge back, capped at the kit's maximum.
 *
 * The **loaded magazine is untouched** — the same rule a death follows: the
 * reserve is what refills, and the auto-reload pulls from it. A fighter who
 * takes a pack with an empty magazine reloads on the next quiet beat, which
 * is the survival beat the reload system already owns.
 */
export function takeAmmoPack(
	state: AmmoPackFighter,
	ranged: RangedWeaponDef,
	item: ItemDef,
): AmmoPackFighter {
	return {
		reserveRounds: Math.min(
			reserveRoundsFor(ranged),
			state.reserveRounds + CP_AMMO_PACK_MAGAZINES * ranged.magazine,
		),
		itemCharges: Math.min(
			item.maxCharges,
			state.itemCharges + CP_AMMO_PACK_ITEM_CHARGES,
		),
	};
}
