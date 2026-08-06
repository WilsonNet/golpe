/**
 * The launch URL must be lossless in both directions: whatever the menu
 * serialises must parse back to the same request, and whatever a hand-written
 * link asks for must be read exactly as `Match` used to read it. A parse that
 * silently drops a field would ship a menu that commits a match the player did
 * not configure.
 */

import { describe, expect, it } from "vitest";
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
	it("keeps every field stable", () => {
		const request: LaunchParams = {
			room: "r-1",
			ai: true,
			online: false,
			offline: false,
			training: false,
			hero: "anands",
			botHero: "anands",
			bots: 0,
			fill: undefined,
			scoreLimit: 21,
			timeLimitSec: 300,
			ultCharge: 100,
			mode: "ffa",
			freezeTime: undefined,
			screens: 2,
		};
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
