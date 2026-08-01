import { type Container, Graphics, Sprite } from "pixi.js";
import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type World,
} from "../simulation/Arena";
import { TEX, tex } from "./assets";

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
 * disagree.
 *
 * Re-entrant: children are destroyed and rebuilt, so a client that learns the
 * room's authoritative screen count after connecting (the `match` message can
 * disagree with `?screen=`) redraws the same two containers in place.
 */
export function drawArena(
	background: Container,
	arena: Container,
	world: World = DEFAULT_WORLD,
) {
	background.removeChildren().forEach((c) => {
		c.destroy({ children: true });
	});
	arena.removeChildren().forEach((c) => {
		c.destroy({ children: true });
	});

	const sky = new Sprite(tex(TEX.sky));
	sky.anchor.set(0.5);
	sky.position.set(world.right / 2, world.bottom / 2);
	sky.width = world.right;
	sky.height = world.bottom;
	background.addChild(sky);

	for (const p of world.platforms) {
		const s = new Sprite(tex(TEX.platform));
		s.anchor.set(0.5);
		s.position.set(p.x + p.w / 2, p.y + p.h / 2);
		s.width = p.w;
		s.height = p.h;
		arena.addChild(s);
	}
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

/** Debug overlay: outlines every collider so mismatches are obvious on sight. */
export function drawColliderDebug(
	layer: Container,
	world: World = DEFAULT_WORLD,
): Graphics {
	const g = new Graphics();
	for (const p of world.platforms) {
		g.rect(p.x, p.y, p.w, p.h);
	}
	g.stroke({ width: 1, color: 0x00ff00, alpha: 0.8 });
	g.zIndex = 1000;
	layer.addChild(g);
	return g;
}
