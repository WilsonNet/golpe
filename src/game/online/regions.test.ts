/**
 * Regions stay addressable: whatever the operator configures must resolve to
 * the server a player actually dials, and whatever a URL names must either be
 * that server or nothing at all — a half-parsed endpoint would send game
 * traffic somewhere nobody runs a server.
 */

import { describe, expect, it } from "vitest";
import {
	buildEndpointList,
	DEFAULT_REGION,
	httpBaseFor,
	parseRegion,
	parseServerEndpoint,
	parseServerList,
	resolveGameEndpoint,
	signallingUrlFor,
} from "./regions";
import { GAME_SERVER_PORT } from "./types";

describe("parseRegion", () => {
	it("accepts the launch regions", () => {
		expect(parseRegion("sa")).toBe("sa");
		expect(parseRegion("us-east")).toBe("us-east");
		expect(parseRegion("eu")).toBe("eu");
	});

	it("rejects everything that is not an id", () => {
		expect(parseRegion(null)).toBeNull();
		expect(parseRegion("")).toBeNull();
		expect(parseRegion("  ")).toBeNull();
		expect(parseRegion("sa/eu")).toBeNull();
		expect(parseRegion("a".repeat(33))).toBeNull();
	});
});

describe("parseServerEndpoint", () => {
	it("reads a bare host onto the game port", () => {
		expect(parseServerEndpoint("sa.golpe.gg")).toEqual({
			region: DEFAULT_REGION,
			host: "sa.golpe.gg",
			port: GAME_SERVER_PORT,
		});
	});

	it("reads an explicit port", () => {
		expect(parseServerEndpoint("localhost:9209")).toEqual({
			region: DEFAULT_REGION,
			host: "localhost",
			port: 9209,
		});
	});

	it("rejects schemes, paths and nonsense ports", () => {
		expect(parseServerEndpoint("http://sa.golpe.gg:9208")).toBeNull();
		expect(parseServerEndpoint("sa.golpe.gg/rooms")).toBeNull();
		expect(parseServerEndpoint("sa.golpe.gg:abc")).toBeNull();
		expect(parseServerEndpoint("sa.golpe.gg:0")).toBeNull();
		expect(parseServerEndpoint("sa.golpe.gg:99999")).toBeNull();
		expect(parseServerEndpoint("")).toBeNull();
		expect(parseServerEndpoint(null)).toBeNull();
	});
});

describe("parseServerList", () => {
	it("reads the operator's fleet format", () => {
		expect(parseServerList("sa=sa.golpe.gg:9208,eu=eu.golpe.gg:9208")).toEqual([
			{ region: "sa", host: "sa.golpe.gg", port: 9208 },
			{ region: "eu", host: "eu.golpe.gg", port: 9208 },
		]);
	});

	it("labels a bare host:port with its own host", () => {
		expect(parseServerList("localhost:9209")).toEqual([
			{ region: "localhost", host: "localhost", port: 9209 },
		]);
	});

	it("drops the entries that do not parse", () => {
		expect(parseServerList("sa=sa.golpe.gg:9208,,bogus=ht!tp")).toEqual([
			{ region: "sa", host: "sa.golpe.gg", port: 9208 },
		]);
		expect(parseServerList(null)).toEqual([]);
	});
});

describe("resolveGameEndpoint", () => {
	it("dials the page's own host when nothing is asked for", () => {
		expect(resolveGameEndpoint("", "myhost")).toEqual({
			region: DEFAULT_REGION,
			host: "myhost",
			port: GAME_SERVER_PORT,
		});
	});

	it("lets ?server= name the exact server", () => {
		const endpoint = resolveGameEndpoint(
			"?server=sa.golpe.gg%3A9208&room=abc",
			"myhost",
		);
		expect(endpoint).toEqual({
			region: DEFAULT_REGION,
			host: "sa.golpe.gg",
			port: 9208,
		});
	});

	it("ignores a ?server= that names nothing usable", () => {
		expect(resolveGameEndpoint("?server=http://x", "myhost").host).toBe(
			"myhost",
		);
	});

	it("lets ?region= filter without moving the match", () => {
		// Region is the browser's hint, never an address: a region alone must
		// not redirect game traffic anywhere.
		expect(resolveGameEndpoint("?region=eu", "myhost").host).toBe("myhost");
	});
});

describe("httpBaseFor", () => {
	it("keeps the page's scheme", () => {
		expect(httpBaseFor({ host: "sa.golpe.gg", port: 9208 }, "https:")).toBe(
			"https://sa.golpe.gg:9208",
		);
		expect(httpBaseFor({ host: "h", port: 9209 }, "http:")).toBe(
			"http://h:9209",
		);
	});

	it("leaves the port out of the signalling URL", () => {
		// The WebRTC client takes the port separately — folding it into both
		// would dial it twice.
		expect(signallingUrlFor({ host: "sa.golpe.gg" }, "https:")).toBe(
			"https://sa.golpe.gg",
		);
	});
});

describe("buildEndpointList", () => {
	it("lists the local server alone when nothing is configured", () => {
		const local = { region: "local", host: "h", port: GAME_SERVER_PORT };
		expect(buildEndpointList(local, [])).toEqual([local]);
	});

	it("dedupes a configured entry that is the local server", () => {
		const local = { region: "local", host: "h", port: GAME_SERVER_PORT };
		const same = { region: "sa", host: "h", port: GAME_SERVER_PORT };
		const other = { region: "sa", host: "sa.golpe.gg", port: 9208 };
		expect(buildEndpointList(local, [same, other])).toEqual([local, other]);
	});
});
