/**
 * The ranged weapons' stat cards: the rifle (Lia), the machine gun (Anands)
 * and the shotgun (Jeffs). Each card is cooldown, damage, speed, the
 * shotgun's pellet fan, and the magazine + reload every gun now carries.
 */

export type RangedWeaponId = "rifle" | "machinegun" | "shotgun";

/** Degrees per π radians: `deg * Math.PI / DEGREES_PER_PI_RADIANS` → radians. */
export const DEGREES_PER_PI_RADIANS = 180;
/** A pellet is drawn at this fraction of a full bullet's size. */
export const PELLET_SCALE = 0.55;
/** And at this opacity — the fan reads as distinct shots, not one blob. */
export const PELLET_ALPHA = 0.9;

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
 * Ammo is **finite per life**: every fighter spawns with `magazinesPerLife`
 * magazines — one loaded, the rest a reserve measured in rounds. There is no
 * pick-up and no manual reload key (R is the ultimate); when the last round
 * is spent the gun is **dry** until the next life. The reload is auto — no
 * manual key — and the magazine plus the reserve together are the economy,
 * which is what forces the fight back to the sword.
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
	/**
	 * Distance damage falloff, in px from the muzzle. A round that lands
	 * `falloffStartPx` or closer deals the full `damage`; between
	 * `falloffStartPx` and `falloffEndPx` the damage scales linearly down to
	 * `minDamage`; beyond `falloffEndPx` it is flat `minDamage`. Absent means
	 * no falloff — a rifle round's 10 at any range. This is the second half of
	 * a shotgun's range (the cone is the first): every real shotgun loses
	 * punch as it travels — TF2's scattergun falls from 175% to 52.8% over
	 * distance, Reaper's hellfire to ~30% — and without it the cone alone
	 * leaves all six pellets on a 32px body at a hundred px, which was a
	 * one-shot at a range the weapon had no business killing from.
	 */
	falloffStartPx?: number;
	/** The distance at which the pellet's damage stops shrinking. */
	falloffEndPx?: number;
	/** The floor per round, at and beyond `falloffEndPx`. */
	minDamage?: number;
	/** Rounds per magazine. The reload fills exactly this many. */
	magazine: number;
	/**
	 * Magazines carried per life (the deathmatch "round" is a life). One is
	 * loaded at spawn; the rest form the reserve the reload draws from. When
	 * the reserve and the magazine are both empty the gun is dry until the
	 * next life — this is the lever that forces the fight back to melee.
	 * All three weapons ship at 4; tune per weapon, not globally.
	 */
	magazinesPerLife: number;
	/**
	 * ms to load **one** round from the reserve into the magazine. Every
	 * weapon reloads per bullet (the Valve/CS model), never a whole magazine
	 * at once: a reload moves a single round per cycle, so a partial reload
	 * costs only the rounds it moves, an interruption loses only the round
	 * being loaded (the rounds already in stay), and an empty magazine under
	 * a held trigger fires each round the moment it lands.
	 */
	reloadRoundMs: number;
	/**
	 * The round that loads from an empty magazine — the first — is slower
	 * than the rounds that follow it, TF2's ~0.9s first shell against the
	 * 0.51s consecutive ones. Absent, `reloadRoundMs` applies to every round.
	 */
	reloadFirstRoundMs?: number;
}
export const RANGED_WEAPONS: Record<RangedWeaponId, RangedWeaponDef> = {
	rifle: {
		id: "rifle",
		label: "RIFLE",
		// The semi-automatic rifle: a clean single shot per press, a small
		// magazine, and the fastest reload in the game — the rifle's whole
		// character is that its pause is short. Per bullet, so a one-round
		// top-up costs almost nothing; an empty-to-full rack is ~0.9s.
		cooldownMs: 250,
		damage: 10,
		speed: 600,
		magazine: 12,
		magazinesPerLife: 4,
		reloadRoundMs: 70,
		reloadFirstRoundMs: 120,
	},
	machinegun: {
		id: "machinegun",
		label: "MACHINE GUN",
		// Four shots where the rifle fires one. The dagger is the lightest
		// weapon in the game and its ranged answer is a stream, not a poke —
		// lower per-shot damage so the stream does not out-kill the rifle by
		// double, faster bullets so a stream can actually be landed. A decent
		// magazine and a per-bullet reload: a burst is long enough to matter,
		// and refilling the whole rack (~1.9s) is long enough to punish.
		cooldownMs: 110,
		damage: 5,
		speed: 780,
		magazine: 30,
		magazinesPerLife: 4,
		reloadRoundMs: 60,
		reloadFirstRoundMs: 120,
	},
	shotgun: {
		id: "shotgun",
		label: "SHOTGUN",
		// The delay is the whole weapon: nearly four rifle shots between
		// blasts is the window a miss gives the room. A shotgun is a
		// commitment, like the Massive — fire when you are sure, or pay.
		cooldownMs: 900,
		// 17 per pellet, 102 if all six land at point blank — a full bar,
		// one blast. And then the range: the cone is wide enough that the
		// edge pellets leave a 32px body around a hundred px out, and the
		// falloff cuts each pellet's punch from that point on — by 100px the
		// blast is a half-bar, by 140px a third, by 200px a warning shot. A
		// shotgun that killed at a hundred px was the rifle with a cone.
		damage: 17,
		speed: 900,
		pellets: 6,
		spreadDeg: 16,
		falloffStartPx: 60,
		falloffEndPx: 200,
		minDamage: 3,
		// Five shells, TF2's slow shell-by-shell reload: a blast is precious,
		// and each shell takes *longer* than the 900ms between blasts — the
		// gun can never keep up with its own trigger, so an emptied shotgun
		// is a long silence. The rack from empty is the slowest shell.
		magazine: 5,
		magazinesPerLife: 4,
		reloadRoundMs: 1200,
		reloadFirstRoundMs: 1300,
	},
};

/**
 * The damage one round deals, read at the distance it has travelled from the
 * muzzle.
 *
 * A weapon without a falloff deals its flat card `damage` at any range; a
 * weapon with one (the shotgun) deals the full amount up to `falloffStartPx`,
 * then slides linearly down to `minDamage` by `falloffEndPx` and holds it. The
 * rounding keeps HP whole numbers the way every other damage value in the game
 * is. This is the one function both the server's `tickBullets` and the offline
 * escape hatch's `bulletTargets` call, so a pellet that lands at range hurts
 * exactly the same with a server in the room as without one.
 */
export function pelletDamageAt(
	weapon: Pick<
		RangedWeaponDef,
		"damage" | "falloffStartPx" | "falloffEndPx" | "minDamage"
	>,
	distancePx: number,
): number {
	if (
		weapon.falloffStartPx === undefined ||
		weapon.falloffEndPx === undefined
	) {
		return weapon.damage;
	}
	const floor = weapon.minDamage ?? weapon.damage;
	if (distancePx <= weapon.falloffStartPx) return weapon.damage;
	if (distancePx >= weapon.falloffEndPx) return floor;
	const t =
		(distancePx - weapon.falloffStartPx) /
		(weapon.falloffEndPx - weapon.falloffStartPx);
	return Math.round(weapon.damage + (floor - weapon.damage) * t);
}
