/**
 * The dragon thrust's trail: the golden serpent that follows the rider.
 *
 * Pure presentation, like every effect: it reads the rider's *drawn* position
 * and velocity from `Match`, and it writes nothing back. The simulation does
 * not know a dragon is being drawn — it only knows the ride timer, which is
 * exactly the division the whole architecture rests on.
 *
 * The dragon is a chain of body segments that follows the rider's path like a
 * wake: each segment chases the one ahead of it, the head leads at the rider,
 * and the whole chain is rotated along the ride's direction. Gold and red,
 * baked rather than tinted — the black hole's art precedent: a tint cannot
 * carry gold.
 */

import { Container, Sprite } from "pixi.js";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/** How many body segments trail the head. Each is one scale arc. */
const SEGMENTS = 7;
/** How fast the wake's far end fades out. */
const FADE_PER_MS = 1 / 260;
/** Cadence of the golden spark emissions while riding. */
const SPARK_EVERY_MS = 22;
/** The head is bigger than the body — it is the face of the move. */
const HEAD_SCALE = 1.25;
const BODY_SCALE = 1.0;

export class DragonFx {
	/** Where the rider is and how they are travelling, or null when no ride. */
	private rider: { x: number; y: number; vx: number; vy: number } | null = null;
	private alpha = 0;
	private sparkAccMs = 0;
	private readonly node: Container;
	/** The segment sprites, tail first — index 0 is the farthest behind. */
	private readonly segments: Sprite[] = [];
	private readonly head: Sprite;
	private readonly particles: ParticleSystem;
	/** Each segment's own chase lag, in px. */
	private readonly lag: number[] = [];
	/** The drawn position of each segment, so the chase has a memory. */
	private readonly chain: { x: number; y: number }[] = [];

	constructor(
		private readonly stage: Stage,
		particles?: ParticleSystem,
	) {
		// The serpent sits *behind* the fighter it is carrying — the rider is
		// the head of the dragon, and a head with a body drawn over it would be
		// a head with no body.
		this.node = new Container();
		this.node.visible = false;
		this.node.alpha = 0;
		stage.effects.addChild(this.node);

		this.head = new Sprite(tex(TEX.dragonHead));
		this.head.anchor.set(0.4, 0.5);
		this.head.scale.set(HEAD_SCALE, HEAD_SCALE);
		this.node.addChild(this.head);

		for (let i = 0; i < SEGMENTS; i++) {
			const segment = new Sprite(tex(TEX.dragonBody));
			segment.anchor.set(0.5, 0.5);
			segment.scale.set(BODY_SCALE, BODY_SCALE);
			this.node.addChild(segment);
			this.segments.push(segment);
			this.lag.push(16 + i * 9);
			this.chain.push({ x: 0, y: 0 });
		}

		this.particles = particles ?? new ParticleSystem(stage.effects);
	}

	/** A ride started (or the rider changed). */
	setRider(rider: { x: number; y: number; vx: number; vy: number }) {
		this.rider = rider;
		this.alpha = 1;
		// The node starts at alpha 0 (it fades in and out), so making the
		// dragon visible means applying the alpha to the node itself — the
		// first version set the field and left the node transparent forever.
		this.node.alpha = 1;
		this.node.visible = true;
		// The chain starts coiled behind the rider along the launch line, so
		// the first frames read as a dragon arriving rather than a dragon
		// assembling.
		const len = Math.hypot(rider.vx, rider.vy) || 1;
		const nx = rider.vx / len;
		const ny = rider.vy / len;
		for (let i = 0; i < SEGMENTS; i++) {
			this.chain[i] = {
				x: rider.x - nx * (this.lag[i] ?? 16) * 2,
				y: rider.y - ny * (this.lag[i] ?? 16) * 2,
			};
		}
	}

	/** The ride ended — or there is no rider this frame. */
	clearRider() {
		this.rider = null;
	}

	/**
	 * Drive the serpent. Call every frame with the rider's *drawn* position
	 * (null when nobody is riding).
	 */
	update(
		rider: { x: number; y: number; vx: number; vy: number } | null,
		dtMs: number,
	) {
		if (rider) this.setRider(rider);
		if (!this.rider) {
			// Fade out after the ride ends instead of popping.
			if (this.alpha > 0) {
				this.alpha = Math.max(0, this.alpha - FADE_PER_MS * dtMs);
				this.node.alpha = this.alpha;
				if (this.alpha <= 0) this.node.visible = false;
			}
			this.particles.update(dtMs);
			return;
		}

		this.alpha = 1;
		this.node.visible = true;

		const { x, y, vx, vy } = this.rider;
		const len = Math.hypot(vx, vy) || 1;
		const nx = vx / len;
		const ny = vy / len;

		// The head leads at the rider, angled down the line — but a full body
		// ahead, never on top of them: the rider is the head of the dragon, and
		// a head drawn over the rider's sprite would hide the player the move
		// belongs to.
		this.head.position.set(x + nx * 18, y + ny * 6);
		this.head.rotation = Math.atan2(vy, vx);
		// A little bob against the direction of travel — the head rides the
		// current, it does not pull it.
		this.head.y += Math.sin((this.stage.cameraX + x) * 0.02) * 1.5;

		// Each segment chases the one ahead: the wake. The farthest one is
		// dimmest, so the tail reads as distance rather than as more heads.
		let prevX = x;
		let prevY = y;
		for (let i = 0; i < SEGMENTS; i++) {
			const p = this.chain[i]!;
			const targetX = prevX - nx * (this.lag[i] ?? 16);
			const targetY = prevY - ny * (this.lag[i] ?? 16);
			p.x += (targetX - p.x) * 0.35;
			p.y += (targetY - p.y) * 0.35;
			const segment = this.segments[i]!;
			segment.position.set(p.x, p.y);
			segment.rotation = Math.atan2(targetY - p.y, targetX - p.x);
			const t = (SEGMENTS - i) / SEGMENTS;
			segment.alpha = 0.35 + 0.6 * t;
			segment.scale.set(BODY_SCALE * (0.7 + 0.4 * t));
			prevX = p.x;
			prevY = p.y;
		}

		// The wake: golden sparks shedding off the tail, and a soft mane wisp
		// streaming off the head.
		this.sparkAccMs += dtMs;
		while (this.sparkAccMs >= SPARK_EVERY_MS) {
			this.sparkAccMs -= SPARK_EVERY_MS;
			const tail = this.chain[SEGMENTS - 1]!;
			this.particles.burst({
				texture: TEX.spark,
				count: 2,
				x: tail.x,
				y: tail.y,
				tint: Math.random() < 0.5 ? 0xffd166 : 0xff9a3d,
				speed: [40, 130],
				angle: [Math.atan2(ny, nx) + 2.4, Math.atan2(ny, nx) + 3.8],
				lifeMs: 320,
				scale: [1.6, 0],
				alpha: [0.8, 0],
			});
		}

		this.particles.update(dtMs);
	}

	reset() {
		this.rider = null;
		this.alpha = 0;
		this.node.visible = false;
		this.particles.clear();
	}
}
