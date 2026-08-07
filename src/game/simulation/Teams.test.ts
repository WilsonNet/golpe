/**
 * The team rules, unit-tested.
 *
 * These are the checks a probe cannot make cheaply or reliably: a wipe-out is a
 * one-tick event in a fight that lasts thirty seconds, and "did the *empty* side
 * count as wiped" is a condition that only shows up in a room somebody joins
 * mid-match. The *behaviour* — do rounds actually end, does the score reach the
 * limit, does a bot ever hit a teammate — is measured by
 * `scripts/tdm-probe.ts` against a real server.
 */

import { describe, expect, it } from "vitest";
import {
	buildWorld,
	pickTeamSpawn,
	SCREEN_W,
	teamSpawnPoints,
} from "./Arena.js";
import {
	aliveCounts,
	balanceTeam,
	hostile,
	ROUND_FREEZE_MS,
	ROUND_RESET_DELAY_MS,
	roundResult,
	sameTeam,
	TDM_MIN_SCREENS,
	TDM_SCORE_LIMIT,
	type TeamId,
	teamAhead,
	teamCounts,
	teamMatchWinner,
	teamName,
} from "./Teams.js";

const member = (team: TeamId | null, alive = true) => ({ team, alive });

describe("sides", () => {
	it("nobody is on the same side as a fighter with no team", () => {
		// The whole of how free-for-all keeps working: every fighter carries
		// `null`, and `null` is not its own teammate.
		expect(sameTeam(null, null)).toBe(false);
		expect(hostile(null, null)).toBe(true);
	});

	it("same team is friendly, different teams are not", () => {
		expect(sameTeam(0, 0)).toBe(true);
		expect(hostile(0, 0)).toBe(false);
		expect(hostile(0, 1)).toBe(true);
	});

	it("a fighter with a team is still hostile to one without", () => {
		expect(hostile(0, null)).toBe(true);
		expect(hostile(null, 1)).toBe(true);
	});
});

describe("balancing", () => {
	it("seats the next fighter on the smaller side", () => {
		expect(balanceTeam([0, 0])).toBe(0);
		expect(balanceTeam([1, 0])).toBe(1);
		expect(balanceTeam([3, 4])).toBe(0);
	});

	it("splits sixteen fighters evenly when they arrive one at a time", () => {
		const members: { team: TeamId | null; alive: boolean }[] = [];
		for (let i = 0; i < 16; i++) {
			members.push(member(balanceTeam(teamCounts(members))));
		}
		expect(teamCounts(members)).toEqual([8, 8]);
	});

	it("an odd room is never off by more than one", () => {
		const members: { team: TeamId | null; alive: boolean }[] = [];
		for (let i = 0; i < 7; i++) {
			members.push(member(balanceTeam(teamCounts(members))));
		}
		const [a, b] = teamCounts(members);
		expect(Math.abs((a ?? 0) - (b ?? 0))).toBe(1);
	});
});

describe("the wipe-out round", () => {
	it("is not over while both sides have somebody standing", () => {
		expect(roundResult([member(0), member(1)])).toBeNull();
	});

	it("is won by the side left standing", () => {
		expect(roundResult([member(0), member(1, false)])).toEqual({
			kind: "win",
			team: 0,
		});
	});

	it("counts a side with one survivor as alive", () => {
		const members = [member(0, false), member(0), member(1), member(1, false)];
		expect(roundResult(members)).toBeNull();
		expect(aliveCounts(members)).toEqual([1, 1]);
	});

	it("is a draw when both sides fall on the same tick", () => {
		// A black hole makes this perfectly possible, and it must score nobody
		// rather than crediting whichever side the iteration happened to reach.
		expect(roundResult([member(0, false), member(1, false)])).toEqual({
			kind: "draw",
		});
	});

	it("never ends while one side has nobody seated at all", () => {
		// The bug this exists to prevent: a room with one fighter in it would
		// otherwise "wipe" the empty side sixty times a second and win the match
		// before the second player finished connecting.
		expect(roundResult([member(0)])).toBeNull();
		expect(roundResult([member(0), member(0)])).toBeNull();
		expect(roundResult([])).toBeNull();
	});

	it("ignores fighters with no team", () => {
		expect(roundResult([member(null), member(null, false)])).toBeNull();
	});

	it("leaves five seconds to watch the last exchange and read the score", () => {
		expect(ROUND_RESET_DELAY_MS).toBe(5000);
	});

	it("holds everybody for four seconds before the next round", () => {
		// The number the mode is paced around. A probe may shorten it with
		// `?freezeTime=`, so the default is only ever asserted here — which is why
		// it is asserted here.
		expect(ROUND_FREEZE_MS).toBe(4000);
	});
});

describe("the match", () => {
	it("is won by the side that reaches the round limit", () => {
		expect(teamMatchWinner([TDM_SCORE_LIMIT, 3], TDM_SCORE_LIMIT)).toBe(0);
		expect(
			teamMatchWinner([TDM_SCORE_LIMIT - 1, 3], TDM_SCORE_LIMIT),
		).toBeNull();
	});

	it("names whoever is ahead when the clock runs out", () => {
		expect(teamAhead([4, 2])).toBe(0);
		expect(teamAhead([2, 4])).toBe(1);
		expect(teamAhead([3, 3])).toBeNull();
	});

	it("has names for both sides", () => {
		expect(teamName(0)).toBe("AZURE");
		expect(teamName(1)).toBe("EMBER");
		expect(teamName(null)).toBe("");
	});
});

describe("team spawns", () => {
	const world = buildWorld(TDM_MIN_SCREENS);

	it("puts each side on its own end screen", () => {
		for (const p of teamSpawnPoints(world, 0))
			expect(p.x).toBeLessThan(SCREEN_W);
		for (const p of teamSpawnPoints(world, 1)) {
			expect(p.x).toBeGreaterThan(world.right - SCREEN_W);
		}
	});

	it("is one screen each however wide the room is", () => {
		// A fraction of the arena is the same thing as a screen at three screens
		// and a vague blob at eight. The leftmost and rightmost *screens* are what
		// a player can actually point at.
		const wide = buildWorld(8);
		for (const p of teamSpawnPoints(wide, 0))
			expect(p.x).toBeLessThan(SCREEN_W);
		for (const p of teamSpawnPoints(wide, 1)) {
			expect(p.x).toBeGreaterThan(wide.right - SCREEN_W);
		}
		// And the middle six screens belong to nobody.
		expect(teamSpawnPoints(wide, 0).length).toBe(
			teamSpawnPoints(wide, 1).length,
		);
	});

	it("faces each side across the map, whatever the screen layout said", () => {
		// The per-screen layout aims its spawns at the middle of *their* screen,
		// which on a three-screen arena would leave half a team with its back to
		// the fight — and facing decides which side a guard covers.
		expect(pickTeamSpawn([], world, 0).facing).toBe(1);
		expect(pickTeamSpawn([], world, 1).facing).toBe(-1);
	});

	it("spreads a side out rather than stacking it on one point", () => {
		const first = pickTeamSpawn([], world, 0);
		const second = pickTeamSpawn([first], world, 0);
		expect(second.x !== first.x || second.y !== first.y).toBe(true);
	});

	it("is deterministic, so both sides of the wire agree", () => {
		const taken = [{ x: 100, y: 518 }];
		expect(pickTeamSpawn(taken, world, 1)).toEqual(
			pickTeamSpawn(taken, world, 1),
		);
	});
});
