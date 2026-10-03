/**
 * Rupture: when to hold the button and when to let go. See specs/ibiriki.md.
 *
 * The curse is global — no aim, no radius — so, like the storm's brain, this
 * one never overrides the aim (`aimOverride` stays null). The question it asks
 * is only *is now worth six seconds of the whole room standing still*: when
 * several foes are alive (more bodies to bleed), when a foe is low and running
 * (moving is exactly what the curse punishes), or when the meter has been full
 * too long.
 *
 * The cast is the server's decision; a refused cast costs nothing.
 */

import type { AIInput, TeamRole } from "./types.js";

/** The hold is a press-and-release: there is nothing to line up. */
const HOLD_MIN_MS = 120;
const HOLD_MAX_MS = 220;
/** Grace after a cast (or a refused one) before the brain will ask again. */
const POST_CAST_COOLDOWN_MS = 1500;
/** Two foes alive is two bodies bleeding: always worth it. */
const CROWD = 2;
/** A low foe who is moving away is exactly whom the curse kills. */
const FLEEING_HP = 40;
/** A foe within this of Ibiriki is a foe whose blade can interrupt the stomp. */
const STOMP_UNSAFE_PX = 70;
/** The patience rule, shared with every ultimate brain. */
const ARMED_PATIENCE_MS = 8000;

export class RuptureBrain {
	private holding = false;
	private holdMs = 0;
	private cooldown = 0;
	private armedTimer = 0;
	private lastDecline: string | null = null;
	private aimStarts = 0;
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

	/** The curse is global — there is no aim to override. */
	get aimOverride(): number | null {
		return null;
	}

	get hold(): boolean {
		return this.holding;
	}

	decide(input: AIInput, delta: number, _role: TeamRole | null) {
		this.cooldown = Math.max(0, this.cooldown - delta);
		if (this.holding) {
			this.holdMs -= delta;
			if (this.holdMs <= 0) {
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
		if (input.selfUltCharge < input.selfUltCap) {
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
		if (input.ruptureActive) {
			this.lastDecline = "already-cursed";
			return;
		}
		// The stomp roots Ibiriki for a beat: never in a live swing's reach.
		const pressed =
			input.distanceToPlayer < STOMP_UNSAFE_PX &&
			input.enemyPhase !== "none" &&
			input.enemyPhase !== "recovery";
		if (pressed) {
			this.lastDecline = "pressed";
			return;
		}
		const crowd = input.foes.length >= CROWD;
		const fleeing =
			input.enemyHP <= FLEEING_HP &&
			(input.playerX - input.selfX) * input.enemyVX > 0;
		const patient = this.armedTimer > ARMED_PATIENCE_MS;
		if (!crowd && !fleeing && !patient) {
			this.lastDecline = "no-reason";
			return;
		}
		this.lastDecline = "casting";
		this.holding = true;
		this.holdMs = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
		this.aimStarts++;
	}
}
