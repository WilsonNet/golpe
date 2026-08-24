/**
 * The ultimate: the charge economy every hero shares, the 1100ms cinematic
 * freeze, and the three ultimates' stat cards — the black hole's grenade and
 * singularity, the dragon's ride, and the Death Blossom's storm.
 */

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

/**
 * Sword hits pay this much more per point than gun shots do.
 *
 * The sword is the riskier, closer weapon and it is this game's heart, so a
 * fighter who lives in the melee arms their ultimate first. The multiplier
 * lives beside the base rate so the two cannot drift apart — and the base rate
 * stays the rate *bullets* pay, which is what makes "melee pays double" a
 * comparison the spec can actually state.
 */
export const ULT_CHARGE_MELEE_MULTIPLIER = 2;

/** A finishing blow is worth a little more than the damage that did it. */
export const ULT_CHARGE_PER_KILL = 3;

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

/** Detonates on its own after this long, wherever it happens to be. */
export const GRENADE_FUSE_MS = 1400;

/** Radius used for the fighter-contact test. Generous: this is not a bullet. */
export const GRENADE_TOUCH_PX = 20;

/** A grenade past the world edge by this much is gone (generous: it is a lob). */
export const GRENADE_OOB_X_MARGIN_PX = 40;

export const GRENADE_OOB_Y_MARGIN_PX = 80;

/** A pull target this close to the hole is exactly at it; stop dividing by zero. */
export const PULL_EPSILON = 0.001;

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

// ---------------------------------------------------------------------------
// The dragon thrust (Anands' ultimate)
//
// The black hole is a *throw*; the dragon thrust is a *ride*. The caster
// launches along the release angle at `DRAGON_SPEED`, gravity suppressed, and
// is carried until an obstacle or a hostile black hole stops them. Everything
// in the path is knocked back and damaged — the dragon hits multiple fighters
// where a swing hits one, and no sword guard can stop it.
// ---------------------------------------------------------------------------

/**
 * How fast the dragon flies. The same 1500 px/s as the plunge bomb — the game
 * only ever has two speeds of "faster than a fall can get", and both are
 * committed lines rather than steerable movement.
 */
export const DRAGON_SPEED = 1500;

/**
 * The ride's upper bound. In practice an obstacle ends it sooner — the range
 * *is* "until it is blocked" — but a wide arena's far wall would be nothing at
 * this speed without a cap, and 900ms is ~1350px: two screens of open floor.
 */
export const DRAGON_RIDE_MS = 900;

/**
 * The ride's **lower** bound: an obstacle cannot end the ride until it has
 * flown this long.
 *
 * The cast ends on the moment the rider is *already touching* an obstacle in
 * the launch direction — a grounded caster releasing into the floor, or a
 * fighter backed against the wall — the obstacle-end condition would fire on
 * the launch's own first tick, the ride would be zero ticks long, the rider
 * would never visibly thrust at all, and a spent ultimate would read as
 * "the dragon did not fire". The floor is exactly where an Anands player's
 * cursor rests between fights (the dagger's range is the body), so this was
 * not an edge case. With the floor in place the launch always shows: the
 * dragon's lunge and the start of its flight play, and a line into an
 * obstacle reads as the dragon slamming into it full tilt and stopping.
 *
 * 200ms is the ride strip's first two cells at 10fps (the lunge into the
 * dragon, then the first flight frame) — the smallest window in which the
 * move visibly happened. The swept box follows the ride, so a dug-in slam
 * still sweeps everything on its floor-level path.
 */
export const DRAGON_MIN_RIDE_MS = 200;

/** Damage per fighter the dragon passes through. Big: it can hit several. */
export const DRAGON_DAMAGE = 30;

/**
 * Knockback applied along the dragon's line. Directional, unlike a swing's
 * shove — a foe struck from the side is bowled over in the dragon's direction,
 * which is what makes a line of fighters feel like a line being swept.
 */
export const DRAGON_KNOCKBACK_PX_S = 650;

/**
 * The brief stun that makes the knockback read. The dragon is a *knockback*
 * ultimate, not a hold like the black hole — the point is the sweep, and the
 * stun is just enough that the victim cannot instantly recover the ground the
 * dragon carried them off.
 */
export const DRAGON_STUN_MS = 300;

/** Hitbox reach ahead of the rider. The body itself is the rest of the box. */
export const DRAGON_REACH_PX = 46;

// ---------------------------------------------------------------------------
// The Death Blossom (Jeffs' ultimate)
//
// The black hole is a *throw*, the dragon is a *ride*, and the blossom is a
// *storm*: the caster stands (and walks, slowly) and the world around them
// takes gunfire. Where the hole pulls and the dragon sweeps, the blossom
// *holds a circle* — the counterplay is distance and the knockdown, exactly
// as it is for Reaper. See specs/jeffs.md.
// ---------------------------------------------------------------------------

/**
 * How long the caster spins. Two seconds is a commitment you can feel — long
 * enough that the storm is a room-scale threat, short enough that a fight
 * that was happening when it started is still the same fight when it ends.
 */
export const BLOSSOM_DURATION_MS = 2000;

/**
 * The storm's reach, from the caster's centre. Reaper's 8 metres scaled to
 * this arena: a little under a third of a screen, wide enough to swallow a
 * doorway fight and narrow enough that a dash (1000 px/s) clears it in a
 * beat.
 */
export const BLOSSOM_RADIUS_PX = 260;

/** Damage on each interval. 13 × 8 = 104 over the full channel — a full bar. */
export const BLOSSOM_TICK_DAMAGE = 13;

/**
 * How often the storm fires. The same 250ms as the singularity's ticks — the
 * room's shared pulse for "damage that keeps coming".
 */
export const BLOSSOM_TICK_MS = 250;

/**
 * Walk speed while spinning. Reaper's -50%: the caster is a moving threat,
 * not a turret — a slow one, so the room can always just leave.
 */
export const BLOSSOM_WALK_MULTIPLIER = 0.5;
