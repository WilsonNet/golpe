import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD } from "../simulation/Arena.js";
import { TeamBrain } from "./TeamBrain.js";
import type { AIInput, AIOutput, MeleeModuleView } from "./types.js";

const DT = 1000 / 60;

const MELEE_VIEW: MeleeModuleView = {
	swordDrawn: true,
	interruptWithGuard: () => {},
};

function perception(overrides: Partial<AIInput> = {}): AIInput {
	return {
		playerX: 700,
		playerY: 300,
		selfX: 400,
		selfY: 300,
		distanceToPlayer: 300,
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
		enemyConcealed: false,
		enemyGrounded: true,
		selfAirJumps: 1,
		selfUltCharge: 0,
		selfUltCap: 100,
		incomingFire: false,
		enemyVX: 0,
		enemyVY: 0,
		selfTeam: 0,
		roundNumber: 1,
		allies: [
			{
				id: "ally",
				x: 200,
				y: 300,
				hp: 100,
				alive: true,
				distance: 200,
				hero: "lia",
			},
		],
		foes: [
			{ id: "foe", x: 700, y: 300, hp: 100, distance: 300, concealed: false },
		],
		fields: [],
		traps: [],
		selfItemCharges: 0,
		selfAmmo: 12,
		selfReserveRounds: 36,
		...overrides,
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
		face: 1,
		dash: 0,
		aimAngle: 0,
		evadeActive: false,
		ultimate: false,
		item: false,
	};
}

describe("TeamBrain", () => {
	it("the side with more combined HP is the aggressor", () => {
		const brain = new TeamBrain(DEFAULT_WORLD);
		// Self side: 100 + ally 100 = 200. Enemy side: 100. Clearly ahead.
		const pushing = brain.pushDecision(perception({}));
		expect(pushing).toBe(true);
		expect(brain.insight.pushing).toBe(true);
		expect(brain.insight.sideHp).toBe(200);
		expect(brain.insight.foeSideHp).toBe(100);
	});

	it("the side behind is not the aggressor — the HP lead decides", () => {
		const brain = new TeamBrain(DEFAULT_WORLD);
		const pushing = brain.pushDecision(
			perception({
				foes: [
					{
						id: "foe",
						x: 700,
						y: 300,
						hp: 180,
						distance: 300,
						concealed: false,
					},
				],
			}),
		);
		expect(pushing).toBe(false);
	});

	it("equal totals toss the round's coin — exactly one side, and it flips next round", () => {
		// Both sides at 100 + 100: identical totals. Team 0 gets the odd rounds,
		// team 1 the even ones — the same arithmetic both members of a side
		// compute, and the sides never get the same answer in one round.
		const brain = new TeamBrain(DEFAULT_WORLD);
		const foes200 = [
			{ id: "foe", x: 700, y: 300, hp: 200, distance: 300, concealed: false },
		];
		const alliesOther = (id: string) => [
			{
				id,
				x: 200,
				y: 300,
				hp: 100,
				alive: true,
				distance: 200,
				hero: "lia" as const,
			},
		];

		expect(
			brain.pushDecision(
				perception({ roundNumber: 1, foes: foes200, allies: alliesOther("a") }),
			),
		).toBe(false);
		expect(
			brain.pushDecision(
				perception({
					selfTeam: 1,
					roundNumber: 1,
					foes: foes200,
					allies: alliesOther("a"),
				}),
			),
		).toBe(true);
		expect(
			brain.pushDecision(
				perception({ roundNumber: 2, foes: foes200, allies: alliesOther("a") }),
			),
		).toBe(true);
		expect(
			brain.pushDecision(
				perception({
					selfTeam: 1,
					roundNumber: 2,
					foes: foes200,
					allies: alliesOther("a"),
				}),
			),
		).toBe(false);
	});

	it("near-equal totals are a toss-up too — the window keeps a one-point lead from flapping", () => {
		const brain = new TeamBrain(DEFAULT_WORLD);
		// Inside the 25-point window: 200 vs 180 is not "the side ahead" and
		// the coin answers instead (team 0, round 1 → false).
		const pushing = brain.pushDecision(
			perception({
				foes: [
					{
						id: "foe",
						x: 700,
						y: 300,
						hp: 180,
						distance: 300,
						concealed: false,
					},
				],
			}),
		);
		expect(pushing).toBe(false);
	});

	it("a dry support walks in to strike range instead of kiting the band", () => {
		// 300px out with no magazine and no reserve: the gun cannot do
		// anything, so kite-the-band becomes walk-in — the foe is on the
		// right, and a strafe would not be a committed direction.
		const brain = new TeamBrain(DEFAULT_WORLD);
		const out = freshOutput();
		brain.decide(
			perception({ selfAmmo: 0, selfReserveRounds: 0, distanceToPlayer: 300 }),
			out,
			MELEE_VIEW,
			"support",
			false,
			DT,
		);
		expect(out.moveRight).toBe(true);
		expect(out.moveLeft).toBe(false);
	});

	it("a pushing support holds the band floor instead of peeling it", () => {
		const brain = new TeamBrain(DEFAULT_WORLD);
		brain.pushDecision(perception({}));
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
		try {
			const out = freshOutput();
			brain.decide(
				perception({ distanceToPlayer: 200 }),
				out,
				MELEE_VIEW,
				"support",
				false,
				DT,
			);
			// The enemy is on the right; a kite would run left. Holding, the
			// strafe starts at +1 and the flip roll failed — so right.
			expect(out.moveRight).toBe(true);
			expect(out.moveLeft).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("stands aside during the hunt but still spaces", () => {
		const brain = new TeamBrain(DEFAULT_WORLD);
		const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
		try {
			const out = freshOutput();
			out.moveRight = true; // the state machine's walk-in toward the foe
			brain.decide(perception({}), out, MELEE_VIEW, "support", true, DT);
			// Hunting: no kite, no band strafe — the state machine's walk-in
			// stands.
			expect(out.moveRight).toBe(true);
			expect(out.moveLeft).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});
});
