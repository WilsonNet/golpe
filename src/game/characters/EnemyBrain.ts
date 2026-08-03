import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type Rect,
	type World,
} from "../simulation/Arena.js";
import { BULLET_SPEED, JUMP_HEIGHT_PX } from "../simulation/Physics.js";
import type { AIConfig } from "./AIConfig.js";
import { JumpBrain } from "./JumpBrain.js";
import {
	MeleeBrain,
	STRIKE_RANGE_PX,
	SWORD_DISENGAGE_PX,
} from "./MeleeBrain.js";
import { TeamBrain } from "./TeamBrain.js";
import type { AIInput, AIOutput } from "./types.js";
import { UltimateBrain } from "./UltimateBrain.js";

export enum AIState {
	IDLE = "IDLE",
	CHASE = "CHASE",
	RETREAT = "RETREAT",
	ATTACK = "ATTACK",
	EVADE = "EVADE",
	/**
	 * Deliberately break away, take height, and fight with the gun.
	 *
	 * Without this the state machine could only ever close and swing: at sword
	 * range the only outcome was ATTACK, so two bots met in the middle and stayed
	 * there. Measured, that was 11% of the arena's width, one of nine surfaces,
	 * zero wall jumps and zero bullets — every ledge, the line-of-sight cover and
	 * the whole ranged pipeline untested by the canonical run.
	 */
	ZONE = "ZONE",
}

/** Zoning aims to get at least this far away — comfortably outside sword range. */
const ZONE_RANGE_PX = 330;
/** How long a zoning phase lasts before the bot re-evaluates. */
const ZONE_DURATION_MS = 2600;
/** Minimum gap between zoning phases, so a bot cannot simply never engage. */
const ZONE_COOLDOWN_MS = 2200;
/** The nearest ledge that is above the fighter and reachable with a jump. */
const PERCH_MIN_RISE_PX = 30;
/**
 * The perch cap: how high above the fighter a ledge may be and still be worth
 * jumping for. A single jump reaches `JUMP_HEIGHT_PX`; a double jump reaches
 * roughly 1.8× that, so the cap sits between the two and the brain arms the
 * double jump exactly when the perch needs it. This is what lets a zoning bot
 * actually use the upper ledges instead of hopping under them.
 */
const PERCH_MAX_RISE_PX = JUMP_HEIGHT_PX * 1.7;

/**
 * The nearest ledge that is above the fighter and within a jump or two.
 *
 * Zoning without a destination just means jumping on the spot: a fighter has to
 * be standing under a ledge for a jump to reach one, and left to chance that
 * almost never happens. Measured without this, three matches used one of the
 * arena's nine surfaces and never rose above the bottom third.
 */
function perchAbove(selfX: number, selfY: number, world: World): Rect | null {
	let best: Rect | null = null;
	let bestDx = Number.POSITIVE_INFINITY;

	for (const p of world.platforms) {
		const standingY = p.y - PLAYER_HEIGHT;
		const rise = selfY - standingY;
		// Must be genuinely above, and reachable from here.
		if (rise < PERCH_MIN_RISE_PX || rise > PERCH_MAX_RISE_PX) continue;
		// Wide enough to land on.
		if (p.w < PLAYER_WIDTH) continue;

		const dx = Math.abs(p.x + p.w / 2 - selfX);
		if (dx < bestDx) {
			bestDx = dx;
			best = p;
		}
	}
	return best;
}

/**
 * One brain, four modules.
 *
 * The brain owns the state machine and the navigation; each weapon and each
 * team concern is a module with one job, and a future weapon is a new module
 * writing the same `AIOutput` instead of a new branch in a growing class. The
 * modules share no state between them except through this coordinator, which
 * is also what keeps the whole thing a single `decide(input) => output` for the
 * server and the training dummy.
 *
 * **Named export matters**: this class is imported by the server too, and a
 * default export resolves to the module namespace object rather than the class
 * under the server's ESM/CJS interop. Everything shared with `server/` must be
 * a named export.
 */
export class EnemyBrain {
	private config: AIConfig;
	private state: AIState = AIState.IDLE;
	private decisionCooldown = 0;
	private stateTimer = 0;
	private stuckTimer = 0;
	private stuckCheckX = 0;
	private stuckCheckY = 0;
	private stuckCount = 0;
	private zoneCooldown = 0;

	/** The sword game: techniques, rhythms, stance hysteresis. */
	private readonly melee = new MeleeBrain();
	/** The jump button: committed presses and the scripted double jump. */
	private readonly jump = new JumpBrain();
	/** The black hole: when to aim, where to throw, when to release. */
	private readonly ultimate = new UltimateBrain();
	/** Team roles, spacing and the cover guard. */
	private readonly team: TeamBrain;

	/**
	 * The geometry this brain reasons about — ledges to perch on, cover to use.
	 * Defaults to the single-screen arena; a room's bots pass the room's world
	 * so a wide arena does not teach them to "zone" into a wall.
	 */
	readonly world: World;

	constructor(config: AIConfig, world: World = DEFAULT_WORLD) {
		this.config = config;
		this.world = world;
		this.team = new TeamBrain(world);
	}

	getConfig(): AIConfig {
		return { ...this.config };
	}

	updateConfig(config: Partial<AIConfig>) {
		this.config = { ...this.config, ...config };
	}

	resetState() {
		this.state = AIState.IDLE;
		this.decisionCooldown = 0;
		this.stateTimer = 0;
		this.stuckTimer = 0;
		this.stuckCheckX = 0;
		this.stuckCheckY = 0;
		this.stuckCount = 0;
		this.zoneCooldown = 0;
		this.melee.reset();
		this.jump.reset();
		this.ultimate.reset();
		this.team.reset();
	}

	getCurrentState(): AIState {
		return this.state;
	}

	/** The last perception this brain reasoned over, for the diagnostic. */
	private lastInput: AIInput | null = null;

	/** What this brain is doing right now, for the diagnostic. */
	getInsight() {
		const i = this.lastInput;
		const minFoeDistRaw =
			i?.foes.reduce(
				(m, f) => Math.min(m, f.distance),
				Number.POSITIVE_INFINITY,
			) ?? Number.POSITIVE_INFINITY;
		return {
			state: this.state,
			...this.team.insight,
			ultimate: this.ultimate.insight,
			// The perception itself, so a probe can tell "the brain decided not
			// to cast" from "the brain never saw a target".
			foes: i?.foes.length ?? 0,
			minFoeDist: Number.isFinite(minFoeDistRaw)
				? Math.round(minFoeDistRaw)
				: null,
			allies: i?.allies.length ?? 0,
			selfUlt: i?.selfUltCharge ?? 0,
			openFields: i?.fields.length ?? 0,
			stunned: i?.selfStunned ?? false,
		};
	}

	decide(input: AIInput, _time: number, delta: number): AIOutput {
		this.lastInput = input;
		this.decisionCooldown -= delta;
		this.stateTimer += delta;
		this.zoneCooldown = Math.max(0, this.zoneCooldown - delta);
		this.trackStuck(input, delta);

		const isLowHP = input.selfHP <= 30;
		const isHighHP = input.selfHP >= 80;
		const isEnemyLow = input.enemyHP <= 30;

		const playerFacesMe =
			input.playerFacingDirection * (input.selfX - input.playerX) > 0;

		const dodgeRoll = Math.random();
		const dodgeMultiplier = isLowHP ? 1.5 : isHighHP ? 0.7 : 1.0;
		const dodgeThreshold =
			this.config.dodgeChance *
			(this.config.skillLevel / 10) *
			0.6 *
			dodgeMultiplier;
		const shouldEvade =
			playerFacesMe &&
			input.distanceToPlayer < 350 &&
			dodgeRoll < dodgeThreshold;

		if (this.decisionCooldown <= 0) {
			if (this.state !== AIState.EVADE && shouldEvade) {
				this.state = AIState.EVADE;
				this.stateTimer = 0;
			} else {
				const newState = this.evaluateState(input, isLowHP, isEnemyLow);
				if (newState !== this.state) {
					this.stateTimer = 0;
				}
				this.state = newState;
			}
			this.decisionCooldown = this.getReactionTime();
		}

		if (this.isStuck() && input.touchingDown) {
			this.stuckCount = 0;
		}

		const output = this.executeState(input, isLowHP, isEnemyLow);

		// ---- the weapon modules ----
		//
		// Order is the whole design: the state machine decides where to stand,
		// the melee module decides what the sword does from there, the team module
		// reshapes movement around the side, and the ultimate module asks for the
		// hole last — each layer may override the last, exactly like a human
		// reconsidering.
		const role = this.team.roleFor(input);
		this.melee.decide(input, output, delta, {
			role,
			skill: this.config.skillLevel,
			aggressiveness: this.config.aggressiveness,
		});
		this.team.decide(input, output, this.melee, role, delta);
		this.ultimate.decide(input, delta, role);
		output.ultimate = this.ultimate.hold;
		if (this.ultimate.aimOverride !== null) {
			output.aimAngle = this.ultimate.aimOverride;
		} else {
			output.aimAngle = this.aimAt(input);
		}

		// ---- the jump ----
		output.jump = this.jump.resolve(
			input,
			output.jump,
			this.wantsHeight(input),
			delta,
		);
		return output;
	}

	// -------------------------------------------------------------------------
	// Aiming
	// -------------------------------------------------------------------------

	/**
	 * The angle to point the gun: lead the target, then miss by accuracy.
	 *
	 * A bullet takes `distance / BULLET_SPEED` to arrive, and in that time the
	 * target has moved — a fighter strafing at walk speed is ~30px off by the
	 * time a shot from 80px... a shot from 300px arrives 0.5s later and the
	 * target has moved ~110px. A brain that aimed at where the foe *was* would
	 * be training the ranged game to miss, so the aim is at where it will be.
	 */
	private aimAt(input: AIInput): number {
		const timeOfFlight = input.distanceToPlayer / BULLET_SPEED;
		const px = input.playerX + input.enemyVX * timeOfFlight;
		const py = input.playerY + input.enemyVY * timeOfFlight;
		const accuracyFactor = this.config.accuracy * (this.config.skillLevel / 10);
		const aimJitter = (1 - accuracyFactor) * 0.5;
		return (
			Math.atan2(py - input.selfY, px - input.selfX) +
			(Math.random() - 0.5) * aimJitter
		);
	}

	// -------------------------------------------------------------------------
	// Height: the double jump
	// -------------------------------------------------------------------------

	/**
	 * "This jump is for height", per state.
	 *
	 * The double jump is a resource with a cost (it cannot be used again until
	 * landing), so the brain only asks for it when the situation actually wants
	 * it: closing on an enemy that holds the high ground, climbing to a ledge a
	 * single jump cannot reach, or fleeing with no health to spare.
	 */
	private wantsHeight(input: AIInput): boolean {
		switch (this.state) {
			case AIState.CHASE:
			case AIState.ATTACK:
				// The foe holds the high ground. A blind chase is *not* enough: a
				// double jump every time the line of sight broke measured the bots
				// airborne 80% of a duel, hopping through it instead of walking.
				return input.playerY < input.selfY - 40;
			case AIState.ZONE: {
				const perch = perchAbove(input.selfX, input.selfY, this.world);
				if (!perch) return false;
				// Only the ledges a single jump cannot reach need the second press.
				const rise = input.selfY - (perch.y - PLAYER_HEIGHT);
				return rise > JUMP_HEIGHT_PX * 0.95;
			}
			case AIState.EVADE:
			case AIState.RETREAT:
				return input.selfHP <= 40;
			default:
				return false;
		}
	}

	// -------------------------------------------------------------------------
	// The state machine
	// -------------------------------------------------------------------------

	private trackStuck(input: AIInput, delta: number) {
		this.stuckTimer += delta;
		if (this.stuckTimer > 600) {
			const dx = Math.abs(input.selfX - this.stuckCheckX);
			const dy = Math.abs(input.selfY - this.stuckCheckY);
			if (dx < 15 && dy < 15) {
				this.stuckCount++;
			} else {
				this.stuckCount = Math.max(0, this.stuckCount - 1);
			}
			this.stuckCheckX = input.selfX;
			this.stuckCheckY = input.selfY;
			this.stuckTimer = 0;
		}
	}

	private isStuck(): boolean {
		return this.stuckCount >= 4;
	}

	private evaluateState(
		input: AIInput,
		isLowHP: boolean,
		isEnemyLow: boolean,
	): AIState {
		if (this.isStuck()) {
			return AIState.CHASE;
		}
		// Sword range is somewhere to *be*, not somewhere to flee. Backing off on
		// contact was correct when the only weapon was a gun; with a sword it
		// meant the fighter fled the exact distance its best options need, and no
		// melee exchange ever happened.
		// A zoning phase runs to its own clock; ending it early would mean never
		// actually getting anywhere.
		if (this.state === AIState.ZONE) {
			const done =
				this.stateTimer > ZONE_DURATION_MS ||
				input.distanceToPlayer > ZONE_RANGE_PX * 1.4;
			if (!done) return AIState.ZONE;
			this.zoneCooldown = ZONE_COOLDOWN_MS;
		}

		if (input.distanceToPlayer < STRIKE_RANGE_PX) {
			if (isLowHP) return AIState.RETREAT;
			// Break away sometimes rather than brawling until someone dies. Cautious
			// fighters zone more, which is what makes two bots play differently
			// instead of mirroring each other into the centre of the map.
			const wantsSpace = 0.5 - 0.28 * this.config.aggressiveness;
			if (this.zoneCooldown <= 0 && Math.random() < wantsSpace) {
				return AIState.ZONE;
			}
			return AIState.ATTACK;
		}
		if (isLowHP && !isEnemyLow) {
			if (input.distanceToPlayer < 500) {
				return Math.random() < 0.5 ? AIState.ATTACK : AIState.EVADE;
			}
			return AIState.CHASE;
		}
		if (isEnemyLow && !isLowHP) {
			if (input.distanceToPlayer < 300) {
				return AIState.ATTACK;
			}
			return Math.random() < 0.7 ? AIState.CHASE : AIState.ATTACK;
		}
		if (input.distanceToPlayer < 280) {
			if (!input.hasLineOfSight) return AIState.CHASE;
			return AIState.ATTACK;
		}
		if (input.distanceToPlayer < 400) {
			if (!input.hasLineOfSight) return AIState.CHASE;
			const stayBias = this.state === AIState.ATTACK ? 0.3 : 0;
			const decision =
				Math.random() < this.config.aggressiveness - stayBias
					? AIState.CHASE
					: AIState.ATTACK;
			return decision;
		}
		return AIState.CHASE;
	}

	private getReactionTime(): number {
		const skillBonus = (10 - this.config.skillLevel) * 40;
		return this.config.reactionTime + skillBonus + Math.random() * 100;
	}

	private executeState(
		input: AIInput,
		isLowHP: boolean,
		isEnemyLow: boolean,
	): AIOutput {
		const output: AIOutput = {
			moveLeft: false,
			moveRight: false,
			jump: false,
			attack: false,
			block: false,
			uppercut: false,
			swordStance: true,
			// Always face the opponent. A guard only covers one side, so turning to
			// meet them is not a flourish — it is the difference between blocking
			// and being backstabbed.
			face: input.playerX >= input.selfX ? 1 : -1,
			dash: 0,
			aimAngle: 0,
			evadeActive: false,
			ultimate: false,
		};

		switch (this.state) {
			case AIState.CHASE: {
				const reallyStuck = this.isStuck() && this.stateTimer > 1200;
				if (reallyStuck) {
					output.moveRight = !(input.playerX > input.selfX);
					output.moveLeft = !(input.playerX <= input.selfX);
				} else {
					output.moveRight = input.playerX > input.selfX;
					output.moveLeft = input.playerX <= input.selfX;
				}
				if (isLowHP && input.touchingDown && Math.random() < 0.7) {
					output.jump = true;
				} else if (
					// Climbing blind is only worth it against a wall or up to a foe
					// that actually holds the high ground. Hopping every grounded frame
					// while the line of sight is broken measured the bots airborne for
					// most of a duel, jumping in place instead of walking around cover.
					(!input.hasLineOfSight &&
						(input.touchingLeft || input.touchingRight)) ||
					input.playerY < input.selfY - 60
				) {
					if (input.touchingDown) output.jump = true;
				} else if (this.isStuck() && input.touchingDown) {
					output.jump = Math.random() < 0.6;
				} else if (
					input.touchingDown &&
					Math.random() < 0.01 * this.config.skillLevel
				) {
					output.jump = true;
				}
				if (
					!input.touchingDown &&
					(input.touchingLeft || input.touchingRight) &&
					Math.random() < 0.1
				) {
					output.jump = true;
				}
				break;
			}

			case AIState.RETREAT: {
				output.moveRight = input.playerX <= input.selfX;
				output.moveLeft = input.playerX > input.selfX;
				output.jump =
					input.touchingDown &&
					(isLowHP ? Math.random() < 0.4 : Math.random() < 0.1);
				const counterChance = isEnemyLow
					? Math.min(1, this.config.aggressiveness)
					: this.config.aggressiveness * 0.5;
				if (Math.random() < counterChance) {
					output.attack = input.hasLineOfSight;
				}
				break;
			}

			case AIState.ATTACK: {
				if (!input.hasLineOfSight) {
					output.moveRight = input.playerX > input.selfX;
					output.moveLeft = input.playerX <= input.selfX;
					output.jump = input.touchingDown;
					output.attack = false;
				} else {
					// Walk in until a swing can actually reach. The sword is the
					// primary weapon, so "in position" means sword range, not the
					// old ranged-duel spacing.
					const wanted = this.melee.swordDrawn ? STRIKE_RANGE_PX - 12 : 80;
					if (input.distanceToPlayer > wanted) {
						output.moveRight = input.playerX > input.selfX;
						output.moveLeft = input.playerX <= input.selfX;
					}
					const strafe =
						!this.melee.swordDrawn && Math.random() < (isLowHP ? 0.2 : 0.4);
					if (strafe) {
						output.moveLeft = Math.random() < 0.5;
						output.moveRight = !output.moveLeft;
						output.jump =
							input.touchingDown &&
							(isLowHP ? Math.random() < 0.3 : Math.random() < 0.15);
					}
					output.attack = true;
				}
				break;
			}

			case AIState.ZONE: {
				// Put the arena between us: back off, and climb while doing it. Height
				// is what turns a retreat into a position rather than a corner.
				const away = input.selfX - input.playerX;
				const perch = perchAbove(input.selfX, input.selfY, this.world);

				// Space first, height second. Climbing while still inside sword range
				// left the fighter high but engaged: the gun never came out, because
				// the stance only holsters past SWORD_DISENGAGE_PX. Getting out of
				// reach is what makes the ranged game reachable at all.
				const tooClose = input.distanceToPlayer < SWORD_DISENGAGE_PX + 40;

				if (tooClose) {
					output.moveLeft = away < 0;
					output.moveRight = away >= 0;
					// Walking away from someone who walks at your speed gains nothing —
					// the gap never opens. The burst is the only tool that creates
					// separation against an equal-speed opponent: a dash while the
					// sword is out, a tumble when the gun is — the simulation decides
					// which from the stance, so the brain just asks for the burst.
					if (Math.random() < 0.14) output.dash = away >= 0 ? 1 : -1;
				} else if (perch) {
					// Head for a specific ledge and jump when actually underneath it.
					// Steering toward a destination is the difference between climbing
					// the arena and hopping on the spot.
					const target = perch.x + perch.w / 2;
					const dx = target - input.selfX;
					if (Math.abs(dx) > PLAYER_WIDTH / 2) {
						output.moveRight = dx > 0;
						output.moveLeft = dx < 0;
					} else if (input.touchingDown) {
						output.jump = true;
					}
				}

				// Wall jump rather than sliding back down a face.
				if (
					!input.touchingDown &&
					(input.touchingLeft || input.touchingRight)
				) {
					output.jump = true;
				}

				output.attack = input.hasLineOfSight;
				break;
			}

			case AIState.EVADE: {
				output.evadeActive = true;
				const awayX = input.selfX - input.playerX;
				if (awayX > 0) {
					output.moveLeft = true;
					output.moveRight = false;
				} else {
					output.moveLeft = false;
					output.moveRight = true;
				}
				output.jump =
					input.touchingDown &&
					(isLowHP ? Math.random() < 0.6 : Math.random() < 0.3);
				break;
			}

			default:
				break;
		}

		// Walking into a wall gets you nowhere: climb it. This is what turns an
		// obstacle into a route instead of somewhere the AI grinds to a halt.
		const blockedAhead =
			(output.moveRight && input.touchingRight) ||
			(output.moveLeft && input.touchingLeft);
		if (blockedAhead && (input.touchingDown || this.jumpHoldActive)) {
			output.jump = true;
		}

		return output;
	}

	/** Whether the jump button is currently held by the jump module. */
	private get jumpHoldActive(): boolean {
		return this.jump.isHolding;
	}
}

export default EnemyBrain;
