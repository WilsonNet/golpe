/**
 * The black hole, drawn. Presentation only — nothing here is ever read back by
 * the simulation, and everything runs on frame time rather than simulation
 * time, so no amount of it can desync a match.
 *
 * This is deliberately the most expensive effect in the game. The ultimate
 * costs a minute of charge and stops the entire room for a cutscene; if what
 * arrives afterwards is a tinted circle, the whole ability is a disappointment
 * that no amount of tuning fixes. So it is built in layers, and each one is
 * doing a specific job:
 *
 * - **A core that emits nothing.** Everything else in the game is additive
 *   light on a bright arena; the hole is the one thing that is a hole. It is
 *   drawn in normal blend mode over the top of its own glow so it actually
 *   subtracts.
 * - **Two counter-rotating accretion disks.** One ring spinning reads as a
 *   spinning ring. Two, at different rates and opposite directions, read as
 *   matter in orbit — this is the single cheapest trick here and it does more
 *   than the particles do.
 * - **A lensing ring** that breathes, so the horizon is never a static edge.
 * - **Infall streams** emitted from the whole outer reach and aimed at the
 *   centre, with a tangential kick so they spiral rather than fall straight.
 *   Straight-in particles read as a magnet; curved ones read as gravity.
 * - **Per-victim tearing**, emitted from each held fighter toward the centre,
 *   so the hole is visibly doing something *to* them rather than near them.
 *
 * The one thing this does not draw is the fringe: a fighter being tugged
 * outside the horizon should feel it in the controls, not be told about it, or
 * the counterplay stops being a discovery.
 */

import { Container, Sprite } from "pixi.js";
import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerPosition,
	SINGULARITY_DURATION_MS,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	type Singularity,
} from "../simulation/Physics";
import type { TeamId } from "../simulation/Teams";
import { TINT, teamTint } from "../teamPalette";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/** The ability's palette. Violet for the field, hot white for the disk. */
const COLOR = {
	horizon: 0x9a5cff,
	disk: 0xffb066,
	infall: 0xc79bff,
	tear: 0xff6bd6,
	flash: 0xffffff,
	grenade: 0xb98bff,
} as const;

/** How long the collapse takes to reach full size, in ms. */
const COLLAPSE_MS = 220;
/** How long the hole takes to wink out once its time is up. */
const EVAPORATE_MS = 260;

/** Disk rotation, radians/second. Two rates, opposite signs. */
const DISK_SPIN_INNER = 2.4;
const DISK_SPIN_OUTER = -1.35;

interface GrenadeTrail {
	sprite: Sprite;
	emitAccMs: number;
}

export class BlackHoleFx {
	private readonly particles: ParticleSystem;

	/** The whole hole, so its layers scale and fade together. */
	private readonly node = new Container();
	private readonly glow: Sprite;
	private readonly diskInner: Sprite;
	private readonly diskOuter: Sprite;
	private readonly core: Sprite;
	private readonly horizon: Sprite;

	/** Grenade sprites, keyed by id so one never becomes another. */
	private readonly grenades = new Map<number, GrenadeTrail>();

	private ageMs = 0;
	private infallAccMs = 0;
	private tearAccMs = 0;
	private open = false;

	/**
	 * The side that cast whatever is currently on screen.
	 *
	 * The hole takes a **light** team wash and no more. It is the one object in
	 * the arena that is defined by its own colours — a core that emits nothing
	 * against a disk that is far too bright — and painting it team-blue would turn
	 * an event into a decoration. What the tint has to answer is narrower: whose
	 * hole is this, i.e. am I the one who is safe standing in it.
	 */
	private casterTeam: TeamId | null = null;

	/** Pull one of the ability's own colours toward the caster's side. */
	private tint(base: number, strength: number = TINT.subtle): number {
		return teamTint(base, this.casterTeam, strength);
	}

	/**
	 * Two layers, on purpose.
	 *
	 * `body` is behind the fighters (`Stage.field`) and holds the hole itself —
	 * core, disks, glow, horizon. `debris` is in front of them (`Stage.effects`)
	 * and holds every particle and the grenade. Drawn in one layer above the
	 * actors, the core's 150px of pure black swallowed the fighters it was
	 * holding; below them, the same disc silhouettes them instead, and matter
	 * streaming past in front is what gives a flat scene depth.
	 */
	constructor(
		private readonly body: Container,
		private readonly debris: Container,
		private readonly stage: Stage,
	) {
		this.particles = new ParticleSystem(debris);

		const mk = (texture: string, additive: boolean) => {
			const s = new Sprite(tex(texture));
			s.anchor.set(0.5);
			if (additive) s.blendMode = "add";
			this.node.addChild(s);
			return s;
		};

		// Order is the effect. Glow first so it is behind everything, then the
		// disks, then the *normal-blended* core on top of them — that is what makes
		// the middle read as absence rather than as a dark tint over light. The lens
		// ring goes last, because the horizon is the one edge that must never be
		// covered.
		this.glow = mk(TEX.halo, true);
		this.diskOuter = mk(TEX.accretion, true);
		this.diskInner = mk(TEX.accretion, true);
		this.core = mk(TEX.singularity, false);
		this.horizon = mk(TEX.horizon, true);

		this.node.visible = false;
		this.body.addChild(this.node);
	}

	/**
	 * The grenade left the caster's hand.
	 *
	 * Not strictly needed — `syncGrenades` would create the sprite on the next
	 * frame anyway — but the launch puff is what makes the throw feel thrown
	 * rather than teleported, and it is the first thing that happens after the
	 * cutscene lifts.
	 */
	launch(x: number, y: number, team: TeamId | null = null) {
		this.casterTeam = team;
		this.particles.burst({
			texture: TEX.spark,
			count: 12,
			x,
			y,
			tint: this.tint(COLOR.grenade),
			speed: [40, 200],
			lifeMs: 320,
			scale: [1, 0],
			alpha: [0.8, 0],
		});
	}

	/**
	 * Draw the grenades that are in flight.
	 *
	 * Keyed by id, exactly like the bullet sprites and for exactly the same
	 * reason: indexing by array position means a sprite jumps to a different
	 * projectile the moment the server splices a dead one out.
	 */
	syncGrenades(
		live: readonly {
			id: number;
			x: number;
			y: number;
			ownerTeam?: TeamId | null;
		}[],
		dtMs: number,
	) {
		const seen = new Set<number>();
		for (const g of live) {
			// The grenade in flight is what tells the room whose hole is about to
			// open, and it is in the air for the whole second anybody has to react.
			this.casterTeam = g.ownerTeam ?? null;
			seen.add(g.id);
			let trail = this.grenades.get(g.id);
			if (!trail) {
				const sprite = new Sprite(tex(TEX.grenade));
				sprite.anchor.set(0.5);
				// In front of the fighters: a grenade arcing behind somebody is a
				// grenade nobody dodges.
				this.debris.addChild(sprite);
				trail = { sprite, emitAccMs: 0 };
				this.grenades.set(g.id, trail);
			}
			trail.sprite.position.set(g.x, g.y);
			// A slow tumble. A grenade that held one orientation through a whole arc
			// reads as a decal sliding across the screen.
			trail.sprite.rotation += (dtMs / 1000) * 4;
			trail.sprite.tint = this.tint(0xffffff, TINT.medium);

			trail.emitAccMs += dtMs;
			if (trail.emitAccMs >= 26) {
				trail.emitAccMs = 0;
				this.particles.burst({
					texture: TEX.spark,
					count: 2,
					x: g.x,
					y: g.y,
					tint: this.tint(COLOR.grenade),
					speed: [10, 55],
					lifeMs: 420,
					scale: [0.9, 0],
					alpha: [0.7, 0],
					// A trail that hangs and sinks, so the arc it flew is legible after
					// the grenade has moved on. That readable arc is the whole tell an
					// opponent gets to dodge on.
					gravity: 130,
				});
			}
		}

		for (const [id, trail] of this.grenades) {
			if (seen.has(id)) continue;
			trail.sprite.destroy();
			this.grenades.delete(id);
		}
	}

	/**
	 * The grenade collapsed. One-shot, on the frame the hole first appears.
	 *
	 * Everything loud lives here rather than in the steady state: a shockwave, a
	 * white flash, debris thrown *outward* (matter does get flung before it is
	 * caught) and the heaviest screen shake in the game — heavier than a Massive
	 * Strike, because an ultimate that shook the screen less than a sword hit
	 * would be an ultimate nobody respects.
	 */
	detonate(x: number, y: number, team: TeamId | null = null) {
		this.casterTeam = team;
		this.particles.burst({
			texture: TEX.shard,
			count: 34,
			x,
			y,
			tint: this.tint(COLOR.disk),
			speed: [220, 720],
			lifeMs: 620,
			scale: [1.3, 0],
			spin: true,
		});
		this.particles.burst({
			texture: TEX.spark,
			count: 46,
			x,
			y,
			tint: this.tint(COLOR.horizon),
			speed: [140, 620],
			lifeMs: 520,
			scale: [1.5, 0],
		});
		this.particles.burst({
			texture: TEX.spark,
			count: 18,
			x,
			y,
			tint: COLOR.flash,
			speed: [30, 140],
			lifeMs: 260,
			scale: [2.4, 0],
		});
		this.stage.startShake(420, 14);
	}

	/**
	 * Advance the open hole, or fade it out. Frame time, never simulation time.
	 *
	 * `field` is the same object the simulation is being handed, so what is drawn
	 * is where fighters are actually being pulled — a renderer with its own idea
	 * of the radius would draw a hole that grabs people outside it, which is the
	 * single most confusing thing a field ability can do.
	 *
	 * `victims` is every fighter currently *held*, for the tearing streams. The
	 * caller decides who those are, because the friendly-fire rule lives in the
	 * simulation and this class must not re-implement it.
	 */
	update(
		field: Singularity | null,
		victims: readonly PlayerPosition[],
		dtMs: number,
	) {
		this.particles.update(dtMs);

		if (field) {
			if (!this.open) {
				this.open = true;
				this.ageMs = 0;
				this.infallAccMs = 0;
				this.tearAccMs = 0;
			}
			this.ageMs += dtMs;
			this.drawField(field, victims, dtMs);
			return;
		}

		if (!this.open) return;
		// Closing. The hole is gone from the simulation the instant its timer
		// expires — fighters are free on that tick — so this is purely the sprite
		// catching up, and it must not be long enough to suggest otherwise.
		this.ageMs += dtMs;
		const t = Math.min(
			1,
			(this.ageMs - SINGULARITY_DURATION_MS) / EVAPORATE_MS,
		);
		if (t >= 1) {
			this.open = false;
			this.node.visible = false;
			return;
		}
		this.node.alpha = 1 - t;
		this.node.scale.set(1 - 0.85 * t);
		this.spinDisks(dtMs);
	}

	private drawField(
		field: Singularity,
		victims: readonly PlayerPosition[],
		dtMs: number,
	) {
		this.node.visible = true;
		this.node.position.set(field.x, field.y);
		this.node.alpha = 1;

		// The collapse: overshoot past full size and settle back. A hole that grew
		// monotonically to its radius read as inflating; the overshoot reads as
		// something snapping shut.
		const t = Math.min(1, this.ageMs / COLLAPSE_MS);
		const eased = 1 - (1 - t) ** 3;
		const overshoot = t < 1 ? 1 + 0.35 * Math.sin(t * Math.PI) : 1;
		const scale = eased * overshoot;
		this.node.scale.set(scale);

		// **Every layer is sized off the simulation's own radius**, so what is drawn
		// is what grabs you. The textures are 128 and 176 wide respectively.
		//
		// The core is deliberately well inside the horizon: a hole is a point, and
		// filling the whole capture radius with black hid the fighters it was
		// holding and the platforms behind them. The *edge* is the horizon ring.
		this.core.scale.set((SINGULARITY_RADIUS * 0.46) / 64);
		this.glow.scale.set((SINGULARITY_REACH * 0.85) / 64);
		this.glow.alpha = 0.16;
		this.casterTeam = field.ownerTeam ?? null;
		this.glow.tint = this.tint(COLOR.horizon);

		this.diskInner.scale.set((SINGULARITY_RADIUS * 0.86) / 88);
		this.diskOuter.scale.set((SINGULARITY_RADIUS * 1.18) / 88);
		this.diskInner.tint = this.tint(COLOR.disk);
		this.diskOuter.tint = this.tint(COLOR.horizon);
		this.diskInner.alpha = 1;
		this.diskOuter.alpha = 0.65;
		this.spinDisks(dtMs);

		// The event horizon, drawn at *exactly* `SINGULARITY_RADIUS`: this is the
		// line between "you are cargo" and "you can still fight", and it is the one
		// part of the effect a player has to be able to read at a glance. It
		// breathes slightly, which is the only slow rhythm on the hole and what
		// keeps two seconds of it from reading as a looping GIF.
		const pulse = 1 + 0.035 * Math.sin(this.ageMs / 150);
		this.horizon.scale.set((SINGULARITY_RADIUS / 60) * pulse);
		this.horizon.alpha = 0.78 + 0.16 * Math.sin(this.ageMs / 150 + 1);
		// The event horizon is the one line a player has to read exactly — inside it
		// you are cargo — so it takes the lightest wash of all and keeps its violet.
		this.horizon.tint = this.tint(COLOR.horizon);

		this.emitInfall(field, dtMs);
		this.emitTearing(field, victims, dtMs);
	}

	private spinDisks(dtMs: number) {
		const dt = dtMs / 1000;
		this.diskInner.rotation += DISK_SPIN_INNER * dt;
		this.diskOuter.rotation += DISK_SPIN_OUTER * dt;
	}

	/**
	 * Matter falling in, emitted from the whole outer reach.
	 *
	 * Each mote is launched *tangentially* — perpendicular to the line to the
	 * centre — and given a life just long enough to cross the gap. The particle
	 * system has no attractor, so the spiral is faked by the launch angle alone:
	 * a mote thrown sideways at the right speed traces an arc that reads exactly
	 * like an orbit decaying, and it costs one `atan2`.
	 */
	private emitInfall(field: Singularity, dtMs: number) {
		this.infallAccMs += dtMs;
		if (this.infallAccMs < 22) return;
		this.infallAccMs = 0;

		for (let i = 0; i < 3; i++) {
			const a = Math.random() * Math.PI * 2;
			const r =
				SINGULARITY_RADIUS +
				Math.random() * (SINGULARITY_REACH - SINGULARITY_RADIUS);
			const x = field.x + Math.cos(a) * r;
			const y = field.y + Math.sin(a) * r;
			// Inward, plus a tangential lead. The sign is fixed so every mote orbits
			// the same way the disks spin — mixed directions read as noise.
			const inward = Math.atan2(field.y - y, field.x - x);
			const lead = inward + 0.95;
			this.particles.burst({
				texture: TEX.spark,
				count: 1,
				x,
				y,
				tint: this.tint(COLOR.infall),
				angle: [lead - 0.12, lead + 0.12],
				speed: [r * 1.9, r * 2.5],
				lifeMs: 420,
				scale: [0.85, 0],
				alpha: [0.85, 0],
			});
		}
	}

	/** Matter torn off the fighters the hole is actually holding. */
	private emitTearing(
		field: Singularity,
		victims: readonly PlayerPosition[],
		dtMs: number,
	) {
		if (victims.length === 0) return;
		this.tearAccMs += dtMs;
		if (this.tearAccMs < 45) return;
		this.tearAccMs = 0;

		for (const v of victims) {
			const cx = v.x + PLAYER_WIDTH / 2;
			const cy = v.y + PLAYER_HEIGHT / 2;
			const inward = Math.atan2(field.y - cy, field.x - cx);
			this.particles.burst({
				texture: TEX.shard,
				count: 3,
				x: cx,
				y: cy,
				tint: this.tint(COLOR.tear, TINT.medium),
				// A narrow cone straight at the centre: this one is *not* an orbit. It
				// is the fighter coming apart, and it should read as a direct line
				// between them and the thing doing it.
				angle: [inward - 0.25, inward + 0.25],
				speed: [180, 340],
				lifeMs: 300,
				scale: [1.1, 0],
				alpha: [0.9, 0],
			});
		}
	}

	reset() {
		this.open = false;
		this.node.visible = false;
		this.node.alpha = 1;
		this.node.scale.set(1);
		this.particles.clear();
		for (const trail of this.grenades.values()) trail.sprite.destroy();
		this.grenades.clear();
	}

	destroy() {
		this.reset();
		this.node.destroy({ children: true });
	}
}
