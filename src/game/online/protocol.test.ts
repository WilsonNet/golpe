import { describe, expect, it } from "vitest";
import { buildMatches, PROTOCOL_VERSION } from "./protocol";

describe("buildMatches", () => {
	it("accepts exactly the same build and protocol", () => {
		expect(
			buildMatches("abc123", PROTOCOL_VERSION, "abc123", PROTOCOL_VERSION),
		).toBe(true);
	});

	it("refuses another build, another protocol, or a missing identity", () => {
		expect(
			buildMatches("other", PROTOCOL_VERSION, "abc123", PROTOCOL_VERSION),
		).toBe(false);
		expect(
			buildMatches("abc123", PROTOCOL_VERSION + 1, "abc123", PROTOCOL_VERSION),
		).toBe(false);
		expect(
			buildMatches(undefined, PROTOCOL_VERSION, "abc123", PROTOCOL_VERSION),
		).toBe(false);
		expect(buildMatches("abc123", undefined, "abc123", PROTOCOL_VERSION)).toBe(
			false,
		);
	});
});
