/**
 * The items: the charges each kit grants, and the physics stat cards of the
 * HE grenade, the trap and the smoke grenade.
 */


export type ItemId = "he-grenade" | "trap" | "smoke-grenade";

/** One item's stat card: what it is and how many uses a round grants. */
export interface ItemDef {
	id: ItemId;
	/** The HUD badge. */
	label: string;
	/**
	 * Uses per life. The whole point of charges: the item is a resource, not a
	 * button, so a player spends each one with intent. Both heroes' items are
	 * scarce — the HE grenade kills, so it gets two; the trap only ever
	 * *delays*, so it gets three; the smoke *lies*, so it gets the grenade's
	 * two.
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
	"smoke-grenade": {
		id: "smoke-grenade",
		label: "SMOKE GRENADE",
		maxCharges: 2,
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
export const HE_RESTITUTION = 0.55;

/** The grenade's collision radius, as a box — it is a small object, not a body. */
export const HE_COLLIDE_R = 6;

/** Below this a ground bounce is a stop: the grenade settles and rolls out. */
export const HE_REST_VY = 60;

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
export const HE_GRENADE_TOUCH_PX = 20;

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

// ---------------------------------------------------------------------------
// The smoke grenade
//
// A thrown canister that blooms into a **vision cloud**: no damage, no
// collision, no bullet block — it changes what the enemy is allowed to know.
// The cloud is pure world state for the renderer (nothing about it is fed
// into `tickPlayer`), so this module owns the flight physics both sides must
// dead-reckon and the overlap predicates the renderer asks per fighter.
// ---------------------------------------------------------------------------

/** Launch speed along the aim angle. A committed toss, lighter than the HE's. */
export const SMOKE_GRENADE_SPEED = 700;

/**
 * The canister's own gravity — the same as the HE grenade's, so the two
 * throws read as the same gesture with a lighter payload.
 */
export const SMOKE_GRENADE_GRAVITY = 900;

/**
 * How long the canister flies before it blooms, wherever it happens to be.
 *
 * Short enough that a throw is a lob, not a wait: at 900ms a canister that
 * bounced once or twice has settled near where it was aimed, and one that is
 * still rolling when the fuse ends blooms where it is — smoking mid-air is a
 * real throw.
 */
export const SMOKE_GRENADE_FUSE_MS = 900;

/**
 * How much of its speed the canister keeps per bounce. Lower than the HE's
 * 0.55 on purpose: the smoke is meant to *plant*, and a canister that rolled
 * half an arena would cloud a doorway nobody is near.
 */
export const SMOKE_RESTITUTION = 0.4;

/** The canister's collision radius, as a box — a small object, not a body. */
export const SMOKE_COLLIDE_R = 6;

/** Below this a ground bounce is a stop: the canister settles and blooms. */
export const SMOKE_REST_VY = 80;

/**
 * The cloud's radius. A sixth of a screen, a patch you can cross in a dash
 * and hide a whole team behind — the smoke's job is to answer "how many are
 * in there" with a wall.
 */
export const SMOKE_RADIUS = 150;

/**
 * How long a cloud stands. Long enough to cross an arena with (a walk covers
 * 220 px/s, so ~1.4s edge to edge), short enough that a popped smoke is a
 * resource spent, not a permanent feature of the map.
 */
export const SMOKE_DURATION_MS = 6500;
