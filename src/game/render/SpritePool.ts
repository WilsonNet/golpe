/**
 * Lazily grown, recycled sprite pool.
 *
 * Bullets are created and destroyed constantly; allocating a sprite per shot
 * causes GC hitches that show up as frame-time spikes in the physics
 * diagnostic. Visibility doubles as the free/used flag.
 */

import { type Container, Sprite, type Texture } from "pixi.js";

/** A centre-origin sprite, which is what every actor and effect wants. */
export function poolSprite(texture: Texture): Sprite {
	const s = new Sprite(texture);
	s.anchor.set(0.5);
	return s;
}

export class SpritePool {
	private sprites: Sprite[] = [];

	constructor(
		private readonly layer: Container,
		private readonly texture: Texture,
	) {}

	get size(): number {
		return this.sprites.length;
	}

	acquire(): Sprite {
		for (const s of this.sprites) {
			if (!s.visible) {
				s.visible = true;
				return s;
			}
		}
		const s = poolSprite(this.texture);
		this.layer.addChild(s);
		this.sprites.push(s);
		return s;
	}

	release(sprite: Sprite) {
		sprite.visible = false;
	}

	releaseAll() {
		for (const s of this.sprites) s.visible = false;
	}

	/** Show exactly `count` sprites, growing the pool as needed. */
	take(count: number): Sprite[] {
		while (this.sprites.length < count) {
			const s = poolSprite(this.texture);
			s.visible = false;
			this.layer.addChild(s);
			this.sprites.push(s);
		}
		for (let i = 0; i < this.sprites.length; i++) {
			this.sprites[i].visible = i < count;
		}
		return this.sprites.slice(0, count);
	}
}
