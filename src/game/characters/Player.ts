import Phaser from "phaser";
import { ATTACK_COOLDOWN } from "../constants";
import Bullets from "../skills/Bullets";
import type { AIOutput } from "./EnemyBrain";

import { FacingState, MovementState } from "./playerStates";

interface DoublePressEntry {
	lastTime: number;
	canDouble: boolean;
}

export default class Player extends Phaser.GameObjects.Sprite {
	private doublePressEligibility: Record<number, DoublePressEntry> = {};
	movementState = MovementState.NATURAL;
	private stateTimer = 0;
	public bullets!: Bullets;
	private mouseAngle = 0;
	hp = 100;
	lastFacingDirection = 1;
	private aiOverrideInput: AIOutput | null = null;
	lastAttackTime = 0;
	private attackCooldown = ATTACK_COOLDOWN;
	grounded = false;

	constructor(
		scene: Phaser.Scene,
		x: number,
		y: number,
		texture: string,
		frame?: string | number,
	) {
		super(scene, x, y, texture, frame);
		scene.sys.displayList.add(this);
		scene.sys.updateList.add(this);
		this.bullets = new Bullets(scene);
		this.bullets.setOwner("PLAYER");
	}

	checkDoubleEligibility(
		key: Phaser.Input.Keyboard.Key,
		eligibilityState: Record<number, DoublePressEntry>,
		time: number,
	) {
		const { keyCode } = key;
		const lastTime = eligibilityState[keyCode]?.lastTime ?? 0;
		const currentTime = time;
		const isJustPressed = Phaser.Input.Keyboard.JustDown(key);
		const deltaTime = currentTime - lastTime;
		const eligibility = eligibilityState[keyCode];
		let canDouble = eligibility?.canDouble ?? false;
		if (isJustPressed && canDouble && deltaTime < 200) {
			canDouble = true;
		} else {
			canDouble = false;
		}
		if (canDouble)
			console.table({ hayai: "早い", deltaTime, currentTime, lastTime });
		eligibilityState[keyCode] = {
			canDouble: !canDouble,
			lastTime: currentTime,
		};
		return canDouble;
	}

	takeDamage(amount: number) {
		this.hp -= amount;
	}

	setAIOverride(input: AIOutput | null) {
		this.aiOverrideInput = input;
	}

	getMouseAngle() {
		return this.mouseAngle;
	}

	getFacingDirection(): number {
		const key = this.anims.currentAnim?.key;
		const dir = key === "left" ? -1 : 1;
		this.lastFacingDirection = dir;
		return dir;
	}

	setMouseAngle(angle: number) {
		this.mouseAngle = angle;
	}

	preUpdate(t: number, dt: number) {
		super.preUpdate(t, dt);

		if (this.movementState !== MovementState.NATURAL) this.stateTimer += dt;

		const dashSpeed = 1000;

		switch (this.movementState) {
			case MovementState.DASHING_LEFT:
				this.x -= dashSpeed * (dt / 1000);
				if (this.stateTimer >= 250) this.cleanMovementState();
				break;

			case MovementState.DASHING_RIGHT:
				this.x += dashSpeed * (dt / 1000);
				if (this.stateTimer >= 250) this.cleanMovementState();
				break;

			default:
				this.cleanMovementState();
				break;
		}

	}

	private cleanMovementState() {
		this.movementState = MovementState.NATURAL;
		this.stateTimer = 0;
	}

	decideFacing = () => {
		const currentKey = this.anims.currentAnim?.key;
		const direction = currentKey?.split("-")[0];
		if (direction === "left") {
			return FacingState.LEFT;
		}
		return FacingState.RIGHT;
	};

	decideIdle() {
		const currentFacing = this.decideFacing();
		if (currentFacing === FacingState.LEFT) {
			this.anims.play("left");
		} else {
			this.anims.play("right");
		}
	}

	update(
		t: number,
		_dt: number,
		cursors: Record<string, Phaser.Input.Keyboard.Key>,
	) {
		if (this.aiOverrideInput) {
			this.updateAI();
			return;
		}
		if (this.movementState !== MovementState.NATURAL) return;
		if (!cursors?.right?.isDown && cursors?.left?.isDown) {
			if (
				this.checkDoubleEligibility(
					cursors.left,
					this.doublePressEligibility,
					t,
				)
			) {
				this.movementState = MovementState.DASHING_LEFT;
			}
			this.anims.play("left", true);
		} else if (cursors?.right?.isDown && !cursors?.left?.isDown) {
			if (
				this.checkDoubleEligibility(
					cursors.right,
					this.doublePressEligibility,
					t,
				)
			) {
				this.movementState = MovementState.DASHING_RIGHT;
			}
			this.anims.play("right", true);
		} else {
			this.decideIdle();
		}
	}

	private updateAI() {
		const input = this.aiOverrideInput!;
		if (this.movementState !== MovementState.NATURAL) return;
		if (input.moveLeft) {
			this.anims.play("left", true);
		} else if (input.moveRight) {
			this.anims.play("right", true);
		} else {
			this.decideIdle();
		}
		this.mouseAngle = input.aimAngle;
	}
}
