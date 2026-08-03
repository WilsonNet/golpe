/**
 * The "DENY" splash: a comic-book typography that pops over the fighter who
 * denied an ultimate.
 *
 * Two ways to deny, one splash: kill a fighter while they hold the button, or
 * catch the thrown grenade on a sword guard. The consequence (the meter) is
 * gone server-side; this is the part a player gets to *see*, so it is allowed
 * to be loud — heavy, italic, off-angle, exactly the way a comic caption
 * announces that somebody's big moment just got taken from them.
 *
 * Presentation only, like everything in `render/`. It is world-space and sits
 * on the nameplates layer, above the actors, because a caption buried behind
 * a sprite is worse than no caption.
 */

import { type Container, Text } from "pixi.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../simulation/Arena";

/** How long the caption lives, ms. */
const LIFETIME_MS = 1000;
/** The overshoot of the scale punch: 0.5 -> 1.2 -> 1.0. */
const PUNCH_SCALE = 1.2;
/** How far the caption floats up over its life, px. */
const RISE_PX = 26;
/** Max off-angle, radians — a caption that is always level is a label, not a splash. */
const MAX_TILT = 0.14;
/** The pool's ceiling; eight simultaneous denies is a brawl nobody could read anyway. */
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
		text: "DENY",
		style: {
			// Heavy, condensed, italic: the comic-caption register. The stack
			// falls back gracefully — what carries the look is the weight, the
			// outline and the tilt, not the exact font.
			fontFamily: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif",
			fontSize: 72,
			fontStyle: "italic",
			fontWeight: "900",
			// Black on a white outline: the starkest pair there is, readable
			// against the bright sky and the dark ledges alike, and it owes
			// nothing to the combat colours that already mean something here.
			fill: 0x0a0a0f,
			stroke: { color: 0xffffff, width: 10, join: "round" },
		},
	});
	text.anchor.set(0.5);
	text.visible = false;
	return text;
};

/**
 * One pooled, tilt-punched caption. Owned by `Match`, driven by the server's
 * `denies` events — same shape as a melee impact, so a dropped datagram costs
 * a splash rather than a consequence.
 */
export class DenyFx {
	private pool: Text[] = [];
	private active: Caption[] = [];

	constructor(private readonly layer: Container) {}

	/** Play the splash at a world body position. */
	deny(x: number, y: number) {
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
				c.y + PLAYER_HEIGHT / 2 - 10 - rise,
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
