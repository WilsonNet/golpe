/**
 * Axis-separated swept AABB movement.
 *
 * One routine resolves every solid contact for every actor (players, AI,
 * anything box-shaped). Moving each axis independently and resolving against
 * the solids after each move is what makes contact flags trustworthy:
 * a wall is a wall whether or not you happen to be standing on the floor.
 */

import { DEFAULT_WORLD, type Rect, rectsOverlap, type World } from "./Arena.js";

export type WallSide = "none" | "left" | "right";

export interface Contacts {
	/** Standing on a solid (or the world floor). */
	grounded: boolean;
	/** Head hit a solid (or the world ceiling). */
	ceiling: boolean;
	/** Which side of the actor a wall is on — the side you jump *away* from. */
	wall: WallSide;
}

export interface MovingBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Longest movement allowed in a single resolution pass. Anything faster is
 * split into sub-steps so a fast actor cannot tunnel through thin geometry.
 * Chosen below the thinnest solid dimension in the arena.
 */
const MAX_STEP_PX = 12;

function collidesAt(box: MovingBox, solids: readonly Rect[]): Rect | null {
	for (const s of solids) {
		if (rectsOverlap(box, s)) return s;
	}
	return null;
}

/**
 * Move `box` by (dx, dy), resolving against `world.platforms` and the world
 * bounds. Mutates `box` and returns what it ended up touching.
 *
 * The world is a parameter rather than an import so a room can be wider than
 * the default single screen — client and server pass the same `World` object,
 * which is what keeps their physics identical.
 */
export function moveAndCollide(
	box: MovingBox,
	dx: number,
	dy: number,
	world: World = DEFAULT_WORLD,
): Contacts {
	const contacts: Contacts = { grounded: false, ceiling: false, wall: "none" };
	const solids = world.platforms;

	const steps = Math.max(
		1,
		Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_STEP_PX),
	);
	const stepX = dx / steps;
	const stepY = dy / steps;

	for (let i = 0; i < steps; i++) {
		// ---- X axis ----
		if (stepX !== 0) {
			box.x += stepX;
			const hit = collidesAt(box, solids);
			if (hit) {
				if (stepX > 0) {
					box.x = hit.x - box.w;
					contacts.wall = "right";
				} else {
					box.x = hit.x + hit.w;
					contacts.wall = "left";
				}
			}
		}

		// World side walls are wall-jumpable surfaces too.
		if (box.x < world.left) {
			box.x = world.left;
			contacts.wall = "left";
		} else if (box.x + box.w > world.right) {
			box.x = world.right - box.w;
			contacts.wall = "right";
		}

		// ---- Y axis ----
		if (stepY !== 0) {
			box.y += stepY;
			const hit = collidesAt(box, solids);
			if (hit) {
				if (stepY > 0) {
					box.y = hit.y - box.h;
					contacts.grounded = true;
				} else {
					box.y = hit.y + hit.h;
					contacts.ceiling = true;
				}
			}
		}

		if (box.y + box.h > world.bottom) {
			box.y = world.bottom - box.h;
			contacts.grounded = true;
		} else if (box.y < world.top) {
			box.y = world.top;
			contacts.ceiling = true;
		}
	}

	return contacts;
}

/**
 * Push a box out of any solid it overlaps, along the shallowest axis.
 *
 * Interpolated positions are not produced by the simulation — a straight line
 * between two legal snapshots can still cut through a corner — so remote
 * entities get depenetrated before they are drawn.
 */
export function resolveOverlap(
	box: MovingBox,
	world: World = DEFAULT_WORLD,
): boolean {
	let moved = false;
	for (const s of world.platforms) {
		if (!rectsOverlap(box, s)) continue;

		const pushLeft = s.x - (box.x + box.w); // negative
		const pushRight = s.x + s.w - box.x; // positive
		const pushUp = s.y - (box.y + box.h); // negative
		const pushDown = s.y + s.h - box.y; // positive

		const dx = Math.abs(pushLeft) < Math.abs(pushRight) ? pushLeft : pushRight;
		const dy = Math.abs(pushUp) < Math.abs(pushDown) ? pushUp : pushDown;

		if (Math.abs(dx) < Math.abs(dy)) {
			box.x += dx;
		} else {
			box.y += dy;
		}
		moved = true;
	}
	return moved;
}

/**
 * Is there a solid directly beside the box, within `reach` px?
 * Used to keep wall contact while sliding, when horizontal velocity has
 * already been zeroed by the collision that put us there.
 */
export function probeWall(
	box: MovingBox,
	reach = 2,
	world: World = DEFAULT_WORLD,
): WallSide {
	const right: MovingBox = { ...box, x: box.x + reach };
	if (collidesAt(right, world.platforms) || right.x + right.w >= world.right) {
		return "right";
	}
	const left: MovingBox = { ...box, x: box.x - reach };
	if (collidesAt(left, world.platforms) || left.x <= world.left) {
		return "left";
	}
	return "none";
}
