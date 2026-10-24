/**
 * The phone's aim assist, held to the narrow promise its module makes.
 *
 * The danger is not that it does too little; it is that a nudge toward the
 * nearest enemy becomes a lock-on that spins a player around. These tests are
 * the gates: sword only, near only, standing or guarding only, and a deliberate
 * aim always wins.
 */

import { describe, expect, it } from "vitest";
import {
	ASSIST_CONE_RAD,
	ASSIST_IDLE_SPEED_PX,
	ASSIST_RANGE_PX,
	type AssistInput,
	angleGap,
	assistedAim,
} from "./AimAssist";

const DEG = Math.PI / 180;
const RIGHT = 0;
const LEFT = Math.PI;

function input(over: Partial<AssistInput> = {}): AssistInput {
	return {
		rawAngle: RIGHT,
		shooter: { x: 100, y: 100 },
		target: { x: 160, y: 100 },
		swordStance: true,
		blocking: false,
		attacking: false,
		vx: 0,
		fineAiming: false,
		...over,
	};
}

describe("angleGap", () => {
	it("takes the short way round", () => {
		expect(angleGap(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2);
		expect(Math.abs(angleGap(0, Math.PI))).toBeCloseTo(Math.PI);
	});
});

describe("assistedAim", () => {
	it("turns a standing swordfighter toward a foe in front", () => {
		const target = { x: 160, y: 60 };
		expect(assistedAim(input({ target }))).toBeCloseTo(Math.atan2(-40, 60));
	});

	it("does nothing for the gun", () => {
		// The gun is aimed by the thumb on the trigger. An auto-aimed gun is a
		// different game, not an accessibility aid.
		expect(assistedAim(input({ swordStance: false }))).toBe(RIGHT);
	});

	it("never overrides a live aim drag", () => {
		expect(assistedAim(input({ fineAiming: true }))).toBe(RIGHT);
	});

	it("leaves a walking fighter alone", () => {
		expect(
			assistedAim(
				input({ vx: ASSIST_IDLE_SPEED_PX, target: { x: 100, y: 40 } }),
			),
		).toBe(RIGHT);
	});

	it("ignores a foe outside melee reach", () => {
		expect(
			assistedAim(input({ target: { x: 100 + ASSIST_RANGE_PX + 1, y: 100 } })),
		).toBe(RIGHT);
	});

	it("does not spin a standing fighter around to a foe behind", () => {
		// The cone is the difference between "help me face the person I am already
		// squared up against" and "play the game for me".
		expect(
			assistedAim(input({ rawAngle: LEFT, target: { x: 160, y: 100 } })),
		).toBe(LEFT);
	});

	it("does turn a guard to the threat, wherever it is", () => {
		const out = assistedAim(
			input({ rawAngle: LEFT, blocking: true, target: { x: 160, y: 100 } }),
		);
		expect(out).toBeCloseTo(RIGHT);
	});

	it("turns a moving attack toward the foe behind — the retreat-slash", () => {
		// Run left, swing right. The feet say left; the held attack says the foe.
		expect(
			assistedAim(
				input({
					rawAngle: LEFT,
					vx: -220,
					attacking: true,
					target: { x: 160, y: 100 },
				}),
			),
		).toBeCloseTo(RIGHT);
	});

	it("does not turn a moving fighter who is not attacking", () => {
		expect(
			assistedAim(
				input({ rawAngle: LEFT, vx: -220, target: { x: 160, y: 100 } }),
			),
		).toBe(LEFT);
	});

	it("still respects the cone boundary while standing", () => {
		const justInside = RIGHT + ASSIST_CONE_RAD * 0.9;
		const justOutside = RIGHT + ASSIST_CONE_RAD * 1.1;
		expect(assistedAim(input({ rawAngle: justInside }))).not.toBe(justInside);
		expect(assistedAim(input({ rawAngle: justOutside }))).toBe(justOutside);
	});

	it("does nothing without a target", () => {
		expect(assistedAim(input({ target: null }))).toBe(RIGHT);
	});

	it("uses the angle of a target on a different level", () => {
		const out = assistedAim(input({ target: { x: 160, y: 40 } }));
		expect(out).toBeCloseTo(Math.atan2(-60, 60));
		expect(Math.abs(out / DEG)).toBeCloseTo(45);
	});
});
