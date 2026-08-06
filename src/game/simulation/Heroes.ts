/**
 * The hero registry: who exists, what weapons they carry, and how their kit is
 * built. See specs/heroes.md.
 *
 * A **kit** is the whole of what the simulation needs to know about a fighter
 * beyond `PlayerPosition`: which melee weapon table governs their sword-stance
 * moves, which ranged weapon answers their gun-stance fire, and which ultimate
 * their meter spends. It is an argument to `tickPlayer` — never stored in
 * `PlayerPosition` — for exactly the reason `field` is: the kit is a static
 * property of the fighter (like their name), both sides learn it from the
 * snapshot, and neither side ever has to replay it.
 *
 * The stance enum on the wire stays `"sword" | "gun"` because it is the
 * *slot*: melee weapon out or ranged weapon out. Which weapon that slot means
 * is the hero's business, so the wire format never changes when a hero does.
 */

import { MELEE_WEAPONS, type MeleeWeaponDef } from "./Melee.js";

export type HeroId = "lia" | "anands";
export const HERO_IDS = ["lia", "anands"] as const;
export const DEFAULT_HERO: HeroId = "lia";

export function isHeroId(v: unknown): v is HeroId {
	return typeof v === "string" && (HERO_IDS as readonly string[]).includes(v);
}

export type RangedWeaponId = "gun" | "machinegun";

/** The ranged half of a kit: one fire-rate/damage/speed stat card. */
export interface RangedWeaponDef {
	id: RangedWeaponId;
	label: string;
	/** ms between shots. The machine gun is light, so it fires faster. */
	cooldownMs: number;
	damage: number;
	speed: number;
}

export const RANGED_WEAPONS: Record<RangedWeaponId, RangedWeaponDef> = {
	gun: {
		id: "gun",
		label: "GUN",
		cooldownMs: 250,
		damage: 10,
		speed: 600,
	},
	machinegun: {
		id: "machinegun",
		label: "MACHINE GUN",
		// Four shots where the pistol fires one. The dagger is the lightest
		// weapon in the game and its ranged answer is a stream, not a poke —
		// lower per-shot damage so the stream does not out-kill the pistol by
		// double, faster bullets so a stream can actually be landed.
		cooldownMs: 110,
		damage: 5,
		speed: 780,
	},
};

type UltimateId = "black-hole" | "dragon-thrust";

export interface HeroDef {
	id: HeroId;
	name: string;
	/** One line for the menu card. */
	blurb: string;
	melee: MeleeWeaponDef;
	ranged: RangedWeaponDef;
	ultimate: UltimateId;
	/** The sprite sheet this hero is drawn from. See `render/assets.ts`. */
	sheet: "dude" | "anands";
}

export const HEROES: Record<HeroId, HeroDef> = {
	lia: {
		id: "lia",
		name: "Lia",
		blurb:
			"Sword and pistol. The classic duelist: reads, guards and the black hole.",
		melee: MELEE_WEAPONS.sword,
		ranged: RANGED_WEAPONS.gun,
		ultimate: "black-hole",
		sheet: "dude",
	},
	anands: {
		id: "anands",
		name: "Anands",
		blurb:
			"Dagger and machine gun. A storm of stabs, a lunging knockdown, and a dragon.",
		melee: MELEE_WEAPONS.dagger,
		ranged: RANGED_WEAPONS.machinegun,
		ultimate: "dragon-thrust",
		sheet: "anands",
	},
};

/** Everything `tickPlayer` and the server need to know about a fighter's kit. */
export interface HeroKit {
	hero: HeroId;
	melee: MeleeWeaponDef;
	ranged: RangedWeaponDef;
	ultimate: UltimateId;
}

export function kitFor(hero: HeroId): HeroKit {
	const def = HEROES[hero];
	return {
		hero,
		melee: def.melee,
		ranged: def.ranged,
		ultimate: def.ultimate,
	};
}

/** The kit every pre-hero caller gets: the sword game, unchanged. */
export const LIA_KIT: HeroKit = kitFor("lia");
