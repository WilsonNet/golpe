/**
 * The gamepad → code mapping, without a gamepad.
 *
 * Nothing else in the feedback loop can see a pad: AI vs AI hands the simulation
 * an intent directly and Playwright cannot press a physical button, so this and
 * `scripts/pad-probe.mjs` (which stubs `navigator.getGamepads`) are the only two
 * things that ever exercise it.
 */

import { describe, expect, it } from "vitest";
import {
	PAD_DOWN,
	PAD_LEFT,
	PAD_RIGHT,
	PAD_UP,
	padLabel,
	readPads,
} from "./Gamepad";

/** A standard-mapping pad with everything at rest, then whatever is overridden. */
function pad(over: { buttons?: number[]; axes?: number[] } = {}): Gamepad {
	const pressed = new Set(over.buttons ?? []);
	return {
		connected: true,
		buttons: Array.from({ length: 17 }, (_, i) => ({
			pressed: pressed.has(i),
			touched: pressed.has(i),
			value: pressed.has(i) ? 1 : 0,
		})),
		axes: over.axes ?? [0, 0, 0, 0],
	} as unknown as Gamepad;
}

describe("readPads", () => {
	it("says nothing is connected when nothing is", () => {
		expect(readPads(null).connected).toBe(false);
		expect(readPads([null, null]).connected).toBe(false);
	});

	it("maps face buttons into the binding namespace", () => {
		const frame = readPads([pad({ buttons: [0, 6] })]);
		expect(frame.connected).toBe(true);
		expect([...frame.down].sort()).toEqual(["Pad0", "Pad6"]);
	});

	it("turns the d-pad into direction codes rather than Pad12..Pad15", () => {
		// Two codes for one physical button would let a player bind it twice and
		// have one of the bindings silently lose.
		const frame = readPads([pad({ buttons: [12, 15] })]);
		expect([...frame.down].sort()).toEqual([PAD_RIGHT, PAD_UP].sort());
		expect(frame.down.has("Pad12")).toBe(false);
	});

	/**
	 * The Contra layer. The stick is the d-pad, quantised — which is what makes
	 * the double-tap dash work off a stick flick with no extra code.
	 */
	it("quantises the left stick to the same four codes", () => {
		expect(
			[...readPads([pad({ axes: [-0.9, -0.6, 0, 0] })]).down].sort(),
		).toEqual([PAD_LEFT, PAD_UP].sort());
		expect([...readPads([pad({ axes: [0.05, 0.95, 0, 0] })]).down]).toEqual([
			PAD_DOWN,
		]);
	});

	/**
	 * The analog half of the same layer. The codes are eight directions, but the
	 * stick's *deflection* is handed over raw — a stick pushed at 30° aims at
	 * 30°, not at the nearest of eight. This is what makes a physical stick more
	 * than a d-pad with extra steps.
	 */
	it("hands the left stick over raw for the analog Contra aim", () => {
		const contra = readPads([pad({ axes: [0.866, 0.5, 0, 0] })]).contra;
		if (!contra) throw new Error("expected analog contra input");
		expect(contra.x).toBeCloseTo(0.866);
		expect(contra.y).toBeCloseTo(0.5);
		expect(Math.atan2(contra.y, contra.x)).toBeCloseTo(Math.PI / 6);
	});

	it("reports a resting left stick as no analog contra input", () => {
		expect(readPads([pad({ axes: [0.15, -0.1, 0, 0] })]).contra).toBeNull();
	});

	it("ignores a left stick resting inside its deadzone", () => {
		expect(readPads([pad({ axes: [0.15, -0.1, 0, 0] })]).down.size).toBe(0);
	});

	it("hands the right stick over as an angle, not as codes", () => {
		// Quantising it would throw away the whole point: it is the layer that is
		// *not* eight directions.
		const frame = readPads([pad({ axes: [0, 0, -0.7, 0.7] })]);
		expect(frame.down.size).toBe(0);
		expect(frame.fine).toEqual({ x: -0.7, y: 0.7 });
	});

	it("reports a resting right stick as nobody aiming, not as aiming right", () => {
		expect(readPads([pad({ axes: [0, 0, 0.1, 0.05] })]).fine).toBeNull();
	});

	it("merges every connected pad, and lets the largest deflection win", () => {
		const frame = readPads([
			pad({ buttons: [0], axes: [0, 0, 0.3, 0] }),
			pad({ buttons: [2], axes: [-0.95, 0, -0.95, 0] }),
		]);
		// The second pad's left stick is deflected, so its PadLeft code joins the
		// union — and its larger deflection also wins the analog Contra and fine
		// aims. A second controller sitting at rest must not argue them back to
		// centre.
		expect([...frame.down].sort()).toEqual(["Pad0", "Pad2", PAD_LEFT].sort());
		expect(frame.fine?.x).toBe(-0.95);
		expect(frame.contra?.x).toBe(-0.95);
	});
});

describe("padLabel", () => {
	it("names buttons the way a player would", () => {
		expect(padLabel("Pad0")).toBe("Pad A");
		expect(padLabel("Pad6")).toBe("Pad LT");
		expect(padLabel(PAD_LEFT)).toBe("Pad Left");
	});

	it("leaves codes from other devices alone", () => {
		expect(padLabel("KeyW")).toBeUndefined();
		expect(padLabel("Mouse0")).toBeUndefined();
	});
});
