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
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "./Arena.js";
import { type MovingBox, moveAndCollide } from "./Collision.js";
import { hostile, type TeamId } from "./Teams.js";
import { MS_PER_SECOND } from "./units.js";

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export type ItemId = "he-grenade" | "trap";

/** One item's stat card: what it is and how many uses a round grants. */
export interface ItemDef {
	id: ItemId;
	/** The HUD badge. */
	label: string;
	/**
	 * Uses per life. The whole point of charges: the item is a resource, not a
	 * button, so a player spends each one with intent. Both heroes' items are
	 * scarce — the HE grenade kills, so it gets two; the trap only ever
	 * *delays*, so it gets three.
	 */
	maxCharges: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
	"he-grenade": {
		id: "he-grenade",
		label: "HE GRENADE",
		maxCharges: 2,
	},
	trap: {
		id: "trap",
		label: "TRAP",
		maxCharges: 3,
	},
};

// ---------------------------------------------------------------------------
// The HE grenade
// ---------------------------------------------------------------------------

/** Launch speed along the aim angle. A committed throw, not a lob. */
export const HE_GRENADE_SPEED = 820;
/**
 * The grenade's own gravity — just over half a fighter's. The CS throw is a
 * flat medium arc: fast enough to read as a throw rather than a fall, gentle
 * enough that leading it is a skill.
 */
export const HE_GRENADE_GRAVITY = 900;
/**
 * Detonates on its own after this long, wherever it happens to be.
 *
 * Long enough to *bounce*: the fuse is what a bounced throw spends. At 1500ms a
 * grenade that hit a wall was gone on contact, so there was no reason to learn
 * the bounces; at 2500ms a throw banked off a corner is a real option, which is
 * the CS skill this item is named after.
 */
export const HE_GRENADE_FUSE_MS = 2500;
/**
 * How much of its speed a grenade keeps per bounce. CS grenades lose about half
 * their energy each time they touch something; 0.55 keeps a throw alive through
 * two or three bounces and then lets it die on the fuse, so a grenade read as
 * bounced rather than as an elastic ball.
 */
const HE_RESTITUTION = 0.55;
/** The grenade's collision radius, as a box — it is a small object, not a body. */
const HE_COLLIDE_R = 6;
/** Below this a ground bounce is a stop: the grenade settles and rolls out. */
const HE_REST_VY = 60;

/**
 * The blast radius. The CS HE's effective radius is roughly the size of a
 * doorway fight; at this scale, a sixth of a screen is a patch you can throw
 * past or clear with a dash.
 */
export const HE_GRENADE_RADIUS = 130;
/**
 * Damage at the point of detonation, falling linearly to zero at the edge —
 * CS's falloff, at this game's scale. A grenade in the face is a third of a
 * bar; a grenade at the edge of its radius is a scrape. That arc is the skill:
 * an HE is a positioning weapon, not a delete button.
 */
export const HE_GRENADE_MAX_DAMAGE = 45;
/** Radius used for the direct-hit test. Generous: this is not a bullet. */
const HE_GRENADE_TOUCH_PX = 20;

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

// ---------------------------------------------------------------------------
// The trap
// ---------------------------------------------------------------------------

/**
 * How far in front of the body's centre the trap is placed.
 *
 * "Right in front of her": past the leading edge by a clear step, so an enemy
 * chasing into the fighter's space walks over it and an enemy who has already
 * crossed (backstab territory) is behind it.
 */
export const TRAP_PLACE_OFFSET = 30;
/**
 * The trigger radius around the trap's centre, measured to the victim's feet.
 *
 * A floor patch, not a bubble: jumping over it clears it (a full jump lifts the
 * feet 136px), walking into it does not. The trigger is a radius so a fighter
 * skimming the patch's edge is caught by the edge, exactly as Dota's mines
 * trigger by proximity rather than by a strict collision box.
 */
export const TRAP_RADIUS = 40;
/**
 * How long a trapped fighter loses their mobility. Three seconds: longer than
 * a stun, deliberately — the trap is a *delay* that attacks cannot shorten,
 * and its whole value is buying the trapper a window. The trapped fighter can
 * still attack, block, use their own items and cast their ultimate; only the
 * feet are gone.
 */
export const TRAP_TRIGGER_MS = 3000;
/**
 * The little bit of damage the trap deals. Not a kill tool — a reward for
 * reading where somebody was going to stand, and the thing that makes a sprung
 * trap read as having *done* something rather than merely having been avoided.
 */
export const TRAP_DAMAGE = 10;

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
