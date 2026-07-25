import type { MeleeAction, MeleePhase } from "../simulation/Melee";
import type { AIConfig } from "./AIConfig";

export enum AIState {
	IDLE = "IDLE",
	CHASE = "CHASE",
	RETREAT = "RETREAT",
	ATTACK = "ATTACK",
	EVADE = "EVADE",
}

export interface AIInput {
	playerX: number;
	playerY: number;
	selfX: number;
	selfY: number;
	distanceToPlayer: number;
	playerFacingDirection: number;
	touchingDown: boolean;
	touchingLeft: boolean;
	touchingRight: boolean;
	hasLineOfSight: boolean;
	selfHP: number;
	enemyHP: number;
	/** What the opponent is doing with their sword, for reads and punishes. */
	enemyAction: MeleeAction;
	enemyPhase: MeleePhase;
	enemyBlocking: boolean;
	enemyStunned: boolean;
	/** Own melee state, so the brain does not fight its own animations. */
	selfAction: MeleeAction;
	selfStunned: boolean;
	selfMassiveReady: boolean;
}

export interface AIOutput {
	moveLeft: boolean;
	moveRight: boolean;
	jump: boolean;
	/** Slash, or release a charged Massive Strike. */
	attack: boolean;
	block: boolean;
	uppercut: boolean;
	/** Absolute stance request, never a toggle — see specs/netcode.md. */
	swordStance: boolean;
	/** -1/1 to face that way, 0 to let movement decide. */
	face: number;
	aimAngle: number;
	evadeActive: boolean;
}

/**
 * How long the AI holds the jump button once it decides to jump.
 *
 * Jump height is analogue — releasing early cuts the arc — so an AI that
 * emits `jump` on scattered single frames can only ever produce a minimum-height
 * hop and can never reach the upper ledges. Holding commits to a real jump.
 */
const JUMP_HOLD_MS = 240;
/**
 * Forced release afterwards. `tickPlayer` only starts a jump on a press *edge*,
 * so without a gap the AI would hold the button forever and never jump again.
 */
const JUMP_RELEASE_MS = 60;

// ---------------------------------------------------------------------------
// Sword fighting
//
// Melee inputs are edge-triggered and analogue, exactly like the jump, so the
// brain cannot simply hold a button and hope. Every technique below is a short
// scripted rhythm of presses and releases — which is also what a human does,
// since the butterfly is a rhythm before it is anything else.
// ---------------------------------------------------------------------------

/** Draw the sword inside this range; holster it beyond `SWORD_DISENGAGE_PX`. */
const SWORD_ENGAGE_PX = 210;
/**
 * Hysteresis on the stance decision. Without a gap, a fighter hovering at the
 * boundary would switch weapons every few frames — and since a stance switch
 * cancels a slash, it would cancel its own attacks forever.
 */
const SWORD_DISENGAGE_PX = 280;
/** Close enough for a slash to reach: body width plus the slash's 42px. */
const STRIKE_RANGE_PX = 70;
/** The uppercut's shorter reach. It has to be walked into. */
const UPPERCUT_RANGE_PX = 58;
/** Near enough to be worth charging at, far enough not to be punished for it. */
const CHARGE_RANGE_PX = 150;

/** One phase of a scripted melee rhythm: which buttons, for how long. */
interface MeleeBeat {
	ms: number;
	attack?: boolean;
	block?: boolean;
	uppercut?: boolean;
}

/**
 * The butterfly: slash, cancel it into a block, release, repeat.
 *
 * The gap matters as much as the presses. A slash needs a press *edge*, so
 * without releasing the attack button between cycles the fighter would swing
 * once and then stand there holding it — which is exactly the bug that made an
 * earlier AI look like it was attacking while dealing no damage.
 */
const BUTTERFLY: MeleeBeat[] = [
	{ ms: 55, attack: true },
	{ ms: 95, block: true },
	{ ms: 40 },
];

/** A plain committed swing, for when there is no need to be safe. */
const LONE_SLASH: MeleeBeat[] = [
	{ ms: 55, attack: true },
	{ ms: 90 },
];

const UPPERCUT_BEATS: MeleeBeat[] = [
	{ ms: 60, uppercut: true },
	{ ms: 120 },
];

/**
 * Charge, then let go. The release is what fires the Massive Strike, and it has
 * to be long enough to register as a release before the next press.
 */
const CHARGE_BEATS: MeleeBeat[] = [
	{ ms: 470, attack: true },
	{ ms: 90 },
];

/** Fire an already-armed Massive: one clean press. */
const RELEASE_MASSIVE: MeleeBeat[] = [
	{ ms: 60, attack: true },
	{ ms: 80 },
];

const GUARD: MeleeBeat[] = [{ ms: 260, block: true }];

/**
 * Sit behind the guard rather than reading a specific swing.
 *
 * A purely reactive fighter only ever blocks with a *fresh* guard, which is
 * always inside the parry window — so it parries everything and never simply
 * blocks. Turtling is the other half of the defensive game, and it is what the
 * uppercut exists to punish: without anyone ever holding a guard, the answer to
 * a guard has nothing to answer.
 */
const TURTLE: MeleeBeat[] = [{ ms: 700, block: true }];

/**
 * Named export matters: this class is imported by the server too, and a
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
	private jumpHoldTimer = 0;
	private jumpReleaseTimer = 0;

	/** The melee rhythm currently being played, and how far into it we are. */
	private beats: MeleeBeat[] | null = null;
	private beatIndex = 0;
	private beatElapsed = 0;
	/** Loops left on a repeating rhythm (the butterfly). */
	private beatLoops = 0;
	private swordDrawn = true;
	/** Whether this particular incoming swing will be guarded. Rolled once. */
	private guardDecision: boolean | null = null;
	/** Whether this particular stun will be punished with a charge. Rolled once. */
	private stunPunishDecision: boolean | null = null;

	constructor(config: AIConfig) {
		this.config = config;
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
		this.jumpHoldTimer = 0;
		this.jumpReleaseTimer = 0;
		this.beats = null;
		this.beatIndex = 0;
		this.beatElapsed = 0;
		this.beatLoops = 0;
		this.swordDrawn = true;
		this.guardDecision = null;
		this.stunPunishDecision = null;
	}

	getCurrentState(): AIState {
		return this.state;
	}

	/**
	 * Convert a per-frame "I want to jump" impulse into a held-then-released
	 * button press that the physics can read as a real jump.
	 */
	private resolveJump(wantsJump: boolean, delta: number): boolean {
		if (this.jumpHoldTimer > 0) {
			this.jumpHoldTimer -= delta;
			if (this.jumpHoldTimer <= 0) this.jumpReleaseTimer = JUMP_RELEASE_MS;
			return true;
		}
		if (this.jumpReleaseTimer > 0) {
			this.jumpReleaseTimer -= delta;
			return false;
		}
		if (wantsJump) {
			this.jumpHoldTimer = JUMP_HOLD_MS;
			return true;
		}
		return false;
	}

	decide(input: AIInput, _time: number, delta: number): AIOutput {
		this.decisionCooldown -= delta;
		this.stateTimer += delta;
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
		this.decideSword(input, output, delta);
		output.jump = this.resolveJump(output.jump, delta);
		return output;
	}

	// -------------------------------------------------------------------------
	// Sword fighting
	// -------------------------------------------------------------------------

	/**
	 * Choose and play a melee rhythm, overriding the ranged attack decision.
	 *
	 * Runs after `executeState` because movement and positioning come first: the
	 * sword game is decided by where you are standing, and a brain that picked
	 * its attack before its position would swing at nothing.
	 */
	private decideSword(input: AIInput, output: AIOutput, delta: number) {
		const distance = input.distanceToPlayer;

		// Hysteresis, so a fighter at the boundary does not switch weapons every
		// frame — a stance switch cancels a slash, so flicker would cancel every
		// attack it ever started.
		if (this.swordDrawn && distance > SWORD_DISENGAGE_PX) this.swordDrawn = false;
		else if (!this.swordDrawn && distance < SWORD_ENGAGE_PX) this.swordDrawn = true;

		output.swordStance = this.swordDrawn;

		if (!this.swordDrawn) {
			this.beats = null;
			return;
		}

		// Stunned: nothing to decide. The simulation discards the input anyway, but
		// dropping the rhythm here means the fighter does not resume a half-played
		// butterfly the instant it recovers.
		if (input.selfStunned) {
			this.beats = null;
			output.attack = false;
			return;
		}

		// The gun's fire button is the sword's swing button, so a ranged decision
		// left standing here would mash the sword. Melee decides from now on.
		output.attack = false;

		// Reactions interrupt; pressure only fills the gaps.
		//
		// A rhythm once started used to run to completion, which meant a fighter
		// mid-butterfly was deaf for up to ~950ms — long enough to miss every
		// swing aimed at it. Measured: 10 guards raised, 0 hits ever blocked. A
		// block that cannot be raised in time is not a mechanic.
		const reaction = this.reactiveTechnique(input, distance);
		// Never interrupt a turtle with a reactive guard. Restarting the block
		// would reset its timer back inside the parry window, so a fighter trying
		// to hold a guard would silently parry instead — and the uppercut would
		// again have nothing to punish.
		const turtling = this.beats === TURTLE && reaction === GUARD;
		if (reaction && !turtling) {
			// Compared by identity, so re-reading the same threat continues the
			// rhythm instead of restarting it from the first beat every tick.
			if (this.beats !== reaction) this.startBeats(reaction);
		} else if (!this.beats) {
			this.startBeats(this.pressureTechnique(input, distance));
		}

		this.playBeats(output, delta);
	}

	/**
	 * Techniques chosen in answer to what the opponent is doing *right now*.
	 *
	 * Re-evaluated every tick and allowed to interrupt whatever is playing,
	 * because every one of these has a window measured in tens of milliseconds.
	 * Returns null when there is nothing to react to.
	 */
	private reactiveTechnique(
		input: AIInput,
		distance: number,
	): MeleeBeat[] | null {
		// The opponent has committed to something long and uncancellable. This is
		// the punish window the heavy moves exist to create.
		const punishable =
			input.enemyPhase === "recovery" &&
			(input.enemyAction === "massive" || input.enemyAction === "uppercut");
		if (punishable && distance < STRIKE_RANGE_PX) {
			return LONE_SLASH;
		}

		// A swing is coming. Blocking it early enough guard-breaks them; blocking
		// late at least survives it.
		//
		// This outranks releasing an armed Massive on purpose. A Massive needs
		// 190ms of startup against a slash that connects in 75, so answering a
		// swing with one loses the exchange *and* the charge.
		const incoming =
			input.enemyAction === "slash" &&
			(input.enemyPhase === "startup" || input.enemyPhase === "active") &&
			distance < STRIKE_RANGE_PX + 30;
		// A hurt fighter answers a read by covering up rather than by timing a
		// single parry. That is also the only way a guard ever gets held past the
		// parry window in an AI match — a purely reactive guard is always fresh,
		// so it always parries and a plain block never happens at all.
		if (this.willGuard(incoming)) {
			return input.selfHP <= 60 ? TURTLE : GUARD;
		}

		// They are stunned and cannot answer — the one safe moment to spend 190ms
		// of startup. Rolled once per stun rather than held as a standing rule:
		// charging on every single stun produced a degenerate match that was
		// nothing but stun → charge → Massive → stun, with 6-9 Massives per fight.
		// Since a heavy move forbids blocking for its whole 720ms, that left both
		// fighters unable to guard for most of the match, and not one slash was
		// ever blocked or parried.
		if (this.willPunishStun(input.enemyStunned) && distance < CHARGE_RANGE_PX) {
			return input.selfMassiveReady ? RELEASE_MASSIVE : CHARGE_BEATS;
		}

		// A charge that is already paid for. Spend it when there is no swing to
		// answer and the target is in reach.
		if (input.selfMassiveReady && distance < STRIKE_RANGE_PX + 20) {
			return RELEASE_MASSIVE;
		}

		// They are turtling. A block only covers the front and cannot stop an
		// uppercut, so there are two answers; take the one the range allows.
		if (input.enemyBlocking && distance < UPPERCUT_RANGE_PX + 10) {
			return UPPERCUT_BEATS;
		}

		return null;
	}

	/** Roll once per stun, so a long stun is one decision and not fifty. */
	private willPunishStun(stunned: boolean): boolean {
		if (!stunned) {
			this.stunPunishDecision = null;
			return false;
		}
		if (this.stunPunishDecision === null) {
			this.stunPunishDecision =
				Math.random() < 0.3 + 0.4 * this.config.aggressiveness;
		}
		return this.stunPunishDecision;
	}

	/**
	 * Roll once per threat, not once per tick.
	 *
	 * Reading a swing is a single decision a fighter either makes or does not.
	 * Re-rolling every frame would turn any non-zero skill into a certainty
	 * within a few frames, so every bot would block everything.
	 */
	private willGuard(incoming: boolean): boolean {
		if (!incoming) {
			this.guardDecision = null;
			return false;
		}
		if (this.guardDecision === null) {
			this.guardDecision = Math.random() < this.config.skillLevel / 10;
		}
		return this.guardDecision;
	}

	/** What to do when the opponent is not offering anything to answer. */
	private pressureTechnique(
		input: AIInput,
		distance: number,
	): MeleeBeat[] | null {
		const skill = this.config.skillLevel / 10;

		if (distance < STRIKE_RANGE_PX) {
			// Hurt fighters cover up. This is the only way a guard gets held past
			// the parry window, so it is also the only thing that makes the
			// uppercut's whole purpose reachable.
			const hurt = input.selfHP <= 60;
			if (hurt && Math.random() < 0.4 - 0.2 * skill) return TURTLE;

			// Close quarters. The butterfly is the default because it is safe *and*
			// it hurts; a lone slash is the greedier option when the opponent is
			// already reeling.
			const greedy = input.enemyAction === "none" && Math.random() < 0.25;
			return greedy ? LONE_SLASH : BUTTERFLY;
		}

		// Out of reach but close enough to threaten: charge, and let the walk
		// toward them arrive at the same time the Massive does. Only when they are
		// not already winding up something of their own.
		if (
			distance < CHARGE_RANGE_PX &&
			input.enemyAction === "none" &&
			Math.random() < 0.25 * skill
		) {
			return CHARGE_BEATS;
		}

		return null;
	}

	private startBeats(beats: MeleeBeat[] | null) {
		this.beats = beats;
		this.beatIndex = 0;
		this.beatElapsed = 0;
		// Only the butterfly repeats; everything else is a single commitment.
		this.beatLoops = beats === BUTTERFLY ? 2 + Math.floor(Math.random() * 3) : 0;
	}

	/** Emit the current beat's buttons and advance the rhythm. */
	private playBeats(output: AIOutput, delta: number) {
		if (!this.beats) return;

		const beat = this.beats[this.beatIndex];
		output.attack = beat.attack ?? false;
		output.block = beat.block ?? false;
		output.uppercut = beat.uppercut ?? false;

		this.beatElapsed += delta;
		if (this.beatElapsed < beat.ms) return;

		this.beatElapsed = 0;
		this.beatIndex++;
		if (this.beatIndex < this.beats.length) return;

		if (this.beatLoops > 0) {
			this.beatLoops--;
			this.beatIndex = 0;
			return;
		}
		this.beats = null;
	}

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
		if (input.distanceToPlayer < STRIKE_RANGE_PX) {
			return isLowHP ? AIState.RETREAT : AIState.ATTACK;
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
		const accuracyFactor = this.config.accuracy * (this.config.skillLevel / 10);
		const aimJitter = (1 - accuracyFactor) * 0.5;
		const aimAngle =
			Math.atan2(input.playerY - input.selfY, input.playerX - input.selfX) +
			(Math.random() - 0.5) * aimJitter;

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
			aimAngle,
			evadeActive: false,
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
				} else if (!input.hasLineOfSight && input.touchingDown) {
					output.jump = true;
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
					const wanted = this.swordDrawn ? STRIKE_RANGE_PX - 12 : 80;
					if (input.distanceToPlayer > wanted) {
						output.moveRight = input.playerX > input.selfX;
						output.moveLeft = input.playerX <= input.selfX;
					}
					const strafe =
						!this.swordDrawn && Math.random() < (isLowHP ? 0.2 : 0.4);
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
		if (blockedAhead && (input.touchingDown || this.jumpHoldTimer > 0)) {
			output.jump = true;
		}

		return output;
	}
}

export default EnemyBrain;
