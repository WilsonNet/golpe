/**
 * Names are the only thing on a scoreboard that identifies a fighter to a human.
 *
 * Two rows reading `Wilson 4/2` and `Wilson 0/5` is indistinguishable from a
 * scoring bug, and there is no way for a player to tell which one is theirs, so
 * uniqueness is enforced rather than hoped for — for humans as much as for bots.
 */

import { describe, expect, it } from "vitest";
import { botName, sanitiseName, uniqueName } from "./BotNames.js";

const MAX = 16;

describe("botName", () => {
	it("never repeats a name already in the room", () => {
		const taken = new Set<string>();
		for (let i = 0; i < 16; i++) {
			const name = botName(taken);
			expect(taken.has(name)).toBe(false);
			taken.add(name);
		}
		expect(taken.size).toBe(16);
	});

	/**
	 * The dictionaries happily produce `ConstitutionalMockingbird`, which wraps
	 * mid-word in a 28px podium heading — and is longer than any name a human is
	 * allowed to type.
	 */
	it("stays within the cap humans get", () => {
		const taken = new Set<string>();
		for (let i = 0; i < 40; i++) {
			const name = botName(taken);
			expect(name.length).toBeLessThanOrEqual(MAX);
			taken.add(name);
		}
	});

	it("reads like a chosen name, not a slug", () => {
		const name = botName(new Set());
		expect(name).toMatch(/^[A-Z][A-Za-z]*$/);
	});
});

describe("uniqueName", () => {
	it("leaves a free name alone", () => {
		expect(uniqueName("Wilson", new Set())).toBe("Wilson");
	});

	/** The player already in the match keeps the name they have been playing under. */
	it("suffixes the second one through the door", () => {
		expect(uniqueName("Wilson", new Set(["Wilson"]))).toBe("Wilson2");
	});

	it("keeps counting past a run of collisions", () => {
		const taken = new Set(["Ana", "Ana2", "Ana3"]);
		expect(uniqueName("Ana", taken)).toBe("Ana4");
	});

	it("keeps the suffix inside the cap rather than pushing the name past it", () => {
		const base = "A".repeat(MAX);
		const out = uniqueName(base, new Set([base]));
		expect(out.length).toBeLessThanOrEqual(MAX);
		expect(out).not.toBe(base);
	});
});

describe("sanitiseName", () => {
	it("falls back when there is nothing usable", () => {
		expect(sanitiseName(undefined, "Player1")).toBe("Player1");
		expect(sanitiseName("", "Player1")).toBe("Player1");
		expect(sanitiseName("   ", "Player1")).toBe("Player1");
		expect(sanitiseName(42, "Player1")).toBe("Player1");
	});

	it("caps the length, so one player cannot destroy the layout", () => {
		expect(sanitiseName("x".repeat(400), "Player1")).toHaveLength(MAX);
	});

	it("strips control characters, which are invisible in a scoreboard row", () => {
		const raw = `Wil${String.fromCharCode(0)}son${String.fromCharCode(0x1f)}`;
		expect(sanitiseName(raw, "Player1")).toBe("Wilson");
	});

	it("keeps ordinary punctuation and non-ASCII letters", () => {
		expect(sanitiseName("Zé_Ninja-99", "Player1")).toBe("Zé_Ninja-99");
	});

	it("trims surrounding whitespace", () => {
		expect(sanitiseName("  Wilson  ", "Player1")).toBe("Wilson");
	});
});
