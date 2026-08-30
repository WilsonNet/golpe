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
	ANTIAIR_KNOCKDOWN_MS,
	BACKSTAB_BONUS_STUN_MS,
	BLOCK_PUSHBACK,
	BLOCK_STARTUP_MS,
	CHARGE_LOCK_MS,
	COMBO_CHAIN,
	COMBO_LINK_MS,
	DAGGER_DASH_DURATION_MS,
	DAGGER_DASH_LOCKOUT_MS,
	DAGGER_DASH_SPEED,
	DASH_DURATION_MS,
	DASH_LOCKOUT_MS,
	DASH_SPEED,
	GUARD_BREAK_STUN_MS,
	KNOCKDOWN_MS,
	KNOCKDOWN_SLAM_VY,
	MASSIVE_BLAST_DAMAGE,
	MASSIVE_BLAST_KNOCKBACK_PX_S,
	MASSIVE_BLAST_RADIUS_PX,
	MASSIVE_BLAST_STUN_MS,
	MASSIVE_CHARGE_MS,
	MASSIVE_SLAM_OFFSET_PX,
	MELEE_IFRAME_MS,
	MELEE_WEAPONS,
	MOVES,
	PARRY_MASSIVE_LIFETIME_MS,
	PLUNGE_BLAST_BASE_RADIUS_PX,
	PLUNGE_BLAST_MAX_RADIUS_PX,
	PLUNGE_BLAST_RADIUS_PER_PX,
	PLUNGE_CARRY_MS,
	PLUNGE_CATCH_RADIUS_PX,
	PLUNGE_DAMAGE,
	PLUNGE_DECEL,
	PLUNGE_KNOCKUP_BASE,
	PLUNGE_KNOCKUP_MAX,
	PLUNGE_KNOCKUP_PER_PX,
	PLUNGE_MAX_FALL_PX,
	PLUNGE_SPEED,
	PLUNGE_STUCK_BASE_MS,
	PLUNGE_STUCK_MAX_MS,
	PLUNGE_STUCK_PER_PX_MS,
	PLUNGE_STUN_BASE_MS,
	PLUNGE_STUN_MAX_MS,
	PLUNGE_STUN_PER_PX_MS,
} from "../../tweakables/melee.js";
import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	rectsOverlap,
} from "./Arena.js";
import { MS_PER_SECOND } from "./units.js";

export {
	ANTIAIR_KNOCKDOWN_MS,
	BACKSTAB_BONUS_STUN_MS,
	BLOCK_STARTUP_MS,
	CHARGE_LOCK_MS,
	COMBO_CHAIN,
	COMBO_LINK_MS,
	DAGGER_DASH_DURATION_MS,
	DAGGER_DASH_LOCKOUT_MS,
	DAGGER_DASH_SPEED,
	DASH_DURATION_MS,
	DASH_LOCKOUT_MS,
	DASH_SPEED,
	GUARD_BREAK_STUN_MS,
	KNOCKDOWN_MS,
	MASSIVE_BLAST_DAMAGE,
	MASSIVE_BLAST_KNOCKBACK_PX_S,
	MASSIVE_BLAST_RADIUS_PX,
	MASSIVE_BLAST_STUN_MS,
	MASSIVE_CHARGE_MS,
	MASSIVE_SLAM_OFFSET_PX,
	MELEE_IFRAME_MS,
	MELEE_WEAPONS,
	MOVES,
	PARRY_MASSIVE_LIFETIME_MS,
	PLUNGE_BLAST_BASE_RADIUS_PX,
	PLUNGE_BLAST_MAX_RADIUS_PX,
	PLUNGE_CARRY_MS,
	PLUNGE_CATCH_RADIUS_PX,
	PLUNGE_DECEL,
	PLUNGE_KNOCKUP_BASE,
	PLUNGE_KNOCKUP_MAX,
	PLUNGE_SPEED,
	PLUNGE_STUCK_BASE_MS,
	PLUNGE_STUCK_MAX_MS,
	PLUNGE_STUN_BASE_MS,
	PLUNGE_STUN_MAX_MS,
};

import type { MeleeMove, MeleeWeaponDef } from "../../tweakables/melee.js";

export type { MeleeMove, MeleeWeaponDef };

export type MeleeAction = "none" | MeleeMove;
export type MeleePhase = "none" | "startup" | "active" | "recovery";
export type Stance = "sword" | "gun";
export type ComboSlash = (typeof COMBO_CHAIN)[number];

export function isComboSlash(move: MeleeAction): move is ComboSlash {
	return (COMBO_CHAIN as readonly string[]).includes(move);
}

/** Every move there is, derived from the table so it can never fall behind it. */
export const MELEE_MOVES = Object.keys(MOVES) as MeleeMove[];

/** Can this weapon start this move? A weapon never starts another's. */
function weaponHasMove(weapon: MeleeWeaponDef, move: MeleeMove): boolean {
	return (weapon.moves as readonly MeleeMove[]).includes(move);
}

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
	/**
	 * A Massive Strike is armed, from a full charge or a guard break.
	 *
	 * What fires it depends on *which* armed it: a guard break's Massive fires on
	 * the next attack press and fades after `PARRY_MASSIVE_LIFETIME_MS`; a full
	 * charge's fires on the release, and holds as long as the button does.
	 */
	massiveReady: boolean;
	/** ms left of a guard-break-granted Massive. Zero means it was a charge. */
	parryMassiveTimer: number;
	/**
	 * Mid-plunge-bomb dive. The fighter is rooted, drops at `PLUNGE_SPEED`, and
	 * the dive ends at floor contact — which plants them in the ground and
	 * explodes the bomb. Kept separate from `meleeAction` because a plunge has
	 * no hitbox and no phase table: it is a physics state, not a swing.
	 */
	plunging: boolean;
	/**
	 * ms stuck with the sword in the ground after a bomb lands. Rooted, helpless,
	 * and only a melee hit ends it early. See `PLUNGE_STUCK_*`.
	 */
	plungeStuckTimer: number;
	/**
	 * Y where the plunge began. The bomb's blast is a function of the fall
	 * distance, and both sides must compute the *same* fall distance from the
	 * *same* replayable state — so the origin travels on the wire.
	 */
	plungeOriginY: number;
	/**
	 * The current stun came from a guard break. Stun itself is just a timer, and
	 * the renderer has to tell "reeling from a hit" from "raised his sword
	 * helplessly" — that distinction is what makes a guard break readable.
	 */
	guardBroken: boolean;
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
	/**
	 * ms of knockdown **owed**, to be paid the next time these feet touch the
	 * floor. Zero when nothing is pending.
	 *
	 * Only a move that both launches and knocks down can arm it — the two rules
	 * contradict each other on the tick they are applied, because a knockdown
	 * spikes its victim downward (`KNOCKDOWN_SLAM_VY`) and a launch sends them up.
	 * So the uppercut's launch runs unchanged, and the floor collects the debt in
	 * `tickPlayer`. It is simulation state rather than a renderer's guess because
	 * both sides must agree on the tick the fighter goes down: it rides the wire
	 * like `knockdownTimer` does, and a launch the client could not predict would
	 * be reconciled away mid-arc.
	 */
	knockdownPendingTimer: number;
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
 *
 * `y` is optional for the same reason, and only the plunge reads it: the bomb's
 * strength is derived from where the dive began, so the origin has to be
 * captured at the instant the release is judged.
 */
export interface MeleeTickState extends MeleeState {
	grounded?: boolean;
	y?: number;
	/**
	 * Air jumps left, for the shoryuken's "not a third jump" gate.
	 * `PlayerPosition` carries the real value; a bare `MeleeState` without it
	 * (unit tests) is treated as having a jump in hand.
	 */
	airJumps?: number;
	/** ms left of a dragon-thrust ride. Only `PlayerPosition` ever sets it. */
	dragonTimer?: number;
	/** ms left of a Death Blossom channel. Only `PlayerPosition` ever sets it. */
	blossomTimer?: number;
	/** ms left of a plunge-bomb carry. Only `PlayerPosition` ever sets it. */
	plungeCarryTimer?: number;
	/** ms left of a root (trap lock). Only `PlayerPosition` ever sets it. */
	rootTimer?: number;
}

/** What `resolveMelee` needs of a fighter: melee state plus a body. */
export interface MeleeBody extends MeleeState {
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
	/** ms left of a Death Blossom channel. Only `PlayerPosition` ever sets it. */
	blossomTimer?: number;
	/** ms left of a root (trap lock). Only `PlayerPosition` ever sets it. */
	rootTimer?: number;
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
		parryMassiveTimer: 0,
		plunging: false,
		plungeStuckTimer: 0,
		plungeOriginY: 0,
		guardBroken: false,
		comboStep: 0,
		comboTimer: 0,
		stunTimer: 0,
		knockdownTimer: 0,
		knockdownPendingTimer: 0,
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
	target.parryMassiveTimer = source.parryMassiveTimer;
	target.plunging = source.plunging;
	target.plungeStuckTimer = source.plungeStuckTimer;
	target.plungeOriginY = source.plungeOriginY;
	target.guardBroken = source.guardBroken;
	target.comboStep = source.comboStep;
	target.comboTimer = source.comboTimer;
	target.stunTimer = source.stunTimer;
	target.knockdownTimer = source.knockdownTimer;
	target.knockdownPendingTimer = source.knockdownPendingTimer;
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

/**
 * Has this fighter committed to the Massive charge *accumulation*?
 *
 * The root that stops walking is not the charge's first frame — that would kill
 * the butterfly, whose taps live well under `CHARGE_LOCK_MS`. It is the hold
 * that outlived the slash it opened with: a fighter who is still holding past
 * the slash's own cancel options is charging, and charging plants you.
 *
 * The root ends the moment the charge is **armed** (`massiveReady`). A charged
 * fighter carries the weapon, not the cast: walking, dashing and jumping all
 * return, because delivering the massive — walking it into range, hopping to
 * turn it into a bomb — is the strategy the 2.5s commitment is paid for.
 */
export function isCharging(s: MeleeState): boolean {
	return (
		s.stance === "sword" && !s.massiveReady && s.chargeTimer >= CHARGE_LOCK_MS
	);
}

// ---------------------------------------------------------------------------
// The massive's blast geometry
//
// These are pure and shared because both sides must agree on where the sword
// hits the floor and on what a fall of a given height is worth. The client
// predicts the slam point for its own swing and the landing of its own bomb;
// the server applies the damage against the same numbers. See specs/melee.md.
// ---------------------------------------------------------------------------

/** Where the sword tip hits the floor: a little in front of the body. */
export function massiveSlamPoint(s: { x: number; y: number; facing: number }): {
	x: number;
	y: number;
} {
	return {
		x: s.x + PLAYER_WIDTH / 2 + s.facing * MASSIVE_SLAM_OFFSET_PX,
		y: s.y + PLAYER_HEIGHT,
	};
}

/**
 * The dive's grab column: the bomber's body expanded by `PLUNGE_CATCH_RADIUS_PX`
 * on every side. The server tests every airborne hostile against it; the
 * geometry is shared so a future client-side preview (or a diagnostic) reads
 * the same reach the server judges.
 */
export function plungeCatchRect(s: { x: number; y: number }): Rect {
	return {
		x: s.x - PLUNGE_CATCH_RADIUS_PX,
		y: s.y - PLUNGE_CATCH_RADIUS_PX,
		w: PLAYER_WIDTH + PLUNGE_CATCH_RADIUS_PX * 2,
		h: PLAYER_HEIGHT + PLUNGE_CATCH_RADIUS_PX * 2,
	};
}

/** A fall distance, clamped so corner-of-the-map dives cannot nuke. */
export function bombFallHeight(originY: number, landY: number): number {
	// Y grows downward, so a landing below the origin is landY - originY > 0.
	return Math.min(PLUNGE_MAX_FALL_PX, Math.max(0, landY - originY));
}

/** Everything a fall of `fallHeight` is worth: the bomb's whole stat card. */
export interface BombBlast {
	radiusPx: number;
	stunMs: number;
	knockupVy: number;
	stuckMs: number;
	damage: number;
}

export function bombBlastFor(fallHeight: number): BombBlast {
	const h = Math.min(PLUNGE_MAX_FALL_PX, Math.max(0, fallHeight));
	return {
		radiusPx: Math.min(
			PLUNGE_BLAST_MAX_RADIUS_PX,
			PLUNGE_BLAST_BASE_RADIUS_PX + h * PLUNGE_BLAST_RADIUS_PER_PX,
		),
		stunMs: Math.min(
			PLUNGE_STUN_MAX_MS,
			PLUNGE_STUN_BASE_MS + h * PLUNGE_STUN_PER_PX_MS,
		),
		knockupVy: Math.max(
			PLUNGE_KNOCKUP_MAX,
			PLUNGE_KNOCKUP_BASE + h * PLUNGE_KNOCKUP_PER_PX,
		),
		stuckMs: Math.min(
			PLUNGE_STUCK_MAX_MS,
			PLUNGE_STUCK_BASE_MS + h * PLUNGE_STUCK_PER_PX_MS,
		),
		damage: PLUNGE_DAMAGE,
	};
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

/**
 * Does this move relocate the fighter? The thrust lunges (`selfVx`) and the
 * shoryuken rises (`selfVy`) — today, only the dagger's two. A body-carrying
 * move is exactly the one thing the root refuses: the root has the
 * feet, and a move that needs them does not happen.
 */
function moveCarriesBody(move: MeleeMove): boolean {
	const def = MOVES[move];
	return def.selfVx !== undefined || def.selfVy !== undefined;
}

function startMove(s: MeleeTickState, move: MeleeMove) {
	// A root counters a body-carrying move at the door: the start is
	// refused outright, so the lunge does not even begin. Gated here, at the
	// one place every move passes through, so a future body-carrying move is
	// refused while rooted by construction. The dragon-thrust *ride* is not a
	// move — and not countered: a rooted Anands can still cast it.
	if ((s.rootTimer ?? 0) > 0 && moveCarriesBody(move)) return;
	s.meleeAction = move;
	s.meleeTimer = 0;
	s.hitLatch = false;
	// An attack replaces a guard. Holding block and tapping attack is the
	// butterfly, so this must not be an error case.
	s.blocking = false;
	if (move === "massive") {
		s.massiveReady = false;
		s.parryMassiveTimer = 0;
		s.chargeTimer = 0;
	}
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
 * Start the plunge bomb: a charged massive released in the air.
 *
 * The dive itself is physics — `tickPlayer` pins the fall and plants the
 * fighter at floor contact. All this does is capture the decision and the
 * origin the blast's strength is derived from, and spend the charge.
 */
function startPlunge(s: MeleeTickState) {
	s.plunging = true;
	s.plungeOriginY = s.y ?? 0;
	s.massiveReady = false;
	s.parryMassiveTimer = 0;
	s.chargeTimer = 0;
	s.blocking = false;
	resetCombo(s);
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
 *   timers → stun gate → dragon gate → plunge gate → stuck gate → stance →
 *   block → charge → move start → move advance → edges.
 *
 * `weapon` is the melee weapon this fighter carries (sword or dagger). The
 * state machine, phases and resolution are shared; the weapon decides which
 * moves can start, whether the block button blocks or thrusts, and whether a
 * charge exists at all.
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
	weapon: MeleeWeaponDef = MELEE_WEAPONS.sword,
): void {
	const dtMs = dt * MS_PER_SECOND;

	s.stunTimer = decay(s.stunTimer, dtMs);
	s.knockdownTimer = decay(s.knockdownTimer, dtMs);
	s.iframeTimer = decay(s.iframeTimer, dtMs);
	s.comboTimer = decay(s.comboTimer, dtMs);
	// A stun that has fully drained was the guard break's, and the helpless pose
	// must not outlive it. Re-hit mid-incapacitation keeps the pose — the fighter
	// is still incapacitated, it does not matter by whom.
	if (s.stunTimer <= 0) s.guardBroken = false;
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
		s.parryMassiveTimer = 0;
		// A hit mid-dive ends the dive and drops the stuck: an interrupted bomb is
		// an animation punishment, which is exactly what the stuck says it needs.
		s.plunging = false;
		s.plungeStuckTimer = 0;
		// Latch the buttons as released so the first input after stun reads as a
		// fresh press. Otherwise a player who held attack through the stun would
		// fire the instant it ended, with no decision made.
		s.attackHeld = false;
		s.blockHeld = false;
		s.uppercutHeld = false;
		return;
	}

	// ---- the dragon ride ----
	//
	// Riding the dragon thrust discards intent entirely, exactly like a plunge:
	// the ride is a physics state owned by `tickPlayer` (the velocity is pinned
	// to the dragon's line), and all this gate does is not fight it. The only
	// thing that ends a ride early is a hostile black hole, which arrives as a
	// stun and lands in the stun gate above.
	if ((s.dragonTimer ?? 0) > 0) {
		s.attackHeld = input.attack;
		s.blockHeld = input.block;
		s.uppercutHeld = input.uppercut;
		return;
	}

	// ---- the Death Blossom ----
	//
	// The storm is the same shape as the ride: a physics state owned by
	// `tickPlayer` (walk speed halved, no dash, no jump) and a channel that
	// takes the whole kit away — no sword, no block, no stance switch — for
	// the 2s it lasts. The one thing that ends it early is a knockdown, which
	// lands in `applyHitToDefender` below.
	if ((s.blossomTimer ?? 0) > 0) {
		s.attackHeld = input.attack;
		s.blockHeld = input.block;
		s.uppercutHeld = input.uppercut;
		return;
	}

	// ---- plunge ----
	//
	// The dive discards intent entirely: the bomb is committed the moment the
	// release was judged airborne. It ends in `tickPlayer`, at floor contact —
	// the same shared code that plants the fighter in the ground. A fighter
	// *caught* by somebody else's dive is cargo in the same gate: the carry
	// pins the body in `tickPlayer`, and the stun the catch applies would hold
	// here anyway — this is belt and suspenders for the tick the stun and the
	// carry disagree by.
	if (s.plunging || (s.plungeCarryTimer ?? 0) > 0) {
		s.attackHeld = input.attack;
		s.blockHeld = input.block;
		s.uppercutHeld = input.uppercut;
		return;
	}

	// ---- stuck ----
	//
	// Helpless with the sword in the ground: rooted, no input, and only a melee
	// hit (applied in `applyMeleeResult`) ends it early. The timer itself is the
	// only way out that a stuck fighter controls, and it is exactly the
	// "animation punishment for a massive bomber" the move was designed around.
	if (s.plungeStuckTimer > 0) {
		s.plungeStuckTimer = decay(s.plungeStuckTimer, dtMs);
		s.attackHeld = input.attack;
		s.blockHeld = input.block;
		s.uppercutHeld = input.uppercut;
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
		// And a stance switch kills the charge in both directions. The charge is a
		// commitment that has to survive dash, jump and block to be worth anything —
		// those are its delivery tools — but "don't switch weapons" is where it
		// ends.
		s.chargeTimer = 0;
		s.massiveReady = false;
		s.parryMassiveTimer = 0;
		s.stance = wantSword ? "sword" : "gun";
		if (!wantSword) {
			s.blocking = false;
			s.blockTimer = 0;
		}
	}
	const sword = s.stance === "sword";

	// ---- block / shift ----
	//
	// The block button means different things per weapon. The sword raises a
	// guard; the dagger has no guard at all — its shift press is the **thrust**,
	// the committed lunge that is the entire answer to the missing block. The
	// press edge starts it (the anticipation), a hold does nothing more, and a
	// press mid-stab cancels the stab into it: the dagger's version of the
	// slash-into-block cancel.
	if (sword && weapon.blockable && input.block) {
		// The parry window is gone: a guard stops the first slash *and* every
		// later one, and each one it stops is a guard break. What still belongs to
		// the press is the cancel — a block press ends a cancellable slash, and
		// holding block through your own swing simply has no swing to cancel.
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
		//
		// A charging fighter may hold the guard up too: the charge is not a swing,
		// and being able to cover while the charge fills is one of the delivery
		// tools that makes a 2.5s commitment survivable.
		s.blocking = s.meleeAction === "none" && s.blockTimer >= BLOCK_STARTUP_MS;
	} else {
		if (
			sword &&
			!weapon.blockable &&
			input.block &&
			!s.blockHeld &&
			weapon.shiftMove !== null
		) {
			// A shift press with a stab in flight cancels it into the thrust. A
			// shift press mid-anticipation is ignored — the anticipation is already
			// the thrust.
			if (isCancellable(s)) endMove(s);
			if (s.meleeAction === "none") startMove(s, weapon.shiftMove);
		}
		s.blocking = false;
		s.blockTimer = 0;
	}

	// ---- charge ----
	if (sword && weapon.hasCharge && input.attack) {
		s.chargeTimer += dtMs;
		if (s.chargeTimer >= MASSIVE_CHARGE_MS) s.massiveReady = true;
	} else {
		s.chargeTimer = 0;
	}

	// ---- a guard-break Massive fades ----
	if (s.parryMassiveTimer > 0) {
		s.parryMassiveTimer = decay(s.parryMassiveTimer, dtMs);
		if (s.parryMassiveTimer <= 0) s.massiveReady = false;
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

		if (neutral && uppercutPress && weaponHasMove(weapon, weapon.specialMove)) {
			// The dagger's shoryuken is not a third jump: it only fires while the
			// second jump is still in hand, so a fighter that double-jumped has
			// spent its vertical options and the anti-air is gone with them.
			const canShoryuken =
				weapon.specialMove !== "shoryuken" ||
				s.airJumps === undefined ||
				s.airJumps > 0;
			if (canShoryuken) startMove(s, weapon.specialMove);
		} else if (neutral && weapon.hasCharge && s.massiveReady) {
			// Two kinds, two triggers. A guard break arms it and the *press* fires
			// it — the player was not holding the button when the guard broke, so a
			// click is the natural gesture. A full charge arms it and the *release*
			// fires it — the player is holding, and letting go is the gesture.
			// And if the fighter is airborne when it fires, the swing is refused
			// and the massive becomes the plunge bomb instead.
			const firesOnPress = s.parryMassiveTimer > 0;
			if ((firesOnPress ? attackPress : attackRelease) && s.grounded) {
				startMove(s, "massive");
			} else if (firesOnPress ? attackPress : attackRelease) {
				startPlunge(s);
			}
		} else if (
			attackPress &&
			(neutral || (weapon.chain !== null && chaining))
		) {
			// The dagger has no chain: every press is link one, the stab. `chain`
			// being null is what makes a dagger's spam *just* spam — there is no
			// third press that turns it into something bigger, which is the price
			// of the button being that fast.
			if (weapon.chain !== null && chaining) {
				// `comboStep` is one-based, so it is already the index of the *next* link.
				startMove(
					s,
					(COMBO_CHAIN[s.comboStep] as MeleeMove | undefined) ?? "slash",
				);
			} else if (neutral) {
				startMove(s, (weapon.chain !== null ? "slash" : "stab") as MeleeMove);
			}
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
 *
 * The box is **swept**: it covers the path the fighter's body has travelled
 * since the move began, plus the weapon's reach in front — not merely the
 * position the fighter happens to be in on this tick. That is the whole of
 * GunZ's dash-slash: a slash thrown out of a dash carries its hitbox across
 * the dash's travel, so a fighter the dash passed *through* is caught by the
 * trail even though, by the time the active frames open, they are already
 * behind the sword.
 *
 * It also **covers the attacker's own body**, so a point-blank swing — two
 * fighters standing inside one another, a fighter pinned against a wall — can
 * never miss for being too close. The old box began past the body's front
 * edge, which is precisely the situation that missed.
 *
 * The sweep is derived from `vx` alone: during a dash that is the constant
 * burst speed, so the trail is exact; during a walk it is the small, honest
 * distance the fighter actually covered. A move that carries its own body (the
 * dagger thrust's `selfVx`) is excluded — its sweep is `sweptThrustBox`'s job,
 * and double-counting the lunge would widen the thrust twice.
 */
export function meleeHitbox(s: MeleeBody): Rect | null {
	if (s.meleeAction === "none" || s.hitLatch) return null;
	if (meleePhase(s) !== "active") return null;

	const def = MOVES[s.meleeAction];
	const facing = s.facing >= 0 ? 1 : -1;

	// The reach box, in front of the body along facing.
	const reachLeft = facing >= 0 ? s.x + PLAYER_WIDTH : s.x - def.reachPx;
	const reachRight = reachLeft + def.reachPx;

	const externalVx = def.selfVx !== undefined ? 0 : s.vx;
	const moved = externalVx * (s.meleeTimer / MS_PER_SECOND);

	// The body's swept extent: where it was at move start, to where it is now.
	const bodyLeft = Math.min(s.x, s.x - moved);
	const bodyRight = Math.max(s.x + PLAYER_WIDTH, s.x + PLAYER_WIDTH - moved);

	// The union of the body's path and the reach box.
	const left = Math.min(reachLeft, bodyLeft);
	const right = Math.max(reachRight, bodyRight);

	return {
		x: left,
		y: s.y + def.boxTopOffset,
		w: right - left,
		h: def.boxHeight,
	};
}

/**
 * What happened to one swing — or one blast.
 *
 * `blast` and `bomb` are not swing outcomes: nothing can block or parry a floor
 * blast, so the server emits them as events of their own. They share the type
 * so the wire format and the effect renderer have one vocabulary for "a sword
 * just hurt somebody".
 */
export type MeleeOutcome = "hit" | "backstab" | "parried" | "blast" | "bomb";

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
	// A mid-dive bomber cannot be anti-aired: while `plunging` the bomb is
	// immune to melee entirely — slashes, stabs, the uppercut and the
	// shoryuken all pass through it. The dive is committed and unanswerable
	// by a swing; its counters are distance and the ultimates (the black
	// hole's hold and the dragon's sweep), neither of which is a melee hit.
	// See specs/melee.md.
	if (defender.plunging) return null;
	// A chain link connects through the invulnerability its own opener applied.
	// Nothing else does — see `piercesIframes`.
	if (defender.iframeTimer > 0 && !def.piercesIframes) return null;
	if (!rectsOverlap(box, bodyRect(defender.x, defender.y))) return null;

	const behind = isBehind(attacker, defender);
	const dir = attacker.facing >= 0 ? 1 : -1;
	const x = box.x + box.w / 2;
	const y = box.y + box.h / 2;

	if (defender.blocking && def.blockable && !behind) {
		// Every guard that stops a sword attack breaks it. There is no
		// "absorbed without reward" tier any more — a turtle wins any exchange
		// it reads, and the answers to a turtle are the things a guard cannot
		// stop: the uppercut, the blast behind the swing, the bomb overhead.
		return { move, outcome: "parried", damage: 0, x, y, dir };
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
	attacker.hitLatch = true;

	switch (result.outcome) {
		case "parried": {
			// The guard break: the attacker is thrown off balance for a full
			// second — drawn raising their sword helplessly — and the defender
			// gets a Massive, which is what makes reading a swing pay.
			attacker.stunTimer = GUARD_BREAK_STUN_MS;
			attacker.guardBroken = true;
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
			// The whole reward: a full Massive, fired on the next attack press and
			// gone after `PARRY_MASSIVE_LIFETIME_MS`. The defender's stun from the
			// break (this same result's other half, one fighter over) will clear
			// the attacker's charge on the very next tick — the stun gate resets
			// `chargeTimer`, so the guard break also spends whatever the attacker
			// was holding.
			defender.massiveReady = true;
			defender.parryMassiveTimer = PARRY_MASSIVE_LIFETIME_MS;
			return 0;
		}

		default: {
			// The shared hit branch — see `applyHitToDefender`. A normal swing
			// additionally spends the attacker's `hitLatch`, because a swing hits
			// at most one fighter; only the thrust's sweep skips that.
			const damage = applyHitToDefender(defender, result);
			attacker.hitLatch = true;
			return damage;
		}
	}
}

/**
 * Put a fighter **on the floor**: the knockdown, and the stun it is made of.
 *
 * Two callers, because two kinds of move owe a knockdown at different instants:
 * `applyHitToDefender` on the tick a knockdown lands, and `tickPlayer` on the
 * tick a *launched* fighter's feet come back to the floor — `knockdownPendingTimer`
 * is that debt. Both go through here so the two rules that make a knockdown a
 * knockdown can never be applied apart: a knockdown **is** a stun as well (a
 * fighter lying on the floor who can act is exactly what the `illegalActions`
 * diagnostic catches), and it is the one thing that ends a Death Blossom.
 */
export function applyKnockdown(s: MeleeBody, ms: number): void {
	s.knockdownTimer = ms;
	s.stunTimer = Math.max(s.stunTimer, ms);
	// Being on the floor pays any knockdown the air was owed, so a launch that
	// ends in a knockdown cannot be knocked down twice for the same mistake.
	s.knockdownPendingTimer = 0;
	// The knockdown is the one interrupt of a Death Blossom: the chain's
	// finisher, the thrust, the shoryuken and the plunge blast all end the
	// storm on the same tick both sides simulate, which is what keeps the
	// interrupt from needing a message of its own. Ordinary hitstun never
	// reaches here, so a slash inside the storm only slows the caster, it
	// does not stop them — the whole design of the ability, in one `if`.
	if (s.blossomTimer !== undefined) s.blossomTimer = 0;
}

/**
 * Apply a resolved hit to the *defender*, with nothing latched on the attacker.
 *
 * The thrust's sweep is multi-target: it knocks down everyone in its path, so
 * the attacker's `hitLatch` must never close on the first victim. This is the
 * shared half of `applyMeleeResult`'s hit branch, extracted so the sweep loops
 * can apply a stat card per victim without spending the attacker's latch.
 */
export function applyHitToDefender(
	defender: MeleeBody,
	result: MeleeResult,
): number {
	const def = MOVES[result.move];
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
		const ms = def.knockdownMs ?? KNOCKDOWN_MS;
		if (def.knockdownOnLanding) {
			// A launch and a slam are the same tick apart and opposite in
			// direction, so the uppercut's victim keeps their arc and pays for
			// it on the floor. `tickPlayer` collects; nothing here touches `vy`.
			defender.knockdownPendingTimer = Math.max(
				defender.knockdownPendingTimer,
				ms,
			);
		} else {
			applyKnockdown(defender, ms);
			defender.vy = Math.max(defender.vy, KNOCKDOWN_SLAM_VY);
		}
	}
	defender.meleeAction = "none";
	defender.meleeTimer = 0;
	defender.hitLatch = false;
	defender.blocking = false;
	defender.comboStep = 0;
	defender.comboTimer = 0;
	defender.plungeStuckTimer = 0;
	return def.damage;
}

/**
 * The region a sweeping move has covered so far this cast, or null when the
 * move is not mid-sweep.
 *
 * The thrust dash is a straight line at a pinned Y — velocity is constant
 * during the active window, so the ground it has covered is a pure function of
 * `meleeTimer`, and the whole swept box (where the body has been, plus the
 * reach ahead of it) is derivable from current state alone. That is what lets
 * the server hit **everyone** in the path without needing the attacker's
 * previous position — and lets the client predict the same box for nothing.
 */
export function sweptThrustBox(s: MeleeBody): Rect | null {
	if (s.meleeAction !== "thrust" || s.hitLatch) return null;
	if (meleePhase(s) !== "active") return null;
	const def = MOVES.thrust;
	// A root freezes the lunge mid-flight: the body stopped on the catch
	// (tickPlayer zeroed the velocity and stopped pinning `selfVx`), so the
	// box is the reach ahead of the frozen body — never the rest of the arc
	// the cast *would* have covered. Claiming the phantom travel would hand a
	// rooted lunge a sweep it never earned.
	const travelled =
		(s.rootTimer ?? 0) > 0
			? 0
			: (Math.max(0, s.meleeTimer - def.startupMs) / MS_PER_SECOND) *
				(def.selfVx ?? 0);
	const facing = s.facing >= 0 ? 1 : -1;
	return {
		x: facing > 0 ? s.x - travelled : s.x - def.reachPx - travelled,
		y: s.y + def.boxTopOffset,
		w: travelled + def.reachPx + PLAYER_WIDTH,
		h: def.boxHeight,
	};
}
