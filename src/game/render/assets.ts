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
	fireball: "fireball",
	platform: "platform",
	sky: "sky",
	spark: "fx_spark",
	shard: "fx_shard",
	ring: "fx_ring",
	arc: "fx_arc",
	blade: "fx_blade",
	guard: "fx_guard",
	/** Staggered by a sword hit. Derived from the dude strip — see `createHitTextures`. */
	disabled: "dude_disabled",
	/** Flat on the floor, after the chain's finisher. */
	downed: "dude_downed",
} as const;

/** The `dude` strip, sliced into its nine 32x48 frames. */
export let dudeFrames: Texture[] = [];

const generated = new Map<string, Texture>();

export function tex(key: string): Texture {
	const made = generated.get(key);
	if (made) return made;
	return Assets.get(key) ?? Texture.EMPTY;
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

	// The dude sheet is a plain horizontal strip with no atlas JSON, so the
	// frames are cut by hand: 0-3 walk left, 4 face-on, 5-8 walk right.
	const sheet = Assets.get(TEX.dude) as Texture;
	dudeFrames = [];
	for (let i = 0; i < 9; i++) {
		dudeFrames.push(
			new Texture({
				source: sheet.source,
				frame: new Rectangle(i * PLAYER_WIDTH, 0, PLAYER_WIDTH, PLAYER_HEIGHT),
			}),
		);
	}
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
	generated.set(key, renderer.generateTexture(node));
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

	// The guard arc shown while blocking.
	const guard = new Graphics();
	guard.arc(28, 32, 26, Math.PI - 1.1, Math.PI + 1.1, false);
	guard.stroke({ width: 5, color: 0xffffff });
	bake(renderer, TEX.guard, guard);

	createHitTextures(renderer);
}

/**
 * The two "you have been hit" sprites, drawn *from the dude sheet itself*.
 *
 * Every sword hit now puts its target into a disabled state, and a state nobody
 * can see is a state that does not exist: through the whole LAN playtest the
 * sword landed, the fighter kept walking, and the hit read as nothing happening.
 * These are placeholders in the honest sense — they are the shipped character,
 * flushed and knocked about, so they line up perfectly with the walk cycle and
 * are replaced by deleting this function when the real art lands.
 *
 * Both bake onto the same canvas, and it is **centred on the body's centre** —
 * `syncSpriteToBody` centres a sprite on the collider, so anything drawn off that
 * centre is drawn off the fighter. That is also why the canvas is bigger than the
 * body: a fighter lying down is 48px long inside a 32px-wide collider, and a
 * texture cropped to its own content would have been re-centred on the content
 * instead of on the fighter, leaving it hovering in the middle of the box it is
 * meant to be lying at the bottom of.
 */
function createHitTextures(renderer: Renderer): void {
	// The face-on frame. Staggering is not a direction, so the fighter turns to
	// the camera for it, exactly as the existing `turn` clip does.
	const source = dudeFrames[4] ?? dudeFrames[0];
	if (!source) return;

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
			.rect(-PAD, -PAD, PLAYER_WIDTH + PAD * 2, PLAYER_HEIGHT + PAD * 2)
			.fill({ color: 0x000000, alpha: 0 });

	// ---- staggered ----
	const stagger = new Container();
	stagger.addChild(canvas());

	const hurt = new Sprite(source);
	hurt.anchor.set(0.5, 1);
	// Rocked back off balance, and flushed red. Both read at a glance and at speed,
	// which is the only thing a placeholder has to do.
	hurt.position.set(PLAYER_WIDTH / 2, PLAYER_HEIGHT);
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

	bake(renderer, TEX.disabled, stagger);

	// ---- on the floor ----
	const down = new Container();
	down.addChild(canvas());

	const prone = new Sprite(source);
	prone.anchor.set(0.5, 1);
	// A quarter turn, then placed so the body lies along the bottom of the canvas:
	// rotating about the feet maps the sprite's height onto x, so the position is
	// where the *feet* end up, not where the head does.
	prone.rotation = -Math.PI / 2;
	prone.position.set(PLAYER_WIDTH + PAD, PLAYER_HEIGHT - PLAYER_WIDTH / 2);
	prone.tint = 0xd08a8a;
	down.addChild(prone);

	const dust = new Graphics();
	dust.ellipse(PLAYER_WIDTH / 2, PLAYER_HEIGHT - 1, 17, 4);
	dust.fill({ color: 0xffffff, alpha: 0.35 });
	down.addChild(dust);

	bake(renderer, TEX.downed, down);
}
