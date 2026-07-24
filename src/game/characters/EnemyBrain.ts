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
}

export interface AIOutput {
	moveLeft: boolean;
	moveRight: boolean;
	jump: boolean;
	attack: boolean;
	aimAngle: number;
	evadeActive: boolean;
	switchToMelee: boolean;
	switchToRanged: boolean;
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

export default class EnemyBrain {
	private config: AIConfig;
	private state: AIState = AIState.IDLE;
	private decisionCooldown = 0;
	private stateTimer = 0;
	private stuckTimer = 0;
	private stuckCheckX = 0;
	private stuckCheckY = 0;
	private stuckCount = 0;
	private evadeTimer = 0;
	private jumpHoldTimer = 0;
	private jumpReleaseTimer = 0;

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
		this.evadeTimer = 0;
		this.jumpHoldTimer = 0;
		this.jumpReleaseTimer = 0;
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
		output.jump = this.resolveJump(output.jump, delta);
		return output;
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
		if (input.distanceToPlayer < 60) {
			return AIState.RETREAT;
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
			aimAngle,
			evadeActive: false,
			switchToMelee: false,
			switchToRanged: true,
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
					if (input.distanceToPlayer > 80) {
						output.moveRight = input.playerX > input.selfX;
						output.moveLeft = input.playerX <= input.selfX;
					}
					const strafe = Math.random() < (isLowHP ? 0.2 : 0.4);
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
