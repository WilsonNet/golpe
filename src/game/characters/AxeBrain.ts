/**
 * Ibiriki's throwing axes, for a bot: charge to the range, throw on a solved
 * lob, and walk back over the axes on the floor. See specs/ibiriki.md.
 *
 * A thrown weapon fires on the **release** of a held charge, so the gun
 * stance's ordinary "hold the trigger" would charge forever and never throw.
 * This module rewrites the coordinator's trigger: it picks a charge for the
 * distance (a full charge for a far or guarding target — the full axe crushes
 * a guard), holds until the shared `throwChargeTimer` reaches it, and releases
 * on that tick with the aim solved for the speed that charge buys.
 *
 * And because an axe stays where it lands, an empty-handed Ibiriki is not a
 * dry gun — he is a fighter who needs to go for a walk. Low on axes with no
 * foe in his face, the module steers him to the nearest of his own.
 */

import { AXE_CHARGE_MS, AXE_GRAVITY } from "../../tweakables/ranged.js";
import { axeThrowFor } from "../simulation/Axes.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../simulation/Physics.js";
import type { AIInput, AIOutput } from "./types.js";

/** Below this range a tap is enough; past `FULL_RANGE_PX` only a full axe flies far and flat. */
const TAP_RANGE_PX = 140;
const FULL_RANGE_PX = 520;
/** Few axes in hand: worth a walk to pick some back up. */
const LOW_AXES = 4;
/** A foe this close means fight, not shop. */
const SHOPPING_SAFE_PX = 170;
/** How far a bot will walk for an axe. */
const PICKUP_RANGE_PX = 640;
/** An axe this far above the feet needs a jump. */
const JUMP_FOR_AXE_PX = 40;
/** Extra charge on every non-tap throw, for a flatter arc. */
const FLAT_BIAS = 0.3;
/** Never chase the last few milliseconds of a charge: it has to land. */
const CHARGE_SLACK_MS = 20;

export class AxeBrain {
	/** The charge this throw is being held for, or null when not charging. */
	private targetMs: number | null = null;

	reset() {
		this.targetMs = null;
	}

	/**
	 * Rewrite the trigger for a thrown weapon, and walk to the floor's axes.
	 * Runs after the coordinator and every module, so it has the final say on
	 * `attack`, `aimAngle` and, when shopping, the feet.
	 */
	decide(input: AIInput, output: AIOutput) {
		const ammo = input.selfAmmo;
		this.shop(input, output, ammo);

		const gunOut = !output.swordStance;
		if (!gunOut || ammo <= 0) {
			this.targetMs = null;
			if (gunOut) output.attack = false;
			return;
		}
		// A throw starts only down a clear line: a wall in between catches it.
		if (!output.attack && this.targetMs === null) return;
		if (this.targetMs === null && !input.hasLineOfSight) {
			output.attack = false;
			return;
		}

		const charge = input.selfThrowCharge ?? 0;
		if (this.targetMs === null) {
			this.targetMs = this.chargeFor(input);
		}
		const aim = this.solve(input, this.targetMs);
		output.aimAngle = aim;
		if (charge + CHARGE_SLACK_MS >= this.targetMs) {
			// Let go: the server throws at the charge both sides drew.
			output.attack = false;
			this.targetMs = null;
			return;
		}
		output.attack = true;
	}

	/** The charge a throw at this target deserves. */
	private chargeFor(input: AIInput): number {
		const d = input.distanceToPlayer;
		// A guard is crushed only by a full axe; a tap into it is a gift.
		if (input.enemyBlocking || d >= FULL_RANGE_PX) return AXE_CHARGE_MS;
		if (d <= TAP_RANGE_PX) return 0;
		// Biased toward the flat throw: a slow lob over a long gap rises into
		// the arena's ledges, and a faster axe gives the target less time.
		const t = (d - TAP_RANGE_PX) / (FULL_RANGE_PX - TAP_RANGE_PX);
		return Math.round(Math.min(1, FLAT_BIAS + t) * AXE_CHARGE_MS);
	}

	/**
	 * The release angle that drops an axe of this charge on the target: the low
	 * root of the ballistic equation, led by the target's walk over the flight.
	 * Out of reach, the 45-degree lob that flies furthest.
	 */
	private solve(input: AIInput, chargeMs: number): number {
		const v = axeThrowFor(chargeMs).speed;
		const g = AXE_GRAVITY;
		const fromX = input.selfX + PLAYER_WIDTH / 2;
		const fromY = input.selfY + PLAYER_HEIGHT / 3;
		let tx = input.playerX + PLAYER_WIDTH / 2;
		const ty = input.playerY + PLAYER_HEIGHT / 2;
		const flight = Math.abs(tx - fromX) / Math.max(1, v);
		tx += input.enemyVX * flight;
		const dx = tx - fromX;
		// Screen y grows downward; the equation wants up positive.
		const dy = fromY - ty;
		const ax = Math.abs(dx);
		const dir = dx >= 0 ? 1 : -1;
		const disc = v ** 4 - g * (g * ax * ax + 2 * dy * v * v);
		let elev: number;
		if (ax < 1) {
			elev = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
		} else if (disc < 0) {
			elev = Math.PI / 4;
		} else {
			elev = Math.atan((v * v - Math.sqrt(disc)) / (g * ax));
		}
		// Back to a screen angle: up is negative y.
		return Math.atan2(-Math.sin(elev), dir * Math.cos(elev));
	}

	/** Walk back over a resting axe when the hands are nearly empty. */
	private shop(input: AIInput, output: AIOutput, ammo: number) {
		const axes = input.ownAxes ?? [];
		if (axes.length === 0 || ammo >= LOW_AXES) return;
		if (input.distanceToPlayer < SHOPPING_SAFE_PX && ammo > 0) return;
		const cx = input.selfX + PLAYER_WIDTH / 2;
		const feet = input.selfY + PLAYER_HEIGHT;
		let best: { x: number; y: number; d: number } | null = null;
		for (const a of axes) {
			const d = Math.hypot(a.x - cx, a.y - (input.selfY + PLAYER_HEIGHT / 2));
			if (d < PICKUP_RANGE_PX && (!best || d < best.d)) best = { ...a, d };
		}
		if (!best) return;
		output.moveRight = best.x > cx + 4;
		output.moveLeft = best.x < cx - 4;
		output.dash = 0;
		if (feet - best.y > JUMP_FOR_AXE_PX && input.touchingDown) {
			output.jump = true;
		}
	}
}
