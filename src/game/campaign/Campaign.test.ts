/**
 * The campaign layer, tested without a browser.
 *
 * This is the payoff for keeping objectives pure: every lesson in every hero's
 * course can be checked for the things that actually break a tutorial — an
 * objective nothing can ever satisfy, a lesson id that collides with another
 * one and silently marks the wrong thing complete, a stage that forgets to make
 * the player invincible — with no server, no Pixi and no Playwright.
 *
 * The tracker gets example tests rather than properties: every counter is a
 * *transition*, and the thing worth pinning is which transitions count and
 * which deliberately do not (walking off a ledge is not a jump; a
 * reconciliation snap is not a walk).
 */

import { describe, expect, it } from "vitest";
import { HERO_IDS } from "../simulation/Heroes";
import { createPlayerState, type PlayerPosition } from "../simulation/Physics";
import { MODULES, tutorialFor } from "./content/index";
import { LessonTracker, zeroCounters } from "./signals";
import { lessonsOf } from "./types";

const ALL_LESSONS = MODULES.flatMap((m) => lessonsOf(m));

describe("the campaign registry", () => {
	it("gives every hero a course", () => {
		for (const hero of HERO_IDS) {
			const module = tutorialFor(hero);
			expect(module.chapters.length).toBeGreaterThan(0);
			expect(lessonsOf(module).length).toBeGreaterThan(0);
		}
	});

	it("keeps every lesson id unique across every module", () => {
		// Progress is stored by lesson id, so a collision would silently mark two
		// different lessons complete at once — and the two would be in different
		// heroes' courses, where nobody would look. Every id is hero-prefixed for
		// exactly this reason, including the shared chapters: the basics read the
		// same, but they are Lia's basics and Anands' basics, and a player who
		// picks a new hero is entitled to be walked through the feet again.
		const ids = ALL_LESSONS.map((l) => l.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("keeps every objective id unique within its lesson", () => {
		for (const lesson of ALL_LESSONS) {
			const ids = lesson.objectives.map((o) => o.id);
			expect(new Set(ids).size, `duplicate objective in ${lesson.id}`).toBe(
				ids.length,
			);
		}
	});

	it("gives every lesson at least one objective, with a reachable target", () => {
		for (const lesson of ALL_LESSONS) {
			expect(lesson.objectives.length, lesson.id).toBeGreaterThan(0);
			for (const objective of lesson.objectives) {
				expect(
					objective.target,
					`${lesson.id}/${objective.id}`,
				).toBeGreaterThan(0);
				expect(objective.text.length).toBeGreaterThan(0);
			}
		}
	});

	it("starts every lesson unfinished", () => {
		// The zero counters are what a lesson opens with. An objective that reads
		// complete against them would clear itself the frame it armed — which is
		// exactly what a badly written "survive N seconds" or an inverted
		// predicate looks like from the outside.
		const zero = zeroCounters();
		for (const lesson of ALL_LESSONS) {
			for (const objective of lesson.objectives) {
				expect(
					objective.count(zero),
					`${lesson.id}/${objective.id} is already done`,
				).toBeLessThan(objective.target);
			}
		}
	});

	it("never leaves the player mortal in a drill", () => {
		// The one stage rule the course depends on: a player who dies mid-lesson
		// is a player whose objectives were reset by a respawn they did not ask
		// for. Only the graduation fight lets the *dummy* die.
		for (const lesson of ALL_LESSONS) {
			expect(lesson.stage.playerInvincible, lesson.id).toBe(true);
			expect(lesson.stage.disableRoundReset, lesson.id).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------

/** A body on the floor, standing still — the state every drill opens in. */
function grounded(): PlayerPosition {
	const body = createPlayerState(360, 480);
	body.grounded = true;
	return body;
}

describe("LessonTracker", () => {
	it("counts a jump only when the fighter leaves the ground upward", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);

		// Walking off a ledge: airborne, but falling.
		body.grounded = false;
		body.vy = 40;
		tracker.observe(body, 16);
		expect(tracker.snapshot().jumps).toBe(0);

		body.grounded = true;
		body.vy = 0;
		tracker.observe(body, 16);
		body.grounded = false;
		body.vy = -400;
		tracker.observe(body, 16);
		expect(tracker.snapshot().jumps).toBe(1);
	});

	it("counts the air jump off the jump budget, not the button", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);
		body.grounded = false;
		body.vy = -400;
		tracker.observe(body, 16);

		const before = body.airJumps;
		body.airJumps = before - 1;
		tracker.observe(body, 16);
		expect(tracker.snapshot().airJumps).toBe(1);
	});

	it("separates a ground dash from an air dash", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);

		body.dashActiveTimer = 120;
		tracker.observe(body, 16);
		body.dashActiveTimer = 0;
		tracker.observe(body, 16);

		body.grounded = false;
		body.dashActiveTimer = 120;
		tracker.observe(body, 16);

		const counters = tracker.snapshot();
		expect(counters.dashes).toBe(2);
		expect(counters.airDashes).toBe(1);
	});

	it("counts ground covered on foot but not a netcode correction", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);

		for (let i = 0; i < 10; i++) {
			body.x += 4;
			tracker.observe(body, 16);
		}
		expect(tracker.snapshot().walkedPx).toBeCloseTo(40);

		// A respawn snap: forty pixels in one frame. Not a walk.
		body.x += 40;
		tracker.observe(body, 16);
		expect(tracker.snapshot().walkedPx).toBeCloseTo(40);
	});

	it("counts a melee move when it starts, once", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);

		body.meleeAction = "slash";
		tracker.observe(body, 16);
		tracker.observe(body, 16);
		tracker.observe(body, 16);
		expect(tracker.snapshot().movesStarted.slash).toBe(1);

		body.meleeAction = "none";
		tracker.observe(body, 16);
		body.meleeAction = "slash";
		tracker.observe(body, 16);
		expect(tracker.snapshot().movesStarted.slash).toBe(2);
	});

	it("counts a butterfly only when the swing ends early into a guard", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);

		// A slash that runs its full length and ends on its own is not a cancel.
		body.meleeAction = "slash";
		tracker.observe(body, 16);
		for (let i = 0; i < 40; i++) tracker.observe(body, 16);
		body.meleeAction = "none";
		body.blocking = true;
		tracker.observe(body, 16);
		expect(tracker.snapshot().butterflies).toBe(0);

		// One that ends two frames in, with the guard already up, is.
		body.blocking = false;
		body.meleeAction = "slash";
		tracker.observe(body, 16);
		tracker.observe(body, 16);
		body.meleeAction = "none";
		body.blocking = true;
		tracker.observe(body, 16);
		expect(tracker.snapshot().butterflies).toBe(1);
	});

	it("reads a spent item charge as a fall, never a refill", () => {
		const tracker = new LessonTracker();
		tracker.noteItemCharges(2);
		tracker.noteItemCharges(1);
		expect(tracker.snapshot().itemsUsed).toBe(1);
		// The reset that opens the next lesson refills them. That is not two throws.
		tracker.noteItemCharges(2);
		expect(tracker.snapshot().itemsUsed).toBe(1);
	});

	it("reads the server's tallies as a delta on the lesson's opening numbers", () => {
		const tracker = new LessonTracker();
		const stats = {
			bulletsFired: 10,
			bulletHits: 4,
			damageDealt: 50,
			damageTaken: 12,
			damageBlocked: 8,
			hp: 100,
		};
		tracker.noteStats(stats);
		expect(tracker.snapshot().damageDealt).toBe(0);
		tracker.noteStats({ ...stats, damageDealt: 71, bulletHits: 6 });
		expect(tracker.snapshot().damageDealt).toBe(21);
		expect(tracker.snapshot().bulletHits).toBe(2);
	});

	it("counts a knockout once per fall", () => {
		const tracker = new LessonTracker();
		tracker.noteDummyHp(40);
		tracker.noteDummyHp(0);
		tracker.noteDummyHp(0);
		expect(tracker.snapshot().knockouts).toBe(1);
		tracker.noteDummyHp(100);
		tracker.noteDummyHp(0);
		expect(tracker.snapshot().knockouts).toBe(2);
	});

	it("forgets everything on reset", () => {
		const tracker = new LessonTracker();
		const body = grounded();
		tracker.observe(body, 16);
		body.meleeAction = "slash";
		tracker.observe(body, 16);
		expect(tracker.snapshot().movesStarted.slash).toBe(1);

		tracker.reset();
		expect(tracker.snapshot()).toEqual(zeroCounters());
	});
});
