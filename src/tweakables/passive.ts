/**
 * Hero passives: Ibiriki's Bloodlust and Berserk. See specs/ibiriki.md.
 *
 * The bloodlust is the server's reading of the room's bleeding prey: each
 * hostile's HP maps to a lure, and its distance scales that lure down. The
 * strongest single lure wins, mapped to 0..1 and carried in
 * `PlayerPosition.bloodlust` so both sides simulate the speed it buys.
 */

/** A foe's HP fraction at which its bloodlust lure starts: 90%. */
export const BLOODLUST_START_FRACTION = 0.9;

/**
 * The HP fraction at which a foe's lure is full — the **berserk** line: 30%.
 * Below this a nearby foe can fill the meter and Ibiriki dual wields; a foe
 * this hurt but far away only smells faintly.
 */
export const BERSERK_FRACTION = 0.3;

/**
 * Inside this distance (centre to centre, world px) a foe's lure is at full
 * strength. A screen is 800px wide and melee reach is around 50px, so 300px is
 * a committed exchange — close enough to smell the blood.
 */
export const BLOODLUST_FULL_RANGE_PX = 300;

/**
 * A foe this far away contributes nothing. One and a half screens: far enough
 * that a cross-map chase earns some speed, close enough that a bleeding
 * stranger on the other end of a wide arena is not a permanent buff. The
 * falloff between the two ranges is linear.
 */
export const BLOODLUST_ZERO_RANGE_PX = 1200;

/**
 * Once **berserk**, a low foe keeps the frenzy alive out to this distance.
 * The 100px beyond the start range is hysteresis: a foe knocked just out of
 * reach must not flicker the forced melee stance off and on every tick.
 */
export const BERSERK_HOLD_RANGE_PX = 400;

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

/**
 * The frenzy's clock with **no axe in hand**: half speed. Out of axes a
 * berserk Ibiriki swings the sword alone — the same chain, half as fast,
 * which with the bloodlust haste on top is still faster than a hew.
 */
export const BERSERK_EMPTY_HANDED_HASTE = 0.5;
