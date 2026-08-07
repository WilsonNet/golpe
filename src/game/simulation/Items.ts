/**
 * Items: the third member of a hero kit, beside the melee weapon and the
 * ranged weapon. See specs/items.md.
 *
 * Like weapons, items are **not unique to a hero**: Lia throws an HE grenade,
 * Anands plants a trap, and a future hero could carry either. Unlike weapons —
 * and like the ultimate — every use is a **server decision**, because a use
 * spends a charge only the server counts: it decides whether the fighter was
 * alive, unfrozen and not stunned, and it owns the consequence (the grenade,
 * the trap, the damage). The client never predicts a throw or a placement; it
 * learns of them from the snapshot, exactly like bullets.
 *
 * The one thing the client *does* predict is a trap's effect. The trap is a
 * world object (like the black hole) whose trigger sets `trapTimer` in
 * `PlayerPosition` — inside `tickPlayer`, on both sides — so a caught fighter's
 * own client reels exactly as the server's does. The friendly-fire rule is the
 * same single predicate every weapon asks (`hostile`), and the caster's own
 * trap never catches them.
 *
 * Everything here is pure and shared: no wall clock, no randomness, no
 * rendering. The server owns the damage and the charges; this module owns the
 * physics both sides must agree on.
 */

import {
	HE_COLLIDE_R,
	HE_GRENADE_FUSE_MS,
	HE_GRENADE_GRAVITY,
	HE_GRENADE_MAX_DAMAGE,
	HE_GRENADE_RADIUS,
	HE_GRENADE_SPEED,
	HE_GRENADE_TOUCH_PX,
	HE_REST_VY,
	HE_RESTITUTION,
	ITEMS,
	SMOKE_COLLIDE_R,
	SMOKE_DURATION_MS,
	SMOKE_GRENADE_FUSE_MS,
	SMOKE_GRENADE_GRAVITY,
	SMOKE_GRENADE_SPEED,
	SMOKE_RADIUS,
	SMOKE_REST_VY,
	SMOKE_RESTITUTION,
	TRAP_DAMAGE,
	TRAP_PLACE_OFFSET,
	TRAP_RADIUS,
	TRAP_TRIGGER_MS,
} from "../../../tweakables/items.js";
import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "./Arena.js";
import { type MovingBox, moveAndCollide } from "./Collision.js";
import { hostile, sameTeam, type TeamId } from "./Teams.js";
import { MS_PER_SECOND } from "./units.js";

export {
	HE_GRENADE_FUSE_MS,
	HE_GRENADE_GRAVITY,
	HE_GRENADE_MAX_DAMAGE,
	HE_GRENADE_RADIUS,
	HE_GRENADE_SPEED,
	ITEMS,
	SMOKE_DURATION_MS,
	SMOKE_GRENADE_FUSE_MS,
	SMOKE_GRENADE_GRAVITY,
	SMOKE_GRENADE_SPEED,
	SMOKE_RADIUS,
	TRAP_DAMAGE,
	TRAP_PLACE_OFFSET,
	TRAP_RADIUS,
	TRAP_TRIGGER_MS,
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** An HE grenade in flight. Server-owned, like a bullet. */
export interface HeGrenadeState {
	id: number;
	ownerId: string;
	/** The thrower's side, so a lob never detonates on a teammate. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** ms of fuse remaining. */
	fuseMs: number;
}

export function launchHeGrenade(
	id: number,
	ownerId: string,
	x: number,
	y: number,
	angle: number,
	ownerTeam: TeamId | null = null,
): HeGrenadeState {
	return {
		id,
		ownerId,
		ownerTeam,
		x,
		y,
		vx: Math.cos(angle) * HE_GRENADE_SPEED,
		vy: Math.sin(angle) * HE_GRENADE_SPEED,
		fuseMs: HE_GRENADE_FUSE_MS,
	};
}

/**
 * Advance one grenade, resolving it against the world. Mutates in place, like
 * `tickBullet`.
 *
 * A grenade **bounces**: it reflects off walls, the floor and the ceiling,
 * keeping `HE_RESTITUTION` of its speed each time — the CS throw, where a
 * grenade banked off a corner is a real play. It never stops until the fuse
 * runs out or it touches a hostile fighter, because stopping on contact is what
 * made every throw a point-blank explosion and the bounce dead. Deterministic
 * and shared, so the client's dead-reckon bounces in exactly the same places.
 */
export function tickHeGrenade(
	g: HeGrenadeState,
	dt: number,
	world: World = DEFAULT_WORLD,
): void {
	g.vy += HE_GRENADE_GRAVITY * dt;
	const r = HE_COLLIDE_R;
	const box: MovingBox = { x: g.x - r, y: g.y - r, w: r * 2, h: r * 2 };
	const contacts = moveAndCollide(box, g.vx * dt, g.vy * dt, world);
	g.x = box.x + r;
	g.y = box.y + r;
	if (contacts.wall !== "none") g.vx = -g.vx * HE_RESTITUTION;
	if (contacts.grounded || contacts.ceiling) {
		g.vy = -g.vy * HE_RESTITUTION;
		// A ground hit scrubs horizontal speed, like a grenade rolling after a
		// bounce, so a long fuse does not slide it across the arena.
		if (contacts.grounded) g.vx *= 0.9;
		// A bounce too small to matter is a stop: settle on the floor and let
		// the fuse do the rest.
		if (contacts.grounded && Math.abs(g.vy) < HE_REST_VY) g.vy = 0;
	}
	g.fuseMs -= dt * MS_PER_SECOND;
}

/**
 * Has this grenade's flight ended (detonate) or not?
 *
 * The HE detonates on a hostile fighter it touches, or when the fuse runs out.
 * It does **not** detonate on geometry — it bounces, and the fuse is what a
 * bounced throw spends. `moveAndCollide` keeps it inside the world, so there is
 * no out-of-bounds case left to invent one for.
 */
export function heGrenadeEnd(
	g: HeGrenadeState,
	touchedFighter: boolean,
): boolean {
	if (touchedFighter) return true;
	return g.fuseMs <= 0;
}

/**
 * Does the grenade overlap this fighter's body?
 *
 * The thrower is never a target, and neither is anyone on their side — the same
 * friendly-fire rule the ultimate grenade uses. It passes through them and
 * detonates where it was aimed.
 */
export function heGrenadeTouches(
	g: HeGrenadeState,
	fighterId: string,
	x: number,
	y: number,
	fighterTeam: TeamId | null = null,
): boolean {
	if (fighterId === g.ownerId) return false;
	if (!hostile(g.ownerTeam, fighterTeam)) return false;
	const m = HE_GRENADE_TOUCH_PX;
	return (
		g.x > x - m &&
		g.x < x + PLAYER_WIDTH + m &&
		g.y > y - m &&
		g.y < y + PLAYER_HEIGHT + m
	);
}

/** CS's falloff: full at the epicentre, nothing at the edge. */
export function heBlastDamage(distPx: number): number {
	if (distPx >= HE_GRENADE_RADIUS) return 0;
	const frac = 1 - distPx / HE_GRENADE_RADIUS;
	return Math.max(0, Math.round(HE_GRENADE_MAX_DAMAGE * frac));
}

/**
 * A trap on the floor. World state, like the singularity: it travels in the
 * snapshot, the client predicts its effect through `tickPlayer`, and it is
 * **single-use** — nothing can destroy it before it springs, but the moment it
 * catches somebody it bursts into particles and is gone, exactly like a Dota
 * mine. A trap is either on the floor and armed or it no longer exists; there
 * is no spent state to draw.
 */
export interface Trap {
	id: number;
	ownerId: string;
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates — not a body's top-left. */
	x: number;
	y: number;
}

/** Put a trap down at the fighter's feet, one step in front of them. */
export function placeTrap(
	id: number,
	ownerId: string,
	x: number,
	y: number,
	facing: number,
	ownerTeam: TeamId | null = null,
): Trap {
	return {
		id,
		ownerId,
		ownerTeam,
		x: x + PLAYER_WIDTH / 2 + facing * TRAP_PLACE_OFFSET,
		y: y + PLAYER_HEIGHT,
	};
}

/**
 * Is this fighter's feet-centre inside the trap's trigger?
 *
 * The same body-space conversion the singularity's grip does, so no caller has
 * to remember which space the trap centre lives in.
 */
export function trapCatches(t: Trap, bodyX: number, bodyY: number): boolean {
	const dx = t.x - (bodyX + PLAYER_WIDTH / 2);
	const dy = t.y - (bodyY + PLAYER_HEIGHT);
	return dx * dx + dy * dy <= TRAP_RADIUS * TRAP_RADIUS;
}

/**
 * The traps as one fighter experiences them: never their own, never a
 * teammate's. Same shape as `fieldFor` — the caller hands the result to
 * `tickPlayer`, which is what keeps the friendly-fire rule in one place.
 */
export function trapFor(
	traps: readonly Trap[],
	fighterId: string,
	fighterTeam: TeamId | null = null,
): Trap[] {
	return traps.filter(
		(t) => t.ownerId !== fighterId && hostile(t.ownerTeam, fighterTeam),
	);
}

/** A smoke canister in flight. Server-owned, dead-reckoned like a bullet. */
export interface SmokeGrenadeState {
	id: number;
	ownerId: string;
	/** The thrower's side — the bloom inherits it. */
	ownerTeam: TeamId | null;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** ms of fuse remaining. */
	fuseMs: number;
}

export function launchSmokeGrenade(
	id: number,
	ownerId: string,
	x: number,
	y: number,
	angle: number,
	ownerTeam: TeamId | null = null,
): SmokeGrenadeState {
	return {
		id,
		ownerId,
		ownerTeam,
		x,
		y,
		vx: Math.cos(angle) * SMOKE_GRENADE_SPEED,
		vy: Math.sin(angle) * SMOKE_GRENADE_SPEED,
		fuseMs: SMOKE_GRENADE_FUSE_MS,
	};
}

/**
 * Advance one canister, resolving it against the world. Mutates in place,
 * like `tickHeGrenade` — the same bounce, with the smoke's own restitution,
 * so the client's dead-reckon lands in exactly the same places.
 */
export function tickSmokeGrenade(
	g: SmokeGrenadeState,
	dt: number,
	world: World = DEFAULT_WORLD,
): void {
	g.vy += SMOKE_GRENADE_GRAVITY * dt;
	const r = SMOKE_COLLIDE_R;
	const box: MovingBox = { x: g.x - r, y: g.y - r, w: r * 2, h: r * 2 };
	const contacts = moveAndCollide(box, g.vx * dt, g.vy * dt, world);
	g.x = box.x + r;
	g.y = box.y + r;
	if (contacts.wall !== "none") g.vx = -g.vx * SMOKE_RESTITUTION;
	if (contacts.grounded || contacts.ceiling) {
		g.vy = -g.vy * SMOKE_RESTITUTION;
		if (contacts.grounded) g.vx *= 0.9;
		if (contacts.grounded && Math.abs(g.vy) < SMOKE_REST_VY) g.vy = 0;
	}
	g.fuseMs -= dt * MS_PER_SECOND;
}

/**
 * Has this canister's flight ended (bloom) or not? The smoke never detonates
 * on a fighter and never on geometry — it bounces, and the fuse is the bloom.
 */
export function smokeGrenadeEnd(g: SmokeGrenadeState): boolean {
	return g.fuseMs <= 0;
}

/**
 * An anchored vision cloud. World state, like the trap: it travels in the
 * snapshot in full every frame, and the client's renderer re-derives the
 * concealment from the list — a lost datagram costs a puff, never a false
 * clear. Position and owner never change once it blooms.
 */
export interface SmokeCloud {
	id: number;
	ownerId: string;
	/**
	 * The thrower's side, or `null` in a free-for-all. Carried on the cloud
	 * rather than looked up per fighter, for the same reason the singularity
	 * carries it: the renderer draws every cloud from its owner's side, and a
	 * lookup would depend on a roster that arrives on a different message.
	 */
	ownerTeam: TeamId | null;
	/** Centre, in world coordinates — not a body's top-left. */
	x: number;
	y: number;
	/** ms of cloud left. Presentation only; never scales the concealment. */
	remainingMs: number;
}

/** Clamp a bloom point into the world, so a cloud is never half off-screen. */
export function clampSmokePoint(
	x: number,
	y: number,
	world: World = DEFAULT_WORLD,
): { x: number; y: number } {
	return {
		x: Math.max(world.left, Math.min(x, world.right)),
		y: Math.max(world.top, Math.min(y, world.bottom)),
	};
}

/**
 * The launch angle (from the +x axis) whose arc lands a smoke canister at
 * `dx, dy`. The same quadratic the ultimate's lob solver uses, against the
 * smoke's own speed and gravity — a bot that wants to smoke a point has to
 * solve the same ballistics a throw does. A target past the canister's
 * maximum range (v²/g ≈ 544px) has no real root, so the answer is the
 * maximum-lob 45°; the canister falls short and blooms on the ground, which
 * is still a cloud between the bot and the enemy.
 */
export function smokeLobAngle(dx: number, dy: number): number {
	if (Math.abs(dx) < 1) return Math.PI / 2;
	const v2 = SMOKE_GRENADE_SPEED * SMOKE_GRENADE_SPEED;
	const a = (SMOKE_GRENADE_GRAVITY * dx * dx) / (2 * v2);
	const c = dy + a;
	const disc = dx * dx - 4 * a * c;
	if (disc < 0) return Math.PI / 4;
	const u = (dx - Math.sqrt(disc)) / (2 * a);
	return Math.atan(u);
}

/**
 * Is this fighter's body inside the cloud? Centre-to-centre, like the
 * singularity's grip — a fighter fully swallowed is hidden, a fighter at the
 * rim is not.
 */
export function smokeCloudOverlaps(
	c: SmokeCloud,
	bodyX: number,
	bodyY: number,
): boolean {
	const dx = c.x - (bodyX + PLAYER_WIDTH / 2);
	const dy = c.y - (bodyY + PLAYER_HEIGHT / 2);
	return dx * dx + dy * dy <= SMOKE_RADIUS * SMOKE_RADIUS;
}

/**
 * Is this fighter concealed from this viewer by this cloud?
 *
 * **Ally smoke hides the people inside.** The fighter must be inside the
 * cloud, the cloud must be *their own side's* (the owner's own, or a
 * teammate's — the same `sameTeam` the trap's friendly-fade uses), and the
 * viewer must be hostile to them. A fighter in the *enemy's* smoke is not
 * hidden — the concealment belongs to the smoke's owner.
 *
 * The viewer is never concealed from themselves, even in a free-for-all where
 * `hostile(null, null)` is true: you always know where you are standing.
 */
export function smokeHidesFrom(
	c: SmokeCloud,
	fighterId: string,
	fighterTeam: TeamId | null,
	viewerId: string,
	viewerTeam: TeamId | null,
	bodyX: number,
	bodyY: number,
): boolean {
	if (viewerId === fighterId) return false;
	if (c.ownerId !== fighterId && !sameTeam(c.ownerTeam, fighterTeam)) {
		return false;
	}
	if (!hostile(fighterTeam, viewerTeam)) return false;
	return smokeCloudOverlaps(c, bodyX, bodyY);
}
