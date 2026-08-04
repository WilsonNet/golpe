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
import { dudeFrames, rollFrames, TEX, tex } from "../render/assets";
import type { MeleeFx } from "../render/MeleeFx";
import type { Nameplates } from "../render/Nameplates";
import type { Shadows } from "../render/Shadows";
import { PLAYER_WIDTH } from "../simulation/Physics";
import { TINT, teamTint } from "../teamPalette";
import type { AnimState, Queries } from "./world";

/**
 * The `dude` strip has no atlas, so clips are frame ranges into it:
 * 0-3 walk left, 4 face-on, 5-8 walk right.
 *
 * `disabled` and `downed` are the exception: their frame lists are empty because
 * the textures are *generated* from this same strip rather than cut out of it,
 * and `animationSystem` assigns them directly. They are still clips so that being
 * hit goes through `playClip` like every other state — a fighter that came out of
 * a stun mid-walk-cycle used to resume on whatever frame it was interrupted on.
 *
 * The roll clips read the `roll` strip instead (`sheet: "roll"`): 0-7 roll
 * right, 8-15 roll left. Their 320ms loop is the tumble's own travel time —
 * 8 x 40ms at 25fps — so the roll spins exactly once per gesture.
 */
export const CLIPS = {
	left: { frames: [0, 1, 2, 3], fps: 10, sheet: "dude" },
	right: { frames: [5, 6, 7, 8], fps: 10, sheet: "dude" },
	turn: { frames: [4], fps: 1, sheet: "dude" },
	"left-idle": { frames: [0], fps: 1, sheet: "dude" },
	"right-idle": { frames: [5], fps: 1, sheet: "dude" },
	disabled: { frames: [], fps: 1, sheet: "dude" },
	downed: { frames: [], fps: 1, sheet: "dude" },
	helpless: { frames: [], fps: 1, sheet: "dude" },
	slam: { frames: [], fps: 1, sheet: "dude" },
	plunge: { frames: [], fps: 1, sheet: "dude" },
	stuck: { frames: [], fps: 1, sheet: "dude" },
	"roll-right": { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 25, sheet: "roll" },
	"roll-left": {
		frames: [8, 9, 10, 11, 12, 13, 14, 15],
		fps: 25,
		sheet: "roll",
	},
} as const;

/**
 * The clips that exist, as a type.
 *
 * `AnimState.clip` is this union rather than `string`, so a clip lookup can
 * never miss and a typo is a compile error instead of a sprite that silently
 * stops animating.
 *
 * Exported because Match picks its spawn-facing idle frames out of it — the
 * strip layout is owned here, and asking it for a frame beats re-declaring
 * the strip's indices in a second file.
 */
export type ClipName = keyof typeof CLIPS;

function playClip(anim: AnimState, clip: ClipName) {
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

		// Being hit outranks everything else the fighter could be drawn doing.
		//
		// Every sword hit disables its target, and for the whole of that stun the
		// fighter is not walking, idling or turning — it is reeling. Left to the
		// velocity-driven clips it kept playing the walk cycle while sliding
		// backwards on a knockback, which is why the sword read as landing on
		// nobody through an entire playtest.
		//
		// Above even the hit poses sit the two bomb states: the dive and the
		// plant after it. They are commitments, not reactions — nothing else may
		// interrupt them — so they draw over everything.
		if (body.plunging) {
			playClip(e.anim, "plunge");
			const plungeTex = tex(TEX.plunge);
			if (e.sprite.texture !== plungeTex) e.sprite.texture = plungeTex;
			continue;
		}
		if (body.plungeStuckTimer > 0) {
			playClip(e.anim, "stuck");
			const stuckTex = tex(TEX.stuck);
			if (e.sprite.texture !== stuckTex) e.sprite.texture = stuckTex;
			continue;
		}

		// Mid-massive: the fighter is committed to the slam for its whole 680ms
		// — rooted, so there is no walk cycle to show — and the lean is what
		// sells the blade coming down. The blade itself is drawn by `MeleeFx`;
		// this is the body that is doing the smashing.
		if (body.meleeAction === "massive") {
			playClip(e.anim, "slam");
			const slamTex = tex(TEX.slam);
			if (e.sprite.texture !== slamTex) e.sprite.texture = slamTex;
			continue;
		}

		const downed = body.knockdownTimer > 0;
		if (downed || body.stunTimer > 0) {
			// A guard break is drawn as its own helplessness — the sword raised
			// and useless — so the reward for a block is visible from across the
			// arena, not just to the two fighters doing it.
			const broken = body.guardBroken;
			playClip(e.anim, downed ? "downed" : broken ? "helpless" : "disabled");
			const hitTexture = tex(
				downed ? TEX.downed : broken ? TEX.helpless : TEX.disabled,
			);
			if (e.sprite.texture !== hitTexture) e.sprite.texture = hitTexture;
			continue;
		}

		// A tumble is its own clip, and it outranks the walk cycle for the whole
		// roll. The direction comes from `vx`, never from facing: a gunner can
		// roll away while still aiming back at the fighter chasing them, and the
		// roll's frames must follow the body, not the cursor.
		if (body.tumbleActiveTimer > 0) {
			playClip(e.anim, body.vx < 0 ? "roll-left" : "roll-right");
		} else {
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
		}

		const clip = CLIPS[e.anim.clip];
		e.anim.elapsedMs += dtMs;
		const frameMs = 1000 / clip.fps;
		while (e.anim.elapsedMs >= frameMs && clip.frames.length > 1) {
			e.anim.elapsedMs -= frameMs;
			e.anim.frame = (e.anim.frame + 1) % clip.frames.length;
		}

		// The hit clips carry no frames — they are assigned above and never reach
		// here — so a missing index means the strip, not the clip, is wrong.
		const frameIndex = clip.frames[e.anim.frame] ?? clip.frames[0];
		const frames = clip.sheet === "roll" ? rollFrames : dudeFrames;
		const texture = frameIndex === undefined ? undefined : frames[frameIndex];
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
		// The fighter themself wears their side, faintly.
		//
		// Faintly is the whole trick: the character sprite is one shared strip, so
		// this is the only mark that is on the *body* rather than near it — and it
		// is also the mark a player reads while looking at nothing in particular.
		// Pushed any further it stops being a fighter with a team colour and
		// becomes a blue fighter, which throws away the art. `TINT.subtle` on a
		// white multiplier leaves the sprite's own palette recognisable.
		e.sprite.tint = teamTint(0xffffff, e.fighter.team, TINT.subtle);
	}

	for (const e of queries.bullets) {
		e.sprite.position.set(e.position.x, e.position.y);
	}
}

/**
 * Draw each fighter's sword state — swing trail, blade, guard, charge, stun —
 * and the ultimate's charge aura while its button is held.
 *
 * Reads `PlayerPosition` directly, which is why the local fighter's effects are
 * predicted along with its state machine and appear on the frame the button was
 * pressed, while the remote's come from the authoritative snapshot. Neither path
 * needs animation logic of its own. The one thing `PlayerPosition` cannot carry
 * is the held ultimate button — that is input, and the wire keeps input and
 * state separate on purpose — so `holdingUlt` supplies it per fighter.
 */
export function meleeFxSystem(
	queries: Queries,
	fx: MeleeFx,
	dtMs: number,
	holdingUlt: (id: string) => boolean,
) {
	for (const e of queries.drawnFighters) {
		// A hidden fighter's sword is hidden too. The Play of the Game replay takes
		// fighters who are not in the clip off the screen while the live match
		// carries on predicting them underneath — and a swing trail from somebody
		// who is not on screen is the most confusing artefact a replay can have.
		if (!e.sprite.visible) continue;
		fx.updateFighter(
			e.fighter.id,
			e.body,
			dtMs,
			holdingUlt(e.fighter.id),
			e.fighter.team,
		);
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
		// Never label a fighter nobody can see. Hiding a sprite used to leave its
		// plate and health bar floating over empty arena, because the entity is
		// still in the query — the replay hides fighters the clip does not contain,
		// and that was the first thing it got visibly wrong.
		if (!e.sprite.visible) {
			plates.forget(e.fighter.id);
			continue;
		}
		const at = e.renderPos ?? e.body;
		plates.sync(
			e.fighter.id,
			at.x + PLAYER_WIDTH / 2,
			at.y,
			e.fighter.hp,
			e.fighter.maxHp,
			e.fighter.name,
			e.fighter.local,
			e.fighter.team,
		);
	}
}

/**
 * Cast a team-tinted shadow under every fighter.
 *
 * Reads the *drawn* position for the same reason the nameplates do — the
 * smoother deliberately offsets a sprite from its body, and a shadow anchored to
 * the body would slide out from under its own fighter by exactly that much.
 */
export function shadowSystem(queries: Queries, shadows: Shadows) {
	for (const e of queries.drawnFighters) {
		// Same rule as the nameplates: a shadow with no fighter over it is a stain
		// on the floor.
		if (!e.sprite.visible) {
			shadows.forget(e.fighter.id);
			continue;
		}
		const at = e.renderPos ?? e.body;
		shadows.sync(e.fighter.id, at.x, at.y, e.fighter.team, e.fighter.hp > 0);
	}
}

/** Bind fighter sprites to the effects layer so impacts can punch their scale. */
export function bindFxBodies(queries: Queries, fx: MeleeFx) {
	for (const e of queries.drawnFighters) {
		fx.registerBody(e.fighter.id, e.sprite);
	}
}
