/**
 * Texture loading and generation.
 *
 * Two kinds live here: real artwork loaded from `public/assets`, and the
 * placeholder combat art generated in code. Keeping both behind one module
 * means swapping a placeholder for a real sprite is a one-line change here and
 * touches nothing in the renderer or the systems.
 */

import {
	Assets,
	CanvasSource,
	Container,
	Graphics,
	Rectangle,
	type Renderer,
	Sprite,
	Texture,
} from "pixi.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../simulation/Arena";

export const TEX = {
	dude: "dude",
	/** The tumble roll strip — see `rollFrames`. */
	roll: "roll",
	/** Anands' character strip — see `anandsFrames`. */
	anands: "anands",
	/** Anands' roll strip, derived from her own sheet like the dude's. */
	"anands-roll": "anands-roll",
	/** Anands' dragon-thrust ride: the ultimate's own art, cut from the
	 * reference boards by `scripts/make-anands-art.py`. */
	"anands-dragon": "anands-dragon",
	/** Anands' portrait: the face-on frame blown up for the hero select and
	 * the ultimate cinematic's card. */
	"anands-portrait": "anands-portrait",
	/** Jeffs' character strip — see `jeffsFrames`. */
	jeffs: "jeffs",
	/** Jeffs' roll strip, derived from his own sheet like the others'. */
	"jeffs-roll": "jeffs-roll",
	fireball: "fireball",
	platform: "platform",
	sky: "sky",
	spark: "fx_spark",
	shard: "fx_shard",
	ring: "fx_ring",
	/**
	 * The massive's blast column: a vertical eruption rising out of the floor.
	 * The move's one silhouette — a flame torn upward, not a wave — see
	 * `createEruptionTexture`.
	 */
	eruption: "fx_eruption",
	/** A lumpy rock, thrown by the massive's blast. See `createChunkTexture`. */
	chunk: "fx_chunk",
	arc: "fx_arc",
	blade: "fx_blade",
	/** The dagger: a short steel blade, the stab's own silhouette. */
	dagger: "fx_dagger",
	guard: "fx_guard",
	/**
	 * The dragon thrust's head: a golden serpent's head with a red mane, the
	 * front of Anands' ride. Baked with its own colours — it is the one
	 * ultimate that is *gold*, and a tint would wash it.
	 */
	dragonHead: "fx_dragon_head",
	/** One body segment of the dragon: a gold scale arc the trail chains. */
	dragonBody: "fx_dragon_body",
	/** The dragon's mane and wake: a soft red-gold wisp, tintable. */
	dragonMane: "fx_dragon_mane",
	dragonGlow: "fx_dragon_glow",
	/** Staggered by a sword hit. Derived from the fighter's own strip. */
	disabled: "dude_disabled",
	/** Flat on the floor, after the chain's finisher. */
	downed: "dude_downed",
	/** Guard-broken: a full second with the sword raised helplessly. */
	helpless: "dude_helpless",
	/** Mid-slam: the massive's swing, leaning into the planted blade. */
	slam: "dude_slam",
	/** The plunge bomb's dive: sword first, straight down. */
	plunge: "dude_plunge",
	/** Planted after a bomb: the sword is in the ground and the fighter is stuck. */
	stuck: "dude_stuck",
	/**
	 * The dagger's three poses, derived from the fighter's own strip like the
	 * hit poses: the thrust's anticipation (blade cocked back), the thrust's
	 * dash (a horizontal streak), the shoryuken's rise, and the dragon ride.
	 */
	thrustWindup: "anands_thrust_windup",
	thrustDash: "anands_thrust_dash",
	shoryukenRise: "anands_shoryuken_rise",
	dragonRide: "anands_dragon_ride",
	/** The black hole's own art — see `createUltimateTextures`. */
	singularity: "fx_singularity",
	horizon: "fx_horizon",
	/**
	 * The same horizon ring, baked in danger red: a *hostile* hole draws this
	 * instead, so "will this one drag me" is read in one glance. See
	 * `createUltimateTextures` and `BlackHoleFx.drawField`.
	 */
	horizonHostile: "fx_horizon_hostile",
	accretion: "fx_accretion",
	grenade: "fx_grenade",
	halo: "fx_halo",
	/** Anands' floor trap — see `createItemTextures`. */
	trap: "fx_trap",
	/** Lia's HE grenade — see `createItemTextures`. */
	heGrenade: "fx_he_grenade",
	/** Jeffs' smoke canister — see `createItemTextures`. */
	smokeGrenade: "fx_smoke_grenade",
	/**
	 * The smoke cloud's puff: a soft radial haze, baked white so a tint
	 * controls its colour. See `createSmokePuffTexture`.
	 */
	smoke: "fx_smoke",
	/** The soft ellipse every fighter's team-tinted cast shadow is drawn with. */
	shadow: "fx_shadow",
} as const;

/**
 * The pose textures that are derived per hero from that hero's own strip.
 * Keyed `"<hero>:<pose>"` (e.g. `"anands:disabled"`) so every hero gets a
 * stagger that lines up with their own walk cycle. The `TEX.*` names above are
 * the *dude's* copies, kept for the pre-hero callers.
 */
export type HeroPose =
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

/** The `dude` strip, sliced into its nine 64x96 frames (2x art, drawn half-size). */
let dudeFrames: Texture[] = [];
/**
 * The roll strip, sliced into sixteen 80x96 frames: 0-7 roll right, 8-15 roll
 * left (the same frames mirrored, so a left roll does not read as a right roll
 * viewed backwards — feet lead the wrong way otherwise).
 */
let rollFrames: Texture[] = [];
/** Anands' strip, sliced like the dude's: 0-3 walk left, 4 face-on, 5-8 right. */
let anandsFrames: Texture[] = [];
/** Anands' roll strip: 0-7 right, 8-15 left, exactly like the dude's. */
let anandsRollFrames: Texture[] = [];
/** Jeffs' strip and roll, sliced exactly like the other two heroes'. */
let jeffsFrames: Texture[] = [];
let jeffsRollFrames: Texture[] = [];

/** Every hero's nine-frame strip, keyed by the hero's sheet name. */
const FRAME_SETS: Record<string, Texture[]> = {};

/** Every hero's roll strip. */
const ROLL_SETS: Record<string, Texture[]> = {};

/** One roll cell is wider than the body: a tumbled figure sprawls past it. */
const ROLL_FRAME_W = 80;

/**
 * The cell geometry of every strip, keyed by the sheet's TEX alias.
 *
 * Sheets stopped being one-size-fits-all the day the hand-drawn Anands art
 * landed: her cells are 168x152 (a ~140px fighter standing in a padded box)
 * and her dragon's are 352x176, while Lia and Jeffs ship 2x art (64x96
 * character cells, 80x96 roll cells) drawn at half size through `sheetScale`.
 * A clip indexes a strip; a strip's cells are whatever this table says they
 * are.
 */
const SHEET_CELLS: Record<string, { w: number; h: number }> = {
	[TEX.dude]: { w: 64, h: 96 },
	[TEX.roll]: { w: ROLL_FRAME_W, h: 96 },
	[TEX.anands]: { w: 168, h: 152 },
	[TEX["anands-roll"]]: { w: 168, h: 152 },
	[TEX["anands-dragon"]]: { w: 352, h: 176 },
	[TEX.jeffs]: { w: 64, h: 96 },
	[TEX["jeffs-roll"]]: { w: ROLL_FRAME_W, h: 96 },
};

/**
 * Sheets defined by the sprite workshop's exported atlas JSON, not by the
 * table above.
 *
 * The workshop (`?slicer=true`, see `docs/sprite-slicer.md`) turns a raw art
 * board into a clean strip — uniform cells, transparent background — plus a
 * small JSON carrying the cell size and the named clips. A sheet shipped that
 * way is registered here, one line: the strip and its JSON sit in
 * `public/assets`, and `loadAssets` slices the strip by the JSON's cell size
 * exactly as if `SHEET_CELLS` had named it. The clips live in
 * `HERO_CLIPS` in `ecs/systems.ts`, written from the JSON's `clips` —
 * the wire format and the animation states are per-hero code, not data.
 */
const ATLAS_SHEETS: Record<string, { png: string; json: string }> = {};

/** The atlas JSON the workshop exports — `cellW`/`cellH` and the clips. */
interface AtlasMeta {
	name: string;
	cellW: number;
	cellH: number;
	frames: { x: number; y: number; w: number; h: number }[];
	clips: { name: string; frames: number[]; fps: number; loop: boolean }[];
}

/** The per-hero pose textures, keyed `hero:pose`. */
const poseTextures = new Map<string, Texture>();

/** The generated (white, tintable) textures. */
const generated = new Map<string, Texture>();

export function tex(key: string): Texture {
	const made = generated.get(key);
	if (made) return made;
	return Assets.get(key) ?? Texture.EMPTY;
}

/**
 * A hero's nine-frame strip. Sheets are sliced once at load and kept forever:
 * fighters are created and destroyed at sixteen-per-room, but the strip they
 * are cut from does not change.
 */
export function heroFrames(sheet: string): Texture[] {
	return FRAME_SETS[sheet] ?? dudeFrames;
}

/** A hero's roll strip. */
export function heroRollFrames(sheet: string): Texture[] {
	return ROLL_SETS[sheet] ?? rollFrames;
}

/** A hero's derived pose texture (disabled, downed, the dagger's thrust…). */
export function heroPose(sheet: string, pose: HeroPose): Texture {
	return poseTextures.get(`${sheet}:${pose}`) ?? Texture.EMPTY;
}

/**
 * The draw scale of a hero's sheet, so a fighter always reads the same size
 * against the 32x48 collider whatever its cells are: the collider height
 * over the sheet's cell height. Lia and Jeffs ship 2x art, so their sprites
 * are drawn at 48/96; Anands' hand-drawn art is ~2.7x the collider, so hers
 * are drawn at 48/152.
 */
export function sheetScale(sheet: string): number {
	const cell = SHEET_CELLS[sheet];
	return cell ? PLAYER_HEIGHT / cell.h : 1;
}

/**
 * Slice a strip into cells of its own geometry. Sheets are sliced once at
 * load and kept forever: fighters are created and destroyed at
 * sixteen-per-room, but the strip they are cut from does not change.
 */
function sliceStrip(key: string, count: number): Texture[] {
	const sheet = Assets.get(key) as Texture;
	const cell = SHEET_CELLS[key] ?? { w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
	const frames: Texture[] = [];
	for (let i = 0; i < count; i++) {
		frames.push(
			new Texture({
				source: sheet.source,
				frame: new Rectangle(i * cell.w, 0, cell.w, cell.h),
			}),
		);
	}
	return frames;
}

/**
 * Load the artwork the game ships with.
 *
 * Pixi requires the application to be initialised first, and every load is
 * async — unlike Phaser's preload phase, there is no framework stage that
 * guarantees textures exist before the first frame, so callers must await this.
 */
let manifestRegistered = false;

export async function loadAssets(): Promise<void> {
	const sources: Record<string, string> = {
		[TEX.dude]: "assets/dude.png",
		[TEX.roll]: "assets/roll.png",
		[TEX.anands]: "assets/anands.png",
		[TEX["anands-roll"]]: "assets/anands-roll.png",
		[TEX["anands-dragon"]]: "assets/anands-dragon.png",
		[TEX.jeffs]: "assets/jeffs.png",
		[TEX["jeffs-roll"]]: "assets/jeffs-roll.png",
		[TEX.fireball]: "assets/fireball.png",
		[TEX.platform]: "assets/platform.png",
		[TEX.sky]: "assets/sky.png",
	};

	// The resolver is global and complains about re-registering an alias. React
	// StrictMode mounts twice in development, so this runs twice on every dev
	// boot; registering once keeps that from filling the console with warnings.
	if (!manifestRegistered) {
		for (const [alias, src] of Object.entries(sources)) {
			Assets.add({ alias, src });
		}
		manifestRegistered = true;
	}
	await Assets.load(Object.keys(sources));

	// Every strip is sliced by its own cell geometry — `SHEET_CELLS` owns the
	// sizes, this is the only place a sheet becomes a texture set. The dude
	// sheet is a plain horizontal strip with no atlas JSON, so the frames are
	// cut by hand: 0-3 walk left, 4 face-on, 5-8 walk right. The roll strips
	// follow the same pattern, generated by `scripts/make-roll-art.py` from
	// the same dude strip — see that script for why the roll is wider than
	// the walk. Anands' hand-drawn art (see `scripts/make-anands-art.py`) and
	// Jeffs' generated art are the same idea with their own cell sizes.
	dudeFrames = sliceStrip(TEX.dude, 9);
	FRAME_SETS[TEX.dude] = dudeFrames;

	rollFrames = sliceStrip(TEX.roll, 16);
	ROLL_SETS[TEX.roll] = rollFrames;

	anandsFrames = sliceStrip(TEX.anands, 35);
	FRAME_SETS[TEX.anands] = anandsFrames;

	anandsRollFrames = sliceStrip(TEX["anands-roll"], 16);
	ROLL_SETS[TEX["anands-roll"]] = anandsRollFrames;

	// The dragon-thrust ride: six big cells of the ultimate's own art. Not a
	// hero strip — the ride clip indexes it directly (see `HERO_CLIPS`).
	FRAME_SETS[TEX["anands-dragon"]] = sliceStrip(TEX["anands-dragon"], 6);

	jeffsFrames = sliceStrip(TEX.jeffs, 9);
	FRAME_SETS[TEX.jeffs] = jeffsFrames;

	jeffsRollFrames = sliceStrip(TEX["jeffs-roll"], 16);
	ROLL_SETS[TEX["jeffs-roll"]] = jeffsRollFrames;

	// Sheets shipped from the sprite workshop: one strip, sliced by its own
	// JSON instead of by a hand-kept table. The strips are uniform grids, so
	// this is the same slice as `sliceStrip` with the cell size read from the
	// file rather than from `SHEET_CELLS`.
	await Promise.all(
		Object.entries(ATLAS_SHEETS).map(([name, { png, json }]) =>
			loadAtlasSheet(name, png, json),
		),
	);
}

/**
 * One workshop sheet: load its strip, slice it by the JSON's cell size, and
 * register it like any other hero strip. The clips in the JSON are for the
 * per-hero clip table in `ecs/systems.ts` — this is the strip side only.
 */
async function loadAtlasSheet(
	name: string,
	png: string,
	json: string,
): Promise<void> {
	const res = await fetch(json);
	if (!res.ok) {
		throw new Error(
			`atlas sheet "${name}": missing ${json} — export it from the sprite workshop`,
		);
	}
	const meta = (await res.json()) as AtlasMeta;
	const texture = await Assets.load<Texture>({ alias: name, src: png });
	const frames: Texture[] = [];
	for (let i = 0; i < meta.frames.length; i++) {
		frames.push(
			new Texture({
				source: texture.source,
				frame: new Rectangle(i * meta.cellW, 0, meta.cellW, meta.cellH),
			}),
		);
	}
	FRAME_SETS[name] = frames;
	SHEET_CELLS[name] = { w: meta.cellW, h: meta.cellH };
}

/**
 * Bake a display object into a texture **any renderer on the page can draw**.
 *
 * `generateTexture` alone produces a RenderTexture whose GPU resource lives in
 * the baking renderer's own context. A second Pixi application on the page —
 * the move list's preview stage — handed the same texture reads another
 * context's GPU memory and draws nothing, silently. Pulling the render back to
 * a 2D canvas makes it a `CanvasSource`, which every renderer uploads
 * independently; the one-time copy buys a page that can run two apps.
 */
function bakeShared(renderer: Renderer, node: Container): Texture {
	const rendered = renderer.generateTexture(node);
	const canvas = renderer.extract.canvas(rendered);
	const texture = new Texture({
		source: new CanvasSource({ resource: canvas }),
	});
	rendered.destroy(true);
	return texture;
}

/**
 * Render a display object to a texture and keep it under `key`.
 *
 * Takes a `Container` rather than a `Graphics` so a generated texture can be a
 * *composition* — the hit poses are the shipped character sprite with shapes
 * drawn over it, which is not something a single `Graphics` can express.
 * `destroy({ children: true })` because the composed ones own their contents.
 */
function bake(renderer: Renderer, key: string, node: Container) {
	generated.set(key, bakeShared(renderer, node));
	node.destroy({ children: true });
}

/**
 * Placeholder combat art, drawn in code.
 *
 * Deliberately crude: flat white primitives that read clearly at speed and are
 * unmistakably temporary. Everything is white so a single tint per effect
 * controls its colour, which is why the real sprites can drop in later without
 * any of the effect code changing.
 */
export function createFxTextures(renderer: Renderer): void {
	if (generated.size > 0) return;

	bake(
		renderer,
		TEX.spark,
		new Graphics().poly([4, 0, 8, 4, 4, 8, 0, 4]).fill(0xffffff),
	);

	bake(renderer, TEX.shard, new Graphics().rect(0, 0, 16, 4).fill(0xffffff));

	bake(
		renderer,
		TEX.ring,
		new Graphics().circle(48, 48, 44).stroke({ width: 5, color: 0xffffff }),
	);

	// The massive's blast: a vertical eruption, deliberately not a wave.
	//
	// A radial wave — ring or star — reads as "shockwave", the same vocabulary
	// as the parry and the backstab. The massive is the move that takes four
	// seconds to earn, and its boom goes the one direction nothing else does:
	// up. The texture is a flame torn out of the floor — a wide vent at the
	// base that flares into a jagged crown at the top — anchored at its base
	// so it can grow upward out of the ground instead of expanding sideways.
	bake(renderer, TEX.eruption, createEruptionTexture());

	// The massive's debris: a lumpy rock, chunkier than the thin shard used by
	// every other impact. The blast throws rocks, not sparks.
	bake(
		renderer,
		TEX.chunk,
		new Graphics()
			.poly([8, 0, 15, 4, 16, 11, 10, 16, 2, 13, 0, 6])
			.fill(0xffffff),
	);

	// A crescent: the swing trail. Drawn facing +x so it can simply be rotated.
	const arc = new Graphics();
	arc.arc(48, 48, 46, -1.0, 1.0, false);
	arc.arc(48, 48, 24, 1.0, -1.0, true);
	arc.closePath();
	arc.fill(0xffffff);
	bake(renderer, TEX.arc, arc);

	// Placeholder sword: blade, guard, grip. To be replaced by real art.
	const blade = new Graphics();
	blade.rect(12, 3, 32, 4).fill(0xdfe7f5);
	blade.rect(8, 0, 3, 10).fill(0x8a94a6);
	blade.rect(0, 3, 8, 4).fill(0x8a94a6);
	bake(renderer, TEX.blade, blade);

	// The dagger: a short steel blade, the opposite silhouette from the sword.
	// Where the sword is a long straight line, the dagger is a leaf: wide at
	// the base, pointed at the tip, and barely longer than the hand.
	const dagger = new Graphics();
	dagger.poly([2, 4, 14, 2, 24, 3, 24, 7, 14, 8, 2, 6]).fill(0xe8f0ff);
	dagger.rect(0, 4, 3, 2).fill(0x8a94a6);
	dagger.rect(-2, 2, 3, 6).fill(0x6a2fd0);
	bake(renderer, TEX.dagger, dagger);

	// The dragon's head: a proper Chinese dragon — outlined so it pops against
	// the bright sky, two swept horns, a big glowing eye, a red flame mane and
	// trailing whiskers — baked in its own colours, because the one ultimate
	// that must read as *gold* from across the arena cannot be tinted into
	// being gold. Facing +x; the renderer rotates it along the ride.
	const OUT = 0x2a1a00;
	const head = new Graphics();
	// The outline silhouette — a bulky skull, not a bar: the head must read
	// as a head from any ride direction, so it is round rather than long.
	head
		.poly([
			-2, 22, 10, 8, 34, 4, 56, 10, 68, 24, 60, 40, 40, 52, 12, 52, -4, 40, -6,
			30,
		])
		.fill(OUT);
	// The skull dome: a big rounded mass.
	head
		.poly([2, 20, 14, 8, 34, 5, 52, 10, 62, 22, 56, 36, 40, 44, 12, 44, 2, 34])
		.fill(0xffc94d);
	// The snout: short and blunt, jutting from the skull's front (right).
	head.poly([56, 22, 72, 26, 74, 32, 62, 38, 54, 34]).fill(0xffd166);
	head.poly([72, 27, 80, 29, 78, 33, 70, 31]).fill(0xfff2b8);
	// The lower jaw, dropping below the skull.
	head.poly([8, 42, 44, 40, 58, 42, 50, 52, 20, 54, 8, 50]).fill(0xffd166);
	head.poly([58, 42, 66, 46, 60, 50, 52, 46]).fill(0xfff2b8);
	// The brow ridge, shading the eye socket.
	head.poly([16, 24, 36, 16, 52, 20, 46, 28, 28, 32]).fill(0xffb238);
	// The glowing eye: a large slanted slit on the skull's front — dark ring,
	// white-hot core, cyan pupil. Big enough to read at speed.
	head.poly([22, 18, 42, 12, 50, 18, 38, 26]).fill(OUT);
	head.poly([24, 18, 40, 14, 46, 18, 36, 24]).fill(0xffffff);
	head.poly([28, 18, 37, 15, 41, 18, 35, 22]).fill(0x6fd8ff);
	// The nostril.
	head.poly([62, 27, 65, 27, 64, 30]).fill(OUT);
	// Teeth along the mouth seam.
	head.poly([12, 46, 18, 46, 15, 51]).fill(0xffffff);
	head.poly([22, 46, 28, 46, 25, 51]).fill(0xffffff);
	head.poly([32, 46, 38, 46, 35, 51]).fill(0xffffff);
	// The horns: two thick swept-back ivory blades on top of the skull — wide
	// enough to carry weight against the skull's bulk, curving back over the
	// mane.
	head.poly([4, 18, 12, 2, 20, -6, 22, 0, 18, 10, 8, 20]).fill(OUT);
	head.poly([6, 16, 12, 5, 18, -2, 19, 3, 16, 10, 9, 17]).fill(0xfff2d8);
	head.poly([12, 10, 15, 2, 18, -3, 19, 1, 17, 7, 13, 11]).fill(0xffe9b8);
	head.poly([16, 14, 24, 0, 32, -6, 34, -1, 30, 6, 21, 15]).fill(OUT);
	head.poly([18, 12, 24, 2, 30, -3, 31, 1, 28, 7, 21, 12]).fill(0xfff2d8);
	head.poly([22, 7, 26, 0, 29, -3, 30, 1, 27, 6, 23, 8]).fill(0xffe9b8);
	// The mane: red flame spikes sweeping back behind the skull — the one
	// colour that is not gold, so the head separates from the body at a
	// glance.
	head.poly([0, 14, 8, 2, 14, 0, 12, 10, 4, 16]).fill(0x2a0a02);
	head.poly([2, 12, 8, 4, 12, 2, 10, 10, 4, 14]).fill(0xff5a3d);
	head.poly([-4, 18, 4, 8, 12, 4, 10, 14, 0, 20]).fill(0xff5a3d);
	head.poly([-6, 24, 4, 14, 12, 10, 10, 20, -2, 28]).fill(0xff7a4d);
	head.poly([2, 28, 12, 20, 18, 18, 16, 28, 4, 34]).fill(0xff5a3d);
	// The whiskers: two long golden feelers trailing from the snout.
	head.poly([72, 30, 92, 32, 92, 35, 72, 33]).fill(0xffd166);
	head.poly([58, 48, 78, 56, 76, 59, 58, 52]).fill(0xffb238);
	bake(renderer, TEX.dragonHead, head);

	// One body segment: a **scale** — a wide hexagon plate, pointed at both
	// ends along the travel, so an overlapped chain reads as one segmented
	// serpent (scales overlapping like a Chinese dragon's belly) instead of a
	// string of coins. Deep amber at the rim, gold at the core, a hot spine
	// down the middle — **painted** rather than additive, because additive
	// gold washes to white over the bright sky.
	const body = new Graphics();
	body.poly([-30, 0, -14, 18, 14, 18, 30, 0, 14, -18, -14, -18]).fill(0xffc94d);
	body.poly([-20, 0, -8, 11, 8, 11, 20, 0, 8, -11, -8, -11]).fill(0xffd166);
	body.poly([-10, 0, -3, 5, 3, 5, 10, 0, 3, -5, -3, -5]).fill(0xfff2b8);
	bake(renderer, TEX.dragonBody, body);

	// The mane: a soft wisp, white so the wake can be tinted gold-to-red.
	const mane = new Graphics();
	for (let i = 6; i >= 1; i--) {
		mane
			.ellipse(24, 12, (26 * i) / 6, (8 * i) / 6)
			.fill({ color: 0xffffff, alpha: 0.1 });
	}
	bake(renderer, TEX.dragonMane, mane);

	// The dragon's own glow: a soft **gold** radial, baked gold rather than a
	// white disc tinted — the white halo's stacked discs read white over the
	// bright sky, and a head lit by a white blast is a head you cannot see.
	const dragonGlow = new Graphics();
	for (let i = 10; i >= 1; i--) {
		dragonGlow
			.circle(64, 64, (60 * i) / 10)
			.fill({ color: 0xffc94d, alpha: 0.05 });
	}
	bake(renderer, TEX.dragonGlow, dragonGlow);

	// The guard arc shown while blocking.
	const guard = new Graphics();
	guard.arc(28, 32, 26, Math.PI - 1.1, Math.PI + 1.1, false);
	guard.stroke({ width: 5, color: 0xffffff });
	bake(renderer, TEX.guard, guard);

	// A soft ellipse, white so a team tint decides its colour. Concentric fills
	// rather than one flat shape: a hard-edged oval reads as a decal painted on
	// the floor, and the whole job of this sprite is to read as light being
	// blocked. Drawn wide and shallow because the camera looks slightly down —
	// the same reason the accretion disk is an ellipse.
	const shadow = new Graphics();
	for (let i = 6; i >= 1; i--) {
		shadow.ellipse(32, 16, (30 * i) / 6, (13 * i) / 6).fill({
			color: 0xffffff,
			alpha: 0.13,
		});
	}
	bake(renderer, TEX.shadow, shadow);

	createHeroPoses(renderer, "dude", dudeFrames);
	createHeroPoses(renderer, "anands", anandsFrames);
	createHeroPoses(renderer, "jeffs", jeffsFrames);
	createUltimateTextures(renderer);
}

/**
 * The massive's blast: a flame torn upward out of the ground.
 *
 * A 64x96 column — a wide vent at the bottom that billows outward and then
 * flares into a jagged crown at the top, like a geyser or a torch flame
 * stretched tall. It is anchored at its base so the caller can grow it
 * *upward* out of the floor (scale.y from small to tall) rather than
 * expanding it sideways: the massive's boom goes down-to-up, and nothing
 * else in the game does.
 */
function createEruptionTexture(): Container {
	return new Graphics()
		.poly([
			// The vent: bottom-left to bottom-right.
			20, 96, 44, 96,
			// Up the right side, billowing outward.
			48, 62, 52, 42, 46, 30, 40, 36,
			// The jagged crown across the top.
			38, 12, 30, 24, 26, 6, 20, 22, 14, 10, 12, 28, 16, 36,
			// Down the left side, mirroring the billow.
			12, 62,
		])
		.fill(0xffffff);
}

/**
 * The black hole's art.
 *
 * The one effect in the game that is **not** flat white waiting for a tint. A
 * singularity is defined by the contrast between a hole that emits nothing and
 * a disk that is far too bright, and a single tinted primitive cannot express
 * both — so the core is baked black-on-transparent, the disk is baked with its
 * own colour ramp, and only the halo stays white so the detonation can tint it.
 *
 * Baked to textures rather than drawn as live `Graphics` because these are
 * scaled and rotated every frame for two seconds: `generateTexture` pays the
 * rasterisation once, and a rotating sprite costs the GPU nothing. See the
 * `pixi-graphics` skill on when to bake.
 */
function createUltimateTextures(renderer: Renderer): void {
	createItemTextures(renderer);
	// ---- the core ----
	//
	// Pure black with a tight falloff, and nothing else. Drawn at 128px and scaled
	// down in use, so the edge stays clean at full size.
	//
	// **Deliberately small against the field it belongs to.** The first version
	// faded out over 16px of soft dark, which at a 168px radius washed a third of
	// the arena grey and made the platforms behind it unreadable — a hole should
	// swallow light, not fog the room. The *edge* of the ability is drawn by the
	// horizon ring instead, which is sized from the simulation's own radius.
	const core = new Graphics();
	core.circle(64, 64, 62).fill({ color: 0x000000, alpha: 0.18 });
	core.circle(64, 64, 54).fill({ color: 0x04000c, alpha: 0.72 });
	core.circle(64, 64, 46).fill(0x000000);
	bake(renderer, TEX.singularity, core);

	// ---- the event horizon ----
	//
	// A ring, drawn at exactly the radius the simulation grabs at — see
	// `BlackHoleFx`. This is the only part of the effect a player has to be able
	// to *read*: inside it you are cargo, outside it you can still fight. An
	// effect whose visible edge is not its real one is the most confusing thing a
	// field ability can do, and the first version had the black core at 62% of the
	// radius with nothing marking the rest.
	const horizon = new Graphics();
	horizon.circle(64, 64, 60).stroke({ width: 3, color: 0xe6d2ff, alpha: 0.95 });
	horizon.circle(64, 64, 56).stroke({ width: 6, color: 0x9a5cff, alpha: 0.45 });
	horizon.circle(64, 64, 51).stroke({ width: 10, color: 0x6a2fd0, alpha: 0.2 });
	bake(renderer, TEX.horizon, horizon);

	// The same geometry in danger red, for a hostile hole. Red is the one colour
	// outside the mode's palette that is already in the game's vocabulary as
	// "that will hurt you" (the blossom's ring), and it is deliberately *not*
	// the team colour: a hostile hole has a side, and the question it must
	// answer is "does this one hurt *me*", not "whose is it".
	const horizonHostile = new Graphics();
	horizonHostile
		.circle(64, 64, 60)
		.stroke({ width: 3, color: 0xffd6d6, alpha: 0.95 });
	horizonHostile
		.circle(64, 64, 56)
		.stroke({ width: 6, color: 0xff4d4d, alpha: 0.45 });
	horizonHostile
		.circle(64, 64, 51)
		.stroke({ width: 10, color: 0xa71f2b, alpha: 0.2 });
	bake(renderer, TEX.horizonHostile, horizonHostile);

	// ---- the accretion disk ----
	//
	// An ellipse rather than a circle, because a disk seen from slightly above is
	// what makes a flat sprite read as a three-dimensional object. Two of these
	// counter-rotate at different rates in `BlackHoleFx`, which is what sells the
	// spin — one ring rotating alone reads as a rotating ring.
	const disk = new Graphics();
	for (const [r, w, colour, alpha] of [
		[60, 5, 0xffffff, 0.9],
		[68, 4, 0xffd9a0, 0.75],
		[76, 3, 0xff9a4d, 0.55],
		[84, 2, 0xb14bff, 0.4],
	] as const) {
		disk
			.ellipse(88, 88, r, r * 0.34)
			.stroke({ width: w, color: colour, alpha });
	}
	bake(renderer, TEX.accretion, disk);

	// ---- the grenade ----
	//
	// A dark core inside a corona: the same read as the hole it becomes, at a
	// twentieth the size, so a player who has seen one knows what is arriving.
	const grenade = new Graphics();
	grenade.circle(16, 16, 14).fill({ color: 0x9a5cff, alpha: 0.25 });
	grenade.circle(16, 16, 10).fill({ color: 0x6a2fd0, alpha: 0.65 });
	grenade.circle(16, 16, 6).fill(0x0a0014);
	grenade
		.circle(16, 16, 6.5)
		.stroke({ width: 1.5, color: 0xd7b3ff, alpha: 0.9 });
	bake(renderer, TEX.grenade, grenade);

	// ---- the halo ----
	//
	// A soft filled disc, white so it can be tinted. Used additively for the
	// gravitational glow and for the detonation flash — the only two things in
	// the game that need light rather than an outline.
	const halo = new Graphics();
	for (let i = 8; i >= 1; i--) {
		halo.circle(64, 64, (64 * i) / 8).fill({ color: 0xffffff, alpha: 0.055 });
	}
	bake(renderer, TEX.halo, halo);
}

/**
 * The items' own art: Anands' trap pad and Lia's HE grenade.
 *
 * The trap is a floor pad — a jagged ring on a dark base, so it reads as
 * *something you should not stand on* — drawn with its centre where the
 * trigger test is (see `Items.ts`). The HE grenade is an olive military read:
 * a rounded body with a fused top, deliberately nothing like the black hole's
 * violet ball, because an item is not an ultimate.
 */
function createItemTextures(renderer: Renderer): void {
	// ---- the trap ----
	//
	// A landmine, seen from the side: a squat disc sitting on the floor with a
	// raised pressure-plate button on top. It is a *profile*, not a top-down
	// pad — a mine drawn as a plan view reads as a floor decal, and this one
	// has to read as a thing you could step on. The teal rim keeps the game's
	// hazard language. Drawn bottom-anchored
	// so the flat base sits exactly on the floor the trap was placed on.
	const trap = new Graphics();
	// The mine body: a shallow dome resting on its flat base.
	trap.ellipse(20, 11, 18, 8).fill({ color: 0x0a1412, alpha: 0.92 });
	trap.ellipse(20, 11, 18, 8).stroke({ width: 2, color: 0x2b3d38, alpha: 0.9 });
	// The hazard rim, teal so it says "do not stand here" in the game's own voice.
	trap
		.ellipse(20, 11, 18, 8)
		.stroke({ width: 1.5, color: 0x7ff0f4, alpha: 0.6 });
	// The upper highlight, so the dome reads as round rather than flat.
	trap.ellipse(20, 8.5, 14, 3).fill({ color: 0x3a5a4f, alpha: 0.7 });
	// The pressure plate: the red button you do not want to stand on.
	trap.ellipse(20, 8, 7, 3.5).fill({ color: 0xff5d5d, alpha: 0.95 });
	// The flat base, where the mine meets the floor.
	trap.rect(1, 18, 38, 2).fill({ color: 0x7ff0f4, alpha: 0.4 });
	bake(renderer, TEX.trap, trap);

	// ---- the HE grenade ----
	//
	// A dark olive sphere with a bright fuse cap, white so the body can be
	// team-tinted in flight.
	const he = new Graphics();
	he.circle(16, 18, 13).fill({ color: 0xffffff, alpha: 0.25 });
	he.circle(16, 18, 11).fill({ color: 0x7d8a4f, alpha: 0.9 });
	he.circle(16, 18, 11).stroke({ width: 1.5, color: 0x2a2f1a, alpha: 0.9 });
	he.rect(14, 2, 4, 5).fill(0xd9b86a);
	bake(renderer, TEX.heGrenade, he);

	// ---- the smoke canister ----
	//
	// A stubby steel cylinder with a crimped top — a *canister*, not a ball:
	// the smoke is thrown to land, and the shape says so. White steel so the
	// body can be team-tinted in flight like the HE.
	const smokeCan = new Graphics();
	smokeCan.rect(7, 9, 18, 16).fill({ color: 0xffffff, alpha: 0.25 });
	smokeCan.rect(8, 10, 16, 14).fill({ color: 0xb8bec6, alpha: 0.95 });
	smokeCan
		.rect(8, 10, 16, 14)
		.stroke({ width: 1.5, color: 0x2a2f33, alpha: 0.9 });
	smokeCan.rect(10, 5, 12, 5).fill(0x8d959c);
	smokeCan.rect(10, 5, 12, 2).fill(0x5d646b);
	bake(renderer, TEX.smokeGrenade, smokeCan);

	// ---- the smoke puff ----
	//
	// The cloud's building block: a soft radial haze, white so one tint
	// controls it. Layers of this puff — scaled, rotated, drifting — are what
	// make a cloud read as a cloud rather than a disc.
	bake(renderer, TEX.smoke, createSmokePuffTexture());
}

/**
 * A soft radial puff for the smoke clouds, drawn as a stack of blurred ellipses.
 *
 * Pure white with an alpha falloff: the cloud's grey is a tint applied per
 * side, and a texture that shipped its own grey could never be faded for
 * allies without a second bake.
 */
function createSmokePuffTexture(): Container {
	const puff = new Graphics();
	for (let i = 0; i < 7; i++) {
		const s = 1 - i * 0.13;
		puff
			.circle(48, 48, 44 * s)
			.fill({ color: 0xffffff, alpha: 0.16 * (1 - i * 0.11) });
	}
	puff.circle(48, 48, 10).fill({ color: 0xffffff, alpha: 0.5 });
	return puff;
}

/**
 * One hero's "you have been hit" and dagger-pose sprites, drawn *from that
 * hero's own sheet*.
 *
 * Every sword hit puts its target into a disabled state, and a state nobody
 * can see is a state that does not exist: through the whole LAN playtest the
 * sword landed, the fighter kept walking, and the hit read as nothing happening.
 * These are placeholders in the honest sense — they are the shipped character,
 * flushed and knocked about, so they line up perfectly with the walk cycle and
 * are replaced by deleting this function when the real art lands.
 *
 * Every pose bakes onto the same canvas, and it is **centred on the body's
 * centre** — `syncSpriteToBody` centres a sprite on the collider, so anything
 * drawn off that centre is drawn off the fighter. That is also why the canvas
 * is bigger than the body: a fighter lying down is 48px long inside a 32px-wide
 * collider, and a texture cropped to its own content would have been
 * re-centred on the content instead of on the fighter, leaving it hovering in
 * the middle of the box it is meant to be lying at the bottom of.
 *
 * The dagger's own poses live here too, because they are the same trick: the
 * thrust's anticipation and dash, the shoryuken's rise and the dragon ride are
 * the character's own sheet, rotated and stretched to read as the move — and
 * they will be replaced by the same human art that replaces the hit poses.
 */
function createHeroPoses(
	renderer: Renderer,
	sheet: string,
	frames: Texture[],
): void {
	// The face-on frame. Staggering is not a direction, so the fighter turns to
	// the camera for it, exactly as the existing `turn` clip does.
	const source = frames[4] ?? frames[0];
	if (!source) return;

	// The pose canvas follows the sheet's own cells, not the collider: a pose
	// is a texture drawn at the same scale as the walk frames, so it must
	// cover the same box the walk frames do. Lia and Jeffs ship 2x art
	// (64x96 cells);
	// Anands' hand-drawn art is 168x152, and her real frames take over the
	// poses the art actually covers (disabled, the thrust, the shoryuken, the
	// ride) — the poses left over (downed, the sword states) are still cut
	// from her own face-on frame, so they line up with the new art too.
	const cell = SHEET_CELLS[sheet] ?? { w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
	const CW = cell.w;
	const CH = cell.h;
	/** Padding around the body, so a prone or tilted pose cannot crop the canvas. */
	const PAD = 8;
	/**
	 * An invisible rect centred on the body centre.
	 *
	 * `generateTexture` bakes a container's *bounds*, so this is what fixes them:
	 * without it the canvas would shrink-wrap whatever was drawn, and every pose
	 * would end up centred on a different point.
	 */
	const canvas = () =>
		new Graphics()
			.rect(-PAD, -PAD, CW + PAD * 2, CH + PAD * 2)
			.fill({ color: 0x000000, alpha: 0 });

	const pose = (name: HeroPose, node: Container) => {
		const texture = bakeShared(renderer, node);
		poseTextures.set(`${sheet}:${name}`, texture);
		node.destroy({ children: true });
		// The dude's poses keep their old TEX keys, so the pre-hero callers
		// (the ultimate cinematic's CSS aside) keep working unchanged.
		if (sheet === "dude") {
			generated.set(TEX[name] ?? `dude_${name}`, texture);
		}
	};

	// ---- staggered ----
	const stagger = new Container();
	stagger.addChild(canvas());

	const hurt = new Sprite(source);
	hurt.anchor.set(0.5, 1);
	// Rocked back off balance, and flushed red. Both read at a glance and at speed,
	// which is the only thing a placeholder has to do.
	hurt.position.set(CW / 2, CH);
	hurt.rotation = -0.16;
	hurt.tint = 0xff8f8f;
	stagger.addChild(hurt);

	// Stars over the head: the one piece that is not the original sprite, because
	// "disabled" has to be distinguishable from "tinted by a filter".
	const stars = new Graphics();
	for (const [sx, sy, r] of [
		[7, 5, 3],
		[16, 2, 4],
		[25, 6, 3],
	] as const) {
		stars.poly([sx, sy - r, sx + r, sy, sx, sy + r, sx - r, sy]);
	}
	stars.fill(0xffe066);
	stagger.addChild(stars);

	pose("disabled", stagger);

	// ---- on the floor ----
	const down = new Container();
	down.addChild(canvas());

	const prone = new Sprite(source);
	prone.anchor.set(0.5, 1);
	// A quarter turn, then placed so the body lies along the bottom of the canvas:
	// rotating about the feet maps the sprite's height onto x, so the position is
	// where the *feet* end up, not where the head does.
	prone.rotation = -Math.PI / 2;
	prone.position.set(CW + PAD, CH - CW / 2);
	prone.tint = 0xd08a8a;
	down.addChild(prone);

	const dust = new Graphics();
	dust.ellipse(CW / 2, CH - 1, 17, 4);
	dust.fill({ color: 0xffffff, alpha: 0.35 });
	down.addChild(dust);

	pose("downed", down);

	// ---- helpless: the guard-break pose ----
	//
	// A guard that stopped a swing is a full second of "raise the sword and
	// stand there". It must read differently from a stagger — this is not
	// reeling from a hit, it is the sword itself being useless — so the body
	// rocks *back* and up, arms toward the sky, washed pale.
	const helpless = new Container();
	helpless.addChild(canvas());

	const raised = new Sprite(source);
	raised.anchor.set(0.5, 1);
	raised.position.set(CW / 2, CH);
	raised.rotation = 0.18;
	raised.tint = 0xfff2d8;
	helpless.addChild(raised);

	// The sword it cannot use, drawn as a pale line up beside the head.
	const helplessBlade = new Graphics();
	helplessBlade.moveTo(CW / 2 + 3, 8).lineTo(CW / 2 + 3, 42);
	helplessBlade.stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
	helpless.addChild(helplessBlade);

	pose("helpless", helpless);

	// ---- slam: the massive's swing ----
	//
	// The fighter leaning into the blade as it comes down: the swing is only
	// 220ms, so the body reads as committed — leaning forward, weight down —
	// rather than as a standing figure waving a sword. The blade itself is
	// drawn by `MeleeFx`; this is the body that commits to it.
	const slam = new Container();
	slam.addChild(canvas());

	const smashing = new Sprite(source);
	smashing.anchor.set(0.5, 1);
	smashing.position.set(CW / 2, CH);
	smashing.rotation = 0.5;
	smashing.tint = 0xfff6e0;
	slam.addChild(smashing);

	pose("slam", slam);

	// ---- plunge: the dive pose ----
	//
	// The bomb is a body going down faster than it can fall, sword first. The
	// strip's face-on frame, canted forward and down, reads as a dive against
	// the vertical streaks of speed — the blade itself is drawn by `MeleeFx`.
	const plunge = new Container();
	plunge.addChild(canvas());

	const diving = new Sprite(source);
	diving.anchor.set(0.5, 1);
	diving.position.set(CW / 2, CH);
	diving.rotation = 0.42;
	diving.tint = 0xffffff;
	plunge.addChild(diving);

	pose("plunge", plunge);

	// ---- stuck: planted after a bomb ----
	//
	// The price of a bomb: bent over the sword stuck in the ground, going
	// nowhere, for a duration the blast itself decided. The crater it stands in
	// is part of the pose.
	const stuck = new Container();
	stuck.addChild(canvas());

	const planted = new Sprite(source);
	planted.anchor.set(0.5, 1);
	planted.position.set(CW / 2, CH);
	planted.rotation = 0.62;
	planted.tint = 0xe8e4da;
	stuck.addChild(planted);

	const crater = new Graphics();
	crater.ellipse(CW / 2, CH - 1, 19, 5);
	crater.fill({ color: 0xffffff, alpha: 0.45 });
	stuck.addChild(crater);

	pose("stuck", stuck);

	// ---- the dagger's own poses ----
	//
	// The thrust's anticipation: the dagger cocked back beside the hip, the
	// body leaning into the lunge about to come. The whole move's tell — the
	// foe reads this pose and jumps — so it has to be a pose, not a tint.
	const windup = new Container();
	windup.addChild(canvas());

	const cocked = new Sprite(source);
	cocked.anchor.set(0.5, 1);
	cocked.position.set(CW / 2, CH);
	cocked.rotation = -0.22;
	cocked.tint = 0xdcecff;
	windup.addChild(cocked);

	const glint = new Graphics();
	glint.moveTo(CW / 2 + 10, 34).lineTo(CW / 2 + 2, 42);
	glint.stroke({ width: 2, color: 0x9fd8ff, alpha: 0.9 });
	windup.addChild(glint);

	pose("thrustWindup", windup);

	// The thrust's dash: a horizontal streak — the body rotated onto its side
	// along the line of the lunge, stretched by the speed.
	const dash = new Container();
	dash.addChild(canvas());

	const streaking = new Sprite(source);
	streaking.anchor.set(0.5, 1);
	streaking.position.set(CW / 2, CH);
	streaking.rotation = Math.PI / 2;
	streaking.scale.set(1.25, 1);
	streaking.tint = 0xbde8ff;
	dash.addChild(streaking);

	const streak = new Graphics();
	streak.rect(-2, 20, CW + 20, 6);
	streak.fill({ color: 0x59d0ff, alpha: 0.55 });
	dash.addChild(streak);

	pose("thrustDash", dash);

	// The shoryuken's rise: canted up and forward, dagger leading into the
	// flame — the body is going up and the pose has to say so.
	const rise = new Container();
	rise.addChild(canvas());

	const rising = new Sprite(source);
	rising.anchor.set(0.5, 1);
	rising.position.set(CW / 2, CH);
	rising.rotation = -0.7;
	rising.tint = 0xffe3c4;
	rise.addChild(rising);

	pose("shoryukenRise", rise);

	// The dragon ride: the rider is cargo on the line — canted forward along
	// it, gold-washed so the pose and the dragon are recognisably one thing.
	const ride = new Container();
	ride.addChild(canvas());

	const riding = new Sprite(source);
	riding.anchor.set(0.5, 1);
	riding.position.set(CW / 2, CH);
	riding.rotation = Math.PI / 2;
	riding.tint = 0xffe9a8;
	ride.addChild(riding);

	pose("dragonRide", ride);
}
