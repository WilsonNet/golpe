import { describe, expect, it } from "vitest";
import {
	type BrowserRoom,
	canJoinBrowserBuild,
	hostPageForBrowserRoom,
	lanRoomToBrowserRoom,
	mergeBrowserRooms,
	sortBrowserRooms,
} from "./browser";

function room(patch: Partial<BrowserRoom> = {}): BrowserRoom {
	return {
		id: "room-1",
		mode: "ffa",
		playerCount: 2,
		humanCount: 2,
		screens: 1,
		region: "local",
		pingMs: 20,
		server: null,
		source: "internet",
		build: "dev",
		protocol: 1,
		...patch,
	};
}

describe("sortBrowserRooms", () => {
	it("pins LAN above a lower-latency internet room, in both directions", () => {
		const lan = room({
			id: "lan",
			source: "lan",
			server: "192.168.1.2:9208",
			pingMs: 90,
		});
		const internet = room({ id: "net", source: "internet", pingMs: 5 });
		for (const dir of ["asc", "desc"] as const) {
			const sorted = sortBrowserRooms([internet, lan], "ping", dir);
			expect(sorted.map((r) => r.id)).toEqual(["lan", "net"]);
		}
	});

	it("sorts inside each group by the chosen key", () => {
		const a = room({ id: "lan-a", source: "lan", playerCount: 4, pingMs: 2 });
		const b = room({ id: "lan-b", source: "lan", playerCount: 1, pingMs: 9 });
		const c = room({
			id: "net",
			source: "internet",
			playerCount: 7,
			pingMs: 1,
		});
		expect(
			sortBrowserRooms([a, b, c], "players", "asc").map((r) => r.id),
		).toEqual(["lan-b", "lan-a", "net"]);
		expect(
			sortBrowserRooms([a, b, c], "ping", "desc").map((r) => r.id),
		).toEqual(["lan-b", "lan-a", "net"]);
	});
});

describe("mergeBrowserRooms", () => {
	it("keeps one row per room and lets LAN win the duplicate", () => {
		const local = { host: "192.168.1.2", port: 9208 };
		const internet = room({
			id: "same",
			server: "192.168.1.2:9208",
			source: "internet",
		});
		const lan = room({
			id: "same",
			server: "192.168.1.2:9208",
			source: "lan",
			hostName: "Host",
		});
		const merged = mergeBrowserRooms([internet], [lan], local);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.source).toBe("lan");
		expect(merged[0]?.hostName).toBe("Host");
	});
});

describe("the LAN build gate", () => {
	it("refuses a LAN row from another build and offers the host page", () => {
		const lan = room({
			source: "lan",
			server: "192.168.1.2:9208",
			build: "other",
			protocol: 1,
		});
		expect(canJoinBrowserBuild(lan, "dev", 1)).toBe(false);
		expect(hostPageForBrowserRoom(lan)).toBe(
			"http://192.168.1.2:9208/?room=room-1",
		);
	});

	it("refuses a protocol mismatch even when the build string is missing", () => {
		const lan = room({
			source: "lan",
			server: "192.168.1.2:9208",
			build: null,
			protocol: 2,
		});
		expect(canJoinBrowserBuild(lan, "dev", 1)).toBe(false);
	});

	it("refuses a LAN row with no build identity at all", () => {
		const lan = room({
			source: "lan",
			server: "192.168.1.2:9208",
			build: null,
			protocol: 1,
		});
		expect(canJoinBrowserBuild(lan, "dev", 1)).toBe(false);
	});

	it("does not gate an internet row", () => {
		const net = room({ source: "internet", build: "other", protocol: 99 });
		expect(canJoinBrowserBuild(net, "dev", 1)).toBe(true);
		expect(hostPageForBrowserRoom(net)).toBeNull();
	});
});

describe("lanRoomToBrowserRoom", () => {
	it("validates the endpoint and keeps the private host", () => {
		const converted = lanRoomToBrowserRoom({
			id: "room-1",
			mode: "tdm",
			playerCount: 3,
			humanCount: 2,
			screens: 3,
			server: "192.168.1.2:9208",
			build: "dev",
			protocol: 1,
			pingMs: 4,
			hostName: "Host",
		});
		expect(converted).toMatchObject({
			id: "room-1",
			mode: "tdm",
			server: "192.168.1.2:9208",
			source: "lan",
			region: "lan",
			hostName: "Host",
		});
	});

	it("drops a public endpoint and a malformed id", () => {
		expect(
			lanRoomToBrowserRoom({
				id: "room-1",
				mode: "ffa",
				playerCount: 1,
				humanCount: 1,
				screens: 1,
				server: "8.8.8.8:9208",
			}),
		).toBeNull();
		expect(
			lanRoomToBrowserRoom({
				id: "",
				mode: "ffa",
				playerCount: 1,
				humanCount: 1,
				screens: 1,
				server: "192.168.1.2:9208",
			}),
		).toBeNull();
	});
});
