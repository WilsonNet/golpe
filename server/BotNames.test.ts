/**
 * Names are the only thing on a scoreboard that identifies a fighter to a human.
 *
 * Two rows reading `Wilson 4/2` and `Wilson 0/5` is indistinguishable from a
 * scoring bug, and there is no way for a player to tell which one is theirs, so
 * uniqueness is enforced rather than hoped for — for humans as much as for bots.
 *
 * The interesting rules here are properties, not examples: whatever a player
 * types, the name that lands on a scoreboard is short enough not to break the
 * layout, printable enough to read, and never a duplicate. fast-check sweeps the
 * input space those rules patrol.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	BOT_NAME_PREFIX,
	botName,
	sanitiseName,
	uniqueName,
} from "./BotNames.js";

const MAX = 16;

/** The gamertag part of a bot's full name. */
const stripPrefix = (name: string) => name.slice(BOT_NAME_PREFIX.length);

/** A name the way a scoreboard row ends up holding it: `BOT · SilentWolf`. */
const tagShape = /^BOT · [A-Z][A-Za-z0-9]*$/;

/** Every printable code point below the DELETE control, as a generator. */
const printableChar = fc.constantFrom(
	...Array.from({ length: 0x7f - 0x20 }, (_, i) =>
		String.fromCodePoint(0x20 + i),
	),
);

/** An arbitrary typed-in name: printable text, whitespace, or control chars. */
const rawName = fc.oneof(
	fc.string({ minLength: 0, maxLength: 200 }),
	fc
		.array(fc.oneof(printableChar, fc.constant(" "), fc.constant("\t")), {
			minLength: 0,
			maxLength: 200,
		})
		.map((cs) => cs.join("")),
);

/** An arbitrary non-string, to prove the fallback path. */
const nonString = fc.oneof(
	fc.integer(),
	fc.double(),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined),
	fc.object(),
);

/** A code point is printable when it is at or above space and not DELETE. */
function isPrintable(ch: string): boolean {
	const code = ch.codePointAt(0) ?? 0;
	return code >= 0x20 && code !== 0x7f;
}

/** The cleaned, trimmed form of a string — mirrors `sanitiseName`'s branch. */
function cleanTo(raw: string): string {
	return [...raw].filter(isPrintable).join("").trim();
}

describe("botName", () => {
	test.prop([
		fc.set(fc.string({ minLength: 1, maxLength: MAX }), { maxLength: 15 }),
	])("never repeats a name already in the room, whatever the room", (taken) => {
		const name = botName(taken);
		expect(taken.has(name)).toBe(false);
		expect(name.length).toBeLessThanOrEqual(MAX);
		expect(name).toMatch(tagShape);
	});

	it("fills a full room of sixteen without a collision", () => {
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
	 * allowed to type. The marker eats six characters, so the drawn tag has to
	 * stay inside the ten that are left.
	 */
	it("stays within the cap humans get", () => {
		const taken = new Set<string>();
		for (let i = 0; i < 40; i++) {
			const name = botName(taken);
			expect(name.length).toBeLessThanOrEqual(MAX);
			taken.add(name);
		}
	});

	it("carries the bot marker, so a player can tell who to remove", () => {
		const name = botName(new Set());
		expect(name.startsWith(BOT_NAME_PREFIX)).toBe(true);
	});

	it("reads like a chosen name behind the marker, not a slug", () => {
		const name = botName(new Set());
		expect(stripPrefix(name)).toMatch(/^[A-Z][A-Za-z]*$/);
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

	test.prop([rawName, fc.set(rawName, { maxLength: 30 })])(
		"never pushes a name past the cap, and leaves a free name alone",
		(base, taken) => {
			const out = uniqueName(base, taken);
			expect(out.length).toBeLessThanOrEqual(MAX);
			// A name nobody holds is handed back untouched — the suffix only ever
			// goes on the collision, never on the first one through the door.
			if (!taken.has(base)) expect(out).toBe(base);
		},
	);
});

describe("sanitiseName", () => {
	test.prop([nonString, rawName])(
		"falls back when given anything that is not a string",
		(raw, fallback) => {
			expect(sanitiseName(raw, fallback)).toBe(fallback);
		},
	);

	test.prop([rawName, rawName])(
		"whatever a usable string becomes is within the cap and printable",
		(raw, fallback) => {
			// Only the sanitise branch promises cleanliness. A raw that cleans to
			// nothing falls back to `fallback` verbatim — the caller is trusted to
			// hand a clean fallback, as the original example tests do.
			fc.pre(typeof raw === "string" && cleanTo(raw).length > 0);
			const out = sanitiseName(raw, fallback);
			expect(out.length).toBeLessThanOrEqual(MAX);
			for (const ch of out) expect(isPrintable(ch)).toBe(true);
		},
	);

	test.prop([rawName, rawName])(
		"never returns surrounding whitespace from a usable string",
		(raw, fallback) => {
			fc.pre(typeof raw === "string" && cleanTo(raw).length > 0);
			const out = sanitiseName(raw, fallback);
			expect(out).toBe(out.trim());
			expect(out.length).toBeLessThanOrEqual(MAX);
		},
	);

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
