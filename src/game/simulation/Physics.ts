/**
 * Deterministic gameplay simulation, shared verbatim by client and server.
 *
 * Nothing in here may touch a rendering engine, the DOM or wall-clock time:
 * given the same state, input and dt, both sides must produce bit-identical
 * results. That is what makes client-side prediction reconcile instead of
 * rubber-band — and it is why this directory survived a whole renderer swap
 * without a single edit.
 */

import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	pointInAnyPlatform,
	type Rect,
} from "./Arena.js";
import {
	type MovingBox,
	moveAndCollide,
	probeWall,
	type WallSide,
} from "./Collision.js";
import {
	copyMeleeState,
	createMeleeState,
	isCommitted,
	isStunned,
	type MeleeIntent,
	type MeleeState,
	tickMelee,
} from "./Melee.js";

export type { Rect } from "./Arena.js";
export {
	hasLineOfSight,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	penetrationDepth,
	platforms,
	playerBox,
	rectsOverlap,
	WORLD_BOTTOM,
	WORLD_LEFT,
	WORLD_RIGHT,
	WORLD_TOP,
} from "./Arena.js";
export type { WallSide } from "./Collision.js";
export type {
	MeleeAction,
	MeleeBody,
	MeleeIntent,
	MeleeMove,
	MeleeOutcome,
	MeleePhase,
	MeleeResult,
	MeleeState,
	MoveDef,
	Stance,
} from "./Melee.js";
/**
 * Melee is re-exported by name, never with `export *`.
 *
 * A star re-export silently resolves to nothing across the server's module
 * boundary: `server/physics.ts` re-exports this file, and everything listed
 * explicitly arrives while everything behind an `export *` vanishes — no
 * resolution error, just an empty namespace and a server that dies on boot with
 * "does not provide an export named 'applyMeleeResult'". Same family as the
 * default-export trap in EnemyBrain: anything `server/` reaches through must be
 * an explicit named export.
 */
export {
	applyMeleeResult,
	BACKSTAB_BONUS_STUN_MS,
	BLOCK_PUSHBACK,
	BLOCK_STARTUP_MS,
	bodyRect,
	copyMeleeState,
	createMeleeState,
	GUARD_BREAK_STUN_MS,
	isBehind,
	isCancellable,
	isCommitted,
	isStunned,
	MASSIVE_CHARGE_MS,
	MELEE_IFRAME_MS,
	MOVES,
	meleeHitbox,
	meleePhase,
	moveDuration,
	PARRY_WINDOW_MS,
	resolveMelee,
	SLASH_CANCELLED_MS,
	tickMelee,
} from "./Melee.js";

/** @deprecated use `Rect` — kept so existing imports keep compiling. */
export type Platform = Rect;

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
/** Peak rise of a full jump: v² / 2g = 136px. */
export const JUMP_HEIGHT_PX = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
/** Releasing jump mid-rise cuts the arc, giving analogue jump height. */
export const JUMP_CUT_MULTIPLIER = 0.45;
/** Grace period to still jump just after walking off a ledge. */
export const COYOTE_TIME_MS = 100;
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

export const BULLET_SPEED = 600;
export const BULLET_DAMAGE = 10;
export const ATTACK_COOLDOWN = 250;

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export interface PlayerIntent extends MeleeIntent {
	left: boolean;
	right: boolean;
	/** Jump, held. Held-ness drives variable jump height, so pass the raw key state. */
	up: boolean;
}

/** Everything false: neutral input, and what a stunned fighter is reduced to. */
export const NEUTRAL_INTENT: Readonly<PlayerIntent> = Object.freeze({
	left: false,
	right: false,
	up: false,
	attack: false,
	block: false,
	uppercut: false,
	swordStance: true,
	face: 0,
});

export interface PlayerPosition extends MeleeState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
	/** Which side of the player a wall is on — the side a wall jump pushes away from. */
	wallTouch: WallSide;
	/** ms of steering lockout remaining after a wall jump. */
	wallJumpTimer: number;
	/** ms of ledge-forgiveness remaining. */
	coyoteTimer: number;
	/** ms remaining on a jump press that has not been consumed yet. */
	jumpBufferTimer: number;
	/** ms of wall-contact forgiveness remaining. */
	wallCoyoteTimer: number;
	/** Mid-rise of a jump that can still be cut short by releasing the button. */
	jumping: boolean;
	/** Jump button state last tick, for press-edge detection. */
	jumpHeld: boolean;
}

export function createPlayerState(
	x: number,
	y: number,
	facing = 1,
): PlayerPosition {
	return {
		x,
		y,
		vx: 0,
		vy: 0,
		grounded: false,
		wallTouch: "none",
		wallJumpTimer: 0,
		coyoteTimer: 0,
		jumpBufferTimer: 0,
		wallCoyoteTimer: 0,
		jumping: false,
		jumpHeld: false,
		...createMeleeState(facing),
	};
}

/** Copy state into `target` without reallocating — used on the netcode hot path. */
export function copyPlayerState(
	source: PlayerPosition,
	target: PlayerPosition,
): PlayerPosition {
	target.x = source.x;
	target.y = source.y;
	target.vx = source.vx;
	target.vy = source.vy;
	target.grounded = source.grounded;
	target.wallTouch = source.wallTouch;
	target.wallJumpTimer = source.wallJumpTimer;
	target.coyoteTimer = source.coyoteTimer;
	target.jumpBufferTimer = source.jumpBufferTimer;
	target.wallCoyoteTimer = source.wallCoyoteTimer;
	target.jumping = source.jumping;
	target.jumpHeld = source.jumpHeld;
	copyMeleeState(source, target);
	return target;
}

/** Move `value` toward `target` by at most `maxDelta`. */
function approach(value: number, target: number, maxDelta: number): number {
	if (value < target) return Math.min(value + maxDelta, target);
	if (value > target) return Math.max(value - maxDelta, target);
	return target;
}

function decay(timerMs: number, dt: number): number {
	return Math.max(0, timerMs - dt * 1000);
}

/**
 * Advance one player by exactly `dt` seconds. Pure: returns new state.
 *
 * Order matters — melee, then timers, then intent, then jump, then gravity, then
 * a single collision-resolved move. Resolving movement exactly once per tick is
 * what keeps contact flags and positions consistent between client and server.
 *
 * Melee runs first because it decides whether this fighter is allowed to act at
 * all. Stun and launch live in this same state and replay through
 * reconciliation like any other physics — that is the whole reason combat state
 * is here rather than in a system beside it.
 */
export function tickPlayer(
	pos: PlayerPosition,
	input: PlayerIntent,
	dt: number,
): PlayerPosition {
	const s: PlayerPosition = { ...pos };

	tickMelee(s, input, dt);
	// A stunned fighter still falls and still collides; it just does not steer.
	const stunned = isStunned(s);
	// Heavy moves root you where you stand. This is the "animation punishment":
	// a whiffed Massive or uppercut cannot be walked or jumped out of.
	const rooted = stunned || isCommitted(s);

	s.wallJumpTimer = decay(s.wallJumpTimer, dt);
	s.coyoteTimer = decay(s.coyoteTimer, dt);
	s.jumpBufferTimer = decay(s.jumpBufferTimer, dt);
	s.wallCoyoteTimer = decay(s.wallCoyoteTimer, dt);

	const wantsJump = input.up && !rooted;
	if (wantsJump && !s.jumpHeld) {
		s.jumpBufferTimer = JUMP_BUFFER_MS;
	}

	// ---- horizontal intent ----
	const dir = rooted ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);

	// Facing follows aim, falling back to the walk direction when nothing is
	// aimed. Steering it separately from movement is what lets a fighter back
	// away while still guarding the side the attacker is on.
	//
	// It is locked while a move is running: committing to a direction is the
	// point of committing to a swing, and a hitbox that could be steered during
	// its active frames would make blocking unreadable.
	const faceWish = input.face !== 0 ? (input.face > 0 ? 1 : -1) : dir;
	if (s.meleeAction === "none" && !stunned && faceWish !== 0) {
		s.facing = faceWish;
	}

	const targetSpeed =
		PLAYER_WALK_SPEED * (s.blocking ? BLOCK_MOVE_MULTIPLIER : 1);
	const steerable = s.wallJumpTimer <= 0;
	if (steerable && dir !== 0) {
		const accel = s.grounded ? GROUND_ACCEL : AIR_ACCEL;
		s.vx = approach(s.vx, dir * targetSpeed, accel * dt);
	} else {
		// Full ground friction would eat a knockback in two frames and no shove
		// would ever be visible. A stunned fighter slides.
		const groundFriction = stunned ? STUN_GROUND_FRICTION : GROUND_FRICTION;
		const friction = s.grounded ? groundFriction : AIR_FRICTION;
		s.vx = approach(s.vx, 0, friction * dt);
	}

	// ---- jump (ground jump wins over wall jump) ----
	if (s.jumpBufferTimer > 0) {
		if (s.grounded || s.coyoteTimer > 0) {
			s.vy = JUMP_VELOCITY;
			s.grounded = false;
			s.coyoteTimer = 0;
			s.jumpBufferTimer = 0;
			s.jumping = true;
		} else if (s.wallTouch !== "none" && s.wallJumpTimer <= 0) {
			const away = s.wallTouch === "left" ? 1 : -1;
			s.vx = away * WALL_JUMP_HORIZONTAL;
			s.vy = WALL_JUMP_VERTICAL;
			s.wallTouch = "none";
			s.wallCoyoteTimer = 0;
			s.wallJumpTimer = WALL_JUMP_LOCKOUT;
			s.jumpBufferTimer = 0;
			s.jumping = true;
		}
	}

	// ---- variable jump height ----
	if (s.jumping && !wantsJump && s.vy < 0) {
		s.vy *= JUMP_CUT_MULTIPLIER;
		s.jumping = false;
	}
	if (s.vy >= 0) s.jumping = false;

	// ---- gravity ----
	s.vy += (s.vy > 0 ? GRAVITY * FALL_GRAVITY_MULTIPLIER : GRAVITY) * dt;

	const pressingIntoWall =
		(dir < 0 && s.wallTouch === "left") || (dir > 0 && s.wallTouch === "right");
	if (!s.grounded && pressingIntoWall && s.vy > WALL_SLIDE_SPEED) {
		s.vy = WALL_SLIDE_SPEED;
	}
	if (s.vy > MAX_FALL_SPEED) s.vy = MAX_FALL_SPEED;

	// ---- one collision-resolved move ----
	const box: MovingBox = { x: s.x, y: s.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
	const contacts = moveAndCollide(box, s.vx * dt, s.vy * dt);
	s.x = box.x;
	s.y = box.y;

	if (contacts.wall !== "none") s.vx = 0;
	if (contacts.grounded) s.vy = 0;
	if (contacts.ceiling && s.vy < 0) s.vy = 0;

	s.grounded = contacts.grounded;
	if (s.grounded) {
		s.coyoteTimer = COYOTE_TIME_MS;
		s.jumping = false;
	}

	const wall = contacts.wall !== "none" ? contacts.wall : probeWall(box);
	if (wall !== "none") {
		s.wallTouch = wall;
		s.wallCoyoteTimer = WALL_COYOTE_MS;
	} else if (s.wallCoyoteTimer <= 0) {
		s.wallTouch = "none";
	}

	// Latch the intent that was actually allowed, not the raw button. A fighter
	// who held jump through a stun must press again afterwards rather than
	// launching the instant control returns.
	s.jumpHeld = wantsJump;
	return s;
}

export function canFire(lastAttackTime: number, now: number): boolean {
	return now - lastAttackTime >= ATTACK_COOLDOWN;
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

export interface BulletState {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export function tickBullet(b: BulletState, dt: number): void {
	b.x += b.vx * dt;
	b.y += b.vy * dt;
}

export function isBulletOutOfBounds(b: BulletState): boolean {
	return b.x < -50 || b.x > 850 || b.y < -50 || b.y > 650;
}

export function bulletHitsPlayer(
	b: BulletState,
	px: number,
	py: number,
): boolean {
	const margin = 12;
	return (
		b.x > px - margin &&
		b.x < px + PLAYER_WIDTH + margin &&
		b.y > py - margin &&
		b.y < py + PLAYER_HEIGHT + margin
	);
}

export function bulletHitsPlatform(b: BulletState): boolean {
	return pointInAnyPlatform(b.x, b.y);
}
