/**
 * Texture loading and generation.
 *
 * Two kinds live here: real artwork loaded from `public/assets`, and the
 * placeholder combat art generated in code. Keeping both behind one module
 * means swapping a placeholder for a real sprite is a one-line change here and
 * touches nothing in the renderer or the systems.
 */

import { Assets, Graphics, Rectangle, type Renderer, Texture } from "pixi.js";
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

function bake(renderer: Renderer, key: string, g: Graphics) {
	generated.set(key, renderer.generateTexture(g));
	g.destroy();
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
}
