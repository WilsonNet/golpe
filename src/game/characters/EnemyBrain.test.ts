import { describe, expect, it, vi } from "vitest";
import type { AIConfig } from "./AIConfig.js";
import { EnemyBrain } from "./EnemyBrain.js";
import type { AIInput, AIOutput } from "./types.js";

const DT = 1000 / 60;

const CONFIG: AIConfig = {
	skillLevel: 5,
	reactionTime: 150,
	accuracy: 0.8,
	aggressiveness: 0.5,
	dodgeChance: 0.2,
};

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

function decide(
	input: AIInput,
	random: number,
	config: AIConfig = CONFIG,
): AIOutput {
	const brain = new EnemyBrain(config);
	const spy = vi.spyOn(Math, "random").mockReturnValue(random);
	try {
		return brain.decide(input, 0, DT);
	} finally {
		spy.mockRestore();
	}
}

describe("EnemyBrain", () => {
	it("bursts in to close the gap when the foe is in neutral and out of reach", () => {
		// Inside ATTACK range (200 < 280) with line of sight, outside a
		// swing's reach (200 > 130): the dash roll is
		// `random < 0.06 + 0.03 + 0.03` — mock 0.1 fires it, toward the foe
		// on the right.
		const output = decide(
			perception({
				distanceToPlayer: 200,
				enemyAction: "none",
			}),
			0.1,
		);
		expect(output.dash).toBe(1);
	});

	it("does not burst into a foe mid-swing", () => {
		const output = decide(
			perception({
				distanceToPlayer: 200,
				enemyAction: "slash",
				enemyPhase: "active",
			}),
			0.1,
		);
		expect(output.dash).toBe(0);
	});

	it("retreats with a burst when hurt — a walk retreat cannot escape", () => {
		// Low HP forces RETREAT at sword range; the foe is on the left, so
		// the escape burst carries the bot right, away from the pursuer.
		const output = decide(
			perception({
				distanceToPlayer: 60,
				selfHP: 20,
				enemyHP: 100,
				playerX: 340,
				selfX: 400,
			}),
			0.1,
		);
		expect(output.dash).toBe(1);
		expect(output.moveRight).toBe(true);
	});

	it("runs from a hostile black hole, dash first — the dash is the escape", () => {
		// A hostile hole 234px away on the left: inside the outer reach plus
		// the reaction margin, outside the event horizon. The bot drops every
		// plan and bursts right, away from the tug.
		const output = decide(
			perception({
				fields: [{ x: 250, y: 300, hostile: true }],
				selfX: 400,
			}),
			0.1,
		);
		expect(output.dash).toBe(1);
		expect(output.moveRight).toBe(true);
		expect(output.moveLeft).toBe(false);
		expect(output.attack).toBe(false);
	});

	it("ignores its own side's hole — the tug is a friendly-fire predicate", () => {
		// 0.5 keeps the state machine out of ZONE (its escape burst would set
		// the dash on its own) so the dash can only come from the hole rule —
		// and a friendly hole must not trigger it.
		const output = decide(
			perception({
				fields: [{ x: 250, y: 300, hostile: false }],
				selfX: 400,
			}),
			0.5,
		);
		expect(output.dash).toBe(0);
	});

	it("jumps a hostile trap a step before the feet would cross it", () => {
		// A trap whose trigger sits 70px from the feet (inside radius + the
		// reaction margin): the bot leaves the floor instead of walking onto
		// it. The trap's centre is at feet level, world coords — the same
		// body-space conversion `trapCatches` uses. The foe stands level, so
		// the height wish cannot press the jump instead.
		const output = decide(
			perception({
				playerY: 480,
				traps: [{ x: 316 + 70, y: 480 + 48 }],
			}),
			0.5,
		);
		expect(output.jump).toBe(true);
	});

	it("does not hop when the trap is too far to matter", () => {
		const output = decide(
			perception({
				playerY: 480,
				traps: [{ x: 316 + 300, y: 480 + 48 }],
			}),
			0.5,
		);
		expect(output.jump).toBe(false);
	});
});
