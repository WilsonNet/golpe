/**
 * Team play: roles, spacing and the cover that makes a side more than a crowd.
 *
 * A team deathmatch side wins by not stacking and not chasing: one fighter
 * holds the sword and a **line** between the enemy and the support (the
 * vanguard), the other keeps the gun at range and shoots over that line (the
 * support). Both roles are decided here, stably, per brain — a bot that
 * flip-flopped between sword and gun every decision cycle would be useless in
 * both. In a free-for-all there are no allies and this module says nothing:
 * `role` is null and no steering is applied.
 *
 * The two jobs are complements with opposite failure modes, and both were
 * measured before they were designed:
 *
 * - The vanguard used to **chase** — and a vanguard that chases a kiting enemy
 *   at equal speed crosses three screens without a single swing while its team
 *   waits at home. It does not chase; it holds a line anchored to the support
 *   and lets the enemy come to it.
 * - The support used to **kite forever** — and a support that never stops
 *   retreating drags the whole side across the arena. Its retreat is bounded:
 *   at its own end screen it stops running and turns to fight.
 */

import type { World } from "../simulation/Arena.js";
import type { MeleeBrain } from "./MeleeBrain.js";
import type { AIInput, AIOutput, TeamRole } from "./types.js";

/** A hostile inside this much of an ally means the ally is being threatened. */
const THREAT_RADIUS_PX = 330;
/** The support's comfort band: inside the floor it runs, outside the ceiling it advances. */
const SUPPORT_FLOOR_PX = 240;
const SUPPORT_CEIL_PX = 420;
/** The vanguard stands this far ahead of the support, toward the threat. */
const LINE_OFFSET_PX = 200;
/** A teammate this close is a collision waiting to happen; step away. */
const SPACING_PX = 110;
/** No enemy within this much means the side is separated — regroup. */
const REGROUP_DIST_PX = 520;
/** The cover guard: the vanguard holds the guard when the threat swings this close to the support. */
const COVER_RANGE_PX = 110;
/** How long the vanguard keeps one line anchor before re-aiming it at the enemy. */
const LINE_ANCHOR_MS = 1500;
/** Within this much of the line, the vanguard stands rather than walks. */
const LINE_TOLERANCE_PX = 40;
/** The side's own end screen: the last stand where the support stops running. */
const HOME_MARGIN_PX = 90;

/** Anything that stands somewhere, for the nearest-neighbour scans. */
interface UnitInfo {
	id: string;
	x: number;
	y: number;
	distance: number;
}

/** The nearest of `units`, which already carry their own distance. */
function nearest(units: readonly UnitInfo[]): UnitInfo | null {
	let best: UnitInfo | null = null;
	for (const unit of units) {
		if (!best || unit.distance < best.distance) {
			best = unit;
		}
	}
	return best;
}

/** What the team module decided this tick, for the coordinator's other modules. */
export interface TeamContext {
	role: TeamRole | null;
	/** Closest ally, for the diagnostic. 0 when there is no ally. */
	allyDistancePx: number;
}

/**
 * One fighter's team decisions. Owned by `EnemyBrain`, which applies the
 * steering and passes `role` on to the melee and ultimate modules.
 */
export class TeamBrain {
	private role: TeamRole | null = null;
	private strafeDir = 1;
	private allyDistancePx = 0;
	/** Stance-usage counters for the diagnostic: sword vs gun frames. */
	private swordFrames = 0;
	private gunFrames = 0;
	/** The vanguard's current line anchor, refreshed on a timer. */
	private lineX: number | null = null;
	private lineTimer = 0;

	constructor(private readonly world: World) {}

	reset() {
		this.role = null;
		this.strafeDir = 1;
		this.allyDistancePx = 0;
		this.swordFrames = 0;
		this.gunFrames = 0;
		this.lineX = null;
		this.lineTimer = 0;
	}

	/** The role this fighter settled into, or null in a free-for-all. */
	get currentRole(): TeamRole | null {
		return this.role;
	}

	/** Stance usage since the last `reset`, for the diagnostic. */
	get insight() {
		return {
			role: this.role,
			swordFrames: this.swordFrames,
			gunFrames: this.gunFrames,
			allyDistancePx: Math.round(this.allyDistancePx),
		};
	}

	/**
	 * The role this fighter settles into, or null in a free-for-all.
	 *
	 * Public so the coordinator can hand it to the melee and ultimate modules
	 * before the steering runs.
	 */
	roleFor(input: AIInput): TeamRole | null {
		return this.roleForImpl(input);
	}

	/**
	 * Apply the steering overrides. Call after the melee module, so a cover
	 * guard can interrupt a rhythm in flight.
	 */
	decide(
		input: AIInput,
		output: AIOutput,
		melee: MeleeBrain,
		role: TeamRole | null,
		delta: number,
	): TeamContext {
		this.role = role;
		this.allyDistancePx = 0;
		for (const ally of input.allies) {
			if (ally.distance < this.allyDistancePx || this.allyDistancePx === 0) {
				this.allyDistancePx = ally.distance;
			}
		}

		output.swordStance ? this.swordFrames++ : this.gunFrames++;

		if (this.role === "support") {
			this.steerSupport(input, output);
		} else if (this.role === "vanguard") {
			this.steerVanguard(input, output, melee, delta);
		}

		return { role: this.role, allyDistancePx: this.allyDistancePx };
	}

	/**
	 * A side is ordered, not random: the n-th fighter of a side alternates
	 * vanguard/support. Stable across the match because ids never change, so a
	 * bot does not swap jobs mid-fight.
	 */
	private roleForImpl(input: AIInput): TeamRole | null {
		if (input.selfTeam === null) return null;
		const ids = [...input.allies.map((a) => a.id), input.selfId].sort();
		const index = ids.indexOf(input.selfId);
		return index % 2 === 0 ? "vanguard" : "support";
	}

	/**
	 * The support: keep the gun at range, kite what closes — but only as far as
	 * the side's own end screen, where the retreat becomes a last stand.
	 */
	private steerSupport(input: AIInput, output: AIOutput) {
		const d = input.distanceToPlayer;
		const threat = nearest(input.foes);
		const toFoe = threat ? threat.x - input.selfX : input.playerX - input.selfX;

		if (d < SUPPORT_FLOOR_PX) {
			const away = input.selfX - input.playerX;
			const atHomeEdge =
				input.selfTeam === 0
					? input.selfX <= this.world.left + HOME_MARGIN_PX
					: input.selfX >= this.world.right - HOME_MARGIN_PX;
			if (atHomeEdge) {
				// No more room to run: turn and fight from the last stand. The
				// vanguard's line is right behind, so this is where the cover is.
				if (Math.random() < 0.03) this.strafeDir *= -1;
				output.moveLeft = this.strafeDir < 0;
				output.moveRight = this.strafeDir > 0;
			} else {
				// Kite: away, and burst when the gap refuses to open.
				output.moveLeft = away < 0;
				output.moveRight = away >= 0;
				if (Math.random() < 0.06) output.dash = away >= 0 ? 1 : -1;
				if (input.touchingDown && Math.random() < 0.12) output.jump = true;
			}
		} else if (d > SUPPORT_CEIL_PX) {
			// Advance onto the enemy: the band is what stops the walk, and the
			// vanguard's line is what covers it. Regrouping instead measured the
			// whole side standing at home, nearest enemy a thousand pixels away,
			// each fighter told "your ally is closer than the enemy — go there".
			if (d > REGROUP_DIST_PX && this.allySeparated(input)) {
				const ally = this.nearestAlly(input);
				if (ally) {
					const toward = ally.x - input.selfX;
					output.moveLeft = toward < 0;
					output.moveRight = toward >= 0;
				}
			} else {
				output.moveLeft = toFoe < 0;
				output.moveRight = toFoe >= 0;
			}
		} else {
			// In the band: strafe and keep the angle open.
			if (Math.random() < 0.03) this.strafeDir *= -1;
			output.moveLeft = this.strafeDir < 0;
			output.moveRight = this.strafeDir > 0;
		}

		// The gun fires whenever the band is held and the lane is clear.
		output.attack = input.hasLineOfSight && !input.selfStunned;

		// Spacing: a second support standing on this one is two guns at the same
		// spot, which is one gun with twice the target area.
		this.applySpacing(input, output);
	}

	/**
	 * The vanguard: the sword and the line between the enemy and the support.
	 *
	 * The steering fires **only when an enemy threatens the support**: the line
	 * sits `LINE_OFFSET_PX` ahead of the support, toward that enemy, refreshed
	 * on a slow timer so a kiting enemy cannot drag it around at walk speed.
	 * While nobody threatens the support, the steering stays out of the way and
	 * the state machine chases normally — an override in that case is what
	 * measured the vanguard orbiting an enemy just out of reach forever, armed
	 * ultimate in hand, never closing the last few hundred pixels.
	 */
	private steerVanguard(
		input: AIInput,
		output: AIOutput,
		melee: MeleeBrain,
		delta: number,
	) {
		const support = this.nearestAliveAlly(input);
		const threat = support
			? this.foeNear(input, support.x, support.y, THREAT_RADIUS_PX)
			: null;

		if (support && threat) {
			// Refresh the anchor slowly, so a kiting enemy cannot drag the line
			// around the arena at walk speed.
			this.lineTimer -= delta;
			if (this.lineX === null || this.lineTimer <= 0) {
				this.lineX = support.x + sign(threat.x - support.x) * LINE_OFFSET_PX;
				this.lineTimer = LINE_ANCHOR_MS;
			}

			// Walk to the line; hold it within tolerance. Combat is still the
			// state machine's call — inside strike range the melee module decides.
			const dx = this.lineX - input.selfX;
			if (Math.abs(dx) > LINE_TOLERANCE_PX) {
				output.moveLeft = dx < 0;
				output.moveRight = dx >= 0;
			} else {
				output.moveLeft = false;
				output.moveRight = false;
			}

			// The cover guard: the enemy is swinging inside the support's reach and
			// we are standing in the way — stop attacking and hold the guard.
			const swinging =
				input.enemyPhase === "startup" || input.enemyPhase === "active";
			const distToThreat = Math.hypot(
				threat.x - input.selfX,
				threat.y - input.selfY,
			);
			if (
				threat.distanceToSupport < COVER_RANGE_PX &&
				swinging &&
				distToThreat < 300
			) {
				melee.interruptWithGuard(output);
				output.face = threat.x >= input.selfX ? 1 : -1;
			}
		}

		this.applySpacing(input, output);

		// Regroup only when actually separated from the side: a teammate right
		// here means the team is together, and the chase is a push, not an
		// abandonment. Without this gate the vanguard was pulled back the moment
		// the enemy got far, and the whole side orbited its own spawn forever.
		if (input.distanceToPlayer > REGROUP_DIST_PX && this.allySeparated(input)) {
			const ally = this.nearestAlly(input);
			if (ally) {
				const dx = ally.x - input.selfX;
				output.moveLeft = dx < 0;
				output.moveRight = dx >= 0;
			}
		}
	}

	/** Is the nearest teammate far enough that this fighter is truly alone? */
	private allySeparated(input: AIInput): boolean {
		const ally = this.nearestAlly(input);
		return ally !== null && ally.distance > 400;
	}

	/** Step away from a teammate standing on top of this fighter. */
	private applySpacing(input: AIInput, output: AIOutput) {
		const ally = this.nearestAlly(input);
		if (ally && ally.distance < SPACING_PX) {
			const away = input.selfX - ally.x;
			output.moveLeft = away < 0;
			output.moveRight = away >= 0;
		}
	}

	private nearestAliveAlly(input: AIInput): UnitInfo | null {
		return nearest(input.allies.filter((a) => a.alive));
	}

	private nearestAlly(input: AIInput): UnitInfo | null {
		return nearest(input.allies);
	}

	/** The foe nearest to a point, within `radius`. */
	private foeNear(
		input: AIInput,
		x: number,
		y: number,
		radius: number,
	): (UnitInfo & { distanceToSupport: number }) | null {
		let best: (UnitInfo & { distanceToSupport: number }) | null = null;
		for (const foe of input.foes) {
			const d = Math.hypot(foe.x - x, foe.y - y);
			if (d < radius && (!best || d < best.distanceToSupport)) {
				best = {
					id: foe.id,
					x: foe.x,
					y: foe.y,
					distance: foe.distance,
					distanceToSupport: d,
				};
			}
		}
		return best;
	}
}

function sign(n: number): 1 | -1 {
	return n >= 0 ? 1 : -1;
}
