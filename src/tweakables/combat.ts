/**
 * The shared combat stat card: a fighter's health, the attack cooldown and
 * the bullet itself. Weapon-specific tuning lives in `ranged.ts`; the frame
 * data of the sword lives in `melee.ts`.
 */

/** A fighter's full health. The bar's denominator, and every spawn's starting HP. */
export const MAX_HP = 100;

export const ATTACK_COOLDOWN = 250;

export const BULLET_SPEED = 600;

export const BULLET_DAMAGE = 10;

/** A bullet past the world edge by this much is gone. */
export const BULLET_OOB_MARGIN_PX = 50;
