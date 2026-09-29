import { describe, expect, it } from "vitest";
import {
	CP_POINT_COUNT,
	CP_SCREENS,
	CP_SPAWNS_PER_MODULE,
	CP_ZONE_H,
	CP_ZONE_W,
} from "../../tweakables/control.js";
import {
	buildWorld,
	GROUND,
	narrowGaps,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	penetrationDepth,
	SCREEN_W,
} from "./Arena.js";
import {
	applyControlWorld,
	buildControlWorld,
	CONTROL_PADS,
	CONTROL_SCREEN_SPAWNS,
	pickControlSpawn,
} from "./ControlMap.js";

/**
 * The control arena is the first second map, so it needs the same gates the
 * classic one has: no spawn inside geometry, no pocket a fighter can be pinned
 * in, no ledge that needs two jumps — plus the ones only this map has: five
 * pads at even spacing, and two halves that are mirrors of each other.
 */

/** Move a screen-local rect to a position mirrored about the whole map. */
function mirrorAcrossMap(x: number, w: number, right: number): number {
	return right - (x + w);
}

describe("buildControlWorld", () => {
	it("is five screens wide, one per point", () => {
		const world = buildControlWorld();
		expect(world.screens).toBe(CP_SCREENS);
		expect(world.screens).toBe(CP_POINT_COUNT);
		expect(world.right).toBe(SCREEN_W * CP_SCREENS);
		expect(world.bottom).toBe(GROUND.y + GROUND.h);
	});

	it("spans the ground across the whole map", () => {
		const world = buildControlWorld();
		const ground = world.platforms.find(
			(p) => p.y === GROUND.y && p.h === GROUND.h,
		);
		expect(ground?.w).toBe(world.right);
	});

	it("is mirror-symmetric about its centre", () => {
		const world = buildControlWorld();
		const right = world.right;
		const keys = new Set(
			world.platforms.map((p) => `${p.x},${p.y},${p.w},${p.h}`),
		);
		for (const p of world.platforms) {
			const mirrored = `${mirrorAcrossMap(p.x, p.w, right)},${p.y},${p.w},${p.h}`;
			expect(keys.has(mirrored)).toBe(true);
		}
	});
});

describe("capture pads", () => {
	it("stands one on every screen's centre, on the ground", () => {
		expect(CONTROL_PADS).toHaveLength(CP_POINT_COUNT);
		CONTROL_PADS.forEach((pad, i) => {
			expect(pad.x + pad.w / 2).toBe(i * SCREEN_W + SCREEN_W / 2);
			expect(pad.y + pad.h).toBe(GROUND.y);
			expect(pad.w).toBe(CP_ZONE_W);
			expect(pad.h).toBe(CP_ZONE_H);
		});
	});

	it("is even spacing, so no point is a longer walk than another", () => {
		for (let i = 1; i < CONTROL_PADS.length; i++) {
			const a = CONTROL_PADS[i - 1];
			const b = CONTROL_PADS[i];
			if (!a || !b) continue;
			expect(b.x - a.x).toBe(SCREEN_W);
		}
	});

	it("is not overlooked by a platform standing in its headroom", () => {
		const world = buildControlWorld();
		for (const pad of CONTROL_PADS) {
			for (const p of world.platforms) {
				// The floor the pad sits on is not headroom; anything whose top is
				// strictly above it and inside the pad's box would let a fighter
				// capture from a ledge, which is not what the pad means.
				const verticallyInside = p.y >= pad.y && p.y < pad.y + pad.h;
				const horizontalOverlap = p.x < pad.x + pad.w && p.x + p.w > pad.x;
				expect(verticallyInside && horizontalOverlap).toBe(false);
			}
		}
	});
});

describe("the modules' geometry", () => {
	it("has no pocket too narrow for a fighter", () => {
		expect(narrowGaps(PLAYER_WIDTH, buildControlWorld())).toEqual([]);
	});

	it("keeps every ledge within one jump of the surface below it", () => {
		const tops = [
			...new Set(buildControlWorld().platforms.map((p) => p.y)),
		].sort((a, b) => b - a);
		// The classic arena's ladder rule, checked the same way: consecutive rungs
		// of unique tops must be clearable in one jump. The constant's job is
		// elsewhere; here the *shape* of the ladder is what is asserted.
		for (let i = 1; i < tops.length; i++) {
			expect((tops[i - 1] ?? 0) - (tops[i] ?? 0)).toBeLessThanOrEqual(136);
		}
	});

	it("never buries a spawn in geometry, and every one rests on a platform", () => {
		const world = buildControlWorld();
		for (const s of world.spawnPoints) {
			expect(penetrationDepth(s.x, s.y, world)).toBe(0);
			const supported = world.platforms.some(
				(p) =>
					p.y === s.y + PLAYER_HEIGHT &&
					s.x >= p.x &&
					s.x + PLAYER_WIDTH <= p.x + p.w,
			);
			expect(supported).toBe(true);
		}
	});

	it("gives every screen enough spawn points for a whole side", () => {
		for (const zone of CONTROL_SCREEN_SPAWNS) {
			expect(zone.length).toBeGreaterThanOrEqual(CP_SPAWNS_PER_MODULE);
		}
	});

	it("keeps each screen's spawn points inside that screen", () => {
		CONTROL_SCREEN_SPAWNS.forEach((zone, screen) => {
			for (const s of zone) {
				expect(s.x).toBeGreaterThanOrEqual(screen * SCREEN_W);
				expect(s.x + PLAYER_WIDTH).toBeLessThanOrEqual((screen + 1) * SCREEN_W);
			}
		});
	});
});

describe("forward spawns", () => {
	it("picks inside the requested screen and faces the enemy", () => {
		const point = pickControlSpawn([], 0, 2);
		expect(point.x).toBeGreaterThanOrEqual(2 * SCREEN_W);
		expect(point.x).toBeLessThan(3 * SCREEN_W);
		expect(point.facing).toBe(1);
		const back = pickControlSpawn([], 1, 3);
		expect(back.facing).toBe(-1);
	});

	it("spreads within the screen, away from whoever is already there", () => {
		const first = pickControlSpawn([], 0, 1);
		const second = pickControlSpawn([{ x: first.x, y: first.y }], 0, 1);
		expect(second).not.toEqual(first);
	});
});

describe("applyControlWorld", () => {
	it("rewrites a classic arena in place, geometry and all", () => {
		// Built from the *classic* arena on purpose: a control rewrite that only
		// fixed `screens` left the colliders and spawn tables behind, and the
		// whole point is that every holder sees the control map's own geometry.
		const world = buildWorld(5);
		const classicPlatforms = world.platforms;
		expect(world.screens).toBe(5);
		const same = applyControlWorld(world);
		expect(same).toBe(world);
		expect(world.screens).toBe(CP_SCREENS);
		expect(world.right).toBe(SCREEN_W * CP_SCREENS);
		expect(world.platforms).not.toBe(classicPlatforms);
		expect(world.platforms).toEqual(buildControlWorld().platforms);
		expect(world.spawnPoints).toEqual(buildControlWorld().spawnPoints);
	});
});
