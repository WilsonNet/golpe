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

import type { ItemDef } from "../../tweakables/items.js";
import type { RangedWeaponDef } from "../../tweakables/ranged.js";
import { RANGED_WEAPONS } from "../../tweakables/ranged.js";
import { ITEMS } from "./Items.js";
import { MELEE_WEAPONS, type MeleeWeaponDef } from "./Melee.js";

export { RANGED_WEAPONS };

export type HeroId = "lia" | "anands" | "jeffs";
export const HERO_IDS = ["lia", "anands", "jeffs"] as const;
export const DEFAULT_HERO: HeroId = "lia";

export function isHeroId(v: unknown): v is HeroId {
	return typeof v === "string" && (HERO_IDS as readonly string[]).includes(v);
}

type UltimateId = "black-hole" | "dragon-thrust" | "death-blossom";

export interface HeroDef {
	id: HeroId;
	name: string;
	/** One line for the menu card. */
	blurb: string;
	melee: MeleeWeaponDef;
	ranged: RangedWeaponDef;
	ultimate: UltimateId;
	/** The item this hero carries. Not unique — a future hero can share one. */
	item: ItemDef;
	/** The sprite sheet this hero is drawn from. See `render/assets.ts`. */
	sheet: "dude" | "anands" | "jeffs";
}

export const HEROES: Record<HeroId, HeroDef> = {
	lia: {
		id: "lia",
		name: "Lia",
		blurb:
			"Sword and pistol. The classic duelist: reads, guards and the black hole.",
		melee: MELEE_WEAPONS.sword,
		ranged: RANGED_WEAPONS.rifle,
		ultimate: "black-hole",
		item: ITEMS["he-grenade"],
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
		item: ITEMS.trap,
		sheet: "anands",
	},
	jeffs: {
		id: "jeffs",
		name: "Jeffs",
		blurb:
			"Sword and shotgun. A point-blank executioner and a smoke-and-mirrors schemer.",
		melee: MELEE_WEAPONS.sword,
		ranged: RANGED_WEAPONS.shotgun,
		ultimate: "death-blossom",
		item: ITEMS["smoke-grenade"],
		sheet: "jeffs",
	},
};

/** Everything `tickPlayer` and the server need to know about a fighter's kit. */
export interface HeroKit {
	hero: HeroId;
	melee: MeleeWeaponDef;
	ranged: RangedWeaponDef;
	ultimate: UltimateId;
	item: ItemDef;
}

export function kitFor(hero: HeroId): HeroKit {
	const def = HEROES[hero];
	return {
		hero,
		melee: def.melee,
		ranged: def.ranged,
		ultimate: def.ultimate,
		item: def.item,
	};
}

/** The kit every pre-hero caller gets: the sword game, unchanged. */
export const LIA_KIT: HeroKit = kitFor("lia");
