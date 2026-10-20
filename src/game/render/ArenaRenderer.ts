import type { Container } from "pixi.js";
import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "../simulation/Arena";
import { drawPlatforms } from "./PlatformArt";
import { type TileStyle, tileStyleChoice } from "./tileStyle";

/** Anything with a position — a Pixi display object, or a plain test double. */
export interface Positionable {
	x: number;
	y: number;
}

/**
 * Draws the arena straight from the collision data.
 *
 * Hand-placing platform sprites is how visuals and colliders drift apart —
 * an earlier version drew a 400px-wide image for a 100px-wide collider, so
 * players appeared to walk through solid ground and stand on thin air.
 * Everything here is derived from `world.platforms`, so the two cannot
 * disagree. The platform layer itself is `PlatformArt`: it consumes the same
 * rectangles through the tilemap format and chooses the Waterfront tiles or the
 * flat competitive blocks.
 *
 * The **sky is not drawn here**: `Skybox` owns it, because the backdrop has
 * parallax and animation that the arena's geometry does not. `background` is
 * still cleared here so a rebuilt arena cannot leave a stale backdrop behind.
 *
 * Re-entrant: children are destroyed and rebuilt, so a client that learns the
 * room's authoritative screen count after connecting (the `match` message can
 * disagree with `?screen=`) redraws the same two containers in place.
 */
export function drawArena(
	background: Container,
	arena: Container,
	world: World = DEFAULT_WORLD,
	style: TileStyle = tileStyleChoice(),
) {
	background.removeChildren().forEach((c) => {
		c.destroy({ children: true });
	});
	drawPlatforms(arena, world, style);
}

/**
 * Simulation positions are AABB top-left; sprites are centre-origin.
 * Every sprite that follows a physics body must go through this, or it renders
 * half a body away from where it actually collides.
 */
export function syncSpriteToBody(
	sprite: Positionable,
	bodyX: number,
	bodyY: number,
) {
	sprite.x = bodyX + PLAYER_WIDTH / 2;
	sprite.y = bodyY + PLAYER_HEIGHT / 2;
}

/** Centre point of a physics body, for aiming and bullet spawns. */
export function bodyCentre(bodyX: number, bodyY: number) {
	return { x: bodyX + PLAYER_WIDTH / 2, y: bodyY + PLAYER_HEIGHT / 2 };
}
