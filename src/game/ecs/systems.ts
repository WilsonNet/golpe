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
import {
	heroFrames,
	heroPose,
	heroRollFrames,
	sheetScale,
	TEX,
} from "../render/assets";
import type { MeleeFx } from "../render/MeleeFx";
import type { Nameplates } from "../render/Nameplates";
import type { Shadows } from "../render/Shadows";
import { HEROES, type HeroId } from "../simulation/Heroes";
import { meleePhase } from "../simulation/Melee";
import { PLAYER_WIDTH } from "../simulation/Physics";
import { BLOSSOM_SPIN_RAD_PER_MS } from "../simulation/Ultimate";
import { TINT, teamTint } from "../teamPalette";
import type { AnimState, Queries } from "./world";

/**
 * A clip: a frame range into a strip, at a cadence.
 *
 * `sheet` is *relative* for the two shared layouts — `"dude"` means "the
 * hero's own character strip" and `"roll"` means "the hero's own roll strip"
 * — and concrete for a strip that belongs to one hero (Anands' dragon).
 * `frames` may be empty: that clip is a *generated pose* (disabled, downed,
 * the sword states) drawn from the face-on frame rather than cut from the
 * strip, and `driveClip` assigns its texture directly.
 */
export interface Clip {
	frames: readonly number[];
	fps: number;
	sheet: string;
}

/**
 * The default clips — the `dude` strip's layout, which every generated hero
 * shares: 0-3 walk left, 4 face-on, 5-8 walk right.
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
const CLIPS = {
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
	// The dagger's own poses — generated per hero, like the hit poses.
	"thrust-windup": { frames: [], fps: 1, sheet: "dude" },
	"thrust-dash": { frames: [], fps: 1, sheet: "dude" },
	shoryuken: { frames: [], fps: 1, sheet: "dude" },
	dragon: { frames: [], fps: 1, sheet: "dude" },
	// The dagger's left-facing variants of the same moves.
	"thrust-windup-left": { frames: [], fps: 1, sheet: "dude" },
	"thrust-dash-left": { frames: [], fps: 1, sheet: "dude" },
	"shoryuken-left": { frames: [], fps: 1, sheet: "dude" },
	// The stab, and the gun stance's own walk of clips. The generated heroes
	// never play them — they exist so the clip union is total.
	stab: { frames: [4], fps: 1, sheet: "dude" },
	"stab-left": { frames: [4], fps: 1, sheet: "dude" },
	"gun-hold": { frames: [4], fps: 1, sheet: "dude" },
	"gun-hold-left": { frames: [4], fps: 1, sheet: "dude" },
	"gun-fire": { frames: [4], fps: 1, sheet: "dude" },
	"gun-fire-left": { frames: [4], fps: 1, sheet: "dude" },
	"gun-run": { frames: [4], fps: 1, sheet: "dude" },
	"gun-run-left": { frames: [4], fps: 1, sheet: "dude" },
	"roll-right": { frames: [0, 1, 2, 3, 4, 5, 6, 7], fps: 25, sheet: "roll" },
	"roll-left": {
		frames: [8, 9, 10, 11, 12, 13, 14, 15],
		fps: 25,
		sheet: "roll",
	},
} as const satisfies Record<string, Clip>;

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

/**
 * Anands' own clip table — the hand-drawn sheets are her format, not the
 * generated heroes'. Her character strip (see `scripts/make-anands-art.py`)
 * is 35 cells of 168x152; every directional move is stored facing both ways,
 * exactly like the walk cycle halves always have been.
 *
 * The dagger's moves and the gun stance's walk each get left/right variants;
 * the damage poses are rear-facing, so they serve both directions. The
 * dragon clip reads her own ride strip, `anands-dragon`.
 */
const HERO_CLIPS: Partial<Record<HeroId, Partial<Record<ClipName, Clip>>>> = {
	anands: {
		left: { frames: [5, 6, 7, 8], fps: 10, sheet: TEX.anands },
		right: { frames: [0, 1, 2, 3], fps: 10, sheet: TEX.anands },
		turn: { frames: [4], fps: 1, sheet: TEX.anands },
		"left-idle": { frames: [10], fps: 1, sheet: TEX.anands },
		"right-idle": { frames: [9], fps: 1, sheet: TEX.anands },
		disabled: { frames: [33, 34], fps: 8, sheet: TEX.anands },
		downed: { frames: [34], fps: 1, sheet: TEX.anands },
		"thrust-windup": { frames: [29], fps: 1, sheet: TEX.anands },
		"thrust-windup-left": { frames: [31], fps: 1, sheet: TEX.anands },
		"thrust-dash": { frames: [30], fps: 1, sheet: TEX.anands },
		"thrust-dash-left": { frames: [32], fps: 1, sheet: TEX.anands },
		shoryuken: { frames: [23, 24, 25], fps: 14, sheet: TEX.anands },
		"shoryuken-left": { frames: [26, 27, 28], fps: 14, sheet: TEX.anands },
		stab: { frames: [19, 20], fps: 20, sheet: TEX.anands },
		"stab-left": { frames: [21, 22], fps: 20, sheet: TEX.anands },
		"gun-hold": { frames: [11], fps: 1, sheet: TEX.anands },
		"gun-hold-left": { frames: [12], fps: 1, sheet: TEX.anands },
		"gun-fire": { frames: [11, 13], fps: 12, sheet: TEX.anands },
		"gun-fire-left": { frames: [12, 14], fps: 12, sheet: TEX.anands },
		"gun-run": { frames: [15, 16], fps: 10, sheet: TEX.anands },
		"gun-run-left": { frames: [17, 18], fps: 10, sheet: TEX.anands },
		dragon: {
			frames: [0, 1, 2, 3, 4, 5],
			fps: 10,
			sheet: TEX["anands-dragon"],
		},
	},
};

/**
 * The clip a hero plays for a state: the hero's own table wins, the default
 * layout (the generated heroes) is the fallback.
 */
function clipFor(hero: HeroId, name: ClipName): Clip {
	return HERO_CLIPS[hero]?.[name] ?? CLIPS[name];
}

/**
 * The texture set a clip's indices index into, for this fighter's hero.
 *
 * `"dude"` resolves to the hero's own character strip and `"roll"` to the
 * hero's own roll strip, so a clip written against the shared layout slices
 * any generated hero's sheet; a concrete sheet name (`anands-dragon`) is the
 * strip itself. This is the one place a hero's sheet name becomes a texture
 * set.
 */
function stripFor(hero: HeroId, sheet: string): ReturnType<typeof heroFrames> {
	if (sheet === "dude") return heroFrames(HEROES[hero].sheet);
	if (sheet === "roll") return heroRollFrames(`${HEROES[hero].sheet}-roll`);
	return heroFrames(sheet);
}

type PoseKey =
	| "disabled"
	| "downed"
	| "helpless"
	| "slam"
	| "plunge"
	| "stuck"
	| "thrustWindup"
	| "thrustDash"
	| "shoryukenRise"
	| "dragonRide";

/**
 * The generated pose a clip falls back to when its frame list is empty.
 *
 * The generated heroes' hit states and dagger poses are still textures baked
 * from the face-on frame, not frame lists — see `createHeroPoses`. A hero
 * whose clip table replaced a pose with real art (Anands: disabled, the
 * thrust, the shoryuken, the ride) never reaches this map for that clip.
 */
const POSE_BY_CLIP: Record<ClipName, PoseKey> = {
	left: "disabled",
	right: "disabled",
	turn: "disabled",
	"left-idle": "disabled",
	"right-idle": "disabled",
	disabled: "disabled",
	downed: "downed",
	helpless: "helpless",
	slam: "slam",
	plunge: "plunge",
	stuck: "stuck",
	"thrust-windup": "thrustWindup",
	"thrust-dash": "thrustDash",
	shoryuken: "shoryukenRise",
	dragon: "dragonRide",
	"thrust-windup-left": "thrustWindup",
	"thrust-dash-left": "thrustDash",
	"shoryuken-left": "shoryukenRise",
	stab: "thrustDash",
	"stab-left": "thrustDash",
	"gun-hold": "disabled",
	"gun-hold-left": "disabled",
	"gun-fire": "disabled",
	"gun-fire-left": "disabled",
	"gun-run": "disabled",
	"gun-run-left": "disabled",
	"roll-right": "disabled",
	"roll-left": "disabled",
};

/**
 * The generated pose texture for this fighter's hero.
 *
 * `heroPose` falls back to the dude's pose when one was not generated for the
 * hero — every hero gets the same ten poses, because they are all derived from
 * whatever sheet the hero actually ships with.
 */
function poseFor(hero: HeroId, pose: PoseKey) {
	return heroPose(HEROES[hero].sheet, pose);
}

function playClip(anim: AnimState, clip: ClipName) {
	if (anim.clip === clip) return;
	anim.clip = clip;
	anim.frame = 0;
	anim.elapsedMs = 0;
}

/**
 * Play one clip on a fighter: assign the pose texture when the clip is a
 * generated pose, otherwise advance the frame clock and swap in the strip
 * frame. The one place a clip becomes a texture, whatever the hero.
 */
function driveClip(
	anim: AnimState,
	sprite: { texture: unknown },
	hero: HeroId,
	name: ClipName,
	dtMs: number,
) {
	playClip(anim, name);
	const clip = clipFor(hero, name);
	if (clip.frames.length === 0) {
		const pose = poseFor(hero, POSE_BY_CLIP[name]);
		if (sprite.texture !== pose) sprite.texture = pose;
		return;
	}
	anim.elapsedMs += dtMs;
	const frameMs = 1000 / clip.fps;
	while (anim.elapsedMs >= frameMs && clip.frames.length > 1) {
		anim.elapsedMs -= frameMs;
		anim.frame = (anim.frame + 1) % clip.frames.length;
	}

	// The hit clips carry no frames — they are assigned above and never reach
	// here — so a missing index means the strip, not the clip, is wrong.
	const frameIndex = clip.frames[anim.frame] ?? clip.frames[0];
	const frames = stripFor(hero, clip.sheet);
	const texture = frameIndex === undefined ? undefined : frames[frameIndex];
	if (texture && sprite.texture !== texture) sprite.texture = texture;
}

/**
 * The ammo level per fighter, as of the last frame — the machine gun's
 * muzzle-flash clip is driven by *firing*, and firing is an ammo decrease.
 * Keyed by fighter id because the ids are stable across respawns.
 */
const lastAmmo = new Map<string, number>();

/** Did this fighter's magazine drop since the last frame? */
function ammoDropped(e: {
	fighter: { id: string };
	body: { ammo: number };
}): boolean {
	const ammo = e.body.ammo;
	const prev = lastAmmo.get(e.fighter.id);
	lastAmmo.set(e.fighter.id, ammo);
	return prev !== undefined && ammo < prev;
}

/**
 * The dragon ride's draw scale: the ride's own art, shrunk so the fighter
 * inside it reads at the same size the walk cycle does — the character
 * portion of the ride frames is ~2.2x the collider's height.
 */
const DRAGON_SCALE = 0.62;

/**
 * Pick each fighter's clip from simulation state, then advance it.
 *
 * Driven by velocity and facing rather than by input, so it works identically
 * for the locally predicted fighter and the interpolated remote one — the
 * remote has no input to read. Everything below is per-hero: the strip the
 * walk cycle is cut from and the generated poses both come from the fighter's
 * own sheet (see `HERO_CLIPS` for the hero whose art is hand-drawn).
 */
export function animationSystem(queries: Queries, dtMs: number) {
	for (const e of queries.animated) {
		const body = e.body;
		const hero = e.fighter.hero;
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
			driveClip(e.anim, e.sprite, hero, "plunge", dtMs);
			continue;
		}
		if (body.plungeStuckTimer > 0) {
			driveClip(e.anim, e.sprite, hero, "stuck", dtMs);
			continue;
		}

		// The dragon ride: cargo on a line, the one state that outranks even the
		// hit states — the rider is the dragon and the dragon is not staggered.
		// Anands' own art carries her: the ride strip's frames, rotated down the
		// dragon's line and mirrored for leftward travel.
		if (body.dragonTimer > 0) {
			driveClip(e.anim, e.sprite, hero, "dragon", dtMs);
			const vx = body.dragonVX;
			const mirror = vx < 0 ? -1 : 1;
			e.sprite.rotation =
				Math.atan2(body.dragonVY, vx) - (mirror < 0 ? Math.PI : 0);
			e.sprite.scale.set(DRAGON_SCALE * mirror, DRAGON_SCALE);
			continue;
		}

		// The Death Blossom: the caster *spins*. The texture keeps its own
		// sheet (there is no pose for a blur), and the rotation is accumulated
		// here on frame time and unwound by `spriteSyncSystem` the moment the
		// channel ends — the storm's spin is the one purely cosmetic motion in
		// the game, so it is the one that may run on wall-clock time.
		if (body.blossomTimer > 0) {
			e.sprite.rotation += dtMs * BLOSSOM_SPIN_RAD_PER_MS;
			driveClip(
				e.anim,
				e.sprite,
				hero,
				facingLeft ? "left-idle" : "right-idle",
				dtMs,
			);
			continue;
		}

		// Mid-massive: the fighter is committed to the slam for its whole 680ms
		// — rooted, so there is no walk cycle to show — and the lean is what
		// sells the blade coming down. The blade itself is drawn by `MeleeFx`;
		// this is the body that is doing the smashing.
		if (body.meleeAction === "massive") {
			driveClip(e.anim, e.sprite, hero, "slam", dtMs);
			continue;
		}

		// The dagger's own moves: the thrust's anticipation (the tell the foe
		// jumps) and the dash's streak; the shoryuken's rise; the stab's lunge.
		// Each has its own art and its own direction, and the recovery of the
		// shoryuken falls back to the walk cycle like every other move's.
		if (body.meleeAction === "thrust") {
			const windup = meleePhase(body) === "startup";
			driveClip(
				e.anim,
				e.sprite,
				hero,
				windup
					? facingLeft
						? "thrust-windup-left"
						: "thrust-windup"
					: facingLeft
						? "thrust-dash-left"
						: "thrust-dash",
				dtMs,
			);
			continue;
		}
		if (body.meleeAction === "stab") {
			driveClip(
				e.anim,
				e.sprite,
				hero,
				facingLeft ? "stab-left" : "stab",
				dtMs,
			);
			continue;
		}
		if (
			body.meleeAction === "shoryuken" &&
			(meleePhase(body) === "startup" || meleePhase(body) === "active")
		) {
			driveClip(
				e.anim,
				e.sprite,
				hero,
				facingLeft ? "shoryuken-left" : "shoryuken",
				dtMs,
			);
			continue;
		}

		const downed = body.knockdownTimer > 0;
		if (downed || body.stunTimer > 0) {
			// A guard break is drawn as its own helplessness — the sword raised
			// and useless — so the reward for a block is visible from across the
			// arena, not just to the two fighters doing it.
			const broken = body.guardBroken;
			driveClip(
				e.anim,
				e.sprite,
				hero,
				downed ? "downed" : broken ? "helpless" : "disabled",
				dtMs,
			);
			continue;
		}

		// A tumble is its own clip, and it outranks the walk cycle for the whole
		// roll. The direction comes from `vx`, never from facing: a gunner can
		// roll away while still aiming back at the fighter chasing them, and the
		// roll's frames must follow the body, not the cursor.
		if (body.tumbleActiveTimer > 0) {
			driveClip(
				e.anim,
				e.sprite,
				hero,
				body.vx < 0 ? "roll-left" : "roll-right",
				dtMs,
			);
			continue;
		}

		// The gun stance has its own walk of clips: the aimed hold, the firing
		// cycle with its muzzle flash, and the run with the gun out. The firing
		// cycle is driven by the magazine dropping — ammo is server-ticked, so
		// both the local fighter and the remotes fire on the same evidence.
		if (body.stance === "gun") {
			if (ammoDropped(e)) {
				driveClip(
					e.anim,
					e.sprite,
					hero,
					facingLeft ? "gun-fire-left" : "gun-fire",
					dtMs,
				);
			} else if (moving) {
				driveClip(
					e.anim,
					e.sprite,
					hero,
					facingLeft ? "gun-run-left" : "gun-run",
					dtMs,
				);
			} else {
				driveClip(
					e.anim,
					e.sprite,
					hero,
					facingLeft ? "gun-hold-left" : "gun-hold",
					dtMs,
				);
			}
			continue;
		}

		driveClip(
			e.anim,
			e.sprite,
			hero,
			moving
				? facingLeft
					? "left"
					: "right"
				: facingLeft
					? "left-idle"
					: "right-idle",
			dtMs,
		);
	}
}

/**
 * The idle frame's texture for a fighter about to be drawn, resolved through
 * the hero's own clip table — the sheet a clip names and the cell it indexes
 * are the hero's, so Match never re-declares the strip layout.
 */
export function idleTexture(hero: HeroId, facing: number) {
	const name = facing < 0 ? "left-idle" : "right-idle";
	const clip = clipFor(hero, name);
	const [frame] = clip.frames;
	if (frame === undefined) return undefined;
	return stripFor(hero, clip.sheet)[frame];
}

/**
 * A fighter concealed in their own side's smoke — the two faces of the cloud.
 *
 * **Hidden, not faded, for the enemy.** A concealed remote fighter is fully
 * invisible while they do nothing; the moment they commit — a swing, a shot,
 * an item use — the `smokeRevealed` flag lights them up at this alpha for
 * `SMOKE_REVEAL_MS`, so the cloud breaks the "who is in here" question exactly
 * on the answer the enemy hears, and no longer.
 *
 * The local fighter keeps the ghost as their cue: visible enough to know
 * exactly where you are standing, faded enough that the enemy's client is the
 * one that cannot see you. In a word: the fade is for you, the absence is for
 * them.
 */
const SMOKE_GHOST_ALPHA = 0.35;

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
		// A dead fighter fades rather than vanishing, so a KO reads as a KO. A
		// fighter concealed in their own side's smoke is *gone*, not ghosted —
		// the enemy has no way to know there is a fighter in the cloud at all.
		// The moment they attack, `smokeRevealed` pops them back at the ghost
		// alpha for `SMOKE_REVEAL_MS`. The local fighter is the exception: the
		// ghost stays as the "you are invisible right now" cue.
		e.sprite.alpha =
			e.fighter.hp <= 0
				? 0.3
				: e.fighter.smokeHidden
					? e.fighter.local || e.fighter.smokeRevealed
						? SMOKE_GHOST_ALPHA
						: 0
					: 1;
		// The blossom's spin and the dragon ride's rotation are accumulated by
		// `animationSystem`; this is the one place the wind-down can live,
		// because it runs after the animation step and before anything else
		// reads the sprite. The ride also carries its own scale (the dragon
		// frames are bigger than the fighter's), restored here with the pose.
		if (e.body.blossomTimer <= 0 && e.body.dragonTimer <= 0) {
			e.sprite.rotation = 0;
			const base = sheetScale(HEROES[e.fighter.hero].sheet);
			e.sprite.scale.set(base, base);
		}
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
		// The same rule holds for a fighter concealed in smoke: their blade is as
		// hidden as they are.
		if (!e.sprite.visible || e.fighter.smokeHidden) continue;
		fx.updateFighter(
			e.fighter.id,
			e.body,
			dtMs,
			holdingUlt(e.fighter.id),
			e.fighter.team,
			e.fighter.hero,
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
		// and that was the first thing it got visibly wrong. A fighter concealed in
		// smoke is the same shape: the enemy must not even read *how hurt* the
		// person in the cloud is, or "is anyone there" answers itself.
		if (!e.sprite.visible || e.fighter.smokeHidden) {
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
		// on the floor — and a concealed fighter's shadow would be the single
		// biggest giveaway the smoke exists to hide, since it is drawn under
		// everybody and tinted by the team.
		if (!e.sprite.visible || e.fighter.smokeHidden) {
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
		fx.registerBody(
			e.fighter.id,
			e.sprite,
			sheetScale(HEROES[e.fighter.hero].sheet),
		);
	}
}
