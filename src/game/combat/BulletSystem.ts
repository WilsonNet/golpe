import type { Container, Sprite, Texture } from "pixi.js";
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
	sprite: Sprite;
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

	constructor(layer: Container, texture: Texture) {
		this.pool = new SpritePool(layer, texture);
	}

	get count(): number {
		return this.bullets.length;
	}

	/** Projectiles as drawn, keyed by stable id, for the diagnostic. */
	snapshot(): BulletSample[] {
		return this.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y }));
	}

	/**
	 * Projectiles with their headings, for the aim probe.
	 *
	 * `snapshot()` deliberately carries position only — the physics diagnostic
	 * measures travel, and a heading tells it nothing. Aim is the opposite: the
	 * heading *is* the measurement, because a shot that leaves the right place in
	 * the wrong direction looks identical from a position sample.
	 */
	vectors(): {
		id: number;
		owner: string;
		x: number;
		y: number;
		vx: number;
		vy: number;
	}[] {
		return this.bullets.map((b) => ({
			id: b.id,
			owner: b.ownerId,
			x: b.x,
			y: b.y,
			vx: b.vx,
			vy: b.vy,
		}));
	}

	fire(x: number, y: number, angle: number, owner: BulletOwner) {
		const sprite = this.pool.acquire();
		sprite.position.set(x, y);
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
		// Compact in place rather than splicing mid-iteration: survivors move to
		// the front and the array is truncated once, so no index has to be
		// reasoned about while the array is changing under it.
		let kept = 0;
		for (const b of this.bullets) {
			if (isBulletOutOfBounds(b) || bulletHitsPlatform(b)) {
				this.pool.release(b.sprite);
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
				this.pool.release(b.sprite);
				continue;
			}

			b.sprite.position.set(b.x, b.y);
			this.bullets[kept++] = b;
		}
		this.bullets.length = kept;
	}

	clear() {
		for (const b of this.bullets) this.pool.release(b.sprite);
		this.bullets.length = 0;
	}
}
