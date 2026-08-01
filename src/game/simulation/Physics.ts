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
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	pointInAnyPlatform,
	type Rect,
	type World,
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
	meleePhase as meleePhaseOf,
	tickMelee,
} from "./Melee.js";

export type { Rect, SpawnPoint, World } from "./Arena.js";
export {
	applyWorld,
	buildWorld,
	DEFAULT_WORLD,
	hasLineOfSight,
	MAX_SCREENS,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	penetrationDepth,
	pickSpawn,
	platforms,
	playerBox,
	rectsOverlap,
	SCREEN_H,
	SCREEN_W,
	SPAWN_POINTS,
	WORLD_BOTTOM,
	WORLD_LEFT,
	WORLD_RIGHT,
	WORLD_TOP,
} from "./Arena.js";
export type { WallSide } from "./Collision.js";
export type {
	ComboSlash,
	MeleeAction,
	MeleeBody,
	MeleeIntent,
	MeleeMove,
	MeleeOutcome,
	MeleePhase,
	MeleeResult,
	MeleeState,
	MeleeTickState,
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
	blocksBullet,
	bodyRect,
	COMBO_CHAIN,
	COMBO_LINK_MS,
	copyMeleeState,
	createMeleeState,
	GUARD_BREAK_STUN_MS,
	isBehind,
	isCancellable,
	isComboSlash,
	isCommitted,
	isKnockedDown,
	isStunned,
	KNOCKDOWN_MS,
	KNOCKDOWN_SLAM_VY,
	MASSIVE_CHARGE_MS,
	MELEE_IFRAME_MS,
	MELEE_MOVES,
	MOVES,
	meleeHitbox,
	meleePhase,
	moveDuration,
	PARRY_WINDOW_MS,
	resolveMelee,
	SLASH_CANCELLED_MS,
	tickMelee,
	zeroMoveCounts,
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

/** Dash impulse. An impulse on the shared simulation, not a movement mode. */
export const DASH_SPEED = 1000;
/** Minimum gap between dashes, so it cannot be held down as a speed boost. */
export const DASH_LOCKOUT_MS = 250;
/**
 * How long a dash holds its line — no gravity, no vertical drift at all.
 *
 * A dash that fell while it travelled was a dive, and it made the one thing a
 * dash is for — crossing a gap, breaking away, repositioning at the peak of a
 * jump — depend on how far through the arc you happened to be. Holding Y makes it
 * a *line*, which is what a player is aiming when they gesture it.
 *
 * **Deliberately shorter than `DASH_LOCKOUT_MS`.** The gap between the two is the
 * window in which gravity always gets a say, so no amount of dashing is level
 * flight: at 160 against a 250ms lockout, a chained dasher still falls for 90ms in
 * every 250. Raise this past the lockout and the fighter simply never comes down.
 */
export const DASH_DURATION_MS = 160;

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
	dash: 0,
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
	/**
	 * Jumps left before touching the ground again. See `AIR_JUMPS`.
	 *
	 * A count rather than a flag, so the number is a tuning constant instead of a
	 * shape change.
	 */
	airJumps: number;
	/** ms until another dash is allowed. */
	dashTimer: number;
	/**
	 * ms of dash still travelling. While non-zero the fighter ignores gravity and
	 * holds its Y exactly — see `DASH_DURATION_MS`.
	 *
	 * Separate from `dashTimer`, which is the cooldown. Conflating them would tie
	 * how long a dash flies to how often one may be thrown, and the two want
	 * different numbers for opposite reasons.
	 */
	dashActiveTimer: number;
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
		airJumps: AIR_JUMPS,
		dashTimer: 0,
		dashActiveTimer: 0,
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
	target.airJumps = source.airJumps;
	target.dashTimer = source.dashTimer;
	target.dashActiveTimer = source.dashActiveTimer;
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
 *
 * `world` names the room's geometry; it defaults to the single-screen arena so
 * callers that do not know about rooms (tests included) stay unchanged. The
 * server and the predicting client pass their room's `World`, and because it
 * is the same deterministic geometry on both sides, prediction stays
 * bit-identical.
 */
export function tickPlayer(
	pos: PlayerPosition,
	input: PlayerIntent,
	dt: number,
	world: World = DEFAULT_WORLD,
): PlayerPosition {
	const s: PlayerPosition = { ...pos };

	tickMelee(s, input, dt);
	// A stunned fighter still falls and still collides; it just does not steer.
	const stunned = isStunned(s);
	// Heavy moves root you where you stand. This is the "animation punishment":
	// a whiffed Massive or uppercut cannot be walked or jumped out of.
	const rooted = stunned || isCommitted(s);

	s.wallJumpTimer = decay(s.wallJumpTimer, dt);
	s.dashTimer = decay(s.dashTimer, dt);
	s.dashActiveTimer = decay(s.dashActiveTimer, dt);
	// Being hit ends a dash.
	//
	// Not politeness: a dash suppresses gravity and pins `vy` to zero, so a launch
	// applied between ticks — the uppercut's whole point — would be silently eaten
	// by the next one. Every launch arrives with stun, which makes this the one
	// place that has to notice.
	if (stunned) s.dashActiveTimer = 0;
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
	// The lock covers a swing's startup and active frames only — the window in
	// which the direction is a promise. Steering a live hitbox would make blocking
	// unreadable, and turning during the wind-up would erase the tell the
	// defender reads. Recovery has no hitbox and no tell left to give, so the
	// pointer takes the fighter back: locking it too meant a player holding the
	// attack button chained slashes and went 332ms at a time without obeying the
	// cursor, which is what "the game struggles to follow the mouse" was.
	const phase = meleePhaseOf(s);
	const committed = phase === "startup" || phase === "active";
	const faceWish = input.face !== 0 ? (input.face > 0 ? 1 : -1) : dir;
	if (!committed && !stunned && faceWish !== 0) {
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

	// ---- dash ----
	// An impulse on the shared simulation, not a separate movement path: it sets
	// velocity and then ordinary physics and collision carry it.
	if (!rooted && input.dash !== 0 && s.dashTimer <= 0) {
		s.vx = input.dash > 0 ? DASH_SPEED : -DASH_SPEED;
		s.dashTimer = DASH_LOCKOUT_MS;
		s.dashActiveTimer = DASH_DURATION_MS;
		// Flatten the arc from the first frame, so a dash thrown while rising or
		// falling travels the same line as one thrown standing still.
		s.vy = 0;
		// No longer a jump that can be cut short by releasing the button.
		s.jumping = false;
	}

	// ---- jump (ground jump wins over wall jump) ----
	if (s.jumpBufferTimer > 0) {
		if (s.grounded || s.coyoteTimer > 0) {
			s.vy = JUMP_VELOCITY;
			s.grounded = false;
			s.coyoteTimer = 0;
			s.jumpBufferTimer = 0;
			s.jumping = true;
			// A jump out of a dash ends the dash. Any vertical velocity set here would
			// otherwise be zeroed by the dash's own flat line, and the jump would
			// simply not happen.
			s.dashActiveTimer = 0;
		} else if (s.wallTouch !== "none" && s.wallJumpTimer <= 0) {
			const away = s.wallTouch === "left" ? 1 : -1;
			s.vx = away * WALL_JUMP_HORIZONTAL;
			s.vy = WALL_JUMP_VERTICAL;
			s.wallTouch = "none";
			s.wallCoyoteTimer = 0;
			s.wallJumpTimer = WALL_JUMP_LOCKOUT;
			s.jumpBufferTimer = 0;
			s.jumping = true;
			s.dashActiveTimer = 0;
			// Deliberately does *not* refill `airJumps`: a fighter that regained its
			// air jump from a wall could alternate the two up a single flat wall
			// forever. Landing is the only refill.
		} else if (s.airJumps > 0) {
			// The double jump. Last in the chain on purpose — a ground jump and a wall
			// jump are both better, so neither should ever spend this by accident.
			s.airJumps--;
			s.vy = AIR_JUMP_VELOCITY;
			s.jumpBufferTimer = 0;
			s.jumping = true;
			s.dashActiveTimer = 0;
		}
	}

	// ---- variable jump height ----
	if (s.jumping && !wantsJump && s.vy < 0) {
		s.vy *= JUMP_CUT_MULTIPLIER;
		s.jumping = false;
	}
	if (s.vy >= 0) s.jumping = false;

	// ---- gravity, unless an airborne dash is holding its line ----
	//
	// An air dash is horizontal. Not "mostly horizontal": `vy` is pinned to zero so
	// the fighter ends the dash at exactly the Y it started, which is what makes the
	// gesture aimable — the same input crosses the same gap whether it was thrown
	// rising, falling, or at the peak of a jump.
	//
	// **Grounded dashes keep gravity**, and must. Gravity does nothing visible to a
	// fighter standing on a floor, but it is what presses it *into* the floor — and
	// contact is what `grounded` is derived from. Suppressing it made a ground dash
	// leave the fighter airborne on paper: it could not jump, and coyote time never
	// started because it never registered as having been grounded to begin with.
	if (s.dashActiveTimer > 0 && !s.grounded) {
		s.vy = 0;
	} else {
		s.vy += (s.vy > 0 ? GRAVITY * FALL_GRAVITY_MULTIPLIER : GRAVITY) * dt;

		const pressingIntoWall =
			(dir < 0 && s.wallTouch === "left") ||
			(dir > 0 && s.wallTouch === "right");
		if (!s.grounded && pressingIntoWall && s.vy > WALL_SLIDE_SPEED) {
			s.vy = WALL_SLIDE_SPEED;
		}
		if (s.vy > MAX_FALL_SPEED) s.vy = MAX_FALL_SPEED;
	}

	// ---- one collision-resolved move ----
	const box: MovingBox = { x: s.x, y: s.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
	const contacts = moveAndCollide(box, s.vx * dt, s.vy * dt, world);
	s.x = box.x;
	s.y = box.y;

	// A dash into a wall is over. Letting the timer run out would leave the fighter
	// hovering against the wall with nothing left pushing it.
	if (contacts.wall !== "none") {
		s.vx = 0;
		s.dashActiveTimer = 0;
	}
	if (contacts.grounded) s.vy = 0;
	if (contacts.ceiling && s.vy < 0) s.vy = 0;

	s.grounded = contacts.grounded;
	if (s.grounded) {
		s.coyoteTimer = COYOTE_TIME_MS;
		s.jumping = false;
		// Landing is the only thing that gives the air jump back.
		s.airJumps = AIR_JUMPS;
	}

	const wall =
		contacts.wall !== "none" ? contacts.wall : probeWall(box, 2, world);
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

export function isBulletOutOfBounds(
	b: BulletState,
	world: World = DEFAULT_WORLD,
): boolean {
	// A 50px margin is the original one-screen tolerance; it scales with the
	// world so a wide room's bullets are judged against the room's walls.
	return (
		b.x < world.left - 50 ||
		b.x > world.right + 50 ||
		b.y < world.top - 50 ||
		b.y > world.bottom + 50
	);
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

export function bulletHitsPlatform(
	b: BulletState,
	world: World = DEFAULT_WORLD,
): boolean {
	return pointInAnyPlatform(b.x, b.y, world);
}
