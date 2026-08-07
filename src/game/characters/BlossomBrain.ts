/**
 * The Death Blossom: when to hold the button and when to let go.
 *
 * The cast fires on the *release* of the ultimate button, so this module runs
 * the same small hold state machine as `UltimateBrain` — commit → hold →
 * release — with one difference: **there is nothing to aim**. The storm is
 * radial, so this brain never overrides the aim angle (`aimOverride` stays
 * null) and the coordinator's ordinary gun aim survives the hold.
 *
 * The cast itself is the server's decision, gated on facts only it holds.
 * This module only decides to *ask*; a refused cast (a storm already open, a
 * stun, a freeze) costs nothing because the charge is spent on success only.
 */

import { BLOSSOM_RADIUS_PX, ULT_MAX_CHARGE } from "../simulation/Ultimate.js";
import type { AIInput, TeamRole } from "./types.js";

/**
 * Longest a bot is willing to hold the aim phase before committing. The
 * blossom's hold has no aim to line up, so it is the shortest of the three
 * ultimates' — every extra held millisecond is a millisecond a knockdown can
 * land and the storm dies unborn.
 */
const HOLD_MIN_MS = 160;
const HOLD_MAX_MS = 260;
/** Grace after a cast (or a refused one) before the brain will aim again. */
const POST_CAST_COOLDOWN_MS = 1500;
/** A storm is worth it when two or more foes are inside the ring. */
const CLUSTER_RADIUS_PX = BLOSSOM_RADIUS_PX * 0.92;
/** A killshot: the enemy is one storm beat from dead. */
const FINISHER_HP = 25;
/**
 * The patience rule: an ultimate held ready forever is a weapon that does not
 * exist — the same rule the black hole's brain has, because it exists for the
 * same reason: measured across whole matches, moment-based rules alone
 * produced zero casts.
 */
const ARMED_PATIENCE_MS = 10000;

export class BlossomBrain {
	/** True while the button is held — the (brief) aim phase. */
	private holding = false;
	/** ms remaining on the aim phase before the release. */
	private holdMs = 0;
	/** ms until this brain will consider aiming again. */
	private cooldown = 0;
	/** ms the meter has been full, for the patience rule. */
	private armedTimer = 0;
	/** Why the last armed tick declined to aim — for the diagnostic. */
	private lastDecline: string | null = null;
	/** How many times this brain started the aim phase. */
	private aimStarts = 0;
	/** How many aim phases completed (a release — a cast request). */
	private releases = 0;

	reset() {
		this.holding = false;
		this.holdMs = 0;
		this.cooldown = 0;
		this.armedTimer = 0;
		this.lastDecline = null;
		this.aimStarts = 0;
		this.releases = 0;
	}

	/** The state the coordinator and the diagnostic can read. */
	get insight() {
		return {
			holding: this.holding,
			armedTimerMs: Math.round(this.armedTimer),
			cooldownMs: Math.round(this.cooldown),
			lastDecline: this.lastDecline,
			aimStarts: this.aimStarts,
			releases: this.releases,
		};
	}

	/** The blossom is radial — there is no aim to override. */
	get aimOverride(): number | null {
		return null;
	}

	/**
	 * Decide the ultimate button state for this tick.
	 *
	 * The blossom is a *self-centred* ultimate, so the whole decision is one
	 * question: how many foes are already inside the ring? The caster does not
	 * aim the storm; the storm is where they already are.
	 */
	decide(input: AIInput, delta: number, role: TeamRole | null) {
		this.cooldown = Math.max(0, this.cooldown - delta);

		// The aim phase is a commitment already made: run its clock out.
		if (this.holding) {
			this.holdMs -= delta;
			if (this.holdMs <= 0) {
				// Release: the cast fires server-side.
				this.holding = false;
				this.cooldown = POST_CAST_COOLDOWN_MS;
				this.releases++;
			}
			return;
		}

		if (this.cooldown > 0) {
			this.lastDecline = "cooldown";
			return;
		}
		if (input.selfUltCharge < ULT_MAX_CHARGE) {
			this.armedTimer = 0;
			this.lastDecline = "not-armed";
			return;
		}
		this.armedTimer += delta;
		if (input.selfStunned) {
			this.lastDecline = "stunned";
			return;
		}
		if (input.foes.length === 0) {
			this.lastDecline = "no-foes";
			return;
		}

		// The one interrupt of a storm is a knockdown — the chain's finisher,
		// the thrust, the shoryuken, a massive's blast. A foe inside the ring
		// mid-startup of one can land it inside the channel, so the cast waits
		// for that tell to pass: a storm thrown into a read knockdown is a
		// storm that dies unborn.
		const knockdownReady =
			(input.enemyAction === "thrust" ||
				input.enemyAction === "shoryuken" ||
				input.enemyAction === "slash3" ||
				input.enemyAction === "massive") &&
			input.enemyPhase === "startup";
		if (knockdownReady && input.distanceToPlayer <= CLUSTER_RADIUS_PX) {
			this.lastDecline = "knockdown-ready";
			return;
		}

		if (!this.choose(input, role)) {
			this.lastDecline = "no-target";
			return;
		}
		this.lastDecline = "casting";
		this.holding = true;
		this.holdMs = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
		this.aimStarts++;
	}

	/** Is a storm worth starting right now? */
	private choose(input: AIInput, role: TeamRole | null): boolean {
		// The crowd: two or more foes inside the ring are the storm's reason
		// to exist — or one foe with an ally in the ring, because a fight the
		// team is already in is a fight the enemy is committed to, and a
		// committed enemy cannot just walk out of the storm.
		let inRing = 0;
		let finisher = false;
		for (const foe of input.foes) {
			if (foe.distance <= CLUSTER_RADIUS_PX) {
				inRing++;
				if (foe.hp <= FINISHER_HP) finisher = true;
			}
		}
		const alliesInRing = input.allies.filter(
			(a) => a.alive && a.distance <= CLUSTER_RADIUS_PX,
		).length;
		if (inRing >= 2 || (inRing >= 1 && alliesInRing >= 1)) return true;
		// A support being swarmed answers with the storm under its own feet —
		// the one ult that fights exactly where the caster already is.
		if (role === "support" && inRing >= 1) return true;
		// A killshot on offer: one good beat finishes them.
		if (finisher) return true;
		// Outnumbered, or the meter has been full too long — spend it on the
		// nearest foe that can still be caught.
		if (input.foes.length > input.allies.length + 1) return true;
		if (this.armedTimer > ARMED_PATIENCE_MS) {
			return input.foes.some((f) => f.distance <= CLUSTER_RADIUS_PX);
		}
		return false;
	}

	/** The button state this module produces. */
	get hold(): boolean {
		return this.holding;
	}
}
