/**
 * The black hole: when to aim, where to throw, when to let go.
 *
 * The cast fires on the *release* of the ultimate button, so this module runs a
 * small hold state machine: commit → hold (the aim phase) → release (the cast).
 * While holding it overrides the brain's aim angle with a solved lob — the
 * grenade is a projectile under `GRENADE_GRAVITY`, and the throw angle that
 * lands it at a given distance is a quadratic, so the brain solves it instead
 * of guessing arcs.
 *
 * The cast itself is the server's decision, gated on facts only it holds. This
 * module only decides to *ask*; a refused cast (another hole open, a stun, a
 * freeze) costs nothing because the charge is spent on success only.
 */

import {
	GRENADE_GRAVITY,
	GRENADE_SPEED,
	ULT_MAX_CHARGE,
} from "../simulation/Ultimate.js";
import type { AIInput, TeamRole } from "./types.js";

/**
 * Longest a bot is willing to hold the aim phase before committing.
 *
 * Short on purpose: the hold is the window in which a stun aborts the cast
 * (the server discards a stunned fighter's input, and the release edge never
 * forms). Measured at 450-800ms against a knife fight, 13 of 13 holds were
 * interrupted before the release. A human releases the moment the arc looks
 * right; a bot that holds for half a second is a bot that gets hit.
 */
/** A support bot holds its cast until the enemy is inside this range. */
const SUPPORT_CAST_RANGE_PX = 200;

const HOLD_MIN_MS = 220;
const HOLD_MAX_MS = 420;
/** Grace after a cast (or a refused one) before the brain will aim again. */
const POST_CAST_COOLDOWN_MS = 1500;
/** A cluster is two or more enemies within this much of each other. */
const CLUSTER_RADIUS_PX = 260;
/** The hole grabs what it lands on; this is how far a committed throw may reach. */
const COMMIT_RANGE_PX = 640;
/** A killshot: the enemy is one good hit from dead. */
const FINISHER_HP = 25;
/**
 * An enemy this close to a teammate is at the team's line — a throw onto it is
 * a throw that fights the same fight the side is already in.
 */
const ALLY_LINE_RANGE_PX = 260;
/**
 * The patience rule: an ultimate held ready forever is a weapon that does not
 * exist. After this long with a full meter, cast at the nearest enemy in reach.
 * Overwatch-style ults are for moments, but a bot that never finds a moment is
 * a bot with a dead ability — and measured across a whole team match, the
 * moment-based rules alone produced zero casts.
 */
const ARMED_PATIENCE_MS = 10000;
/** The patience cast still has to reach: throw only within this much. */
const PATIENCE_RANGE_PX = 520;
/**
 * The aim phase needs a beat of safety: an enemy inside this much is swinging
 * at the caster, and a stun mid-hold aborts the cast. A throw from here would
 * be refused anyway by the interruption — measured 13 aborted holds in a row.
 */
const MELEE_SAFETY_PX = 150;
/** The quadratic's discriminant coefficient: b² − 4ac for a=½g·dx²/v². */
const DISCRIMINANT_FACTOR = 4;
/** The maximum-lob fallback: 45° when the target is past the grenade's range. */
const MAX_LOB_ANGLE = Math.atan(1);

/** The cluster to throw into: the enemy with the most neighbours, centroid and all. */
interface Cluster {
	x: number;
	y: number;
	count: number;
	distance: number;
}

function bestCluster(input: AIInput): Cluster | null {
	let best: Cluster | null = null;
	for (const foe of input.foes) {
		// A foe in its own side's smoke cannot be counted as where the throw
		// is going: the cluster is a *visible* crowd, exactly like the crowd a
		// human aims the hole at.
		if (foe.concealed) continue;
		let count = 0;
		let cx = 0;
		let cy = 0;
		for (const other of input.foes) {
			const d = Math.hypot(other.x - foe.x, other.y - foe.y);
			if (d < CLUSTER_RADIUS_PX) {
				count++;
				cx += other.x;
				cy += other.y;
			}
		}
		if (!best || count > best.count) {
			best = {
				x: cx / count,
				y: cy / count,
				count,
				distance: Math.hypot(
					cx / count - input.selfX,
					cy / count - input.selfY,
				),
			};
		}
	}
	return best;
}

/**
 * The launch angle (from the +x axis) whose arc lands a grenade at `dx, dy`.
 *
 * Solves the projectile equations exactly: `dy = dx·tanα − ½g·(dx/v·cosα)²`,
 * a quadratic in `tanα`. The low arc root is the throw a player would choose;
 * a target past the grenade's maximum range (v²/g ≈ 707px) has no real root,
 * so the answer is the maximum-lob 45°.
 */
export function lobAngle(dx: number, dy: number): number {
	if (Math.abs(dx) < 1) return Math.PI / 2;
	const v2 = GRENADE_SPEED * GRENADE_SPEED;
	const a = (GRENADE_GRAVITY * dx * dx) / (2 * v2);
	const c = dy + a;
	const disc = dx * dx - DISCRIMINANT_FACTOR * a * c;
	if (disc < 0) return MAX_LOB_ANGLE;
	const u = (dx - Math.sqrt(disc)) / (2 * a);
	return Math.atan(u);
}

export class UltimateBrain {
	/** True while the button is held — the aim phase. */
	private holding = false;
	/** ms remaining on the aim phase before the release. */
	private holdMs = 0;
	/** ms until this brain will consider aiming again. */
	private cooldown = 0;
	/** The aim angle to force while holding, or null when not aiming. */
	private aim: number | null = null;

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
		this.aim = null;
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

	/** The aim override while the ult is being aimed. */
	get aimOverride(): number | null {
		return this.aim;
	}

	/**
	 * Decide the ultimate button state for this tick.
	 *
	 * `role` lets the team play shape *when* it is worth throwing: a support
	 * under pressure answers with the hole rather than with the gun.
	 */
	decide(input: AIInput, delta: number, role: TeamRole | null) {
		this.cooldown = Math.max(0, this.cooldown - delta);

		// The aim phase is a commitment already made: run its clock out.
		if (this.holding) {
			this.holdMs -= delta;
			if (this.holdMs <= 0) {
				// Release: the cast fires server-side, at the held angle.
				this.holding = false;
				this.aim = null;
				this.cooldown = POST_CAST_COOLDOWN_MS;
				this.releases++;
			}
			return;
		}

		this.aim = null;
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
		// One hole at a time: a second cast would be refused, and re-aiming
		// immediately would spam release edges at a server that says no.
		if (input.fields.length > 0) {
			this.lastDecline = "field-open";
			return;
		}
		if (input.foes.length === 0) {
			this.lastDecline = "no-foes";
			return;
		}
		// The enemy is inside its own side's smoke: no target to see, no angle
		// to solve. A hole thrown at a fogged position is a x-ray throw — the
		// solved lob lands exactly where a human could not have aimed.
		if (input.enemyConcealed) {
			this.lastDecline = "concealed";
			return;
		}
		// The hold is the vulnerable window: a stun mid-hold aborts the cast,
		// and an enemy in swing range will land one inside 220ms. Except for the
		// point-blank answer below, the hole is thrown from a beat of safety.
		if (input.distanceToPlayer < MELEE_SAFETY_PX && role !== "support") {
			this.lastDecline = "in-melee";
			return;
		}

		const target = this.chooseTarget(input, role);
		if (!target) {
			this.lastDecline = "no-target";
			return;
		}
		this.lastDecline = "casting";
		this.aim = lobAngle(target.x - input.selfX, target.y - input.selfY);
		this.holding = true;
		this.holdMs = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
		this.aimStarts++;
	}

	/** Where this throw is worth spending, or null when it is not. */
	private chooseTarget(
		input: AIInput,
		role: TeamRole | null,
	): { x: number; y: number } | null {
		const cluster = bestCluster(input);
		const outnumbered = input.foes.length > input.allies.length + 1;
		const finisher = input.foes.some(
			(f) =>
				!f.concealed && f.hp <= FINISHER_HP && f.distance < COMMIT_RANGE_PX,
		);

		// The crowd: two or more enemies standing together are the hole's reason
		// to exist, for either role.
		if (cluster && cluster.count >= 2 && cluster.distance < COMMIT_RANGE_PX) {
			return cluster;
		}

		// A support being rushed answers with the hole under its own feet: the
		// flat throw detonates on contact, and the hold is what buys the retreat.
		if (role === "support" && input.distanceToPlayer < SUPPORT_CAST_RANGE_PX) {
			return { x: input.playerX, y: input.playerY };
		}

		// Outnumbered, or a killshot on offer — the desperate and the greedy.
		if (outnumbered && input.distanceToPlayer < COMMIT_RANGE_PX) {
			return { x: input.playerX, y: input.playerY };
		}
		if (finisher) {
			const foe = input.foes.find(
				(f) =>
					!f.concealed && f.hp <= FINISHER_HP && f.distance < COMMIT_RANGE_PX,
			);
			if (foe) return { x: foe.x, y: foe.y };
		}
		// The enemy is at the team's line: an ally is being engaged within a
		// throw of us, so the hole lands where the fight already is.
		const atTheLine = input.foes.find((f) => {
			if (f.concealed) return false;
			if (f.distance >= COMMIT_RANGE_PX) return false;
			return input.allies.some(
				(a) => Math.hypot(a.x - f.x, a.y - f.y) < ALLY_LINE_RANGE_PX,
			);
		});
		if (atTheLine) return { x: atTheLine.x, y: atTheLine.y };
		// The patience rule: the meter has been full too long — spend it on the
		// nearest enemy it can still reach.
		if (this.armedTimer > ARMED_PATIENCE_MS) {
			const foe = input.foes.find(
				(f) => !f.concealed && f.distance < PATIENCE_RANGE_PX,
			);
			if (foe) return { x: foe.x, y: foe.y };
		}
		return null;
	}

	/** The button state this module produces. */
	get hold(): boolean {
		return this.holding;
	}
}
