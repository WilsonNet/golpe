/**
 * Everything you see when swords meet. Presentation only — nothing here is ever
 * read back by the simulation.
 *
 * That separation is not stylistic. The obvious way to sell a heavy hit is
 * hitstop, freezing the game for a few frames on impact; it is unavailable
 * here, because pausing the simulation on one machine and not the other desyncs
 * the match. So impact is faked entirely in the renderer: shake, a scale punch,
 * and a lot of particles. See specs/melee.md.
 */

import { type Container, Sprite } from "pixi.js";
import {
	MASSIVE_CHARGE_MS,
	type MeleeMove,
	type MeleeOutcome,
	MOVES,
	meleePhase,
	PARRY_WINDOW_MS,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerPosition,
} from "../simulation/Physics";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/**
 * Palette. One colour per readable game state, so a glance tells you what
 * happened.
 *
 * Deliberately not a `Record<string, number>`: that erases which keys exist, so
 * every lookup types as possibly-undefined and a typo for a colour that was
 * never defined would sail through to a runtime `undefined` tint. Keying it on
 * `MeleeMove` means adding a move to the frame-data table fails to compile until
 * it has a colour.
 */
const COLOR = {
	slash: 0xffffff,
	uppercut: 0x8ff0ff,
	massive: 0xffb238,
	charge: 0xffd166,
	block: 0x62d0ff,
	parry: 0xffe066,
	backstab: 0xc471ff,
	stun: 0xffe066,
} as const satisfies Record<MeleeMove | string, number>;

export interface ImpactEvent {
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
}

/** An expanding ring, tracked by hand so it needs no tween library. */
interface Ring {
	sprite: Sprite;
	ageMs: number;
	lifeMs: number;
	toScale: number;
}

/** Per-fighter persistent sprites, created on first sight. */
interface FighterFx {
	arc: Sprite;
	blade: Sprite;
	guard: Sprite;
	emitAccMs: number;
	/** Sprite the fighter is drawn with, for the impact scale punch. */
	body?: Sprite;
	punch: number;
}

export class MeleeFx {
	private readonly fighters = new Map<string, FighterFx>();
	private readonly particles: ParticleSystem;
	private readonly rings: Ring[] = [];

	constructor(
		private readonly layer: Container,
		private readonly stage: Stage,
	) {
		this.particles = new ParticleSystem(layer);
	}

	/** Bind a fighter's sprite so impacts can punch its scale. */
	registerBody(key: string, sprite: Sprite) {
		this.fx(key).body = sprite;
	}

	/**
	 * Release a fighter's effect sprites.
	 *
	 * Fighters are transient now: sixteen slots, and somebody leaves every match.
	 * Three sprites per fighter that are created on first sight and never
	 * destroyed is a leak that only shows up after an hour of a busy server, which
	 * is exactly the kind of leak nobody finds.
	 */
	forget(key: string) {
		const f = this.fighters.get(key);
		if (!f) return;
		f.arc.destroy();
		f.blade.destroy();
		f.guard.destroy();
		this.fighters.delete(key);
	}

	private fx(key: string): FighterFx {
		let f = this.fighters.get(key);
		if (f) return f;

		const mk = (texture: string, blend: boolean) => {
			const s = new Sprite(tex(texture));
			s.anchor.set(0.5);
			s.visible = false;
			if (blend) s.blendMode = "add";
			this.layer.addChild(s);
			return s;
		};

		f = {
			arc: mk(TEX.arc, true),
			blade: mk(TEX.blade, false),
			guard: mk(TEX.guard, true),
			emitAccMs: 0,
			punch: 0,
		};
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
		if (f.emitAccMs >= 40) {
			f.emitAccMs = 0;
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
			f.arc.visible = false;
			f.blade.visible = false;
			return;
		}

		const def = MOVES[s.meleeAction];
		const phase = meleePhase(s);
		// 0 at the start of the wind-up, 1 as the active window closes: the swing
		// reads as one continuous motion rather than snapping between phases.
		const swing = Math.min(1, s.meleeTimer / (def.startupMs + def.activeMs));

		// Slash and Massive cut across; the uppercut travels upward.
		const from = s.meleeAction === "uppercut" ? 1.5 : -0.95;
		const to = s.meleeAction === "uppercut" ? -1.5 : 0.95;
		const angle = from + (to - from) * swing;

		f.blade.visible = true;
		f.blade.position.set(cx + dir * 12, cy);
		f.blade.rotation = dir > 0 ? angle : Math.PI - angle;

		if (phase !== "active") {
			f.arc.visible = false;
			return;
		}

		// The trail lives only for the active frames, fading as it closes, so what
		// you see on screen is exactly when the hitbox is real.
		const activeT = Math.min(
			1,
			Math.max(0, (s.meleeTimer - def.startupMs) / def.activeMs),
		);
		f.arc.visible = true;
		f.arc.position.set(
			cx + dir * def.reachPx * 0.55,
			cy + def.boxTopOffset * 0.5,
		);
		f.arc.rotation = dir > 0 ? angle : Math.PI - angle;
		f.arc.scale.set((def.reachPx / 46) * (0.8 + 0.3 * activeT));
		f.arc.alpha = 1 - activeT * 0.75;
		f.arc.tint = COLOR[s.meleeAction];
	}

	private drawGuard(
		f: FighterFx,
		s: PlayerPosition,
		cx: number,
		cy: number,
		dir: number,
	) {
		if (!s.blocking) {
			f.guard.visible = false;
			return;
		}
		// The parry window is the only thing a defender can time, so it is the one
		// thing the guard has to communicate: bright and large while it is open,
		// dim and small once it has passed.
		const parrying = s.blockTimer <= PARRY_WINDOW_MS;
		f.guard.visible = true;
		f.guard.position.set(cx + dir * 20, cy);
		f.guard.scale.set(dir > 0 ? 1 : -1, parrying ? 1.15 : 1);
		f.guard.tint = parrying ? COLOR.parry : COLOR.block;
		f.guard.alpha = parrying ? 1 : 0.45;
	}

	private drawCharge(s: PlayerPosition, cx: number, cy: number) {
		if (s.chargeTimer <= 0 && !s.massiveReady) return;

		if (s.massiveReady) {
			// Armed: a steady bright pulse, so the threat is obvious to both players.
			this.particles.burst({
				texture: TEX.spark,
				count: 3,
				x: cx,
				y: cy,
				tint: COLOR.massive,
				speed: [10, 60],
				lifeMs: 420,
				scale: [0.8, 0],
			});
			return;
		}

		// Charging: motes drawn inward, tighter as the charge fills.
		const t = Math.min(1, s.chargeTimer / MASSIVE_CHARGE_MS);
		const radius = 46 - 30 * t;
		const a = Math.random() * Math.PI * 2;
		this.particles.burst({
			texture: TEX.spark,
			count: 1,
			x: cx + Math.cos(a) * radius,
			y: cy + Math.sin(a) * radius,
			tint: COLOR.charge,
			speed: [5, 25],
			lifeMs: 380,
			scale: [0.7, 0],
		});
	}

	private drawStun(s: PlayerPosition, cx: number, top: number) {
		if (s.stunTimer <= 0) return;
		const a = (s.stunTimer / 90) % (Math.PI * 2);
		this.particles.burst({
			texture: TEX.spark,
			count: 1,
			x: cx + Math.cos(a) * 16,
			y: top - 10 + Math.sin(a) * 5,
			tint: COLOR.stun,
			speed: [5, 20],
			lifeMs: 400,
			scale: [0.6, 0],
		});
	}

	/**
	 * The stand-in for hitstop: a quick scale overshoot on the struck sprite.
	 * Purely cosmetic, and it decays on wall-clock time rather than sim time so
	 * it can never influence anything that is being replayed.
	 */
	private applyPunch(f: FighterFx, dtMs: number) {
		if (!f.body) return;
		if (f.punch <= 0) {
			f.body.scale.set(1);
			return;
		}
		f.punch = Math.max(0, f.punch - dtMs / 180);
		f.body.scale.set(1 + 0.35 * f.punch, 1 + 0.18 * f.punch);
	}

	/** One sword impact, as judged by the server (or by the offline resolver). */
	impact(event: ImpactEvent, victimKey?: string) {
		const { move, outcome, x, y } = event;
		const heavy = move === "massive";

		if (victimKey) this.fx(victimKey).punch = heavy ? 1 : 0.55;

		const sparks = (count: number, tint: number, speedMax = 320) =>
			this.particles.burst({
				texture: TEX.spark,
				count,
				x,
				y,
				tint,
				speed: [90, speedMax],
				lifeMs: 340,
				scale: [1.1, 0],
				gravity: 420,
			});

		const shards = (count: number, tint: number) =>
			this.particles.burst({
				texture: TEX.shard,
				count,
				x,
				y,
				tint,
				speed: [140, 420],
				lifeMs: 480,
				scale: [1, 0.2],
				gravity: 600,
				spin: true,
			});

		switch (outcome) {
			case "blocked":
				sparks(10, COLOR.block);
				this.ring(x, y, COLOR.block, 0.5, 220);
				this.stage.startShake(70, 2);
				break;

			case "parried":
				// The biggest read in the game deserves the biggest tell.
				sparks(22, COLOR.parry);
				shards(14, COLOR.parry);
				this.ring(x, y, COLOR.parry, 1.3, 420);
				this.stage.startShake(180, 7);
				break;

			case "backstab":
				sparks(20, COLOR.backstab);
				shards(10, COLOR.backstab);
				this.ring(x, y, COLOR.backstab, 0.9, 320);
				this.stage.startShake(150, 5);
				break;

			default: {
				const tint = COLOR[move];
				sparks(heavy ? 26 : 12, tint, heavy ? 420 : 320);
				if (move !== "slash") shards(heavy ? 18 : 8, tint);
				if (heavy) this.ring(x, y, tint, 1.5, 460);
				if (move === "uppercut") this.launchPlume(x, y);
				this.stage.startShake(heavy ? 240 : 80, heavy ? 9 : 3);
				break;
			}
		}
	}

	/** An upward cone, sold as the target leaving the ground. */
	private launchPlume(x: number, y: number) {
		this.particles.burst({
			texture: TEX.spark,
			count: 14,
			x,
			y,
			tint: COLOR.uppercut,
			speed: [180, 420],
			// Straight up, give or take: -90 degrees with a narrow spread.
			angle: [-Math.PI * 0.72, -Math.PI * 0.28],
			lifeMs: 460,
			scale: [1.2, 0],
			gravity: 500,
		});
	}

	private ring(
		x: number,
		y: number,
		tint: number,
		toScale: number,
		lifeMs: number,
	) {
		const sprite = new Sprite(tex(TEX.ring));
		sprite.anchor.set(0.5);
		sprite.position.set(x, y);
		sprite.tint = tint;
		sprite.blendMode = "add";
		sprite.scale.set(toScale * 0.2);
		this.layer.addChild(sprite);
		this.rings.push({ sprite, ageMs: 0, lifeMs, toScale });
	}

	/** Advance particles and rings. Frame time, never simulation time. */
	update(dtMs: number) {
		this.particles.update(dtMs);

		// Compact in place: advance every ring, keep the survivors at the front,
		// then truncate. No splice inside the loop and no index arithmetic, so
		// there is no way to skip an element by removing its neighbour.
		let kept = 0;
		for (const r of this.rings) {
			r.ageMs += dtMs;
			const t = Math.min(1, r.ageMs / r.lifeMs);
			// Ease out, so the ring snaps outward and then settles.
			const eased = 1 - (1 - t) ** 3;
			r.sprite.scale.set(r.toScale * (0.2 + 0.8 * eased));
			r.sprite.alpha = 1 - t;

			if (t >= 1) {
				r.sprite.destroy();
				continue;
			}
			this.rings[kept++] = r;
		}
		this.rings.length = kept;
	}

	reset() {
		for (const f of this.fighters.values()) {
			f.arc.visible = false;
			f.blade.visible = false;
			f.guard.visible = false;
			f.punch = 0;
			f.body?.scale.set(1);
		}
		this.particles.clear();
		for (const r of this.rings) r.sprite.destroy();
		this.rings.length = 0;
	}
}
