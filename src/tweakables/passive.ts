/**
 * Hero passives: Ibiriki's Bloodlust and Berserk. See specs/ibiriki.md.
 *
 * The bloodlust is the server's reading of the room's weakest hostile fighter,
 * mapped to 0..1 and carried in `PlayerPosition.bloodlust` so both sides
 * simulate the speed it buys.
 */

/** The weakest foe's HP fraction at which bloodlust starts: 90%. */
export const BLOODLUST_START_FRACTION = 0.9;

/**
 * The weakest foe's HP fraction at which bloodlust is full — and Ibiriki is
 * **berserk**: 30%. Below this the room is bleeding and he dual wields.
 */
export const BERSERK_FRACTION = 0.3;

/** Walk speed at full bloodlust: +35%. A predator closes the gap. */
export const BLOODLUST_MOVE_SPEED_BONUS = 0.35;

/**
 * Melee clock speed at full bloodlust: +30%. Every phase of every swing
 * shrinks together — startup, hitbox and recovery — so the moves keep their
 * shape and simply happen sooner.
 */
export const BLOODLUST_ATTACK_SPEED_BONUS = 0.3;

/**
 * Damage a berserk Ibiriki takes, as a fraction: 75%. The resistance is what
 * lets him stay in the fight he smelled.
 */
export const BERSERK_DAMAGE_TAKEN = 0.75;

/**
 * Bloodlust is quantised to this step on the server, so a snapshot carries a
 * short number and the client's speed matches the server's exactly.
 */
export const BLOODLUST_STEP = 0.01;
