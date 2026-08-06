import { describe, expect, it } from "vitest";
import { pickSpawn, SPAWN_POINTS } from "./Arena.js";
import {
	MVP_BLOCKED_PER_BURST,
	MVP_DAMAGE_PER_BURST,
	MVP_STAT_BURST,
	matchEndReason,
	matchWinner,
	mvpOf,
	mvpScore,
	rankScores,
	SCORE_LIMIT,
	type ScoreEntry,
	TIME_LIMIT_MS,
	timeLeftMs,
} from "./Deathmatch.js";
import { PLAYER_HEIGHT, PLAYER_WIDTH, penetrationDepth } from "./Physics.js";

function entry(id: string, kills: number, deaths = 0, name = id): ScoreEntry {
	return {
		id,
		name,
		kills,
		deaths,
		bot: false,
		damage: 0,
		denies: 0,
		blocked: 0,
	};
}

describe("rankScores", () => {
	it("ranks by frags, most first", () => {
		const ranked = rankScores([entry("a", 3), entry("b", 9), entry("c", 5)]);
		expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
		expect(ranked.map((r) => r.place)).toEqual([1, 2, 3]);
	});

	it("breaks a frag tie on fewest deaths", () => {
		const ranked = rankScores([entry("a", 5, 9), entry("b", 5, 2)]);
		expect(ranked[0]?.id).toBe("b");
	});

	/**
	 * The tie-break chain has to be *total*, not merely reasonable. Anything less
	 * leaves the order dependent on iteration order, which differs between the
	 * server's Map and whatever a client rebuilt from a snapshot — so two clients
	 * would draw two different podiums from identical data.
	 */
	it("is independent of input order", () => {
		const entries = [
			entry("a", 4, 4, "Ana"),
			entry("b", 4, 4, "Bo"),
			entry("c", 4, 4, "Cy"),
		];
		const forwards = rankScores(entries).map((r) => r.id);
		const backwards = rankScores([...entries].reverse()).map((r) => r.id);
		expect(backwards).toEqual(forwards);
	});

	it("does not mutate what it was given", () => {
		const entries = [entry("a", 1), entry("b", 2)];
		rankScores(entries);
		expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("handles an empty match", () => {
		expect(rankScores([])).toEqual([]);
		expect(matchWinner([])).toBeNull();
	});
});

describe("mvpScore", () => {
	/**
	 * The whole point of the MVP: the frags leader is not automatically the
	 * most valuable fighter. Two denies — each worth more than a frag — must be
	 * able to overtake a one-frag lead when the rest of the field is level.
	 */
	it("lets denies outweigh a frag lead", () => {
		const fragger = entry("a", 8, 3);
		const denier = { ...entry("b", 7, 4), denies: 2 };
		expect(mvpScore(denier)).toBeGreaterThan(mvpScore(fragger));
		expect(mvpOf([fragger, denier])?.id).toBe("b");
	});

	it("prices damage and blocked damage in bursts, not points", () => {
		// 99 damage is no burst; 100 is one. Points must never round-trip as a
		// float that two clients could disagree about.
		expect(mvpScore(entry("a", 0, 0, "A"))).toBe(
			mvpScore({ ...entry("a", 0, 0, "A"), damage: 99 }),
		);
		expect(mvpScore({ ...entry("a", 0, 0, "A"), damage: 100 })).toBe(
			MVP_DAMAGE_PER_BURST,
		);
		expect(
			mvpScore({ ...entry("a", 0, 0, "A"), blocked: MVP_STAT_BURST }),
		).toBe(MVP_BLOCKED_PER_BURST);
	});

	it("stays integer for four-digit damage", () => {
		const score = mvpScore({ ...entry("a", 12, 5, "A"), damage: 4860 });
		expect(Number.isInteger(score)).toBe(true);
	});

	it("is independent of input order, like rankScores", () => {
		const entries = [
			{ ...entry("a", 4, 4, "Ana"), damage: 900, denies: 2, blocked: 300 },
			{ ...entry("b", 5, 5, "Bo"), damage: 300, blocked: 900 },
			{ ...entry("c", 4, 3, "Cy"), denies: 1, blocked: 100 },
		];
		expect(mvpOf(entries)?.id).toBe(mvpOf([...entries].reverse())?.id);
	});
});

describe("matchEndReason", () => {
	it("runs while nobody has reached the limit", () => {
		expect(matchEndReason([entry("a", 20)], 1000)).toBeNull();
	});

	it("ends on the score limit", () => {
		expect(matchEndReason([entry("a", SCORE_LIMIT)], 1000)).toBe("score");
	});

	it("ends on the clock", () => {
		expect(matchEndReason([entry("a", 3)], TIME_LIMIT_MS)).toBe("time");
	});

	/**
	 * A frag landing on the final second should read as a won match, not an
	 * expired one — which is why score is checked before time.
	 */
	it("prefers the score limit when both land together", () => {
		expect(matchEndReason([entry("a", SCORE_LIMIT)], TIME_LIMIT_MS)).toBe(
			"score",
		);
	});

	it("floors the clock at zero", () => {
		expect(timeLeftMs(TIME_LIMIT_MS + 5000)).toBe(0);
	});
});

describe("spawn points", () => {
	it("has more points than the room has slots, so a respawn always has a choice", () => {
		expect(SPAWN_POINTS.length).toBeGreaterThan(16);
	});

	/**
	 * A spawn inside geometry is depenetrated on the first tick, which every other
	 * client sees as a teleport — from a fighter that has not done anything yet.
	 */
	it("places nobody inside a platform", () => {
		for (const point of SPAWN_POINTS) {
			expect(penetrationDepth(point.x, point.y)).toBe(0);
		}
	});

	it("keeps every spawn inside the arena", () => {
		for (const point of SPAWN_POINTS) {
			expect(point.x).toBeGreaterThanOrEqual(0);
			expect(point.x + PLAYER_WIDTH).toBeLessThanOrEqual(800);
			expect(point.y).toBeGreaterThanOrEqual(0);
			expect(point.y + PLAYER_HEIGHT).toBeLessThanOrEqual(600);
		}
	});

	it("faces every spawn toward the middle of the arena", () => {
		for (const point of SPAWN_POINTS) {
			expect(Math.abs(point.facing)).toBe(1);
		}
	});
});

describe("pickSpawn", () => {
	it("picks the point furthest from everyone", () => {
		const crowd = [
			{ x: 40, y: 518 },
			{ x: 120, y: 518 },
			{ x: 200, y: 518 },
		];
		const chosen = pickSpawn(crowd);
		for (const other of crowd) {
			expect(
				Math.hypot(chosen.x - other.x, chosen.y - other.y),
			).toBeGreaterThan(200);
		}
	});

	it("is deterministic, so client and server agree on where a fighter came back", () => {
		const crowd = [{ x: 375, y: 120 }];
		expect(pickSpawn(crowd)).toEqual(pickSpawn(crowd));
	});

	it("hands out sixteen distinct points when asked one at a time", () => {
		const taken: { x: number; y: number }[] = [];
		for (let i = 0; i < 16; i++) {
			const point = pickSpawn(taken);
			taken.push({ x: point.x, y: point.y });
		}
		const unique = new Set(taken.map((p) => `${p.x},${p.y}`));
		expect(unique.size).toBe(16);
	});

	/**
	 * Sixteen fighters placed at once must not overlap, or the depenetrator shoves
	 * one of them sideways on tick one — on every client, simultaneously, before
	 * anybody has pressed anything.
	 */
	it("never places two of sixteen fighters inside each other", () => {
		const taken: { x: number; y: number }[] = [];
		for (let i = 0; i < 16; i++) {
			const point = pickSpawn(taken);
			taken.push({ x: point.x, y: point.y });
		}
		for (let i = 0; i < taken.length; i++) {
			for (let j = i + 1; j < taken.length; j++) {
				const a = taken[i] as { x: number; y: number };
				const b = taken[j] as { x: number; y: number };
				const overlaps =
					Math.abs(a.x - b.x) < PLAYER_WIDTH &&
					Math.abs(a.y - b.y) < PLAYER_HEIGHT;
				expect(overlaps).toBe(false);
			}
		}
	});

	it("still answers with nobody in the arena", () => {
		expect(SPAWN_POINTS).toContain(pickSpawn([]));
	});
});
