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
import { MS_PER_SECOND } from "./units.js";

export type MeleeMove = "slash" | "slash2" | "slash3" | "uppercut" | "massive";
export type MeleeAction = "none" | MeleeMove;
export type MeleePhase = "none" | "startup" | "active" | "recovery";
export type Stance = "sword" | "gun";

/**
 * The three-hit ground chain, in order.
 *
 * A slash is not one move any more, it is the opening of a sequence: right-to-left
 * diagonal, then left-to-right diagonal, then an overhead finisher. The list is
 * the chain — `comboStep` indexes it, so the length of the combo is a property of
 * this array and not a number written down in three places.
 */
export const COMBO_CHAIN = ["slash", "slash2", "slash3"] as const;
export type ComboSlash = (typeof COMBO_CHAIN)[number];

export function isComboSlash(move: MeleeAction): move is ComboSlash {
	return (COMBO_CHAIN as readonly string[]).includes(move);
}

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
	/**
	 * Does this connect through melee invulnerability?
	 *
	 * Only the follow-ups of the ground chain. A combo hits faster than
	 * `MELEE_IFRAME_MS`, so without this the second and third swings would pass
	 * harmlessly through the fighter the first one just staggered — the combo
	 * would play its animations and deal seven damage. The opener never pierces,
	 * which is what keeps the invulnerability doing its real job of capping
	 * butterfly DPS.
	 */
	piercesIframes: boolean;
	/** Stun applied to whoever it lands on. */
	hitstunMs: number;
	/** Upward impulse on hit. Only the uppercut launches. */
	launchVy: number;
	/** Horizontal impulse on hit, away from the attacker. */
	knockbackVx: number;
	/**
	 * Does it put the target on the floor? Only the chain's finisher.
	 *
	 * A knockdown is a stun that also spikes an airborne target down and reads as
	 * a distinct state on screen — the reason the finisher is worth chaining into
	 * rather than just more damage.
	 */
	knockdown: boolean;
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
		piercesIframes: false,
		/**
		 * 190ms, and it is the *link* that sets it rather than feel.
		 *
		 * The follow-up can be chained from the moment this move enters recovery
		 * (160ms) and lands after its own 75ms of startup, so the second hitbox
		 * opens ~157ms after the first one did. Any hitstun shorter than that gap
		 * hands the defender free frames in the middle of a combo, which is not a
		 * combo — it is two swings that happen to be near each other.
		 */
		hitstunMs: 190,
		launchVy: 0,
		knockbackVx: 130,
		knockdown: false,
	},
	/**
	 * The second link: the mirror diagonal, left-to-right.
	 *
	 * Same frame data as the opener on purpose. The chain is meant to be a rhythm
	 * you can hold in your hands, not three separate timings to learn, and the
	 * difference between the two is the *angle* — which is what the defender reads
	 * to know whether the finisher is coming next.
	 */
	slash2: {
		startupMs: 75,
		activeMs: 85,
		recoveryMs: 170,
		damage: 7,
		reachPx: 44,
		boxTopOffset: 4,
		boxHeight: 38,
		blockable: true,
		cancellable: true,
		piercesIframes: true,
		/** Longer than the opener's, because the finisher's startup is longer. */
		hitstunMs: 210,
		launchVy: 0,
		knockbackVx: 150,
		knockdown: false,
	},
	/**
	 * The finisher: an overhead that knocks the target down.
	 *
	 * The one link that cannot be cancelled — the chain has to end in a commitment
	 * or it would be a free three-hit string with an escape hatch on every frame.
	 * What it commits to is *neutral*, not a punish: see `KNOCKDOWN_MS`.
	 */
	slash3: {
		startupMs: 85,
		activeMs: 100,
		recoveryMs: 420,
		/** A little more than a link, well under a Massive. 7+7+11 = 25 for the chain. */
		damage: 11,
		reachPx: 48,
		boxTopOffset: -6,
		boxHeight: 52,
		blockable: true,
		cancellable: false,
		piercesIframes: true,
		/** Equal to the knockdown it causes, by construction. */
		hitstunMs: 520,
		launchVy: 0,
		knockbackVx: 300,
		knockdown: true,
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
		piercesIframes: false,
		hitstunMs: 260,
		/**
		 * Deliberately weaker than JUMP_VELOCITY (-700): a launched fighter rises
		 * slightly less than they could have jumped. High enough to be helpless,
		 * low enough that a launch is not a free ring-out from every platform.
		 */
		launchVy: -620,
		knockbackVx: 90,
		knockdown: false,
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
		piercesIframes: false,
		hitstunMs: 650,
		launchVy: 0,
		knockbackVx: 420,
		knockdown: false,
	},
};

/** Every move there is, derived from the table so it can never fall behind it. */
export const MELEE_MOVES = Object.keys(MOVES) as MeleeMove[];

/**
 * A fresh per-move tally.
 *
 * Every counter keyed by move builds itself from `MOVES` rather than writing the
 * moves out again: a hand-written `{ slash: 0, uppercut: 0, massive: 0 }` is a
 * second copy of the move list that the compiler only catches where the type is
 * annotated, and silently accepts everywhere it is inferred.
 */
export function zeroMoveCounts(): Record<MeleeMove, number> {
	const out = {} as Record<MeleeMove, number>;
	for (const move of MELEE_MOVES) out[move] = 0;
	return out;
}

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

/**
 * How long the chain stays alive after a link *ends*.
 *
 * The link itself needs no window at all — the next slash can be started from the
 * moment the previous one enters recovery, which is what "very little delay"
 * means. This is only the grace afterwards, so a player who lets a swing finish,
 * or cancels one into a block and comes back out of it, is still in the same
 * combo. Wide on purpose: a dropped chain costs a whole combo, and there is
 * nothing to exploit in it — the chain is three moves long however slowly you
 * walk down it, and it dies the moment you leave the ground.
 */
export const COMBO_LINK_MS = 260;

/**
 * How long the chain's finisher keeps its victim on the floor.
 *
 * **Equal to the finisher's own active-plus-recovery, by construction**, and
 * `Melee.test.ts` asserts it. The attacker's swing ends at
 * `startup + active + recovery` and the victim's knockdown ends at
 * `hit + KNOCKDOWN_MS`, so if the hitbox connects on its first live frame the two
 * end on the same tick: a landed combo ends in *neutral*, not in free pressure.
 * That is what pays for the chain being uninterruptible once it reaches the
 * finisher.
 */
export const KNOCKDOWN_MS = 520;

/**
 * Downward velocity a knockdown forces on its victim.
 *
 * Only ever applied as a floor (`max`), so a target already falling faster keeps
 * its own speed. It exists so the finisher looks like what it is when it catches
 * somebody in the air — an uppercut's victim comes back down *hard* rather than
 * drifting through their own knockdown.
 */
const KNOCKDOWN_SLAM_VY = 520;

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
const BLOCK_PUSHBACK = 90;
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
	/**
	 * How far down the ground chain this fighter is: 0 for none, 1-3 for the link
	 * that is running or was last thrown. An index into `COMBO_CHAIN`, plus one.
	 */
	comboStep: number;
	/**
	 * ms left of the grace period after a link ended. Zero while one is running —
	 * a live link is chained out of its recovery phase, not out of this timer.
	 */
	comboTimer: number;
	/** ms of stun remaining. While non-zero, all intent is discarded. */
	stunTimer: number;
	/**
	 * ms of the knockdown remaining. Always ≤ `stunTimer` while it runs, because a
	 * knockdown *is* a stun — this exists so the renderer can tell "staggered" from
	 * "on the floor", and so the two states can be told apart in a diagnostic.
	 */
	knockdownTimer: number;
	/** ms of melee damage immunity remaining. */
	iframeTimer: number;
	attackHeld: boolean;
	blockHeld: boolean;
	uppercutHeld: boolean;
}

/**
 * What `tickMelee` needs: melee state, plus whether the feet are on the floor.
 *
 * `grounded` is optional because it is *physics* state that `tickPlayer` owns —
 * `PlayerPosition` satisfies this for free, and a bare `MeleeState` still ticks.
 * A fighter with no floor under it simply cannot chain, which is the rule.
 */
export interface MeleeTickState extends MeleeState {
	grounded?: boolean;
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
	/**
	 * Dash impulse this tick: -1, 1, or 0 for none.
	 *
	 * It travels in the intent rather than being applied to the state directly,
	 * because anything that moves a fighter has to be something *both* sides
	 * simulate. Applied locally it was erased by the very next reconciliation —
	 * the server never heard about it, so its authoritative state had no dash in
	 * it and the client was snapped back mid-dash.
	 */
	dash: number;
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
		comboStep: 0,
		comboTimer: 0,
		stunTimer: 0,
		knockdownTimer: 0,
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
	target.comboStep = source.comboStep;
	target.comboTimer = source.comboTimer;
	target.stunTimer = source.stunTimer;
	target.knockdownTimer = source.knockdownTimer;
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

/** On the floor: stunned, and drawn lying down. */
export function isKnockedDown(s: MeleeState): boolean {
	return s.knockdownTimer > 0;
}

/** Forget the chain entirely — the next attack press opens a fresh one. */
function resetCombo(s: MeleeState) {
	s.comboStep = 0;
	s.comboTimer = 0;
}

function endMove(s: MeleeState) {
	// A chain outlives the move that was carrying it: that grace is what lets a
	// link be thrown after the previous one has fully recovered, instead of only
	// out of its recovery. A block cancel is the exception and clears the chain
	// itself. The finisher ends the chain because there is nothing left to link
	// into.
	if (isComboSlash(s.meleeAction) && s.comboStep < COMBO_CHAIN.length) {
		s.comboTimer = COMBO_LINK_MS;
	} else {
		resetCombo(s);
	}
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
	// Anything that is not a link breaks the chain. An uppercut in the middle of a
	// combo is a different decision, not the second hit of this one.
	if (isComboSlash(move)) {
		s.comboStep = COMBO_CHAIN.indexOf(move) + 1;
		s.comboTimer = 0;
	} else {
		resetCombo(s);
	}
}

/**
 * Can an attack press right now continue the chain instead of opening a new one?
 *
 * Two ways in, and the first is the one that makes a combo feel like a combo:
 *
 * 1. **Out of the previous link's recovery.** No waiting for the move to end —
 *    the moment the hitbox closes, the next swing is available. This is the
 *    "very little delay" the whole feature is about, and it is why the links'
 *    hitstun is tuned to cover the gap.
 * 2. **Inside `COMBO_LINK_MS` of the previous link ending**, cancelled or not.
 *
 * Both require **both feet on the floor**. An airborne chain would turn the
 * butterfly's jump-in into a guaranteed three hits from a position the defender
 * cannot walk out of, and the ground requirement is what keeps the combo a
 * commitment rather than a mobility option.
 */
function canChain(s: MeleeTickState): boolean {
	if (s.grounded !== true) return false;
	if (s.comboStep < 1 || s.comboStep >= COMBO_CHAIN.length) return false;
	if (s.meleeAction === "none") return s.comboTimer > 0;
	return isComboSlash(s.meleeAction) && meleePhase(s) === "recovery";
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
export function tickMelee(
	s: MeleeTickState,
	input: MeleeIntent,
	dt: number,
): void {
	const dtMs = dt * MS_PER_SECOND;

	s.stunTimer = decay(s.stunTimer, dtMs);
	s.knockdownTimer = decay(s.knockdownTimer, dtMs);
	s.iframeTimer = decay(s.iframeTimer, dtMs);
	s.comboTimer = decay(s.comboTimer, dtMs);
	// The grace ran out with nothing thrown into it, so the chain is over. Only
	// checked between moves: a running link carries the chain in `meleeAction`.
	if (s.meleeAction === "none" && s.comboTimer <= 0) s.comboStep = 0;

	if (isStunned(s)) {
		// Everything is taken away, including a charge that was nearly ready.
		// Getting hit out of a charge is meant to cost you the charge.
		endMove(s);
		// Being hit drops the chain. A combo that survived its own author being
		// staggered would let a fighter trade into the middle of one and come out
		// of the stun holding the finisher.
		resetCombo(s);
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
		if (isCancellable(s)) {
			endMove(s);
			// A cancel is a cancel: this drops the chain for the same reason the block
			// cancel below does. Left in, the slash-shot would be the strictly better
			// cancel — the only one that keeps the combo alive.
			resetCombo(s);
		}
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
		if (!s.blockHeld && isCancellable(s)) {
			endMove(s);
			// A block cancel *always* drops the chain, so the next press is link 1
			// again. The butterfly is therefore an endless opener-and-guard loop, and
			// walking the chain is a separate decision: link into the follow-up out of
			// recovery, or cancel and start over. Letting the cancel keep the chain
			// made every butterfly cycle advance the combo, so a player who wanted the
			// safe loop got the uncancellable finisher on the third guard.
			resetCombo(s);
		}
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
	// Everything but a chain link starts from neutral. A cancel returns to neutral
	// first, so the butterfly still works — it just has to go through the block.
	//
	// The one exception is the ground chain, which may be started out of the
	// previous link's recovery. That exception is the combo.
	if (sword) {
		const neutral = s.meleeAction === "none";
		const chaining = canChain(s);
		const attackPress = input.attack && !s.attackHeld;
		const attackRelease = !input.attack && s.attackHeld;
		const uppercutPress = input.uppercut && !s.uppercutHeld;

		if (neutral && uppercutPress) {
			startMove(s, "uppercut");
		} else if (neutral && s.massiveReady && (attackPress || attackRelease)) {
			// Two ways in: a parry arms it and the next press fires it; a full charge
			// arms it and letting go fires it.
			startMove(s, "massive");
		} else if (attackPress && (neutral || chaining)) {
			// `comboStep` is one-based, so it is already the index of the *next* link.
			startMove(s, (chaining && COMBO_CHAIN[s.comboStep]) || "slash");
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
/**
 * Does this fighter's guard stop a bullet travelling at `bulletVx`?
 *
 * The same rule as melee, applied to the one thing a guard used to ignore
 * completely: a block covers the side you face, so a shot has to arrive from in
 * front to be absorbed. A bullet travelling right arrives from the left, so it
 * is blocked by a fighter facing left.
 *
 * Blocking is already expensive — one side only, 55% walk speed, nothing against
 * an uppercut or a Massive — and, decisively, **it requires the sword**, so a
 * fighter absorbing shots cannot return fire. `tickMelee` only ever sets
 * `blocking` in sword stance, which is what keeps this from being a free
 * defence: the answer to a guard is to move around it, not to out-shoot it.
 *
 * There is deliberately no parry here. A parry guard-breaks the attacker and
 * hands the defender a free Massive Strike, which is worthless at gun range and
 * would make holding block strictly dominant against a gunner.
 */
export function blocksBullet(defender: MeleeState, bulletVx: number): boolean {
	if (!defender.blocking) return false;
	const from = Math.sign(bulletVx);
	// A purely vertical shot has no side to come from, so there is nothing for a
	// front-only guard to be in front of.
	if (from === 0) return false;
	return from !== defender.facing;
}

/**
 * Does the sword guard deny this ultimate's projectile?
 *
 * **The guard is the universal counter to ultimates.** The black hole arrives
 * as a thrown grenade — a projectile — so it obeys the same rule a bullet
 * does: blocking, facing the throw, and it is gone, the meter already spent,
 * nothing to show for it. Future ultimates that arrive as projectiles get
 * their deny here for free; one that arrives some other way gets its own
 * check in this same function, so "the sword denies most ultimates" has one
 * home rather than a rule per ability.
 */
export function blocksUltimate(defender: MeleeState, fromVx: number): boolean {
	return blocksBullet(defender, fromVx);
}

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

	const move = attacker.meleeAction as MeleeMove;
	const def = MOVES[move];
	// A chain link connects through the invulnerability its own opener applied.
	// Nothing else does — see `piercesIframes`.
	if (defender.iframeTimer > 0 && !def.piercesIframes) return null;
	if (!rectsOverlap(box, bodyRect(defender.x, defender.y))) return null;

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
			// A guard break ends the chain too. Reading one link of a combo is
			// supposed to end the combo.
			attacker.comboStep = 0;
			attacker.comboTimer = 0;
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
			if (def.knockdown) {
				defender.knockdownTimer = KNOCKDOWN_MS;
				// Spiked, not launched. A knockdown that left an airborne target
				// floating would read as a weak launch, and the whole point of the
				// finisher is that it puts somebody on the floor.
				defender.vy = Math.max(defender.vy, KNOCKDOWN_SLAM_VY);
			}
			// Being hit ends whatever the defender was doing. Stun would do this next
			// tick anyway; doing it now stops a swing that is already active from
			// trading in the same frame it was interrupted.
			defender.meleeAction = "none";
			defender.meleeTimer = 0;
			defender.hitLatch = false;
			defender.blocking = false;
			defender.comboStep = 0;
			defender.comboTimer = 0;
			return def.damage;
		}
	}
}
