/**
 * The jump button: turning a per-frame wish into real, edge-detectable presses.
 *
 * Jump height is analogue — releasing early cuts the arc — so a brain that
 * emits `jump` on scattered single frames can only ever produce a minimum-height
 * hop and can never reach the upper ledges. This controller holds the button
 * for a committed press, and adds the one thing the old brain could not do at
 * all: a **scripted double jump**.
 *
 * The double jump needs a press *edge* in the air — a held button is latched by
 * the simulation and never re-fires — so it is a two-stage press: hold, release,
 * hold again. The second press fires only if the fighter is still airborne and
 * still has an air jump, which is what keeps a bot from burning its air jump on
 * a wish it no longer needs.
 */

import type { AIInput } from "./types.js";

/** How long the AI holds the jump button once it decides to jump. */
const JUMP_HOLD_MS = 240;
/** Forced release afterwards. `tickPlayer` only starts a jump on a press *edge*,
 * so without a gap the AI would hold the button forever and never jump again. */
const JUMP_RELEASE_MS = 60;

export class JumpBrain {
	private holdTimer = 0;
	private releaseTimer = 0;
	/**
	 * Whether the second press of a double jump is queued for when the release
	 * gap ends. Armed by the press that started the first jump.
	 */
	private doubleArmed = false;

	reset() {
		this.holdTimer = 0;
		this.releaseTimer = 0;
		this.doubleArmed = false;
	}

	/** Whether the button is currently held — what `blockedAhead` needs to know. */
	get isHolding(): boolean {
		return this.holdTimer > 0;
	}

	/**
	 * Resolve this tick's jump wishes into a button state.
	 *
	 * `wantsJump` is the state machine's ordinary wish (walk into a wall, climb,
	 * hop mid-chase) and works airborne — that is how a wall jump is requested.
	 * `wantsDouble` is "I want *height* from this jump": it arms the second
	 * press, which fires after the release gap if the fighter is still rising
	 * with an air jump to spend. It is gated on being grounded at the start, so
	 * a stale wish cannot burn the air jump later.
	 */
	resolve(
		input: AIInput,
		wantsJump: boolean,
		wantsDouble: boolean,
		delta: number,
	): boolean {
		if (this.holdTimer > 0) {
			this.holdTimer -= delta;
			if (this.holdTimer <= 0) {
				this.releaseTimer = JUMP_RELEASE_MS;
				this.doubleArmed = wantsDouble;
			}
			return true;
		}

		if (this.releaseTimer > 0) {
			this.releaseTimer -= delta;
			if (
				this.releaseTimer <= 0 &&
				this.doubleArmed &&
				!input.touchingDown &&
				input.selfAirJumps > 0
			) {
				// Still in the air and still entitled to the second jump: press again.
				this.holdTimer = JUMP_HOLD_MS;
				this.doubleArmed = false;
			}
			return false;
		}

		if (wantsJump || (wantsDouble && input.touchingDown)) {
			this.holdTimer = JUMP_HOLD_MS;
			this.doubleArmed = wantsDouble;
			return true;
		}
		return false;
	}
}
