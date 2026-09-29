/**
 * The five capture pads, drawn: the physical objectives of a control match.
 *
 * Presentation only, like everything in `render/` — nothing here is ever read
 * back by the simulation, and everything runs on frame time, so no amount of it
 * can desync a match. The pads come from `CONTROL_PADS`, the same table the
 * capture logic reads, so **the drawn pad is the capture zone** and the art can
 * never lie about where standing counts.
 *
 * A pad answers four questions at a glance, in priority order:
 *
 * - **Who owns it** — the slab is the owner's colour, or a neutral grey.
 * - **Can it even be taken yet** — a pad locked for both sides is behind the
 *   lines, and is drawn dimmer so it reads as furniture rather than as a place
 *   to walk.
 * - **Is somebody capturing it** — the attacker's fill grows across the pad.
 *   A contested pad (both sides on it) pulses between the sides' two colours
 *   instead, because a frozen bar drawn as a fill is a lie.
 * - **Where should I be going** — the point the local team can attack breathes,
 *   so a player can see the next objective from wherever the camera is.
 *
 * The pads sit at index 0 of `Stage.field`: above the arena, under the black
 * hole's core and every other field effect. A fighter stands *on* an objective,
 * and a hole swallows one.
 */

import { Container, Sprite, Text, Texture } from "pixi.js";
import { CONTROL_PADS } from "../simulation/ControlMap";
import type { ControlStatus } from "../simulation/ControlPoints";
import type { TeamId } from "../simulation/Teams";
import { mixRgb, teamColor } from "../teamPalette";

/** The slab while nobody owns the point — neutral grey, never white. */
const NEUTRAL_TINT = 0x8f99a8;

/** Slab alpha owned and neutral. A fighter has to read over it. */
const OWNED_ALPHA = 0.34;
const NEUTRAL_ALPHA = 0.2;

/** A pad locked for both sides is behind the lines: drawn, but half-heartedly. */
const LOCKED_SCALE = 0.45;

/** The local attackable point's breathing, in ms per cycle and alpha depth. */
const BREATH_MS = 1600;
const BREATH_DEPTH = 0.3;

/** The contested two-colour pulse: one full A-to-B-to-A cycle, ms. */
const CONTEST_MS = 1100;
/** Floor and swing of the contested pulse's alpha. */
const CONTEST_ALPHA = 0.25;
const CONTEST_DEPTH = 0.18;

/** The fill's alpha, so the slab still reads through the attacker's colour. */
const FILL_ALPHA = 0.66;

/** The letter above the pad. Black stroke, like every world label. */
const LETTER_STYLE = {
	fontFamily: "monospace",
	fontSize: 15,
	fontWeight: "bold",
	stroke: { color: 0x000000, width: 3 },
} as const;
/** How far above the pad's top edge the letter's baseline sits. */
const LETTER_LIFT = 6;

/** The letter above a neutral pad; an owned pad is lettered in its side's colour. */
const LETTER_NEUTRAL = 0xffffff;

interface PadNode {
	readonly container: Container;
	readonly base: Sprite;
	readonly fill: Sprite;
	readonly contest: Sprite;
	readonly label: Text;
	readonly w: number;
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

			const base = new Sprite(Texture.WHITE);
			base.width = pad.w;
			base.height = pad.h;
			base.tint = NEUTRAL_TINT;

			// Left-origin and full height: the bar grows across the pad the way
			// the capture does, and the slab underneath still reads as the owner.
			const fill = new Sprite(Texture.WHITE);
			fill.height = pad.h;
			fill.alpha = FILL_ALPHA;
			fill.visible = false;

			const contest = new Sprite(Texture.WHITE);
			contest.width = pad.w;
			contest.height = pad.h;
			contest.visible = false;

			const label = new Text({
				text: String.fromCharCode(65 + i),
				style: { ...LETTER_STYLE },
			});
			label.anchor.set(0.5, 1);
			label.position.set(pad.w / 2, -LETTER_LIFT);

			container.addChild(base, fill, contest, label);
			this.root.addChild(container);
			this.pads.push({ container, base, fill, contest, label, w: pad.w });
		});
	}

	/**
	 * Place every pad's state for this frame.
	 *
	 * `control` is null outside 5CP — free-for-all, team deathmatch, training —
	 * and the whole layer hides: the classic arena has no pads to own.
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
			const phase = (this.timeMs / BREATH_MS) * Math.PI * 2;
			const breath = canAttack
				? 1 - BREATH_DEPTH * (0.5 + 0.5 * Math.sin(phase))
				: 1;

			// A locked pad is neither side's next objective. Dimmed, not hidden:
			// the line has to be readable in both directions.
			const locked = !point.unlocked[0] && !point.unlocked[1];
			const base =
				(point.owner === null ? NEUTRAL_ALPHA : OWNED_ALPHA) *
				(locked ? LOCKED_SCALE : 1);

			pad.base.tint =
				point.owner === null ? NEUTRAL_TINT : teamColor(point.owner);
			pad.base.alpha = base * breath;
			pad.label.tint =
				point.owner === null ? LETTER_NEUTRAL : teamColor(point.owner);
			pad.label.alpha = breath;

			// Progress: the attacker's bar while one side is alone on the pad.
			// Contested is not progress, so it never draws this.
			const capturing =
				point.attacker !== null && point.progress > 0 && !point.contested;
			pad.fill.visible = capturing;
			if (capturing) {
				pad.fill.width = pad.w * Math.max(0, Math.min(1, point.progress));
				pad.fill.tint = teamColor(point.attacker);
			}

			// A contested pad is a slow two-colour pulse: the sides are arguing
			// and the bar is frozen, so the pulse says "argument", not "capture".
			pad.contest.visible = point.contested;
			if (point.contested) {
				const contestPhase = (this.timeMs / CONTEST_MS) * Math.PI * 2;
				const mix = 0.5 + 0.5 * Math.sin(contestPhase);
				pad.contest.tint = mixRgb(teamColor(0), teamColor(1), mix);
				pad.contest.alpha = CONTEST_ALPHA + CONTEST_DEPTH * (1 - mix);
			}
		}
	}
}
