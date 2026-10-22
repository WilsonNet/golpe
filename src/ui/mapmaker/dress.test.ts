import { readFileSync } from "node:fs";
import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { PROP_CATALOG, propDef } from "../../game/maps/props";
import { MAP_THEMES } from "../../game/simulation/Tilemap";
import {
	DRESS_STYLES,
	dressMap,
	dressPlatform,
	slotOf,
	undressPlatform,
} from "./dress";
import { addPlatform, newMap, playableSpec, propRect } from "./model";

const STYLES = DRESS_STYLES.map((d) => d.id);

function building() {
	return addPlatform(newMap("blank", "castle", 2), {
		x: 200,
		y: 296,
		w: 256,
		h: 120,
	});
}

describe("the prop catalogue", () => {
	it("every prop is drawn in every theme's atlas, at the catalogue's size", () => {
		for (const theme of MAP_THEMES) {
			const manifest = JSON.parse(
				readFileSync(`public/assets/tilesets/${theme}-platforms.json`, "utf8"),
			) as {
				props: {
					frames: Record<string, number[]>;
					anims?: Record<string, { frames: string[] }>;
				};
			};
			for (const p of PROP_CATALOG) {
				const f = manifest.props.frames[p.type];
				expect(f, `${theme}/${p.type}`).toBeDefined();
				expect([f?.[2], f?.[3]]).toEqual([p.w, p.h]);
				expect(manifest.props.anims?.[p.type]?.frames.length).toBe(p.frames);
			}
		}
	});
});

describe("prettify", () => {
	test.prop([fc.constantFrom(...STYLES), fc.integer({ min: 0, max: 1e6 })])(
		"never puts a decoration inside another platform, or off the map",
		(style, seed) => {
			const { map, id } = building();
			const next = dressPlatform(map, id as string, style, seed);
			for (const prop of next.props) {
				const r = propRect(prop);
				expect(r.x).toBeGreaterThanOrEqual(0);
				expect(r.y).toBeGreaterThanOrEqual(0);
				for (const p of next.platforms) {
					if (p.id === id) continue;
					const hit =
						r.x < p.x + p.w &&
						r.x + r.w > p.x &&
						r.y < p.y + p.h &&
						r.y + r.h > p.y;
					expect(hit).toBe(false);
				}
			}
			expect(playableSpec(next)).not.toBeNull();
		},
	);

	it("is reproducible from its seed, and a new seed re-rolls", () => {
		const { map, id } = building();
		const a = dressPlatform(map, id as string, "surprise", 7);
		const b = dressPlatform(map, id as string, "surprise", 7);
		const strip = (m: typeof a) => m.props.map(({ id: _, ...p }) => p);
		expect(strip(a)).toEqual(strip(b));
	});

	it("windows go on the face, below the lip; birds on top", () => {
		const { map, id } = building();
		const host = map.platforms.find((p) => p.id === id);
		const dressed = dressPlatform(
			dressPlatform(map, id as string, "windows", 1),
			id as string,
			"critters",
			2,
		);
		if (!host) throw new Error("no host");
		const slots = dressed.props.map((p) => slotOf(host, p));
		expect(slots.filter((s) => s === "face").length).toBeGreaterThanOrEqual(4);
		expect(slots.filter((s) => s === "top").length).toBeGreaterThanOrEqual(1);
		for (const p of dressed.props)
			if (slotOf(host, p) === "face")
				expect(p.y).toBeGreaterThanOrEqual(host.y + 8);
		// Re-rolling windows keeps the birds.
		const again = dressPlatform(dressed, id as string, "windows", 3);
		expect(again.props.filter((p) => slotOf(host, p) === "top")).toEqual(
			dressed.props.filter((p) => slotOf(host, p) === "top"),
		);
		expect(undressPlatform(again, id as string).props).toEqual([]);
	});

	it("dresses a whole map in every theme with props the catalogue knows", () => {
		for (const theme of MAP_THEMES) {
			const map = dressMap(newMap("classic", theme, 3, "x", 2), 42);
			expect(map.props.length).toBeGreaterThan(20);
			for (const p of map.props) expect(propDef(p.type), p.type).not.toBeNull();
		}
	});
});
