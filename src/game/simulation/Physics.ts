/**
 * Deterministic gameplay simulation, shared verbatim by client and server.
 *
 * Nothing in here may touch Phaser, the DOM or wall-clock time: given the same
 * state, input and dt, both sides must produce bit-identical results. That is
 * what makes client-side prediction reconcile instead of rubber-band.
 */

import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	pointInAnyPlatform,
	type Rect,
} from "./Arena";
import {
	type MovingBox,
	moveAndCollide,
	probeWall,
	type WallSide,
} from "./Collision";

export type { Rect } from "./Arena";
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
} from "./Arena";
export type { WallSide } from "./Collision";

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

export const BULLET_SPEED = 600;
export const BULLET_DAMAGE = 10;
export const ATTACK_COOLDOWN = 250;

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export interface PlayerIntent {
	left: boolean;
	right: boolean;
	/** Jump, held. Held-ness drives variable jump height, so pass the raw key state. */
	up: boolean;
}

export interface PlayerPosition {
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

export function createPlayerState(x: number, y: number): PlayerPosition {
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
 * Order matters — timers, then intent, then jump, then gravity, then a single
 * collision-resolved move. Resolving movement exactly once per tick is what
 * keeps contact flags and positions consistent between client and server.
 */
export function tickPlayer(
	pos: PlayerPosition,
	input: PlayerIntent,
	dt: number,
): PlayerPosition {
	const s: PlayerPosition = { ...pos };

	s.wallJumpTimer = decay(s.wallJumpTimer, dt);
	s.coyoteTimer = decay(s.coyoteTimer, dt);
	s.jumpBufferTimer = decay(s.jumpBufferTimer, dt);
	s.wallCoyoteTimer = decay(s.wallCoyoteTimer, dt);

	if (input.up && !s.jumpHeld) {
		s.jumpBufferTimer = JUMP_BUFFER_MS;
	}

	// ---- horizontal intent ----
	const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
	const steerable = s.wallJumpTimer <= 0;
	if (steerable && dir !== 0) {
		const accel = s.grounded ? GROUND_ACCEL : AIR_ACCEL;
		s.vx = approach(s.vx, dir * PLAYER_WALK_SPEED, accel * dt);
	} else {
		const friction = s.grounded ? GROUND_FRICTION : AIR_FRICTION;
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
	if (s.jumping && !input.up && s.vy < 0) {
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

	s.jumpHeld = input.up;
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
