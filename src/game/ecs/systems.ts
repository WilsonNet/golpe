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
	sheetClips,
	sheetScale,
	TEX,
} from "../render/assets";
import type { MeleeFx } from "../render/MeleeFx";
import type { Nameplates } from "../render/Nameplates";
import type { Shadows } from "../render/Shadows";
import { HEROES, type HeroId } from "../simulation/Heroes";
import { meleePhase, moveDuration } from "../simulation/Melee";
import { PLAYER_WIDTH } from "../simulation/Physics";
import { BLOSSOM_SPIN_RAD_PER_MS } from "../simulation/Ultimate";
import { TINT, teamTint } from "../teamPalette";
import type { AnimState, Queries } from "./world";

/**
 * A clip: a frame range into a strip, at a cadence.
 *
 * `sheet` is *relative* for the two shared layouts — `"own"` means "the
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
	/**
	 * `"move"`: the frame is not on a clock — it is the fighter's progress
	 * through the melee move it is in, so a swing's drawn blade is exactly as
	 * far through its arc as the simulation's hitbox is.
	 */
	drive?: "move" | "aim";
	/** For an `"aim"` clip: how many elevation bands the frames are split into. */
	bands?: number;
}

/**
 * The default clips — the nine-cell strip layout every generated hero
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
	left: { frames: [0, 1, 2, 3], fps: 10, sheet: "own" },
	right: { frames: [5, 6, 7, 8], fps: 10, sheet: "own" },
	turn: { frames: [4], fps: 1, sheet: "own" },
	"left-idle": { frames: [0], fps: 1, sheet: "own" },
	"right-idle": { frames: [5], fps: 1, sheet: "own" },
	disabled: { frames: [], fps: 1, sheet: "own" },
	downed: { frames: [], fps: 1, sheet: "own" },
	// Horizontal in the air: the launch and the airborne half of a knockdown.
	launched: { frames: [], fps: 1, sheet: "own" },
	helpless: { frames: [], fps: 1, sheet: "own" },
	slam: { frames: [], fps: 1, sheet: "own" },
	plunge: { frames: [], fps: 1, sheet: "own" },
	stuck: { frames: [], fps: 1, sheet: "own" },
	// The dagger's own poses — generated per hero, like the hit poses.
	"thrust-windup": { frames: [], fps: 1, sheet: "own" },
	"thrust-dash": { frames: [], fps: 1, sheet: "own" },
	shoryuken: { frames: [], fps: 1, sheet: "own" },
	dragon: { frames: [], fps: 1, sheet: "own" },
	// The dagger's left-facing variants of the same moves.
	"thrust-windup-left": { frames: [], fps: 1, sheet: "own" },
	"thrust-dash-left": { frames: [], fps: 1, sheet: "own" },
	"shoryuken-left": { frames: [], fps: 1, sheet: "own" },
	// The stab, and the gun stance's own walk of clips. The generated heroes
	// never play them — they exist so the clip union is total.
	stab: { frames: [4], fps: 1, sheet: "own" },
	"stab-left": { frames: [4], fps: 1, sheet: "own" },
	"gun-hold": { frames: [4], fps: 1, sheet: "own" },
	"gun-hold-left": { frames: [4], fps: 1, sheet: "own" },
	"gun-fire": { frames: [4], fps: 1, sheet: "own" },
	"gun-fire-left": { frames: [4], fps: 1, sheet: "own" },
	"gun-run": { frames: [4], fps: 1, sheet: "own" },
	"gun-run-left": { frames: [4], fps: 1, sheet: "own" },
	// Clips only a rendered sheet ships (Lia's): the sword's own cuts, the
	// guard, the charge, the air, and a left-facing twin of every pose the
	// generated heroes draw one-sided. A hero without them never picks them —
	// `ownClip` gates every use — but the union must be total.
	slash: { frames: [], fps: 1, sheet: "own" },
	"slash-left": { frames: [], fps: 1, sheet: "own" },
	slash2: { frames: [], fps: 1, sheet: "own" },
	"slash2-left": { frames: [], fps: 1, sheet: "own" },
	slash3: { frames: [], fps: 1, sheet: "own" },
	"slash3-left": { frames: [], fps: 1, sheet: "own" },
	uppercut: { frames: [], fps: 1, sheet: "own" },
	"uppercut-left": { frames: [], fps: 1, sheet: "own" },
	block: { frames: [], fps: 1, sheet: "own" },
	"block-left": { frames: [], fps: 1, sheet: "own" },
	charge: { frames: [], fps: 1, sheet: "own" },
	"charge-left": { frames: [], fps: 1, sheet: "own" },
	"charge-walk": { frames: [], fps: 1, sheet: "own" },
	"charge-walk-left": { frames: [], fps: 1, sheet: "own" },
	jump: { frames: [], fps: 1, sheet: "own" },
	"jump-left": { frames: [], fps: 1, sheet: "own" },
	fall: { frames: [], fps: 1, sheet: "own" },
	"fall-left": { frames: [], fps: 1, sheet: "own" },
	"slam-left": { frames: [], fps: 1, sheet: "own" },
	"plunge-left": { frames: [], fps: 1, sheet: "own" },
	"stuck-left": { frames: [], fps: 1, sheet: "own" },
	"disabled-left": { frames: [], fps: 1, sheet: "own" },
	"downed-left": { frames: [], fps: 1, sheet: "own" },
	"launched-left": { frames: [], fps: 1, sheet: "own" },
	"helpless-left": { frames: [], fps: 1, sheet: "own" },
	// The item throw (a grenade, a trap, a smoke): presentation-only, played
	// for `THROW_CLIP_MS` from the moment the thrown item first shows up — and
	// only by a hero whose art has it; the rest keep their current clip.
	throw: { frames: [], fps: 1, sheet: "own" },
	"throw-left": { frames: [], fps: 1, sheet: "own" },
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

/** Is this string a clip the animation system knows? (A packed sheet's JSON is checked with it.) */
export function isClipName(name: string): name is ClipName {
	return Object.hasOwn(CLIPS, name);
}

/**
 * Clips a hero's packed sheet does not carry. Anands' character art is a
 * packed sheet rendered from Blender like Lia's and Jeffs' (her clips live in
 * `anands.json`); the dragon ride is still her own strip, cut from her boards
 * by `scripts/make-anands-art.py`, because the ride is the ultimate's
 * screen-filling art and not a pose of her model.
 */
const HERO_CLIPS: Partial<Record<HeroId, Partial<Record<ClipName, Clip>>>> = {
	anands: {
		dragon: {
			frames: [0, 1, 2, 3, 4, 5],
			fps: 10,
			sheet: TEX["anands-dragon"],
		},
	},
};

/**
 * The clip a packed sheet ships for this name, as a `Clip` over that sheet.
 * Lia's clips live in her atlas JSON, not here: the Blender pipeline names
 * them with exactly these `ClipName`s, so a re-render with more frames or a
 * re-timed loop reaches the game with no code change.
 */
function packedClip(hero: HeroId, name: ClipName): Clip | undefined {
	const sheet = HEROES[hero].sheet;
	const packed = sheetClips(sheet)?.[name];
	if (!packed || packed.frames.length === 0) return undefined;
	return {
		frames: packed.frames,
		fps: packed.fps,
		sheet,
		...(packed.drive ? { drive: packed.drive } : {}),
		...(packed.bands ? { bands: packed.bands } : {}),
	};
}

/**
 * The clip a hero plays for a state: the hero's own table wins, then the
 * hero's packed sheet, and the default layout (the generated heroes) is the
 * fallback.
 */
function clipFor(hero: HeroId, name: ClipName): Clip {
	return HERO_CLIPS[hero]?.[name] ?? packedClip(hero, name) ?? CLIPS[name];
}

/** Does this hero's art actually draw this clip (rather than falling back)? */
function ownClip(hero: HeroId, name: ClipName): boolean {
	return (
		HERO_CLIPS[hero]?.[name] !== undefined ||
		packedClip(hero, name) !== undefined
	);
}

/**
 * The facing-correct variant of a clip: `<name>-left` for a left-facing
 * fighter when the hero's art ships one, the clip itself otherwise (a
 * generated pose, or Anands' rear-facing hit poses, serve both directions).
 */
function sided(hero: HeroId, name: ClipName, facingLeft: boolean): ClipName {
	if (!facingLeft) return name;
	const left = `${name}-left` as ClipName;
	return left in CLIPS && ownClip(hero, left) ? left : name;
}

/**
 * The texture set a clip's indices index into, for this fighter's hero.
 *
 * `"own"` resolves to the hero's own character strip and `"roll"` to the
 * hero's own roll strip, so a clip written against the shared layout slices
 * any generated hero's sheet; a concrete sheet name (`anands-dragon`) is the
 * strip itself. This is the one place a hero's sheet name becomes a texture
 * set.
 */
function stripFor(hero: HeroId, sheet: string): ReturnType<typeof heroFrames> {
	if (sheet === "own") return heroFrames(HEROES[hero].sheet);
	if (sheet === "roll") return heroRollFrames(`${HEROES[hero].sheet}-roll`);
	return heroFrames(sheet);
}

type PoseKey =
	| "disabled"
	| "downed"
	| "launched"
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
	launched: "launched",
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
	slash: "disabled",
	"slash-left": "disabled",
	slash2: "disabled",
	"slash2-left": "disabled",
	slash3: "disabled",
	"slash3-left": "disabled",
	uppercut: "disabled",
	"uppercut-left": "disabled",
	block: "disabled",
	"block-left": "disabled",
	charge: "slam",
	"charge-left": "slam",
	"charge-walk": "slam",
	"charge-walk-left": "slam",
	jump: "disabled",
	"jump-left": "disabled",
	fall: "disabled",
	"fall-left": "disabled",
	"slam-left": "slam",
	"plunge-left": "plunge",
	"stuck-left": "stuck",
	"disabled-left": "disabled",
	"downed-left": "downed",
	"launched-left": "launched",
	"helpless-left": "helpless",
	throw: "disabled",
	"throw-left": "disabled",
};

/**
 * The generated pose texture for this fighter's hero.
 *
 * `heroPose` falls back to an empty texture when one was not generated for the
 * hero — every hero gets the same ten poses, because they are all derived from
 * whatever sheet the hero actually ships with.
 */
function poseFor(hero: HeroId, pose: PoseKey) {
	return heroPose(HEROES[hero].sheet, pose);
}

/**
 * What the animation system actually drew, per hero: frames per clip, and
 * frames where a hero whose art is a packed sheet fell back to a generated
 * placeholder pose. Read by `window.__animStats` (see `scripts/art-probe.ts`)
 * — a sheet that silently lost a clip still draws *something*, and only this
 * says it was the wrong thing.
 */
interface AnimStats {
	clips: Record<string, number>;
	fallbacks: Record<string, number>;
	/**
	 * Frames drawn per rifle aim band, split by who is holding it. A remote's
	 * aim arrives in the snapshot; before it did, every remote rifle was drawn
	 * level, and only `remote` spreading across bands says it no longer is.
	 */
	aimBands: { local: Record<number, number>; remote: Record<number, number> };
}

const animStats = new Map<HeroId, AnimStats>();

export function animationStats(): Record<string, AnimStats> {
	return Object.fromEntries(animStats);
}

function statsFor(hero: HeroId): AnimStats {
	let stats = animStats.get(hero);
	if (!stats) {
		stats = { clips: {}, fallbacks: {}, aimBands: { local: {}, remote: {} } };
		animStats.set(hero, stats);
	}
	return stats;
}

function tally(hero: HeroId, name: ClipName, fallback: boolean) {
	const stats = statsFor(hero);
	stats.clips[name] = (stats.clips[name] ?? 0) + 1;
	if (fallback) stats.fallbacks[name] = (stats.fallbacks[name] ?? 0) + 1;
}

const HALF_PI = Math.PI / 2;

/** `__animStats` buckets the drawn aim in eighths of a half turn: 0 up, 8 down. */
const AIM_STAT_BUCKETS = 9;

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

/**
 * The aim as an elevation off the fighter's facing: 0 straight ahead,
 * negative up, positive down, clamped to a half turn — you face the cursor,
 * so an aim behind you is a facing that has not caught up yet.
 */
function aimElevation(aim: number | undefined, facingLeft: boolean): number {
	if (aim === undefined) return 0;
	const e = Math.atan2(
		Math.sin(aim),
		facingLeft ? -Math.cos(aim) : Math.cos(aim),
	);
	return clamp(e, -HALF_PI, HALF_PI);
}

/** Which of `bands` elevation runs an aim falls in: 0 straight up, last straight down. */
function aimBand(aim: number | undefined, bands: number): number {
	if (bands <= 1) return 0;
	const e = clamp(aim ?? 0, -HALF_PI, HALF_PI);
	return Math.round(((e + HALF_PI) / Math.PI) * (bands - 1));
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
	progress?: number,
	aim?: number,
) {
	playClip(anim, name);
	const clip = clipFor(hero, name);
	tally(
		hero,
		name,
		clip.frames.length === 0 && sheetClips(HEROES[hero].sheet) !== undefined,
	);
	if (clip.frames.length === 0) {
		const pose = poseFor(hero, POSE_BY_CLIP[name]);
		if (sprite.texture !== pose) sprite.texture = pose;
		return;
	}
	if (clip.drive === "move" && progress !== undefined) {
		const n = clip.frames.length;
		anim.frame = Math.min(n - 1, Math.max(0, Math.floor(progress * n)));
		const frameIndex = clip.frames[anim.frame];
		const texture =
			frameIndex === undefined
				? undefined
				: stripFor(hero, clip.sheet)[frameIndex];
		if (texture && sprite.texture !== texture) sprite.texture = texture;
		return;
	}
	// An aim clip is `bands` runs of frames, one per elevation: the clock runs
	// within a run, and the aim picks which run — so turning the rifle mid-stride
	// keeps the stride.
	const bands = clip.drive === "aim" && clip.bands ? clip.bands : 1;
	const perBand = Math.max(1, Math.floor(clip.frames.length / bands));
	const band = aimBand(aim, bands);
	anim.elapsedMs += dtMs;
	const frameMs = 1000 / clip.fps;
	while (anim.elapsedMs >= frameMs && perBand > 1) {
		anim.elapsedMs -= frameMs;
		anim.frame = (anim.frame + 1) % perBand;
	}
	if (anim.frame >= perBand) anim.frame = 0;

	// The hit clips carry no frames — they are assigned above and never reach
	// here — so a missing index means the strip, not the clip, is wrong.
	const frameIndex = clip.frames[band * perBand + anim.frame] ?? clip.frames[0];
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
export function animationSystem(
	queries: Queries,
	dtMs: number,
	aimOf?: (id: string, local: boolean) => number | undefined,
) {
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
			driveClip(
				e.anim,
				e.sprite,
				hero,
				sided(hero, "plunge", facingLeft),
				dtMs,
			);
			continue;
		}
		if (body.plungeStuckTimer > 0) {
			driveClip(e.anim, e.sprite, hero, sided(hero, "stuck", facingLeft), dtMs);
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
			driveClip(
				e.anim,
				e.sprite,
				hero,
				sided(hero, "slam", facingLeft),
				dtMs,
				body.meleeTimer / moveDuration("massive"),
			);
			continue;
		}

		// The sword's own cuts, for a hero whose art draws them (Lia's): the
		// frame is the move's progress, so the drawn blade is exactly as far
		// through its arc as the hitbox — the swing trail and the steel agree
		// by construction. Heroes without the clips keep the walk cycle under
		// `MeleeFx`'s drawn blade.
		const cut = body.meleeAction;
		if (
			(cut === "slash" ||
				cut === "slash2" ||
				cut === "slash3" ||
				cut === "uppercut") &&
			ownClip(hero, cut)
		) {
			driveClip(
				e.anim,
				e.sprite,
				hero,
				sided(hero, cut, facingLeft),
				dtMs,
				body.meleeTimer / moveDuration(cut),
			);
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

		// A launched fighter is **horizontal from the first tick**: the launch
		// arms `knockdownPendingTimer` on the hit, and the pose that reads as
		// "on their back" must not wait for the floor. The same clip covers the
		// airborne half of a real knockdown — a spiked victim is horizontal on
		// the way down — while the grounded pose keeps its dust.
		const launched = body.knockdownPendingTimer > 0;
		const downed = body.knockdownTimer > 0;
		if (launched || downed || body.stunTimer > 0) {
			// A guard break is drawn as its own helplessness — the sword raised
			// and useless — so the reward for a block is visible from across the
			// arena, not just to the two fighters doing it.
			const broken = body.guardBroken;
			const clip: ClipName =
				launched || (downed && !body.grounded)
					? "launched"
					: downed
						? "downed"
						: broken
							? "helpless"
							: "disabled";
			driveClip(e.anim, e.sprite, hero, sided(hero, clip, facingLeft), dtMs);
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

		// An item throw, for a hero whose art draws one: the arm sweeping the
		// grenade or the trap out, for the moment after it leaves the hand
		// (`fighter.throwMs`, set by the match when the item appears).
		if ((e.fighter.throwMs ?? 0) > 0 && ownClip(hero, "throw")) {
			driveClip(e.anim, e.sprite, hero, sided(hero, "throw", facingLeft), dtMs);
			continue;
		}

		// The gun stance has its own walk of clips: the aimed hold, the firing
		// cycle with its muzzle flash, and the run with the gun out. The firing
		// cycle is driven by the magazine dropping — ammo is server-ticked, so
		// both the local fighter and the remotes fire on the same evidence.
		if (body.stance === "gun") {
			// The rifle points where the shots go: an aim clip picks its band
			// from this fighter's aim — the local one's live, a remote's from the
			// snapshot. A strip hero's gun clips have no bands and ignore it.
			const aim = aimElevation(
				aimOf?.(e.fighter.id, e.fighter.local),
				facingLeft,
			);
			const clip: ClipName = ammoDropped(e)
				? facingLeft
					? "gun-fire-left"
					: "gun-fire"
				: moving
					? facingLeft
						? "gun-run-left"
						: "gun-run"
					: facingLeft
						? "gun-hold-left"
						: "gun-hold";
			driveClip(e.anim, e.sprite, hero, clip, dtMs, undefined, aim);
			// Tallied as the elevation drawn, in 22.5-degree buckets (0 = up, 8 =
			// down), not as clip bands: hold and run have different band counts,
			// and mixing them made "level" look like three different aims.
			if (clipFor(hero, clip).bands) {
				const side =
					statsFor(hero).aimBands[e.fighter.local ? "local" : "remote"];
				const bucket = aimBand(aim, AIM_STAT_BUCKETS);
				side[bucket] = (side[bucket] ?? 0) + 1;
			}
			continue;
		}

		// The sword stance's readable states, for a hero whose art draws them.
		// The guard is the sword held across the body; the massive's charge is
		// the blade raised overhead the whole time it fills and is carried —
		// the counter's tell — walking or standing; and the air is a jump
		// until the apex and a fall after it.
		if (body.blocking && ownClip(hero, "block")) {
			driveClip(e.anim, e.sprite, hero, sided(hero, "block", facingLeft), dtMs);
			continue;
		}
		if (body.chargeTimer > 0 && ownClip(hero, "charge")) {
			driveClip(
				e.anim,
				e.sprite,
				hero,
				sided(hero, moving ? "charge-walk" : "charge", facingLeft),
				dtMs,
			);
			continue;
		}
		if (!body.grounded && ownClip(hero, "jump")) {
			driveClip(
				e.anim,
				e.sprite,
				hero,
				sided(hero, body.vy < 0 ? "jump" : "fall", facingLeft),
				dtMs,
			);
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
