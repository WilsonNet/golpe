/**
 * The Death Blossom, drawn: the storm around the caster.
 *
 * Presentation only, like everything in `render/` — nothing here is ever read
 * back by the simulation, and everything runs on wall-clock frame time, so no
 * amount of it can desync a match. This is the heaviest particle budget in the
 * game on purpose: the ultimate is the one moment the room is allowed to be
 * loud.
 *
 * Driven the way the singularity is: a full-state field from the snapshot
 * (the *area* — the caster's own spin travels in their `PlayerPosition`) plus
 * one edge-detected one-shot when the storm opens. The ring flashes in time
 * with the server's damage intervals (`BLOSSOM_TICK_MS`) because that is the
 * moment the storm *fires*, and the whole effect rotates at the same speed the
 * caster's sprite spins at, so the muzzle flashes stay on the body.
 */

import { type Container, Graphics } from "pixi.js";
import type { TeamId } from "../simulation/Teams";
import {
	BLOSSOM_RADIUS_PX,
	BLOSSOM_SPIN_RAD_PER_MS,
	type Blossom,
} from "../simulation/Ultimate";
import { teamTint } from "../teamPalette";
import { TEX } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/** The storm's palette: death's own register, red and black. */
const COLOR = {
	streak: 0xffd27a,
	flash: 0xfff3d6,
	spark: 0xff7a3d,
	ember: 0xe8462a,
	smoke: 0x3a2630,
	ring: 0xff4d4d,
} as const;

/** A short arc of the storm's edge ring, for the flash per damage tick. */
const RING_FLASH_MS = 180;
/** The ring's slow pulse, over and above the per-tick flashes. */
const RING_PULSE_MS = 600;
/** How long the storm's smoke lingers after the field itself closes. */
const AFTERGLOW_MS = 700;
/** Emit a fan of streaks this often while the storm is live. */
const STREAK_INTERVAL_MS = 46;
/** Emit a drift of smoke this often. */
const SMOKE_INTERVAL_MS = 60;

export class BlossomFx {
	private readonly particles: ParticleSystem;
	/** The caster's side, latched when the storm opens — for the tint. */
	private casterTeam: TeamId | null = null;
	/** The spin's angle, advanced at the caster's own spin speed. */
	private spinAngle = 0;
	/** ms since the last streak fan. */
	private streakAccMs = 0;
	/** ms since the last smoke wisp. */
	private smokeAccMs = 0;
	/** The ring's slow pulse clock. */
	private pulseAccMs = 0;
	/** ms until the ring flashes (the damage ticks). */
	private flashAccMs = 0;
	/** ms since the storm closed, for the afterglow. */
	private afterglowMs = AFTERGLOW_MS + 1;
	/** The edge ring, redrawn each frame — a pulsing circle at the radius. */
	private readonly ring: Graphics;
	/** A faint disc inside the ring, so the storm's *area* reads at a glance. */
	private readonly area: Graphics;

	constructor(
		/** The ring and the area sit behind the fighters, like the hole's core. */
		private readonly fieldLayer: Container,
		effectsLayer: Container,
		private readonly stage: Stage,
	) {
		this.particles = new ParticleSystem(effectsLayer);
		this.area = new Graphics();
		this.ring = new Graphics();
		this.fieldLayer.addChild(this.area, this.ring);
	}

	/**
	 * The storm just opened — the one-shot from the snapshot's edge detection.
	 * The cast's loudest beat: a red shockwave, a heavy shake, and a burst of
	 * the storm's own palette, so the room knows what the freeze was for.
	 */
	open(x: number, y: number, team: TeamId | null) {
		this.casterTeam = team;
		this.afterglowMs = AFTERGLOW_MS + 1;
		this.streakAccMs = 0;
		this.smokeAccMs = 0;
		this.flashAccMs = 0;

		this.particles.burst({
			texture: TEX.ring,
			count: 1,
			x,
			y,
			tint: this.tint(COLOR.ring),
			speed: [0, 10],
			lifeMs: 420,
			scale: [0.25, 1],
			alpha: [0.9, 0],
		});
		this.particles.burst({
			texture: TEX.spark,
			count: 26,
			x,
			y,
			tint: this.tint(COLOR.spark),
			speed: [60, 420],
			lifeMs: 500,
			scale: [1.4, 0],
			alpha: [1, 0],
			gravity: 260,
		});
		this.particles.burst({
			texture: TEX.smoke,
			count: 8,
			x,
			y,
			tint: this.tint(COLOR.smoke),
			speed: [10, 80],
			lifeMs: 1200,
			scale: [0.6, 2.2],
			alpha: [0.5, 0],
		});
		this.stage.startShake(520, 16);
	}

	/** One frame of the storm, or of its afterglow. */
	update(field: Blossom | null, dtMs: number) {
		const live = field !== null && this.afterglowMs <= AFTERGLOW_MS;

		if (field) {
			this.casterTeam = field.ownerTeam;
			this.afterglowMs = 0;
			this.spinAngle += dtMs * BLOSSOM_SPIN_RAD_PER_MS;
			this.pulseAccMs += dtMs;
			this.flashAccMs += dtMs;

			this.drawField(field);
			this.emitStreaks(field, dtMs);
			this.emitSmoke(field, dtMs);
		} else {
			this.afterglowMs += dtMs;
			this.ring.clear();
			this.area.clear();
		}

		if (!live && this.afterglowMs > AFTERGLOW_MS) {
			this.particles.clear();
			return;
		}
		this.particles.update(dtMs);
	}

	/** The ring and the area: the storm's *shape* on the floor of the arena. */
	private drawField(field: Blossom) {
		// The per-tick flash: the ring snaps bright on the same cadence the
		// server deals damage, so the moment the storm fires is visible.
		const tickFlash =
			this.flashAccMs < RING_FLASH_MS
				? (1 - this.flashAccMs / RING_FLASH_MS) * 0.8
				: 0;
		const pulse =
			0.5 + 0.5 * Math.sin((this.pulseAccMs / RING_PULSE_MS) * Math.PI * 2);

		this.area
			.clear()
			.circle(0, 0, BLOSSOM_RADIUS_PX)
			.fill({ color: this.tint(COLOR.ring), alpha: 0.05 + pulse * 0.04 });
		this.area.position.set(field.x, field.y);

		this.ring
			.clear()
			.circle(0, 0, BLOSSOM_RADIUS_PX)
			.stroke({
				width: 3,
				color: this.tint(COLOR.ring),
				alpha: 0.45 + pulse * 0.3 + tickFlash,
			});
		this.ring.position.set(field.x, field.y);
	}

	/**
	 * The storm's fire: a rotating fan of streaks from the centre to the ring,
	 * muzzle flashes where the shotguns point, sparks off the ring and shell
	 * casings arcing away. The fan turns at the caster's own spin speed, so the
	 * gunfire reads as coming out of the fighter rather than off the floor.
	 */
	private emitStreaks(field: Blossom, dtMs: number) {
		this.streakAccMs += dtMs;
		while (this.streakAccMs >= STREAK_INTERVAL_MS) {
			this.streakAccMs -= STREAK_INTERVAL_MS;

			// One fan per beat: streaks fanning ±0.4 rad around the current
			// spin angle, the way twin shotguns spray in a blur.
			const base = this.spinAngle;
			for (let i = -2; i <= 2; i++) {
				const a = base + i * 0.2;
				const dx = Math.cos(a);
				const dy = Math.sin(a);
				this.particles.burst({
					texture: TEX.shard,
					count: 1,
					x: field.x + dx * 24,
					y: field.y + dy * 24,
					tint: this.tint(COLOR.streak),
					speed: [520, 760],
					lifeMs: 160,
					scale: [1, 0.3],
					alpha: [0.95, 0],
					angle: [a, a],
					rotation: a,
					blend: false,
				});
			}

			// The muzzle flashes, at the spin's edge — the fire leaves the
			// fighter and the streak follows.
			for (const off of [0, Math.PI]) {
				const a = base + off;
				this.particles.burst({
					texture: TEX.spark,
					count: 3,
					x: field.x + Math.cos(a) * 30,
					y: field.y + Math.sin(a) * 30,
					tint: this.tint(COLOR.flash),
					speed: [30, 140],
					lifeMs: 90,
					scale: [1.6, 0.2],
					alpha: [1, 0],
					angle: [a - 0.5, a + 0.5],
					blend: false,
				});
			}

			// The casings: brass chips thrown off tangentially, arcing down.
			this.particles.burst({
				texture: TEX.shard,
				count: 3,
				x: field.x + Math.cos(base) * 34,
				y: field.y + Math.sin(base) * 34,
				tint: 0xd9b86a,
				speed: [140, 260],
				lifeMs: 700,
				scale: [0.7, 0.3],
				alpha: [1, 0],
				angle: [base + Math.PI / 2 - 0.6, base + Math.PI / 2 + 0.6],
				gravity: 900,
				spin: true,
				blend: false,
			});
		}

		// Sparks off the ring's edge: the storm gnawing at its own boundary.
		this.particles.burst({
			texture: TEX.spark,
			count: 1,
			x: field.x + Math.cos(this.spinAngle * 2.3) * BLOSSOM_RADIUS_PX,
			y: field.y + Math.sin(this.spinAngle * 2.3) * BLOSSOM_RADIUS_PX,
			tint: this.tint(COLOR.ember),
			speed: [20, 120],
			lifeMs: 420,
			scale: [1.2, 0],
			alpha: [0.8, 0],
			gravity: 300,
		});
	}

	/** The storm's own smoke: dark red wisps drifting up out of the ring. */
	private emitSmoke(field: Blossom, dtMs: number) {
		this.smokeAccMs += dtMs;
		while (this.smokeAccMs >= SMOKE_INTERVAL_MS) {
			this.smokeAccMs -= SMOKE_INTERVAL_MS;
			this.particles.burst({
				texture: TEX.smoke,
				count: 1,
				x: field.x + (Math.random() - 0.5) * BLOSSOM_RADIUS_PX,
				y: field.y + 10 + (Math.random() - 0.5) * 60,
				tint: this.tint(COLOR.smoke),
				speed: [6, 24],
				lifeMs: 900,
				scale: [0.5, 1.4],
				alpha: [0.4, 0],
			});
		}
	}

	/** The caster's side, blended toward their colour like everything else. */
	private tint(base: number): number {
		return teamTint(base, this.casterTeam, 0.34);
	}

	reset() {
		this.particles.clear();
		this.ring.clear();
		this.area.clear();
		this.afterglowMs = AFTERGLOW_MS + 1;
		this.casterTeam = null;
	}

	destroy() {
		this.particles.clear();
		this.ring.destroy();
		this.area.destroy();
	}
}
