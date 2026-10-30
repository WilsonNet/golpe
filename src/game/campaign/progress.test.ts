import { beforeEach, describe, expect, it } from "vitest";
import {
	completedLessons,
	markLessonComplete,
	progressOf,
	resumeIndex,
} from "./progress";

/** A localStorage small enough to live in a test, with the same contract. */
function installStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	(globalThis as unknown as { window: unknown }).window = {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
		},
	};
	return store;
}

describe("campaign progress", () => {
	beforeEach(() => {
		installStorage();
	});

	it("marks a lesson once and remembers it", () => {
		markLessonComplete("lia-slash");
		markLessonComplete("lia-slash");
		expect([...completedLessons()]).toEqual(["lia-slash"]);
		expect(progressOf(["lia-slash", "lia-chain"])).toEqual({
			done: 1,
			total: 2,
		});
	});

	it("resumes at the first unfinished id, not at lesson one", () => {
		markLessonComplete("a");
		markLessonComplete("b");
		expect(resumeIndex(["a", "b", "c", "d"])).toBe(2);
	});

	it("replays from the top once everything is finished", () => {
		markLessonComplete("a");
		markLessonComplete("b");
		expect(resumeIndex(["a", "b"])).toBe(0);
	});

	it("survives malformed storage", () => {
		installStorage({ "golpe.campaign": "not json" });
		expect([...completedLessons()]).toEqual([]);
		installStorage({ "golpe.campaign": JSON.stringify({ completed: [1, 2] }) });
		expect([...completedLessons()]).toEqual([]);
	});
});
