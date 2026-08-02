/**
 * A small pooled particle system.
 *
 * Pixi has no emitter of its own, and the third-party ones bring a config
 * format larger than the effects we need. This is deliberately minimal: burst
 * emission, linear velocity with gravity, and lerped scale/alpha — which covers
 * every combat effect in the game.
 *
 * Nothing here is deterministic and nothing needs to be. Particles are drawn
 * from wall-clock frame time and never read back by the simulation, so they
 * cannot desync a match no matter how many of them there are.
 */

import type { Container, Sprite } from "pixi.js";
import { tex } from "./assets";
import { poolSprite } from "./SpritePool";

export interface BurstOptions {
	texture: string;
	count: number;
	x: number;
	y: number;
	tint: number;
	speed: [min: number, max: number];
	/** Emission cone, radians. Defaults to a full circle. */
	angle?: [min: number, max: number];
	lifeMs: number;
	scale?: [from: number, to: number];
	alpha?: [from: number, to: number];
	gravity?: number;
	spin?: boolean;
	blend?: boolean;
	/**
	 * Fixed initial rotation, radians.
	 *
	 * `spin` scatters random rotations; this sets one, which is what turns a
	 * horizontal shard texture into a vertical flame wisp. Both can coexist —
	 * `spin` adds its own rotation on top of this one.
	 */
	rotation?: number;
}

interface Particle {
	sprite: Sprite;
	vx: number;
	vy: number;
	lifeMs: number;
	ageMs: number;
	scaleFrom: number;
	scaleTo: number;
	alphaFrom: number;
	alphaTo: number;
	gravity: number;
	spin: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class ParticleSystem {
	private readonly live: Particle[] = [];
	private readonly free: Sprite[] = [];

	constructor(private readonly layer: Container) {}

	get liveCount(): number {
		return this.live.length;
	}

	burst(o: BurstOptions) {
		const [aMin, aMax] = o.angle ?? [0, Math.PI * 2];
		const [sFrom, sTo] = o.scale ?? [1, 0];
		const [alFrom, alTo] = o.alpha ?? [1, 0];

		for (let i = 0; i < o.count; i++) {
			const sprite = this.free.pop() ?? this.make();
			sprite.texture = tex(o.texture);
			sprite.tint = o.tint;
			sprite.blendMode = o.blend === false ? "normal" : "add";
			sprite.position.set(o.x, o.y);
			sprite.scale.set(sFrom);
			sprite.alpha = alFrom;
			sprite.rotation =
				(o.rotation ?? 0) + (o.spin ? Math.random() * Math.PI * 2 : 0);
			sprite.visible = true;

			const angle = rand(aMin, aMax);
			const speed = rand(o.speed[0], o.speed[1]);

			this.live.push({
				sprite,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				lifeMs: o.lifeMs,
				ageMs: 0,
				scaleFrom: sFrom,
				scaleTo: sTo,
				alphaFrom: alFrom,
				alphaTo: alTo,
				gravity: o.gravity ?? 0,
				spin: o.spin ? rand(-6, 6) : 0,
			});
		}
	}

	private make(): Sprite {
		const s = poolSprite(tex("fx_spark"));
		this.layer.addChild(s);
		return s;
	}

	update(dtMs: number) {
		const dt = dtMs / 1000;

		// Compact in place: advance every particle, keep the survivors at the front,
		// then truncate. This replaced a backwards swap-remove — which worked, but
		// only because of an index argument you had to reconstruct every time you
		// read it. Here there is no index at all, so there is nothing to get wrong.
		let kept = 0;
		for (const p of this.live) {
			p.ageMs += dtMs;

			if (p.ageMs >= p.lifeMs) {
				p.sprite.visible = false;
				this.free.push(p.sprite);
				continue;
			}

			const t = p.ageMs / p.lifeMs;
			p.vy += p.gravity * dt;
			p.sprite.x += p.vx * dt;
			p.sprite.y += p.vy * dt;
			p.sprite.scale.set(p.scaleFrom + (p.scaleTo - p.scaleFrom) * t);
			p.sprite.alpha = p.alphaFrom + (p.alphaTo - p.alphaFrom) * t;
			if (p.spin) p.sprite.rotation += p.spin * dt;

			this.live[kept++] = p;
		}
		this.live.length = kept;
	}

	clear() {
		for (const p of this.live) {
			p.sprite.visible = false;
			this.free.push(p.sprite);
		}
		this.live.length = 0;
	}
}
