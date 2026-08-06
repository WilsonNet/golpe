/**
 * The dragon thrust's AI: when Anands holds the button and where she aims.
 *
 * Sister module to `UltimateBrain` with one deliberate difference: the dragon
 * is a **straight line**, not a lob. There is no arc to solve — the aim is
 * just the angle to the target — so the whole strategy is *when*: the dragon
 * is the ultimate that sweeps a line, and the brain holds it for the two
 * moments a line is worth anything: a cluster standing roughly in a row, or
 * a lone foe in finishing range with nowhere to dodge.
 */

import type { AIInput, TeamRole } from "./types.js";

/** A dragon cast is worth it when the foes are this close together in a line. */
const CLUSTER_LINE_GAP_PX = 100;
/** The dragon reaches ~1350px; beyond a screen there is nothing to sweep. */
const COMMIT_RANGE_PX = 640;
/** Finisher HP: the sweep is a killshot below this. */
const FINISHER_HP = 35;
/** A hold aims for this long before the release casts. */
const HOLD_MS = 240;
const HOLD_JITTER_MS = 120;
/** After a cast, this long before the brain will consider another. */
const POST_CAST_COOLDOWN_MS = 1200;
/** A meter held ready this long is spent on the nearest foe it can reach. */
const ARMED_PATIENCE_MS = 10000;
const PATIENCE_RANGE_PX = 560;

export class DragonBrain {
	private holdMs = 0;
	private aiming = false;
	private aim = 0;
	private cooldown = 0;
	private armedTimer = 0;
	private castCount = 0;

	reset() {
		this.holdMs = 0;
		this.aiming = false;
		this.aim = 0;
		this.cooldown = 0;
		this.armedTimer = 0;
	}

	get insight() {
		return {
			holding: this.aiming,
			armedTimerMs: Math.round(this.armedTimer),
			cooldownMs: Math.round(this.cooldown),
			aimStarts: this.castCount,
			releases: this.castCount,
		};
	}

	/** The angle the dragon will fly along, once aiming. */
	get aimOverride(): number | null {
		return this.aiming ? this.aim : null;
	}

	/** The ultimate button, held. The release is the cast. */
	get hold(): boolean {
		return this.aiming;
	}

	decide(input: AIInput, delta: number, role: TeamRole | null) {
		this.cooldown = Math.max(0, this.cooldown - delta);

		if (this.aiming) {
			this.holdMs -= delta;
			this.armedTimer += delta;
			if (this.holdMs <= 0) {
				this.aiming = false;
				this.cooldown = POST_CAST_COOLDOWN_MS;
				this.castCount++;
			}
			return;
		}

		if (input.selfUltCharge < 100) {
			this.armedTimer = 0;
			return;
		}
		this.armedTimer += delta;

		// A refusal: the dragon cannot be cast while the rider cannot act, and
		// it is not worth casting into a black hole that will swallow the line.
		// Mid-move is also refused: a cast cancels the move ("don't switch
		// weapons or ult"), and spending an ultimate to cancel your own
		// shoryuken is a waste the brain should never choose.
		if (
			this.cooldown > 0 ||
			input.selfStunned ||
			input.selfPlunging ||
			input.selfStuck ||
			input.selfAction !== "none"
		) {
			return;
		}

		const target = this.chooseTarget(input, role);
		if (!target) return;

		this.aim = Math.atan2(target.y - input.selfY, target.x - input.selfX);
		this.holdMs = HOLD_MS + Math.random() * HOLD_JITTER_MS;
		this.aiming = true;
	}

	/**
	 * Pick what the line is for, in priority order. The dragon hits everyone
	 * on the line, so the best target is the one with somebody standing
	 * behind them.
	 */
	private chooseTarget(
		input: AIInput,
		role: TeamRole | null,
	): { x: number; y: number } | null {
		// 1. A cluster in a line: a primary foe with another foe within
		//    `CLUSTER_LINE_GAP_PX` of the aim line through them. Two fighters
		//    roughly in a row are what the dragon was made to sweep.
		for (const foe of input.foes) {
			if (foe.distance > COMMIT_RANGE_PX) continue;
			const angle = Math.atan2(foe.y - input.selfY, foe.x - input.selfX);
			for (const other of input.foes) {
				if (other.id === foe.id) continue;
				const gap = Math.abs(
					Math.sin(angle) * (other.x - foe.x) -
						Math.cos(angle) * (other.y - foe.y),
				);
				if (gap < CLUSTER_LINE_GAP_PX) return foe;
			}
		}

		// 2. A killshot: a foe low enough that 30 damage closes it.
		for (const foe of input.foes) {
			if (foe.hp <= FINISHER_HP && foe.distance < COMMIT_RANGE_PX) {
				return foe;
			}
		}

		// 3. A support being rushed: the point-blank dragon detonates through
		//    the rush and knocks the whole push back.
		if (role === "support") {
			const player = input.foes[0];
			if (player && player.distance < 200) return player;
		}

		// 4. Outnumbered: a line through the nearest foe of a larger pack.
		if (input.foes.length > input.allies.length + 1) {
			const nearest = [...input.foes].sort(
				(a, b) => a.distance - b.distance,
			)[0];
			if (nearest && nearest.distance < COMMIT_RANGE_PX) return nearest;
		}

		// 5. Patience: a meter that never empties is a weapon that does not
		//    exist. Ten seconds armed is enough of a plan.
		if (this.armedTimer > ARMED_PATIENCE_MS) {
			const nearest = [...input.foes].sort(
				(a, b) => a.distance - b.distance,
			)[0];
			if (nearest && nearest.distance < PATIENCE_RANGE_PX) return nearest;
		}

		return null;
	}
}
