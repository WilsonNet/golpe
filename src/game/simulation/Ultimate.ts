/**
 * The ultimate: a thrown grenade that collapses into a black hole.
 *
 * Pure and shared, like everything else in `simulation/`. No wall clock, no
 * randomness, no rendering — the client predicts the pull through exactly this
 * code, so anything non-deterministic in here would show up as reconciliation
 * error on every fighter the hole is holding.
 *
 * The three references are named in specs/ultimate.md and they divide cleanly:
 * Overwatch decides how it is *earned* and that it is *announced*, Enigma's
 * Black Hole decides what the field *does*, and Zarya's Graviton Surge decides
 * that it is a projectile you can throw badly.
 *
 * **What is NOT here:** the cast decision, the charge accounting and the
 * damage. All three depend on facts only the server has — whether a hit landed,
 * whose it was, whether the match is live — so they live in `GameRoom` beside
 * the bullets, which are owned the same way and for the same reason.
 */

import {
	BLOSSOM_DURATION_MS,
	BLOSSOM_RADIUS_PX,
	BLOSSOM_TICK_DAMAGE,
	BLOSSOM_TICK_MS,
	BLOSSOM_WALK_MULTIPLIER,
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_REACH_PX,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	DRAGON_STUN_MS,
	GRENADE_FUSE_MS,
	GRENADE_GRAVITY,
	GRENADE_OOB_X_MARGIN_PX,
	GRENADE_OOB_Y_MARGIN_PX,
	GRENADE_SPEED,
	GRENADE_TOUCH_PX,
	PULL_EPSILON,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DRAW_SPEED,
	SINGULARITY_DURATION_MS,
	SINGULARITY_HOLD_STUN_MS,
	SINGULARITY_PULL_ACCEL,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	SINGULARITY_TICK_DAMAGE,
	SINGULARITY_TUG_ACCEL,
	ULT_CHARGE_MELEE_MULTIPLIER,
	ULT_CHARGE_PER_DAMAGE,
	ULT_CHARGE_PER_KILL,
	ULT_CINEMATIC_MS,
	ULT_MAX_CHARGE,
	ULT_PASSIVE_PER_SEC,
} from "../../tweakables/ultimate.js";
import {
	hasLineOfSight,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	pointInAnyPlatform,
	type Rect,
	type World,
} from "./Arena.js";
import { hostile, type TeamId } from "./Teams.js";
import { MS_PER_SECOND } from "./units.js";

export {
	BLOSSOM_DURATION_MS,
	BLOSSOM_RADIUS_PX,
	BLOSSOM_TICK_DAMAGE,
	BLOSSOM_TICK_MS,
	BLOSSOM_WALK_MULTIPLIER,
	DRAGON_DAMAGE,
	DRAGON_KNOCKBACK_PX_S,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	DRAGON_STUN_MS,
	GRENADE_FUSE_MS,
	GRENADE_GRAVITY,
	GRENADE_SPEED,
	SINGULARITY_DAMAGE_INTERVAL_MS,
	SINGULARITY_DURATION_MS,
	SINGULARITY_HOLD_STUN_MS,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	SINGULARITY_TICK_DAMAGE,
	ULT_CHARGE_MELEE_MULTIPLIER,
	ULT_CHARGE_PER_DAMAGE,
	ULT_CHARGE_PER_KILL,
	ULT_CINEMATIC_MS,
	ULT_MAX_CHARGE,
	ULT_PASSIVE_PER_SEC,
};

/** Cheap predicate so "is it armed" is spelled the same way everywhere. */
export function ultReady(charge: number): boolean {
	return charge >= ULT_MAX_CHARGE;
}

/** Samples the blossom's line-of-sight check — cheaper than the AI's default. */
const BLOSSOM_LOS_SAMPLES = 16;
/** The caster's sprite does one revolution every this many ms. */
const BLOSSOM_SPIN_MS = 360;

export function addCharge(charge: number, amount: number): number {
	return Math.max(0, Math.min(ULT_MAX_CHARGE, charge + amount));
}

/**
 * How far a grenade can be thrown at all: `v² / g`, the range of a 45° lob.
 *
 * **This is a balance constant disguised as arithmetic**, and it is the reason
 * the two above are the numbers they are. The first tuning (620 px/s at 900)
 * gave 427px — barely half a screen — and it made the ability quietly
 * unusable: `scripts/ultimate-probe.ts` aimed at a fighter 660px away, got a
 * perfectly obedient 3° throw, and watched the grenade hit the floor a third of
 * the way there. Nothing was broken; the arc simply could not reach, and no
 * amount of aiming would have helped.
 *
 * 707px is a little under one 800px screen. A player can cross a screen with a
 * committed 45° lob, cannot reach with a flat one, and has to actually choose —
 * which is the whole of the skill in throwing it.
 */
export const GRENADE_MAX_RANGE_PX =
	(GRENADE_SPEED * GRENADE_SPEED) / GRENADE_GRAVITY;

export interface GrenadeState {
	id: number;
	ownerId: string;
	/** The caster's side, so the throw cannot detonate on a teammate. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** ms of fuse remaining. */
	fuseMs: number;
}

export function launchGrenade(
	id: number,
	ownerId: string,
	x: number,
	y: number,
	angle: number,
	ownerTeam: TeamId | null = null,
): GrenadeState {
	return {
		id,
		ownerId,
		ownerTeam,
		x,
		y,
		vx: Math.cos(angle) * GRENADE_SPEED,
		vy: Math.sin(angle) * GRENADE_SPEED,
		fuseMs: GRENADE_FUSE_MS,
	};
}

/**
 * What ended a grenade's flight.
 *
 * `"fizzle"` is the only one that produces no singularity, and it can only
 * happen out of the top of the world — the one open edge. Everything else
 * collapses, because a detonation that had to be "good" would make a bad throw
 * feel like a bug rather than a miss.
 */
export type GrenadeEnd = "platform" | "fighter" | "fuse" | "fizzle" | null;

/** Advance one grenade. Mutates in place, like `tickBullet`. */
export function tickGrenade(g: GrenadeState, dt: number): void {
	g.vy += GRENADE_GRAVITY * dt;
	g.x += g.vx * dt;
	g.y += g.vy * dt;
	g.fuseMs -= dt * MS_PER_SECOND;
}

/**
 * Has this grenade's flight ended, and how?
 *
 * Separate from `tickGrenade` so the caller can test fighter contact — which
 * needs the room — between the move and the verdict, without this module
 * learning what a room is.
 *
 * Order matters: geometry before the fuse, so a grenade that lands on the floor
 * on the tick its fuse expires detonates *on the floor* rather than a fighter's
 * height above it.
 */
export function grenadeEnd(
	g: GrenadeState,
	world: World,
	touchedFighter: boolean,
): GrenadeEnd {
	// Out of the top is the only fizzle. The other three edges are walls, and a
	// grenade cannot reach them without passing through solid geometry first —
	// but the test is written against the bounds rather than assuming that.
	if (g.y < world.top - GRENADE_OOB_Y_MARGIN_PX) return "fizzle";
	if (
		g.x < world.left - GRENADE_OOB_X_MARGIN_PX ||
		g.x > world.right + GRENADE_OOB_X_MARGIN_PX ||
		g.y > world.bottom + GRENADE_OOB_Y_MARGIN_PX
	) {
		return "platform";
	}
	if (pointInAnyPlatform(g.x, g.y, world)) return "platform";
	if (touchedFighter) return "fighter";
	if (g.fuseMs <= 0) return "fuse";
	return null;
}

/**
 * Does the grenade overlap this fighter's body?
 *
 * The caster is never a target, and neither is anyone on their side: a lob that
 * detonated on the teammate it was thrown over would make the ultimate a way to
 * lose the round, which is not the risk the ability is supposed to carry. It
 * passes through them and lands where it was aimed.
 */
export function grenadeTouches(
	g: GrenadeState,
	fighterId: string,
	x: number,
	y: number,
	fighterTeam: TeamId | null = null,
): boolean {
	if (fighterId === g.ownerId) return false;
	if (!hostile(g.ownerTeam, fighterTeam)) return false;
	const m = GRENADE_TOUCH_PX;
	return (
		g.x > x - m &&
		g.x < x + PLAYER_WIDTH + m &&
		g.y > y - m &&
		g.y < y + PLAYER_HEIGHT + m
	);
}

/**
 * An open singularity, as both sides see it.
 *
 * Position and owner never change once it opens, and its strength does not vary
 * with time. That is the property that makes it safe to replay: a client whose
 * idea of `remainingMs` is a few ticks off the server's still computes the same
 * force at the same place, so reconciliation has only the very end of its life
 * to disagree about.
 */
export interface Singularity {
	id: number;
	ownerId: string;
	/**
	 * The caster's side, or `null` in a free-for-all.
	 *
	 * Carried on the field itself rather than looked up per fighter, because the
	 * client feeds this object straight into `tickPlayer` for everybody it
	 * predicts — including through replays — and a lookup would make the pull
	 * depend on a roster that arrives on a different message.
	 */
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates — not a body's top-left. */
	x: number;
	y: number;
	/** ms of hold left. Presentation and expiry only; never scales the pull. */
	remainingMs: number;
}

/**
 * Is this field hostile to this fighter?
 *
 * **The one place the ultimate's friendly-fire rule is written**, and it was
 * built to take a team the day one existed: never the caster, and never a
 * teammate of the caster. Every caller asks this rather than comparing ids
 * itself, so the black hole cannot end up disagreeing with the sword about who
 * is on your side.
 *
 * `fighterTeam` defaults to `null`, which is what every fighter in a
 * free-for-all carries — and `sameTeam(null, null)` is false, so FFA is
 * "everybody but the caster" with no mode check anywhere.
 */
export function fieldAffects(
	field: Singularity,
	fighterId: string,
	fighterTeam: TeamId | null = null,
): boolean {
	if (field.ownerId === fighterId) return false;
	return hostile(field.ownerTeam, fighterTeam);
}

/**
 * The field as one fighter experiences it: the room's, or nothing at all.
 *
 * Callers hand `tickPlayer` the result of this rather than the room's field,
 * which is what keeps `tickPlayer` from needing to know a fighter's id — or,
 * now, their side.
 */
export function fieldFor(
	field: Singularity | null | undefined,
	fighterId: string,
	fighterTeam: TeamId | null = null,
): Singularity | null {
	if (!field) return null;
	return fieldAffects(field, fighterId, fighterTeam) ? field : null;
}

export type Grip = "held" | "fringe" | "clear";

/**
 * Where a fighter stands relative to the hole.
 *
 * Takes a *body* top-left and converts to a centre here, so no caller has to
 * remember which space the two are in — that mix-up is half a body's worth of
 * error and it would show up as the hole grabbing people who are not in it.
 */
export function singularityGrip(
	field: Singularity | null,
	bodyX: number,
	bodyY: number,
): Grip {
	if (!field) return "clear";
	const dx = field.x - (bodyX + PLAYER_WIDTH / 2);
	const dy = field.y - (bodyY + PLAYER_HEIGHT / 2);
	const distSq = dx * dx + dy * dy;
	if (distSq <= SINGULARITY_RADIUS * SINGULARITY_RADIUS) return "held";
	if (distSq <= SINGULARITY_REACH * SINGULARITY_REACH) return "fringe";
	return "clear";
}

/** The velocity change the field applies this tick. Pure: returns a delta. */
export function singularityPull(
	field: Singularity,
	grip: Grip,
	bodyX: number,
	bodyY: number,
	vx: number,
	vy: number,
	dt: number,
): { vx: number; vy: number } {
	const dx = field.x - (bodyX + PLAYER_WIDTH / 2);
	const dy = field.y - (bodyY + PLAYER_HEIGHT / 2);
	const dist = Math.sqrt(dx * dx + dy * dy);
	// Dead centre. No direction to pull in, and normalising would divide by zero.
	if (dist < PULL_EPSILON) return { vx: 0, vy: 0 };
	const nx = dx / dist;
	const ny = dy / dist;

	if (grip === "held") {
		// Caught: velocity is *replaced*, not added to, and converges on a fixed
		// draw-in speed. Adding an acceleration instead would let a fighter thrown
		// in at dash speed sail straight through the middle and out the far side.
		const max = SINGULARITY_PULL_ACCEL * dt;
		return {
			vx: approach(vx, nx * SINGULARITY_DRAW_SPEED, max),
			vy: approach(vy, ny * SINGULARITY_DRAW_SPEED, max),
		};
	}

	if (grip === "fringe") {
		// A force you fight, strongest at the lip of the horizon and gone by the
		// outer reach. Added to whatever the fighter is already doing, because out
		// here they are still driving.
		const falloff =
			1 -
			(dist - SINGULARITY_RADIUS) / (SINGULARITY_REACH - SINGULARITY_RADIUS);
		const a = SINGULARITY_TUG_ACCEL * Math.max(0, Math.min(1, falloff)) * dt;
		return { vx: vx + nx * a, vy: vy + ny * a };
	}

	return { vx, vy };
}

function approach(value: number, target: number, maxDelta: number): number {
	if (value < target) return Math.min(value + maxDelta, target);
	if (value > target) return Math.max(value - maxDelta, target);
	return target;
}

/** The ride's launch velocity along the release angle. `tickPlayer` pins to it. */
export function dragonVelocity(angle: number): { vx: number; vy: number } {
	return {
		vx: Math.cos(angle) * DRAGON_SPEED,
		vy: Math.sin(angle) * DRAGON_SPEED,
	};
}

/**
 * The region the dragon has swept since the ride began, or null when not
 * riding.
 *
 * The ride is a straight line at constant speed, so the ground covered is a
 * pure function of the remaining ride time — no previous position needed. The
 * server tests every foe against this box every tick, and the box is exactly
 * the path the rider's body has occupied plus the reach ahead of it, so a foe
 * standing anywhere on the swept line is caught. Hitting multiple fighters is
 * not a happy accident: it is the ability.
 */
export function dragonSweptRect(s: {
	x: number;
	y: number;
	dragonTimer: number;
	dragonVX: number;
	dragonVY: number;
}): Rect | null {
	if (s.dragonTimer <= 0) return null;
	const travelledX =
		(s.dragonVX * (DRAGON_RIDE_MS - s.dragonTimer)) / MS_PER_SECOND;
	const travelledY =
		(s.dragonVY * (DRAGON_RIDE_MS - s.dragonTimer)) / MS_PER_SECOND;
	const startX = s.x - travelledX;
	const startY = s.y - travelledY;
	return {
		x: Math.min(startX, s.x),
		y: Math.min(startY, s.y),
		w: Math.abs(travelledX) + PLAYER_WIDTH + DRAGON_REACH_PX,
		h: Math.abs(travelledY) + PLAYER_HEIGHT,
	};
}

/**
 * An open blossom, as both sides see it.
 *
 * Position and owner never change once it opens. The caster's own
 * `blossomTimer` is the authoritative channel state (it travels in
 * `PlayerPosition`, and both sides tick it — the client predicts its own
 * spin exactly as it predicts a dash); this field is the *area*, which is
 * what the server damages against and what the renderer draws.
 */
export interface Blossom {
	id: number;
	ownerId: string;
	/** The caster's side, or `null` in a free-for-all. Same rule as the hole. */
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates — not a body's top-left. */
	x: number;
	y: number;
	/** ms of storm left. Presentation and expiry only; never scales the storm. */
	remainingMs: number;
}

/**
 * Is this storm hostile to this fighter?
 *
 * The same predicate the hole uses, and the one place the blossom's
 * friendly-fire rule is written: never the caster, never a teammate of the
 * caster. `null` teams are hostile to each other, so a free-for-all is
 * "everybody but the caster" with no mode check.
 */
export function blossomAffects(
	blossom: Blossom,
	fighterId: string,
	fighterTeam: TeamId | null = null,
): boolean {
	if (blossom.ownerId === fighterId) return false;
	return hostile(blossom.ownerTeam, fighterTeam);
}

/**
 * Is this fighter inside the storm and in line of sight of it?
 *
 * The storm fires *shots*, and shots need a corridor — Reaper's shots are
 * blocked by anything the room stands between the caster and the target, and
 * the one cover this game has is a platform. `hasLineOfSight` is sampled and
 * cheap, so this is safe to ask per fighter per tick.
 */
export function blossomSweeps(
	blossom: Blossom,
	fighterId: string,
	fighterTeam: TeamId | null,
	bodyX: number,
	bodyY: number,
	world: World,
): boolean {
	if (!blossomAffects(blossom, fighterId, fighterTeam)) return false;
	const dx = blossom.x - (bodyX + PLAYER_WIDTH / 2);
	const dy = blossom.y - (bodyY + PLAYER_HEIGHT / 2);
	if (dx * dx + dy * dy > BLOSSOM_RADIUS_PX * BLOSSOM_RADIUS_PX) return false;
	return hasLineOfSight(
		blossom.x,
		blossom.y,
		bodyX + PLAYER_WIDTH / 2,
		bodyY + PLAYER_HEIGHT / 2,
		BLOSSOM_LOS_SAMPLES,
		world,
	);
}

/** Spin speed for the caster's sprite — one revolution every 360ms. */
export const BLOSSOM_SPIN_RAD_PER_MS = (Math.PI * 2) / BLOSSOM_SPIN_MS;
