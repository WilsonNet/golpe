/**
 * The Frostpeak panorama's contract, pinned.
 *
 * Same promise as the Castle: separate parallax layers, a focal summit, and
 * people/events composited above the graded scenery. The extra rule here is
 * the **timed avalanche**: it must have a first occurrence late enough to be a
 * surprise, a repeat period, a duration, and a strip whose frames fit.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Layer {
	id: string;
	type?: "image" | "strip";
	factor: number;
	align?: "far" | "mid" | "near";
	filtered?: boolean;
	frameW?: number;
	frameH?: number;
	frames?: number;
}

interface PlanGroup {
	layer: string;
	actors: { u: number; v: number; scale?: number; depth?: number }[];
}

interface TimedEvent {
	id: string;
	layer: string;
	u: number;
	v: number;
	firstMs: number;
	repeatMs?: number;
	durationMs: number;
}

interface Manifest {
	name: string;
	width: number;
	height: number;
	haze?: number;
	layers: Layer[];
	loops?: { groups: PlanGroup[] };
	ambient?: { groups: PlanGroup[] };
	timed?: { events: TimedEvent[] };
}

const manifest = JSON.parse(
	readFileSync(
		new URL("../../../public/assets/skybox/snow/manifest.json", import.meta.url),
		"utf8",
	),
) as Manifest;

const layer = (id: string): Layer => {
	const found = manifest.layers.find((l) => l.id === id);
	if (!found) throw new Error(`missing layer ${id}`);
	return found;
};

describe("snow skybox", () => {
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

	it("keeps every vignette on a strip frame inside the panorama", () => {
		for (const group of [
			...(manifest.loops?.groups ?? []),
			...(manifest.ambient?.groups ?? []),
		]) {
			const strip = layer(group.layer);
			expect(strip.type).toBe("strip");
			for (const actor of group.actors) {
				expect(actor.u).toBeGreaterThanOrEqual(0);
				expect(actor.v).toBeGreaterThanOrEqual(0);
				expect(actor.u + (strip.frameW ?? 0)).toBeLessThanOrEqual(
					manifest.width,
				);
				expect(actor.v + (strip.frameH ?? 0)).toBeLessThanOrEqual(
					manifest.height,
				);
			}
		}
	});

	it("ships the animated alpine cast, with the skiers as a filtered loop", () => {
		const loops = new Set(
			(manifest.loops?.groups ?? []).map((group) => group.layer),
		);
		for (const id of [
			"boarders",
			"sherpas",
			"climbers",
			"rescue",
			"campers",
			"gondola",
		]) {
			expect(loops).toContain(id);
		}
		expect(manifest.ambient?.groups.some((g) => g.layer === "helicopter")).toBe(
			true,
		);
		const skiers = layer("slope-skiers");
		expect(skiers.filtered).toBe(true);
		expect(skiers.align).toBe("mid");
		const skierActors =
			manifest.loops?.groups.find((g) => g.layer === "slope-skiers")?.actors ??
			[];
		const depths = new Set(skierActors.map((a) => a.depth));
		expect(depths.has(0)).toBe(true);
		expect(depths.has(1)).toBe(true);
		expect(depths.has(2)).toBe(true);
	});

	it("keeps the avalanche a timed event, not a loop", () => {
		const event = manifest.timed?.events.find((e) => e.id === "avalanche");
		expect(event).toBeDefined();
		if (!event) return;
		expect(event.layer).toBe("avalanche");
		expect(event.firstMs).toBeGreaterThanOrEqual(30_000);
		expect(event.repeatMs ?? 0).toBeGreaterThan(event.durationMs);
		expect(event.durationMs).toBeGreaterThan(3_000);
		const strip = layer(event.layer);
		expect(strip.type).toBe("strip");
		expect(event.u + (strip.frameW ?? 0)).toBeLessThanOrEqual(manifest.width);
		expect(event.v + (strip.frameH ?? 0)).toBeLessThanOrEqual(manifest.height);
	});

	it("aligns the summit to the far peaks and the bowl to mid", () => {
		expect(layer("climbers").align).toBe("far");
		expect(layer("avalanche").align).toBe("far");
		for (const id of ["boarders", "sherpas", "rescue", "campers"]) {
			expect(layer(id).align).toBe("mid");
		}
	});
});
