import type Phaser from "phaser";

/**
 * Lazily grown, recycled sprite pool.
 *
 * Bullets are created and destroyed constantly; allocating a Phaser sprite per
 * shot causes GC hitches that show up as frame-time spikes in the physics
 * diagnostic. Visibility doubles as the free/used flag.
 */
export class SpritePool {
	private sprites: Phaser.GameObjects.Sprite[] = [];

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly texture: string,
	) {}

	get size(): number {
		return this.sprites.length;
	}

	acquire(): Phaser.GameObjects.Sprite {
		for (const s of this.sprites) {
			if (!s.visible) {
				s.setVisible(true);
				return s;
			}
		}
		const s = this.scene.add.sprite(0, 0, this.texture);
		s.setOrigin(0.5);
		this.sprites.push(s);
		return s;
	}

	release(sprite: Phaser.GameObjects.Sprite) {
		sprite.setVisible(false);
	}

	releaseAll() {
		for (const s of this.sprites) s.setVisible(false);
	}

	/** Show exactly `count` sprites, growing the pool as needed. */
	take(count: number): Phaser.GameObjects.Sprite[] {
		while (this.sprites.length < count) {
			const s = this.scene.add.sprite(0, 0, this.texture);
			s.setOrigin(0.5);
			s.setVisible(false);
			this.sprites.push(s);
		}
		for (let i = 0; i < this.sprites.length; i++) {
			this.sprites[i].setVisible(i < count);
		}
		return this.sprites.slice(0, count);
	}
}
