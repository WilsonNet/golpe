/**
 * The dagger's AI: how Anands fights, module number two beside `MeleeBrain`.
 *
 * Same contract as the sword module — `decide(input, output, delta, ctx)` over
 * the same `AIOutput` — because the dagger uses the *same buttons* with
 * different meanings: attack is the stab (spam, not a swing), block is the
 * thrust (a lunge, never a guard), uppercut is the shoryuken (anti-air).
 *
 * The design is the mirror of the weapon's own design: the dagger has no
 * guard, so the brain takes the initiative — it spams in, reads a whiffed
 * heavy into a thrust, jumps the foe's own thrust back, and anti-airs with
 * the shoryuken. The one thing it never does is what the sword module does
 * as its bread and butter: hold block. There is no block to hold.
 */

import type { AIInput, AIOutput, TeamRole } from "./types.js";

/** The machine gun's comfortable band: outside stab range, inside a screen. */
const GUN_ENGAGE_PX = 120;
const GUN_DISENGAGE_PX = 320;
/** The thrust's closing band: far enough to lunge through, near enough to land. */
const THRUST_RANGE_PX = 190;
/** The shoryuken's anti-air: how close and how high the foe must be. */
const SHORYUKEN_RANGE_PX = 110;
const SHORYUKEN_MIN_RISE_PX = 40;
/** A foe turtling behind a sword guard is a thrust target, not a stab target. */
const TURTLE_THRUST_RANGE_PX = 120;

interface MeleeBeat {
	ms: number;
	press?: Partial<AIOutput>;
}

/** The stab spam: press, release, wait — the whole rhythm is ~190ms. */
const STAB_BEATS: MeleeBeat[] = [
	{ ms: 55, press: { attack: true } },
	{ ms: 55 },
	{ ms: 80 },
];

/**
 * A committed thrust: the block press *is* the move. One press, then wait out
 * the whole 880ms of it — the anticipation, the dash and the recovery — before
 * deciding anything again, so a thrust chain is never a spam.
 */
const THRUST_BEATS: MeleeBeat[] = [
	{ ms: 55, press: { block: true } },
	{ ms: 825 },
];

/** The shoryuken: one uppercut press, then the recovery. */
const SHORYUKEN_BEATS: MeleeBeat[] = [
	{ ms: 55, press: { uppercut: true } },
	{ ms: 200 },
];

export class DaggerBrain {
	private beats: MeleeBeat[] | null = null;
	private beatElapsedMs = 0;
	private drawn = false;

	reset() {
		this.beats = null;
		this.beatElapsedMs = 0;
		this.drawn = false;
	}

	/** The dagger is out — the same question the sword module answers. */
	get swordDrawn(): boolean {
		return this.drawn;
	}

	/**
	 * The vanguard's cover guard. The dagger has no guard; declining quietly
	 * is the whole of the dagger's version.
	 */
	interruptWithGuard(output: AIOutput) {
		this.beats = null;
		output.block = false;
		output.attack = false;
	}

	decide(
		input: AIInput,
		output: AIOutput,
		delta: number,
		ctx: { role: TeamRole | null; skill: number; aggressiveness: number },
	) {
		const distance = input.distanceToPlayer;
		// Stance hysteresis, like the sword's: dagger inside melee reach, the
		// machine gun outside it. The gun's band starts further out than the
		// pistol's — a stream is a longer-ranged weapon than a blade.
		if (ctx.role === "support") this.drawn = false;
		else if (ctx.role === "vanguard") this.drawn = true;
		else if (this.drawn && distance > GUN_DISENGAGE_PX) this.drawn = false;
		else if (!this.drawn && distance < GUN_ENGAGE_PX) this.drawn = true;
		output.swordStance = this.drawn;

		// The gun is the dagger's kiting weapon and it fires on its own clock:
		// hold the trigger and the stream comes out at the weapon's cooldown.
		// The one thing that stops it is melee range — the stream is the
		// answer to distance, not to pressure.
		if (!this.drawn) {
			output.attack = input.hasLineOfSight && distance < 520;
			this.beats = null;
			return;
		}

		if (input.selfStunned || input.selfPlunging || input.selfStuck) {
			this.beats = null;
			output.attack = false;
			return;
		}
		output.attack = false;

		const reactive = this.reactiveTechnique(input, distance, ctx);
		if (reactive) {
			this.beats = reactive;
			this.beatElapsedMs = 0;
		} else if (this.beats === null) {
			this.beats = this.pressureTechnique();
			this.beatElapsedMs = 0;
		}

		this.playBeats(output, delta);
	}

	/**
	 * Reads, in priority order — the same shape as `MeleeBrain.reactiveTechnique`.
	 * The dagger's reads are all *initiative*: it has no guard, so its answers
	 * to the opponent's commitments are commitments of its own.
	 */
	private reactiveTechnique(
		input: AIInput,
		distance: number,
		ctx: { aggressiveness: number; skill: number },
	): MeleeBeat[] | null {
		// The foe is turtling. Stabbing a guard is how the dagger gets guard-
		// broken; the thrust is the one dagger move a guard cannot stop. It has
		// an anticipation the foe can jump, which is why this is a *read* (the
		// foe must be grounded) and not the default answer.
		if (
			input.enemyBlocking &&
			input.enemyGrounded &&
			distance < TURTLE_THRUST_RANGE_PX &&
			Math.random() < 0.55 + 0.4 * ctx.aggressiveness
		) {
			return THRUST_BEATS;
		}

		// The foe is above us: the shoryuken is an anti-air, and it only fires
		// while our own second jump is still in hand — the same gate the
		// simulation enforces, so the brain never asks for a move that will be
		// refused.
		if (
			input.playerY < input.selfY - SHORYUKEN_MIN_RISE_PX &&
			distance < SHORYUKEN_RANGE_PX &&
			input.selfAirJumps > 0
		) {
			return SHORYUKEN_BEATS;
		}

		// A whiffed heavy is a lunge window: the foe is stuck in recovery with
		// no hitbox, and the thrust's anticipation is free — nobody is in a
		// position to jump it. Both commitments of both heroes qualify.
		const punishable =
			input.enemyPhase === "recovery" &&
			(input.enemyAction === "massive" ||
				input.enemyAction === "uppercut" ||
				input.enemyAction === "slash3" ||
				input.enemyAction === "thrust" ||
				input.enemyAction === "shoryuken");
		if (
			punishable &&
			distance < THRUST_RANGE_PX &&
			input.enemyGrounded &&
			Math.random() < 0.35 + 0.5 * ctx.aggressiveness
		) {
			return THRUST_BEATS;
		}

		// The spacing read: a grounded foe in the lunge's band, not doing
		// anything that would stop a lunge landing. The anticipation is the
		// trade — a foe who reads it jumps the line and the dagger eats 480ms
		// of recovery — so this is rolled, never held. Without it, dagger-vs-
		// dagger duels are all stabs and the thrust never exists at all.
		if (
			distance >= 70 &&
			distance < THRUST_RANGE_PX &&
			input.enemyGrounded &&
			input.enemyAction === "none" &&
			Math.random() < 0.14 * (0.6 + ctx.aggressiveness)
		) {
			return THRUST_BEATS;
		}

		// A foe committed to the stab's 190ms can be caught in it: the read is
		// the same one the sword brain makes on a whiffed heavy, only smaller.
		// Rolled low — the stab ends fast, and the anticipation eats most of
		// the window.
		if (
			input.enemyAction === "stab" &&
			input.enemyGrounded &&
			distance < 150 &&
			Math.random() < 0.22
		) {
			return THRUST_BEATS;
		}

		return null;
	}

	/** The default rhythm: stab, stab, stab — the spam that interrupts swings. */
	private pressureTechnique(): MeleeBeat[] {
		return STAB_BEATS;
	}

	/**
	 * Emit the current beat's buttons and advance the clock, exactly like
	 * `MeleeBrain.playBeats`. Inputs are edge-triggered in the simulation, so
	 * a beat list is how the brain presses and releases deliberately.
	 */
	private playBeats(output: AIOutput, delta: number) {
		if (!this.beats) return;
		const beat = this.beats[0];
		if (!beat) {
			this.beats = null;
			return;
		}
		const fresh = this.beatElapsedMs === 0;
		if (fresh) {
			output.attack = beat.press?.attack ?? false;
			output.block = beat.press?.block ?? false;
			output.uppercut = beat.press?.uppercut ?? false;
		} else {
			output.attack = false;
			output.block = false;
			output.uppercut = false;
		}
		this.beatElapsedMs += delta;
		if (this.beatElapsedMs >= beat.ms) {
			this.beatElapsedMs = 0;
			this.beats = this.beats.slice(1);
		}
	}
}
