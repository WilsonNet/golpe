/**
 * The dragon thrust: a spectral golden serpent, in the spirit of Hanzo's
 * ultimate — a face leading a body of light.
 *
 * Pure presentation, like every effect: it reads the rider's *drawn* position
 * and velocity from `Match`, and it writes nothing back. The simulation does
 * not know a dragon is being drawn — it only knows the ride timer, which is
 * exactly the division the whole architecture rests on.
 *
 * The read, in order: a solid, detailed **head** (horns, glowing eye, red
 * mane) leading a body-length ahead of the rider; a **body of light** — many
 * segments chained behind it, additive-blended so they glow over the arena,
 * tapering to a fading tail; **energy motes** streaming backward along the
 * whole body; and a **mane wake** shedding off the head. When the ride ends
 * the body collapses quickly and the glow is gone — the dragon is an instant,
 * not a resident.
 */

import { Container, Sprite } from "pixi.js";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";

/** How many body segments trail the head. Each is one thick gold plate. */
const SEGMENTS = 26;
/** How fast the wake dissolves after the ride ends. */
const FADE_PER_MS = 1 / 60;
/** Cadence of the tail sparks while riding. */
const SPARK_EVERY_MS = 18;
/** Cadence of the energy motes streaming along the body. */
const MOTE_EVERY_MS = 10;
/** Cadence of the mane sparks shedding off the head. */
const MANE_EVERY_MS = 24;
/** The head's size against its texture. */
const HEAD_SCALE = 2.4;
/** The head leads this far ahead of the rider, so the player stays visible. */
const HEAD_LEAD_PX = 52;
/** How fast the body's sine wave travels along it — the serpentine motion. */
const WAVE_SPEED = 0.008;

export class DragonFx {
	/** Where the rider is and how they are travelling, or null when no ride. */
	private rider: { x: number; y: number; vx: number; vy: number } | null = null;
	private alpha = 0;
	private sparkAccMs = 0;
	private moteAccMs = 0;
	private maneAccMs = 0;
	/** The body's sine-wave phase — the undulation travels while riding. */
	private wavePhase = 0;
	/** The body and glow: behind the fighters, so the rider rides over them. */
	private readonly node: Container;
	/** The head and mane: in front, leading far enough ahead not to cover. */
	private readonly frontNode: Container;
	/** The segment sprites, tail first — index 0 is the farthest behind. */
	private readonly segments: Sprite[] = [];
	private readonly head: Sprite;
	private readonly headGlow: Sprite;
	/** The red-gold mane wake streaming off the back of the head. */
	private readonly mane: Sprite;
	private readonly particles: ParticleSystem;
	/** Each segment's own chase lag, in px. */
	private readonly lag: number[] = [];
	/** The drawn position of each segment, so the chase has a memory. */
	private readonly chain: { x: number; y: number }[] = [];

	constructor(
		fieldLayer: Container,
		effectsLayer: Container,
		particles?: ParticleSystem,
	) {
		// Two layers, like the black hole: the glow and the body sit *behind*
		// the fighters (field), so the rider rides over the serpent instead of
		// being buried inside it; the head, the mane and the motes sit in
		// front (effects), and the head leads far enough ahead that it never
		// covers the player it is carrying.
		this.node = new Container();
		this.node.visible = false;
		this.node.alpha = 0;
		fieldLayer.addChild(this.node);

		// The halo: a soft gold aura behind the head. Painted gold, never the
		// white halo disc — the white disc's stacked fills read as a white
		// blast over the bright sky, and a head lit by a blast is a head you
		// cannot see.
		this.headGlow = new Sprite(tex(TEX.dragonGlow));
		this.headGlow.anchor.set(0.5);
		this.headGlow.scale.set(1.5, 1.5);
		this.headGlow.alpha = 0.6;
		this.node.addChild(this.headGlow);

		for (let i = 0; i < SEGMENTS; i++) {
			const segment = new Sprite(tex(TEX.dragonBody));
			segment.anchor.set(0.5, 0.5);
			// The body is **painted**, not additive: the sky is bright, and
			// additive gold washes to white over it (the same rule that forced
			// the ultimate aura to be painted). Painted gold stays gold; the
			// bloom comes from the motes and the head's halo instead.
			this.node.addChild(segment);
			this.segments.push(segment);
			// A dense serpent: the plates sit closer than their width, so the
			// whole body is one overlapped band with no sky between — even on
			// the inside of a curve.
			this.lag.push(14 + (i % 3) * 3);
			this.chain.push({ x: 0, y: 0 });
		}

		// The head and the mane ride in front — above the fighters — and lead
		// far enough ahead that they never cover the rider.
		this.frontNode = new Container();
		this.frontNode.visible = false;
		effectsLayer.addChild(this.frontNode);

		this.head = new Sprite(tex(TEX.dragonHead));
		this.head.anchor.set(0.2, 0.5);
		this.head.scale.set(HEAD_SCALE, HEAD_SCALE);
		this.frontNode.addChild(this.head);

		// The mane wake: a red-gold wisp streaming off the back of the head.
		// Painted, for the same reason the halo is — additive washes on the
		// bright sky.
		this.mane = new Sprite(tex(TEX.dragonMane));
		this.mane.anchor.set(0.5, 0.5);
		this.mane.tint = 0xff7a4d;
		this.mane.scale.set(3.2, 3.2);
		this.mane.alpha = 0.6;
		this.frontNode.addChild(this.mane);

		this.particles = particles ?? new ParticleSystem(effectsLayer);
	}

	/** A ride started (or the rider changed). */
	setRider(rider: { x: number; y: number; vx: number; vy: number }) {
		this.rider = rider;
		this.alpha = 1;
		// The nodes start at alpha 0 (they fade in and out), so making the
		// dragon visible means applying the alpha to the nodes themselves —
		// the first version set the field and left the nodes transparent
		// forever.
		this.node.alpha = 1;
		this.node.visible = true;
		this.frontNode.alpha = 1;
		this.frontNode.visible = true;
		// The chain starts coiled behind the rider along the launch line, so
		// the first frames read as a dragon arriving rather than a dragon
		// assembling.
		const len = Math.hypot(rider.vx, rider.vy) || 1;
		const nx = rider.vx / len;
		const ny = rider.vy / len;
		for (let i = 0; i < SEGMENTS; i++) {
			this.chain[i] = {
				x: rider.x - nx * (this.lag[i] ?? 20) * 2,
				y: rider.y - ny * (this.lag[i] ?? 20) * 2,
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
		else this.rider = null;
		if (!this.rider) {
			// Dissolve instead of popping — but fast, and the motes die with
			// the ride: the dragon is an instant, not a resident.
			if (this.alpha > 0) {
				this.alpha = Math.max(0, this.alpha - FADE_PER_MS * dtMs);
				this.node.alpha = this.alpha;
				this.frontNode.alpha = this.alpha;
				if (this.alpha <= 0) {
					this.node.visible = false;
					this.frontNode.visible = false;
				}
			}
			this.particles.clear();
			this.particles.update(dtMs);
			return;
		}

		this.alpha = 1;
		this.node.visible = true;
		this.frontNode.visible = true;
		this.wavePhase += dtMs * WAVE_SPEED;

		const { x, y, vx, vy } = this.rider;
		const len = Math.hypot(vx, vy) || 1;
		const nx = vx / len;
		const ny = vy / len;
		const angle = Math.atan2(vy, vx);

		// The head leads ahead of the rider, angled down the line — never on
		// top of them: the rider is the head of the dragon, and a head drawn
		// over the player's sprite would hide the fighter the move belongs to.
		this.head.position.set(x + nx * HEAD_LEAD_PX, y + ny * 6);
		this.head.rotation = angle;
		this.headGlow.position.set(x + nx * HEAD_LEAD_PX - nx * 6, y + ny * 6);
		this.mane.position.set(x + nx * (HEAD_LEAD_PX - 26), y + ny * 6);
		this.mane.rotation = angle;

		// Each segment is placed **exactly** behind the one ahead — no chase,
		// or a ride this fast would leave the tail behind and the body would
		// read as a few beads near the head. The body is one unit behind the
		// head, like Hanzo's: always fully formed. A sine wave rides along it —
		// the perpendicular offset grows toward the tail — so the serpent
		// visibly coils as it travels.
		let prevX = x + nx * HEAD_LEAD_PX;
		let prevY = y + ny * 6;
		for (let i = 0; i < SEGMENTS; i++) {
			const lag = this.lag[i] ?? 20;
			// The wave: two wide, slow curves along the whole length, growing
			// toward the tail — the body sweeps, it does not wiggle.
			const wave = Math.sin(i * 0.4 + this.wavePhase) * (24 + i * 4);
			const p = this.chain[i];
			const segment = this.segments[i];
			if (!p || !segment) continue;
			p.x = prevX - nx * lag - ny * wave;
			p.y = prevY - ny * lag + nx * wave;
			segment.position.set(p.x, p.y);
			segment.rotation = Math.atan2(p.y - prevY, p.x - prevX);
			const t = (SEGMENTS - i) / SEGMENTS;
			// Dense and even: one continuous serpent — fully opaque scales
			// overlapping so no sky shows through, tapering clearly from the
			// thick chest behind the head to the thin tail.
			segment.alpha = 1;
			segment.scale.set(1.2 * (0.45 + 0.55 * t));
			prevX = p.x;
			prevY = p.y;
		}

		// The tail sparks: golden-red embers shedding off the last segment.
		this.sparkAccMs += dtMs;
		while (this.sparkAccMs >= SPARK_EVERY_MS) {
			this.sparkAccMs -= SPARK_EVERY_MS;
			const tail = this.chain[SEGMENTS - 1];
			if (!tail) break;
			this.particles.burst({
				texture: TEX.spark,
				count: 2,
				x: tail.x,
				y: tail.y,
				tint: Math.random() < 0.5 ? 0xffd166 : 0xff9a3d,
				speed: [40, 150],
				angle: [angle + 2.3, angle + 3.9],
				lifeMs: 300,
				scale: [1.6, 0],
				alpha: [0.9, 0],
			});
		}

		// The mane sparks: the head sheds bright embers as it moves — the
		// face of the dragon should look alive, not just lit.
		this.maneAccMs += dtMs;
		while (this.maneAccMs >= MANE_EVERY_MS) {
			this.maneAccMs -= MANE_EVERY_MS;
			this.particles.burst({
				texture: TEX.spark,
				count: 2,
				x: x + nx * (HEAD_LEAD_PX - 20),
				y: y + ny * 6 + (Math.random() * 2 - 1) * 8,
				tint: Math.random() < 0.6 ? 0xfff2b8 : 0xff7a4d,
				speed: [60, 180],
				angle: [angle + 2.1, angle + 3.9],
				lifeMs: 260,
				scale: [1.7, 0],
				alpha: [0.9, 0],
			});
		}

		// The energy motes: light streaming backward along the whole body, the
		// way Hanzo's dragon is a river of light rather than a few sparks.
		this.moteAccMs += dtMs;
		while (this.moteAccMs >= MOTE_EVERY_MS) {
			this.moteAccMs -= MOTE_EVERY_MS;
			// Two motes per beat, one near the head and one halfway down the
			// body, so the stream reads along the whole length.
			for (const i of [0, Math.floor(SEGMENTS / 2)]) {
				const p = this.chain[i];
				if (!p) continue;
				this.particles.burst({
					texture: TEX.shard,
					count: 2,
					x: p.x + (Math.random() * 14 - 7),
					y: p.y + (Math.random() * 14 - 7),
					tint: Math.random() < 0.6 ? 0xffe9a8 : 0xff9a3d,
					// Flowing *backward* along the line, against the travel.
					angle: [angle + Math.PI - 0.45, angle + Math.PI + 0.45],
					speed: [160, 340],
					lifeMs: 320,
					scale: [2, 0],
					alpha: [0.9, 0],
					rotation: angle,
				});
			}
		}

		this.particles.update(dtMs);
	}

	reset() {
		this.rider = null;
		this.alpha = 0;
		this.node.visible = false;
		this.frontNode.visible = false;
		this.particles.clear();
	}
}
