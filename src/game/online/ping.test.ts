/**
 * The scoreboard's latency number is small enough to look like it needs no
 * test, and wrong enough in the obvious implementations to need one: a
 * negative clock delta, an unclamped NTP jump, an even-length median that
 * forgets to average, or a window that never forgets an old sample.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
	addPingSample,
	medianPing,
	PING_MAX_MS,
	PING_SAMPLE_COUNT,
	rttFrom,
} from "./ping";

describe("rttFrom", () => {
	it("reads a round trip in whole milliseconds", () => {
		expect(rttFrom(1050, 1000)).toBe(50);
		expect(rttFrom(1050.6, 1000)).toBe(51);
	});

	it("refuses a pair that cannot be a round trip", () => {
		expect(rttFrom(999, 1000)).toBeNull();
		expect(rttFrom(Number.NaN, 1000)).toBeNull();
		expect(rttFrom(Number.POSITIVE_INFINITY, 1000)).toBeNull();
	});

	it("clamps a clock jump instead of reporting hours", () => {
		expect(rttFrom(1000 + PING_MAX_MS * 10, 1000)).toBe(PING_MAX_MS);
	});
});

describe("medianPing", () => {
	it("is null until the first sample arrives", () => {
		expect(medianPing([])).toBeNull();
	});

	it("takes the middle of an odd window and averages an even one", () => {
		expect(medianPing([90, 30, 60])).toBe(60);
		expect(medianPing([90, 30, 60, 100])).toBe(75);
	});

	test.prop([
		fc.array(fc.integer({ min: 0, max: PING_MAX_MS }), {
			minLength: 1,
			maxLength: 20,
		}),
	])(
		"stays inside the window and ignores the order it arrived in",
		(samples) => {
			const median = medianPing(samples);
			expect(median).not.toBeNull();
			if (median === null) return;
			const reversed = medianPing([...samples].reverse());
			expect(reversed).toBe(median);
			expect(median).toBeGreaterThanOrEqual(Math.min(...samples));
			expect(median).toBeLessThanOrEqual(Math.max(...samples));
		},
	);
});

describe("addPingSample", () => {
	it("keeps only the newest window", () => {
		const samples: number[] = [];
		for (let i = 1; i <= PING_SAMPLE_COUNT + 2; i++) addPingSample(samples, i);
		expect(samples).toHaveLength(PING_SAMPLE_COUNT);
		expect(samples[0]).toBe(3);
		expect(samples.at(-1)).toBe(PING_SAMPLE_COUNT + 2);
	});
});
