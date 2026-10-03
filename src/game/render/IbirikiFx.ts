/**
 * Ibiriki, drawn: his axes, his charges, his berserk and his curse. See
 * specs/ibiriki.md.
 *
 * Presentation only, like everything in `render/`: nothing here is read back
 * by the simulation, and it runs on wall-clock frame time. It reads three
 * things — the axes off the snapshot (dead-reckoned with the shared
 * `tickAxe`, exactly like the trap canisters), the fighters' own predicted
 * state (`chargeTimer`, `throwChargeTimer`, `bloodlust`, `meleeAction`,
 * `stompTimer`) and the running rupture — and makes them loud.
 *
 * - **The Sunder's charge**: blood-red motes stream *into* the raised blade
 *   while it fills, and the blade burns once it is armed. The swing leaves a
 *   trail of embers that hang in the air where it passed.
 * - **The axe's charge**: orange embers gather on the raised axe; a full
 *   charge flares. A full-charge axe flies wreathed in embers.
 * - **Berserk**: red flame tongues rising off the body, and two glowing eyes.
 * - **Rupture**: the stomp's shockwave, and every ruptured fighter bleeds
 *   droplets as they move.
 */

import { type Container, Sprite } from "pixi.js";
import { AXE_CHARGE_MS, AXE_SPIN_RAD_PER_S } from "../../tweakables/ranged.js";
import type { AxeHitMsg, SnapshotAxe, SnapshotRupture } from "../online/types";
import { PLAYER_HEIGHT, PLAYER_WIDTH, type World } from "../simulation/Arena";
import { type AxeState, tickAxe } from "../simulation/Axes";
import {
	CHARGE_LOCK_MS,
	isBerserk,
	MOVES,
	meleePhase,
} from "../simulation/Melee";
import type { PlayerPosition } from "../simulation/Physics";
import type { TeamId } from "../simulation/Teams";
import { teamTint } from "../teamPalette";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";

/** Ibiriki's register: blood, embers and iron. */
const COLOR = {
	blood: 0xd0122a,
	bloodDark: 0x6e0612,
	mote: 0xff3b3b,
	ember: 0xff8a2a,
	emberHot: 0xffd27a,
	eye: 0xff2020,
	aura: 0xff2a1a,
	shock: 0xff4d4d,
	dust: 0xc8b89a,
	steel: 0xe6ecf0,
} as const;

/** One fighter as this layer needs it: who, where it is drawn, and its state. */
export interface IbirikiFighterView {
	serverId: string;
	team: TeamId | null;
	/** The *drawn* top-left — the render smoother's, like the nameplates. */
	x: number;
	y: number;
	body: PlayerPosition;
	/** Is this fighter carrying Ibiriki's kit (the sword charge is his Sunder)? */
	ibiriki: boolean;
	alive: boolean;
}

interface AxeFlight {
	state: AxeState;
	sprite: Sprite;
	glow: Sprite;
	lastMs: number;
	emberAccMs: number;
}

/** The Sunder's motes: how often one is born while the blade fills. */
const MOTE_INTERVAL_MS = 22;
/** How far out a mote is born, px from the blade. */
const MOTE_RADIUS: [number, number] = [26, 48];
/** How long a mote takes to arrive. */
const MOTE_LIFE_MS = 360;
/** The swing's trail: an ember every this many ms through the active frames. */
const TRAIL_INTERVAL_MS = 8;
/** The berserk aura: a flame tongue every this many ms. */
const AURA_INTERVAL_MS = 40;
/** A ruptured fighter drips this often per px/s of speed. */
const BLEED_PER_SPEED = 0.0016;
/** The resting axe's "pick me up" glint, for its owner. */
const GLINT_PERIOD_MS = 900;
/**
 * The axe sprite's draw scale: the render is 128 px across 1.6 m of model
 * (80 px/m) and the world draws a fighter at 16 px/m — the axe's 1.47 m is
 * ~23 world px, a little under half a fighter.
 */
const AXE_SCALE = 0.2;

export class IbirikiFx {
	private readonly particles: ParticleSystem;
	private readonly axes = new Map<number, AxeFlight>();
	/** Per-fighter emission clocks, keyed by server id. */
	private readonly clocks = new Map<
		string,
		{ mote: number; trail: number; aura: number; bleed: number }
	>();
	/** Eye glows, per berserk fighter. */
	private readonly eyes = new Map<string, Sprite[]>();
	private glintMs = 0;

	constructor(
		private readonly effectsLayer: Container,
		private readonly projectileLayer: Container,
		private readonly stage: Stage,
		/** The room's geometry, asked fresh: a control match rebuilds its map. */
		private readonly world: () => World,
	) {
		this.particles = new ParticleSystem(effectsLayer);
	}

	// ---------------------------------------------------------------------
	// Axes
	// ---------------------------------------------------------------------

	/**
	 * Draw every axe the snapshot holds. A flying axe is anchored on first sight
	 * and flown with the server's own `tickAxe`; the moment the snapshot says it
	 * rests, the sprite snaps to the server's resting place — so the axe on the
	 * floor is exactly where its owner has to walk.
	 */
	syncAxes(live: readonly SnapshotAxe[], nowMs: number, myId: string) {
		const seen = new Set<number>();
		for (const a of live) {
			seen.add(a.id);
			let f = this.axes.get(a.id);
			if (!f) {
				const sprite = new Sprite(tex(TEX.axe));
				// The head's centre: the render puts it ~78% along, ~45% down.
				sprite.anchor.set(0.78, 0.45);
				sprite.scale.set(AXE_SCALE);
				const glow = new Sprite(tex(TEX.halo));
				glow.anchor.set(0.5);
				glow.blendMode = "add";
				glow.tint = COLOR.ember;
				glow.visible = false;
				this.projectileLayer.addChild(glow, sprite);
				f = {
					state: { ...a, damage: 0 },
					sprite,
					glow,
					lastMs: nowMs,
					emberAccMs: 0,
				};
				this.axes.set(a.id, f);
			}
			const s = f.state;
			// The server's word on rest and drop always wins: a dead-reckoned
			// flight that disagrees about where the axe landed is corrected,
			// never trusted.
			if (a.resting && !s.resting) {
				Object.assign(s, a, { damage: 0 });
			}
			if (a.dropped && !s.dropped) {
				Object.assign(s, a, { damage: 0 });
			}
			const dtSec = Math.max(0, nowMs - f.lastMs) / 1000;
			f.lastMs = nowMs;
			if (!s.resting && dtSec > 0)
				tickAxe(s, Math.min(dtSec, 0.05), this.world());

			f.sprite.position.set(s.x, s.y);
			if (s.resting) {
				// Biting into what it hit, the way it flew in. A dropped axe lies
				// flat on the floor.
				f.sprite.rotation = s.dropped ? 0 : s.restAngle;
				f.sprite.scale.set(
					AXE_SCALE,
					s.restAngle > Math.PI / 2 || s.restAngle < -Math.PI / 2
						? -AXE_SCALE
						: AXE_SCALE,
				);
			} else {
				const dir = s.vx >= 0 ? 1 : -1;
				const spin = s.dropped ? AXE_SPIN_RAD_PER_S * 0.4 : AXE_SPIN_RAD_PER_S;
				f.sprite.rotation += dir * spin * dtSec;
				f.sprite.scale.set(AXE_SCALE, dir > 0 ? AXE_SCALE : -AXE_SCALE);
			}

			// A full axe flies wreathed in embers and a hot glow.
			const burning = s.full && !s.resting && !s.dropped;
			f.glow.visible = burning || (s.resting && a.ownerId === myId);
			f.glow.position.set(s.x, s.y);
			if (burning) {
				f.glow.tint = COLOR.ember;
				f.glow.alpha = 0.7;
				f.glow.scale.set(0.9);
				f.emberAccMs += dtSec * 1000;
				while (f.emberAccMs > 10) {
					f.emberAccMs -= 10;
					this.particles.burst({
						texture: TEX.spark,
						count: 1,
						x: s.x + (Math.random() - 0.5) * 10,
						y: s.y + (Math.random() - 0.5) * 10,
						tint: Math.random() < 0.5 ? COLOR.ember : COLOR.mote,
						speed: [10, 50],
						lifeMs: 420,
						scale: [1.1, 0],
						alpha: [1, 0],
						gravity: -40,
					});
				}
			} else if (f.glow.visible) {
				// Your own axe on the floor glints: "walk back here".
				const t = (this.glintMs % GLINT_PERIOD_MS) / GLINT_PERIOD_MS;
				f.glow.tint = COLOR.steel;
				f.glow.alpha = 0.18 + 0.22 * Math.sin(t * Math.PI * 2) ** 2;
				f.glow.scale.set(0.45);
			}
		}
		for (const [id, f] of this.axes) {
			if (seen.has(id)) continue;
			f.sprite.destroy();
			f.glow.destroy();
			this.axes.delete(id);
		}
	}

	/** An axe struck something: sparks, a crushed guard, a thunk, a pickup. */
	axeHit(e: AxeHitMsg) {
		switch (e.outcome) {
			case "hit":
				this.particles.burst({
					texture: TEX.spark,
					count: e.full ? 22 : 10,
					x: e.x,
					y: e.y,
					tint: COLOR.blood,
					speed: [60, e.full ? 320 : 180],
					lifeMs: 420,
					scale: [1.3, 0],
					alpha: [1, 0],
					gravity: 500,
					blend: false,
				});
				if (e.full) this.stage.startShake(200, 6);
				break;
			case "crushed":
				this.particles.burst({
					texture: TEX.shard,
					count: 16,
					x: e.x,
					y: e.y,
					tint: COLOR.shock,
					speed: [120, 360],
					lifeMs: 380,
					scale: [1.2, 0],
					alpha: [1, 0],
					gravity: 400,
					spin: true,
				});
				this.stage.startShake(240, 8);
				break;
			case "blocked":
				this.particles.burst({
					texture: TEX.spark,
					count: 10,
					x: e.x,
					y: e.y,
					tint: COLOR.steel,
					speed: [80, 220],
					lifeMs: 260,
					scale: [1, 0],
					alpha: [1, 0],
				});
				break;
			case "stuck":
				this.particles.burst({
					texture: TEX.chunk,
					count: 5,
					x: e.x,
					y: e.y,
					tint: COLOR.dust,
					speed: [30, 120],
					angle: [-Math.PI, 0],
					lifeMs: 320,
					scale: [0.5, 0.1],
					alpha: [0.9, 0],
					gravity: 600,
					blend: false,
				});
				break;
			case "pickup":
				this.particles.burst({
					texture: TEX.spark,
					count: 8,
					x: e.x,
					y: e.y,
					tint: COLOR.steel,
					speed: [20, 90],
					angle: [-Math.PI, 0],
					lifeMs: 300,
					scale: [0.9, 0],
					alpha: [1, 0],
				});
				break;
		}
	}

	// ---------------------------------------------------------------------
	// Rupture
	// ---------------------------------------------------------------------

	/** The stomp: a blood-red shockwave rolling out along the floor. */
	ruptureOpened(x: number, y: number, team: TeamId | null) {
		const tint = teamTint(COLOR.shock, team, 0.2);
		this.particles.burst({
			texture: TEX.ring,
			count: 1,
			x,
			y,
			tint,
			speed: [0, 0],
			lifeMs: 520,
			scale: [0.3, 3.2],
			alpha: [0.95, 0],
		});
		this.particles.burst({
			texture: TEX.chunk,
			count: 18,
			x,
			y,
			tint: COLOR.dust,
			speed: [120, 420],
			angle: [-Math.PI, 0],
			lifeMs: 600,
			scale: [0.7, 0.2],
			alpha: [1, 0],
			gravity: 900,
			blend: false,
		});
		this.particles.burst({
			texture: TEX.spark,
			count: 30,
			x,
			y,
			tint: COLOR.blood,
			speed: [80, 360],
			lifeMs: 700,
			scale: [1.4, 0],
			alpha: [1, 0],
			gravity: 300,
		});
		this.stage.startShake(520, 14);
	}

	// ---------------------------------------------------------------------
	// Per fighter
	// ---------------------------------------------------------------------

	update(
		fighters: readonly IbirikiFighterView[],
		rupture: SnapshotRupture | null,
		dtMs: number,
	) {
		this.glintMs += dtMs;
		const ruptured = new Set(rupture?.victims ?? []);
		const berserkNow = new Set<string>();

		for (const f of fighters) {
			if (!f.alive) continue;
			const clock = this.clocks.get(f.serverId) ?? {
				mote: 0,
				trail: 0,
				aura: 0,
				bleed: 0,
			};
			this.clocks.set(f.serverId, clock);
			const b = f.body;
			const cx = f.x + PLAYER_WIDTH / 2;
			const facing = b.facing >= 0 ? 1 : -1;

			if (f.ibiriki) {
				this.sunderCharge(f, clock, dtMs, cx, facing);
				this.sunderTrail(f, clock, dtMs, cx, facing);
				this.axeCharge(f, clock, dtMs, cx, facing);
			}
			if (isBerserk(b)) {
				berserkNow.add(f.serverId);
				this.berserk(f, clock, dtMs, cx, facing);
			}
			if (ruptured.has(f.serverId)) this.bleed(f, clock, dtMs, cx);
		}

		for (const [id, sprites] of this.eyes) {
			if (berserkNow.has(id)) continue;
			for (const s of sprites) s.destroy();
			this.eyes.delete(id);
		}
		this.particles.update(dtMs);
	}

	/** Motes stream into the raised blade while the Sunder fills. */
	private sunderCharge(
		f: IbirikiFighterView,
		clock: { mote: number },
		dtMs: number,
		cx: number,
		facing: number,
	) {
		const b = f.body;
		if (b.stance !== "sword") return;
		const filling = b.chargeTimer >= CHARGE_LOCK_MS && !b.massiveReady;
		const armed = b.massiveReady && b.meleeAction === "none";
		if (!filling && !armed) return;
		// The blade is raised over the head, a little behind it.
		const tipX = cx - facing * 6;
		const tipY = f.y - 18;
		clock.mote += dtMs;
		const interval = armed ? MOTE_INTERVAL_MS * 2 : MOTE_INTERVAL_MS;
		while (clock.mote > interval) {
			clock.mote -= interval;
			if (armed) {
				// Armed: the blade burns — embers boil off it.
				this.particles.burst({
					texture: TEX.spark,
					count: 1,
					x: tipX + (Math.random() - 0.5) * 8,
					y: tipY + Math.random() * 24,
					tint: Math.random() < 0.6 ? COLOR.mote : COLOR.emberHot,
					speed: [20, 70],
					angle: [-Math.PI * 0.8, -Math.PI * 0.2],
					lifeMs: 380,
					scale: [1.2, 0],
					alpha: [1, 0],
				});
				continue;
			}
			// Filling: a mote is born out in the air and flies into the blade.
			const a = Math.random() * Math.PI * 2;
			const r =
				MOTE_RADIUS[0] + Math.random() * (MOTE_RADIUS[1] - MOTE_RADIUS[0]);
			const sx = tipX + Math.cos(a) * r;
			const sy = tipY + Math.sin(a) * r;
			const toward = Math.atan2(tipY - sy, tipX - sx);
			this.particles.burst({
				texture: TEX.spark,
				count: 1,
				x: sx,
				y: sy,
				tint: COLOR.mote,
				speed: [(r / MOTE_LIFE_MS) * 1000, (r / MOTE_LIFE_MS) * 1000],
				angle: [toward, toward],
				lifeMs: MOTE_LIFE_MS,
				scale: [0.5, 1.2],
				alpha: [0.3, 1],
			});
		}
	}

	/** The Sunder comes down and leaves embers hanging where it passed. */
	private sunderTrail(
		f: IbirikiFighterView,
		clock: { trail: number },
		dtMs: number,
		cx: number,
		facing: number,
	) {
		const b = f.body;
		if (b.meleeAction !== "sunder" || meleePhase(b) !== "active") return;
		const d = MOVES.sunder;
		const t = Math.min(1, (b.meleeTimer - d.startupMs) / d.activeMs);
		// The arc of the blade tip: from straight overhead to the floor ahead.
		const from = -2.7;
		const to = 1.4;
		const ang = from + (to - from) * t;
		const reach = 34 + d.reachPx * 0.5;
		const px = cx + facing * Math.cos(ang) * reach;
		const py = f.y + PLAYER_HEIGHT * 0.45 + Math.sin(ang) * reach;
		clock.trail += dtMs;
		while (clock.trail > TRAIL_INTERVAL_MS) {
			clock.trail -= TRAIL_INTERVAL_MS;
			this.particles.burst({
				texture: TEX.spark,
				count: 2,
				x: px + (Math.random() - 0.5) * 6,
				y: py + (Math.random() - 0.5) * 6,
				tint: Math.random() < 0.5 ? COLOR.mote : COLOR.ember,
				speed: [4, 30],
				lifeMs: 650,
				scale: [1.4, 0.2],
				alpha: [1, 0],
				gravity: 40,
			});
		}
	}

	/** Embers gather on the raised axe; a full charge flares. */
	private axeCharge(
		f: IbirikiFighterView,
		clock: { mote: number },
		dtMs: number,
		cx: number,
		facing: number,
	) {
		const b = f.body;
		if (b.stance !== "gun" || b.throwChargeTimer <= 0) return;
		const frac = Math.min(1, b.throwChargeTimer / AXE_CHARGE_MS);
		const hx = cx - facing * 12;
		const hy = f.y - 4;
		clock.mote += dtMs * (0.5 + frac);
		while (clock.mote > MOTE_INTERVAL_MS) {
			clock.mote -= MOTE_INTERVAL_MS;
			const a = Math.random() * Math.PI * 2;
			const r = 14 + Math.random() * 18 * frac;
			this.particles.burst({
				texture: TEX.spark,
				count: 1,
				x: hx + Math.cos(a) * r,
				y: hy + Math.sin(a) * r,
				tint: frac >= 1 ? COLOR.emberHot : COLOR.ember,
				speed: [10, 40],
				angle: [-Math.PI * 0.85, -Math.PI * 0.15],
				lifeMs: 320,
				scale: [0.7 + frac, 0],
				alpha: [1, 0],
			});
		}
	}

	/** Berserk: flame tongues rise off the body, and the eyes burn. */
	private berserk(
		f: IbirikiFighterView,
		clock: { aura: number },
		dtMs: number,
		cx: number,
		facing: number,
	) {
		clock.aura += dtMs;
		while (clock.aura > AURA_INTERVAL_MS) {
			clock.aura -= AURA_INTERVAL_MS;
			this.particles.burst({
				texture: TEX.flame,
				count: 1,
				x: cx + (Math.random() - 0.5) * PLAYER_WIDTH * 1.2,
				y: f.y + PLAYER_HEIGHT * (0.5 + Math.random() * 0.45),
				tint: Math.random() < 0.7 ? COLOR.aura : COLOR.ember,
				speed: [40, 90],
				angle: [-Math.PI / 2 - 0.25, -Math.PI / 2 + 0.25],
				lifeMs: 520,
				scale: [0.9, 0.2],
				alpha: [0.75, 0],
			});
		}
		let eyes = this.eyes.get(f.serverId);
		if (!eyes) {
			eyes = [0, 1].map(() => {
				const s = new Sprite(tex(TEX.halo));
				s.anchor.set(0.5);
				s.blendMode = "add";
				s.tint = COLOR.eye;
				this.effectsLayer.addChild(s);
				return s;
			});
			this.eyes.set(f.serverId, eyes);
		}
		// The eyes sit at the ball's leading edge — he is drawn near profile,
		// looking where he faces — at about half the body's height (measured
		// off his sheet: the eyes at z 1.6 of a 3 m figure, scaled 0.89).
		const pulse = 0.75 + 0.25 * Math.sin(this.glintMs / 90);
		const ey = f.y + PLAYER_HEIGHT * 0.5;
		eyes.forEach((s, i) => {
			s.position.set(cx + facing * (i === 0 ? 9 : 14), ey);
			s.scale.set((i === 0 ? 0.14 : 0.18) * pulse);
			s.alpha = 0.95;
		});
	}

	/** A ruptured fighter bleeds as they move — faster the faster they go. */
	private bleed(
		f: IbirikiFighterView,
		clock: { bleed: number },
		dtMs: number,
		cx: number,
	) {
		const speed = Math.hypot(f.body.vx, f.body.vy);
		// Even standing still the curse shows: a slow pulse of red at the feet.
		clock.bleed += dtMs * (0.08 + speed * BLEED_PER_SPEED);
		while (clock.bleed > 1) {
			clock.bleed -= 1;
			this.particles.burst({
				texture: TEX.spark,
				count: 1,
				x: cx + (Math.random() - 0.5) * PLAYER_WIDTH,
				y: f.y + PLAYER_HEIGHT * (0.2 + Math.random() * 0.5),
				tint: Math.random() < 0.6 ? COLOR.blood : COLOR.bloodDark,
				speed: [10, 50],
				angle: [Math.PI * 0.3, Math.PI * 0.7],
				lifeMs: 520,
				scale: [0.9, 0.4],
				alpha: [1, 0],
				gravity: 700,
				blend: false,
			});
		}
	}

	reset() {
		for (const f of this.axes.values()) {
			f.sprite.destroy();
			f.glow.destroy();
		}
		this.axes.clear();
		for (const sprites of this.eyes.values())
			for (const s of sprites) s.destroy();
		this.eyes.clear();
		this.clocks.clear();
	}
}
