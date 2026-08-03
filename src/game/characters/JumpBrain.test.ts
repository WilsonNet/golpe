import { describe, expect, it } from "vitest";
import { JumpBrain } from "./JumpBrain.js";
import type { AIInput } from "./types.js";

/**
 * The press script timing is exact arithmetic, spelled out so a future tuning
 * change updates the tests instead of silently breaking them:
 *
 *   JUMP_HOLD_MS    = 240ms  → 15 full ticks, plus the tick it expires (16 ticks held)
 *   JUMP_RELEASE_MS = 60ms   → 4 ticks of gap
 *
 * A double jump therefore presses at tick 0 and again at tick 20.
 */
const DT = 1000 / 60;
const HOLD_TICKS = Math.ceil(240 / DT); // 15 — the expiring tick still holds
const RELEASE_START = HOLD_TICKS + 1; // 16
const SECOND_PRESS = RELEASE_START + Math.ceil(60 / DT); // 20

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
		selfAction: "none",
		selfStunned: false,
		selfMassiveReady: false,
		selfId: "t",
		selfAirJumps: 1,
		selfUltCharge: 0,
		enemyVX: 0,
		enemyVY: 0,
		selfTeam: null,
		allies: [],
		foes: [],
		fields: [],
		...overrides,
	};
}

/** Play a press script against `resolve`, returning the button state per tick. */
function play(
	ticks: number,
	wish: (tick: number) => { jump: boolean; double: boolean },
	air: (tick: number) => { grounded: boolean; airJumps: number },
) {
	const brain = new JumpBrain();
	const out: boolean[] = [];
	for (let i = 0; i < ticks; i++) {
		const a = air(i);
		out.push(
			brain.resolve(
				perception({ touchingDown: a.grounded, selfAirJumps: a.airJumps }),
				wish(i).jump,
				wish(i).double,
				DT,
			),
		);
	}
	return out;
}

const idleWish = () => ({ jump: false, double: true });
const ground = () => ({ grounded: true, airJumps: 1 });
const air = () => ({ grounded: false, airJumps: 1 });

describe("JumpBrain", () => {
	it("holds a plain jump for a committed press, then releases", () => {
		const out = play(24, (i) => ({ jump: i === 0, double: false }), air);
		// Held from the press tick through the hold, then a release gap, then
		// nothing — a single press edge, which is what `tickPlayer` needs.
		expect(out.slice(0, HOLD_TICKS + 1).every(Boolean)).toBe(true);
		expect(out[RELEASE_START]).toBe(false);
		expect(out.slice(RELEASE_START).every((p) => !p)).toBe(true);
	});

	it("double jump: presses, releases, and presses again in the air", () => {
		const out = play(SECOND_PRESS + 12, idleWish, (i) =>
			i < 2 ? ground() : air(),
		);
		expect(out[0]).toBe(true);
		expect(out[SECOND_PRESS - 1]).toBe(false);
		expect(out[SECOND_PRESS]).toBe(true);
		// Two clean press edges, so the simulation can detect both jumps.
		const edges = out.filter((p, i) => p && !out[i - 1]).length;
		expect(edges).toBe(2);
	});

	it("never spends the air jump on a wish after it is exhausted", () => {
		// Knocked into the air with no air jump left: the wish persists, and the
		// controller must not invent a press the simulation would eat.
		const out = play(60, idleWish, () => ({ grounded: false, airJumps: 0 }));
		expect(out.every((p) => !p)).toBe(true);
	});

	it("ignores a stale double wish while airborne with no script running", () => {
		const out = play(3, idleWish, air);
		expect(out).toEqual([false, false, false]);
	});

	it("still allows a wall jump: a plain wish works while airborne", () => {
		const out = play(
			20,
			(i) => ({ jump: i === 0, double: false }),
			() => ({ grounded: false, airJumps: 1 }),
		);
		expect(out[0]).toBe(true);
	});

	it("re-arms on landing while the wish persists, for a fresh climb", () => {
		// Starts on the ground (press 1), takes off (the armed press 2 fires in
		// the air at tick 20), lands at tick 30 while the wish still holds, and
		// presses again at the first opportunity — four clean edges, meaning the
		// climb is re-attempted rather than abandoned.
		const out = play(60, idleWish, (i) =>
			i < 2 ? ground() : i < 30 ? air() : ground(),
		);
		const edges = out.filter((p, i) => p && !out[i - 1]).length;
		expect(edges).toBe(4);
	});
});
