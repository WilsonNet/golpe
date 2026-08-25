import { describe, expect, it } from "vitest";
import { BlossomBrain } from "./BlossomBrain.js";
import type { AIInput } from "./types.js";

function input(over: Partial<AIInput> = {}): AIInput {
	return {
		playerX: 500,
		playerY: 300,
		selfX: 400,
		selfY: 300,
		distanceToPlayer: 200,
		playerFacingDirection: 1,
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
		selfId: "me",
		selfHero: "jeffs",
		enemyHero: "lia",
		enemyGrounded: true,
		selfAirJumps: 1,
		selfUltCharge: 100,
		selfUltCap: 100,
		incomingFire: false,
		enemyVX: 0,
		enemyVY: 0,
		selfTeam: null,
		enemyConcealed: false,
		roundNumber: 1,
		allies: [],
		foes: [],
		fields: [],
		traps: [],
		selfItemCharges: 2,
		selfAmmo: 12,
		selfReserveRounds: 36,
		...over,
	};
}

describe("BlossomBrain", () => {
	it("holds for a beat and releases — a cast request per aim phase", () => {
		const brain = new BlossomBrain();
		// Two foes inside the ring: the storm's reason to exist.
		const i = input({
			foes: [
				{ id: "a", distance: 150, hp: 100, x: 500, y: 300, concealed: false },
				{ id: "b", distance: 200, hp: 100, x: 520, y: 320, concealed: false },
			],
		});
		brain.decide(i, 16.6, null);
		expect(brain.hold).toBe(true);
		// Run the hold out: it must release, not hold forever.
		for (let j = 0; j < 60; j++) brain.decide(i, 16.6, null);
		expect(brain.hold).toBe(false);
		expect(brain.insight.releases).toBe(1);
	});

	it("never aims without a full meter or with nobody in the ring", () => {
		const brain = new BlossomBrain();
		brain.decide(input({ selfUltCharge: 50 }), 16.6, null);
		expect(brain.hold).toBe(false);
		expect(brain.insight.lastDecline).toBe("not-armed");

		brain.decide(input({ foes: [] }), 16.6, null);
		expect(brain.hold).toBe(false);
		expect(brain.insight.lastDecline).toBe("no-foes");
	});

	it("a lone distant foe is not worth a storm", () => {
		const brain = new BlossomBrain();
		brain.decide(
			input({
				foes: [
					{ id: "a", distance: 400, hp: 100, x: 800, y: 300, concealed: false },
				],
			}),
			16.6,
			null,
		);
		expect(brain.hold).toBe(false);
		expect(brain.insight.lastDecline).toBe("no-target");
	});

	it("the patience rule eventually spends a full meter on a near foe", () => {
		const brain = new BlossomBrain();
		const i = input({
			foes: [
				{ id: "a", distance: 200, hp: 100, x: 500, y: 300, concealed: false },
			],
		});
		// Simulate 11 seconds of armed ticks.
		for (let t = 0; t < 700; t++) {
			brain.decide(i, 16.6, null);
			if (brain.hold) break;
		}
		expect(brain.hold).toBe(true);
	});
});
