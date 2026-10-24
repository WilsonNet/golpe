/**
 * The phone's replacement for a cursor: a small, visible, gated aim assist.
 *
 * A mouse points at a place, and facing decides which side a guard covers. The
 * deck's left thumb is a one-axis rocker — it can say "left" or "right" and it
 * is busy moving — so a fighter who has just stopped, or who is holding guard,
 * has no way to say "I mean the person in front of me". This module is that
 * sentence, and nothing more.
 *
 * **It is deliberately narrow.** Sword stance only (the gun is aimed by the
 * thumb on the trigger, and an auto-aimed gun would be a different game); one
 * target, within melee range. A **guard** turns to the threat at any angle; a
 * **held attack** turns to the foe at any angle, even while moving (the
 * retreat-slash a cursor gives desktop); a **standing** fighter only within a
 * cone, so an enemy behind cannot spin them; a walking fighter who is not
 * attacking keeps the feet's direction.
 *
 * **It only ever changes the angle handed to the simulation.** `face` is an
 * input field like any other; both sides still run the same simulation, and the
 * server never learns that a thumb was helped. It is a setting, so a player who
 * wants the raw thumb can have it.
 */

/** A point in world coordinates. */
interface AssistPoint {
	x: number;
	y: number;
}

/** Everything the assist is allowed to look at. */
export interface AssistInput {
	/** The angle the raw input produced this frame. */
	rawAngle: number;
	/** The local fighter's body top-left. */
	shooter: AssistPoint;
	/** The body top-left of the nearest living hostile, or null. */
	target: AssistPoint | null;
	/** Only the sword gets the assist — see the module comment. */
	swordStance: boolean;
	/** A raised guard turns to the threat, whatever the raw angle says. */
	blocking: boolean;
	/**
	 * An attack is being held. A moving attack turns toward a foe in range —
	 * the retreat-slash — because the sword only hits in front and a thumb
	 * cannot point opposite its own feet.
	 */
	attacking: boolean;
	/** The local fighter's horizontal speed, for "is the player walking". */
	vx: number;
	/** The gun/throwable drag is live; a deliberate aim always wins. */
	fineAiming: boolean;
}

/** How far away a foe can be and still be worth turning toward. */
export const ASSIST_RANGE_PX = 240;

/** Below this horizontal speed the fighter counts as standing still. */
export const ASSIST_IDLE_SPEED_PX = 60;

/**
 * How far off the raw aim a target may be while standing still.
 *
 * 80° is deliberately less than a right angle: an enemy on the other side of
 * you is a decision to turn, and the deck should not make it for you. A guard
 * has no cone because turning to the threat is what a guard is for.
 */
export const ASSIST_CONE_RAD = (80 * Math.PI) / 180;

/** The shortest signed distance between two angles, in radians. */
export function angleGap(a: number, b: number): number {
	let delta = (a - b) % (Math.PI * 2);
	if (delta > Math.PI) delta -= Math.PI * 2;
	if (delta < -Math.PI) delta += Math.PI * 2;
	return delta;
}

/**
 * The angle to hand the simulation: the raw one, or a nudge toward the foe.
 *
 * Pure, clock-free, and DOM-free, so the gates are pinned by tests rather than
 * discovered by a player whose fighter turned the wrong way.
 */
export function assistedAim(input: AssistInput): number {
	if (!input.swordStance) return input.rawAngle;
	if (input.fineAiming) return input.rawAngle;
	if (!input.target) return input.rawAngle;

	const dx = input.target.x - input.shooter.x;
	const dy = input.target.y - input.shooter.y;
	if (Math.hypot(dx, dy) > ASSIST_RANGE_PX) return input.rawAngle;

	const toTarget = Math.atan2(dy, dx);
	if (input.blocking) return toTarget;
	// A held attack is a commitment to the foe in front. Without this a phone
	// player who runs away cannot slash behind them: the feet say left and the
	// sword only hits right. The attack press is the decision; the assist is the
	// facing that desktop gets from the cursor.
	if (input.attacking) return toTarget;

	if (Math.abs(input.vx) >= ASSIST_IDLE_SPEED_PX) return input.rawAngle;
	if (Math.abs(angleGap(input.rawAngle, toTarget)) > ASSIST_CONE_RAD) {
		return input.rawAngle;
	}
	return toTarget;
}
