/**
 * Movement tuning: gravity, the jump curve, walking, dashes, tumbles and
 * wall play. **The jump numbers are load-bearing** — every ledge in
 * `src/game/simulation/Arena.ts` sits within `JUMP_HEIGHT_PX` of the surface
 * below it, so changing gravity or the jump velocity changes level
 * reachability and retunes the uppercut's launch, which is derived from the
 * jump. Tune, then re-check the arena and the melee tests.
 */

// ---------------------------------------------------------------------------
// Movement tuning
//
// The curve is built jump-first: pick the height a jump must clear, then solve
// for the velocity. Every ledge in Arena.ts sits within JUMP_HEIGHT_PX of the
// surface below it, so changing these constants changes level reachability —
// re-check Arena.ts if you touch them.
// ---------------------------------------------------------------------------

export const GRAVITY = 1800;

/** Falling is heavier than rising: the classic platformer "snap". */
export const FALL_GRAVITY_MULTIPLIER = 1.35;

export const MAX_FALL_SPEED = 950;

export const JUMP_VELOCITY = -700;

/** Releasing jump mid-rise cuts the arc, giving analogue jump height. */
export const JUMP_CUT_MULTIPLIER = 0.45;

/** Grace period to still jump just after walking off a ledge. */
export const COYOTE_TIME_MS = 100;

/**
 * Jumps available *after* leaving the ground. One, so a double jump.
 *
 * Refilled by landing and by nothing else — in particular **not by a wall jump**,
 * or a fighter could alternate the two up a single wall forever.
 */
export const AIR_JUMPS = 1;

/**
 * The second jump is deliberately weaker than the first (89% of the launch, so
 * ~108px against 136px).
 *
 * Equal jumps would make the ground jump pointless to time — you would simply
 * always have two of them. Making the airborne one shorter keeps the decision
 * interesting: spend it to reach, or save it to recover.
 */
export const AIR_JUMP_VELOCITY = -620;

/** Grace period for a jump pressed just before landing. */
export const JUMP_BUFFER_MS = 120;

export const PLAYER_WALK_SPEED = 220;

export const GROUND_ACCEL = 2600;

export const AIR_ACCEL = 1800;

export const GROUND_FRICTION = 2600;

export const AIR_FRICTION = 500;

/**
 * Ground friction while stunned. Normal friction kills a knockback impulse in
 * two frames, so no shove would ever be visible: a Massive Strike's 420 px/s
 * would move the target 34px at 2600, versus 73px here. Being hit hard should
 * look like being hit hard.
 */
export const STUN_GROUND_FRICTION = 1200;

export const WALL_SLIDE_SPEED = 160;

export const WALL_JUMP_HORIZONTAL = 230;

export const WALL_JUMP_VERTICAL = -640;

/**
 * Steering is ignored for this long after a wall jump so the launch actually
 * carries you off the wall. Long lockouts feel like losing the controller, and
 * too much horizontal push makes a wall unclimbable — keep both modest so
 * repeated wall jumps can gain height on a single flat wall.
 */
export const WALL_JUMP_LOCKOUT = 140;

/** Wall contact lingers briefly so a wall jump does not need frame-perfect timing. */
export const WALL_COYOTE_MS = 100;

/**
 * Walking while blocking. A guard you can carry at full speed is a guard with no
 * cost, and it would make circling behind a blocker — the intended answer to a
 * turtle — impossible to actually perform.
 */
export const BLOCK_MOVE_MULTIPLIER = 0.55;

/**
 * Tumble impulse — the gun's answer to the dash, deliberately slower.
 *
 * The double-tap gesture is the *same* in both stances; the stance already on
 * the simulation decides whether it is a dash or a tumble. GunZ's own
 * asymmetry: the sword's dash is faster, so a sword fighter can always close
 * the gap a rolling gunner opens. 720 against the dash's 1000 is ~76% — a
 * burst, not a cruise, but one a chaser can run down.
 */
export const TUMBLE_SPEED = 720;

/**
 * A tumble is harder to chain than a dash. The roll is a repositioning tool —
 * it buys the gunner a beat to shoot, and the bigger cooldown is the beat the
 * sword gets to close. Longer than `DASH_LOCKOUT_MS` on purpose.
 */
export const TUMBLE_LOCKOUT_MS = 450;

/**
 * How long the roll travels. Shorter than its lockout (like the dash), and
 * longer than the dash's line so the two bursts cover similar ground at very
 * different speeds and rhythms.
 *
 * Also the length of one full spin of the roll animation: the `roll` strip is
 * eight frames at 25fps (see `CLIPS` in `ecs/systems.ts`), so a roll that
 * ended sooner would pop the fighter upright mid-somersault.
 */
export const TUMBLE_DURATION_MS = 320;

/**
 * Collision height while rolling — GunZ's "sprawled almost parallel to the
 * ground". The box is pinned to the feet, so a rolling fighter is a shorter
 * target and shots aimed at a standing fighter's upper body pass overhead.
 *
 * It is a strict *subset* of the standing box: every solid the roll box
 * touches, the standing box touches too, so a roll can never open a path
 * through solids a standing fighter would collide with.
 */
export const TUMBLE_HEIGHT = 20;
