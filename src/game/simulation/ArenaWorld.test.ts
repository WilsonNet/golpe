import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	applyWorld,
	buildWorld,
	MAX_SCREENS,
	narrowGaps,
	PLAYER_WIDTH,
	penetrationDepth,
	type Rect,
	SCREEN_W,
	WORLD_BOTTOM,
} from "./Arena.js";

/** The base layout for one screen: ground + eight ledges/pillars. */
const BASE_PLATFORM_COUNT = 1 + 8;
const BASE_SPAWN_COUNT = 17;

/** A screen count the arena is allowed to be built as. */
const screenCount = fc.integer({ min: 1, max: MAX_SCREENS });

/** Does any solid from `a` overlap any solid from `b`? */
function overlapsAny(rect: Rect, solids: readonly Rect[]): boolean {
	return solids.some(
		(s) =>
			rect.x < s.x + s.w &&
			rect.x + rect.w > s.x &&
			rect.y < s.y + s.h &&
			rect.y + rect.h > s.y,
	);
}

describe("buildWorld", () => {
	it("builds the classic single-screen arena by default", () => {
		const w = buildWorld(1);
		expect(w.screens).toBe(1);
		expect(w.right).toBe(SCREEN_W);
		expect(w.bottom).toBe(WORLD_BOTTOM);
		expect(w.platforms).toHaveLength(BASE_PLATFORM_COUNT);
		expect(w.spawnPoints).toHaveLength(BASE_SPAWN_COUNT);
	});

	it("tiles one layout per screen, mirrored on odd screens", () => {
		const w = buildWorld(3);
		expect(w.screens).toBe(3);
		expect(w.right).toBe(3 * SCREEN_W);
		// The ground is one span across the whole width; everything else tiles.
		expect(w.platforms).toHaveLength(1 + 8 * 3);
		expect(w.spawnPoints).toHaveLength(BASE_SPAWN_COUNT * 3);

		// The ground truly spans the whole world.
		expect(w.platforms[0]).toMatchObject({ x: 0, y: 568, w: 3 * SCREEN_W });

		// Every even screen matches screen 0's pattern...
		const base = buildWorld(1);
		for (let screen = 0; screen < 3; screen += 2) {
			for (const plat of base.platforms.slice(1)) {
				expect(w.platforms).toContainEqual({
					x: screen * SCREEN_W + plat.x,
					y: plat.y,
					w: plat.w,
					h: plat.h,
				});
			}
		}

		// ...and every odd screen carries the mirror of that pattern.
		const mirrorX = (x: number, w: number) => SCREEN_W - (x + w);
		for (const plat of base.platforms.slice(1)) {
			expect(w.platforms).toContainEqual({
				x: SCREEN_W + mirrorX(plat.x, plat.w),
				y: plat.y,
				w: plat.w,
				h: plat.h,
			});
		}
	});

	/**
	 * One layout per screen, whatever the width — swept over every legal screen
	 * count rather than the handful a human would think to sample. The ground
	 * spans the whole world, and the platforms and spawn points scale with the
	 * width.
	 */
	test.prop([screenCount])("tiles exactly one layout per screen", (n) => {
		const w = buildWorld(n);
		expect(w.screens).toBe(n);
		expect(w.right).toBe(n * SCREEN_W);
		expect(w.platforms).toHaveLength(1 + 8 * n);
		expect(w.spawnPoints).toHaveLength(BASE_SPAWN_COUNT * n);
		expect(w.platforms[0]).toMatchObject({ x: 0, y: 568, w: n * SCREEN_W });
	});

	it("clamps absurd screen counts", () => {
		expect(buildWorld(0).screens).toBe(1);
		expect(buildWorld(-4).screens).toBe(1);
		expect(buildWorld(99).screens).toBe(MAX_SCREENS);
	});

	/**
	 * Every spawn on a platform, clear of pillars — the geometric invariant
	 * that keeps a respawn from depenetrating on tick one. Swept over every
	 * legal arena width.
	 */
	test.prop([screenCount])(
		"keeps every spawn on a platform, clear of pillars, at any size",
		(n) => {
			const w = buildWorld(n);
			const pillars = w.platforms.filter((p) => p.h > 2 * PLAYER_WIDTH);
			for (const s of w.spawnPoints) {
				// Inside the world, standing on a surface (the box rests on the
				// platform top, so it overlaps nothing — penetration must be zero).
				expect(s.x).toBeGreaterThanOrEqual(0);
				expect(s.x + PLAYER_WIDTH).toBeLessThanOrEqual(w.right);
				expect(penetrationDepth(s.x, s.y, w)).toBe(0);
				// A spawn inside geometry is a teleport on the first tick; a spawn
				// overlapping a pillar is that, in the loudest direction.
				const box = { x: s.x, y: s.y, w: PLAYER_WIDTH, h: 48 };
				expect(overlapsAny(box, pillars)).toBe(false);
			}
		},
	);

	test.prop([screenCount])(
		"leaves no narrow pockets a fighter could be pinned in, at any size",
		(n) => {
			expect(narrowGaps(PLAYER_WIDTH, buildWorld(n))).toEqual([]);
		},
	);

	it("applyWorld rewrites an existing instance in place", () => {
		const w = buildWorld(1);
		const identity = w;
		applyWorld(w, 2);
		expect(w).toBe(identity);
		expect(w.screens).toBe(2);
		expect(w.right).toBe(2 * SCREEN_W);
		expect(w.platforms).toHaveLength(1 + 8 * 2);
		expect(w.spawnPoints).toHaveLength(BASE_SPAWN_COUNT * 2);
	});
});
