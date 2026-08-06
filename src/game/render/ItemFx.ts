/**
 * The items, drawn: Lia's HE grenades in flight and their blasts, and Anands'
 * floor traps.
 *
 * Presentation only, like everything in `render/` — nothing here is ever read
 * back by the simulation, and everything runs on frame time, so no amount of it
 * can desync a match.
 *
 * The HE grenade is a server-owned projectile (like a bullet), so the client
 * **anchors it once on first sight and runs the shared `tickHeGrenade` off the
 * local clock** — the same dead-reckon the bullets use, with the grenade's own
 * bounces — so a throw does not stutter at snapshot cadence and it bounces in
 * exactly the places the server's does.
 *
 * A trap is world state (like the singularity): a stationary landmine the whole
 * room can see, since the *being able to see it* is the whole of the
 * counterplay. It is single-use — the server removes it the tick it springs,
 * and the burst that accompanies the caption is the trap going off.
 */

import { type Container, Graphics, Sprite } from "pixi.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH, type World } from "../simulation/Arena";
import {
	HE_GRENADE_FUSE_MS,
	type HeGrenadeState,
	tickHeGrenade,
} from "../simulation/Items";
import { sameTeam, type TeamId } from "../simulation/Teams";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/** The HE blast's palette. Hot white flash, orange shards, an olive body. */
const COLOR = {
	body: 0x7d8a4f,
	flash: 0xffffff,
	shard: 0xff9a4d,
	ring: 0xffe0b3,
	/** The trap's burst: its own teal, so a spring reads as *that* trap going. */
	trap: 0x7ff0f4,
} as const;

/** A grenade the client is running off its own clock, bounced like the server's. */
interface HeFlight {
	state: HeGrenadeState;
	/** Local render clock at the last step, ms. */
	lastMs: number;
	sprite: Sprite;
}

/** One expanding blast ring. */
interface BlastRing {
	ring: Graphics;
	radius: number;
	lifeMs: number;
	t: number;
}

/** The bit of a grenade the renderer needs: a position and a heading. */
interface HeGrenadeView {
	id: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export class ItemFx {
	private readonly particles: ParticleSystem;
	private readonly heGrenades = new Map<number, HeFlight>();
	private readonly trapSprites = new Map<number, Sprite>();
	private readonly rings: BlastRing[] = [];

	constructor(
		/** Traps sit on the floor, under the fighters — see `Stage.field`. */
		private readonly fieldLayer: Container,
		private readonly effectsLayer: Container,
		private readonly world: World,
		private readonly stage: Stage,
	) {
		this.particles = new ParticleSystem(effectsLayer);
	}

	/**
	 * Draw the HE grenades in flight.
	 *
	 * Keyed by id, exactly like the bullet sprites and for exactly the same
	 * reason: indexing by array position makes a sprite jump to a different
	 * grenade the moment the server splices a spent one out.
	 */
	syncHeGrenades(live: readonly HeGrenadeView[], nowMs: number) {
		const seen = new Set<number>();
		for (const g of live) {
			seen.add(g.id);
			let flight = this.heGrenades.get(g.id);
			if (!flight) {
				const sprite = new Sprite(tex(TEX.heGrenade));
				sprite.anchor.set(0.5);
				this.effectsLayer.addChild(sprite);
				flight = {
					state: {
						id: g.id,
						ownerId: "",
						ownerTeam: null,
						x: g.x,
						y: g.y,
						vx: g.vx,
						vy: g.vy,
						fuseMs: HE_GRENADE_FUSE_MS,
					},
					lastMs: nowMs,
					sprite,
				};
				this.heGrenades.set(g.id, flight);
				// A puff at the hand, so the throw reads as thrown rather than as a
				// grenade that teleported into the air.
				this.particles.burst({
					texture: TEX.spark,
					count: 8,
					x: g.x,
					y: g.y,
					tint: COLOR.body,
					speed: [20, 120],
					lifeMs: 260,
					scale: [1, 0],
					alpha: [0.7, 0],
				});
			}
			// Advance the local sim by the frame's own time, through the same
			// deterministic `tickHeGrenade` the server runs. The anchor is the
			// snapshot's position, so the visual is the server's path delayed by
			// the snapshot's age — which is exactly what dead-reckoning should
			// show — and it bounces in the same places.
			const dtSec = Math.max(0, nowMs - flight.lastMs) / 1000;
			flight.lastMs = nowMs;
			if (dtSec > 0) tickHeGrenade(flight.state, dtSec, this.world);
			flight.sprite.position.set(flight.state.x, flight.state.y);
			// A slow tumble, so the throw reads as a physical object.
			flight.sprite.rotation += dtSec * 4;
		}

		for (const [id, flight] of this.heGrenades) {
			if (seen.has(id)) continue;
			flight.sprite.destroy();
			this.heGrenades.delete(id);
		}
	}

	/**
	 * Draw the traps. Static world objects: created and destroyed with the list.
	 *
	 * `myId`/`myTeam` decide *friendliness*: your own traps and every teammate's
	 * are faded out, because a trap you never need to worry about should not be
	 * doing the worrying for you. An enemy's trap is full-strength — and gone,
	 * not spent, the moment it springs.
	 */
	syncTraps(
		live: readonly {
			id: number;
			x: number;
			y: number;
			ownerId: string;
			ownerTeam: TeamId | null;
		}[],
		myId: string,
		myTeam: TeamId | null,
	) {
		const seen = new Set<number>();
		for (const trap of live) {
			seen.add(trap.id);
			let sprite = this.trapSprites.get(trap.id);
			if (!sprite) {
				sprite = new Sprite(tex(TEX.trap));
				// Bottom-anchored: the mine's flat base sits on the floor the trap
				// was placed on, which is where the trigger test is.
				sprite.anchor.set(0.5, 1);
				this.fieldLayer.addChild(sprite);
				this.trapSprites.set(trap.id, sprite);
			}
			sprite.position.set(trap.x, trap.y);
			const friendly =
				trap.ownerId === myId || sameTeam(trap.ownerTeam, myTeam);
			sprite.tint = 0xffffff;
			// Friendly traps fade to a hint — your own and your team's are a
			// "noted, no danger" rather than a live hazard. Enemy traps are
			// full-strength; a sprung trap no longer exists to be drawn.
			sprite.alpha = friendly ? 0.45 : 1;
		}
		for (const [id, sprite] of this.trapSprites) {
			if (seen.has(id)) continue;
			sprite.destroy();
			this.trapSprites.delete(id);
		}
	}

	/**
	 * A trap just sprang. One-shot, from the server's trapped event — the burst
	 * *is* the trap going off, at the victim's feet.
	 */
	trapBurst(x: number, y: number) {
		const atX = x + PLAYER_WIDTH / 2;
		const atY = y + PLAYER_HEIGHT;
		this.particles.burst({
			texture: TEX.shard,
			count: 14,
			x: atX,
			y: atY,
			tint: COLOR.trap,
			speed: [30, 220],
			lifeMs: 340,
			scale: [1, 0],
			alpha: [0.9, 0],
			gravity: 320,
		});
		this.particles.burst({
			texture: TEX.halo,
			count: 1,
			x: atX,
			y: atY,
			tint: 0xd9fff4,
			speed: [0, 8],
			lifeMs: 140,
			scale: [0.7, 1.5],
			alpha: [0.8, 0],
		});
	}

	/** An HE grenade went off. One-shot, from the server's explosion event. */
	explode(x: number, y: number, radius: number) {
		this.particles.burst({
			texture: TEX.shard,
			count: 26,
			x,
			y,
			tint: COLOR.shard,
			speed: [50, 340],
			lifeMs: 420,
			scale: [1.2, 0],
			alpha: [0.9, 0],
			gravity: 420,
		});
		this.particles.burst({
			texture: TEX.halo,
			count: 2,
			x,
			y,
			tint: COLOR.flash,
			speed: [0, 10],
			lifeMs: 150,
			scale: [1.2, 2.4],
			alpha: [0.9, 0],
		});
		const ring = new Graphics();
		ring.circle(0, 0, 1).stroke({ width: 3, color: COLOR.ring, alpha: 0.9 });
		ring.position.set(x, y);
		this.effectsLayer.addChild(ring);
		this.rings.push({ ring, radius, lifeMs: 260, t: 0 });
		// The shake is the "that was an explosion" beat, midway between a sword
		// impact and the ultimate — an item should be felt, never as much as a
		// black hole.
		this.stage.startShake(280, 8);
	}

	update(dtMs: number) {
		for (let i = this.rings.length - 1; i >= 0; i--) {
			const r = this.rings[i];
			if (!r) continue;
			r.t += dtMs;
			const p = Math.min(1, r.t / r.lifeMs);
			r.ring.scale.set(1 + p * (r.radius - 1));
			r.ring.alpha = 1 - p;
			if (p >= 1) {
				r.ring.destroy();
				this.rings.splice(i, 1);
			}
		}
		this.particles.update(dtMs);
	}

	reset() {
		for (const flight of this.heGrenades.values()) flight.sprite.destroy();
		this.heGrenades.clear();
		for (const sprite of this.trapSprites.values()) sprite.destroy();
		this.trapSprites.clear();
		for (const r of this.rings) r.ring.destroy();
		this.rings.length = 0;
		this.particles.clear();
	}

	destroy() {
		this.reset();
	}
}
