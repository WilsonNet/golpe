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

import { isComboSlash, MASSIVE_CHARGE_MS } from "../simulation/Melee.js";
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

// Jeffs' shotgun — the executioner's finisher. The sword is his default at
// every range; the shotgun comes out at point blank, when the blast is the
// answer, and holsters again after one blast so the sword covers the 900ms
// cooldown.
/**
 * Inside this, a jeffs bot may pull the shotgun for the finisher blast.
 *
 * The blast range tracks the weapon's damage falloff: at a hundred px the fan
 * still lands most of its pellets at half card damage, and beyond that the
 * blast dies — a bot that pulled at 140px after the falloff landed would be
 * a bot firing a warning shot.
 */
const SHOTGUN_BLAST_RANGE_PX = 100;
/** The shotgun holsters once the foe leaves this much. */
const SHOTGUN_HOLSTER_RANGE_PX = 140;
/** How long the shotgun stays out for one blast, before the sword follows. */
const SHOTGUN_STANCE_MS = 320;

// Decision ranges, in px past a move's own reach. Generous on purpose: these
// reads must fire often enough that the mechanic they feed is actually tested.
/** A swing already in flight threatens a blocker this far beyond its reach. */
const GUARD_READ_GRACE_PX = 30;
/** A paid Massive may be spent this far before the walk closes the gap. */
const MASSIVE_SPEND_GRACE_PX = 20;
/** A turtle is read as coverable this far beyond the uppercut's reach. */
const TURTLE_READ_GRACE_PX = 25;
/**
 * A swing in flight threatens a *walker* this far beyond its reach.
 *
 * The backstep's band: wide enough that a foe who started a swing just outside
 * reach is still walked out of, narrow enough that it never fights the stance
 * hysteresis (a bot that backed out of 100px would holster the sword and the
 * whole melee game would never happen).
 */
const BACKSTEP_GRACE_PX = 36;
/** Base odds of stepping out of an incoming swing, at zero skill. */
const BACKSTEP_BASE_CHANCE = 0.1;
/** Odds per point of skill — a maxed bot walks out of most swings it reads. */
const BACKSTEP_SKILL_CHANCE_PER_POINT = 0.045;

// Chance knobs, rolled once per decision. They scale with the config's
// personality: skill shifts the *skill-dependent* roll, aggressiveness shifts
// the *temperament* one. Split this way so the two knobs stay independent.
const STUN_PUNISH_BASE_CHANCE = 0.3;
const STUN_PUNISH_AGGRO_WEIGHT = 0.4;
/** Below this fraction of max HP a hurt fighter answers with a guard. */
const HURT_HP = 60;
const TURTLE_BASE_CHANCE = 0.4;
const TURTLE_SKILL_WEIGHT = 0.2;
const COMBO_BASE_CHANCE = 0.35;
const COMBO_SKILL_WEIGHT = 0.2;
const LONE_SLASH_CHANCE = 0.25;
/** Charge roll per point of skill — a maxed bot charges a quarter of the time. */
const CHARGE_CHANCE_PER_SKILL = 0.25;
/** How many times the butterfly loops before the bot returns to neutral. */
const BUTTERFLY_LOOPS_MIN = 2;
const BUTTERFLY_LOOPS_RANGE = 3;

// The shotgun pull: how the brain gambles on the finisher blast. Rolled once
// per approach, like the guard decision.
/** A foe a single blast will finish is worth the gamble. */
const KILLSHOT_HP = 60;
const KILLSHOT_BONUS_CHANCE = 0.3;
/** The blast's base odds as the approach closes to point blank. */
const BLAST_BASE_CHANCE = 0.12;
const BLAST_CLOSENESS_WEIGHT = 0.3;
const BLAST_AGGRO_WEIGHT = 0.2;
/** The roll never clears this ceiling — a blast is not the default answer. */
const BLAST_CHANCE_CAP = 0.92;

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
 *
 * The charge now takes `MASSIVE_CHARGE_MS` and plants the fighter — and while
 * planted, the guard is free: holding block alongside the charge is the one
 * delivery tool that needs no movement, and it is strictly better than
 * standing rooted with the sword down.
 */
const CHARGE_BEATS: MeleeBeat[] = [
	{ ms: MASSIVE_CHARGE_MS + 60, attack: true, block: true },
	{ ms: 90 },
];

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
	/** Jeffs: ms the shotgun stays out for one blast. */
	private blastTimer = 0;
	/** Jeffs: the roll for "this approach ends in a blast", decided once. */
	private blastDecision: boolean | null = null;

	reset() {
		this.drawn = true;
		this.beats = null;
		this.beatIndex = 0;
		this.beatElapsed = 0;
		this.beatLoops = 0;
		this.guardDecision = null;
		this.stunPunishDecision = null;
		this.blastTimer = 0;
		this.blastDecision = null;
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
			// A jeffs support is a *smoke* support: its shotgun is a
			// point-blank weapon, so it keeps the sword for the last stand
			// instead of kiting with a gun that cannot reach.
			this.drawn = input.selfHero === "jeffs";
		} else if (ctx.role === "vanguard") {
			this.drawn = true;
		} else if (input.selfHero === "jeffs") {
			this.jeffsStance(input, distance, delta);
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
		// butterfly the instant it recovers. The same goes for the plunge and the
		// stuck — the bomb is committed, and the planted fighter has no buttons.
		if (input.selfStunned || input.selfPlunging || input.selfStuck) {
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
		const guarded = reaction === GUARD || reaction === TURTLE;
		if (reaction && !turtling) {
			// Compared by identity, so re-reading the same threat continues the
			// rhythm instead of restarting it from the first beat every tick.
			if (this.beats !== reaction) this.startBeats(reaction);
		} else if (!this.beats) {
			this.startBeats(this.pressureTechnique(input, distance));
		}

		// Walk out of a swing the guard chose not to stop.
		//
		// The guard is a read and the read fails sometimes; a bot that only ever
		// blocked or swung back stood and ate every swing it failed to read. The
		// third answer is distance: the slash's box is 42px and the walk is
		// 240px/s, so a backstep started the frame the active window is seen
		// takes ~20px off the gap before it closes. Rolled per tick like the
		// guard itself, scaled by skill, and refused while the bot is mid-swing
		// — a committed swing is a commitment, and the state machine will walk
		// the bot back in on the ticks the roll misses.
		const steppingBack =
			!guarded &&
			input.enemyPhase === "active" &&
			distance < STRIKE_RANGE_PX + BACKSTEP_GRACE_PX &&
			input.selfAction === "none" &&
			Math.random() <
				BACKSTEP_BASE_CHANCE + BACKSTEP_SKILL_CHANCE_PER_POINT * this.skill;
		if (steppingBack) {
			output.moveRight = input.playerX <= input.selfX;
			output.moveLeft = input.playerX > input.selfX;
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
	 * The executioner's stance game. The sword is the default at every range;
	 * the shotgun is a **point-blank finisher** — it comes out when the blast
	 * is the answer (a reeling foe is a free blast, a killshot is worth the
	 * gamble), stays out for exactly one blast, and holsters again so the
	 * sword covers the 900ms cooldown. A jeffs bot that kited with the
	 * shotgun at range would be a jeffs bot that never hit anything, so the
	 * gun never comes out beyond the blast range at all.
	 */
	private jeffsStance(input: AIInput, distance: number, delta: number) {
		// The massive's charge and its delivery are the sword's own business:
		// switching stance cancels the charge, so while it is accumulating or
		// the massive is armed, the shotgun waits.
		if (input.selfCharging) return;

		if (distance > SHOTGUN_BLAST_RANGE_PX) this.blastDecision = null;

		if (this.drawn) {
			if (
				distance <= SHOTGUN_BLAST_RANGE_PX &&
				this.willBlast(input, distance)
			) {
				this.drawn = false;
				this.blastTimer = SHOTGUN_STANCE_MS;
			}
			return;
		}

		// Shotgun out. One blast's worth, then the sword returns — unless the
		// foe is still reeling, which is another free blast.
		this.blastTimer -= delta;
		const reeling = input.enemyStunned;
		if (distance > SHOTGUN_HOLSTER_RANGE_PX && !reeling) {
			this.drawn = true;
		} else if (this.blastTimer <= 0 && !reeling) {
			this.drawn = true;
		}
	}

	/**
	 * Is this approach worth ending in a blast? Rolled once per approach, like
	 * the guard decision — a re-roll every frame would make any non-zero skill
	 * a certainty and every stun a guaranteed shotgun.
	 */
	private willBlast(input: AIInput, distance: number): boolean {
		if (input.enemyStunned) return true;
		if (this.blastDecision === null) {
			const closeness = 1 - distance / SHOTGUN_BLAST_RANGE_PX;
			// A foe a single blast will finish is worth the gamble; a foe at
			// full health gets the sword until they are not.
			const killshot = input.enemyHP <= KILLSHOT_HP ? KILLSHOT_BONUS_CHANCE : 0;
			const p =
				BLAST_BASE_CHANCE +
				closeness * BLAST_CLOSENESS_WEIGHT +
				killshot +
				this.aggressiveness * BLAST_AGGRO_WEIGHT;
			this.blastDecision = Math.random() < Math.min(BLAST_CHANCE_CAP, p);
		}
		return this.blastDecision;
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
				input.enemyAction === "slash3" ||
				// The dagger's two commitments: a whiffed thrust and a whiffed
				// shoryuken both leave a 320ms recovery with no hitbox in it.
				input.enemyAction === "thrust" ||
				input.enemyAction === "shoryuken");
		if (punishable && distance < STRIKE_RANGE_PX) {
			return LONE_SLASH;
		}

		// A bomber planted with their sword in the ground is the one opponent who
		// is helpless by definition: no guard, no escape, and only a sword hit
		// ends it. This is the biggest punish in the game.
		if (input.enemyStuck && distance < STRIKE_RANGE_PX) {
			return COMBO;
		}

		// A swing is coming. Blocking it guard-breaks them — every guard does, now
		// — and the attacker spends a full second raised helpless while the
		// defender collects a Massive. This outranks releasing an armed Massive on
		// purpose: a Massive needs its wind-up against a slash that connects in 75,
		// so answering a swing with one loses the exchange *and* the charge.
		const incoming =
			// Any link of the chain, not just its opener: reading only the first
			// swing would leave a bot standing still through the two that follow it.
			(isComboSlash(input.enemyAction) ||
				// And the massive's own swing: it is blockable now, and the guard
				// break that stops it is the same one that stops a slash — so a
				// turtle can read the wind-up and turn the heaviest move in the
				// game into their own free Massive.
				input.enemyAction === "massive" ||
				// A dagger's blockable moves: the stab's spam is exactly what a
				// guard answers — every one stopped is a guard break — and the
				// shoryuken is blockable by design. The thrust is *not* here: a
				// guard cannot stop it, and the read against it is the jump,
				// which EnemyBrain owns.
				input.enemyAction === "stab" ||
				input.enemyAction === "shoryuken") &&
			(input.enemyPhase === "startup" || input.enemyPhase === "active") &&
			distance < STRIKE_RANGE_PX + GUARD_READ_GRACE_PX;
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
		//
		// Airborne first: releasing in the air is the plunge bomb, the one massive
		// a guard cannot stop — and the bot is in the air all the time, so this is
		// also the branch that keeps the bomb actually happening in measured play.
		if (input.selfMassiveReady && !input.touchingDown) {
			return RELEASE_MASSIVE;
		}
		if (
			input.selfMassiveReady &&
			distance < STRIKE_RANGE_PX + MASSIVE_SPEND_GRACE_PX
		) {
			return RELEASE_MASSIVE;
		}

		// They are turtling. A block only covers the front and cannot stop an
		// uppercut, so there are two answers; take the one the range allows.
		//
		// The window is generous on purpose: once fighters started using the whole
		// arena, close-range guard reads became rare enough that the uppercut —
		// the designed answer to a guard — stopped happening at all across whole
		// matches. A mechanic that never fires is untested.
		if (
			input.enemyBlocking &&
			distance < UPPERCUT_RANGE_PX + TURTLE_READ_GRACE_PX
		) {
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
			this.stunPunishDecision =
				Math.random() <
				STUN_PUNISH_BASE_CHANCE +
					STUN_PUNISH_AGGRO_WEIGHT * this.aggressiveness;
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
			const hurt = input.selfHP <= HURT_HP;
			if (
				hurt &&
				Math.random() < TURTLE_BASE_CHANCE - TURTLE_SKILL_WEIGHT * skill
			)
				return TURTLE;

			// Close quarters. The butterfly is the default because it is safe *and*
			// it hurts; the ground chain is what a reeling opponent is *for*, and a
			// lone slash is the greedy option when there is no time for either.
			//
			// The chain needs the floor — `canChain` refuses in the air — so a bot
			// that started one mid-jump would throw one slash and then press twice
			// into nothing.
			if (
				input.touchingDown &&
				Math.random() < COMBO_BASE_CHANCE + COMBO_SKILL_WEIGHT * skill
			) {
				return COMBO;
			}
			const greedy =
				input.enemyAction === "none" && Math.random() < LONE_SLASH_CHANCE;
			return greedy ? LONE_SLASH : BUTTERFLY;
		}

		// Out of reach but close enough to threaten: charge, and let the walk
		// toward them arrive at the same time the Massive does. Only when they are
		// not already winding up something of their own.
		if (
			distance < CHARGE_RANGE_PX &&
			input.enemyAction === "none" &&
			Math.random() < CHARGE_CHANCE_PER_SKILL * skill
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
			beats === BUTTERFLY
				? BUTTERFLY_LOOPS_MIN +
					Math.floor(Math.random() * BUTTERFLY_LOOPS_RANGE)
				: 0;
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
