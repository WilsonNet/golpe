import { describe, expect, it } from "vitest";
import { AXE_CHARGE_MS } from "../../tweakables/ranged.js";
import { buildWorld } from "../simulation/Arena.js";
import { axeTouches, launchAxe, tickAxe } from "../simulation/Axes.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../simulation/Physics.js";
import { AxeBrain } from "./AxeBrain.js";
import type { AIInput, AIOutput } from "./types.js";

/** An open room: the axe's arc with nothing in the way. */
const OPEN = { ...buildWorld(1), platforms: [] };

function input(dx: number, dy: number, charge: number): AIInput {
	const selfX = 400;
	const selfY = 400;
	return {
		selfX,
		selfY,
		playerX: selfX + dx,
		playerY: selfY + dy,
		distanceToPlayer: Math.hypot(dx, dy),
		enemyVX: 0,
		enemyBlocking: false,
		selfAmmo: 10,
		selfThrowCharge: charge,
		touchingDown: true,
		hasLineOfSight: true,
	} as unknown as AIInput;
}

function output(): AIOutput {
	return {
		moveLeft: false,
		moveRight: false,
		jump: false,
		attack: true,
		block: false,
		uppercut: false,
		swordStance: false,
		face: 1,
		dash: 0,
		aimAngle: 0,
		evadeActive: false,
		ultimate: false,
		item: false,
	};
}

/** Charge until the brain lets go, then fly the axe and see if it lands on the target. */
function throwAt(dx: number, dy: number): boolean {
	const brain = new AxeBrain();
	let charge = 0;
	for (let t = 0; t < 200; t++) {
		const o = output();
		brain.decide(input(dx, dy, charge), o);
		if (!o.attack) {
			const a = launchAxe(
				1,
				"me",
				0,
				400 + PLAYER_WIDTH / 2,
				400 + PLAYER_HEIGHT / 3,
				o.aimAngle,
				charge,
			);
			for (let i = 0; i < 600 && !a.resting; i++) {
				tickAxe(a, 1 / 60, OPEN);
				if (axeTouches(a, "foe", 1, 400 + dx, 400 + dy)) return true;
			}
			return false;
		}
		charge = Math.min(AXE_CHARGE_MS, charge + 1000 / 60);
	}
	return false;
}

describe("the axe brain's lob", () => {
	for (const [dx, dy] of [
		[90, 0],
		[200, 0],
		[-200, 0],
		[350, 0],
		[300, -120],
		[350, -60],
		[300, 100],
	] as const) {
		it(`lands an axe on a target ${dx},${dy} away`, () => {
			expect(throwAt(dx, dy)).toBe(true);
		});
	}
});
