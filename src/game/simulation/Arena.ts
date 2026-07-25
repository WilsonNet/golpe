/**
 * The arena: one source of truth for world size, solid geometry and the
 * rectangle maths everything else (collision, rendering, line-of-sight,
 * bullets) is built on.
 *
 * Renderers MUST draw from `platforms` rather than hand-placing sprites —
 * that is what keeps what you see identical to what you collide with.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const WORLD_LEFT = 0;
export const WORLD_RIGHT = 800;
export const WORLD_TOP = 0;
export const WORLD_BOTTOM = 600;

export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 48;

/** Ledge thickness. Thick enough that a player can make side contact and wall jump. */
const LEDGE_H = 24;

/**
 * Symmetric arena, laid out so every surface is reachable with a single jump
 * from the surface below it (see JUMP_HEIGHT_PX in Physics.ts).
 *
 *   y=170            [ top ]
 *   y=250   [ hi-L ]          [ hi-R ]
 *   y=360            [ mid ]
 *   y=450   [ lo-L ]          [ lo-R ]
 *   y=468        |P|      |P|              <- ground-level cover
 *   y=568   ==================== ground ====================
 */
export const GROUND: Rect = { x: 0, y: 568, w: 800, h: 32 };
export const LOW_LEFT: Rect = { x: 90, y: 450, w: 130, h: LEDGE_H };
export const LOW_RIGHT: Rect = { x: 580, y: 450, w: 130, h: LEDGE_H };
export const MID: Rect = { x: 330, y: 360, w: 140, h: LEDGE_H };
export const HIGH_LEFT: Rect = { x: 60, y: 250, w: 120, h: LEDGE_H };
export const HIGH_RIGHT: Rect = { x: 620, y: 250, w: 120, h: LEDGE_H };
export const TOP_CENTRE: Rect = { x: 350, y: 170, w: 100, h: LEDGE_H };

/**
 * Ground-level pillars: cover to break line-of-sight, plus wall-jump surfaces
 * and a route up that does not need the outer ledges.
 *
 * Keep them clear of the ledges above and either side: a gap narrower than
 * PLAYER_WIDTH under an overhang is a trap that pins the AI in place, which is
 * exactly what a 30px gap here used to do.
 */
export const PILLAR_LEFT: Rect = { x: 280, y: 468, w: 24, h: 100 };
export const PILLAR_RIGHT: Rect = { x: 496, y: 468, w: 24, h: 100 };

/**
 * Every solid in the arena.
 *
 * Named rather than anonymous so nothing has to refer to a surface by index.
 * Tests used to reach for `platforms[3]` with the coordinates copied into a
 * trailing comment — which is both unreadable and a lie waiting to happen the
 * next time the list is reordered.
 */
export const platforms: readonly Rect[] = [
	GROUND,
	LOW_LEFT,
	LOW_RIGHT,
	MID,
	HIGH_LEFT,
	HIGH_RIGHT,
	TOP_CENTRE,
	PILLAR_LEFT,
	PILLAR_RIGHT,
];

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
	return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function pointInAnyPlatform(px: number, py: number): boolean {
	for (const p of platforms) {
		if (pointInRect(px, py, p)) return true;
	}
	return false;
}

/**
 * Sampled line-of-sight test. Used by the AI to decide whether it can shoot,
 * and by diagnostics. `samples` trades accuracy for cost.
 */
export function hasLineOfSight(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	samples = 24,
): boolean {
	for (let i = 1; i < samples; i++) {
		const t = i / samples;
		const x = fromX + (toX - fromX) * t;
		const y = fromY + (toY - fromY) * t;
		if (pointInAnyPlatform(x, y)) return false;
	}
	return true;
}

/**
 * Every horizontal gap between two solids that overlap vertically.
 *
 * A gap narrower than PLAYER_WIDTH is a pocket an actor can walk into and then
 * be pinned inside — invisible on screen, but it stops the AI dead. Tests
 * assert against this so level edits cannot reintroduce one.
 */
export function narrowGaps(minWidth = PLAYER_WIDTH): {
	a: Rect;
	b: Rect;
	gap: number;
}[] {
	const found: { a: Rect; b: Rect; gap: number }[] = [];
	platforms.forEach((a, i) => {
		for (const b of platforms.slice(i + 1)) {
			const verticallyOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
			if (!verticallyOverlap) continue;

			const gap = a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
			if (gap > 0 && gap < minWidth) found.push({ a, b, gap });
		}
	});
	return found;
}

/** Player-sized AABB at a position. */
export function playerBox(x: number, y: number): Rect {
	return { x, y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
}

/**
 * How deep a player box is buried inside solid geometry, in px.
 * Should be 0 every frame — diagnostics assert on this to catch collision
 * regressions that jitter thresholds cannot see.
 */
export function penetrationDepth(x: number, y: number): number {
	const box = playerBox(x, y);
	let worst = 0;
	for (const p of platforms) {
		if (!rectsOverlap(box, p)) continue;
		const overlapX = Math.min(box.x + box.w, p.x + p.w) - Math.max(box.x, p.x);
		const overlapY = Math.min(box.y + box.h, p.y + p.h) - Math.max(box.y, p.y);
		worst = Math.max(worst, Math.min(overlapX, overlapY));
	}
	return worst;
}
