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
import type { TeamId } from "../simulation/Teams";
import { TINT, teamTint } from "../teamPalette";
import { TEX, tex } from "./assets";
import { ParticleSystem } from "./Particles";
import type { Stage } from "./Stage";
import { VIOLET } from "./UltAimLine";

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
	// The links warm up as the chain progresses, so how deep into a combo you are
	// is readable from across the arena.
	slash2: 0xffe9c4,
	slash3: 0xffc46b,
	uppercut: 0x8ff0ff,
	massive: 0xffb238,
	charge: 0xffd166,
	block: 0x62d0ff,
	parry: 0xffe066,
	backstab: 0xc471ff,
	stun: 0xffe066,
} as const satisfies Record<MeleeMove | string, number>;

/**
 * Dash wind: a cool white-blue, distinct from every sword colour so the tell is
 * "speed", not "a swing is coming".
 */
const DASH_WIND_COLOR = 0xbfe8ff;

/** Cadence of the ultimate charge aura's emissions, in milliseconds. */
const ULT_AURA_EVERY_MS = 24;

/**
 * How one move's blade travels, in the fighter's own frame.
 *
 * Angles are radians with 0 pointing forward and negative pointing up; the
 * renderer mirrors them for a left-facing fighter. Keyed on `MeleeMove` for the
 * same reason `COLOR` is — adding a move to the frame data table fails to compile
 * until somebody has decided what it looks like.
 */
interface SwingArc {
	/** Blade angle at the start of the wind-up. */
	from: number;
	/** Blade angle as the active window closes. */
	to: number;
	/**
	 * How far the cut travels *through* the screen, from -depth to +depth.
	 *
	 * This is the whole perspective trick, and it is what makes the chain's two
	 * diagonals read as opposites rather than as the same swing twice. Positive
	 * depth means the blade starts on the far side of the fighter and finishes
	 * near the camera — so it lengthens, thickens and brightens as it comes
	 * through. Negative is the same cut going the other way.
	 */
	depth: number;
	/** Where on the body the swing is anchored, relative to its centre. */
	lift: number;
}

const SWING = {
	/** First link: a kesa cut, high on the sword side down across to the far one. */
	slash: { from: -1.25, to: 2.1, depth: 0.85, lift: -6 },
	/** Second link: the mirror, over the shoulder and down the other diagonal. */
	slash2: { from: -2.24, to: 1.05, depth: -0.85, lift: -4 },
	/** The finisher: straight overhead, no diagonal, and it comes at you. */
	slash3: { from: -1.62, to: 1.57, depth: 0.45, lift: -12 },
	/** Upward, so the arc runs the other way and the depth stays flat. */
	uppercut: { from: 1.5, to: -1.5, depth: 0, lift: 0 },
	massive: { from: -0.95, to: 0.95, depth: 0.35, lift: -6 },
} as const satisfies Record<MeleeMove, SwingArc>;

/**
 * Foreshortening: how much longer and thicker the blade is drawn at the near end
 * of its travel than at the far end.
 */
const PERSPECTIVE_GAIN = 0.34;

export interface ImpactEvent {
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
}

/**
 * Steel at depth `z`: full white near the camera, dimmed toward the back.
 *
 * Aerial perspective, cheaply — the far half of a swing sits behind the fighter,
 * and a blade that stayed the same brightness through the whole arc flattens the
 * cut back into two dimensions no matter what its scale is doing.
 */
function depthTint(z: number): number {
	const level = Math.round(178 + 77 * Math.max(-1, Math.min(1, z)));
	return (level << 16) | (level << 8) | level;
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
	/** Cadence for the dash wind streaks. */
	dashEmitMs: number;
	/** Whether the fighter was mid-dash last frame, to notice a dash starting. */
	wasDashing: boolean;
	/** Cadence for the ultimate charge aura's motes. */
	ultEmitMs: number;
	/** Wall-clock age of the current ultimate hold, for the glow's breathing. */
	ultGlowMs: number;
	/** The last whole breath the aura has completed, for its pulse ring. */
	ultPulseFloor: number;
	/** The aura's soft violet envelope, drawn while the ultimate button is held. */
	glow: Sprite;
	/** The hotter inner core of the same envelope. */
	core: Sprite;
	/**
	 * The side this fighter's effects are tinted toward. `null` in a free-for-all,
	 * which makes every `teamTint` call below the identity.
	 *
	 * Stored per fighter rather than passed to each draw call, because `impact`
	 * is fired from a *server event* and has only ids to work with — the attacker
	 * whose colour the sparks take may be somebody this client is not drawing this
	 * frame.
	 */
	team: TeamId | null;
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
		f.glow.destroy();
		f.core.destroy();
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
			dashEmitMs: 0,
			wasDashing: false,
			ultEmitMs: 0,
			ultGlowMs: 0,
			ultPulseFloor: -1,
			glow: mk(TEX.halo, false),
			// The core is additive on purpose: it sits mostly on the fighter's
			// own body, where adding violet reads as inner fire rather than as
			// a wash against the sky.
			core: mk(TEX.halo, true),
			team: null,
		};
		// Painted, not added: over the bright sky an additive halo washes out to
		// white, and the aura's whole point is to read as the ability's violet.
		// The sprite's own ramp is already soft — tinting it is enough.
		f.glow.tint = VIOLET;
		f.core.tint = VIOLET;
		// A sword pivots at the hand, not at the middle of its own blade. With the
		// default centre anchor the tip and the grip swapped ends through a swing,
		// which no amount of perspective can make look like a cut.
		f.blade.anchor.set(0.12, 0.5);
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
	 *
	 * `holdingUlt` is the one thing `PlayerPosition` cannot carry: the held
	 * ultimate button is input, and the wire format keeps input and state
	 * separate on purpose. The local fighter's answer comes from the live input
	 * layer; a remote's from the input the server echoed for it. Either way the
	 * aura never invents a charge-up for a fighter whose cast would be refused.
	 */
	updateFighter(
		key: string,
		s: PlayerPosition,
		dtMs: number,
		holdingUlt: boolean,
		team: TeamId | null = null,
	) {
		const f = this.fx(key);
		// Latched here so `impact` — which is fired from a server event and knows
		// only ids — can tint an attacker's sparks without being handed a team.
		f.team = team;
		const cx = s.x + PLAYER_WIDTH / 2;
		const cy = s.y + PLAYER_HEIGHT / 2;
		const dir = s.facing >= 0 ? 1 : -1;

		this.drawSwing(f, s, cx, cy, dir);
		this.drawGuard(f, s, cx, cy, dir);
		this.drawDashWind(f, s, cx, cy, dtMs);
		this.drawUltAura(f, holdingUlt, cx, cy, dtMs);

		f.emitAccMs += dtMs;
		if (f.emitAccMs >= 40) {
			f.emitAccMs = 0;
			this.drawCharge(f, s, cx, cy);
			this.drawStun(f, s, cx, s.y);
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
		const arc = SWING[s.meleeAction];
		const phase = meleePhase(s);
		// 0 at the start of the wind-up, 1 as the active window closes: the swing
		// reads as one continuous motion rather than snapping between phases.
		const swing = Math.min(1, s.meleeTimer / (def.startupMs + def.activeMs));
		// Smoothstep, so the blade hangs in the wind-up and whips through the frames
		// where the hitbox is actually live.
		const eased = swing * swing * (3 - 2 * swing);
		const angle = arc.from + (arc.to - arc.from) * eased;

		// Depth this instant: -1 is as far from the camera as this cut goes, +1 as
		// near. A flat move stays at 0 and none of this does anything.
		const z = arc.depth * (eased * 2 - 1);
		const near = 1 + PERSPECTIVE_GAIN * z;

		f.blade.visible = true;
		// The hand moves with the blade: a cut coming toward the camera reaches
		// further out of the body than one going away from it.
		f.blade.position.set(cx + dir * (10 + 7 * z), cy + arc.lift);
		f.blade.rotation = dir > 0 ? angle : Math.PI - angle;
		// Length and thickness both grow as it nears, which is what sells a flat
		// sprite as travelling through the screen rather than across it.
		f.blade.scale.set(near, 1 + 0.5 * PERSPECTIVE_GAIN * z);
		// A touch of rake, so the blade is never quite edge-on to the camera.
		f.blade.skew.x = 0.28 * z * dir;
		// Steel, washed toward the wielder's side. Lightly: the depth ramp *is* the
		// perspective, and a blade repainted flat team-blue would lose the near/far
		// read that makes the swing travel through the screen.
		f.blade.tint = teamTint(depthTint(z), f.team, TINT.subtle);

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
			cy + def.boxTopOffset * 0.5 + arc.lift * 0.5,
		);
		f.arc.rotation = dir > 0 ? angle : Math.PI - angle;
		// The trail takes the same perspective as the blade that drew it, or the two
		// come apart at exactly the moment the swing is most visible.
		f.arc.scale.set((def.reachPx / 46) * (0.8 + 0.3 * activeT) * near);
		f.arc.alpha = (1 - activeT * 0.75) * (0.75 + 0.25 * (z + 1) * 0.5);
		// The trail keeps most of its move colour — white first link, amber
		// finisher, cyan uppercut — because that colour is frame data you can see.
		// The team pulls it, it does not replace it.
		f.arc.tint = teamTint(COLOR[s.meleeAction], f.team, TINT.subtle);
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
		// Same rule as the swing trail: the parry window is the one thing a
		// defender can time, so its gold stays gold and only leans toward the side.
		f.guard.tint = teamTint(
			parrying ? COLOR.parry : COLOR.block,
			f.team,
			TINT.subtle,
		);
		f.guard.alpha = parrying ? 1 : 0.45;
	}

	/**
	 * Wind trails for a dash.
	 *
	 * A dash is a burst of speed with no other tell — the fighter is a flat line
	 * holding its Y — so the reward has to be drawn. Streaks stream out of the
	 * *trailing* edge (the direction comes from `vx`, never from facing, which a
	 * fighter can keep while dashing the other way), tinted cool and kept
	 * translucent so they read as "you are moving fast" without ever covering
	 * the fighter or the arena behind it. Additive blend makes them light rather
	 * than paint.
	 *
	 * The kick-off fires once, the moment the dash starts; the streaks continue
	 * for as long as the dash holds its line, so their tail lingers just past the
	 * end of the travel.
	 */
	private drawDashWind(
		f: FighterFx,
		s: PlayerPosition,
		cx: number,
		cy: number,
		dtMs: number,
	) {
		const dashing = s.dashActiveTimer > 0;
		const dir = s.vx > 0 ? 1 : -1;

		if (dashing && !f.wasDashing) {
			// The tell that a dash is starting: a small air-burst out of the
			// trailing edge, whatever surface the dash was thrown from.
			this.particles.burst({
				texture: TEX.spark,
				count: 5,
				x: cx - dir * 20,
				y: cy,
				// Wind is nearly colourless to begin with, so it takes the team
				// strongly — a dash across the arena becomes a streak of your side.
				tint: teamTint(DASH_WIND_COLOR, f.team, TINT.strong),
				// Backwards against travel, with a little up-and-down spread.
				angle:
					dir > 0
						? [Math.PI * 0.8, Math.PI * 1.2]
						: [-Math.PI * 0.2, Math.PI * 0.2],
				speed: [60, 170],
				lifeMs: 240,
				scale: [0.9, 0],
				alpha: [0.35, 0],
			});
		}

		if (dashing) {
			f.dashEmitMs += dtMs;
			// 160ms of dash at ~34ms cadence is about four emissions, each a
			// couple of lines — enough to read as wind, not as confetti.
			if (f.dashEmitMs >= 34) {
				f.dashEmitMs = 0;
				this.particles.burst({
					texture: TEX.shard,
					count: 2,
					x: cx - dir * 26,
					// A height that wanders, so the stream reads as a band rather
					// than as one exact line through the body.
					y: cy + (Math.random() * 2 - 1) * 14,
					tint: teamTint(DASH_WIND_COLOR, f.team, TINT.strong),
					angle: dir > 0 ? [Math.PI - 0.35, Math.PI + 0.35] : [-0.35, 0.35],
					speed: [130, 300],
					lifeMs: 240,
					scale: [1.1, 0],
					alpha: [0.3, 0],
				});
			}
		}

		f.wasDashing = dashing;
	}

	/**
	 * The ultimate's charge aura: a violet flame around the fighter while the
	 * ultimate button is held and a cast is legal.
	 *
	 * The Dragon Ball tell — a power-up everybody in the room can see before it
	 * lands. The hold phase is the thrower's free preview of the arc; this is
	 * the room's half of that bargain, drawn on the *holding* fighter wherever
	 * they stand. The same violet as the aim arc, so the glow and the trajectory
	 * are recognisably one ability.
	 *
	 * Three layers, because the bright sky eats pure additive light: a **painted
	 * halo** gives the body of the glow its colour at any distance, a dense column
	 * of **painted motes** flows upward around the whole body, and a few additive
	 * sparks and streaks add the energy on top. Like every effect here it is
	 * driven from frame time and never read back by the simulation.
	 */
	private drawUltAura(
		f: FighterFx,
		holdingUlt: boolean,
		cx: number,
		cy: number,
		dtMs: number,
	) {
		if (!holdingUlt) {
			f.ultEmitMs = 0;
			f.ultGlowMs = 0;
			f.ultPulseFloor = -1;
			f.glow.visible = false;
			f.core.visible = false;
			return;
		}
		f.ultEmitMs += dtMs;
		f.ultGlowMs += dtMs;

		// Two halos, breathing together: a painted envelope that carries the
		// violet from across the arena and a small additive core hugging the body
		// like the inner fire of the flame. The pulse is what stops them reading
		// as static discs — the whole point of the aura is to draw the eye, and a
		// steady glow does not.
		// Two halos, breathing like a heartbeat: a painted envelope that carries
		// the violet from across the arena and a small additive core hugging the
		// body like the inner fire of the flame. The breath swings the glow from
		// nearly off to full — a steady glow reads as ambient, a pulsing one reads
		// as *imminent*. Each completed breath also sheds an expanding ring, so
		// the beat has an edge to it even in peripheral vision.
		const breath = Math.sin(f.ultGlowMs / 130);
		// The aura leans toward the side, gently. It is the room's warning that a
		// black hole is coming, and *whose* it is decides whether you run toward
		// the caster or away from where they are aiming — but the violet has to
		// stay violet, because violet is what "ultimate" means here.
		const auraTint = teamTint(VIOLET, f.team, TINT.subtle);
		f.glow.tint = auraTint;
		f.core.tint = auraTint;
		f.glow.visible = true;
		f.glow.position.set(cx, cy + 8);
		f.glow.scale.set(1.15 + 0.12 * breath);
		f.glow.alpha = 0.22 + 0.18 * breath;
		f.core.visible = true;
		f.core.position.set(cx, cy + 4);
		f.core.scale.set(0.62 + 0.06 * breath);
		f.core.alpha = 0.4 + 0.2 * breath;

		const pulse = Math.floor(f.ultGlowMs / (Math.PI * 2 * 130));
		if (pulse !== f.ultPulseFloor) {
			f.ultPulseFloor = pulse;
			this.ring(cx, cy + 10, auraTint, 1.5, 550, false);
		}

		if (f.ultEmitMs < ULT_AURA_EVERY_MS) return;
		f.ultEmitMs = 0;

		// The flame: vertical wisps, streaming upward from a spawn band across the
		// body. A shard texture rotated to point up is a tongue, not a diamond —
		// elongated, directional, the motion vocabulary an aura needs. Painted,
		// like the motes: over the bright sky only paint keeps its violet.
		for (let i = 0; i < 2; i++) {
			this.particles.burst({
				texture: TEX.shard,
				count: 1,
				x: cx + (Math.random() * 2 - 1) * 28,
				y: cy - 16 + Math.random() * 38,
				tint: auraTint,
				angle: [-Math.PI * 0.75, -Math.PI * 0.25],
				speed: [70, 190],
				lifeMs: 380,
				scale: [1.5, 0],
				alpha: [0.5, 0],
				blend: false,
				rotation: -Math.PI / 2,
			});
		}
		// Painted motes around the wisps: born small and faint, growing and
		// brightening as they rise, so the column has volume rather than being a
		// handful of lines.
		for (let i = 0; i < 4; i++) {
			this.particles.burst({
				texture: TEX.spark,
				count: 1,
				x: cx + (Math.random() * 2 - 1) * 34,
				y: cy - 22 + Math.random() * 48,
				tint: auraTint,
				angle: [-Math.PI * 0.7, -Math.PI * 0.3],
				speed: [25, 85],
				lifeMs: 620,
				scale: [0.7, 2.8],
				alpha: [0.08, 0.5],
				blend: false,
			});
		}
		// One additive spark per beat, so the column sparkles rather than sitting
		// as paint. Deliberately secondary — see the function comment.
		this.particles.burst({
			texture: TEX.spark,
			count: 1,
			x: cx + (Math.random() * 2 - 1) * 26,
			y: cy - 26 + Math.random() * 46,
			tint: auraTint,
			angle: [-Math.PI * 0.8, -Math.PI * 0.2],
			speed: [60, 160],
			lifeMs: 400,
			scale: [1, 0],
			alpha: [0.8, 0],
		});
	}

	private drawCharge(f: FighterFx, s: PlayerPosition, cx: number, cy: number) {
		if (s.chargeTimer <= 0 && !s.massiveReady) return;

		if (s.massiveReady) {
			// Armed: a steady bright pulse, so the threat is obvious to both players.
			this.particles.burst({
				texture: TEX.spark,
				count: 3,
				x: cx,
				y: cy,
				tint: teamTint(COLOR.massive, f.team, TINT.medium),
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
			tint: teamTint(COLOR.charge, f.team, TINT.strong),
			speed: [5, 25],
			lifeMs: 380,
			scale: [0.7, 0],
		});
	}

	private drawStun(f: FighterFx, s: PlayerPosition, cx: number, top: number) {
		if (s.stunTimer <= 0) return;
		const a = (s.stunTimer / 90) % (Math.PI * 2);
		this.particles.burst({
			texture: TEX.spark,
			count: 1,
			x: cx + Math.cos(a) * 16,
			y: top - 10 + Math.sin(a) * 5,
			tint: teamTint(COLOR.stun, f.team, TINT.strong),
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

	/**
	 * One sword impact, as judged by the server (or by the offline resolver).
	 *
	 * `attackerKey` decides the colour of everything this throws: an impact is the
	 * loudest thing that happens in a fight, and in a team match the first
	 * question about it is whose it was. The *victim* is who gets punched — those
	 * are deliberately two different fighters, and conflating them was already a
	 * bug once (see `Match.onMeleeEvent`).
	 */
	impact(event: ImpactEvent, victimKey?: string, attackerKey?: string) {
		const { move, outcome, x, y } = event;
		const heavy = move === "massive";
		// Looked up rather than created: an attacker this client has never drawn
		// has no effect record, and calling `fx()` here would leave a set of
		// sprites behind for every fighter that ever hit somebody off screen.
		const team = attackerKey
			? (this.fighters.get(attackerKey)?.team ?? null)
			: null;

		if (victimKey) {
			this.fx(victimKey).punch = heavy
				? 1
				: move === "slash3"
					? 0.85
					: move === "slash2"
						? 0.7
						: 0.55;
		}

		const sparks = (count: number, tint: number, speedMax = 320) =>
			this.particles.burst({
				texture: TEX.spark,
				count,
				x,
				y,
				// Half-way to the side's colour: far enough that a scrum of eight
				// fighters resolves into two colours of sparks, not so far that a
				// parry stops looking like a parry.
				tint: teamTint(tint, team, TINT.medium),
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
				tint: teamTint(tint, team, TINT.medium),
				speed: [140, 420],
				lifeMs: 480,
				scale: [1, 0.2],
				gravity: 600,
				spin: true,
			});

		switch (outcome) {
			case "blocked":
				sparks(10, COLOR.block);
				this.ring(x, y, teamTint(COLOR.block, team, TINT.medium), 0.5, 220);
				this.stage.startShake(70, 2);
				break;

			case "parried":
				// The biggest read in the game deserves the biggest tell.
				sparks(22, COLOR.parry);
				shards(14, COLOR.parry);
				this.ring(x, y, teamTint(COLOR.parry, team, TINT.medium), 1.3, 420);
				this.stage.startShake(180, 7);
				break;

			case "backstab":
				sparks(20, COLOR.backstab);
				shards(10, COLOR.backstab);
				this.ring(x, y, teamTint(COLOR.backstab, team, TINT.medium), 0.9, 320);
				this.stage.startShake(150, 5);
				break;

			default: {
				const tint = COLOR[move];
				const finisher = move === "slash3";
				sparks(heavy || finisher ? 26 : 12, tint, heavy ? 420 : 320);
				if (move !== "slash" && move !== "slash2") {
					shards(heavy ? 18 : 12, tint);
				}
				if (heavy || finisher) {
					this.ring(x, y, teamTint(tint, team, TINT.medium), 1.5, 460);
				}
				if (move === "uppercut") this.launchPlume(x, y, team);
				// The chain builds: each link shakes harder than the last, and the
				// finisher lands closer to a Massive than to the slash it started as.
				const links = { slash: 3, slash2: 5, slash3: 8 };
				const kick = links[move as keyof typeof links] ?? (heavy ? 9 : 3);
				this.stage.startShake(heavy ? 240 : 60 + kick * 20, kick);
				break;
			}
		}
	}

	/** An upward cone, sold as the target leaving the ground. */
	private launchPlume(x: number, y: number, team: TeamId | null) {
		this.particles.burst({
			texture: TEX.spark,
			count: 14,
			x,
			y,
			tint: teamTint(COLOR.uppercut, team, TINT.medium),
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
		blend = true,
	) {
		const sprite = new Sprite(tex(TEX.ring));
		sprite.anchor.set(0.5);
		sprite.position.set(x, y);
		sprite.tint = tint;
		// The aura's pulse ring is painted rather than added: over the bright
		// sky only paint keeps its violet, and the ring is the aura's most
		// readable element at a distance.
		if (blend) sprite.blendMode = "add";
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
			f.glow.visible = false;
			f.core.visible = false;
			f.punch = 0;
			f.dashEmitMs = 0;
			f.wasDashing = false;
			f.ultEmitMs = 0;
			f.ultGlowMs = 0;
			f.ultPulseFloor = -1;
			f.body?.scale.set(1);
		}
		this.particles.clear();
		for (const r of this.rings) r.sprite.destroy();
		this.rings.length = 0;
	}
}
