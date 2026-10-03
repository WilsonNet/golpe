import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { CONTROL_PADS } from "../simulation/ControlMap";
import type { ControlStatus } from "../simulation/ControlPoints";
import type { TeamId } from "../simulation/Teams";
import { mixRgb, teamColor } from "../teamPalette";
import { TEX, tex } from "./assets";

/**
 * The five capture pads, drawn.
 *
 * Presentation only, like everything in `render/` — nothing here is ever read
 * back by the simulation, and everything runs on frame time, so no amount of it
 * can desync a match. The pads come from `CONTROL_PADS`, the same table the
 * capture logic reads, so **the drawn pad is the capture zone** and the art can
 * never lie about where standing counts.
 *
 * The read is an **objective**: a dark floor plate with a team-coloured rim and
 * a progress bar along its bottom edge, and a floating **medallion** above the
 * centre — a dark disc with a team-coloured ring and the point's letter,
 * bobbing gently. Ownership is the rim and the ring; the plate stays dark so
 * fighters and the letter read over it. The first version painted the whole
 * slab the owner's colour and hung a small monospace letter over it, which
 * looked like a debug label over a stain; the medallion is what gives the
 * letter a home.
 *
 * A pad answers four questions at a glance, in priority order:
 *
 * - **Who owns it** — the rim, the ring and the letter's medallion.
 * - **Can it even be taken yet** — a pad locked for both sides is behind the
 *   lines, and is drawn dim so it reads as furniture rather than as a place to
 *   walk.
 * - **Is somebody capturing it** — the attacker's bar grows along the plate's
 *   bottom. A contested pad (both sides on it) pulses its ring between the two
 *   colours instead, because a frozen bar drawn as a fill is a lie.
 * - **Where should I be going** — the point the local team can attack breathes,
 *   so a player can see the next objective from wherever the camera is.
 *
 * The pads sit at index 0 of `Stage.field`: above the arena, under the black
 * hole's core and every other field effect. A fighter stands *on* an objective,
 * and a hole swallows one.
 */

/** The neutral rim and ring: a cool grey, never white. */
const NEUTRAL = 0x9aa4b2;

/** The plate's floor tone and the emblem's disc. Near-black, translucent. */
const PLATE_FILL = 0x0c0f16;
const PLATE_ALPHA = 0.42;
const DISC_FILL = 0x0c0f16;
const DISC_ALPHA = 0.78;

/** How much of the plate the owner's wash covers, and the bar's height. */
const WASH_ALPHA = 0.15;
const NEUTRAL_WASH_ALPHA = 0.07;
const BAR_H = 5;

/** The local attackable point's breathing, in ms per cycle and alpha depth. */
const BREATH_MS = 1600;
const BREATH_DEPTH = 0.28;

/** The contested two-colour pulse: one full A-to-B-to-A cycle, ms. */
const CONTEST_MS = 1100;

/** The medallion's size, how high it floats, and its bob. */
const MEDAL_R = 15;
const MEDAL_LIFT = 32;
const MEDAL_BOB_PX = 3;
const MEDAL_BOB_MS = 1700;

/** A pad locked for both sides is behind the lines: drawn, but half-heartedly. */
const LOCKED_ALPHA = 0.4;

/** The letter: bold, white, outlined — the strongest read the game has. */
const LETTER_SIZE = 19;
const LETTER_STROKE = 4;

interface PadNode {
	container: Container;
	plate: Graphics;
	rim: Graphics;
	wash: Sprite;
	barBack: Sprite;
	barFill: Graphics;
	emblem: Container;
	glow: Sprite;
	disc: Graphics;
	ring: Graphics;
	label: Text;
	w: number;
	h: number;
}

export class ControlPointFx {
	private readonly root = new Container();
	private readonly pads: PadNode[] = [];
	/** Pulse clock, advanced by the frame delta — never wall time. */
	private timeMs = 0;

	constructor(layer: Container) {
		this.root.visible = false;
		// Index 0: under the hole's core and every other field effect, over the
		// arena. A pad is floor furniture, not a thing that can cover a fighter.
		layer.addChildAt(this.root, 0);

		CONTROL_PADS.forEach((pad, i) => {
			const container = new Container();
			container.position.set(pad.x, pad.y);

			// The floor plate: a dark slab with a team rim, so ownership reads
			// from the edge while the middle stays clear for the fight.
			const plate = new Graphics();
			plate.roundRect(0, 0, pad.w, pad.h, 9).fill({
				color: PLATE_FILL,
				alpha: PLATE_ALPHA,
			});
			const wash = new Sprite(Texture.WHITE);
			wash.position.set(5, 5);
			wash.width = pad.w - 10;
			wash.height = pad.h - 10;
			wash.tint = NEUTRAL;
			const rim = new Graphics();
			rim.roundRect(1.5, 1.5, pad.w - 3, pad.h - 3, 8).stroke({
				color: 0xffffff,
				width: 2.5,
			});

			// The capture bar: a dark channel along the bottom edge with the
			// attacker's colour filling it.
			const barBack = new Sprite(Texture.WHITE);
			barBack.position.set(7, pad.h - BAR_H - 4);
			barBack.width = pad.w - 14;
			barBack.height = BAR_H;
			barBack.tint = 0x000000;
			barBack.alpha = 0.45;
			barBack.visible = false;
			const barFill = new Graphics();
			barFill.visible = false;

			// The medallion: a dark disc, a team ring and the letter, floating
			// above the plate's centre and bobbing on the render clock.
			const emblem = new Container();
			emblem.position.set(pad.w / 2, -MEDAL_LIFT);
			const glow = new Sprite(tex(TEX.halo));
			glow.anchor.set(0.5);
			glow.blendMode = "add";
			glow.tint = NEUTRAL;
			glow.alpha = 0.16;
			glow.scale.set((MEDAL_R * 2 + 10) / 64);
			const disc = new Graphics();
			disc.circle(0, 0, MEDAL_R).fill({
				color: DISC_FILL,
				alpha: DISC_ALPHA,
			});
			const ring = new Graphics();
			ring.circle(0, 0, MEDAL_R).stroke({ color: 0xffffff, width: 2.5 });
			const label = new Text({
				text: String.fromCharCode(65 + i),
				style: {
					fontFamily: ["Arial Black", "Arial", "sans-serif"],
					fontSize: LETTER_SIZE,
					fontWeight: "900",
					fill: 0xffffff,
					stroke: { color: 0x0a0d13, width: LETTER_STROKE },
					dropShadow: {
						color: 0x000000,
						alpha: 0.55,
						blur: 2,
						distance: 1.5,
						angle: Math.PI / 2,
					},
				},
			});
			label.anchor.set(0.5);
			label.y = 1;
			emblem.addChild(glow, disc, ring, label);

			container.addChild(plate, wash, rim, barBack, barFill, emblem);
			this.root.addChild(container);
			this.pads.push({
				container,
				plate,
				rim,
				wash,
				barBack,
				barFill,
				emblem,
				glow,
				disc,
				ring,
				label,
				w: pad.w,
				h: pad.h,
			});
		});
	}

	/**
	 * Place every pad's state for this frame.
	 *
	 * `control` is null outside 5CP — free-for-all, team deathmatch, training,
	 * and the Play of the Game replay — and the whole layer hides: the classic
	 * arena has no pads to own, and the clip records no line.
	 */
	update(control: ControlStatus | null, myTeam: TeamId | null, dtMs: number) {
		if (!control) {
			this.root.visible = false;
			return;
		}
		this.root.visible = true;
		this.timeMs += dtMs;

		for (let i = 0; i < this.pads.length; i++) {
			const pad = this.pads[i];
			const point = control.points[i];
			if (!pad) continue;
			if (!point) {
				pad.container.visible = false;
				continue;
			}
			pad.container.visible = true;

			// The point the local side can actually take breathes. This is the
			// discoverability layer: the map teaches the push without a HUD arrow.
			const canAttack =
				myTeam !== null &&
				point.owner !== myTeam &&
				point.unlocked[myTeam] === true;
			const breath = canAttack
				? 1 - BREATH_DEPTH * (0.5 + 0.5 * Math.sin((this.timeMs / BREATH_MS) * Math.PI * 2))
				: 1;

			// A locked pad is neither side's next objective: dim it. The line has
			// to be readable in both directions.
			const locked = !point.unlocked[0] && !point.unlocked[1];
			pad.container.alpha = (locked ? LOCKED_ALPHA : 1) * breath;

			// Contested: the two sides are arguing and the bar is frozen, so the
			// rim and the ring pulse between the colours rather than filling.
			const contestMix = 0.5 + 0.5 * Math.sin((this.timeMs / CONTEST_MS) * Math.PI * 2);
			const accent = point.contested
				? mixRgb(teamColor(0), teamColor(1), contestMix)
				: point.owner === null
					? NEUTRAL
					: teamColor(point.owner);
			pad.rim.tint = accent;
			pad.ring.tint = accent;
			pad.glow.tint = accent;
			pad.glow.alpha = 0.13 + 0.05 * contestMix;
			pad.wash.tint = point.owner === null ? NEUTRAL : teamColor(point.owner);
			pad.wash.alpha = point.owner === null ? NEUTRAL_WASH_ALPHA : WASH_ALPHA;

			// The medallion floats: a slow bob, so the objective reads as alive
			// even when nothing is happening on it.
			pad.emblem.y =
				-MEDAL_LIFT +
				Math.sin((this.timeMs / MEDAL_BOB_MS) * Math.PI * 2) * MEDAL_BOB_PX;

			// Progress: the attacker's bar while one side is alone on the pad.
			// Contested is not progress, so it never draws this.
			const capturing =
				point.attacker !== null && point.progress > 0 && !point.contested;
			pad.barBack.visible = capturing;
			pad.barFill.visible = capturing;
			if (capturing && point.attacker !== null) {
				const width = (pad.w - 14) * Math.max(0, Math.min(1, point.progress));
				pad.barFill.clear();
				pad.barFill
					.roundRect(7, pad.h - BAR_H - 4, width, BAR_H, BAR_H / 2)
					.fill({ color: teamColor(point.attacker) });
			}
		}
	}
}
