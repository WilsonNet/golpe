/**
 * The local fighter's aim, drawn as a line out of its chest.
 *
 * **A mouse player already has this and never notices.** The cursor *is* the
 * reticle: it sits at the place being aimed at, so the answer to "where am I
 * pointing" is on screen at all times. A controller has no cursor — a stick gives
 * a direction, not a place — so before this existed the only feedback for the
 * whole two-layer aim in `input/Aim.ts` was which way the sprite happened to be
 * facing, and facing is one bit. Eight Contra directions and a full 360° of fine
 * aim all collapsed into "left or right".
 *
 * The fine layer was the worst of it: the entire point of the right stick is
 * aiming somewhere other than where you are running, and *that is exactly the
 * case facing cannot show*.
 *
 * So the line is drawn only in controller mode. Adding it to mouse mode would be
 * a second reticle a few hundred pixels from the real one.
 *
 * Presentation only, like everything in `render/`. Nothing here is read back.
 */

import { type Container, Graphics } from "pixi.js";

/** How far the beam reaches. Long enough to read the angle, short of a laser sight. */
const LENGTH = 104;
/** Where the beam starts, so it leaves the fighter rather than its middle. */
const INSET = 12;
/** The dot on the end. It is what makes an angle readable at a glance. */
const TIP_RADIUS = 3;

/**
 * Gold for the eight-direction Contra aim, cyan while the fine stick overrides.
 *
 * The colour *is* the feedback for the handover. `#0ec3c9` is the same "this is
 * live" cyan the scoreboard and the deck's thumb nub already use, so a player
 * who has seen one has seen all three — and watching it fade back to gold is how
 * the 900ms hold and the 260ms ease stop being invisible timings.
 */
const CONTRA = 0xffd166;
const FINE = 0x0ec3c9;

/** How fast the beam fades in and out, in alpha per millisecond. */
const FADE_PER_MS = 1 / 140;
const MAX_ALPHA = 0.85;

/** Blend two packed RGB colours. */
function mixRgb(from: number, to: number, t: number): number {
	const f = Math.max(0, Math.min(1, t));
	const r =
		((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * f;
	const g =
		((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * f;
	const b = (from & 0xff) + ((to & 0xff) - (from & 0xff)) * f;
	return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export class AimLine {
	private readonly gfx = new Graphics();
	private alpha = 0;
	/** Last geometry drawn, so a still fighter is not re-tessellated every frame. */
	private drawn = { x: 0, y: 0, angle: 0, blend: -1, alpha: -1 };

	constructor(layer: Container) {
		layer.addChild(this.gfx);
	}

	/**
	 * Place the beam for this frame.
	 *
	 * `centreX`/`centreY` are **drawn** coordinates, the same ones the sprite and
	 * the nameplate use — never the body. The render smoother deliberately offsets
	 * a sprite from its simulation state to hide a correction, and a beam growing
	 * out of the body would visibly detach from the fighter it belongs to by
	 * exactly the amount that smoothing is hiding.
	 *
	 * `blend` is the aim controller's handover, 0 (Contra) to 1 (fine stick).
	 */
	update(
		dtMs: number,
		visible: boolean,
		centreX: number,
		centreY: number,
		angle: number,
		blend: number,
	) {
		const target = visible ? MAX_ALPHA : 0;
		// Faded rather than toggled: switching aiming scheme mid-match, or dying and
		// respawning, should not pop a bright line on and off.
		this.alpha =
			this.alpha < target
				? Math.min(target, this.alpha + dtMs * FADE_PER_MS * MAX_ALPHA)
				: Math.max(target, this.alpha - dtMs * FADE_PER_MS * MAX_ALPHA);

		this.gfx.alpha = this.alpha;
		this.gfx.visible = this.alpha > 0.01;
		if (!this.gfx.visible) return;

		if (
			this.drawn.x === centreX &&
			this.drawn.y === centreY &&
			this.drawn.angle === angle &&
			this.drawn.blend === blend
		) {
			return;
		}
		this.drawn = { x: centreX, y: centreY, angle, blend, alpha: this.alpha };

		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		const x0 = centreX + cos * INSET;
		const y0 = centreY + sin * INSET;
		const x1 = centreX + cos * LENGTH;
		const y1 = centreY + sin * LENGTH;
		const colour = mixRgb(CONTRA, FINE, blend);

		// Rebuilt rather than transformed. A rotated Graphics would rotate the line
		// *cap* too, and the tip dot with it — and the geometry is four commands.
		this.gfx.clear();

		// A soft outer stroke under a bright core: over a sky-blue arena a single
		// thin line disappears, and an outline is cheaper than a filter.
		this.gfx
			.moveTo(x0, y0)
			.lineTo(x1, y1)
			.stroke({ width: 4.5, color: 0x000000, alpha: 0.32, cap: "round" });
		this.gfx
			.moveTo(x0, y0)
			.lineTo(x1, y1)
			.stroke({ width: 2, color: colour, alpha: 0.85, cap: "round" });
		this.gfx
			.circle(x1, y1, TIP_RADIUS + 1)
			.fill({ color: 0x000000, alpha: 0.32 });
		this.gfx.circle(x1, y1, TIP_RADIUS).fill({ color: colour, alpha: 1 });
	}

	/** Hide it immediately — a respawn, or a match reset. */
	reset() {
		this.alpha = 0;
		this.gfx.alpha = 0;
		this.gfx.visible = false;
		this.gfx.clear();
		this.drawn = { x: 0, y: 0, angle: 0, blend: -1, alpha: -1 };
	}

	destroy() {
		this.gfx.destroy();
	}
}
