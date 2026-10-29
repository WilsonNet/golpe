/**
 * Ibiriki's prey pins: where a bleeding foe's marker goes, and which way it
 * points. The positions are screen fractions, so the pure placement can be
 * checked without a browser. See specs/ibiriki.md.
 */
import { describe, expect, it } from "vitest";
import { preyPins } from "./PreyMarkers";

function prey(screenX: number, screenY: number) {
	return [{ id: "foe", hp: 0.2, screenX, screenY }];
}

describe("preyPins", () => {
	it("floats a pin above a foe that is already in view", () => {
		const pin = preyPins(prey(0.5, 0.5))[0];
		expect(pin).toMatchObject({ x: 0.5, hp: 0.2 });
		if (!pin) throw new Error("no pin");
		expect(pin.y).toBeLessThan(0.5);
		expect(pin.degrees).toBe(90);
	});

	it("pins an off-screen foe to the edge and turns the arrow at it", () => {
		const right = preyPins(prey(1.6, 0.5))[0];
		if (!right) throw new Error("no right pin");
		expect(right.x).toBeCloseTo(0.96, 2);
		expect(right.y).toBeCloseTo(0.5, 2);
		expect(right.degrees).toBeCloseTo(0, 2);

		const below = preyPins(prey(0.5, 1.4))[0];
		if (!below) throw new Error("no bottom pin");
		expect(below.y).toBeCloseTo(0.88, 2);
		expect(below.degrees).toBeCloseTo(90, 2);
	});

	it("keeps a pin out of the panels and the bottom meters", () => {
		const topLeft = preyPins(prey(-0.4, -0.3))[0];
		if (!topLeft) throw new Error("no top-left pin");
		expect(topLeft.x).toBeGreaterThanOrEqual(0.04);
		expect(topLeft.y).toBeGreaterThanOrEqual(0.14);
	});

	it("keeps one pin per prey, in the order the snapshot listed them", () => {
		const pins = preyPins([
			{ id: "a", hp: 0.1, screenX: 1.5, screenY: 0.5 },
			{ id: "b", hp: 0.25, screenX: 0.4, screenY: 0.5 },
		]);
		expect(pins.map((p) => p.id)).toEqual(["a", "b"]);
		expect(pins.map((p) => p.hp)).toEqual([0.1, 0.25]);
	});
});
