/**
 * Everything you see when swords meet. Presentation only — nothing here is ever
 * read back by the simulation.
 *
 * That separation is not stylistic. The obvious way to sell a heavy hit is
 * hitstop, freezing the game for a few frames on impact; it is unavailable here,
 * because pausing the simulation on one machine and not the other desyncs the
 * match. So impact is faked entirely in the renderer: shake, a scale punch, and
 * a lot of particles. See specs/melee.md.
 *
 * All artwork is generated at runtime as obvious placeholder geometry — flat
 * white shapes, tinted per effect — so it can be swapped for real sprites
 * without touching any of the timing or triggering logic below.
 */

import type Phaser from "phaser";
import { MOVES, type MeleeMove, type MeleeOutcome } from "../simulation/Melee";
import {
	MASSIVE_CHARGE_MS,
	PARRY_WINDOW_MS,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerPosition,
	meleePhase,
} from "../simulation/Physics";

const TEX_SPARK = "fx_spark";
const TEX_SHARD = "fx_shard";
const TEX_RING = "fx_ring";
const TEX_ARC = "fx_arc";
const TEX_BLADE = "fx_blade";
const TEX_GUARD = "fx_guard";

/** Palette. One colour per readable game state, so a glance tells you what happened. */
const COLOR = {
	slash: 0xffffff,
	uppercut: 0x8ff0ff,
	massive: 0xffb238,
	charge: 0xffd166,
	block: 0x62d0ff,
	parry: 0xffe066,
	backstab: 0xc471ff,
	stun: 0xffe066,
} as const;

function ensureTexture(
	scene: Phaser.Scene,
	key: string,
	w: number,
	h: number,
	draw: (g: Phaser.GameObjects.Graphics) => void,
) {
	if (scene.textures.exists(key)) return;
	const g = scene.add.graphics();
	draw(g);
	g.generateTexture(key, w, h);
	g.destroy();
}

/**
 * Placeholder art, drawn in code.
 *
 * Deliberately crude: flat white primitives that read clearly at speed and are
 * unmistakably temporary. Everything is white so a single tint per effect
 * controls its colour.
 */
export function createFxTextures(scene: Phaser.Scene) {
	ensureTexture(scene, TEX_SPARK, 8, 8, (g) => {
		g.fillStyle(0xffffff, 1);
		g.beginPath();
		g.moveTo(4, 0);
		g.lineTo(8, 4);
		g.lineTo(4, 8);
		g.lineTo(0, 4);
		g.closePath();
		g.fillPath();
	});

	ensureTexture(scene, TEX_SHARD, 16, 4, (g) => {
		g.fillStyle(0xffffff, 1);
		g.fillRect(0, 0, 16, 4);
	});

	ensureTexture(scene, TEX_RING, 96, 96, (g) => {
		g.lineStyle(5, 0xffffff, 1);
		g.strokeCircle(48, 48, 44);
	});

	// A crescent: the swing trail. Drawn facing +x so it can simply be rotated.
	ensureTexture(scene, TEX_ARC, 96, 96, (g) => {
		g.fillStyle(0xffffff, 1);
		g.beginPath();
		g.arc(48, 48, 46, -1.0, 1.0, false);
		g.arc(48, 48, 24, 1.0, -1.0, true);
		g.closePath();
		g.fillPath();
	});

	// Placeholder sword: blade, guard, grip. To be replaced by real art.
	ensureTexture(scene, TEX_BLADE, 44, 10, (g) => {
		g.fillStyle(0xdfe7f5, 1);
		g.fillRect(12, 3, 32, 4);
		g.fillStyle(0x8a94a6, 1);
		g.fillRect(8, 0, 3, 10);
		g.fillRect(0, 3, 8, 4);
	});

	// The guard arc shown while blocking.
	ensureTexture(scene, TEX_GUARD, 32, 64, (g) => {
		g.lineStyle(5, 0xffffff, 1);
		g.beginPath();
		g.arc(4, 32, 26, -1.1, 1.1, false);
		g.strokePath();
	});
}

/** Per-fighter persistent sprites, created on first sight. */
interface FighterFx {
	arc: Phaser.GameObjects.Sprite;
	blade: Phaser.GameObjects.Sprite;
	guard: Phaser.GameObjects.Sprite;
	/** Accumulator so ambient emitters puff at a fixed rate, not per frame. */
	emitAccMs: number;
	/** Sprite the fighter is drawn with, for the impact scale punch. */
	body?: Phaser.GameObjects.Sprite;
	punch: number;
}

export interface ImpactEvent {
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
}

export class MeleeFx {
	private readonly fighters = new Map<string, FighterFx>();
	private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
	private readonly shards: Phaser.GameObjects.Particles.ParticleEmitter;
	private readonly motes: Phaser.GameObjects.Particles.ParticleEmitter;

	constructor(private readonly scene: Phaser.Scene) {
		createFxTextures(scene);

		// Three shared emitters in explode mode, rather than one per effect: the
		// per-burst settings are pushed in at explode time, which keeps the number
		// of live emitters constant no matter how frantic the fight gets.
		this.sparks = scene.add.particles(0, 0, TEX_SPARK, {
			lifespan: 340,
			speed: { min: 90, max: 320 },
			scale: { start: 1.1, end: 0 },
			alpha: { start: 1, end: 0 },
			gravityY: 420,
			blendMode: "ADD",
			emitting: false,
		});

		this.shards = scene.add.particles(0, 0, TEX_SHARD, {
			lifespan: 480,
			speed: { min: 140, max: 420 },
			scale: { start: 1, end: 0.2 },
			alpha: { start: 1, end: 0 },
			rotate: { min: 0, max: 360 },
			gravityY: 600,
			blendMode: "ADD",
			emitting: false,
		});

		// Ambient: charge motes and stun sparks. Slow, floaty, no gravity.
		this.motes = scene.add.particles(0, 0, TEX_SPARK, {
			lifespan: 420,
			speed: { min: 10, max: 50 },
			scale: { start: 0.7, end: 0 },
			alpha: { start: 0.9, end: 0 },
			blendMode: "ADD",
			emitting: false,
		});

		for (const e of [this.sparks, this.shards, this.motes]) {
			e.setDepth(50);
		}
	}

	/** Bind a fighter's sprite so impacts can punch its scale. */
	registerBody(key: string, sprite: Phaser.GameObjects.Sprite) {
		this.fx(key).body = sprite;
	}

	private fx(key: string): FighterFx {
		let f = this.fighters.get(key);
		if (f) return f;

		const arc = this.scene.add.sprite(0, 0, TEX_ARC).setVisible(false);
		arc.setBlendMode("ADD");
		arc.setDepth(45);

		const blade = this.scene.add.sprite(0, 0, TEX_BLADE).setVisible(false);
		blade.setDepth(44);

		const guard = this.scene.add.sprite(0, 0, TEX_GUARD).setVisible(false);
		guard.setBlendMode("ADD");
		guard.setDepth(46);

		f = { arc, blade, guard, emitAccMs: 0, punch: 0 };
		this.fighters.set(key, f);
		return f;
	}

	/**
	 * Draw one fighter's continuous combat state: the swing trail, the blade, the
	 * guard, the charge aura and the stun sparks.
	 *
	 * Driven entirely from `PlayerPosition`, which means the local fighter's
	 * effects are predicted along with its state machine and appear on the frame
	 * the button was pressed — while the remote's come from the authoritative
	 * snapshot. Neither path needs its own animation logic.
	 */
	updateFighter(key: string, s: PlayerPosition, dtMs: number) {
		const f = this.fx(key);
		const cx = s.x + PLAYER_WIDTH / 2;
		const cy = s.y + PLAYER_HEIGHT / 2;
		const dir = s.facing >= 0 ? 1 : -1;

		this.drawSwing(f, s, cx, cy, dir);
		this.drawGuard(f, s, cx, cy, dir);

		f.emitAccMs += dtMs;
		const puff = f.emitAccMs >= 40;
		if (puff) f.emitAccMs = 0;

		if (puff) {
			this.drawCharge(s, cx, cy);
			this.drawStun(s, cx, s.y);
		}

		this.applyPunch(f, dtMs);
	}

	private drawSwing(
		f: FighterFx,
		s: PlayerPosition,
		cx: number,
		cy: number,
		dir: number,
	) {
		if (s.meleeAction === "none") {
			f.arc.setVisible(false);
			f.blade.setVisible(false);
			return;
		}

		const def = MOVES[s.meleeAction];
		const phase = meleePhase(s);
		const total = def.startupMs + def.activeMs;
		// 0 at the start of the wind-up, 1 as the active window closes: the swing
		// reads as one continuous motion rather than snapping between phases.
		const swing = Math.min(1, s.meleeTimer / total);

		// Slash and Massive cut across; the uppercut travels upward.
		const arcFrom = s.meleeAction === "uppercut" ? 1.5 : -0.95;
		const arcTo = s.meleeAction === "uppercut" ? -1.5 : 0.95;
		const angle = arcFrom + (arcTo - arcFrom) * swing;

		const reach = def.reachPx;
		f.blade.setVisible(true);
		f.blade.setPosition(cx + dir * 12, cy);
		f.blade.setRotation(dir > 0 ? angle : Math.PI - angle);
		f.blade.setScale(dir > 0 ? 1 : 1, 1);

		if (phase === "startup") {
			f.arc.setVisible(false);
			return;
		}

		// The trail lives only for the active frames, fading as it closes, so what
		// you see on screen is exactly when the hitbox is real.
		const activeT = Math.min(
			1,
			Math.max(0, (s.meleeTimer - def.startupMs) / def.activeMs),
		);
		f.arc.setVisible(phase === "active");
		f.arc.setPosition(cx + dir * reach * 0.55, cy + def.boxTopOffset * 0.5);
		f.arc.setRotation(dir > 0 ? angle : Math.PI - angle);
		f.arc.setScale((reach / 46) * (0.8 + 0.3 * activeT));
		f.arc.setAlpha(1 - activeT * 0.75);
		f.arc.setTint(COLOR[s.meleeAction]);
	}

	private drawGuard(
		f: FighterFx,
		s: PlayerPosition,
		cx: number,
		cy: number,
		dir: number,
	) {
		if (!s.blocking) {
			f.guard.setVisible(false);
			return;
		}
		// The parry window is the only thing a defender can time, so it is the one
		// thing the guard has to communicate: bright and large while it is open,
		// dim and small once it has passed.
		const parrying = s.blockTimer <= PARRY_WINDOW_MS;
		f.guard.setVisible(true);
		f.guard.setPosition(cx + dir * 20, cy);
		f.guard.setScale(dir > 0 ? 1 : -1, parrying ? 1.15 : 1);
		f.guard.setTint(parrying ? COLOR.parry : COLOR.block);
		f.guard.setAlpha(parrying ? 1 : 0.45);
	}

	private drawCharge(s: PlayerPosition, cx: number, cy: number) {
		if (s.chargeTimer <= 0 && !s.massiveReady) return;

		if (s.massiveReady) {
			// Armed: a steady bright pulse, so the threat is obvious to both players.
			this.motes.setParticleTint(COLOR.massive);
			this.motes.explode(3, cx, cy);
			return;
		}

		// Charging: motes drawn inward, denser as the charge fills.
		const t = Math.min(1, s.chargeTimer / MASSIVE_CHARGE_MS);
		const radius = 46 - 30 * t;
		const angle = Math.random() * Math.PI * 2;
		this.motes.setParticleTint(COLOR.charge);
		this.motes.explode(
			1,
			cx + Math.cos(angle) * radius,
			cy + Math.sin(angle) * radius,
		);
	}

	private drawStun(s: PlayerPosition, cx: number, top: number) {
		if (s.stunTimer <= 0) return;
		const angle = (s.stunTimer / 90) % (Math.PI * 2);
		this.motes.setParticleTint(COLOR.stun);
		this.motes.explode(1, cx + Math.cos(angle) * 16, top - 10 + Math.sin(angle) * 5);
	}

	/**
	 * The stand-in for hitstop: a quick scale overshoot on the struck sprite.
	 * Purely cosmetic, and it decays on wall-clock time rather than sim time so
	 * it can never influence anything that is being replayed.
	 */
	private applyPunch(f: FighterFx, dtMs: number) {
		if (!f.body) return;
		if (f.punch <= 0) {
			f.body.setScale(1);
			return;
		}
		f.punch = Math.max(0, f.punch - dtMs / 180);
		const k = 1 + 0.35 * f.punch;
		f.body.setScale(k, 1 + 0.18 * f.punch);
	}

	/** One sword impact, as judged by the server (or by the offline resolver). */
	impact(event: ImpactEvent, victimKey?: string) {
		const { move, outcome, x, y, dir } = event;
		const heavy = move === "massive";

		if (victimKey) this.fx(victimKey).punch = heavy ? 1 : 0.55;

		switch (outcome) {
			case "blocked": {
				this.sparks.setParticleTint(COLOR.block);
				this.sparks.explode(10, x, y);
				this.ring(x, y, COLOR.block, 0.5, 220);
				this.shake(70, 0.002);
				break;
			}

			case "parried": {
				// The biggest read in the game deserves the biggest tell.
				this.sparks.setParticleTint(COLOR.parry);
				this.sparks.explode(22, x, y);
				this.shards.setParticleTint(COLOR.parry);
				this.shards.explode(14, x, y);
				this.ring(x, y, COLOR.parry, 1.3, 420);
				this.shake(180, 0.008);
				break;
			}

			case "backstab": {
				this.sparks.setParticleTint(COLOR.backstab);
				this.sparks.explode(20, x, y);
				this.shards.setParticleTint(COLOR.backstab);
				this.shards.explode(10, x, y);
				this.ring(x, y, COLOR.backstab, 0.9, 320);
				this.shake(150, 0.006);
				break;
			}

			default: {
				const tint = COLOR[move];
				this.sparks.setParticleTint(tint);
				this.sparks.explode(heavy ? 26 : 12, x, y);
				if (move !== "slash") {
					this.shards.setParticleTint(tint);
					this.shards.explode(heavy ? 18 : 8, x, y);
				}
				if (heavy) this.ring(x, y, tint, 1.5, 460);
				if (move === "uppercut") this.launchPlume(x, y);
				this.shake(heavy ? 240 : 80, heavy ? 0.011 : 0.003);
				break;
			}
		}

		// Nudge the burst along the swing so it reads as directional.
		this.sparks.setPosition(dir * 4, 0);
	}

	/** An upward cone, sold as the target leaving the ground. */
	private launchPlume(x: number, y: number) {
		this.sparks.setParticleTint(COLOR.uppercut);
		for (let i = 0; i < 8; i++) {
			this.sparks.explode(1, x + (Math.random() - 0.5) * 20, y - i * 7);
		}
	}

	private ring(
		x: number,
		y: number,
		tint: number,
		scale: number,
		durationMs: number,
	) {
		const ring = this.scene.add.sprite(x, y, TEX_RING);
		ring.setTint(tint);
		ring.setBlendMode("ADD");
		ring.setDepth(49);
		ring.setScale(scale * 0.2);
		this.scene.tweens.add({
			targets: ring,
			scale: scale,
			alpha: 0,
			duration: durationMs,
			ease: "Cubic.Out",
			onComplete: () => ring.destroy(),
		});
	}

	/**
	 * Camera shake only — never a simulation pause.
	 *
	 * Phaser applies shake as a render-time offset and leaves `scrollX`/`scrollY`
	 * alone, so this does not register as camera jitter in the diagnostic.
	 */
	private shake(durationMs: number, intensity: number) {
		this.scene.cameras.main.shake(durationMs, intensity);
	}

	/** Drop a fighter's sprites, e.g. when a remote leaves. */
	forget(key: string) {
		const f = this.fighters.get(key);
		if (!f) return;
		f.arc.destroy();
		f.blade.destroy();
		f.guard.destroy();
		this.fighters.delete(key);
	}

	reset() {
		for (const f of this.fighters.values()) {
			f.arc.setVisible(false);
			f.blade.setVisible(false);
			f.guard.setVisible(false);
			f.punch = 0;
			f.body?.setScale(1);
		}
	}
}
