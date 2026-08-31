/**
 * A room's password is the one secret the server holds for its players, so the
 * rules around it are properties, not examples: whatever a player types must
 * come back through `cleanPassword` short enough to store and comparable
 * without surprises, and whatever hash a room stores must open for its own
 * password and for nothing else.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	cleanPassword,
	hashPassword,
	MAX_PASSWORD_LENGTH,
	verifyPassword,
} from "./RoomPassword.js";

/** A typed-in password: printable text with whitespace around and inside. */
const rawPassword = fc.string({ minLength: 1, maxLength: 200 });

describe("cleanPassword", () => {
	it("rejects everything that is not a string", () => {
		expect(cleanPassword(undefined)).toBeNull();
		expect(cleanPassword(null)).toBeNull();
		expect(cleanPassword(1234)).toBeNull();
		expect(cleanPassword({})).toBeNull();
	});

	it("treats whitespace-only and empty as no password", () => {
		expect(cleanPassword("")).toBeNull();
		expect(cleanPassword("   \t ")).toBeNull();
	});

	it("trims the edges and caps the length", () => {
		expect(cleanPassword("  hunter2  ")).toBe("hunter2");
		const long = "a".repeat(MAX_PASSWORD_LENGTH + 40);
		expect(cleanPassword(long)).toBe("a".repeat(MAX_PASSWORD_LENGTH));
	});

	test.prop([rawPassword])(
		"never returns anything overlong or blank",
		(raw) => {
			const cleaned = cleanPassword(raw);
			if (cleaned === null) return;
			expect(cleaned.length).toBeGreaterThan(0);
			expect(cleaned.length).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH);
			expect(cleaned).toBe(cleaned.trim());
		},
	);
});

describe("hashPassword / verifyPassword", () => {
	it("opens for the password the room was given", () => {
		expect(verifyPassword("hunter2", hashPassword("hunter2"))).toBe(true);
	});

	it("stays shut for a wrong or missing password", () => {
		const stored = hashPassword("hunter2");
		expect(verifyPassword("hunter3", stored)).toBe(false);
		expect(verifyPassword("", stored)).toBe(false);
		expect(verifyPassword(undefined, stored)).toBe(false);
		expect(verifyPassword(null, stored)).toBe(false);
	});

	it("opens a room that has no password for anybody", () => {
		expect(verifyPassword(undefined, null)).toBe(true);
		expect(verifyPassword("anything", null)).toBe(true);
	});

	it("refuses to read a malformed stored value", () => {
		expect(verifyPassword("hunter2", "nonsense")).toBe(false);
		expect(verifyPassword("hunter2", "abc:")).toBe(false);
		expect(verifyPassword("hunter2", "zz:not-hex")).toBe(false);
	});

	it("salts every room separately", () => {
		// Two rooms with the same password must not store the same value — a
		// shared hash would let one room's leak open the other.
		expect(hashPassword("hunter2")).not.toBe(hashPassword("hunter2"));
	});

	// Scrypt is deliberately expensive — that is the point of it — so the
	// property sweeps stay short enough to finish inside a test timeout.
	test.prop([rawPassword], { numRuns: 20 })(
		"a cleaned password always opens its own hash",
		(raw) => {
			const cleaned = cleanPassword(raw);
			fc.pre(cleaned !== null);
			expect(verifyPassword(cleaned, hashPassword(cleaned!))).toBe(true);
			// …and the raw text it came from still works, whitespace and all.
			expect(verifyPassword(raw, hashPassword(cleaned!))).toBe(true);
		},
	);

	test.prop([rawPassword, rawPassword], { numRuns: 20 })(
		"a different password does not open the hash",
		(a, b) => {
			const cleanedA = cleanPassword(a);
			const cleanedB = cleanPassword(b);
			fc.pre(cleanedA !== null && cleanedB !== null);
			fc.pre(cleanedA !== cleanedB);
			expect(verifyPassword(cleanedB, hashPassword(cleanedA!))).toBe(false);
		},
	);
});
