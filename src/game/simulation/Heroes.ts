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

import { ITEMS, type ItemDef } from "./Items.js";
import { MELEE_WEAPONS, type MeleeWeaponDef } from "./Melee.js";

export type HeroId = "lia" | "anands" | "jeffs";
export const HERO_IDS = ["lia", "anands", "jeffs"] as const;
export const DEFAULT_HERO: HeroId = "lia";

export function isHeroId(v: unknown): v is HeroId {
	return typeof v === "string" && (HERO_IDS as readonly string[]).includes(v);
}

export type RangedWeaponId = "rifle" | "machinegun" | "shotgun";

/**
 * The ranged half of a kit: one fire-rate/damage/speed stat card, plus the
 * magazine and the reload that every weapon now carries.
 *
 * A shotgun is a fan of pellets, so its card adds the two fields that make a
 * fan: `pellets` (how many bullets one press fires) and `spreadDeg` (half the
 * cone, in degrees — the six pellets sit at even steps from `-spreadDeg` to
 * `+spreadDeg`). The fan is **deterministic**: fixed angles, no randomness,
 * so both sides spawn the same pattern from the same aim and prediction never
 * disagrees with the server.
 *
 * Ammo is **infinite**: every fighter carries a full magazine and the reload
 * is auto — there is no reserve, no pick-up and no manual key (R is the
 * ultimate). The magazine is the only limit, and the reload is the rhythm.
 */
export interface RangedWeaponDef {
	id: RangedWeaponId;
	label: string;
	/** ms between shots. The machine gun is light, so it fires faster. */
	cooldownMs: number;
	/** Damage per bullet — per *pellet* for a shotgun. */
	damage: number;
	speed: number;
	/** How many bullets one press fires. Absent means one — an ordinary shot. */
	pellets?: number;
	/** Half the cone, in degrees. The fan spreads ±`spreadDeg` around the aim. */
	spreadDeg?: number;
	/** Rounds per magazine. The reload fills exactly this many. */
	magazine: number;
	/**
	 * ms to refill the whole magazine — the rifle and the machine gun. The
	 * shotgun does not set it: its magazine refills shell-by-shell, and the
	 * two shell times below are the whole of its reload.
	 */
	reloadMs?: number;
	/**
	 * The shotgun's shell-by-shell reload (TF2's "Single" reload type): the
	 * magazine fills one shell at a time, each taking this long. Firing
	 * mid-reload keeps the loaded shells and loses only the shell being
	 * loaded — the shotgun always has its next blast close.
	 */
	reloadShellMs?: number;
	/**
	 * The shell that loads from an empty magazine — the full rack — is
	 * slower than the shells that follow it, TF2's ~0.9s first shell against
	 * the 0.51s consecutive ones. Absent, the shell time applies to all.
	 */
	reloadFirstShellMs?: number;
}

export const RANGED_WEAPONS: Record<RangedWeaponId, RangedWeaponDef> = {
	rifle: {
		id: "rifle",
		label: "RIFLE",
		// The semi-automatic rifle: a clean single shot per press, a small
		// magazine, and the fastest reload in the game — the rifle's whole
		// character is that its pause is short.
		cooldownMs: 250,
		damage: 10,
		speed: 600,
		magazine: 12,
		reloadMs: 800,
	},
	machinegun: {
		id: "machinegun",
		label: "MACHINE GUN",
		// Four shots where the rifle fires one. The dagger is the lightest
		// weapon in the game and its ranged answer is a stream, not a poke —
		// lower per-shot damage so the stream does not out-kill the rifle by
		// double, faster bullets so a stream can actually be landed. A decent
		// magazine and a decent reload: a burst is long enough to matter, and
		// the pause is long enough to punish.
		cooldownMs: 110,
		damage: 5,
		speed: 780,
		magazine: 30,
		reloadMs: 1800,
	},
	shotgun: {
		id: "shotgun",
		label: "SHOTGUN",
		// The delay is the whole weapon: nearly four rifle shots between
		// blasts is the window a miss gives the room. A shotgun is a
		// commitment, like the Massive — fire when you are sure, or pay.
		cooldownMs: 900,
		// 17 per pellet, 102 if all six land at point blank — a full bar,
		// one blast. The cone is the range: no damage falloff, the spread
		// already is the miss.
		damage: 17,
		speed: 900,
		pellets: 6,
		spreadDeg: 10,
		// Five shells, TF2's slow shell-by-shell reload: a blast is precious,
		// and each shell takes *longer* than the 900ms between blasts — the
		// gun can never keep up with its own trigger, so an emptied shotgun
		// is a long silence. The rack from empty is the slowest shell.
		magazine: 5,
		reloadShellMs: 1200,
		reloadFirstShellMs: 1300,
	},
};

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
