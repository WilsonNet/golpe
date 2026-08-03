/**
 * The sword game: choosing and playing a melee rhythm.
 *
 * Extracted from `EnemyBrain` so that weapons are modules: this one owns the
 * sword (slash, chain, uppercut, Massive, guard), `UltimateBrain` owns the
 * black hole, and a future weapon gets a module that writes the same
 * `AIOutput`. The brain coordinates; modules do one thing each.
 *
 * Everything here is edge-triggered rhythm, exactly as a human plays: the
 * simulation detects its own press edges, so a technique is a scripted sequence
 * of presses and releases — which is what the butterfly is before it is
 * anything else.
 */

import { isComboSlash } from "../simulation/Melee.js";
import type { AIInput, AIOutput, TeamRole } from "./types.js";

/** Draw the sword inside this range; holster it beyond `SWORD_DISENGAGE_PX`. */
const SWORD_ENGAGE_PX = 210;
/**
 * Hysteresis on the stance decision. Without a gap, a fighter hovering at the
 * boundary would switch weapons every few frames — and since a stance switch
 * cancels a slash, it would cancel its own attacks forever.
 */
export const SWORD_DISENGAGE_PX = 280;
/** Close enough for a slash to reach: body width plus the slash's 42px. */
export const STRIKE_RANGE_PX = 70;
/** The uppercut's shorter reach. It has to be walked into. */
const UPPERCUT_RANGE_PX = 58;
/** Near enough to be worth charging at, far enough not to be punished for it. */
const CHARGE_RANGE_PX = 150;

/** One phase of a scripted melee rhythm: which buttons, for how long. */
interface MeleeBeat {
	ms: number;
	attack?: boolean;
	block?: boolean;
	uppercut?: boolean;
}

/**
 * The butterfly: slash, cancel it into a block, release, repeat.
 *
 * The gap matters as much as the presses. A slash needs a press *edge*, so
 * without releasing the attack button between cycles the fighter would swing
 * once and then stand there holding it — which is exactly the bug that made an
 * earlier AI look like it was attacking while dealing no damage.
 */
const BUTTERFLY: MeleeBeat[] = [
	{ ms: 55, attack: true },
	{ ms: 95, block: true },
	{ ms: 40 },
];

/** A plain committed swing, for when there is no need to be safe. */
const LONE_SLASH: MeleeBeat[] = [{ ms: 55, attack: true }, { ms: 90 }];

/**
 * The ground chain: three presses, spaced to land the moment each link is
 * chainable.
 *
 * The gaps are the technique. A link becomes available when the previous one
 * enters recovery — 160ms after it started — so a press at 170ms catches the
 * window with a frame to spare, and a press any earlier is simply swallowed by
 * the swing already running. Mashing does not produce a combo; this rhythm does,
 * which is the same thing a human has to learn.
 */
const COMBO: MeleeBeat[] = [
	{ ms: 55, attack: true },
	{ ms: 115 },
	{ ms: 55, attack: true },
	{ ms: 115 },
	{ ms: 55, attack: true },
	{ ms: 120 },
];

const UPPERCUT_BEATS: MeleeBeat[] = [{ ms: 60, uppercut: true }, { ms: 120 }];

/**
 * Charge, then let go. The release is what fires the Massive Strike, and it has
 * to be long enough to register as a release before the next press.
 */
const CHARGE_BEATS: MeleeBeat[] = [{ ms: 470, attack: true }, { ms: 90 }];

/** Fire an already-armed Massive: one clean press. */
const RELEASE_MASSIVE: MeleeBeat[] = [{ ms: 60, attack: true }, { ms: 80 }];

const GUARD: MeleeBeat[] = [{ ms: 260, block: true }];

/**
 * Sit behind the guard rather than reading a specific swing.
 *
 * A purely reactive fighter only ever blocks with a *fresh* guard, which is
 * always inside the parry window — so it parries everything and never simply
 * blocks. Turtling is the other half of the defensive game, and it is what the
 * uppercut exists to punish: without anyone ever holding a guard, the answer to
 * a guard has nothing to answer.
 */
const TURTLE: MeleeBeat[] = [{ ms: 700, block: true }];

/** What the coordinator says about this fighter, per tick. */
export interface MeleeContext {
	/** A team role that owns the stance, overriding the range hysteresis. */
	role: TeamRole | null;
	/** 0..10 personality knobs from `AIConfig`. */
	skill: number;
	aggressiveness: number;
}

/**
 * One fighter's sword decisions.
 *
 * Pure state machine over `AIInput`; owned by the `EnemyBrain` that feeds it
 * and applies its writes. Holds the beats, the once-per-threat rolls and the
 * stance hysteresis so the coordinator does not have to.
 */
export class MeleeBrain {
	/** Whether the sword is drawn. Drives the coordinator's spacing too. */
	private drawn = true;
	private beats: MeleeBeat[] | null = null;
	private beatIndex = 0;
	private beatElapsed = 0;
	/** Loops left on a repeating rhythm (the butterfly). */
	private beatLoops = 0;
	/** Whether this particular incoming swing will be guarded. Rolled once. */
	private guardDecision: boolean | null = null;
	/** Whether this particular stun will be punished with a charge. Rolled once. */
	private stunPunishDecision: boolean | null = null;

	reset() {
		this.drawn = true;
		this.beats = null;
		this.beatIndex = 0;
		this.beatElapsed = 0;
		this.beatLoops = 0;
		this.guardDecision = null;
		this.stunPunishDecision = null;
	}

	/** Whether the sword is currently drawn. The coordinator reads this for spacing. */
	get swordDrawn(): boolean {
		return this.drawn;
	}

	/**
	 * Choose and play a melee rhythm, writing into `output`.
	 *
	 * Runs after movement because positioning comes first: the sword game is
	 * decided by where you are standing, and a brain that picked its attack
	 * before its position would swing at nothing. A role that owns the stance
	 * (a team support) overrides the range hysteresis and never draws.
	 */
	decide(input: AIInput, output: AIOutput, delta: number, ctx: MeleeContext) {
		const distance = input.distanceToPlayer;
		this.skill = ctx.skill;
		this.aggressiveness = ctx.aggressiveness;

		if (ctx.role === "support") {
			this.drawn = false;
		} else if (ctx.role === "vanguard") {
			this.drawn = true;
		} else {
			// Hysteresis, so a fighter at the boundary does not switch weapons every
			// frame — a stance switch cancels a slash, so flicker would cancel every
			// attack it ever started.
			if (this.drawn && distance > SWORD_DISENGAGE_PX) this.drawn = false;
			else if (!this.drawn && distance < SWORD_ENGAGE_PX) this.drawn = true;
		}

		output.swordStance = this.drawn;

		if (!this.drawn) {
			this.beats = null;
			return;
		}

		// Stunned: nothing to decide. The simulation discards the input anyway, but
		// dropping the rhythm here means the fighter does not resume a half-played
		// butterfly the instant it recovers.
		if (input.selfStunned) {
			this.beats = null;
			output.attack = false;
			return;
		}

		// The gun's fire button is the sword's swing button, so a ranged decision
		// left standing here would mash the sword. Melee decides from now on.
		output.attack = false;

		// Reactions interrupt; pressure only fills the gaps.
		//
		// A rhythm once started used to run to completion, which meant a fighter
		// mid-butterfly was deaf for up to ~950ms — long enough to miss every
		// swing aimed at it. Measured: 10 guards raised, 0 hits ever blocked. A
		// block that cannot be raised in time is not a mechanic.
		const reaction = this.reactiveTechnique(input, distance);
		// Never interrupt a turtle with a reactive guard. Restarting the block
		// would reset its timer back inside the parry window, so a fighter trying
		// to hold a guard would silently parry instead — and the uppercut would
		// again have nothing to punish.
		const turtling = this.beats === TURTLE && reaction === GUARD;
		if (reaction && !turtling) {
			// Compared by identity, so re-reading the same threat continues the
			// rhythm instead of restarting it from the first beat every tick.
			if (this.beats !== reaction) this.startBeats(reaction);
		} else if (!this.beats) {
			this.startBeats(this.pressureTechnique(input, distance));
		}

		this.playBeats(output, delta);
	}

	/**
	 * Drop whatever rhythm is playing and hold a guard.
	 *
	 * The team brain uses this for the cover guard: a vanguard standing between
	 * the enemy and its support stops attacking and holds the line instead.
	 */
	interruptWithGuard(output: AIOutput) {
		this.beats = null;
		output.attack = false;
		output.block = true;
	}

	/**
	 * Techniques chosen in answer to what the opponent is doing *right now*.
	 *
	 * Re-evaluated every tick and allowed to interrupt whatever is playing,
	 * because every one of these has a window measured in tens of milliseconds.
	 * Returns null when there is nothing to react to.
	 */
	private reactiveTechnique(
		input: AIInput,
		distance: number,
	): MeleeBeat[] | null {
		// The opponent has committed to something long and uncancellable. This is
		// the punish window the heavy moves exist to create.
		const punishable =
			input.enemyPhase === "recovery" &&
			(input.enemyAction === "massive" ||
				input.enemyAction === "uppercut" ||
				// The chain's finisher recovers for 420ms and cannot be cancelled out
				// of, so a whiffed one is the same gift a whiffed Massive is.
				input.enemyAction === "slash3");
		if (punishable && distance < STRIKE_RANGE_PX) {
			return LONE_SLASH;
		}

		// A swing is coming. Blocking it early enough guard-breaks them; blocking
		// late at least survives it.
		//
		// This outranks releasing an armed Massive on purpose. A Massive needs
		// 190ms of startup against a slash that connects in 75, so answering a
		// swing with one loses the exchange *and* the charge.
		const incoming =
			// Any link of the chain, not just its opener: reading only the first
			// swing would leave a bot standing still through the two that follow it.
			isComboSlash(input.enemyAction) &&
			(input.enemyPhase === "startup" || input.enemyPhase === "active") &&
			distance < STRIKE_RANGE_PX + 30;
		// A hurt fighter answers a read by covering up rather than by timing a
		// single parry. That is also the only way a guard ever gets held past the
		// parry window in an AI match — a purely reactive guard is always fresh,
		// so it always parries and a plain block never happens at all.
		if (this.willGuard(incoming)) {
			return input.selfHP <= 60 ? TURTLE : GUARD;
		}

		// They are stunned and cannot answer — the one safe moment to spend 190ms
		// of startup. Rolled once per stun rather than held as a standing rule:
		// charging on every single stun produced a degenerate match that was
		// nothing but stun → charge → Massive → stun, with 6-9 Massives per fight.
		// Since a heavy move forbids blocking for its whole 720ms, that left both
		// fighters unable to guard for most of the match, and not one slash was
		// ever blocked or parried.
		// Already in sword range with the target reeling: this is what the chain is
		// *for*, and it beats charging from here. A Massive from inside strike range
		// spends 190ms of startup to deal 24; the chain spends 75 to open and deals
		// 25 with a knockdown at the end of it.
		//
		// Ordering this above the charge is also what keeps the match a sword fight:
		// longer hitstun made the stun-punish branch fire far more often, and every
		// one of those became a Massive — 11 Massives to 10 slashes in a measured
		// match, with one hit landing all game.
		if (
			input.enemyStunned &&
			input.touchingDown &&
			distance < STRIKE_RANGE_PX &&
			!input.selfMassiveReady
		) {
			return COMBO;
		}

		if (this.willPunishStun(input.enemyStunned) && distance < CHARGE_RANGE_PX) {
			return input.selfMassiveReady ? RELEASE_MASSIVE : CHARGE_BEATS;
		}

		// A charge that is already paid for. Spend it when there is no swing to
		// answer and the target is in reach.
		if (input.selfMassiveReady && distance < STRIKE_RANGE_PX + 20) {
			return RELEASE_MASSIVE;
		}

		// They are turtling. A block only covers the front and cannot stop an
		// uppercut, so there are two answers; take the one the range allows.
		//
		// The window is generous on purpose: once fighters started using the whole
		// arena, close-range guard reads became rare enough that the uppercut —
		// the designed answer to a guard — stopped happening at all across whole
		// matches. A mechanic that never fires is untested.
		if (input.enemyBlocking && distance < UPPERCUT_RANGE_PX + 25) {
			return UPPERCUT_BEATS;
		}

		return null;
	}

	/** Roll once per stun, so a long stun is one decision and not fifty. */
	private willPunishStun(stunned: boolean): boolean {
		if (!stunned) {
			this.stunPunishDecision = null;
			return false;
		}
		if (this.stunPunishDecision === null) {
			this.stunPunishDecision = Math.random() < 0.3 + 0.4 * this.aggressiveness;
		}
		return this.stunPunishDecision;
	}

	/**
	 * Roll once per threat, not once per tick.
	 *
	 * Reading a swing is a single decision a fighter either makes or does not.
	 * Re-rolling every frame would turn any non-zero skill into a certainty
	 * within a few frames, so every bot would block everything.
	 */
	private willGuard(incoming: boolean): boolean {
		if (!incoming) {
			this.guardDecision = null;
			return false;
		}
		if (this.guardDecision === null) {
			this.guardDecision = Math.random() < this.skill / 10;
		}
		return this.guardDecision;
	}

	/** What to do when the opponent is not offering anything to answer. */
	private pressureTechnique(
		input: AIInput,
		distance: number,
	): MeleeBeat[] | null {
		const skill = this.skill / 10;

		if (distance < STRIKE_RANGE_PX) {
			// Hurt fighters cover up. This is the only way a guard gets held past
			// the parry window, so it is also the only thing that makes the
			// uppercut's whole purpose reachable.
			const hurt = input.selfHP <= 60;
			if (hurt && Math.random() < 0.4 - 0.2 * skill) return TURTLE;

			// Close quarters. The butterfly is the default because it is safe *and*
			// it hurts; the ground chain is what a reeling opponent is *for*, and a
			// lone slash is the greedy option when there is no time for either.
			//
			// The chain needs the floor — `canChain` refuses in the air — so a bot
			// that started one mid-jump would throw one slash and then press twice
			// into nothing.
			if (input.touchingDown && Math.random() < 0.35 + 0.2 * skill) {
				return COMBO;
			}
			const greedy = input.enemyAction === "none" && Math.random() < 0.25;
			return greedy ? LONE_SLASH : BUTTERFLY;
		}

		// Out of reach but close enough to threaten: charge, and let the walk
		// toward them arrive at the same time the Massive does. Only when they are
		// not already winding up something of their own.
		if (
			distance < CHARGE_RANGE_PX &&
			input.enemyAction === "none" &&
			Math.random() < 0.25 * skill
		) {
			return CHARGE_BEATS;
		}

		return null;
	}

	/** The knobs this module rolls against, refreshed each decide. */
	private skill = 5;
	private aggressiveness = 0.5;

	private startBeats(beats: MeleeBeat[] | null) {
		this.beats = beats;
		this.beatIndex = 0;
		this.beatElapsed = 0;
		// Only the butterfly repeats; everything else is a single commitment.
		this.beatLoops =
			beats === BUTTERFLY ? 2 + Math.floor(Math.random() * 3) : 0;
	}

	/** Emit the current beat's buttons and advance the rhythm. */
	private playBeats(output: AIOutput, delta: number) {
		if (!this.beats) return;

		const beat = this.beats[this.beatIndex];
		// A rhythm can be replaced mid-play by a reaction, so the index is not
		// guaranteed to still be in range.
		if (!beat) {
			this.beats = null;
			return;
		}
		output.attack = beat.attack ?? false;
		output.block = beat.block ?? false;
		output.uppercut = beat.uppercut ?? false;

		this.beatElapsed += delta;
		if (this.beatElapsed < beat.ms) return;

		this.beatElapsed = 0;
		this.beatIndex++;
		if (this.beatIndex < this.beats.length) return;

		if (this.beatLoops > 0) {
			this.beatLoops--;
			this.beatIndex = 0;
			return;
		}
		this.beats = null;
	}
}
