import { describe, expect, it } from "vitest";
import { buildWorld, DEFAULT_WORLD, type Rect } from "./Arena.js";
import {
	solidRectsFromTilemap,
	TILE_SIZE,
	type TilemapSpec,
	tilemapFromWorld,
} from "./Tilemap.js";

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
