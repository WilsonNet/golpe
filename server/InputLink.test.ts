import { describe, expect, it } from "vitest";
import { InputLink } from "./InputLink.js";

describe("InputLink.admit", () => {
	it("lets a client's step rate through, with room for a fast clock", () => {
		const link = new InputLink();
		for (let i = 0; i < 70; i++) expect(link.admit(1000 + i * 14)).toBe(true);
		expect(link.throttled).toBe(0);
	});

	it("refuses a flood past the budget and counts what it refused", () => {
		const link = new InputLink();
		let admitted = 0;
		for (let i = 0; i < 500; i++) if (link.admit(5000)) admitted++;
		expect(admitted).toBe(180);
		expect(link.throttled).toBe(320);
	});

	it("opens a fresh budget each second", () => {
		const link = new InputLink();
		for (let i = 0; i < 200; i++) link.admit(5000);
		expect(link.admit(6000)).toBe(true);
	});
});

describe("InputLink.report", () => {
	it("averages the queue depth it was sampled at", () => {
		const link = new InputLink();
		for (const d of [0, 1, 2, 1]) link.sampleDepth(d);
		expect(link.report()).toMatchObject({ avgDepth: 1, maxDepth: 2 });
	});
});
