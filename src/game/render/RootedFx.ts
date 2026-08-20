/**
 * The "ROOTED!" splash: a jungle-board-game caption that pops over a fighter
 * the moment a trap catches them.
 *
 * The DENY splash is Frank Miller — stark black on white, a comic caption
 * announcing somebody's big moment was taken. A trap is not a moment being
 * taken, it is a hunter's snare closing, so this one is the Jumanji register
 * instead: heavy, beveled, jungle-green, the typography of a board that wants
 * you to play its game. Same life as a deny, same one-shot contract: the
 * consequence (the root — the mobility lock) is already in the victim's state;
 * this is the part a player gets to *see*.
 *
 * Presentation only, like everything in `render/`. World-space, on the
 * nameplates layer, above the actors.
 */

import { type Container, Text } from "pixi.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../simulation/Arena";

/** How long the caption lives, ms. The lock lasts 3s; the shout is one beat. */
const LIFETIME_MS = 1100;
/** The overshoot of the scale punch: 0.5 -> 1.2 -> 1.0. */
const PUNCH_SCALE = 1.25;
/** How far the caption floats up over its life, px. */
const RISE_PX = 30;
/** Max off-angle, radians — a caption that is always level is a label. */
const MAX_TILT = 0.12;
/** The pool's ceiling. */
const POOL_SIZE = 8;

interface Caption {
	text: Text;
	t: number;
	/** Where the caption started, world body space. */
	x: number;
	y: number;
	tilt: number;
}

const mkText = (): Text => {
	const text = new Text({
		text: "ROOTED!",
		style: {
			// The Jumanji register: heavy, condensed, beveled. What carries the
			// look is the weight and the layered green — the exact font falling
			// back gracefully is the same argument the DENY splash makes.
			fontFamily: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif",
			fontSize: 66,
			fontWeight: "900",
			// Jungle green, read against the teal sky and the dark ledges alike:
			// a colour no combat effect uses, so the caption can never be
			// mistaken for a damage number or a kill streak.
			fill: 0x2f7d3a,
			stroke: { color: 0x0c1a10, width: 12, join: "round" },
		},
	});
	text.anchor.set(0.5);
	text.visible = false;
	return text;
};

/**
 * One pooled, tilt-punched caption. Owned by `Match`, driven by the server's
 * `rooted` events — same shape as a deny, so a dropped datagram costs a
 * splash rather than a consequence.
 */
export class RootedFx {
	private pool: Text[] = [];
	private active: Caption[] = [];

	constructor(private readonly layer: Container) {}

	/** Play the splash at a world body position. */
	rooted(x: number, y: number) {
		const text =
			this.pool.pop() ?? (this.active.length < POOL_SIZE ? mkText() : null);
		if (!text) return;

		if (!text.parent) this.layer.addChild(text);
		this.active.push({
			text,
			t: 0,
			x,
			y,
			tilt: (Math.random() - 0.5) * 2 * MAX_TILT,
		});
	}

	/** Advance the captions; drop the dead ones back into the pool. */
	update(dtMs: number) {
		for (let i = this.active.length - 1; i >= 0; i--) {
			const c = this.active[i];
			if (!c) continue;
			c.t += dtMs;
			const p = Math.min(1, c.t / LIFETIME_MS);

			// The punch: overshoot early, settle late. Linear would read as a
			// popup; a punch reads as impact.
			const overshoot = 1.06 * (1 - p) * (1 - p);
			const scale = PUNCH_SCALE * overshoot + p * 0.9 + 0.1;
			c.text.scale.set(scale);

			// Rise fast, settle slow.
			const rise = RISE_PX * (1 - (1 - p) * (1 - p));
			c.text.position.set(
				c.x + PLAYER_WIDTH / 2,
				c.y + PLAYER_HEIGHT / 2 - 16 - rise,
			);
			c.text.rotation = c.tilt;

			// In fast, hold, out over the last third.
			const fade = p < 0.12 ? p / 0.12 : p > 0.66 ? (1 - p) / 0.34 : 1;
			c.text.alpha = Math.max(0, Math.min(1, fade));

			if (p >= 1) {
				c.text.visible = false;
				this.active.splice(i, 1);
				this.pool.push(c.text);
			} else {
				c.text.visible = true;
			}
		}
	}

	/** Throw every caption away — used on match reset, like the other effects. */
	reset() {
		for (const c of this.active) {
			c.text.visible = false;
			this.pool.push(c.text);
		}
		this.active.length = 0;
	}

	destroy() {
		this.reset();
		for (const text of this.pool) text.destroy();
		this.pool.length = 0;
	}
}
