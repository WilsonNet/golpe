/**
 * A cast shadow under every fighter, tinted with their side's colour.
 *
 * Presentation only, like everything in `render/` — nothing here is read back by
 * the simulation, and every number in it is derived from arena geometry the
 * simulation already owns.
 *
 * ## Why a shadow, of all things
 *
 * Team colour has to be readable *without being read*. A name tells you whose
 * fighter that is once you look at the nameplate; a shadow tells you before you
 * have looked at anything, because it sits at the fighter's feet where you are
 * already watching for the ledge they are about to land on. It is also the one
 * place a saturated colour can go without competing: nothing else in the game is
 * drawn on the floor, so a blue and an orange puddle never sit on top of a swing
 * trail, a health bar or the sky.
 *
 * It earns its place twice, which is the argument for building it rather than
 * simply tinting more particles. A grounded fighter's shadow is under their
 * feet; an airborne one's is on the surface below, smaller and fainter and
 * offset — so it also answers "how high is that, and where will they land",
 * which this game had no way to show at all.
 *
 * ## How the surface is found
 *
 * A straight scan of `world.platforms` for the highest solid the body overlaps
 * horizontally that is at or below its feet. That is a handful of rectangle
 * tests per fighter per frame, and the ground spans the whole arena so it always
 * terminates. **Drawn from the collider data**, like the arena itself — a shadow
 * placed on a hand-authored floor height would be the same drift the renderer
 * exists to avoid.
 */

import { type Container, Sprite } from "pixi.js";
import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "../simulation/Arena";
import type { TeamId } from "../simulation/Teams";
import { teamShadowColor } from "../teamPalette";
import { TEX, tex } from "./assets";

/** Shadow width at the fighter's feet, as a fraction of the sprite's own width. */
const GROUND_SCALE = (PLAYER_WIDTH * 1.15) / 64;

/** Alpha directly underfoot. Enough to read the colour, not enough to be a puddle. */
const GROUND_ALPHA = 0.55;

/**
 * The height at which a shadow has shrunk and faded as far as it will go.
 *
 * A jump apexes around 150px and a fall off the top ledge is ~400px, so this is
 * roughly "one jump": clearing a ledge visibly detaches the shadow, and a long
 * drop does not fade it to nothing on the way down.
 */
const MAX_HEIGHT_PX = 220;

/** How far the shadow slides per pixel of height — the light is high and to the left. */
const SKEW_PER_PX = 0.055;

export class Shadows {
	private readonly sprites = new Map<string, Sprite>();

	constructor(
		private readonly layer: Container,
		private readonly world: World = DEFAULT_WORLD,
	) {}

	private sprite(key: string): Sprite {
		const existing = this.sprites.get(key);
		if (existing) return existing;
		const s = new Sprite(tex(TEX.shadow));
		s.anchor.set(0.5);
		this.layer.addChild(s);
		this.sprites.set(key, s);
		return s;
	}

	/**
	 * Place one fighter's shadow.
	 *
	 * `bodyX`/`bodyY` are *drawn* coordinates, like the nameplates and the camera
	 * — a shadow that used simulation state while the sprite used a smoothed one
	 * would slide out from under its own fighter by exactly the correction the
	 * smoother is hiding.
	 */
	sync(
		key: string,
		bodyX: number,
		bodyY: number,
		team: TeamId | null,
		alive: boolean,
	) {
		const s = this.sprite(key);
		const centreX = bodyX + PLAYER_WIDTH / 2;
		const feetY = bodyY + PLAYER_HEIGHT;
		const surfaceY = this.surfaceUnder(bodyX, feetY);

		const height = Math.max(0, surfaceY - feetY);
		// 0 underfoot, 1 at a jump's worth of air and beyond.
		const t = Math.min(1, height / MAX_HEIGHT_PX);

		s.visible = true;
		// A couple of pixels *below* the surface, not on it. The sprite is an
		// ellipse with a centre anchor, so sitting it exactly on the line put half
		// of it in the air off the front of a ledge, which reads as a floating disc
		// rather than as shade on the ground.
		s.position.set(centreX + height * SKEW_PER_PX, surfaceY + 2);
		s.scale.set(GROUND_SCALE * (1 - 0.42 * t), GROUND_SCALE * (1 - 0.42 * t));
		// A dead fighter's sprite fades to 0.3; its shadow follows, or a corpse
		// leaves a brighter mark on the floor than the fighter standing next to it.
		s.alpha = GROUND_ALPHA * (1 - 0.62 * t) * (alive ? 1 : 0.35);
		s.tint = teamShadowColor(team);
	}

	/**
	 * The top of the highest solid at or below these feet, within the body's own
	 * width. The ground spans the arena, so there is always one.
	 */
	private surfaceUnder(bodyX: number, feetY: number): number {
		let best = this.world.bottom;
		for (const p of this.world.platforms) {
			if (p.x > bodyX + PLAYER_WIDTH || p.x + p.w < bodyX) continue;
			// `- 0.5` so a fighter standing exactly on a ledge still matches it
			// rather than casting through onto the floor below.
			if (p.y < feetY - 0.5) continue;
			if (p.y < best) best = p.y;
		}
		return best;
	}

	/** Release a fighter's shadow. Fighters are transient; their sprites must not be. */
	forget(key: string) {
		const s = this.sprites.get(key);
		if (!s) return;
		s.destroy();
		this.sprites.delete(key);
	}

	reset() {
		for (const key of [...this.sprites.keys()]) this.forget(key);
	}
}
