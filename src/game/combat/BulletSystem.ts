import type { Container, Sprite, Texture } from "pixi.js";
import {
	DEGREES_PER_PI_RADIANS,
	PELLET_ALPHA,
	PELLET_SCALE,
} from "../../tweakables/ranged.js";
import type { BulletSample } from "../diagnostics/PhysicsDiagnostics";
import { SpritePool } from "../render/SpritePool";
import {
	BULLET_SPEED,
	type BulletState,
	blocksBullet,
	bulletHitsPlatform,
	bulletHitsPlayer,
	DEFAULT_WORLD,
	isBulletOutOfBounds,
	type PlayerPosition,
	tickBullet,
	type World,
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
	/**
	 * The fighter's simulation state: a raised guard stops a bullet too, and a
	 * rolling fighter is judged against its smaller roll box.
	 */
	state: PlayerPosition;
	/**
	 * `bullet` is the round that landed, so a weapon's distance falloff can be
	 * read at the range it connected — a shotgun pellet hurts less the farther
	 * it flew, online and off.
	 */
	onHit: (bullet: BulletState) => void;
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

	constructor(
		layer: Container,
		texture: Texture,
		private readonly world: World = DEFAULT_WORLD,
	) {
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
			originX: x,
			originY: y,
			vx: Math.cos(angle) * BULLET_SPEED,
			vy: Math.sin(angle) * BULLET_SPEED,
			sprite,
		});
	}

	/**
	 * Fire a weapon's fan: one shot for an ordinary weapon, a deterministic
	 * spread of pellets for a shotgun — the same fixed-angle fan the server
	 * spawns, so the offline escape hatch never becomes a second set of
	 * combat rules. Pellets are drawn smaller and dimmer, like the online
	 * path's.
	 */
	fireFan(
		x: number,
		y: number,
		angle: number,
		owner: BulletOwner,
		weapon: { pellets?: number; spreadDeg?: number },
	) {
		const pellets = weapon.pellets ?? 1;
		const halfSpread =
			((weapon.spreadDeg ?? 0) * Math.PI) / DEGREES_PER_PI_RADIANS;
		const step = pellets > 1 ? (halfSpread * 2) / (pellets - 1) : 0;
		for (let i = 0; i < pellets; i++) {
			const a = angle + (pellets > 1 ? -halfSpread + step * i : 0);
			const sprite = this.pool.acquire();
			sprite.position.set(x, y);
			sprite.scale.set(pellets > 1 ? PELLET_SCALE : 1);
			sprite.alpha = pellets > 1 ? PELLET_ALPHA : 1;
			this.bullets.push({
				id: this.nextId++,
				ownerId: owner,
				x,
				y,
				originX: x,
				originY: y,
				vx: Math.cos(a) * BULLET_SPEED,
				vy: Math.sin(a) * BULLET_SPEED,
				sprite,
			});
		}
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
			if (
				isBulletOutOfBounds(b, this.world) ||
				bulletHitsPlatform(b, this.world)
			) {
				this.pool.release(b.sprite);
				continue;
			}

			let consumed = false;
			for (const target of targets) {
				if (target.owner === b.ownerId || !target.alive) continue;
				if (!bulletHitsPlayer(b, target.state)) continue;
				// The same rule the server applies, from the same function. The escape
				// hatch is the one path nobody dogfoods, so it must never become a
				// second set of combat rules. The round itself rides the callback so
				// the same distance falloff the server reads is read here too.
				if (!blocksBullet(target.state, b.vx)) target.onHit(b);
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
