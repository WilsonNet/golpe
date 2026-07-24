import type Phaser from "phaser";
import type { BulletSample } from "../diagnostics/PhysicsDiagnostics";
import { SpritePool } from "../render/SpritePool";
import {
	BULLET_SPEED,
	type BulletState,
	bulletHitsPlatform,
	bulletHitsPlayer,
	isBulletOutOfBounds,
	tickBullet,
} from "../simulation/Physics";

export type BulletOwner = "player" | "enemy";

interface LocalBullet extends BulletState {
	sprite: Phaser.GameObjects.Sprite;
}

/** Something a bullet can hit. `onHit` runs at most once per bullet. */
export interface BulletTarget {
	/** Bullets from this owner pass through — you cannot shoot yourself. */
	owner: BulletOwner;
	x: number;
	y: number;
	alive: boolean;
	onHit: () => void;
}

/**
 * Offline bullet simulation and rendering.
 *
 * Movement advances on the fixed physics step (`step`) while collision and
 * rendering happen once per frame (`resolve`), which keeps bullet travel
 * frame-rate independent for the same reason player movement is.
 */
export class BulletSystem {
	private bullets: LocalBullet[] = [];
	private pool: SpritePool;
	private nextId = 0;

	constructor(scene: Phaser.Scene, texture = "fireball") {
		this.pool = new SpritePool(scene, texture);
	}

	get count(): number {
		return this.bullets.length;
	}

	/** Projectiles as drawn, keyed by stable id, for the diagnostic. */
	snapshot(): BulletSample[] {
		return this.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y }));
	}

	fire(x: number, y: number, angle: number, owner: BulletOwner) {
		const sprite = this.pool.acquire();
		sprite.setPosition(x, y);
		this.bullets.push({
			id: this.nextId++,
			ownerId: owner,
			x,
			y,
			vx: Math.cos(angle) * BULLET_SPEED,
			vy: Math.sin(angle) * BULLET_SPEED,
			sprite,
		});
	}

	/** Advance every bullet by one fixed physics step. */
	step(dt: number) {
		for (const b of this.bullets) tickBullet(b, dt);
	}

	/** Despawn spent bullets, apply hits, and move the sprites. */
	resolve(targets: readonly BulletTarget[]) {
		for (let i = this.bullets.length - 1; i >= 0; i--) {
			const b = this.bullets[i];

			if (isBulletOutOfBounds(b) || bulletHitsPlatform(b)) {
				this.despawn(i);
				continue;
			}

			let consumed = false;
			for (const target of targets) {
				if (target.owner === b.ownerId || !target.alive) continue;
				if (!bulletHitsPlayer(b, target.x, target.y)) continue;
				target.onHit();
				consumed = true;
				break;
			}

			if (consumed) {
				this.despawn(i);
				continue;
			}

			b.sprite.setPosition(b.x, b.y);
		}
	}

	clear() {
		for (const b of this.bullets) this.pool.release(b.sprite);
		this.bullets.length = 0;
	}

	private despawn(index: number) {
		this.pool.release(this.bullets[index].sprite);
		this.bullets.splice(index, 1);
	}
}
