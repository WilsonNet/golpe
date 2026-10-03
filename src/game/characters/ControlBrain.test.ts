import { describe, expect, it } from "vitest";
import type { ControlView } from "./ControlBrain.js";
import { ControlBrain } from "./ControlBrain.js";
import type { AIOutput, ControlPointInfo } from "./types.js";

/**
 * The objective module, exercised without a room: a line, a fighter, and the
 * one question — where does the bot walk.
 */

function point(
	index: number,
	x: number,
	over: Partial<ControlPointInfo> = {},
): ControlPointInfo {
	return {
		index,
		x,
		y: 536,
		owner: null,
		attacker: null,
		progress: 0,
		contested: false,
		capturable: false,
		mine: false,
		...over,
	};
}

function input(over: {
	selfX?: number;
	selfY?: number;
	selfHP?: number;
	foes?: number;
	control?: ControlPointInfo[] | null;
	hunting?: boolean;
	/** The gun's total rounds (magazine + reserve); 0 is dry. */
	rounds?: number;
	items?: number;
	packs?: { x: number; y: number }[];
}): ControlView {
	const points =
		over.control === undefined
			? [
					point(0, 400, { owner: 0, mine: true }),
					point(1, 1200, { owner: 0, mine: true }),
					point(2, 2000, { capturable: true }),
					point(3, 2800, { owner: 1 }),
					point(4, 3600, { owner: 1 }),
				]
			: over.control;
	const rounds = over.rounds ?? 48;
	return {
		selfX: over.selfX ?? 1200,
		selfY: over.selfY ?? 520,
		selfHP: over.selfHP ?? 100,
		selfAmmo: Math.min(12, rounds),
		selfReserveRounds: Math.max(0, rounds - 12),
		selfItemCharges: over.items ?? 2,
		selfTeam: 0,
		distanceToPlayer: over.foes ?? 900,
		control: points === null ? null : { points },
		packs: over.packs ?? [],
	};
}

function freshOutput(): AIOutput {
	return {
		moveLeft: false,
		moveRight: false,
		jump: false,
		attack: false,
		block: false,
		uppercut: false,
		swordStance: true,
		face: 0,
		dash: 0,
		aimAngle: 0,
		evadeActive: false,
		ultimate: false,
		item: false,
	} as AIOutput;
}

describe("ControlBrain", () => {
	it("does nothing without a line", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ control: null }), output, false, 16);
		expect(output.moveLeft).toBe(false);
		expect(output.moveRight).toBe(false);
		expect(brain.insight.target).toBe(-1);
	});

	it("walks to the capturable point", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ selfX: 1500 }), output, false, 16);
		expect(brain.insight.target).toBe(2);
		expect(output.moveRight).toBe(true);
		expect(output.moveLeft).toBe(false);
	});

	it("stands when it is on the pad", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ selfX: 2000 }), output, false, 16);
		expect(output.moveLeft).toBe(false);
		expect(output.moveRight).toBe(false);
	});

	it("walks off a perch directly above the pad instead of planting there", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		// x-aligned with the pad centre but 260px up a perch: standing still is
		// how a bot used to sit out of the fight and off the bar forever.
		brain.decide(input({ selfX: 2000, selfY: 270 }), output, false, 16);
		expect(output.moveLeft || output.moveRight).toBe(true);
	});

	it("defends a point of its own being taken, over pushing the next", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		const points = [
			point(1, 1200, { owner: 0, mine: true, attacker: 1, progress: 0.4 }),
			point(2, 2000, { capturable: true }),
		];
		brain.decide(
			input({ selfX: 1800, control: points, foes: 900 }),
			output,
			false,
			16,
		);
		expect(brain.insight.target).toBe(1);
		expect(brain.insight.defending).toBe(true);
		expect(output.moveLeft).toBe(true);
	});

	it("cedes movement to a fight inside melee range — off the pad", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ selfX: 1500, foes: 70 }), output, false, 16);
		// The objective is remembered, but the fight owns the footwork.
		expect(brain.insight.target).toBe(2);
		expect(output.moveRight).toBe(false);
	});

	it("holds the pad while trading, but hands movement back when hurt", () => {
		const healthy = new ControlBrain();
		const healthyOut = freshOutput();
		// The fight brain wants to chase; the objective overrides it: stand and
		// trade, because the bar is the fight.
		healthyOut.moveRight = true;
		healthy.decide(input({ selfX: 2000, foes: 70 }), healthyOut, false, 16);
		expect(healthyOut.moveLeft).toBe(false);
		expect(healthyOut.moveRight).toBe(false);

		const hurt = new ControlBrain();
		const hurtOut = freshOutput();
		// One exchange from dying: the state machine keeps its movement, so a
		// bot that wants to retreat can.
		hurtOut.moveRight = true;
		hurt.decide(
			input({ selfX: 1500, selfHP: 20, foes: 70 }),
			hurtOut,
			false,
			16,
		);
		expect(hurtOut.moveRight).toBe(true);
	});

	it("stands aside for a thirst hunt", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ selfX: 1500 }), output, true, 16);
		expect(output.moveRight).toBe(false);
	});

	it("detours to a pack when the gun is dry, but not when supplied", () => {
		// The capturable point is to the right (x=2000); the pack is behind, at
		// x=900. A dry bot should turn around for it...
		const dry = new ControlBrain();
		const dryOut = freshOutput();
		dry.decide(
			input({ selfX: 1400, rounds: 0, packs: [{ x: 900, y: 534 }] }),
			dryOut,
			false,
			16,
		);
		expect(dryOut.moveLeft).toBe(true);
		expect(dryOut.moveRight).toBe(false);

		// ...and a supplied bot should keep walking the objective.
		const fed = new ControlBrain();
		const fedOut = freshOutput();
		fed.decide(
			input({ selfX: 1400, rounds: 48, packs: [{ x: 900, y: 534 }] }),
			fedOut,
			false,
			16,
		);
		expect(fedOut.moveRight).toBe(true);
		expect(fedOut.moveLeft).toBe(false);
	});

	it("detours for an empty kit too, and only within reach", () => {
		const emptyKit = new ControlBrain();
		const kitOut = freshOutput();
		emptyKit.decide(
			input({
				selfX: 1400,
				rounds: 48,
				items: 0,
				packs: [{ x: 900, y: 534 }],
			}),
			kitOut,
			false,
			16,
		);
		expect(kitOut.moveLeft).toBe(true);

		// A pack across the map is not a detour, it is an abandonment.
		const far = new ControlBrain();
		const farOut = freshOutput();
		far.decide(
			input({ selfX: 1400, rounds: 0, packs: [{ x: 340, y: 534 }] }),
			farOut,
			false,
			16,
		);
		expect(farOut.moveRight).toBe(true);
	});

	it("never leaves a defence to go shopping", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		const points = [
			point(1, 1200, { owner: 0, mine: true, attacker: 1, progress: 0.4 }),
			point(2, 2000, { capturable: true }),
		];
		brain.decide(
			input({
				selfX: 1200,
				rounds: 0,
				control: points,
				packs: [{ x: 900, y: 534 }],
			}),
			output,
			false,
			16,
		);
		// Defending the point under attack wins over the pack: stand, don't shop.
		expect(brain.insight.defending).toBe(true);
		expect(output.moveLeft).toBe(false);
		expect(output.moveRight).toBe(false);
	});
});
