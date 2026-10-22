import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	buildWorld,
	MAX_SCREENS,
	PLAYER_HEIGHT,
	type Rect,
	type SpawnPoint,
} from "../simulation/Arena";
import { buildControlWorld } from "../simulation/ControlMap";
import {
	mapKey,
	sanitizeTilemap,
	type TilemapSpec,
	tilemapFromWorld,
	worldFromTilemap,
} from "../simulation/Tilemap";
import { checkMap, publishable, unreachableSurfaces } from "./checks";

/** An authored map from rectangles and spawns, the way the editor saves one. */
function authored(
	platforms: Rect[],
	spawns: SpawnPoint[],
	screens = 1,
): TilemapSpec {
	return {
		format: "golpe-tilemap",
		version: 1,
		tileSize: 8,
		tileset: "castle-platforms",
		width: screens * 100,
		height: 75,
		theme: "castle",
		meta: { id: "test-map", name: "Test map" },
		layers: [
			{ name: "platforms", type: "platforms", objects: platforms },
			{ name: "spawns", type: "spawns", objects: spawns },
		],
	};
}

const FLOOR: Rect = { x: 0, y: 568, w: 800, h: 32 };
const onFloor = (x: number): SpawnPoint => ({
	x,
	y: 568 - PLAYER_HEIGHT - 2,
	facing: 1,
});

/** The shipped arena as an authored map — the control the checks are tuned on. */
function classic(screens: number): TilemapSpec {
	const world = buildWorld(screens);
	const map = tilemapFromWorld(world);
	return {
		...map,
		layers: [
			...map.layers,
			{ name: "spawns", type: "spawns", objects: world.spawnPoints },
		],
	};
}

describe("checkMap", () => {
	// The classic arena was tuned by hand against these exact rules over many
	// playtests: if the checks flag it, the checks are wrong, not the arena.
	test.prop([fc.integer({ min: 1, max: MAX_SCREENS })])(
		"passes the shipped arena at every width",
		(screens) => {
			const issues = checkMap(classic(screens));
			expect(issues.filter((i) => i.level !== "info")).toEqual([]);
		},
	);

	it("passes the control line too", () => {
		const world = buildControlWorld();
		const map = {
			...tilemapFromWorld(world),
			layers: [
				...tilemapFromWorld(world).layers,
				{ name: "spawns", type: "spawns" as const, objects: world.spawnPoints },
			],
		};
		expect(unreachableSurfaces(worldFromTilemap(map))).toEqual([]);
	});

	it("refuses a map with no spawns", () => {
		const issues = checkMap(authored([FLOOR], []));
		expect(issues.map((i) => i.code)).toContain("no-spawns");
		expect(publishable(issues)).toBe(false);
	});

	it("refuses a spawn inside a platform", () => {
		const box: Rect = { x: 300, y: 400, w: 100, h: 100 };
		const issues = checkMap(
			authored([FLOOR, box], [onFloor(40), { x: 320, y: 420, facing: 1 }]),
		);
		expect(issues.find((i) => i.code === "spawn-inside")?.level).toBe("error");
	});

	it("warns about a gap narrower than a fighter", () => {
		const issues = checkMap(
			authored(
				[
					FLOOR,
					{ x: 200, y: 450, w: 100, h: 24 },
					{ x: 320, y: 450, w: 100, h: 24 },
				],
				[onFloor(40), onFloor(700)],
			),
		);
		expect(issues.map((i) => i.code)).toContain("narrow-gap");
	});

	it("warns about a ledge out of double-jump reach", () => {
		const high: Rect = { x: 350, y: 120, w: 100, h: 24 };
		const issues = checkMap(
			authored([FLOOR, high], [onFloor(40), onFloor(700)]),
		);
		const unreachable = issues.filter((i) => i.code === "unreachable");
		expect(unreachable.map((i) => i.at)).toEqual([high]);
	});

	it("reaches a high ledge through a stepping stone", () => {
		const step: Rect = { x: 300, y: 400, w: 100, h: 24 };
		const high: Rect = { x: 350, y: 200, w: 100, h: 24 };
		const issues = checkMap(
			authored([FLOOR, step, high], [onFloor(40), onFloor(700)]),
		);
		expect(issues.filter((i) => i.code === "unreachable")).toEqual([]);
	});

	it("flags headroom a fighter cannot stand up in", () => {
		const issues = checkMap(
			authored(
				[FLOOR, { x: 200, y: 540, w: 200, h: 8 }],
				[onFloor(40), onFloor(700)],
			),
		);
		expect(issues.map((i) => i.code)).toContain("crawlspace");
	});
});

describe("sanitizeTilemap", () => {
	const rect = fc.record({
		x: fc.integer({ min: -200, max: 7000 }),
		y: fc.integer({ min: -200, max: 800 }),
		w: fc.integer({ min: -50, max: 900 }),
		h: fc.integer({ min: -50, max: 300 }),
	});
	const spawn = fc.record({
		x: fc.integer({ min: -100, max: 7000 }),
		y: fc.integer({ min: -100, max: 700 }),
		facing: fc.constantFrom(-1, 1, 0, 5),
	});
	const raw = fc.record({
		screens: fc.integer({ min: -2, max: 12 }),
		platforms: fc.array(rect, { maxLength: 200 }),
		spawns: fc.array(spawn, { maxLength: 60 }),
		theme: fc.constantFrom("castle", "meadow", "snow", "waterfront", "lava", 7),
		name: fc.string({ maxLength: 120 }),
	});

	// The server sanitises what the creator sent and broadcasts the result; the
	// creator compares that result against the map it built. Idempotence is
	// what makes those two the same map, and so one world, not two.
	test.prop([raw])("is idempotent", (r) => {
		const once = sanitizeTilemap({
			format: "golpe-tilemap",
			version: 1,
			tileSize: 8,
			width: r.screens * 100,
			height: 75,
			theme: r.theme,
			meta: { id: "x", name: r.name },
			layers: [
				{ type: "platforms", objects: r.platforms },
				{ type: "spawns", objects: r.spawns },
			],
		});
		if (!once) return;
		const twice = sanitizeTilemap(JSON.parse(JSON.stringify(once)));
		expect(twice).toEqual(once);
		expect(mapKey(twice as TilemapSpec)).toBe(mapKey(once));
	});

	test.prop([raw])("never builds a world a fighter can fall out of", (r) => {
		const map = sanitizeTilemap({
			format: "golpe-tilemap",
			version: 1,
			tileSize: 8,
			width: r.screens * 100,
			layers: [
				{ type: "platforms", objects: r.platforms },
				{ type: "spawns", objects: r.spawns },
			],
		});
		if (!map) return;
		const world = worldFromTilemap(map);
		expect(world.screens).toBeGreaterThanOrEqual(1);
		expect(world.screens).toBeLessThanOrEqual(MAX_SCREENS);
		expect(world.platforms.length).toBeLessThanOrEqual(160);
		for (const p of world.platforms) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.x + p.w).toBeLessThanOrEqual(world.right);
			expect(p.y + p.h).toBeLessThanOrEqual(world.bottom);
			expect(p.w).toBeGreaterThanOrEqual(8);
			expect(p.x % 8).toBe(0);
		}
		expect(world.spawnPoints.length).toBeGreaterThan(0);
		for (const s of world.spawnPoints) {
			expect(s.x).toBeGreaterThanOrEqual(0);
			expect(Math.abs(s.facing)).toBe(1);
		}
	});

	it("refuses what is not a map", () => {
		expect(sanitizeTilemap(null)).toBeNull();
		expect(sanitizeTilemap("map")).toBeNull();
		expect(sanitizeTilemap({ format: "tiled" })).toBeNull();
		// A map with no surface at all is not a map anybody can play.
		expect(
			sanitizeTilemap({
				format: "golpe-tilemap",
				version: 1,
				tileSize: 8,
				width: 100,
				layers: [],
			}),
		).toBeNull();
	});

	it("keeps an authored map's theme and name through the world", () => {
		const world = worldFromTilemap(
			authored([FLOOR], [onFloor(40), onFloor(700)]),
		);
		expect(tilemapFromWorld(world).theme).toBe("castle");
		expect(tilemapFromWorld(world).meta?.name).toBe("Test map");
	});
});
