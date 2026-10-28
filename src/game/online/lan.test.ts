import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { isPrivateEndpoint, isPrivateHost } from "./lan";

describe("isPrivateHost", () => {
	it("accepts the local-network literals", () => {
		for (const host of [
			"localhost",
			"golpe.local",
			"10.0.0.1",
			"10.255.255.255",
			"172.16.0.1",
			"172.31.255.254",
			"192.168.1.23",
			"127.0.0.1",
			"169.254.1.1",
			"100.64.0.1",
			"::1",
			"fe80::1",
			"fd00::1",
			"::ffff:192.168.1.2",
		]) {
			expect(isPrivateHost(host), host).toBe(true);
		}
	});

	it("rejects the public internet", () => {
		for (const host of [
			"golpe.quest",
			"8.8.8.8",
			"172.15.0.1",
			"172.32.0.1",
			"192.169.0.1",
			"169.253.0.1",
			"100.63.0.1",
			"100.128.0.1",
			"2001:4860:4860::8888",
			"example.com",
			"",
		]) {
			expect(isPrivateHost(host), host).toBe(false);
		}
	});

	test.prop([fc.ipV4()])(
		"never badges an address outside the private blocks",
		(address) => {
			const octets = address.split(".").map(Number);
			const [a = -1, b = -1] = octets;
			const privateBlock =
				a === 10 ||
				a === 127 ||
				(a === 172 && b >= 16 && b <= 31) ||
				(a === 192 && b === 168) ||
				(a === 169 && b === 254) ||
				(a === 100 && b >= 64 && b <= 127);
			expect(isPrivateHost(address)).toBe(privateBlock);
		},
	);
});

describe("isPrivateEndpoint", () => {
	it("requires both a private host and a real port", () => {
		expect(isPrivateEndpoint({ host: "192.168.1.2", port: 9208 })).toBe(true);
		expect(isPrivateEndpoint({ host: "8.8.8.8", port: 9208 })).toBe(false);
		expect(isPrivateEndpoint({ host: "192.168.1.2", port: 0 })).toBe(false);
		expect(isPrivateEndpoint({ host: "192.168.1.2", port: 70000 })).toBe(false);
	});
});
