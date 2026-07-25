/**
 * Sword combat, modelled on GunZ: The Duel's K-Style. See specs/melee.md.
 *
 * Deterministic and engine-free, like everything else in `simulation/`: no
 * rendering engine, no DOM, no wall-clock time. The client predicts this so
 * a swing draws on the frame the button is pressed, and the server runs the
 * identical code so the two agree without a reconciliation special case.
 *
 * The design rests on one asymmetry: **a slash can be cancelled, a heavy move
 * cannot.** Cancelling a slash into a block is the butterfly; refusing to cancel
 * the Massive Strike and the uppercut is what makes them punishable, and
 * therefore what stops the butterfly being the only viable option.
 */

import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	rectsOverlap,
} from "./Arena.js";

export type MeleeMove = "slash" | "uppercut" | "massive";
export type MeleeAction = "none" | MeleeMove;
export type MeleePhase = "none" | "startup" | "active" | "recovery";
export type Stance = "sword" | "gun";

/**
 * One attack's complete definition. This table *is* the balance of the game —
 * it is the only place these numbers exist, and specs/melee.md explains why each
 * one holds.
 */
export interface MoveDef {
	/** Wind-up. No hitbox yet, and nothing can be cancelled out of it. */
	startupMs: number;
	/** The hitbox is live for exactly this long. */
	activeMs: number;
	/** The commitment. For heavy moves this is the punish window. */
	recoveryMs: number;
	damage: number;
	/** How far in front of the body the hitbox extends. */
	reachPx: number;
	/** Hitbox top, relative to the body's top edge (negative reaches overhead). */
	boxTopOffset: number;
	boxHeight: number;
	/** Can a front block absorb it? Heavy moves exist precisely because some cannot. */
	blockable: boolean;
	/** Can block or a stance switch cut the recovery short? Only the slash can. */
	cancellable: boolean;
	/** Stun applied to whoever it lands on. */
	hitstunMs: number;
	/** Upward impulse on hit. Only the uppercut launches. */
	launchVy: number;
	/** Horizontal impulse on hit, away from the attacker. */
	knockbackVx: number;
}

export const MOVES: Record<MeleeMove, MoveDef> = {
	/**
	 * The bread and butter. Its 330ms total against a 160ms cancelled length is
	 * the entire reward for learning the butterfly — shrink the recovery and the
	 * technique stops mattering.
	 */
	slash: {
		/**
		 * 75ms, and the number is set by the network rather than by feel.
		 *
		 * Blocking is supposed to be a *read*. Online, the earliest an opponent can
		 * learn a swing has begun is the next 20Hz snapshot — up to 50ms — and the
		 * guard then needs `BLOCK_STARTUP_MS` to become effective. At the original
		 * 55ms of startup that budget did not fit, and it showed: across three
		 * measured matches, 19 guards were raised and not one of them ever
		 * intercepted a slash. A reaction window narrower than the game's own
		 * update rate is not a hard mechanic, it is an absent one.
		 */
		startupMs: 75,
		activeMs: 85,
		recoveryMs: 170,
		damage: 7,
		reachPx: 42,
		boxTopOffset: 6,
		boxHeight: 36,
		blockable: true,
		cancellable: true,
		hitstunMs: 130,
		launchVy: 0,
		knockbackVx: 130,
	},
	/**
	 * The answer to a turtle. Unblockable and launching, but the shortest reach of
	 * the three, so it has to be walked into — and 340ms of uncancellable recovery
	 * means walking into it wrong loses the exchange.
	 */
	uppercut: {
		startupMs: 110,
		activeMs: 100,
		recoveryMs: 340,
		damage: 11,
		reachPx: 34,
		boxTopOffset: -20,
		boxHeight: 62,
		blockable: false,
		cancellable: false,
		hitstunMs: 260,
		/**
		 * Deliberately weaker than JUMP_VELOCITY (-700): a launched fighter rises
		 * slightly less than they could have jumped. High enough to be helpless,
		 * low enough that a launch is not a free ring-out from every platform.
		 */
		launchVy: -620,
		knockbackVx: 90,
	},
	/**
	 * The payoff for a charge or a parry. Biggest damage, biggest stun, biggest
	 * knockback — and 190ms of startup plus 420ms of recovery, neither of which
	 * can be cancelled. Whiffing it is meant to be a disaster.
	 */
	massive: {
		startupMs: 190,
		activeMs: 110,
		recoveryMs: 420,
		damage: 24,
		reachPx: 56,
		boxTopOffset: -8,
		boxHeight: 56,
		blockable: false,
		cancellable: false,
		hitstunMs: 650,
		launchVy: 0,
		knockbackVx: 420,
	},
};

export function moveDuration(move: MeleeMove): number {
	const d = MOVES[move];
	return d.startupMs + d.activeMs + d.recoveryMs;
}

/**
 * The fastest a slash can end while still having had its full hitbox: cancel the
 * instant the active window closes.
 *
 * A cancel is legal from the end of startup, so it is possible to cancel *during*
 * the active frames and lose the hit entirely. That is the skill in the
 * butterfly — cancel late and it is merely safe, cancel at exactly this moment
 * and it is safe and it hurts.
 */
export const SLASH_CANCELLED_MS = MOVES.slash.startupMs + MOVES.slash.activeMs;

/** Hold the attack button this long to arm a Massive Strike. */
export const MASSIVE_CHARGE_MS = 420;
/**
 * Delay before a guard becomes effective. **Zero, on purpose.**
 *
 * It was 30ms, framed as "a guard is not instantaneous". Online that framing was
 * a fiction: the reaction budget for blocking a 75ms slash is already spent on
 * the 50ms snapshot interval, and taking another 30ms out of what remains was
 * the difference between a hard read and an impossible one — 19 guards raised
 * across three measured matches, zero slashes intercepted.
 *
 * Anything between 1 and 16ms would also have been a fiction, just a quieter
 * one: the simulation steps at 60Hz, so a sub-tick delay rounds away to nothing
 * while still reading like a real cost. Blocking is risky because it covers one
 * side, slows you down, and does nothing against a Massive or an uppercut — not
 * because the button is sticky.
 */
export const BLOCK_STARTUP_MS = 0;
/**
 * Absorbing a blockable attack this early into a *fresh* block guard-breaks the
 * attacker. The window belongs to the press: holding block never re-arms it.
 */
export const PARRY_WINDOW_MS = 140;
/** What a parried attacker eats. Long enough for the free Massive to land. */
export const GUARD_BREAK_STUN_MS = 420;
/** Extra stun on top of the move's own, for landing on someone's unfaced side. */
export const BACKSTAB_BONUS_STUN_MS = 500;
/**
 * Melee damage immunity after being hit.
 *
 * This, and not an attack cooldown, is what caps butterfly damage. A cooldown
 * would slow the technique down and take away the mobility that makes it worth
 * learning; invulnerability instead makes swinging *faster* stop paying, which
 * keeps the butterfly a positioning tool rather than the highest-DPS option.
 */
export const MELEE_IFRAME_MS = 180;
/** Shared shove when an attack is absorbed. Nobody wins, both get space. */
export const BLOCK_PUSHBACK = 90;
/**
 * How far past the defender's centre an attacker must be for a backstab.
 *
 * A full body width. Getting behind someone is meant to be a deliberate act
 * that beats their guard, so it has to require real separation rather than
 * being decided by which way two overlapping bodies happen to be leaning —
 * fighters do not collide with each other, so in a close exchange they are
 * routinely standing inside one another. At half this distance a measured match
 * still produced 11 backstabs to 1 clean hit, which is not a reward for
 * outplaying somebody, it is the default outcome of a scramble.
 */
export const BACKSTAB_MIN_SEPARATION_PX = PLAYER_WIDTH;

/**
 * The melee half of a fighter's simulation state.
 *
 * `PlayerPosition` extends this rather than nesting it, so it stays flat and
 * cheap to copy on the netcode hot path — and so stun and launch replay through
 * reconciliation like any other physics field.
 */
export interface MeleeState {
	stance: Stance;
	/** -1 or 1. Locked while a move is running: committing is the point. */
	facing: number;
	meleeAction: MeleeAction;
	/** ms elapsed since the current move started. Phase is derived from it. */
	meleeTimer: number;
	/** This swing has already connected; it cannot hit twice. */
	hitLatch: boolean;
	/** Effective block, i.e. held for at least BLOCK_STARTUP_MS. */
	blocking: boolean;
	/** ms the block button has been down. Only a release resets it. */
	blockTimer: number;
	/** ms the attack button has been down, for the Massive charge. */
	chargeTimer: number;
	/** A Massive Strike is armed, from a full charge or a parry. */
	massiveReady: boolean;
	/** ms of stun remaining. While non-zero, all intent is discarded. */
	stunTimer: number;
	/** ms of melee damage immunity remaining. */
	iframeTimer: number;
	attackHeld: boolean;
	blockHeld: boolean;
	uppercutHeld: boolean;
}

/** What `resolveMelee` needs of a fighter: melee state plus a body. */
export interface MeleeBody extends MeleeState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
}

/** The melee half of a tick's input. `PlayerIntent` extends it. */
export interface MeleeIntent {
	attack: boolean;
	block: boolean;
	uppercut: boolean;
	/** Absolute, never a toggle — a toggle cannot survive a dropped packet. */
	swordStance: boolean;
	/**
	 * Which way to face: -1, 1, or 0 to let movement decide.
	 *
	 * Facing has to be steerable independently of movement, because a block only
	 * covers the side you face. Deriving it from the walk direction alone meant a
	 * fighter standing still could never turn around — so two fighters who had
	 * crossed over stayed permanently back-to-back, and 14 of 16 hits in a
	 * measured match landed as backstabs. Aim decides facing; feet decide
	 * position.
	 */
	face: number;
}

export function createMeleeState(facing: number): MeleeState {
	return {
		// Sword by default: this is a sword game, and the gun answers a range
		// problem rather than being the starting point.
		stance: "sword",
		facing,
		meleeAction: "none",
		meleeTimer: 0,
		hitLatch: false,
		blocking: false,
		blockTimer: 0,
		chargeTimer: 0,
		massiveReady: false,
		stunTimer: 0,
		iframeTimer: 0,
		attackHeld: false,
		blockHeld: false,
		uppercutHeld: false,
	};
}

export function copyMeleeState<T extends MeleeState>(
	source: MeleeState,
	target: T,
): T {
	target.stance = source.stance;
	target.facing = source.facing;
	target.meleeAction = source.meleeAction;
	target.meleeTimer = source.meleeTimer;
	target.hitLatch = source.hitLatch;
	target.blocking = source.blocking;
	target.blockTimer = source.blockTimer;
	target.chargeTimer = source.chargeTimer;
	target.massiveReady = source.massiveReady;
	target.stunTimer = source.stunTimer;
	target.iframeTimer = source.iframeTimer;
	target.attackHeld = source.attackHeld;
	target.blockHeld = source.blockHeld;
	target.uppercutHeld = source.uppercutHeld;
	return target;
}

/**
 * Which phase a move is in, derived from its elapsed time.
 *
 * Derived, never stored as its own counter: two timers that must agree are two
 * timers that will eventually disagree, and a phase that drifts from the clock
 * would make the hitbox appear at a different instant on each side.
 */
export function meleePhase(s: MeleeState): MeleePhase {
	if (s.meleeAction === "none") return "none";
	const def = MOVES[s.meleeAction];
	if (s.meleeTimer < def.startupMs) return "startup";
	if (s.meleeTimer < def.startupMs + def.activeMs) return "active";
	return "recovery";
}

/** A slash past its startup — the only state a cancel can act on. */
export function isCancellable(s: MeleeState): boolean {
	if (s.meleeAction === "none") return false;
	if (!MOVES[s.meleeAction].cancellable) return false;
	return meleePhase(s) !== "startup";
}

/** Mid-heavy-move: rooted, unable to steer, unable to block. The punishment. */
export function isCommitted(s: MeleeState): boolean {
	return s.meleeAction !== "none" && !MOVES[s.meleeAction].cancellable;
}

export function isStunned(s: MeleeState): boolean {
	return s.stunTimer > 0;
}

function endMove(s: MeleeState) {
	s.meleeAction = "none";
	s.meleeTimer = 0;
	s.hitLatch = false;
}

function startMove(s: MeleeState, move: MeleeMove) {
	s.meleeAction = move;
	s.meleeTimer = 0;
	s.hitLatch = false;
	// An attack replaces a guard. Holding block and tapping attack is the
	// butterfly, so this must not be an error case.
	s.blocking = false;
	if (move === "massive") s.massiveReady = false;
}

function decay(ms: number, dtMs: number): number {
	return Math.max(0, ms - dtMs);
}

/**
 * Advance one fighter's melee state by `dt` seconds. Mutates `s`.
 *
 * Ordering is deliberate and load-bearing:
 *   timers → stun gate → stance → block → move start → move advance → edges.
 *
 * Block is processed before the attack so that a held block does not swallow an
 * attack press: pressing attack while blocking starts the swing and drops the
 * guard, which is exactly the butterfly. Reversing the two would make the
 * technique impossible to perform with the block button held.
 */
export function tickMelee(s: MeleeState, input: MeleeIntent, dt: number): void {
	const dtMs = dt * 1000;

	s.stunTimer = decay(s.stunTimer, dtMs);
	s.iframeTimer = decay(s.iframeTimer, dtMs);

	if (isStunned(s)) {
		// Everything is taken away, including a charge that was nearly ready.
		// Getting hit out of a charge is meant to cost you the charge.
		endMove(s);
		s.blocking = false;
		s.blockTimer = 0;
		s.chargeTimer = 0;
		s.massiveReady = false;
		// Latch the buttons as released so the first input after stun reads as a
		// fresh press. Otherwise a player who held attack through the stun would
		// fire the instant it ended, with no decision made.
		s.attackHeld = false;
		s.blockHeld = false;
		s.uppercutHeld = false;
		return;
	}

	// ---- stance ----
	const wantSword = input.swordStance;
	const hasSword = s.stance === "sword";
	if (wantSword !== hasSword) {
		// GunZ's slash-shot: switching weapons cancels a slash. It is not an escape
		// from a heavy move.
		if (isCancellable(s)) endMove(s);
		s.stance = wantSword ? "sword" : "gun";
		if (!wantSword) {
			s.blocking = false;
			s.blockTimer = 0;
			s.chargeTimer = 0;
		}
	}
	const sword = s.stance === "sword";

	// ---- block ----
	if (sword && input.block) {
		// Only a release resets the timer. Holding block, or interrupting your own
		// block with a slash, must not re-arm the parry window — otherwise
		// butterflying with block held would hand out a free parry every cycle.
		s.blockTimer += dtMs;
		if (!s.blockHeld && isCancellable(s)) endMove(s);
		// You cannot guard and swing at the same time. Holding block through your
		// own slash used to leave the guard up for the whole swing, which made the
		// butterfly not merely safe but strictly free. Cancelling into the block
		// still works — the cancel ends the move first, and *then* this is true.
		s.blocking = s.meleeAction === "none" && s.blockTimer >= BLOCK_STARTUP_MS;
	} else {
		s.blocking = false;
		s.blockTimer = 0;
	}

	// ---- charge ----
	if (sword && input.attack) {
		s.chargeTimer += dtMs;
		if (s.chargeTimer >= MASSIVE_CHARGE_MS) s.massiveReady = true;
	} else {
		s.chargeTimer = 0;
	}

	// ---- start a move ----
	// Moves start from neutral only. A cancel returns to neutral first, so the
	// butterfly still works — it just has to go through the block.
	if (sword && s.meleeAction === "none") {
		const attackPress = input.attack && !s.attackHeld;
		const attackRelease = !input.attack && s.attackHeld;
		const uppercutPress = input.uppercut && !s.uppercutHeld;

		if (uppercutPress) {
			startMove(s, "uppercut");
		} else if (s.massiveReady && (attackPress || attackRelease)) {
			// Two ways in: a parry arms it and the next press fires it; a full charge
			// arms it and letting go fires it.
			startMove(s, "massive");
		} else if (attackPress) {
			startMove(s, "slash");
		}
	}

	// ---- advance ----
	if (s.meleeAction !== "none") {
		s.meleeTimer += dtMs;
		if (s.meleeTimer >= moveDuration(s.meleeAction)) endMove(s);
	}

	s.attackHeld = input.attack;
	s.blockHeld = input.block;
	s.uppercutHeld = input.uppercut;
}

// ---------------------------------------------------------------------------
// Hit resolution
//
// The server owns this half: whether a swing connected depends on both fighters,
// and only the server sees both authoritatively. The client predicts the state
// machine above and never decides that it hit anyone.
// ---------------------------------------------------------------------------

export function bodyRect(x: number, y: number): Rect {
	return { x, y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
}

/**
 * The live hitbox, or null when there is nothing to test.
 *
 * Returns null once `hitLatch` is set, which is what stops one swing hitting
 * repeatedly across its whole active window.
 */
export function meleeHitbox(s: MeleeBody): Rect | null {
	if (s.meleeAction === "none" || s.hitLatch) return null;
	if (meleePhase(s) !== "active") return null;

	const def = MOVES[s.meleeAction];
	const x = s.facing >= 0 ? s.x + PLAYER_WIDTH : s.x - def.reachPx;
	return {
		x,
		y: s.y + def.boxTopOffset,
		w: def.reachPx,
		h: def.boxHeight,
	};
}

export type MeleeOutcome = "hit" | "backstab" | "blocked" | "parried";

export interface MeleeResult {
	move: MeleeMove;
	outcome: MeleeOutcome;
	/** Zero for anything the defender turned away. */
	damage: number;
	/** Impact point, for effects. */
	x: number;
	y: number;
	/** Direction the attack travelled, for directional effects. */
	dir: number;
}

/**
 * Is the attacker on the side the defender is *not* facing?
 *
 * A block covers one side only, so this is what makes footsies an answer to a
 * turtle: circling behind somebody beats their guard outright.
 */
export function isBehind(attacker: MeleeBody, defender: MeleeBody): boolean {
	const ax = attacker.x + PLAYER_WIDTH / 2;
	const dx = defender.x + PLAYER_WIDTH / 2;
	const gap = ax - dx;

	// You have to actually be to one side of them, not merely on the far half of
	// a body you are standing inside.
	//
	// Fighters do not collide with each other, so in a close exchange the two
	// bodies overlap almost completely and the sign of a two-pixel difference
	// decides "behind". Combined with facing being locked during a swing, that
	// made nearly every hit in a scramble register as a backstab — 13 backstabs
	// to 2 clean hits in a measured match — and, because a backstab ignores the
	// guard, it also meant 28 raised blocks stopped nothing at all.
	if (Math.abs(gap) < BACKSTAB_MIN_SEPARATION_PX) return false;

	return Math.sign(gap) !== defender.facing;
}

/**
 * Test one attacker's live hitbox against one defender and decide the outcome.
 * Pure: it does not mutate anything. `applyMeleeResult` does that.
 */
export function resolveMelee(
	attacker: MeleeBody,
	defender: MeleeBody,
): MeleeResult | null {
	const box = meleeHitbox(attacker);
	if (!box) return null;
	if (defender.iframeTimer > 0) return null;
	if (!rectsOverlap(box, bodyRect(defender.x, defender.y))) return null;

	const move = attacker.meleeAction as MeleeMove;
	const def = MOVES[move];
	const behind = isBehind(attacker, defender);
	const dir = attacker.facing >= 0 ? 1 : -1;
	const x = box.x + box.w / 2;
	const y = box.y + box.h / 2;

	if (defender.blocking && def.blockable && !behind) {
		// Early enough into a fresh block, absorbing the hit turns the exchange
		// around completely; late, it merely survives it.
		const outcome: MeleeOutcome =
			defender.blockTimer <= PARRY_WINDOW_MS ? "parried" : "blocked";
		return { move, outcome, damage: 0, x, y, dir };
	}

	return {
		move,
		outcome: behind ? "backstab" : "hit",
		damage: def.damage,
		x,
		y,
		dir,
	};
}

/**
 * Apply a resolved hit to both fighters. Mutates them.
 *
 * Returns the damage the caller should subtract from the defender's HP — HP
 * lives outside the simulation state, because it is not something a client ever
 * predicts.
 */
export function applyMeleeResult(
	attacker: MeleeBody,
	defender: MeleeBody,
	result: MeleeResult,
): number {
	const def = MOVES[result.move];
	attacker.hitLatch = true;

	switch (result.outcome) {
		case "blocked": {
			// Nobody wins; both get space.
			attacker.vx -= result.dir * BLOCK_PUSHBACK;
			defender.vx += result.dir * BLOCK_PUSHBACK;
			return 0;
		}

		case "parried": {
			// The guard break: the attacker is thrown off balance and the defender
			// gets an instant Massive, which is what makes reading a swing pay.
			attacker.stunTimer = GUARD_BREAK_STUN_MS;
			attacker.meleeAction = "none";
			attacker.meleeTimer = 0;
			// A stunned fighter holds nothing, guard included. Leaving this set left
			// a fighter both stunned and blocking, which is a state the rules say
			// cannot exist.
			attacker.blocking = false;
			attacker.vx -= result.dir * BLOCK_PUSHBACK;
			defender.massiveReady = true;
			return 0;
		}

		default: {
			defender.stunTimer = Math.max(
				defender.stunTimer,
				def.hitstunMs +
					(result.outcome === "backstab" ? BACKSTAB_BONUS_STUN_MS : 0),
			);
			defender.iframeTimer = MELEE_IFRAME_MS;
			defender.vx += result.dir * def.knockbackVx;
			if (def.launchVy !== 0) {
				defender.vy = def.launchVy;
				defender.grounded = false;
			}
			// Being hit ends whatever the defender was doing. Stun would do this next
			// tick anyway; doing it now stops a swing that is already active from
			// trading in the same frame it was interrupted.
			defender.meleeAction = "none";
			defender.meleeTimer = 0;
			defender.hitLatch = false;
			defender.blocking = false;
			return def.damage;
		}
	}
}
