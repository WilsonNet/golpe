/**
 * The move list's data, tested without a browser.
 *
 * The cards promise two things that used to drift: that every number comes from
 * the tuning constants, and that every entry has a live preview. Both are
 * cheap to check here, and both failed silently in the product (a hardcoded
 * machine-gun reserve, a dash speed from a previous build, an orphaned story).
 */

import { describe, expect, it } from "vitest";
import { PULSE_MS, storyFor, storyIds } from "../game/preview/stories";
import { kitFor, HERO_IDS } from "../game/simulation/Heroes";
import { MOVES } from "../game/simulation/Melee";
import { reserveRoundsFor } from "../game/simulation/Physics";
import { RANGED_WEAPONS } from "../tweakables/ranged";
import {
	CATEGORY_ORDER,
	commandGroups,
	MOVE_LISTS,
	type MoveEntry,
} from "./moveData";

const ALL = HERO_IDS.flatMap((hero) =>
	MOVE_LISTS[hero].entries.map((entry) => ({ hero, entry })),
);

function stat(entry: MoveEntry, label: string): string | undefined {
	return entry.stats?.find((s) => s.label === label)?.value;
}

describe("the move list data", () => {
	it("gives every hero a non-empty list with unique ids", () => {
		for (const hero of HERO_IDS) {
			const entries = MOVE_LISTS[hero].entries;
			expect(entries.length, hero).toBeGreaterThan(0);
			const ids = entries.map((e) => e.id);
			expect(new Set(ids).size, `${hero} duplicate entry id`).toBe(ids.length);
		}
	});

	it("groups every list in rail order", () => {
		const order = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
		for (const hero of HERO_IDS) {
			const ranks = MOVE_LISTS[hero].entries.map(
				(e) => order.get(e.category) ?? -1,
			);
			expect(ranks, `${hero} is out of category order`).toEqual(
				[...ranks].sort((a, b) => a - b),
			);
		}
	});

	it("resolves every entry to a story, and leaves no story orphaned", () => {
		const used = new Set<string>();
		for (const { hero, entry } of ALL) {
			const id = entry.preview ?? entry.id;
			expect(storyFor(id), `${hero}/${entry.id} has no preview story`).toBeDefined();
			used.add(id);
		}
		for (const id of storyIds()) {
			expect(used.has(id), `story "${id}" is used by no entry`).toBe(true);
		}
	});

	it("only gives a hero moves its own weapon has", () => {
		for (const hero of HERO_IDS) {
			const weapon = kitFor(hero).melee;
			for (const entry of MOVE_LISTS[hero].entries) {
				if (!entry.move) continue;
				expect(
					weapon.moves.includes(entry.move),
					`${hero}/${entry.id} is not in ${weapon.id}.moves`,
				).toBe(true);
				expect(entry.preview, `${hero}/${entry.id} preview`).toBe(
					entry.move,
				);
			}
		}
	});

	it("keeps preview ids unique within a hero", () => {
		for (const hero of HERO_IDS) {
			const previews = MOVE_LISTS[hero].entries.map(
				(e) => e.preview ?? e.id,
			);
			expect(new Set(previews).size, `${hero} previews`).toBe(
				previews.length,
			);
		}
	});

	it("gives a guard card to every weapon that can block, and none to the dagger", () => {
		for (const hero of HERO_IDS) {
			const entries = MOVE_LISTS[hero].entries;
			const hasGuard = entries.some((e) => e.id === "guard");
			expect(hasGuard, `${hero} guard card`).toBe(kitFor(hero).melee.blockable);
		}
	});

	it("reads the dash speed from the hero's own burst", () => {
		for (const hero of HERO_IDS) {
			const dash = MOVE_LISTS[hero].entries.find((e) => e.id === "dash");
			const speed = kitFor(hero).melee.burst.speed;
			expect(stat(dash as MoveEntry, "DASH"), hero).toBe(`${speed} px/s`);
		}
	});

	it("shows the machine gun's real reserve", () => {
		const gun = RANGED_WEAPONS.machinegun;
		const entry = MOVE_LISTS.anands.entries.find((e) => e.id === "machinegun");
		expect(stat(entry as MoveEntry, "MAG")).toBe(
			`${gun.magazine} / ${reserveRoundsFor(gun)}`,
		);
	});

	it("renders alternatives as or-choices, not sequences", () => {
		for (const hero of HERO_IDS) {
			const entries = MOVE_LISTS[hero].entries;
			const stance = entries.find((e) => e.id === "stance");
			const walk = entries.find((e) => e.id === "walk");
			const dash = entries.find((e) => e.id === "dash");
			expect(stance?.command.join, `${hero} stance`).toBe("or");
			expect(walk?.command.join, `${hero} walk`).toBe("or");
			expect(dash?.command.groups, `${hero} dash`).toEqual([
				["left", "left"],
				["right", "right"],
			]);
			expect(commandGroups(stance!.command), `${hero} stance chips`).toEqual([
				["sword"],
				["gun"],
			]);
			expect(commandGroups(walk!.command), `${hero} walk chips`).toEqual([
				["left"],
				["right"],
			]);
			expect(commandGroups(dash!.command), `${hero} dash chips`).toEqual([
				["left", "left"],
				["right", "right"],
			]);
		}
	});

	it("keeps every melee stat card derived, including the on-hit rows", () => {
		for (const { hero, entry } of ALL) {
			if (!entry.move) continue;
			expect(entry.stats, `${hero}/${entry.id}`).toBeDefined();
			const labels = entry.stats?.map((s) => s.label) ?? [];
			for (const label of ["DMG", "REACH", "STARTUP", "ACTIVE", "RECOVERY"]) {
				expect(labels, `${hero}/${entry.id} ${label}`).toContain(label);
			}
			expect(labels).toContain("TOTAL");
			if (MOVES[entry.move].hitstunMs > 0)
				expect(labels, `${hero}/${entry.id} hitstun`).toContain("HITSTUN");
			if (MOVES[entry.move].knockdown)
				expect(labels, `${hero}/${entry.id} knockdown`).toContain("KNOCKDOWN");
		}
	});

	it("runs every story long enough for its last step", () => {
		for (const id of storyIds()) {
			const story = storyFor(id);
			if (!story) continue;
			const end = Math.max(
				...story.steps.map((step) => step.at + (step.for ?? PULSE_MS)),
			);
			expect(story.loopMs, `${id} cuts off before its last step`).toBeGreaterThanOrEqual(
				end,
			);
		}
	});
});
