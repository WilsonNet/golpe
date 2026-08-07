/**
 * The interaction guard: the simulation is the integration system.
 *
 * A hero is data (see Heroes.ts and specs/interactions.md), and every
 * cross-hero interaction is a predicate over state and declared attributes —
 * never a branch on which hero is which. A hero-id branch in the shared
 * simulation is the first cell of a pairwise matrix: the next hero lands in a
 * second `if`, the one after that in a third, and adding a hero stops being
 * data and starts being surgery.
 *
 * This test greps the shared simulation and the server's authority layer for
 * hero-id comparisons and fails naming the offender. A new hero adds strings
 * to `HEROES`, never `if`s to the tick. Presentation (the HUD, the menu, the
 * AI's animation choices) is allowed to branch per hero — the rule is only
 * about the code both sides of the network run to decide what happened.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SIMULATION = fileURLToPath(new URL(".", import.meta.url));
const GAME_ROOM = fileURLToPath(
	new URL("../../../server/GameRoom.ts", import.meta.url),
);

/** A hero-id used as a branch: a comparison or a switch case. */
const HERO_ID_BRANCH =
	/(?:===|!==)\s*["'](?:lia|anands|jeffs)["']|["'](?:lia|anands|jeffs)["']\s*(?:===|!==)|case\s+["'](?:lia|anands|jeffs)["']/;

function filesUnder(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...filesUnder(path));
		else if (entry.name.endsWith(".ts")) found.push(path);
	}
	return found;
}

/** The files the rule covers: the simulation minus its tests, plus GameRoom. */
function scanTargets(): { path: string; name: string }[] {
	const targets = filesUnder(SIMULATION)
		.filter((p) => !p.endsWith(".test.ts"))
		.map((p) => ({ path: p, name: p.slice(SIMULATION.length) }));
	targets.push({ path: GAME_ROOM, name: "server/GameRoom.ts" });
	return targets;
}

describe("the hero interaction guard", () => {
	it("the simulation and GameRoom never branch on which hero is which", () => {
		const offenders: string[] = [];
		for (const target of scanTargets()) {
			const src = readFileSync(target.path, "utf8");
			for (const [i, line] of src.split("\n").entries()) {
				if (HERO_ID_BRANCH.test(line)) {
					offenders.push(`${target.name}:${i + 1}: ${line.trim()}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("the instrument can go red: a hero-id branch is never silently allowed", () => {
		const fake = 'if (hero === "anands") return;\n';
		expect(HERO_ID_BRANCH.test(fake)).toBe(true);
		const asCase = 'switch (kit.hero) { case "jeffs": break; }\n';
		expect(HERO_ID_BRANCH.test(asCase)).toBe(true);
		// A registry key is data, not a branch: the guard must not flag it.
		const registry = 'HERO_IDS = ["lia", "anands", "jeffs"];\n';
		expect(HERO_ID_BRANCH.test(registry)).toBe(false);
	});
});
