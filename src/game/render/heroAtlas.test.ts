/**
 * Every Blender-rendered hero's atlas keeps the contract the renderer relies on.
 *
 * The sheets are generated (`scripts/make-hero-art.py <hero>` from
 * `art/<hero>/<hero>.blend`), and an artist edits the .blend by hand — so a re-render is the moment a
 * clip goes missing, a frame index points past the atlas, or the body height
 * the draw scale is computed from drifts. Each of those is a fighter that
 * draws wrong in-game with nothing else to report it: the first version of
 * the rendered art drew a second, bigger sword because nothing checked what
 * the sheet already contained.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isClipName } from "../ecs/systems";
import { PLAYER_HEIGHT } from "../simulation/Arena";

interface Meta {
	cellW: number;
	cellH: number;
	bodyH: number;
	frames: {
		x: number;
		y: number;
		w: number;
		h: number;
		ox: number;
		oy: number;
	}[];
	clips: Record<
		string,
		{
			frames: number[];
			fps: number;
			loop: boolean;
			drive?: string;
			bands?: number;
		}
	>;
}

/** The heroes whose art is a packed sheet rendered from Blender. */
const RENDERED_HEROES = ["lia", "jeffs", "anands"];

function load(hero: string) {
	const meta = JSON.parse(
		readFileSync(`public/assets/${hero}.json`, "utf8"),
	) as Meta;
	const png = readFileSync(`public/assets/${hero}.png`);
	// PNG IHDR: width and height are big-endian at bytes 16 and 20.
	return { meta, atlasW: png.readUInt32BE(16), atlasH: png.readUInt32BE(20) };
}

/** Every clip `animationSystem` can pick for any hero. */
const REQUIRED_ALL = [
	"right",
	"left",
	"right-idle",
	"left-idle",
	"turn",
	"jump",
	"jump-left",
	"fall",
	"fall-left",
	"gun-hold",
	"gun-hold-left",
	"gun-fire",
	"gun-fire-left",
	"gun-run",
	"gun-run-left",
	"roll-right",
	"roll-left",
	"disabled",
	"disabled-left",
	"helpless",
	"helpless-left",
	"downed",
	"downed-left",
	"launched",
	"launched-left",
];

/** The melee weapon's own clips: the sword's cuts and states, the dagger's moves. */
const REQUIRED_MELEE: Record<string, string[]> = {
	sword: [
		"block",
		"charge",
		"charge-walk",
		"slash",
		"slash2",
		"slash3",
		"uppercut",
		"slam",
		"plunge",
		"stuck",
	].flatMap((n) => [n, `${n}-left`]),
	dagger: ["stab", "shoryuken", "thrust-windup", "thrust-dash"].flatMap((n) => [
		n,
		`${n}-left`,
	]),
};

/** Which melee weapon each rendered hero's art draws. */
const MELEE: Record<string, string> = {
	lia: "sword",
	jeffs: "sword",
	anands: "dagger",
};

describe.each(RENDERED_HEROES)("%s's atlas", (hero) => {
	const { meta, atlasW, atlasH } = load(hero);

	it("draws the fighter at collider height, whatever the cell grew to", () => {
		// The scale comes from the body box, never the cell: a longer sword
		// grows the cell and must not shrink (or grow) the fighter.
		expect(meta.bodyH).toBe(PLAYER_HEIGHT * 2);
		expect(meta.cellH).toBeGreaterThanOrEqual(meta.bodyH);
		expect(meta.cellW % 2).toBe(0);
		expect(meta.cellH % 2).toBe(0);
	});

	it("names only clips the game knows, and every clip the game picks", () => {
		for (const name of Object.keys(meta.clips)) {
			expect(isClipName(name), `unknown clip "${name}"`).toBe(true);
		}
		for (const name of [
			...REQUIRED_ALL,
			...(REQUIRED_MELEE[MELEE[hero] ?? ""] ?? []),
		]) {
			expect(
				meta.clips[name]?.frames.length,
				`missing clip "${name}"`,
			).toBeGreaterThan(0);
		}
	});

	it.runIf(MELEE[hero] === "sword")(
		"drives the sword's moves by their progress, not a clock",
		() => {
			for (const name of ["slash", "slash2", "slash3", "uppercut", "slam"]) {
				expect(meta.clips[name]?.drive).toBe("move");
				expect(meta.clips[`${name}-left`]?.drive).toBe("move");
			}
		},
	);

	it("splits the rifle clips into aim bands the frames divide evenly", () => {
		// The rifle follows the aim: each gun clip is `bands` equal runs, one
		// per elevation from straight up to straight down. A band count that
		// does not divide the frames would draw the wrong elevation's pose.
		for (const name of ["gun-hold", "gun-fire", "gun-run"]) {
			for (const clip of [meta.clips[name], meta.clips[`${name}-left`]]) {
				expect(clip?.drive).toBe("aim");
				const bands = clip?.bands ?? 0;
				expect(bands % 2, "an odd band count has a level band").toBe(1);
				expect((clip?.frames.length ?? 0) % bands).toBe(0);
			}
		}
	});

	it("keeps every frame inside the atlas and inside its cell", () => {
		for (const f of meta.frames) {
			expect(f.x + f.w).toBeLessThanOrEqual(atlasW);
			expect(f.y + f.h).toBeLessThanOrEqual(atlasH);
			expect(f.ox + f.w).toBeLessThanOrEqual(meta.cellW);
			expect(f.oy + f.h).toBeLessThanOrEqual(meta.cellH);
		}
		for (const clip of Object.values(meta.clips)) {
			for (const i of clip.frames) {
				expect(i).toBeLessThan(meta.frames.length);
			}
		}
	});
});
