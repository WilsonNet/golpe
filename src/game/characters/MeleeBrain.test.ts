import { describe, expect, it, vi } from "vitest";
import { MeleeBrain } from "./MeleeBrain.js";
import type { AIInput, AIOutput } from "./types.js";

const DT = 1000 / 60;

function perception(overrides: Partial<AIInput> = {}): AIInput {
	return {
		playerX: 360,
		playerY: 300,
		selfX: 300,
		selfY: 480,
		distanceToPlayer: 60,
		playerFacingDirection: -1,
		touchingDown: true,
		touchingLeft: false,
		touchingRight: false,
		hasLineOfSight: true,
		selfHP: 100,
		enemyHP: 100,
		enemyAction: "none",
		enemyPhase: "none",
		enemyBlocking: false,
		enemyStunned: false,
		enemyPlunging: false,
		enemyStuck: false,
		selfAction: "none",
		selfStunned: false,
		selfPlunging: false,
		selfStuck: false,
		selfMassiveReady: false,
		selfCharging: false,
		selfId: "t",
		selfHero: "lia",
		enemyHero: "lia",
		enemyGrounded: true,
		selfAirJumps: 1,
		selfUltCharge: 0,
		enemyVX: 0,
		enemyVY: 0,
		selfTeam: null,
		allies: [],
		foes: [],
		fields: [],
		traps: [],
		selfItemCharges: 0,
		...overrides,
	};
}

function decide(input: AIInput, skill: number, random: number): AIOutput {
	const brain = new MeleeBrain();
	const output: AIOutput = {
		moveLeft: false,
		moveRight: false,
		jump: false,
		attack: false,
		block: false,
		uppercut: false,
		swordStance: true,
		face: 1,
		dash: 0,
		aimAngle: 0,
		evadeActive: false,
		ultimate: false,
		item: false,
	};
	const spy = vi.spyOn(Math, "random").mockReturnValue(random);
	try {
		brain.decide(input, output, DT, { role: null, skill, aggressiveness: 0.5 });
	} finally {
		spy.mockRestore();
	}
	return output;
}

describe("MeleeBrain", () => {
	it("backs out of an active swing the guard declined to stop", () => {
		// Skill 0: the guard read (`random < 0`) always fails, so the swing
		// must be answered with distance instead. The backstep roll is
		// `random < 0.1 + 0` — mock 0.05 fires it. The foe is on the right,
		// so the bot must walk left, away from the live hitbox.
		const output = decide(
			perception({
				enemyAction: "slash",
				enemyPhase: "active",
				distanceToPlayer: 60,
			}),
			0,
			0.05,
		);
		expect(output.moveLeft).toBe(true);
		expect(output.moveRight).toBe(false);
	});

	it("does not back out of a swing it decided to guard", () => {
		// Skill 10: the guard read (`random < 1`) always succeeds, so the
		// swing is blocked in place rather than walked away from.
		const output = decide(
			perception({
				enemyAction: "slash",
				enemyPhase: "active",
				distanceToPlayer: 60,
			}),
			10,
			0.05,
		);
		expect(output.block).toBe(true);
		expect(output.moveLeft).toBe(false);
		expect(output.moveRight).toBe(false);
	});

	it("never backs out of its own swing — a commitment stays a commitment", () => {
		const output = decide(
			perception({
				enemyAction: "slash",
				enemyPhase: "active",
				selfAction: "slash",
				distanceToPlayer: 60,
			}),
			0,
			0.05,
		);
		expect(output.moveLeft).toBe(false);
		expect(output.moveRight).toBe(false);
	});

	it("ignores a swing too far out to threaten", () => {
		const output = decide(
			perception({
				enemyAction: "slash",
				enemyPhase: "active",
				distanceToPlayer: 200,
			}),
			0,
			0.05,
		);
		expect(output.moveLeft).toBe(false);
		expect(output.moveRight).toBe(false);
	});
});
