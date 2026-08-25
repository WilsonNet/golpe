import { describe, expect, it, vi } from "vitest";
import type { AIConfig } from "./AIConfig.js";
import { EnemyBrain } from "./EnemyBrain.js";
import type { AIInput, AIOutput, FoeInfo } from "./types.js";

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
		selfItemCharges: 0,
		selfAmmo: 12,
		selfReserveRounds: 36,
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

	it("a cornered flee turns and fights — the wall is the end of the runway", () => {
		// Low HP starts a RETREAT down an open runway; when the fleeing bot
		// reaches the wall (the escape direction is blocked for 700ms), the
		// flee has failed — the brain commits to ATTACK and stays committed
		// instead of re-fleeing on the next decision.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const input = perception({
			distanceToPlayer: 60,
			selfHP: 20,
			enemyHP: 100,
			playerX: 340,
			selfX: 400,
		});
		try {
			brain.decide(input, 0, DT);
			expect(brain.getCurrentState()).toBe("RETREAT");
			for (let i = 0; i < 30; i++) brain.decide(input, 0, DT);
			expect(brain.getCurrentState()).toBe("RETREAT");
			input.touchingRight = true;
			for (let i = 0; i < 30; i++) brain.decide(input, 0, DT);
			expect(brain.getCurrentState()).toBe("ATTACK");
			for (let i = 0; i < 10; i++) brain.decide(input, 0, DT);
			expect(brain.getCurrentState()).toBe("ATTACK");
		} finally {
			spy.mockRestore();
		}
	});

	it("a hurt bot refuses a flee it cannot run — a wall behind commits now", () => {
		// The same low-HP strike-range situation, but the wall is already
		// behind on the very first decision: RETREAT would run into it, so the
		// brain skips the flee and commits to the fight immediately.
		const output = decide(
			perception({
				distanceToPlayer: 60,
				selfHP: 20,
				enemyHP: 100,
				playerX: 340,
				selfX: 400,
				touchingRight: true,
			}),
			0.5,
		);
		expect(output.attack).toBe(true);
	});

	it("a dry gun never zones — zoning is the ranged game, and the ranged game is over", () => {
		// Strike range, hale, a roll that would zone (0.07 < wantsSpace): the
		// only thing stopping ZONE is the empty magazine and reserve.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.07);
		try {
			brain.decide(
				perception({
					distanceToPlayer: 60,
					selfHP: 100,
					enemyHP: 100,
					selfAmmo: 0,
					selfReserveRounds: 0,
				}),
				0,
				DT,
			);
			expect(brain.getCurrentState()).toBe("ATTACK");
		} finally {
			spy.mockRestore();
		}
	});

	it("an armed gun still zones on the same roll — the space is for the rifle", () => {
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.07);
		try {
			brain.decide(
				perception({
					distanceToPlayer: 60,
					selfHP: 100,
					enemyHP: 100,
					selfAmmo: 6,
					selfReserveRounds: 12,
				}),
				0,
				DT,
			);
			expect(brain.getCurrentState()).toBe("ZONE");
		} finally {
			spy.mockRestore();
		}
	});

	it("a chase shoots the runner down — the walk never closes, the gun does", () => {
		// Beyond the chase band (500 > 400), the sword holsters on the first
		// tick; from then on the chase presses the trigger whenever it has a
		// live gun and a sightline.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const input = perception({
			distanceToPlayer: 500,
			selfHP: 100,
			enemyHP: 20,
			selfAmmo: 5,
			playerX: 800,
			selfX: 300,
		});
		try {
			brain.decide(input, 0, DT);
			const out = brain.decide(input, 0, DT);
			expect(out.attack).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it("a dry chaser does not waste the press — no rounds, no trigger", () => {
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const input = perception({
			distanceToPlayer: 500,
			selfHP: 100,
			enemyHP: 20,
			selfAmmo: 0,
			selfReserveRounds: 0,
			playerX: 800,
			selfX: 300,
		});
		try {
			brain.decide(input, 0, DT);
			const out = brain.decide(input, 0, DT);
			expect(out.attack).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("chases a fleeing foe with a burst — the runner is caught by the dash", () => {
		// 380px out, the foe running away (vx > 0, foe on the right): the
		// fleeing bonus pushes the roll (0.05 < 0.37) and the chase bursts in.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.05);
		const input = perception({
			distanceToPlayer: 380,
			selfHP: 100,
			enemyHP: 100,
			playerX: 780,
			selfX: 400,
			enemyVX: 60,
		});
		try {
			brain.decide(input, 0, DT);
			const out = brain.decide(input, 0, DT);
			expect(out.dash).toBe(1);
		} finally {
			spy.mockRestore();
		}
	});

	it("turns to fight when the pursuer catches up — a failed flee is a fight", () => {
		// Low HP flees from a pursuer 100px behind — but after 700ms of
		// running, a pursuer still that close means the escape is not
		// working, so the flee becomes a fight instead of draining the clock.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const input = perception({
			distanceToPlayer: 100,
			selfHP: 20,
			enemyHP: 100,
			playerX: 340,
			selfX: 440,
		});
		try {
			brain.decide(input, 0, DT);
			expect(brain.getCurrentState()).toBe("RETREAT");
			for (let i = 0; i < 60; i++) brain.decide(input, 0, DT);
			expect(brain.getCurrentState()).toBe("ATTACK");
		} finally {
			spy.mockRestore();
		}
	});

	it("holsters the sword against a fleeing foe out of reach — the gun finishes", () => {
		// 200px out, the foe running away: the blade cannot reach a runner
		// outside strike range, so the stance gives the gun the job instead of
		// swinging at the air all the way across the arena.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const input = perception({
			distanceToPlayer: 200,
			selfHP: 100,
			enemyHP: 30,
			playerX: 600,
			selfX: 400,
			enemyVX: 60,
		});
		try {
			const out = brain.decide(input, 0, DT);
			expect(out.swordStance).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("keeps the sword against a stationary foe — only a runner is the gun's prey", () => {
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		const input = perception({
			distanceToPlayer: 200,
			selfHP: 100,
			enemyHP: 100,
			playerX: 600,
			selfX: 400,
			enemyVX: 0,
		});
		try {
			const out = brain.decide(input, 0, DT);
			expect(out.swordStance).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	// ---- the thirst: isolated low-HP picks ----

	/**
	 * A standoff in a team room: the bot at 400px from its primary, which is
	 * on the LEFT, and a lone low-HP foe on the right — alone of its side.
	 * Ordinary reasoning would walk left after the primary; hunting walks
	 * right after the pick, so the movement axis is the discriminator.
	 */
	function standoffWithPick(
		pick: Partial<Omit<FoeInfo, "concealed">>,
	): AIInput {
		return perception({
			selfTeam: 0,
			roundNumber: 1,
			// Anands ally: the sort ranks this Lia fighter first, so the
			// bot is the vanguard and the team module adds no band strafes.
			allies: [
				{
					id: "ally",
					x: 300,
					y: 300,
					hp: 100,
					alive: true,
					distance: 600,
					hero: "anands",
				},
			],
			distanceToPlayer: 400,
			playerX: 500,
			playerY: 300,
			selfX: 900,
			selfY: 300,
			enemyHP: 100,
			foes: [
				{
					id: "primary",
					x: 500,
					y: 300,
					hp: 100,
					distance: 400,
					concealed: false,
				},
				{
					id: "pick",
					x: 1500,
					y: 300,
					hp: 20,
					distance: 600,
					concealed: false,
					...pick,
				},
			],
		});
	}

	it("hunts an isolated low-HP foe from a standoff — the thirst overrides the fight", () => {
		// The pick is 600px out, RIGHT; the primary is LEFT at 400. A hunt
		// walks right after the pick; a non-hunt stays on the primary.
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			const out = brain.decide(standoffWithPick({}), 0, DT);
			expect(brain.getInsight().hunting).toBe(true);
			expect(out.moveRight).toBe(true);
			expect(out.moveLeft).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not hunt a foe it cannot see — smoke concealment blocks the thirst", () => {
		// The pick on the RIGHT is concealed; the primary on the LEFT is the
		// only visible foe, so the brain stays on it (a left walk).
		const input = perception({
			selfTeam: 0,
			roundNumber: 1,
			allies: [
				{
					id: "ally",
					x: 300,
					y: 300,
					hp: 100,
					alive: true,
					distance: 600,
					hero: "anands",
				},
			],
			distanceToPlayer: 400,
			playerX: 500,
			playerY: 300,
			selfX: 900,
			selfY: 300,
			enemyHP: 100,
			foes: [
				{
					id: "primary",
					x: 500,
					y: 300,
					hp: 100,
					distance: 400,
					concealed: false,
				},
				{ id: "pick", x: 1500, y: 300, hp: 20, distance: 600, concealed: true },
			],
		});
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			const out = brain.decide(input, 0, DT);
			expect(brain.getInsight().hunting).toBe(false);
			expect(out.moveLeft).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not hunt a low-HP foe that has a friend beside it", () => {
		const input = perception({
			selfTeam: 0,
			roundNumber: 1,
			allies: [
				{
					id: "ally",
					x: 300,
					y: 300,
					hp: 100,
					alive: true,
					distance: 600,
					hero: "anands",
				},
			],
			distanceToPlayer: 400,
			playerX: 500,
			playerY: 300,
			selfX: 900,
			selfY: 300,
			enemyHP: 100,
			foes: [
				{
					id: "primary",
					x: 500,
					y: 300,
					hp: 100,
					distance: 400,
					concealed: false,
				},
				{
					id: "pick",
					x: 1500,
					y: 300,
					hp: 20,
					distance: 600,
					concealed: false,
				},
				{
					id: "pickFriend",
					x: 1350,
					y: 300,
					hp: 100,
					distance: 450,
					concealed: false,
				},
			],
		});
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			const out = brain.decide(input, 0, DT);
			expect(brain.getInsight().hunting).toBe(false);
			expect(out.moveLeft).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not abandon a fight at point-blank for a pick a screen away", () => {
		const input = perception({
			selfTeam: 0,
			roundNumber: 1,
			allies: [
				{
					id: "ally",
					x: 300,
					y: 300,
					hp: 100,
					alive: true,
					distance: 600,
					hero: "anands",
				},
			],
			distanceToPlayer: 100,
			playerX: 800,
			playerY: 300,
			selfX: 900,
			selfY: 300,
			enemyHP: 100,
			foes: [
				{
					id: "primary",
					x: 800,
					y: 300,
					hp: 100,
					distance: 100,
					concealed: false,
				},
				{
					id: "pick",
					x: 1800,
					y: 300,
					hp: 20,
					distance: 900,
					concealed: false,
				},
			],
		});
		const brain = new EnemyBrain(CONFIG);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			const out = brain.decide(input, 0, DT);
			expect(brain.getInsight().hunting).toBe(false);
			expect(out.moveLeft).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});
});
