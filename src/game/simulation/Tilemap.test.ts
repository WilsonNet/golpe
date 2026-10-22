import { describe, expect, it } from "vitest";
import { buildWorld, DEFAULT_WORLD, type Rect } from "./Arena.js";
import {
	MAX_MAP_PLATFORMS,
	MAX_MAP_PROPS,
	MAX_MAP_SPAWNS,
	mapRows,
	sanitizeTilemap,
	solidRectsFromTilemap,
	TILE_SIZE,
	type TilemapSpec,
	tilemapFromWorld,
	worldFromTilemap,
} from "./Tilemap.js";

describe("vertical maps", () => {
	const tall = (height: unknown, y: number) => ({
		format: "golpe-tilemap",
		version: 1,
		tileSize: 8,
		width: 100,
		height,
		layers: [
			{
				name: "platforms",
				type: "platforms",
				objects: [{ x: 0, y, w: 800, h: 32 }],
			},
		],
	});

	it("is rows of screens, and the world is as tall as the map", () => {
		const map = sanitizeTilemap(tall(225, 1768));
		expect(map && mapRows(map)).toBe(3);
		expect(map && worldFromTilemap(map).bottom).toBe(1800);
		expect(map && solidRectsFromTilemap(map)[0]?.y).toBe(1768);
	});

	it("a map without a height is one screen, and a tall one is capped", () => {
		expect(sanitizeTilemap(tall(undefined, 568))?.height).toBe(75);
		const huge = sanitizeTilemap(tall(9999, 2368));
		expect(huge && mapRows(huge)).toBe(4);
		// Nothing below the world's floor survives.
		expect(sanitizeTilemap(tall(75, 1768))).toBeNull();
	});

	it("a map at every cap still fits one reliable message", () => {
		const raw = {
			...tall(300, 2368),
			width: 800,
			theme: "castle",
			meta: { id: "a-very-long-map-name-for-the-wire", name: "x".repeat(80) },
			layers: [
				{
					name: "platforms",
					type: "platforms",
					objects: Array.from({ length: MAX_MAP_PLATFORMS }, (_, i) => ({
						x: (i * 248) % 6000,
						y: 8 + ((i * 88) % 2300),
						w: 1240,
						h: 120,
					})),
				},
				{
					name: "spawns",
					type: "spawns",
					objects: Array.from({ length: MAX_MAP_SPAWNS }, (_, i) => ({
						x: 4000 + i,
						y: 1000 + i,
						facing: -1,
					})),
				},
				{
					name: "props",
					type: "props",
					objects: Array.from({ length: MAX_MAP_PROPS }, (_, i) => ({
						type: "windowShutters",
						x: 6000 + i,
						y: 2000 + i,
						flip: true,
					})),
				},
			],
		};
		const map = sanitizeTilemap(raw);
		expect(map).not.toBeNull();
		expect(JSON.stringify(map).length).toBeLessThan(48 * 1024);
	});
});

describe("tilemap format", () => {
	it("describes the current arena without changing a collider", () => {
		const map = tilemapFromWorld(DEFAULT_WORLD);
		const platforms = map.layers.find((l) => l.type === "platforms");
		expect(platforms?.objects).toEqual(DEFAULT_WORLD.platforms);
		expect(solidRectsFromTilemap(map)).toEqual([...DEFAULT_WORLD.platforms]);
		expect(map.tileSize).toBe(TILE_SIZE);
		expect(map.width).toBe(100);
		expect(map.height).toBe(75);
	});

	it("keeps a wider room's platform rectangles per screen", () => {
		const world = buildWorld(3);
		const map = tilemapFromWorld(world);
		const platforms = map.layers.find((l) => l.type === "platforms");
		expect(platforms?.objects).toHaveLength(world.platforms.length);
		expect(platforms?.objects[1]).toEqual(world.platforms[1]);
	});

	it("hangs decorations below a ledge, never in its collider", () => {
		const map = tilemapFromWorld(DEFAULT_WORLD);
		const props = map.layers.find((l) => l.type === "props");
		expect(props?.objects.length).toBeGreaterThan(0);
		for (const prop of props?.objects ?? []) {
			const owner = DEFAULT_WORLD.platforms.find(
				(p) => prop.y === p.y + p.h && prop.x >= p.x && prop.x < p.x + p.w,
			);
			expect(owner).toBeDefined();
			expect(prop.type).toMatch(/^vine/);
		}
	});

	it("turns a painted solid grid into maximal collision rectangles", () => {
		const map: TilemapSpec = {
			format: "golpe-tilemap",
			version: 1,
			tileSize: TILE_SIZE,
			tileset: "test",
			width: 4,
			height: 3,
			layers: [
				{
					name: "solids",
					type: "solid",
					width: 4,
					height: 3,
					data: [0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1],
				},
			],
		};
		expect(solidRectsFromTilemap(map)).toEqual([
			{ x: 8, y: 0, w: 16, h: 16 },
			{ x: 0, y: 16, w: 32, h: 8 },
		] satisfies Rect[]);
	});

	it("refuses a grid whose data does not match its bounds", () => {
		const map: TilemapSpec = {
			format: "golpe-tilemap",
			version: 1,
			tileSize: TILE_SIZE,
			tileset: "test",
			width: 3,
			height: 3,
			layers: [
				{
					name: "broken",
					type: "solid",
					width: 3,
					height: 3,
					data: [1],
				},
			],
		};
		expect(() => solidRectsFromTilemap(map)).toThrow(/expected 9 cells/);
	});
});
