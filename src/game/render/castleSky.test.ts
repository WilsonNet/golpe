/**
 * The Castle panorama's contract, pinned.
 *
 * The theme used to be two procedural silhouettes. It is now a painted
 * panorama under the same manifest as the Waterfront, and the user-facing
 * promise is the same: **separate parallax layers**, a focal keep, and fixed
 * vignettes (flags, princess, trebuchet, wall fights) composited above the
 * graded scenery. A regenerated PNG must not quietly flatten those layers, and
 * a strip actor must not drift off the panorama.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Layer {
	id: string;
	type?: "image" | "strip";
	factor: number;
	align?: "mid" | "near";
	frameW?: number;
	frameH?: number;
	frames?: number;
}

interface PlanGroup {
	layer: string;
	actors: { u: number; v: number }[];
}

interface Manifest {
	name: string;
	width: number;
	height: number;
	haze?: number;
	layers: Layer[];
	loops?: { groups: PlanGroup[] };
	ambient?: { groups: PlanGroup[] };
}

const manifest = JSON.parse(
	readFileSync(
		new URL(
			"../../../public/assets/skybox/castle/manifest.json",
			import.meta.url,
		),
		"utf8",
	),
) as Manifest;

const image = (id: string): Layer => {
	const layer = manifest.layers.find((l) => l.id === id);
	if (!layer) throw new Error(`missing layer ${id}`);
	return layer;
};

describe("castle skybox", () => {
	it("keeps the four separated parallax layers", () => {
		const images = manifest.layers.filter((l) => l.type !== "strip");
		expect(images.map((l) => l.id)).toEqual(["sky", "far", "mid", "near"]);
		expect(images.map((l) => l.factor)).toEqual([0.015, 0.06, 0.18, 0.5]);
	});

	it("keeps the panorama at the shared world size", () => {
		expect(manifest.width).toBe(1600);
		expect(manifest.height).toBe(600);
		expect(manifest.haze ?? 1).toBeLessThanOrEqual(1);
	});

	it("keeps the vignettes on strip frames and in the panorama", () => {
		const strips = new Set(
			manifest.layers.filter((l) => l.type === "strip").map((l) => l.id),
		);
		expect(strips).toEqual(
			new Set([
				"flags",
				"princess",
				"trebuchet",
				"battle",
				"archers",
				"torches",
				"crows",
			]),
		);
		for (const group of [
			...(manifest.loops?.groups ?? []),
			...(manifest.ambient?.groups ?? []),
		]) {
			const layer = image(group.layer);
			expect(layer.type).toBe("strip");
			for (const actor of group.actors) {
				expect(actor.u).toBeGreaterThanOrEqual(0);
				expect(actor.v).toBeGreaterThanOrEqual(0);
				expect(actor.u + (layer.frameW ?? 0)).toBeLessThanOrEqual(
					manifest.width,
				);
				expect(actor.v + (layer.frameH ?? 0)).toBeLessThanOrEqual(
					manifest.height,
				);
			}
		}
	});

	it("keeps the flagship vignettes in the loop plan", () => {
		const loops = new Set(
			(manifest.loops?.groups ?? []).map((group) => group.layer),
		);
		expect(loops).toContain("flags");
		expect(loops).toContain("princess");
		expect(loops).toContain("trebuchet");
		expect(loops).toContain("battle");
		expect(manifest.ambient?.groups.some((g) => g.layer === "crows")).toBe(
			true,
		);
	});

	it("aligns the castle strips to the keep they sit on", () => {
		for (const id of ["flags", "princess", "trebuchet", "battle", "archers"]) {
			expect(image(id).align).toBe("mid");
		}
		expect(image("torches").align).toBe("mid");
	});
});
