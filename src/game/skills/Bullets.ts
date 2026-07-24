import type Phaser from "phaser";
import { EventBus } from "../EventBus";
import { BULLET_SPEED } from "../simulation/Physics";

export interface BulletData {
	sprite: Phaser.GameObjects.Sprite;
	vx: number;
	vy: number;
	active: boolean;
	ownerId: string;
}

export default class Bullets {
	private pool: BulletData[] = [];
	private scene: Phaser.Scene;
	private nextId = 0;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
	}

	setOwner(_id: string) {}

	fireBullet(x: number, y: number, angle: number): BulletData | null {
		let data = this.pool.find((b) => !b.active);
		if (!data) {
			const sprite = this.scene.add.sprite(0, 0, "fireball");
			sprite.setOrigin(0.5);
			sprite.setVisible(false);
			data = {
				sprite,
				vx: 0,
				vy: 0,
				active: false,
				ownerId: "",
			};
			this.pool.push(data);
		}
		data.sprite.setPosition(x, y);
		data.sprite.setVisible(true);
		data.vx = Math.cos(angle) * BULLET_SPEED;
		data.vy = Math.sin(angle) * BULLET_SPEED;
		data.active = true;
		data.ownerId = "local";
		EventBus.emit("bullet-fired");
		return data;
	}

	getActive(): BulletData[] {
		return this.pool.filter((b) => b.active);
	}

	getAll(): BulletData[] {
		return this.pool;
	}

	deactivateAll() {
		for (const b of this.pool) {
			b.active = false;
			b.sprite.setVisible(false);
		}
	}
}
