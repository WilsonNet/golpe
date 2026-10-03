/**
 * Ibiriki's throwing axes: the physics both sides must agree on. See
 * specs/ibiriki.md.
 *
 * An axe is a **world object**, like a trap canister: the server owns it (the
 * throw spends a round only the server counts, and a hit is the server's to
 * judge), and the client dead-reckons it between snapshots with this same
 * `tickAxe`. Unlike every other projectile, an axe **stays**: it sticks in the
 * first surface it meets and rests there until its owner walks over it or dies.
 *
 * Pure and shared: no wall clock, no randomness, no rendering.
 */

import {
	AXE_CHARGE_MS,
	AXE_DROP_VY,
	AXE_GRAVITY,
	AXE_MIN_DAMAGE,
	AXE_MIN_SPEED,
	AXE_PICKUP_PX,
	AXE_RADIUS_PX,
	RANGED_WEAPONS,
} from "../../tweakables/ranged.js";
import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "./Arena.js";
import { type MovingBox, moveAndCollide } from "./Collision.js";
import { hostile, type TeamId } from "./Teams.js";

/** How close to the world's side a box must be to count as touching it. */
const EDGE_EPSILON_PX = 0.5;

/** One axe: flying, falling after a hit, or resting where it stuck. */
export interface AxeState {
	id: number;
	ownerId: string;
	/** The thrower's side, so an axe flies through teammates. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** What it deals on a hit. Fixed at the release by the charge. */
	damage: number;
	/** A full-charge throw: the embers, and the guard crush. */
	full: boolean;
	/**
	 * It already hit somebody and is falling to the floor: it can hurt nobody
	 * any more, and it rests where it lands.
	 */
	dropped: boolean;
	/** Stuck in a surface. A resting axe never moves again. */
	resting: boolean;
	/**
	 * The blade's heading when it stuck, radians — drawn, never simulated: a
	 * resting axe is drawn biting into the surface the way it flew in.
	 */
	restAngle: number;
}

/** What a throw charged for `chargeMs` is worth: speed, damage, full or not. */
export function axeThrowFor(chargeMs: number): {
	speed: number;
	damage: number;
	full: boolean;
} {
	const max = RANGED_WEAPONS.axe;
	const t = Math.max(0, Math.min(1, chargeMs / AXE_CHARGE_MS));
	return {
		speed: AXE_MIN_SPEED + (max.speed - AXE_MIN_SPEED) * t,
		damage: Math.round(AXE_MIN_DAMAGE + (max.damage - AXE_MIN_DAMAGE) * t),
		full: chargeMs >= AXE_CHARGE_MS,
	};
}

export function launchAxe(
	id: number,
	ownerId: string,
	ownerTeam: TeamId | null,
	x: number,
	y: number,
	angle: number,
	chargeMs: number,
): AxeState {
	const t = axeThrowFor(chargeMs);
	return {
		id,
		ownerId,
		ownerTeam,
		x,
		y,
		vx: Math.cos(angle) * t.speed,
		vy: Math.sin(angle) * t.speed,
		damage: t.damage,
		full: t.full,
		dropped: false,
		resting: false,
		restAngle: 0,
	};
}

/**
 * Advance one axe, resolving it against the world. Mutates in place.
 *
 * A flying axe falls under `AXE_GRAVITY` and **sticks** into the first floor,
 * ledge, wall or ceiling it meets — no bounce. Returns true on the tick it
 * comes to rest, so the server can play the thunk.
 */
export function tickAxe(
	a: AxeState,
	dt: number,
	world: World = DEFAULT_WORLD,
): boolean {
	if (a.resting) return false;
	a.vy += AXE_GRAVITY * dt;
	const r = AXE_RADIUS_PX;
	const box: MovingBox = { x: a.x - r, y: a.y - r, w: r * 2, h: r * 2 };
	const heading = Math.atan2(a.vy, a.vx);
	const contacts = moveAndCollide(box, a.vx * dt, a.vy * dt, world);
	a.x = box.x + r;
	a.y = box.y + r;
	const hitWall = contacts.wall !== "none";
	// The world's own edges and every ceiling **scrape** instead of catching:
	// an axe stuck in the sky or high on the arena's side walls would be an
	// axe its owner could never walk back to. It loses that axis of speed and
	// gravity brings it down to something it can bite. A dropped axe slides
	// down any wall the same way — it is falling, not flying.
	const atWorldEdge =
		box.x <= world.left + EDGE_EPSILON_PX ||
		box.x + box.w >= world.right - EDGE_EPSILON_PX;
	if (!contacts.grounded && (contacts.ceiling || hitWall)) {
		const sticks = hitWall && !atWorldEdge && !a.dropped;
		if (!sticks) {
			if (hitWall) a.vx = 0;
			if (contacts.ceiling) a.vy = Math.max(0, a.vy);
			return false;
		}
	}
	if (contacts.grounded || hitWall) {
		a.resting = true;
		a.restAngle = a.dropped ? 0 : heading;
		a.vx = 0;
		a.vy = 0;
		return true;
	}
	return false;
}

/**
 * Does this flying axe touch this fighter? The owner and their side are never
 * targets — the friendly-fire predicate every weapon asks. A dropped or
 * resting axe touches nobody.
 */
export function axeTouches(
	a: AxeState,
	fighterId: string,
	fighterTeam: TeamId | null,
	x: number,
	y: number,
): boolean {
	if (a.resting || a.dropped) return false;
	if (fighterId === a.ownerId) return false;
	if (!hostile(a.ownerTeam, fighterTeam)) return false;
	const m = AXE_RADIUS_PX;
	return (
		a.x > x - m &&
		a.x < x + PLAYER_WIDTH + m &&
		a.y > y - m &&
		a.y < y + PLAYER_HEIGHT + m
	);
}

/** An axe that hit a body falls at the victim's feet. Mutates in place. */
export function dropAxe(a: AxeState): void {
	a.dropped = true;
	a.vx = -a.vx * 0.1;
	a.vy = AXE_DROP_VY;
}

/** Can this fighter pick this axe back up? Only its owner, only at rest. */
export function axePickable(
	a: AxeState,
	fighterId: string,
	x: number,
	y: number,
): boolean {
	if (!a.resting || a.ownerId !== fighterId) return false;
	const m = AXE_PICKUP_PX;
	return (
		a.x > x - m &&
		a.x < x + PLAYER_WIDTH + m &&
		a.y > y - m &&
		a.y < y + PLAYER_HEIGHT + m
	);
}
