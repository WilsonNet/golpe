import { describe, expect, it, vi } from "vitest";
import { NetSim, parseNetSim } from "./NetSim";

describe("parseNetSim", () => {
	it("reads one-way latency, jitter and loss percent", () => {
		expect(parseNetSim("40/10/2")).toEqual({
			latencyMs: 40,
			jitterMs: 10,
			loss: 0.02,
		});
	});

	it("treats missing parts as zero and clamps loss to 100%", () => {
		expect(parseNetSim("80")).toEqual({ latencyMs: 80, jitterMs: 0, loss: 0 });
		expect(parseNetSim("0/0/250")?.loss).toBe(1);
	});

	it("shapes nothing on a malformed or absent value", () => {
		expect(parseNetSim(null)).toBeNull();
		expect(parseNetSim("fast")).toBeNull();
		expect(parseNetSim("-5/1/1")).toBeNull();
	});
});

describe("NetSim.deliver", () => {
	it("drops only lossy messages, and delays the rest", () => {
		vi.useFakeTimers();
		const sim = new NetSim({ latencyMs: 50, jitterMs: 0, loss: 1 }, () => 0);
		const got: string[] = [];
		sim.deliver(() => got.push("lossy"), true);
		sim.deliver(() => got.push("reliable"), false);
		vi.advanceTimersByTime(49);
		expect(got).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(got).toEqual(["reliable"]);
		expect(sim.dropped).toBe(1);
		vi.useRealTimers();
	});
});
