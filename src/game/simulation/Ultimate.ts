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
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	pointInAnyPlatform,
	type World,
} from "./Arena.js";
import { hostile, type TeamId } from "./Teams.js";

// ---------------------------------------------------------------------------
// Charge
// ---------------------------------------------------------------------------

/** A full meter. The scale is a percentage so the HUD needs no conversion. */
export const ULT_MAX_CHARGE = 100;

/**
 * Charge for simply being alive, per second.
 *
 * Overwatch's passive exists so that a fight nobody is winning still eventually
 * produces ultimates. At 0.35/s a fighter who never lands a hit arms in ~285s —
 * longer than a match — which is the point: the meter is now **won by hits**,
 * and the passive only keeps a stalled fight from never producing one at all.
 * The 4x cut (from 1.4/s) went in alongside the hole's 2x duration, so a cast
 * is rarer and therefore allowed to be stronger.
 *
 * **Paid only while alive.** Otherwise dying would be a way to farm, and the
 * respawn queue is meant to be a punishment.
 */
export const ULT_PASSIVE_PER_SEC = 0.35;

/**
 * Charge per point of damage dealt to another fighter.
 *
 * Overwatch's rate is 1 charge per 1 damage against ult costs in the thousands.
 * Here a fighter has 100 HP, so the conversion is scaled to keep the same
 * relationship. 0.2 means a full kill's worth of damage is 20 charge — the
 * meter is earned across roughly five kills' worth of hits, never by the
 * ultimate itself (see `GameRoom.damage` on why the hole does not pay).
 */
export const ULT_CHARGE_PER_DAMAGE = 0.2;

/** A finishing blow is worth a little more than the damage that did it. */
export const ULT_CHARGE_PER_KILL = 3;

/** Cheap predicate so "is it armed" is spelled the same way everywhere. */
export function ultReady(charge: number): boolean {
	return charge >= ULT_MAX_CHARGE;
}

export function addCharge(charge: number, amount: number): number {
	return Math.max(0, Math.min(ULT_MAX_CHARGE, charge + amount));
}

// ---------------------------------------------------------------------------
// The cinematic
// ---------------------------------------------------------------------------

/**
 * How long the room stands still while the portrait is up.
 *
 * Long enough to read a name and register a threat; short enough that a player
 * who has seen it two hundred times does not resent it. Fighting-game supers
 * land between 0.8s and 1.5s for the same reason.
 *
 * **This is a simulation constant, not a presentation one.** The server counts
 * it down and every client obeys the server — see specs/netcode.md on why this
 * is the one legal frame freeze in the game.
 */
export const ULT_CINEMATIC_MS = 1100;

// ---------------------------------------------------------------------------
// The grenade
// ---------------------------------------------------------------------------

/** Launch speed along the aim angle. */
export const GRENADE_SPEED = 780;
/**
 * The grenade's own gravity — under half a fighter's.
 *
 * A projectile that fell like a body would be unthrowable across the arena, and
 * one that flew flat would be a hitscan gun. A light lob is what a player can
 * learn to lead with, and leading it is the skill the miss is measured against.
 */
export const GRENADE_GRAVITY = 860;

/**
 * How far a grenade can be thrown at all: `v² / g`, the range of a 45° lob.
 *
 * **This is a balance constant disguised as arithmetic**, and it is the reason
 * the two above are the numbers they are. The first tuning (620 px/s at 900)
 * gave 427px — barely half a screen — and it made the ability quietly
 * unusable: `scripts/ultimate-probe.mjs` aimed at a fighter 660px away, got a
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
/** Detonates on its own after this long, wherever it happens to be. */
export const GRENADE_FUSE_MS = 1400;
/** Radius used for the fighter-contact test. Generous: this is not a bullet. */
export const GRENADE_TOUCH_PX = 20;

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
	g.fuseMs -= dt * 1000;
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
	if (g.y < world.top - 80) return "fizzle";
	if (
		g.x < world.left - 40 ||
		g.x > world.right + 40 ||
		g.y > world.bottom + 80
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

// ---------------------------------------------------------------------------
// The singularity
// ---------------------------------------------------------------------------

/**
 * The event horizon: inside this you are caught, full stop.
 *
 * Dota's Black Hole has an inner radius of 420 against a hero that stands about
 * 128 units tall — 3.3 heights. A fighter here is 48px tall, so 3.3 heights is
 * ~160px, and 168 is that rounded to something that reads as "about a fifth of
 * a screen" on the 800px arena the whole game is authored at.
 */
export const SINGULARITY_RADIUS = 168;

/**
 * The outer reach: pulled, but not caught.
 *
 * Dota pulls from 1000 against an inner 420 — a little over twice. That ratio
 * on a 168px horizon would be 400px, which is half a screen and far too much
 * for an arena this size: a fighter would have nowhere to stand. 260px keeps
 * the *shape* of the ability (a lip you can feel before you are taken) at a
 * scale where the rest of the room is still playable.
 */
export const SINGULARITY_REACH = 260;

/**
 * How long the hole holds.
 *
 * 2.2s was a strong moment; 4.4s is a strong *threat*. The charge economy was
 * cut 4x in the same change, so the hole is a rare event and is allowed to
 * dominate the arena while it is here — a fighter caught for the full hold
 * takes ~123 damage, and the escape (dash out of the fringe) is unchanged.
 */
export const SINGULARITY_DURATION_MS = 4400;

/** Damage applied on each interval, server-side. 123 over a full hold. */
export const SINGULARITY_TICK_DAMAGE = 7;
export const SINGULARITY_DAMAGE_INTERVAL_MS = 250;

/** Terminal speed of the draw-in, and the acceleration that reaches it. */
export const SINGULARITY_DRAW_SPEED = 260;
export const SINGULARITY_PULL_ACCEL = 1400;

/**
 * The fringe tug, at the horizon. Falls linearly to zero at the outer reach.
 *
 * Deliberately beatable. A dash is 1000 px/s and shrugs it off; a walk is 220
 * px/s and loses ground near the lip. That gap is the counterplay — there is an
 * answer, and it costs you your dash.
 */
export const SINGULARITY_TUG_ACCEL = 520;

/**
 * Stun carried while held, refreshed every tick inside the horizon.
 *
 * A tail rather than an exact match to the tick, so a fighter released by the
 * hole expiring is briefly still reeling instead of swinging on the same frame.
 * Small enough (60ms, ~3.6 ticks) that it is a recovery, not a second stun.
 */
export const SINGULARITY_HOLD_STUN_MS = 60;

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
	if (dist < 0.001) return { vx: 0, vy: 0 };
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
