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
	 * The payoff for a 2.5s charge or a guard break. The swing comes down on the
	 * floor a little in front of the fighter, and what matters about it is what
	 * happens *when it reaches the floor*: the blast that follows is front and
	 * back of the slam point, and it stuns through a guard — which is the whole
	 * "back massive" technique.
	 *
	 * Unlike the old unblockable heavy, **the swing itself can be read and
	 * blocked.** A defender standing in the swing path stops the blade before it
	 * touches the floor, and every block of a sword attack is a guard break — so
	 * a front massive thrown into a turtle is a gift, and the answers to a turtle
	 * are the blast behind you and the plunge bomb above you.
	 */
	massive: {
		/**
		 * Short wind-up because the charge already *was* the wind-up: the sword
		 * is raised for the whole hold, so the swing needs no time to get there.
		 */
		startupMs: 90,
		/** The blade comes down; the floor contact lands at the end of this. */
		activeMs: 130,
		/**
		 * Pulling the sword out of the floor. Longer than the old recovery,
		 * because a move whose blast reaches 100px past the fighter cannot also
		 * leave them free.
		 */
		recoveryMs: 460,
		damage: 24,
		/** The swing's hitbox reaches the slam point and no further. */
		reachPx: 40,
		/** The swing cuts from mid-body down to the feet, where the floor is. */
		boxTopOffset: 20,
		boxHeight: 28,
		/**
		 * Blockable, and that is the point: a turtle can stop the swing by being
		 * *in* its path — and pays nothing, because blocking the swing is the
		 * same guard break as blocking a slash. See `MASSIVE_SLAM_OFFSET_PX`.
		 */
		blockable: true,
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

/**
 * Hold the attack button this long to arm a Massive Strike.
 *
 * 2.5s — long enough that arming in somebody's face is a read they can punish
 * (a stun, a guard break, a stance switch all spend it), short enough that the
 * armed delivery phase — walk it in, hop it into a bomb — is the majority of
 * the commitment rather than a distant reward. The original 4s made the
 * charge itself the whole move, and the fighter spent most of the gesture
 * standing still.
 */
export const MASSIVE_CHARGE_MS = 2500;
/**
 * Hold past this and the charge roots your walk.
 *
 * The root cannot begin on the press itself: a butterfly tap is a press held
 * ~55ms, and a chain link ~75ms, and neither must lose its mobility — the
 * butterfly is the *mobile* pressure technique. This threshold sits past every
 * cancel a slash offers, so only a hold that has outlived the slash's own
 * decisions commits to the charge.
 */
export const CHARGE_LOCK_MS = 250;
/**
 * How long a guard-break-granted Massive stays armed before it fades.
 *
 * The reward for reading a swing is real but perishable: 4s to spend it,
 * because it must be spent with intent — a free Massive that hung around
 * forever would replace the sword game with a waiting game.
 */
export const PARRY_MASSIVE_LIFETIME_MS = 4000;
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
 * side, slows you down, and every sword hit it stops turns the exchange around
 * completely — not because the button is sticky.
 */
export const BLOCK_STARTUP_MS = 0;
/** What a guard-broken attacker eats. Long enough for the free Massive to land. */
export const GUARD_BREAK_STUN_MS = 1000;
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

// ---------------------------------------------------------------------------
// The massive's floor blast
// ---------------------------------------------------------------------------

/**
 * How far in front of the body's centre the sword tip hits the floor.
 *
 * A little in front, not at the feet — the whole geometry of the move depends
 * on it. The swing's hitbox reaches exactly this far, so a defender *in* the
 * swing path can read and block it; anything past the slam point is out of the
 * swing and into the blast. And the blast radiates front **and back** of this
 * point, which is what makes a fighter who turned away from a turtle a threat:
 * the turtle behind them is outside the swing but inside the blast.
 */
export const MASSIVE_SLAM_OFFSET_PX = 56;
/**
 * The blast's radius around the slam point, front and back equally.
 *
 * 100px either side: from the slam point the front reach ends ~156px past the
 * body's centre, and the back reach ~44px past it — far enough that a blocking
 * fighter standing on the attacker's back is caught, which is the back-massive.
 */
export const MASSIVE_BLAST_RADIUS_PX = 100;
export const MASSIVE_BLAST_DAMAGE = 24;
/**
 * The blast's stun goes **through a guard** — that is the entire point of the
 * back massive, and of the massive generally: the answer to a turtle is not to
 * out-swing them but to make the floor explode where they stand.
 */
export const MASSIVE_BLAST_STUN_MS = 650;
/** Horizontal shove away from the slam point, so the fight separates. */
export const MASSIVE_BLAST_KNOCKBACK_PX_S = 240;

// ---------------------------------------------------------------------------
// The plunge bomb (an airborne massive)
// ---------------------------------------------------------------------------

/**
 * The dive's speed. Faster than `MAX_FALL_SPEED` (950) — the bomb is not
 * falling, it is *pressing* — and fast enough that the whole dive reads as one
 * deliberate line rather than a fall you could second-guess.
 */
export const PLUNGE_SPEED = 1500;
/** How fast a dive sheds its horizontal velocity: a bomb falls straight down. */
export const PLUNGE_DECEL = 3000;
/**
 * Fall heights beyond this buy nothing. The arena's high ledges are ~300px
 * above the floor, so a cap well past that keeps the formulas honest without
 * letting a corner of the map turn into a nuke. The per-value maxima below
 * are the value of exactly this fall: 450 + 500·0.5 = 700, and so on, so the
 * cap is *the* big bomb rather than an unreachable tail.
 */
const PLUNGE_MAX_FALL_PX = 500;
const PLUNGE_DAMAGE = 24;

export const PLUNGE_BLAST_BASE_RADIUS_PX = 70;
const PLUNGE_BLAST_RADIUS_PER_PX = 0.12;
export const PLUNGE_BLAST_MAX_RADIUS_PX = 130;
/** Stun grows with the bomb; a 500px fall stuns for the full 700ms. */
export const PLUNGE_STUN_BASE_MS = 450;
const PLUNGE_STUN_PER_PX_MS = 0.5;
export const PLUNGE_STUN_MAX_MS = 700;
/** Knockup (upward launch) grows with the bomb, from a hop toward a full jump. */
export const PLUNGE_KNOCKUP_BASE = -250;
const PLUNGE_KNOCKUP_PER_PX = -0.9;
export const PLUNGE_KNOCKUP_MAX = -700;
/**
 * The bomber's own punishment: the sword is stuck in the ground, and the bigger
 * the bomb the longer it takes to pull out. Only a melee hit ends it early.
 */
export const PLUNGE_STUCK_BASE_MS = 400;
const PLUNGE_STUCK_PER_PX_MS = 0.8;
export const PLUNGE_STUCK_MAX_MS = 800;
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
		parryMassiveTimer: 0,
		plunging: false,
		plungeStuckTimer: 0,
		plungeOriginY: 0,
		guardBroken: false,
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
	target.parryMassiveTimer = source.parryMassiveTimer;
	target.plunging = source.plunging;
	target.plungeStuckTimer = source.plungeStuckTimer;
	target.plungeOriginY = source.plungeOriginY;
	target.guardBroken = source.guardBroken;
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

function startMove(s: MeleeState, move: MeleeMove) {
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
 *   timers → stun gate → plunge gate → stuck gate → stance → block → move
 *   start → move advance → edges.
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

	// ---- plunge ----
	//
	// The dive discards intent entirely: the bomb is committed the moment the
	// release was judged airborne. It ends in `tickPlayer`, at floor contact —
	// the same shared code that plants the fighter in the ground.
	if (s.plunging) {
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

	// ---- block ----
	if (sword && input.block) {
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

		if (neutral && uppercutPress) {
			startMove(s, "uppercut");
		} else if (neutral && s.massiveReady) {
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
	const def = MOVES[result.move];
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
			// Any melee hit breaks a stuck bomber free — the one thing that can.
			// The hit's own stun and knockback then play out normally on top.
			defender.plungeStuckTimer = 0;
			return def.damage;
		}
	}
}
