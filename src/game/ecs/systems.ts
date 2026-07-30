/**
 * Entity systems: plain functions over archetypes, run in a fixed order once a
 * frame.
 *
 * Every one of these reads the simulation and writes only to presentation. That
 * direction is the rule the whole architecture rests on — a system that wrote
 * back into `body` would be changing authoritative state outside `tickPlayer`,
 * and the client and server would immediately disagree.
 */

import { syncSpriteToBody } from "../render/ArenaRenderer";
import { dudeFrames } from "../render/assets";
import type { MeleeFx } from "../render/MeleeFx";
import type { Nameplates } from "../render/Nameplates";
import { PLAYER_WIDTH } from "../simulation/Physics";
import type { AnimState, Queries } from "./world";

/**
 * The `dude` strip has no atlas, so clips are frame ranges into it:
 * 0-3 walk left, 4 face-on, 5-8 walk right.
 */
export const CLIPS = {
	left: { frames: [0, 1, 2, 3], fps: 10 },
	right: { frames: [5, 6, 7, 8], fps: 10 },
	turn: { frames: [4], fps: 1 },
	"left-idle": { frames: [0], fps: 1 },
	"right-idle": { frames: [5], fps: 1 },
} as const;

/**
 * The clips that exist, as a type.
 *
 * `AnimState.clip` is this union rather than `string`, so a clip lookup can
 * never miss and a typo is a compile error instead of a sprite that silently
 * stops animating.
 */
export type ClipName = keyof typeof CLIPS;

export function playClip(anim: AnimState, clip: ClipName) {
	if (anim.clip === clip) return;
	anim.clip = clip;
	anim.frame = 0;
	anim.elapsedMs = 0;
}

/**
 * Pick each fighter's clip from simulation state, then advance it.
 *
 * Driven by velocity and facing rather than by input, so it works identically
 * for the locally predicted fighter and the interpolated remote one — the
 * remote has no input to read.
 */
export function animationSystem(queries: Queries, dtMs: number) {
	for (const e of queries.animated) {
		const body = e.body;
		const moving = Math.abs(body.vx) > 8;
		const facingLeft = body.facing < 0;

		playClip(
			e.anim,
			moving
				? facingLeft
					? "left"
					: "right"
				: facingLeft
					? "left-idle"
					: "right-idle",
		);

		const clip = CLIPS[e.anim.clip];
		e.anim.elapsedMs += dtMs;
		const frameMs = 1000 / clip.fps;
		while (e.anim.elapsedMs >= frameMs && clip.frames.length > 1) {
			e.anim.elapsedMs -= frameMs;
			e.anim.frame = (e.anim.frame + 1) % clip.frames.length;
		}

		const frameIndex = clip.frames[e.anim.frame] ?? clip.frames[0];
		const texture = dudeFrames[frameIndex];
		if (texture && e.sprite.texture !== texture) e.sprite.texture = texture;
	}
}

/**
 * Copy simulation positions onto sprites.
 *
 * Bodies are AABB top-left and sprites are centre-origin, so fighters go through
 * `syncSpriteToBody`. Assigning body coordinates straight to a sprite draws it
 * half a body from where it actually collides.
 */
export function spriteSyncSystem(queries: Queries) {
	for (const e of queries.drawnFighters) {
		// `renderPos` wins when present: it carries reconciliation smoothing, which
		// exists precisely so the sprite does not sit exactly on the body.
		const at = e.renderPos ?? e.body;
		syncSpriteToBody(e.sprite, at.x, at.y);
		// A dead fighter fades rather than vanishing, so a KO reads as a KO.
		e.sprite.alpha = e.fighter.hp <= 0 ? 0.3 : 1;
	}

	for (const e of queries.bullets) {
		e.sprite.position.set(e.position.x, e.position.y);
	}
}

/**
 * Draw each fighter's sword state — swing trail, blade, guard, charge, stun.
 *
 * Reads `PlayerPosition` directly, which is why the local fighter's effects are
 * predicted along with its state machine and appear on the frame the button was
 * pressed, while the remote's come from the authoritative snapshot. Neither path
 * needs animation logic of its own.
 */
export function meleeFxSystem(queries: Queries, fx: MeleeFx, dtMs: number) {
	for (const e of queries.fighters) {
		fx.updateFighter(e.fighter.id, e.body, dtMs);
	}
}

/**
 * Place each fighter's name and health bar.
 *
 * Reads the *drawn* position, not the body: a plate that used simulation state
 * while the sprite used a smoothed one would drift away from the fighter it
 * belongs to by exactly the correction the smoother is hiding.
 */
export function nameplateSystem(queries: Queries, plates: Nameplates) {
	for (const e of queries.drawnFighters) {
		const at = e.renderPos ?? e.body;
		plates.sync(
			e.fighter.id,
			at.x + PLAYER_WIDTH / 2,
			at.y,
			e.fighter.hp,
			e.fighter.maxHp,
			e.fighter.name,
			e.fighter.local,
		);
	}
}

/** Bind fighter sprites to the effects layer so impacts can punch their scale. */
export function bindFxBodies(queries: Queries, fx: MeleeFx) {
	for (const e of queries.drawnFighters) {
		fx.registerBody(e.fighter.id, e.sprite);
	}
}
