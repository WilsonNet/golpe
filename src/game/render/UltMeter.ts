/**
 * The ultimate charge meter.
 *
 * Screen space, in the HUD layer, so the camera never moves it — a meter that
 * scrolled with a wide arena would be unreadable exactly when a fight is
 * happening. Bottom-centre because that is where a player's eye already goes
 * between exchanges, and because the two numbers a player reads *during* one
 * (HP and frags) already own the top-left.
 *
 * Drawn with `Graphics` rather than baked, because the fill's width changes
 * every frame and a texture would have to be re-rasterised or scaled — and a
 * scaled bar has soft ends. Three redraws of four rectangles is nothing.
 */

import { Container, Graphics, Text } from "pixi.js";
import { ULT_MAX_CHARGE, ultReady } from "../simulation/Physics";

const WIDTH = 190;
const HEIGHT = 12;

/** Charging: cool and unobtrusive. Ready: the black hole's own violet. */
const FILL_CHARGING = 0x5a7fbf;
const FILL_READY = 0xa96bff;

export class UltMeter {
	private readonly node = new Container();
	private readonly bar = new Graphics();
	private readonly label: Text;

	private charge = 0;
	private pulseMs = 0;

	constructor(
		hud: Container,
		private readonly view: { readonly width: number; readonly height: number },
	) {
		this.label = new Text({
			text: "ULTIMATE",
			style: {
				fontFamily: "monospace",
				fontSize: 11,
				fill: 0xffffff,
				letterSpacing: 3,
			},
		});
		this.label.anchor.set(0.5, 1);
		this.node.addChild(this.bar, this.label);
		hud.addChild(this.node);
		this.layout();
	}

	/**
	 * Re-place against the current view size. Called on every draw: it is two
	 * writes.
	 *
	 * **Hard against the bottom edge**, not 34px up. The arena's ground is the
	 * lowest 32px of the world and fighters stand *on* it, so a meter one body
	 * height off the floor is drawn straight through their legs — which it was,
	 * and it made both the bar and the fighters harder to read at the exact moment
	 * the bar matters. Down here it sits on the ground band, below their feet.
	 */
	private layout() {
		this.node.position.set(
			Math.round(this.view.width / 2 - WIDTH / 2),
			Math.round(this.view.height - HEIGHT - 8),
		);
		this.label.position.set(WIDTH / 2, -3);
	}

	set(charge: number) {
		this.charge = Math.max(0, Math.min(ULT_MAX_CHARGE, charge));
	}

	/**
	 * What the bar was last *drawn* for. Redrawing is skipped when nothing about
	 * it has changed — see `update`.
	 */
	private drawnFor = Number.NaN;

	update(dtMs: number) {
		this.pulseMs += dtMs;
		this.layout();

		const ready = ultReady(this.charge);
		const fraction = this.charge / ULT_MAX_CHARGE;
		// A slow breath while armed, so a full meter is visible in peripheral vision
		// — which is the only vision it will get during a fight.
		const pulse = ready ? 0.75 + 0.25 * Math.sin(this.pulseMs / 220) : 1;

		// **Only redraw when the bar actually changes.**
		//
		// `Graphics.clear()` rebuilds the geometry, and this is a HUD element that
		// is on screen for the whole match: rebuilding five rectangles sixty times a
		// second to show a number that moves by 1.4 a second is a cost paid on every
		// frame of every match for nothing. While the meter is filling it changes
		// about once a second; while it is armed it breathes, so it redraws then and
		// only then. Rounded to a tenth, which is finer than the bar can express at
		// 190px wide.
		const key = ready ? -pulse : Math.round(fraction * 1000);
		if (key === this.drawnFor) return;
		this.drawnFor = key;

		this.bar.clear();
		// The well. Dark and opaque, so the bar is legible over both the sky and a
		// platform in a wide room.
		this.bar
			.rect(-2, -2, WIDTH + 4, HEIGHT + 4)
			.fill({ color: 0x000000, alpha: 0.55 });
		this.bar.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x11141f, alpha: 0.9 });

		if (fraction > 0) {
			this.bar
				.rect(0, 0, WIDTH * fraction, HEIGHT)
				.fill({ color: ready ? FILL_READY : FILL_CHARGING, alpha: pulse });
		}
		// A hairline along the top of the fill: the difference between a bar that
		// looks drawn and a bar that looks lit.
		if (fraction > 0.02) {
			this.bar
				.rect(0, 0, WIDTH * fraction, 2)
				.fill({ color: 0xffffff, alpha: 0.35 * pulse });
		}
		this.bar
			.rect(0, 0, WIDTH, HEIGHT)
			.stroke({ width: 1, color: ready ? FILL_READY : 0x000000, alpha: 0.85 });

		this.label.text = ready ? "ULTIMATE  READY" : "ULTIMATE";
		this.label.alpha = ready ? pulse : 0.5;
		this.label.style.fill = ready ? FILL_READY : 0xffffff;
	}

	destroy() {
		this.node.destroy({ children: true });
	}
}
