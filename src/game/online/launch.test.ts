/**
 * The launch URL must be lossless in both directions: whatever the menu
 * serialises must parse back to the same request, and whatever a hand-written
 * link asks for must be read exactly as `Match` used to read it. A parse that
 * silently drops a field would ship a menu that commits a match the player did
 * not configure.
 *
 * The parser's edge cases stay as examples — `?ai=false`, `?bots=garbage` and
 * the `team`/`training-room` spellings are deliberate behaviours worth pinning.
 * The *round trip* is a property: any well-formed request serialises and parses
 * back to itself, swept over generated params by fast-check.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { HERO_IDS } from "../simulation/Heroes";
import {
	isMenuShape,
	type LaunchParams,
	parseLaunchParams,
	serializeLaunchParams,
} from "./launch";

/** The empty request: nothing asked for. */
const NOTHING: LaunchParams = {
	room: null,
	ai: false,
	online: false,
	offline: false,
	hero: null,
	botHero: null,
	training: false,
	bots: undefined,
	fill: undefined,
	scoreLimit: undefined,
	timeLimitSec: undefined,
	ultCharge: undefined,
	mode: null,
	freezeTime: undefined,
	screens: undefined,
};

/** A room id — the kind of string the menu and shared links actually produce. */
const roomArb = fc.oneof(
	fc.constant(null),
	fc.string({ minLength: 1, maxLength: 64 }),
);

/** A hero id, or null when not asked for. */
const heroArb = fc.oneof(fc.constant(null), fc.constantFrom(...HERO_IDS));

/** `?mode=` — `null` (deathmatch by default) or an explicit name. */
const modeArb = fc.oneof(
	fc.constant(null),
	fc.constantFrom("ffa" as const, "tdm" as const),
);

/**
 * A well-formed `LaunchParams`: every field at a value the serialiser can write
 * and the parser can read back exactly. The counts that allow zero (`bots`,
 * `ultCharge`, `freezeTime`) come from non-negative integers; the positive
 * counts (`fill`, `scoreLimit`, `timeLimit`, `screen`) from positive ones.
 */
/**
 * An optional numeric field — `undefined` when not asked, which is what the
 * serialiser's `!== undefined` guard keys on. (`fc.option` yields `null`, so
 * it is mapped to `undefined` to match the type.)
 */
const optNum = (a: fc.Arbitrary<number>) =>
	fc.option(a).map((v) => v ?? undefined);

const validParams: fc.Arbitrary<LaunchParams> = fc.record({
	room: roomArb,
	ai: fc.boolean(),
	online: fc.boolean(),
	offline: fc.boolean(),
	training: fc.boolean(),
	hero: heroArb,
	botHero: heroArb,
	bots: optNum(fc.nat({ max: 16 })),
	fill: optNum(fc.integer({ min: 1, max: 16 })),
	scoreLimit: optNum(fc.integer({ min: 1, max: 999 })),
	timeLimitSec: optNum(fc.integer({ min: 1, max: 3600 })),
	ultCharge: optNum(fc.nat({ max: 100 })),
	mode: modeArb,
	freezeTime: optNum(fc.nat({ max: 60 })),
	screens: optNum(fc.integer({ min: 1, max: 8 })),
});

describe("parseLaunchParams", () => {
	it("reads nothing from an empty search", () => {
		expect(parseLaunchParams("")).toEqual(NOTHING);
	});

	it("reads every field from a full link", () => {
		const parsed = parseLaunchParams(
			"?room=abc-123&ai=true&online=true&offline=true&training=true&hero=anands&botHero=lia&bots=3&fill=8&scoreLimit=9&timeLimit=120&ultCharge=50&mode=tdm&freezeTime=2&screen=4",
		);
		expect(parsed).toEqual({
			room: "abc-123",
			ai: true,
			online: true,
			offline: true,
			training: true,
			hero: "anands",
			botHero: "lia",
			bots: 3,
			fill: 8,
			scoreLimit: 9,
			timeLimitSec: 120,
			ultCharge: 50,
			mode: "tdm",
			freezeTime: 2,
			screens: 4,
		});
	});

	it("accepts both spellings of the training room", () => {
		expect(parseLaunchParams("?training-room=true").training).toBe(true);
	});

	it("accepts `team` as the team mode, like Match always did", () => {
		expect(parseLaunchParams("?mode=team").mode).toBe("tdm");
	});

	it("treats a false flag as absent", () => {
		expect(parseLaunchParams("?ai=false").ai).toBe(false);
		expect(parseLaunchParams("?training=false").training).toBe(false);
	});

	it("keeps zero as a legitimate answer for the counts that allow it", () => {
		// `bots=0` is an empty room and `freezeTime=0` is "start fighting" — the
		// two values the positive-integer parser must not eat.
		expect(parseLaunchParams("?bots=0").bots).toBe(0);
		expect(parseLaunchParams("?ultCharge=0").ultCharge).toBe(0);
		expect(parseLaunchParams("?freezeTime=0").freezeTime).toBe(0);
		expect(parseLaunchParams("?bots=garbage").bots).toBeUndefined();
	});

	it("drops nonsense from the positive-integer fields", () => {
		expect(parseLaunchParams("?scoreLimit=abc").scoreLimit).toBeUndefined();
		expect(parseLaunchParams("?timeLimit=-5").timeLimitSec).toBeUndefined();
		expect(parseLaunchParams("?fill=0").fill).toBeUndefined();
		expect(parseLaunchParams("?screen=0").screens).toBeUndefined();
	});
});

describe("isMenuShape", () => {
	it("shows the menu for the bare URL", () => {
		expect(isMenuShape("")).toBe(true);
	});

	it("shows the menu for the vestigial online flag alone", () => {
		expect(isMenuShape("?online=true")).toBe(true);
		expect(isMenuShape("?online=false")).toBe(true);
	});

	it("shows the menu for irrelevant parameters", () => {
		expect(isMenuShape("?utm_source=link")).toBe(true);
	});

	it("boots when any launch key is present, whatever its value", () => {
		for (const key of [
			"room",
			"ai",
			"offline",
			"training",
			"training-room",
			"bots",
			"fill",
			"scoreLimit",
			"timeLimit",
			"ultCharge",
			"mode",
			"freezeTime",
			"screen",
		]) {
			expect(isMenuShape(`?${key}=x`), key).toBe(false);
		}
		expect(isMenuShape("?ai=false")).toBe(false);
		expect(isMenuShape("?bots=0")).toBe(false);
	});
});

describe("serialize → parse round trip", () => {
	test.prop([validParams])("keeps every field stable", (request) => {
		// A menu that serialises a request and a boot that parses it must agree
		// on every field — a lossy trip here ships a match the player did not
		// configure. fast-check sweeps the whole field space and shrinks a
		// failure to the smallest request that loses data.
		expect(parseLaunchParams(serializeLaunchParams(request))).toEqual(request);
	});

	it("writes only what was asked for", () => {
		expect(serializeLaunchParams(NOTHING)).toBe("");
		expect(
			serializeLaunchParams({
				...NOTHING,
				bots: 1,
				mode: "tdm",
				freezeTime: 4,
				screens: 3,
			}),
		).toBe("bots=1&mode=tdm&freezeTime=4&screen=3");
	});

	it("does not round-trip an explicit ffa into a boot-shaped link", () => {
		const request = { ...NOTHING, mode: "ffa" as const };
		const serialised = serializeLaunchParams(request);
		expect(serialised).toBe("mode=ffa");
		expect(isMenuShape(serialised)).toBe(false);
		expect(parseLaunchParams(serialised).mode).toBe("ffa");
	});
});
