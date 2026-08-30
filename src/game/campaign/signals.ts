/**
 * The lesson tracker: everything a player did since the lesson armed, counted.
 *
 * This is the honest half of the tutorial. An objective is a pure question
 * about a number; this class is what makes the number true, and it earns that
 * the same way the training room's `ExchangeWatcher` does — by **observing
 * state rather than trusting intent**. A tracker that counted button presses
 * would tick "you dashed" for a dash the simulation refused (on cooldown,
 * rooted, mid-recovery), and the tutorial would congratulate a player for
 * something that never happened on screen. Every movement counter here is a
 * transition in the local fighter's own predicted body, and every combat
 * counter is a decision the **server** already made and sent.
 *
 * It is deliberately not a second measurement stack: the training room already
 * counts damage, bullets and blocks server-side, and those arrive here as a
 * delta against the numbers the lesson opened with.
 */

import type { MeleeEventMsg } from "../online/types.js";
import type { MeleeAction, PlayerPosition } from "../simulation/Physics.js";
import { MOVES, moveDuration, zeroMoveCounts } from "../simulation/Physics.js";
import type { TrainingFighterStats } from "../training/types.js";
import type { LessonCounters } from "./types.js";

/** A fresh, all-zero counter record. */
export function zeroCounters(): LessonCounters {
	return {
		elapsedMs: 0,
		movesStarted: zeroMoveCounts(),
		movesLanded: zeroMoveCounts(),
		walkedPx: 0,
		jumps: 0,
		airJumps: 0,
		dashes: 0,
		airDashes: 0,
		tumbles: 0,
		wallJumps: 0,
		stanceSwitches: 0,
		blocksRaised: 0,
		butterflies: 0,
		massiveArmed: 0,
		plunges: 0,
		guardBreaksSuffered: 0,
		parries: 0,
		backstabs: 0,
		knockdowns: 0,
		blasts: 0,
		bombs: 0,
		explosions: 0,
		roots: 0,
		ultimates: 0,
		denies: 0,
		itemsUsed: 0,
		reloads: 0,
		bulletsFired: 0,
		bulletHits: 0,
		damageDealt: 0,
		damageTaken: 0,
		damageBlocked: 0,
		knockouts: 0,
	};
}

/** The fields of the local body a transition can be read from. */
interface BodySample {
	meleeAction: MeleeAction;
	x: number;
	grounded: boolean;
	vy: number;
	airJumps: number;
	dashActiveTimer: number;
	tumbleActiveTimer: number;
	wallJumpTimer: number;
	stance: string;
	blocking: boolean;
	massiveReady: boolean;
	plunging: boolean;
	reloadTimer: number;
}

function sample(body: PlayerPosition): BodySample {
	return {
		meleeAction: body.meleeAction,
		x: body.x,
		grounded: body.grounded,
		vy: body.vy,
		airJumps: body.airJumps,
		dashActiveTimer: body.dashActiveTimer,
		tumbleActiveTimer: body.tumbleActiveTimer,
		wallJumpTimer: body.wallJumpTimer,
		stance: body.stance,
		blocking: body.blocking,
		massiveReady: body.massiveReady,
		plunging: body.plunging,
		reloadTimer: body.reloadTimer,
	};
}

/**
 * How early a move has to end for the cancel to count as a butterfly.
 *
 * A move that runs its full length ends on its own; one that ends *before*
 * that, with a guard already up, was cancelled into the block. The margin
 * absorbs the frame the observation is taken on — a move measured one frame
 * short of its declared length was not cancelled, it merely finished between
 * two samples.
 */
const CANCEL_MARGIN_MS = 40;

/**
 * The largest single-frame step that can be a walk.
 *
 * A walk is a couple of pixels a frame; anything larger is a correction the
 * netcode applied — a respawn snap, a reconciliation rewind — and folding those
 * into "ground covered" would let a lesson complete itself during its own
 * reset.
 */
const WALK_STEP_MAX_PX = 16;

export class LessonTracker {
	private counters: LessonCounters = zeroCounters();
	private prev: BodySample | null = null;
	/** The move in flight and how long it has run — for the butterfly. */
	private moveElapsedMs = 0;
	/** The server's tallies when the lesson armed; every stat is a delta on it. */
	private statBase: TrainingFighterStats | null = null;
	/** Item charges last seen, so a spend is a fall rather than a value. */
	private itemCharges: number | null = null;
	/** True while the dummy is up, so a knockout is counted once per fall. */
	private dummyUp = true;

	/** Arm a fresh lesson: everything back to zero, nothing carried over. */
	reset() {
		this.counters = zeroCounters();
		this.prev = null;
		this.moveElapsedMs = 0;
		this.statBase = null;
		this.itemCharges = null;
		this.dummyUp = true;
	}

	/** The counters as they stand. A copy: nothing outside here may mutate them. */
	snapshot(): LessonCounters {
		return {
			...this.counters,
			movesStarted: { ...this.counters.movesStarted },
			movesLanded: { ...this.counters.movesLanded },
		};
	}

	/**
	 * One frame of the local fighter.
	 *
	 * Called with the *predicted* body, which is the one the player is watching.
	 * A dash the server later corrects away would be counted here and not there —
	 * and counting what the player saw is the right answer for a tutorial, where
	 * the lesson is the input, not the outcome.
	 */
	observe(body: PlayerPosition, dtMs: number) {
		this.counters.elapsedMs += dtMs;
		const now = sample(body);
		const before = this.prev;
		this.prev = now;
		if (!before) return;

		// -- melee moves, and the cancel that makes the butterfly ---------------
		if (now.meleeAction !== before.meleeAction) {
			if (
				before.meleeAction !== "none" &&
				now.meleeAction === "none" &&
				now.blocking &&
				this.moveElapsedMs < moveDuration(before.meleeAction) - CANCEL_MARGIN_MS
			) {
				this.counters.butterflies++;
			}
			this.moveElapsedMs = 0;
			if (now.meleeAction !== "none")
				this.counters.movesStarted[now.meleeAction]++;
		} else if (now.meleeAction !== "none") {
			this.moveElapsedMs += dtMs;
		}

		// -- feet ---------------------------------------------------------------
		// Ground covered on foot. A dash, a tumble and a respawn's snap are all
		// excluded: the objective is "learn to walk", and a burst that carries the
		// body 200px in three frames would finish it before the player had read it.
		if (
			now.grounded &&
			now.dashActiveTimer <= 0 &&
			now.tumbleActiveTimer <= 0 &&
			Math.abs(now.x - before.x) < WALK_STEP_MAX_PX
		) {
			this.counters.walkedPx += Math.abs(now.x - before.x);
		}
		// A jump is leaving the ground *upward*: walking off a ledge is not one.
		if (before.grounded && !now.grounded && now.vy < 0) this.counters.jumps++;
		if (!now.grounded && now.airJumps < before.airJumps)
			this.counters.airJumps++;
		if (before.wallJumpTimer <= 0 && now.wallJumpTimer > 0)
			this.counters.wallJumps++;
		if (before.dashActiveTimer <= 0 && now.dashActiveTimer > 0) {
			this.counters.dashes++;
			if (!now.grounded) this.counters.airDashes++;
		}
		if (before.tumbleActiveTimer <= 0 && now.tumbleActiveTimer > 0)
			this.counters.tumbles++;

		// -- hands --------------------------------------------------------------
		if (now.stance !== before.stance) this.counters.stanceSwitches++;
		if (!before.blocking && now.blocking) this.counters.blocksRaised++;
		if (!before.massiveReady && now.massiveReady) this.counters.massiveArmed++;
		if (!before.plunging && now.plunging) this.counters.plunges++;
		if (before.reloadTimer <= 0 && now.reloadTimer > 0) this.counters.reloads++;
	}

	/**
	 * A server-judged melee outcome. `byLocal` says whose swing it was, and it
	 * decides the meaning of every outcome: a parry is *their* attack your guard
	 * stopped, a guard break is *your* attack theirs did.
	 */
	noteMelee(event: MeleeEventMsg, byLocal: boolean) {
		if (byLocal) {
			switch (event.outcome) {
				case "hit":
				case "backstab": {
					this.counters.movesLanded[event.move]++;
					if (event.outcome === "backstab") this.counters.backstabs++;
					if (MOVES[event.move].knockdown) this.counters.knockdowns++;
					break;
				}
				case "parried":
					this.counters.guardBreaksSuffered++;
					break;
				case "blast":
					this.counters.blasts++;
					this.counters.movesLanded[event.move]++;
					break;
				case "bomb":
					this.counters.bombs++;
					this.counters.movesLanded[event.move]++;
					break;
			}
			return;
		}
		if (event.outcome === "parried") this.counters.parries++;
	}

	noteDeny() {
		this.counters.denies++;
	}

	noteExplosion() {
		this.counters.explosions++;
	}

	noteRooted() {
		this.counters.roots++;
	}

	noteUltimateCast() {
		this.counters.ultimates++;
	}

	/**
	 * The item charge readout. A *spend* is a fall — a refill (the reset every
	 * lesson opens with) must never read as two more throws.
	 */
	noteItemCharges(charges: number) {
		const before = this.itemCharges;
		this.itemCharges = charges;
		if (before !== null && charges < before)
			this.counters.itemsUsed += before - charges;
	}

	/** The server's own tallies for the local fighter, as a delta on the base. */
	noteStats(stats: TrainingFighterStats) {
		if (!this.statBase) this.statBase = { ...stats };
		const base = this.statBase;
		this.counters.bulletsFired = Math.max(
			0,
			stats.bulletsFired - base.bulletsFired,
		);
		this.counters.bulletHits = Math.max(0, stats.bulletHits - base.bulletHits);
		this.counters.damageDealt = Math.max(
			0,
			stats.damageDealt - base.damageDealt,
		);
		this.counters.damageTaken = Math.max(
			0,
			stats.damageTaken - base.damageTaken,
		);
		this.counters.damageBlocked = Math.max(
			0,
			stats.damageBlocked - base.damageBlocked,
		);
	}

	/** The dummy's health, so a lesson can ask for a knockout. */
	noteDummyHp(hp: number) {
		if (hp <= 0 && this.dummyUp) {
			this.dummyUp = false;
			this.counters.knockouts++;
		} else if (hp > 0) {
			this.dummyUp = true;
		}
	}
}
