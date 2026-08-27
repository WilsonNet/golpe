/**
 * Floating damage numbers for the preview stage.
 *
 * The one bit of combat feedback a lone stage cannot borrow from the match:
 * a hit that lands should say how much it was, or a preview teaches the swing
 * without teaching what the swing is worth. Pooled `Text`s, a rise and a fade
 * — nothing here reads simulation state, it only announces what the stage's
 * server-half just applied.
 */

import { type Container, Text } from "pixi.js";

/** Total life of one number. Long enough to read, short enough to stack. */
const LIFE_MS = 700;
/** How long the number holds before the fade begins. */
const HOLD_MS = 280;
/** Rise speed, px/s — a soft float, not a jump. */
const RISE_PX_PER_S = 44;
/** Pool cap: a preview never has more than a few live at once. */
const MAX_LIVE = 12;

interface Pop {
	text: Text;
	ageMs: number;
}

export class HitNumbers {
	private readonly pool: Text[] = [];
	private readonly live: Pop[] = [];

	constructor(private readonly layer: Container) {}

	/** Announce one number at a world position. */
	pop(x: number, y: number, label: string, tint = 0xffe6a8): void {
		if (this.live.length >= MAX_LIVE) return;
		let text = this.pool.pop();
		if (!text) {
			text = new Text({
				text: "",
				style: {
					fontFamily: "monospace",
					fontSize: 14,
					fontWeight: "700",
					fill: 0xffffff,
					stroke: { color: 0x000000, width: 3 },
					letterSpacing: 1,
				},
			});
			text.anchor.set(0.5, 1);
			this.layer.addChild(text);
		}
		text.text = label;
		text.tint = tint;
		text.alpha = 1;
		text.scale.set(1);
		text.position.set(x, y - 40);
		text.visible = true;
		this.live.push({ text, ageMs: 0 });
	}

	update(dtMs: number): void {
		for (let i = this.live.length - 1; i >= 0; i--) {
			const pop = this.live[i];
			if (!pop) continue;
			pop.ageMs += dtMs;
			const t = pop.ageMs / LIFE_MS;
			if (t >= 1) {
				pop.text.visible = false;
				this.pool.push(pop.text);
				this.live.splice(i, 1);
				continue;
			}
			pop.text.y -= (RISE_PX_PER_S * dtMs) / 1000;
			// The punch: a quick overshoot on spawn, then the hold and fade.
			const punch = t < 0.12 ? 1.25 - t * 2 : 1;
			pop.text.scale.set(punch);
			pop.text.alpha =
				t < HOLD_MS / LIFE_MS
					? 1
					: 1 - (t - HOLD_MS / LIFE_MS) / (1 - HOLD_MS / LIFE_MS);
		}
	}

	reset(): void {
		for (const pop of this.live) {
			pop.text.visible = false;
			this.pool.push(pop.text);
		}
		this.live.length = 0;
	}

	destroy(): void {
		this.reset();
		for (const text of this.pool) text.destroy();
		this.pool.length = 0;
	}
}
