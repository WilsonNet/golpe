import type Phaser from "phaser";
import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	platforms,
	WORLD_BOTTOM,
	WORLD_RIGHT,
} from "../simulation/Arena";

/**
 * Draws the arena straight from the collision data.
 *
 * Hand-placing platform sprites is how visuals and colliders drift apart —
 * the old scene drew a 400px-wide image for a 100px-wide collider, so players
 * appeared to walk through solid ground and stand on thin air. Everything here
 * is derived from `platforms`, so the two cannot disagree.
 */
export function drawArena(
	scene: Phaser.Scene,
	options: { background?: string; platformTexture?: string } = {},
) {
	const { background = "sky", platformTexture = "ground" } = options;

	scene.add.image(WORLD_RIGHT / 2, WORLD_BOTTOM / 2, background);

	for (const p of platforms) {
		scene.add
			.image(p.x + p.w / 2, p.y + p.h / 2, platformTexture)
			.setDisplaySize(p.w, p.h);
	}
}

/**
 * Simulation positions are AABB top-left; Phaser sprites are centre-origin.
 * Every sprite that follows a physics body must go through this, or it renders
 * half a body away from where it actually collides.
 */
export function syncSpriteToBody(
	sprite: Phaser.GameObjects.Components.Transform,
	bodyX: number,
	bodyY: number,
) {
	sprite.setPosition(bodyX + PLAYER_WIDTH / 2, bodyY + PLAYER_HEIGHT / 2);
}

/** Centre point of a physics body, for aiming and bullet spawns. */
export function bodyCentre(bodyX: number, bodyY: number) {
	return { x: bodyX + PLAYER_WIDTH / 2, y: bodyY + PLAYER_HEIGHT / 2 };
}

/** Debug overlay: outlines every collider so mismatches are obvious on sight. */
export function drawColliderDebug(
	scene: Phaser.Scene,
): Phaser.GameObjects.Graphics {
	const g = scene.add.graphics();
	g.lineStyle(1, 0x00ff00, 0.8);
	for (const p of platforms) {
		g.strokeRect(p.x, p.y, p.w, p.h);
	}
	g.setDepth(1000);
	return g;
}
