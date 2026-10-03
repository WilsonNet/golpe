import { describe, expect, it } from "vitest";
import { ITEMS } from "../../tweakables/items.js";
import { RANGED_WEAPONS } from "../../tweakables/ranged.js";
import { reserveRoundsFor } from "./Physics.js";
import {
	type AmmoPackFighter,
	ammoPackReach,
	ammoPackUseful,
	takeAmmoPack,
} from "./AmmoPacks.js";

const rifle = RANGED_WEAPONS.rifle;
const shotgun = RANGED_WEAPONS.shotgun;
const grenade = ITEMS["he-grenade"];

/** A fighter mid-life: some rounds gone, one item spent. */
const used: AmmoPackFighter = { reserveRounds: 12, itemCharges: 1 };

describe("ammo pack reach", () => {
	it("takes a body standing on the pack, not one a step away", () => {
		const pack = { x: 400, y: 534 };
		// Standing on the ground at the pack's x: the body centre is 10px below it.
		expect(ammoPackReach(pack, 400, 520)).toBe(true);
		// A fighter-sized step to the side: out of reach.
		expect(ammoPackReach(pack, 480, 520)).toBe(false);
		// On the ledge above: the pack is scenery from there.
		expect(ammoPackReach(pack, 400, 260)).toBe(false);
	});
});

describe("ammo pack usefulness", () => {
	it("leaves a full fighter's pack on the ground", () => {
		const full: AmmoPackFighter = {
			reserveRounds: reserveRoundsFor(rifle),
			itemCharges: grenade.maxCharges,
		};
		expect(ammoPackUseful(full, rifle, grenade)).toBe(false);
		// One spent round in the reserve is enough to take it.
		expect(
			ammoPackUseful({ ...full, reserveRounds: full.reserveRounds - 1 }, rifle, grenade),
		).toBe(true);
		// So is a spent item charge, even with a full gun.
		expect(
			ammoPackUseful({ ...full, itemCharges: full.itemCharges - 1 }, rifle, grenade),
		).toBe(true);
	});
});

describe("taking a pack", () => {
	it("adds two magazines, capped at the life's reserve", () => {
		// Rifle: 12 rounds a magazine, so +24 — capped at the 36-round reserve.
		expect(takeAmmoPack(used, rifle, grenade).reserveRounds).toBe(36);
		expect(takeAmmoPack({ reserveRounds: 0, itemCharges: 0 }, rifle, grenade)).toEqual(
			{ reserveRounds: 24, itemCharges: 1 },
		);
	});

	it("reads the magazine size of the weapon, not a flat number", () => {
		// Shotgun: 5 shells a magazine, so +10 — and it carries a deeper reserve.
		const dryShotgun = { reserveRounds: 0, itemCharges: 0 };
		expect(takeAmmoPack(dryShotgun, shotgun, grenade).reserveRounds).toBe(10);
		expect(reserveRoundsFor(shotgun)).toBe(20);
	});

	it("adds one item charge, capped at the kit's maximum", () => {
		expect(takeAmmoPack({ reserveRounds: 36, itemCharges: 0 }, rifle, grenade).itemCharges).toBe(1);
		expect(
			takeAmmoPack({ reserveRounds: 36, itemCharges: grenade.maxCharges }, rifle, grenade)
				.itemCharges,
		).toBe(grenade.maxCharges);
	});
});
