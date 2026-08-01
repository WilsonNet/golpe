/**
 * The aim controller, against a fake clock.
 *
 * Every number in here is a *feel* constant, and the whole reason this module is
 * pure is that feel constants nothing pins get retuned by accident. Nothing in
 * the AI vs AI loop can see any of it — the brains hand the simulation an angle
 * and never touch a stick — so these tests and `scripts/pad-probe.mjs` are the
 * only two things that can.
 */

import { describe, expect, it } from "vitest";
import {
	AimController,
	contraAngle,
	FINE_AIM_HOLD_MS,
	FINE_AIM_RADIUS_PX,
	FINE_AIM_RELEASE_MS,
	lerpAngle,
	pushStick,
	quantise8,
	STICK_DEADZONE,
} from "./Aim";

const DEG = Math.PI / 180;
const deg = (radians: number) => radians / DEG;
/** Screen coordinates put +y down, so "up" is a negative angle. */
const UP = -90;
const RIGHT = 0;
const LEFT = 180;

describe("quantise8", () => {
	it("snaps a stick to the eight directions a d-pad has", () => {
		expect(quantise8(1, 0)).toEqual({ x: 1, y: 0 });
		expect(quantise8(0.9, -0.8)).toEqual({ x: 1, y: -1 });
		expect(quantise8(0.05, -1)).toEqual({ x: 0, y: -1 });
		expect(quantise8(-1, 0.1)).toEqual({ x: -1, y: 0 });
	});

	it("reports a resting stick as no input at all", () => {
		// Not "aim right". A worn stick that rests at 0.12 would otherwise pin the
		// aim to the right forever, which reads as a broken game rather than a
		// broken controller.
		expect(quantise8(0.1, 0.1)).toEqual({ x: 0, y: 0 });
		expect(quantise8(STICK_DEADZONE - 0.01, 0)).toEqual({ x: 0, y: 0 });
	});
});

describe("contraAngle", () => {
	it("gives the eight Contra directions", () => {
		expect(deg(contraAngle(1, 0) as number)).toBeCloseTo(RIGHT);
		expect(deg(contraAngle(0, -1) as number)).toBeCloseTo(UP);
		expect(deg(contraAngle(1, -1) as number)).toBeCloseTo(-45);
		expect(deg(contraAngle(-1, 0) as number)).toBeCloseTo(LEFT);
	});

	it("says nothing rather than something when nothing is held", () => {
		// The caller keeps its last direction: letting go of the d-pad must not make
		// a fighter forget which way it was looking.
		expect(contraAngle(0, 0)).toBeNull();
	});
});

describe("pushStick", () => {
	const R = FINE_AIM_RADIUS_PX;

	it("leaves from the centre in the direction it is pushed", () => {
		const v = pushStick({ x: 0, y: 0 }, 20, 0, R);
		expect(deg(Math.atan2(v.y, v.x))).toBeCloseTo(RIGHT);
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(20);
	});

	it("saturates at the rim instead of wandering off", () => {
		const v = pushStick({ x: 0, y: 0 }, R * 10, 0, R);
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(R);
	});

	/**
	 * The whole feature. Aim right, then slide up.
	 *
	 * Plain Cartesian accumulation with a clamp gives 45°, then 63°, then 71° —
	 * it crawls towards straight up and the player gives up before it arrives.
	 * One radius of *tangential* travel is one radian, so the first stroke turns
	 * 57° and the second lands on vertical.
	 */
	it("runs up the arc once it is at the rim", () => {
		let v = { x: R, y: 0 };
		v = pushStick(v, 0, -R, R);
		expect(deg(Math.atan2(v.y, v.x))).toBeCloseTo(deg(-1), 6);
		v = pushStick(v, 0, -R, R);
		// The clamping version is at 63° here. This is at the ceiling.
		expect(deg(Math.atan2(v.y, v.x))).toBeLessThan(-85);
		expect(deg(Math.atan2(v.y, v.x))).toBeGreaterThanOrEqual(UP);
	});

	it("stays on the rim while it rotates", () => {
		let v = { x: R, y: 0 };
		for (let i = 0; i < 20; i++) v = pushStick(v, 0, -R / 4, R);
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(R);
	});

	/**
	 * A curving stroke keeps turning. This is what "full 360, like an analog
	 * stick" means: the eight Contra directions are a floor, not the ceiling.
	 */
	it("goes all the way round, not just through eight directions", () => {
		let v = { x: R, y: 0 };
		const steps = 200;
		const travel = (Math.PI * 2 * R) / steps;
		for (let i = 0; i < steps; i++) {
			// The stroke a hand actually makes: always across the stick, never into
			// it, which is the component that turns.
			const length = Math.hypot(v.x, v.y);
			v = pushStick(v, (-v.y / length) * travel, (v.x / length) * travel, R);
		}
		expect(deg(Math.atan2(v.y, v.x))).toBeCloseTo(RIGHT, 2);
	});

	it("comes back off the rim when it is pulled inward", () => {
		let v = { x: R, y: 0 };
		v = pushStick(v, -R / 2, 0, R);
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(R / 2);
		// Pushing outward at the rim does nothing: a gate does not give.
		v = pushStick({ x: R, y: 0 }, R, 0, R);
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(R);
	});
});

describe("lerpAngle", () => {
	it("takes the short way round the circle", () => {
		// 170° to -170° is 20° the short way and 340° the long way. Taking the long
		// way would sweep a fighter's guard past every angle in between.
		expect(deg(lerpAngle(170 * DEG, -170 * DEG, 0.5))).toBeCloseTo(180);
		expect(deg(lerpAngle(0, 90 * DEG, 0.5))).toBeCloseTo(45);
	});
});

describe("AimController", () => {
	/** Feed a number of frames with nothing touched. */
	const idle = (aim: AimController, ms: number, step = 16) => {
		for (let t = 0; t < ms; t += step) aim.update(Math.min(step, ms - t));
	};

	it("aims where the d-pad points", () => {
		const aim = new AimController();
		aim.setContra(1, -1, 1);
		aim.update(16);
		expect(deg(aim.angle)).toBeCloseTo(-45);
	});

	it("keeps the last direction when the d-pad is released", () => {
		const aim = new AimController();
		aim.setContra(0, -1, 1);
		aim.update(16);
		aim.setContra(0, 0, 1);
		aim.update(16);
		expect(deg(aim.angle)).toBeCloseTo(UP);
	});

	it("starts along the facing before anything has been aimed", () => {
		const aim = new AimController();
		aim.setContra(0, 0, -1);
		aim.update(16);
		expect(deg(aim.angle)).toBeCloseTo(LEFT);
	});

	/**
	 * The analog Contra aim. A d-pad can only feed {-1, 0, 1}, which resolves to
	 * eight directions; an analog stick pushes at any angle and the aim follows
	 * it — 21.8° stays 21.8° instead of snapping to the diagonal at 45°. Nothing
	 * upstream quantises it anymore: `Gamepad` and the on-screen cross hand the
	 * raw deflection straight in.
	 */
	it("aims at whatever angle an analog stick is pushed, not the nearest of eight", () => {
		const aim = new AimController();
		aim.setContra(1, -0.4, 1);
		aim.update(16);
		expect(deg(aim.angle)).toBeCloseTo(-21.8, 1);
		aim.setContra(0.5, 0.866, 1);
		aim.update(16);
		expect(deg(aim.angle)).toBeCloseTo(60, 1);
	});

	it("treats a barely-deflected stick as rest, and keeps the last direction", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.update(16);
		// A worn stick resting at 0.12 is not a direction, and must not be.
		aim.setContra(0.12, -0.05, 1);
		aim.update(16);
		expect(deg(aim.angle)).toBeCloseTo(RIGHT);
	});

	/**
	 * The point of having two layers: run one way, aim the other. Without the
	 * override a controller can only ever shoot where it is walking.
	 */
	it("lets the fine stick override the contra aim entirely", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.setFine(-1, 0);
		idle(aim, FINE_AIM_RELEASE_MS);
		expect(deg(aim.angle)).toBeCloseTo(LEFT, 1);
		expect(aim.overriding).toBe(true);
	});

	/**
	 * A physical stick recentres on its own, so letting go is unambiguous and the
	 * handover starts at once. The hold window exists for the *mouse*, which has
	 * no spring — see the next test.
	 */
	it("falls back to the contra aim as soon as a real stick recentres", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.setFine(0, -1);
		aim.update(16);
		expect(deg(aim.angle)).not.toBeCloseTo(RIGHT);

		aim.setFine(0, 0);
		idle(aim, FINE_AIM_RELEASE_MS + 50);
		expect(deg(aim.angle)).toBeCloseTo(RIGHT, 4);
		expect(aim.overriding).toBe(false);
	});

	it("holds the fine aim for the whole hold window before letting go", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		// A mouse stroke: pushed to the rim and then left alone. Nothing recentres a
		// mouse, so the hold is what decides when the contra aim comes back.
		aim.pushFine(0, -FINE_AIM_RADIUS_PX);
		idle(aim, FINE_AIM_HOLD_MS - 200);
		expect(aim.overriding).toBe(true);
		expect(deg(aim.angle)).toBeCloseTo(UP, 0);
		idle(aim, 200 + FINE_AIM_RELEASE_MS + 50);
		expect(aim.overriding).toBe(false);
	});

	it("eases back rather than snapping", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.pushFine(0, -FINE_AIM_RADIUS_PX);
		idle(aim, FINE_AIM_HOLD_MS + 20);
		const mid = aim.angle;
		// Mid-handover the angle is between the two, not at either. A snap is a
		// frame facing somewhere nobody chose, and facing decides which side a
		// guard covers.
		expect(deg(mid)).toBeGreaterThan(UP);
		expect(deg(mid)).toBeLessThan(RIGHT);
	});

	it("leaves from the centre again after it has decayed", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.pushFine(0, -FINE_AIM_RADIUS_PX);
		idle(aim, FINE_AIM_HOLD_MS + FINE_AIM_RELEASE_MS + 100);
		expect(aim.report().fine).toBe(0);
		// The same flick must give the same angle every time. A stick that resumed
		// from where it was abandoned would not.
		aim.pushFine(FINE_AIM_RADIUS_PX, 0);
		aim.update(16);
		expect(deg(aim.report().fineAngle)).toBeCloseTo(RIGHT);
	});

	it("ignores a stick sitting inside its deadzone", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.setFine(STICK_DEADZONE - 0.05, 0);
		idle(aim, 400);
		expect(aim.overriding).toBe(false);
		expect(deg(aim.angle)).toBeCloseTo(RIGHT);
	});

	it("drops the fine aim on demand, for a scheme change or a lost window", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.setFine(0, -1);
		idle(aim, FINE_AIM_RELEASE_MS);
		aim.releaseFine();
		expect(aim.overriding).toBe(false);
		expect(deg(aim.angle)).toBeCloseTo(RIGHT);
	});

	it("hands back smoothly when the stick is grabbed again mid-decay", () => {
		const aim = new AimController();
		aim.setContra(1, 0, 1);
		aim.pushFine(0, -FINE_AIM_RADIUS_PX);
		// Past the hold and halfway through the ease-out.
		idle(aim, FINE_AIM_HOLD_MS + FINE_AIM_RELEASE_MS / 2);
		const partway = aim.report().blend;
		expect(partway).toBeGreaterThan(0);
		expect(partway).toBeLessThan(1);
		aim.setFine(0, -1);
		aim.update(16);
		// Ramping in from where the decay got to, not from zero.
		expect(aim.report().blend).toBeGreaterThan(partway);
	});
});
