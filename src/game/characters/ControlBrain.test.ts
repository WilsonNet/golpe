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
	foes?: number;
	control?: ControlPointInfo[] | null;
	hunting?: boolean;
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
	return {
		selfX: over.selfX ?? 1200,
		selfTeam: 0,
		distanceToPlayer: over.foes ?? 900,
		control: points === null ? null : { points, frontier: 1 },
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

	it("cedes movement to a fight inside melee range", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ selfX: 1500, foes: 70 }), output, false, 16);
		// The objective is remembered, but the fight owns the footwork.
		expect(brain.insight.target).toBe(2);
		expect(output.moveRight).toBe(false);
	});

	it("stands aside for a thirst hunt", () => {
		const brain = new ControlBrain();
		const output = freshOutput();
		brain.decide(input({ selfX: 1500 }), output, true, 16);
		expect(output.moveRight).toBe(false);
	});
});
