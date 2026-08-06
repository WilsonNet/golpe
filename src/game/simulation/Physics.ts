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
import { type HeroKit, LIA_KIT } from "./Heroes.js";
import { TRAP_TRIGGER_MS, type Trap, trapCatches } from "./Items.js";
import {
	bombBlastFor,
	bombFallHeight,
	copyMeleeState,
	createMeleeState,
	isCharging,
	isCommitted,
	isStunned,
	type MeleeIntent,
	type MeleeState,
	MOVES,
	meleePhase as meleePhaseOf,
	PLUNGE_DECEL,
	PLUNGE_SPEED,
	tickMelee,
} from "./Melee.js";
import {
	SINGULARITY_HOLD_STUN_MS,
	type Singularity,
	singularityGrip,
	singularityPull,
} from "./Ultimate.js";

export type { World } from "./Arena.js";
export {
	DEFAULT_WORLD,
	hasLineOfSight,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	penetrationDepth,
	rectsOverlap,
} from "./Arena.js";
export type { WallSide } from "./Collision.js";
export type { HeroId, HeroKit } from "./Heroes.js";
/**
 * The hero registry, re-exported by name for the server's benefit — same
 * default/star rules as the melee and ultimate blocks above.
 */
export {
	DEFAULT_HERO,
	HERO_IDS,
	isHeroId,
	kitFor,
	LIA_KIT,
	RANGED_WEAPONS,
} from "./Heroes.js";
export type { HeGrenadeState, Trap } from "./Items.js";
/**
 * Items, re-exported by name for the same reason melee and the ultimate are:
 * `server/` reaches this module through `server/physics.ts`, and anything
 * behind an `export *` silently arrives as an empty namespace. The server owns
 * the charges and the damage; it imports the physics both sides must agree on
 * from here.
 */
export {
	HE_GRENADE_RADIUS,
	heBlastDamage,
	heGrenadeEnd,
	heGrenadeTouches,
	launchHeGrenade,
	placeTrap,
	TRAP_DAMAGE,
	tickHeGrenade,
	trapCatches,
	trapFor,
} from "./Items.js";
export type {
	MeleeAction,
	MeleeMove,
	MeleeOutcome,
	MeleePhase,
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
	applyHitToDefender,
	applyMeleeResult,
	blocksBullet,
	blocksUltimate,
	bodyRect,
	bombBlastFor,
	bombFallHeight,
	COMBO_CHAIN,
	DAGGER_DASH_DURATION_MS,
	DAGGER_DASH_LOCKOUT_MS,
	DAGGER_DASH_SPEED,
	isComboSlash,
	isKnockedDown,
	isStunned,
	MASSIVE_BLAST_DAMAGE,
	MASSIVE_BLAST_KNOCKBACK_PX_S,
	MASSIVE_BLAST_RADIUS_PX,
	MASSIVE_BLAST_STUN_MS,
	MASSIVE_CHARGE_MS,
	MELEE_IFRAME_MS,
	MELEE_MOVES,
	MELEE_WEAPONS,
	MOVES,
	massiveSlamPoint,
	meleePhase,
	moveDuration,
	PLUNGE_BLAST_BASE_RADIUS_PX,
	resolveMelee,
	SLASH_CANCELLED_MS,
	sweptThrustBox,
	zeroMoveCounts,
} from "./Melee.js";
export type { GrenadeState, Singularity } from "./Ultimate.js";
/**
 * The ultimate, re-exported by name for the same reason melee is: `server/`
 * reaches this module through `server/physics.ts`, and anything behind an
 * `export *` arrives as an empty namespace with no resolution error to show for
 * it.
 */
export {
	addCharge,
	// The dragon thrust, re-exported beside the black hole it shares the meter
	// with.
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	DRAGON_STUN_MS,
	dragonSweptRect,
	dragonVelocity,
	fieldAffects,
	fieldFor,
	GRENADE_FUSE_MS,
	GRENADE_GRAVITY,
	GRENADE_SPEED,
	grenadeEnd,
	grenadeTouches,
	launchGrenade,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_HOLD_STUN_MS,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	SINGULARITY_TICK_DAMAGE,
	singularityGrip,
	tickGrenade,
	ULT_CHARGE_MELEE_MULTIPLIER,
	ULT_CHARGE_PER_DAMAGE,
	ULT_CHARGE_PER_KILL,
	ULT_CINEMATIC_MS,
	ULT_MAX_CHARGE,
	ULT_PASSIVE_PER_SEC,
	ultReady,
} from "./Ultimate.js";

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

import { MS_PER_SECOND } from "./units.js";

export { MS_PER_SECOND } from "./units.js";

/** A fighter's full health. The bar's denominator, and every spawn's starting HP. */
export const MAX_HP = 100;

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
const GROUND_ACCEL = 2600;
const AIR_ACCEL = 1800;
const GROUND_FRICTION = 2600;
const AIR_FRICTION = 500;
/**
 * Ground friction while stunned. Normal friction kills a knockback impulse in
 * two frames, so no shove would ever be visible: a Massive Strike's 420 px/s
 * would move the target 34px at 2600, versus 73px here. Being hit hard should
 * look like being hit hard.
 */
const STUN_GROUND_FRICTION = 1200;

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
const WALL_COYOTE_MS = 100;

/**
 * Walking while blocking. A guard you can carry at full speed is a guard with no
 * cost, and it would make circling behind a blocker — the intended answer to a
 * turtle — impossible to actually perform.
 */
const BLOCK_MOVE_MULTIPLIER = 0.55;

/**
 * The sword's double-tap dash — owned by the sword weapon in `Melee.ts`, where
 * the dagger's faster burst lives beside it. Re-exported here so the old
 * importers keep one home to import from.
 */
export { DASH_DURATION_MS, DASH_LOCKOUT_MS, DASH_SPEED } from "./Melee.js";

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

export const BULLET_SPEED = 600;
export const BULLET_DAMAGE = 10;
const ATTACK_COOLDOWN = 250;

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export interface PlayerIntent extends MeleeIntent {
	left: boolean;
	right: boolean;
	/** Jump, held. Held-ness drives variable jump height, so pass the raw key state. */
	up: boolean;
	/**
	 * The ultimate button, held.
	 *
	 * `tickPlayer` does nothing with it — casting is the server's decision alone,
	 * like firing a bullet, because it depends on a charge meter only the server
	 * keeps. It lives in the intent anyway so it travels on the *one* input path
	 * every other button uses: a second message for "I pressed R" would arrive on
	 * its own schedule and be applied on a tick neither side agreed on.
	 */
	ultimate: boolean;
	/**
	 * The item button, held.
	 *
	 * `tickPlayer` does nothing with it — using an item is the server's decision
	 * alone, exactly like casting the ultimate, because a use spends a charge
	 * only the server counts. It travels on the one input path every other
	 * button uses, and the server edge-detects the press the same way it
	 * edge-detects attack.
	 */
	item: boolean;
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
	ultimate: false,
	item: false,
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
	/** ms until another tumble is allowed. Longer than the dash's lockout. */
	tumbleTimer: number;
	/**
	 * ms of roll still travelling. While non-zero the fighter's hitbox is
	 * `TUMBLE_HEIGHT` tall, pinned to the feet — the sprawl that makes a tumble
	 * more than a slow dash. Separate from `tumbleTimer` for the same reason
	 * `dashActiveTimer` is separate from `dashTimer`.
	 */
	tumbleActiveTimer: number;
	/**
	 * ms of **round freeze** remaining: the fighter is planted and takes no input.
	 *
	 * Counter-Strike's freezetime, and it lives in `PlayerPosition` for exactly
	 * the reason death does. A room-level "the round has not started" flag would
	 * have to be re-implemented on both sides of the wire, replayed correctly
	 * through reconciliation and re-decided on every rollback tick; a timer in the
	 * state the client already predicts and replays gets all three for free. The
	 * intent is discarded *inside* `tickPlayer`, so a client that mispredicted the
	 * end of a freeze corrects it the same way it corrects everything else.
	 *
	 * Deliberately **not** a stun. A stun is a state a fighter has been *put* in by
	 * somebody, and it is drawn that way — ten seconds of the staggered pose and
	 * stun sparks at the start of every round would say the whole team had just
	 * been hit. This says nothing except "not yet".
	 */
	freezeTimer: number;
	/**
	 * ms left of the dragon-thrust ride. While non-zero the fighter is cargo on
	 * the dragon's line: gravity suppressed, velocity pinned to `dragonVX/Y`,
	 * intent discarded, and nothing stops it except a hostile black hole or a
	 * wall. See specs/anands.md.
	 *
	 * The ride's whole shape — direction, speed, remaining time — rides the wire,
	 * so the client predicts its own cast exactly as it predicts a dash.
	 */
	dragonTimer: number;
	/** The dragon's line, px/s. Set once at launch; velocity is pinned to it. */
	dragonVX: number;
	dragonVY: number;
	/**
	 * ms of **mobility lock** remaining: the fighter was caught in a trap.
	 *
	 * The trap's effect, carried in `PlayerPosition` for the same reason
	 * `freezeTimer` is: it is a state both sides simulate, so a caught fighter's
	 * own client predicts the lock exactly as it predicts a dash. While non-zero
	 * the fighter is rooted for movement — no walk, no dash, no jump — but
	 * nothing else: they can still attack, block, use items and cast, which is
	 * the whole difference between a trap and a stun. See specs/items.md.
	 *
	 * Deliberately **not** a stun: a stun is a state a fighter has been *put* in
	 * by damage, and it is drawn that way. This says "your feet are gone", which
	 * is a different read and a different escape (there is none but the timer).
	 */
	trapTimer: number;
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
		tumbleTimer: 0,
		tumbleActiveTimer: 0,
		freezeTimer: 0,
		dragonTimer: 0,
		dragonVX: 0,
		dragonVY: 0,
		trapTimer: 0,
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
	target.tumbleTimer = source.tumbleTimer;
	target.tumbleActiveTimer = source.tumbleActiveTimer;
	target.freezeTimer = source.freezeTimer;
	target.dragonTimer = source.dragonTimer;
	target.dragonVX = source.dragonVX;
	target.dragonVY = source.dragonVY;
	target.trapTimer = source.trapTimer;
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
	return Math.max(0, timerMs - dt * MS_PER_SECOND);
}

/**
 * Is this fighter waiting for a round to start?
 *
 * Spelled once so "the round has not begun" is asked the same way everywhere —
 * the server refuses a gunshot and an ultimate cast on it, and the HUD draws its
 * countdown from the room's copy of the same number.
 */
export function isFrozen(s: PlayerPosition): boolean {
	return s.freezeTimer > 0;
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
 *
 * `field` is the open black hole **as this fighter experiences it** — the
 * caller has already applied the friendly-fire rule with `fieldFor`, so the
 * caster is simply handed `null` and this function never needs to know whose
 * hole it is. It is an argument rather than something applied on top of the
 * result for the reason the dash learned the hard way: anything that moves a
 * fighter from outside `tickPlayer` is erased by the next reconciliation.
 *
 * `kit` is the hero's weapons and ultimate. It is an argument for the same
 * reason `field` is — the kit is a static property of the fighter, both sides
 * learn it from the snapshot, and a kit applied on top of the result would be
 * erased by the next reconciliation. Defaults to Lia's kit, so every caller
 * from before heroes existed behaves exactly as it always has.
 *
 * `traps` are the floor traps **as this fighter experiences them** — the
 * caller has already applied the friendly-fire rule with `trapFor`, so the
 * owner is simply handed `[]` and this function never needs to know whose trap
 * it is. Like `field`, it is an argument rather than something applied on top
 * of the result: a trap lock applied after the tick would be erased by the
 * next reconciliation. Defaults to no traps.
 */
export function tickPlayer(
	pos: PlayerPosition,
	rawInput: PlayerIntent,
	dt: number,
	world: World = DEFAULT_WORLD,
	field: Singularity | null = null,
	kit: HeroKit = LIA_KIT,
	traps: readonly Trap[] = [],
): PlayerPosition {
	const s: PlayerPosition = { ...pos };

	// ---- round freeze ----
	//
	// Before anything reads the intent: while a round has not started yet, the
	// fighter is handed the neutral intent instead of the one that arrived. It
	// still falls, still collides and still counts ticks — **the simulation is
	// never stopped for this.** Stopping it is what desyncs a networked game, and
	// the ultimate's cinematic is the one exception precisely because it is 1.1s
	// and the server declares the exact tick range; ten seconds of that would park
	// ten seconds of input in every client's queue.
	//
	// Discarding intent instead costs nothing and is self-correcting: both sides
	// run this same line against the same replayed state, so a client predicts the
	// freeze ending on exactly the tick the server does.
	s.freezeTimer = decay(s.freezeTimer, dt);
	const input = pos.freezeTimer > 0 ? NEUTRAL_INTENT : rawInput;

	// Before melee, because being caught has to cancel a swing rather than run
	// alongside one. Refreshed every tick the fighter is inside the horizon, so
	// the disable ends a fixed tail after the hole lets go and no state outside
	// `stunTimer` has to remember it — which is what keeps the wire format and
	// every stun-aware system unchanged by this whole feature.
	//
	// A hostile hole is also the **only** thing that stops a dragon-thrust ride:
	// being caught cancels the ride and the hold takes over on the same tick.
	const grip = singularityGrip(field, s.x, s.y);
	if (grip === "held") {
		s.dragonTimer = 0;
		s.stunTimer = Math.max(s.stunTimer, SINGULARITY_HOLD_STUN_MS);
	}

	tickMelee(s, input, dt, kit.melee);
	// A stunned fighter still falls and still collides; it just does not steer.
	const stunned = isStunned(s);
	// Heavy moves root you where you stand. This is the "animation punishment":
	// a whiffed Massive or uppercut cannot be walked or jumped out of. A plunging
	// fighter and a stuck one are rooted the same way — the bomb is a commitment
	// from release to extraction. A dragon rider is cargo; the dragon steers.
	// A trapped fighter is rooted for movement *only*: the lock takes the feet
	// and nothing else, so the trapped fighter still attacks, blocks and casts.
	const rooted =
		stunned ||
		isCommitted(s) ||
		s.plunging ||
		s.plungeStuckTimer > 0 ||
		s.dragonTimer > 0 ||
		s.trapTimer > 0;
	// The charge roots the *walk* and nothing else. Dash, jump and block are the
	// delivery tools a 4s commitment has to keep — see `isCharging`.
	const charging = isCharging(s);

	s.wallJumpTimer = decay(s.wallJumpTimer, dt);
	s.dashTimer = decay(s.dashTimer, dt);
	s.dashActiveTimer = decay(s.dashActiveTimer, dt);
	s.tumbleTimer = decay(s.tumbleTimer, dt);
	s.tumbleActiveTimer = decay(s.tumbleActiveTimer, dt);
	// Being hit ends a burst.
	//
	// Not politeness: a dash suppresses gravity and pins `vy` to zero, so a launch
	// applied between ticks — the uppercut's whole point — would be silently eaten
	// by the next one. Every launch arrives with stun, which makes this the one
	// place that has to notice. A tumble is not a flat line, but the reduced
	// hitbox it carries must not survive the hit that was supposed to punish the
	// roll.
	if (stunned) {
		s.dashActiveTimer = 0;
		s.tumbleActiveTimer = 0;
	}
	s.coyoteTimer = decay(s.coyoteTimer, dt);
	s.jumpBufferTimer = decay(s.jumpBufferTimer, dt);
	s.wallCoyoteTimer = decay(s.wallCoyoteTimer, dt);
	s.trapTimer = decay(s.trapTimer, dt);

	const wantsJump = input.up && !rooted;
	if (wantsJump && !s.jumpHeld) {
		s.jumpBufferTimer = JUMP_BUFFER_MS;
	}

	// ---- horizontal intent ----
	const dir =
		rooted || charging ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);

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

	// ---- burst: dash (melee stance) or tumble (gun stance) ----
	// One gesture, two tools. The double-tap is the same input in both stances,
	// and which burst it is is decided here by the stance the simulation already
	// owns — the input layer never needs to know what a dash means, so switching
	// stances mid-match cannot desync the gesture. The two share a lockout, so a
	// fighter cannot chain one into the other, and GunZ's own asymmetry is
	// preserved: the sword's dash is faster than the gun's roll, so a sword
	// fighter can always close the gap a rolling gunner opens.
	//
	// The melee stance's dash speed is the *weapon's* (the dagger weighs nothing,
	// so its burst is a little quicker), the tumble belongs to the gun stance
	// and never changes.
	//
	// An impulse on the shared simulation, not a separate movement path: it sets
	// velocity and then ordinary physics and collision carry it.
	if (!rooted && input.dash !== 0 && s.dashTimer <= 0 && s.tumbleTimer <= 0) {
		if (s.stance === "gun") {
			s.vx = input.dash > 0 ? TUMBLE_SPEED : -TUMBLE_SPEED;
			s.tumbleTimer = TUMBLE_LOCKOUT_MS;
			s.tumbleActiveTimer = TUMBLE_DURATION_MS;
			// The roll keeps gravity: an airborne tumble falls. That is the whole
			// difference from the dash, which pins `vy` to zero and flies level —
			// and it is the cost that keeps a gunner honest: the roll is a dodge
			// along the floor, not a flatline across the arena.
		} else {
			const burst = kit.melee.burst;
			s.vx = input.dash > 0 ? burst.speed : -burst.speed;
			s.dashTimer = burst.lockoutMs;
			s.dashActiveTimer = burst.durationMs;
			// Flatten the arc from the first frame, so a dash thrown while rising or
			// falling travels the same line as one thrown standing still.
			s.vy = 0;
			// No longer a jump that can be cut short by releasing the button.
			s.jumping = false;
		}
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
			// simply not happen. It ends a tumble too: the roll is a ground move,
			// and its reduced hitbox must not ride a jump into the air.
			s.dashActiveTimer = 0;
			s.tumbleActiveTimer = 0;
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
			s.tumbleActiveTimer = 0;
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
			s.tumbleActiveTimer = 0;
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
	//
	// Being held by a black hole suspends gravity outright, and unlike the dash it
	// does so on the ground too: a fighter caught while standing has to be able to
	// leave the floor, or the hole would drag everybody along it instead of into
	// it.
	if (grip === "held") {
		// Nothing. The pull below owns both axes.
	} else if (s.dragonTimer > 0) {
		// The dragon-thrust ride: cargo on a line. The velocity is pinned to the
		// dragon's own (set at launch), gravity does not apply, and the timer
		// ticks down here so both sides expire the ride on the same tick. When it
		// runs out the rider keeps no speed — the dragon is a ride, not a
		// launching pad — and the next tick's ordinary physics takes over from
		// zero. The move the rider was making is frozen for the whole ride (the
		// dragon gate in `tickMelee` never advances it) and dies with it: the
		// cast is "don't switch weapons or ult", and the cancel lands at the
		// ride's end on both sides of the wire.
		s.dragonTimer = decay(s.dragonTimer, dt);
		if (s.dragonTimer > 0) {
			s.vx = s.dragonVX;
			s.vy = s.dragonVY;
			s.jumping = false;
		} else {
			s.vx = 0;
			s.vy = 0;
			s.meleeAction = "none";
			s.meleeTimer = 0;
			s.hitLatch = false;
		}
	} else if (s.plunging) {
		// The plunge bomb: no gravity, no steering — a vertical dive at a fixed
		// speed, faster than a fall can ever get. The fighter sheds horizontal
		// drift hard, because the move is a line from wherever the release
		// happened down to the floor, and the bomb's strength is measured on
		// exactly that line. It ends at floor contact, below.
		s.vy = PLUNGE_SPEED;
		s.vx = approach(s.vx, 0, PLUNGE_DECEL * dt);
		s.jumping = false;
	} else if (
		s.meleeAction !== "none" &&
		meleePhaseOf(s) === "active" &&
		(s.meleeAction === "thrust" || s.meleeAction === "shoryuken")
	) {
		// The dagger's move-driven motion. The thrust's active window is a flat
		// line — `selfVx` along the facing, `vy` pinned to zero so an airborne
		// thrust does not fall, exactly like a dash. The shoryuken's active
		// window rises at a constant `selfVy`, and gravity owns the recovery.
		// Both live here, in the shared simulation, so both sides compute the
		// same line and the hitbox and the sweep agree with the body.
		const def = MOVES[s.meleeAction];
		if (def.selfVx !== undefined) {
			s.vx = s.facing >= 0 ? def.selfVx : -def.selfVx;
		}
		if (def.selfVy !== undefined) s.vy = def.selfVy;
		s.jumping = false;
	} else if (s.dashActiveTimer > 0 && !s.grounded) {
		s.vy = 0;
	} else {
		// A tumble is deliberately **not** in the branch above: it keeps gravity,
		// grounded or airborne. The roll is the dash's opposite in this one way,
		// and the fall is what stops it being the gun's flatline.
		s.vy += (s.vy > 0 ? GRAVITY * FALL_GRAVITY_MULTIPLIER : GRAVITY) * dt;

		const pressingIntoWall =
			(dir < 0 && s.wallTouch === "left") ||
			(dir > 0 && s.wallTouch === "right");
		if (!s.grounded && pressingIntoWall && s.vy > WALL_SLIDE_SPEED) {
			s.vy = WALL_SLIDE_SPEED;
		}
		if (s.vy > MAX_FALL_SPEED) s.vy = MAX_FALL_SPEED;
	}

	// ---- the black hole ----
	//
	// Last, so it overrides steering, friction and gravity rather than being
	// averaged with them — inside the horizon the fighter is cargo, and outside it
	// the tug is a force added to whatever they were already doing. Applied before
	// the collision move, so nobody is ever dragged through a wall.
	if (field !== null && grip !== "clear") {
		const pulled = singularityPull(field, grip, s.x, s.y, s.vx, s.vy, dt);
		s.vx = pulled.vx;
		s.vy = pulled.vy;
	}

	// ---- one collision-resolved move ----
	//
	// While a tumble is travelling, the body collides as a short box pinned to
	// the feet — GunZ's sprawl. Bottom-anchored: the feet line never moves, so
	// grounded, wall and ceiling contact behave exactly as standing does. The
	// roll box is a strict subset of the standing box, so a rolling fighter can
	// never open a path through solids that a standing one would collide with —
	// it only ever *fits in fewer* spaces.
	const rollHeight = s.tumbleActiveTimer > 0 ? TUMBLE_HEIGHT : PLAYER_HEIGHT;
	const box: MovingBox = {
		x: s.x,
		y: s.y + (PLAYER_HEIGHT - rollHeight),
		w: PLAYER_WIDTH,
		h: rollHeight,
	};
	const contacts = moveAndCollide(box, s.vx * dt, s.vy * dt, world);
	s.x = box.x;
	s.y = box.y - (PLAYER_HEIGHT - rollHeight);

	// The bomb's landing: floor contact ends the dive and plants the fighter.
	//
	// This is where the whole move is bought and sold on both sides of the
	// network at once. The fall height is measured from the replayable origin,
	// so the stuck time is deterministic — a client predicts its own landing
	// exactly. The blast itself is damage, and damage is the server's alone; the
	// server reads the same `plungeOriginY` off the state to place it.
	if (s.plunging && contacts.grounded) {
		const blast = bombBlastFor(bombFallHeight(s.plungeOriginY, s.y));
		s.plungeStuckTimer = blast.stuckMs;
		s.plunging = false;
	}

	// A burst into a wall is over. Letting the timer run out would leave the
	// fighter hovering against the wall with nothing left pushing it.
	if (contacts.wall !== "none") {
		s.vx = 0;
		s.dashActiveTimer = 0;
		s.tumbleActiveTimer = 0;
	}
	// The dragon stops at geometry: the range of the thrust *is* "until an
	// obstacle". A wall, the ceiling, or a floor hit while moving downward all
	// end the ride — the one that does not is a ride already running along the
	// floor, which is a line the dragon is allowed to sweep. Ending the ride
	// also ends whatever move the rider was making when the ride began — the
	// cast's cancel, delivered here on both sides of the wire.
	if (s.dragonTimer > 0) {
		if (
			contacts.wall !== "none" ||
			contacts.ceiling ||
			(contacts.grounded && s.dragonVY > 0)
		) {
			s.dragonTimer = 0;
			s.vx = 0;
			s.vy = 0;
			s.meleeAction = "none";
			s.meleeTimer = 0;
			s.hitLatch = false;
		}
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

	// ---- the trap ----
	//
	// Last, on the moved position, so the moment the feet cross a trap's patch
	// the lock lands. Tested only while not already trapped, so a trap never
	// *refreshes* a lock it is already holding — the 3s is a sentence, not a
	// re-arm. `trapCatches` is deterministic and both sides run it against the
	// same traps, so the lock predicts exactly like the black hole's pull. The
	// trigger's *consequences* — the trap's destruction, the damage, the
	// caption — are the server's alone; this function only sets the timer both
	// sides share.
	//
	// `traps` arrived already filtered by `trapFor`, so the owner's own traps
	// and every teammate's are not here to catch them. A trap is single-use:
	// the server removes it from the world the tick it springs, so a trap that
	// is still in the list is still armed.
	if (s.trapTimer <= 0) {
		for (const t of traps) {
			if (trapCatches(t, s.x, s.y)) {
				s.trapTimer = TRAP_TRIGGER_MS;
				break;
			}
		}
	}

	// Latch the intent that was actually allowed, not the raw button. A fighter
	// who held jump through a stun must press again afterwards rather than
	// launching the instant control returns.
	s.jumpHeld = wantsJump;
	return s;
}

export function canFire(
	lastAttackTime: number,
	now: number,
	cooldownMs: number = ATTACK_COOLDOWN,
): boolean {
	return now - lastAttackTime >= cooldownMs;
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
		b.x < world.left - BULLET_OOB_MARGIN_PX ||
		b.x > world.right + BULLET_OOB_MARGIN_PX ||
		b.y < world.top - BULLET_OOB_MARGIN_PX ||
		b.y > world.bottom + BULLET_OOB_MARGIN_PX
	);
}

/** A bullet past the world edge by this much is gone. */
const BULLET_OOB_MARGIN_PX = 50;

export type BodyBoxSource = Pick<
	PlayerPosition,
	"x" | "y" | "tumbleActiveTimer"
>;

/**
 * The box the fighter currently occupies, for anything that must not hit a
 * fighter by its standing outline.
 *
 * While a tumble is travelling, the box is `TUMBLE_HEIGHT` tall, pinned to the
 * feet — the roll's whole point is to be a smaller target. A bullet is the one
 * thing judged against this smaller box: a rolling fighter is ~40% smaller a
 * target, and shots aimed at a standing fighter's upper body pass overhead.
 * (The bullet's own radius margin keeps centre-mass fire connecting — the roll
 * shrinks the target, it does not erase it.) Melee deliberately reads the
 * standing box: a slash still connects with a roller, because the sword is
 * supposed to be able to punish a roll.
 */
export function playerBodyRect(s: BodyBoxSource): Rect {
	const h = s.tumbleActiveTimer > 0 ? TUMBLE_HEIGHT : PLAYER_HEIGHT;
	return { x: s.x, y: s.y + (PLAYER_HEIGHT - h), w: PLAYER_WIDTH, h };
}

export function bulletHitsPlayer(b: BulletState, s: BodyBoxSource): boolean {
	const box = playerBodyRect(s);
	const margin = 12;
	return (
		b.x > box.x - margin &&
		b.x < box.x + box.w + margin &&
		b.y > box.y - margin &&
		b.y < box.y + box.h + margin
	);
}

export function bulletHitsPlatform(
	b: BulletState,
	world: World = DEFAULT_WORLD,
): boolean {
	return pointInAnyPlatform(b.x, b.y, world);
}
