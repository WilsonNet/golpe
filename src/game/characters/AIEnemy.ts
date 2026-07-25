import Phaser from "phaser";
import { EventBus } from "../EventBus";
import Bullets from "../skills/Bullets";
import { type AIConfig, DEFAULT_AI_CONFIG } from "./AIConfig";
import EnemyBrain, { type AIInput, type AIOutput } from "./EnemyBrain";

export default class AIEnemy extends Phaser.GameObjects.Sprite {
	public bullets: Bullets;
	private brain: EnemyBrain;
	private _hp = 100;
	lastFacingDirection = 1;
	lastAttackTime = 0;
	grounded = false;
	lastAIOutput: AIOutput = {
		moveLeft: false,
		moveRight: false,
		jump: false,
		attack: false,
		block: false,
		uppercut: false,
		swordStance: true,
		face: 0,
		aimAngle: 0,
		evadeActive: false,
	};

	public get hp() {
		return this._hp;
	}

	public set hp(value: number) {
		this._hp = value;
	}

	public get brainConfig() {
		return this.brain.getConfig();
	}

	constructor(
		scene: Phaser.Scene,
		x: number,
		y: number,
		texture: string,
		config?: Partial<AIConfig>,
		frame?: string | number,
	) {
		super(scene, x, y, texture, frame);
		scene.sys.displayList.add(this);
		scene.sys.updateList.add(this);
		this.bullets = new Bullets(scene);
		this.bullets.setOwner("ENEMY");
		this.brain = new EnemyBrain({ ...DEFAULT_AI_CONFIG, ...config });
	}

	updateConfig(config: Partial<AIConfig>) {
		this.brain.updateConfig(config);
	}

	resetBrain() {
		this.brain.resetState();
	}

	takeDamage(amount: number) {
		this._hp -= amount;
		EventBus.emit("enemy-hp-changed", this._hp);
	}

	getCurrentAIState() {
		return this.brain.getCurrentState();
	}

	getFacingDirection(): number {
		const key = this.anims.currentAnim?.key;
		const dir = key === "left" ? -1 : 1;
		this.lastFacingDirection = dir;
		return dir;
	}

	preUpdate(t: number, dt: number) {
		super.preUpdate(t, dt);
	}

	/**
	 * Decide and animate. Perception is built by the scene, from simulation state
	 * only, so the offline enemy and the server-hosted bot read the world through
	 * exactly the same structure.
	 *
	 * Neither bullets nor sword hits are spawned here. Bullets belong to the
	 * scene's `BulletSystem` (offline) or the server (online); melee is resolved
	 * by the simulation from `PlayerPosition`. This class used to spawn its own
	 * melee sprite, which nothing simulated and which therefore never hit anyone.
	 */
	update(input: AIInput, time: number, delta: number) {
		if (this._hp <= 0) {
			this.anims.play("turn");
			return;
		}

		// The brain runs every frame. It used to be skipped during a dodge, which
		// froze `lastAIOutput` and left the scene driving physics from stale
		// intent — evade now flows through the same movement path as everything
		// else, so there is only one way a fighter can move.
		const output = this.brain.decide(input, time, delta);
		this.lastAIOutput = output;

		if (output.moveLeft && !output.moveRight) {
			this.lastFacingDirection = -1;
			this.anims.play("left", true);
		} else if (output.moveRight && !output.moveLeft) {
			this.lastFacingDirection = 1;
			this.anims.play("right", true);
		} else {
			if (this.grounded) this.anims.play("turn");
		}
	}
}
