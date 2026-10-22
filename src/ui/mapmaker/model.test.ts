import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { checkMap } from "../../game/maps/checks";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../../game/simulation/Arena";
import {
	addPlatform,
	commit,
	fromSpec,
	historyOf,
	mapWidth,
	mirrorLeftToRight,
	newMap,
	playableSpec,
	propAt,
	redo,
	resize,
	spawnAt,
	TEMPLATES,
	toSpec,
	undo,
} from "./model";

describe("templates", () => {
	// A new player's first map must already be a map the game accepts and the
	// checks pass — "it starts with a map, not a form".
	test.prop([
		fc.constantFrom(...TEMPLATES.map((t) => t.id)),
		fc.constantFrom("waterfront", "castle", "meadow", "snow" as const),
		fc.integer({ min: 1, max: 8 }),
	])("every template is playable at every width", (id, theme, screens) => {
		const spec = playableSpec(newMap(id, theme, screens));
		expect(spec).not.toBeNull();
		const errors = checkMap(spec as NonNullable<typeof spec>).filter(
			(i) => i.level === "error",
		);
		expect(errors).toEqual([]);
	});
});

describe("the editor's map", () => {
	it("round-trips through the sanitiser unchanged", () => {
		const map = newMap("classic", "snow", 2, "Round trip");
		const spec = playableSpec(map);
		expect(spec).toEqual(toSpec(map));
		const back = fromSpec(spec as NonNullable<typeof spec>);
		expect(toSpec({ ...back, localId: map.localId })).toEqual(toSpec(map));
	});

	it("drops a spawn onto the surface under the cursor", () => {
		const map = newMap("blank", "castle", 1);
		const s = spawnAt(map, 400, 100);
		expect(s.y + PLAYER_HEIGHT).toBeLessThanOrEqual(568);
		expect(568 - (s.y + PLAYER_HEIGHT)).toBeLessThanOrEqual(2);
		expect(s.x + PLAYER_WIDTH / 2).toBeCloseTo(400, -1);
	});

	it("hangs a vine from the ceiling and stands a crate on the floor", () => {
		const { map } = addPlatform(newMap("blank", "castle", 1), {
			x: 300,
			y: 304,
			w: 200,
			h: 24,
		});
		expect(propAt(map, "vine", 400, 400).y).toBe(328);
		const crate = propAt(map, "crate", 400, 400);
		expect(crate.y + 16).toBe(568);
	});

	test.prop([fc.integer({ min: 1, max: 8 })])(
		"mirroring is symmetric",
		(screens) => {
			const W = screens * 800;
			const map = mirrorLeftToRight(newMap("towers", "meadow", screens));
			const key = (r: { x: number; y: number; w: number; h: number }) =>
				`${r.x},${r.y},${r.w},${r.h}`;
			const rects = new Set(map.platforms.map(key));
			for (const p of map.platforms) {
				expect(rects.has(key({ ...p, x: W - p.x - p.w }))).toBe(true);
			}
			expect(map.spawns.filter((s) => s.x < W / 2).length).toBe(
				map.spawns.filter((s) => s.x >= W / 2).length,
			);
		},
	);

	it("growing extends the floor and shrinking drops what no longer fits", () => {
		const map = newMap("classic", "castle", 3);
		const wide = resize(map, 5);
		expect(
			wide.platforms.some((p) => p.x === 0 && p.w === mapWidth(wide)),
		).toBe(true);
		const narrow = resize(map, 1);
		expect(narrow.platforms.every((p) => p.x + p.w <= 800)).toBe(true);
		expect(narrow.spawns.every((s) => s.x + PLAYER_WIDTH <= 800)).toBe(true);
	});

	it("undo and redo walk the history", () => {
		const a = newMap("blank", "castle", 1);
		const b = addPlatform(a, { x: 100, y: 400, w: 64, h: 24 }).map;
		const h = commit(historyOf(a), b);
		expect(undo(h).present).toBe(a);
		expect(redo(undo(h)).present.platforms.length).toBe(2);
	});
});
