import { CP_ZONE_W } from "../../tweakables/control.js";
import { PLAYER_HEIGHT } from "../simulation/Arena.js";
import type { TeamId } from "../simulation/Teams.js";
import type { AIOutput, ControlInfo, ControlPointInfo } from "./types.js";

/**
 * The objective module: control points.
 *
 * TF2's 5CP is a war over ground, and a brain that only brawls will fight at
 * spawn while the enemy walks the line. This module gives a bot one question:
 * *where is my team's next point* — defend the one being taken, otherwise take
 * the next one — and steers there.
 *
 * It is a module in the coordinator, exactly like the melee rhythm or the
 * ultimate: it writes the same `AIOutput`, it is constructed once, and it sees
 * the line only when the perception carries one (`GameRoom.perceive` and
 * `Match.perceive` populate `control` for 5CP rooms and leave it null
 * everywhere else). **There is no `mode ===` check in this file** — the mode is
 * a property of the perception, not of the brain.
 *
 * **It cedes to the fight — off the point.** Away from the pad, inside weapon
 * range, the state machine and the melee module own movement; a fighter who
 * stops advancing to duel across the room never takes the point. **On the
 * point, the bar is the fight**: a healthy bot plants and trades while the
 * capture fills, because orbiting the pad was how two sides kept resetting the
 * same capture to zero, and a hurt bot hands movement back so a retreat is
 * still possible.
 */

/**
 * A foe inside this range owns the movement decision — **off the pad**. On the
 * objective, the bar is the fight: see `HOLD_MIN_HP`.
 */
const CEDE_RANGE_PX = 90;

/**
 * A hurt fighter stops holding the pad.
 *
 * Holding the objective means trading blows while the bar fills — correct
 * until the fighter is one exchange from dying. Below this the fight brain
 * gets the movement back, and a bot that wants to retreat can.
 */
const HOLD_MIN_HP = 35;

/** Close enough to the pad centre: stand on it, do not pace around it. */
const HOLD_RADIUS_PX = 36;

/**
 * A fighter's body centre this far from the pad's centre is not on the pad.
 *
 * The pads sit on the floor, so a bot on a perch (or on a forward spawn that
 * happens to sit directly above a pad) can be x-aligned with the objective and
 * still 250px above it — planting there forever, out of the fight and off the
 * bar. The vertical band is what tells "standing on it" from "hovering over
 * it".
 */
const PAD_CENTRE_TOLERANCE_PX = 64;

/** How long a chosen point is kept before the situation may re-aim it. */
const RETARGET_MS = 1200;

/**
 * A priority is worth a screen of distance: defending beats attacking in
 * practice, and the score bands keep the two from mixing when the distance
 * arithmetic subtracts from them.
 */
const PRIORITY_STEP = 100000;

/**
 * Enemy progress on one of our points that counts as a real threat.
 *
 * A single enemy brushing the pad for a tick is a scout, not a push — and if
 * every defender turns around for every touch, the line never advances and a
 * match turns into a metronome. Above this much of the bar, the point is being
 * *taken* and somebody has to go back.
 */
const DEFEND_PROGRESS = 0.12;

/** What the objective module needs from perception. `AIInput` satisfies it. */
export interface ControlView {
	selfX: number;
	selfY: number;
	selfHP: number;
	selfTeam: TeamId | null;
	distanceToPlayer: number;
	control: ControlInfo | null;
}

/** What the module decided, for the coordinator's diagnostic. */
export interface ControlInsight {
	target: number;
	defending: boolean;
}

export class ControlBrain {
	/** The point this fighter is walking to, or -1. */
	private target = -1;
	private retargetMs = 0;
	private defending = false;

	reset() {
		this.target = -1;
		this.retargetMs = 0;
		this.defending = false;
	}

	get insight(): ControlInsight {
		return { target: this.target, defending: this.defending };
	}

	/**
	 * Steer toward the objective.
	 *
	 * `hunting` is the coordinator's call: a chase after an isolated low-HP foe
	 * is a decision the whole brain made, and walking away from it to stand on a
	 * pad would be the module second-guessing its owner. Spacing still applies
	 * elsewhere; here it simply stands aside.
	 */
	decide(
		input: ControlView,
		output: AIOutput,
		hunting: boolean,
		delta: number,
	): void {
		const control = input.control;
		if (!control || input.selfTeam === null || control.points.length === 0) {
			this.target = -1;
			return;
		}
		if (hunting) return;

		this.retargetMs = Math.max(0, this.retargetMs - delta);
		const target = this.choose(input, control.points);
		if (target === null) {
			this.target = -1;
			return;
		}
		this.target = target.index;

		const dx = target.x - input.selfX;
		const bodyCentreY = input.selfY + PLAYER_HEIGHT / 2;
		// On the pad in both axes: inside its width and standing on the floor it
		// sits on. Aligned in x but up a perch is not on it.
		const onPad =
			Math.abs(dx) <= CP_ZONE_W / 2 &&
			Math.abs(bodyCentreY - target.y) <= PAD_CENTRE_TOLERANCE_PX;

		// **On the objective, hold it and trade.** Ceding movement to the fight
		// brain the moment a foe came within 90px was the metronome: both sides
		// orbited the pad, the bar touched a hair and decayed, and captures only
		// happened when somebody died. The bar is the fight here — plant, swing,
		// and let the survival reflexes (which run after this module) take over
		// for a bomb, a hole or a trap.
		if (onPad && input.selfHP > HOLD_MIN_HP) {
			if (Math.abs(dx) > HOLD_RADIUS_PX) {
				output.moveLeft = dx < 0;
				output.moveRight = dx > 0;
			} else {
				output.moveLeft = false;
				output.moveRight = false;
			}
			return;
		}

		// Off the pad — or hurt enough that the point is not worth dying on —
		// a foe inside weapon range owns the footwork.
		if (input.distanceToPlayer < CEDE_RANGE_PX) return;

		// Otherwise walk the objective. Aligned but not on it means standing on
		// a perch above the pad: either edge falls to the floor, so step off
		// and close the gap on the next decision.
		if (!onPad || Math.abs(dx) > HOLD_RADIUS_PX) {
			output.moveLeft = dx < 0;
			output.moveRight = dx >= 0;
		} else {
			output.moveLeft = false;
			output.moveRight = false;
		}
	}

	/**
	 * Which point to stand on.
	 *
	 * Defend first — a point of ours with an enemy on it is the one moment the
	 * line is actually moving, and losing it costs ground the attack has to
	 * retake. Then attack the one point that is capturable (the adjacency rule
	 * guarantees at most one). Then, with nothing to take or defend, hold the
	 * nearest point of our own — the front line — rather than drifting.
	 */
	private choose(
		input: ControlView,
		points: readonly ControlPointInfo[],
	): ControlPointInfo | null {
		// A remembered target is kept for a moment so two equidistant points do
		// not flip a fighter's direction every tick.
		if (this.target >= 0 && this.retargetMs > 0) {
			const held = points[this.target];
			if (held && this.stillValid(held)) return held;
		}

		let best: ControlPointInfo | null = null;
		let bestScore = Number.NEGATIVE_INFINITY;
		let defending = false;
		for (const point of points) {
			const underAttack =
				point.mine &&
				point.attacker !== null &&
				point.progress >= DEFEND_PROGRESS;
			const priority = underAttack ? 2 : point.capturable ? 1 : 0;
			if (priority === 0) continue;
			const score = priority * PRIORITY_STEP - Math.abs(point.x - input.selfX);
			if (score > bestScore) {
				bestScore = score;
				best = point;
				defending = underAttack;
			}
		}

		if (best === null) {
			// Nothing to take (my side holds the enemy's last — the round is
			// ending) or the enemy owns everything. Hold the nearest own point.
			for (const point of points) {
				if (!point.mine) continue;
				const score = -Math.abs(point.x - input.selfX);
				if (score > bestScore) {
					bestScore = score;
					best = point;
					defending = true;
				}
			}
		}

		this.defending = best !== null && defending;
		this.retargetMs = RETARGET_MS;
		return best;
	}

	/** Is the remembered target still worth walking to? */
	private stillValid(point: ControlPointInfo): boolean {
		return point.capturable || point.mine;
	}
}
