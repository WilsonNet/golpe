/**
 * The map maker's checks: what is wrong with a map, measured, before anybody
 * plays it.
 *
 * Every rule here is a bug this game has already had on the hand-made arena —
 * a gap narrower than a fighter that pinned the AI (`narrowGaps`), a spawn
 * inside geometry that read as a teleport on every client, a ledge out of
 * jump reach that nobody ever stood on. The editor shows them as a list with
 * a location; the pull request lists them too, so a reviewer sees the same
 * measurement the author did.
 *
 * Pure and deterministic: a map in, a list of issues out.
 */

import { AIR_JUMP_VELOCITY, GRAVITY } from "../../tweakables/movement";
import {
	narrowGaps,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	penetrationDepth,
	type Rect,
	SCREEN_W,
	type SpawnPoint,
	type World,
} from "../simulation/Arena";
import { JUMP_HEIGHT_PX } from "../simulation/Physics";
import { TDM_MIN_SCREENS } from "../simulation/Teams";
import {
	spawnsFromTilemap,
	type TilemapSpec,
	worldFromTilemap,
} from "../simulation/Tilemap";

type IssueLevel = "error" | "warning" | "info";

export interface MapIssue {
	level: IssueLevel;
	/** Stable id for the rule, for tests and the PR's table. */
	code:
		| "no-spawns"
		| "few-spawns"
		| "spawn-inside"
		| "spawn-floating"
		| "narrow-gap"
		| "crawlspace"
		| "unreachable"
		| "tdm-narrow"
		| "tdm-spawns";
	message: string;
	/** Where to look, in world pixels — the editor frames it on click. */
	at?: Rect;
}

/** How far above a surface a ground jump plus the air jump can lift a fighter's feet. */
const DOUBLE_JUMP_RISE_PX = Math.floor(
	JUMP_HEIGHT_PX + (AIR_JUMP_VELOCITY * AIR_JUMP_VELOCITY) / (2 * GRAVITY),
);
/**
 * The rise the checks allow: the double jump less a margin, because the
 * feet have to clear the lip, not touch it. Matches what the bots manage.
 */
const LIP_MARGIN_PX = 16;
export const REACH_RISE_PX = DOUBLE_JUMP_RISE_PX - LIP_MARGIN_PX;
/**
 * Horizontal gap a jump can cross: walk speed over a double jump's airtime,
 * rounded down. An air dash goes further; the checks do not assume one.
 */
const REACH_ACROSS_PX = 240;
/**
 * Extra horizontal reach per sqrt(px) of drop: airtime grows with the square
 * root of the fall, and walk speed turns it into distance.
 */
const FALL_REACH_PER_ROOT_PX = 8;
/** A spawn this far above the nearest surface is a drop, not a landing. */
const FLOATING_SPAWN_PX = 24;
/** Fewer spawns than this and a full room respawns on top of itself. */
const ENOUGH_SPAWNS = 8;

function issue(
	level: IssueLevel,
	code: MapIssue["code"],
	message: string,
	at?: Rect,
): MapIssue {
	return at ? { level, code, message, at } : { level, code, message };
}

function spawnBox(s: SpawnPoint): Rect {
	return { x: s.x, y: s.y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
}

/**
 * The surface a spawn would land on: the highest platform top under its feet,
 * or the world floor.
 */
function groundUnder(s: SpawnPoint, world: World): number {
	const feet = s.y + PLAYER_HEIGHT;
	let best = world.bottom;
	for (const p of world.platforms) {
		const overlaps = s.x < p.x + p.w && s.x + PLAYER_WIDTH > p.x;
		if (overlaps && p.y >= feet - 1 && p.y < best) best = p.y;
	}
	return best;
}

/** A standable span: the top of a platform (or the floor) a fighter fits on. */
interface Surface {
	x0: number;
	x1: number;
	y: number;
	/** The platform, or null for the world floor. */
	rect: Rect | null;
}

/** Every top a fighter can stand on: wide enough and with headroom. */
function surfaces(world: World): Surface[] {
	const out: Surface[] = [
		{ x0: world.left, x1: world.right, y: world.bottom, rect: null },
	];
	for (const p of world.platforms) {
		if (p.w < PLAYER_WIDTH) continue;
		const head = { x: p.x, y: p.y - PLAYER_HEIGHT, w: p.w, h: PLAYER_HEIGHT };
		// Fully roofed by another solid: nobody stands there.
		const roofed = world.platforms.some(
			(q) =>
				q !== p &&
				q.x <= head.x &&
				q.x + q.w >= head.x + head.w &&
				q.y < p.y &&
				q.y + q.h > head.y,
		);
		if (roofed || p.y - PLAYER_HEIGHT < world.top) continue;
		out.push({ x0: p.x, x1: p.x + p.w, y: p.y, rect: p });
	}
	return out;
}

function gapBetween(a: Surface, b: Surface): number {
	if (a.x1 < b.x0) return b.x0 - a.x1;
	if (b.x1 < a.x0) return a.x0 - b.x1;
	return 0;
}

/** Can a fighter standing on `a` get onto `b`? Up needs jump reach; down needs only a drop. */
function reaches(a: Surface, b: Surface): boolean {
	const rise = a.y - b.y;
	const gap = gapBetween(a, b);
	if (rise > REACH_RISE_PX) return false;
	if (rise > 0) return gap <= REACH_ACROSS_PX;
	// Falling buys airtime, and airtime buys distance.
	return gap <= REACH_ACROSS_PX + Math.sqrt(-rise) * FALL_REACH_PER_ROOT_PX;
}

/**
 * The surfaces nobody can get to from where fighters enter.
 *
 * A breadth-first walk over "can jump from A to B" edges, starting from every
 * surface a spawn lands on. An approximation of the jump arc — it does not
 * model wall jumps or air dashes, so it errs toward "reachable is harder than
 * it is" and reports a warning, never an error.
 */
export function unreachableSurfaces(world: World): Rect[] {
	const all = surfaces(world);
	const seen = new Set<Surface>();
	const queue: Surface[] = [];
	for (const s of world.spawnPoints) {
		const ground = groundUnder(s, world);
		const start = all.find(
			(f) => f.y === ground && s.x + PLAYER_WIDTH > f.x0 && s.x < f.x1,
		);
		if (start && !seen.has(start)) {
			seen.add(start);
			queue.push(start);
		}
	}
	while (queue.length > 0) {
		const a = queue.shift() as Surface;
		for (const b of all) {
			if (seen.has(b) || !reaches(a, b)) continue;
			seen.add(b);
			queue.push(b);
		}
	}
	return all.filter((s) => !seen.has(s) && s.rect).map((s) => s.rect as Rect);
}

/**
 * Every issue with a map. Errors make the map unpublishable; warnings and
 * notes are the author's call.
 */
export function checkMap(map: TilemapSpec): MapIssue[] {
	const world = worldFromTilemap(map);
	const issues: MapIssue[] = [];
	const declared = spawnsFromTilemap(map);

	if (declared.length === 0) {
		issues.push(
			issue(
				"error",
				"no-spawns",
				"Place at least two spawn points — fighters need somewhere to enter.",
			),
		);
	} else if (declared.length < 2) {
		issues.push(
			issue("error", "no-spawns", "A fight needs at least two spawn points."),
		);
	} else if (declared.length < ENOUGH_SPAWNS) {
		issues.push(
			issue(
				"info",
				"few-spawns",
				`${declared.length} spawns: a full room of 16 will respawn close together. ${ENOUGH_SPAWNS}+ spreads them out.`,
			),
		);
	}

	for (const s of declared) {
		const box = spawnBox(s);
		if (penetrationDepth(s.x, s.y, world) > 0) {
			issues.push(
				issue(
					"error",
					"spawn-inside",
					"A spawn point is inside a platform.",
					box,
				),
			);
			continue;
		}
		const drop = groundUnder(s, world) - (s.y + PLAYER_HEIGHT);
		if (drop > FLOATING_SPAWN_PX) {
			issues.push(
				issue(
					"warning",
					"spawn-floating",
					`A spawn point floats ${Math.round(drop)}px above the ground — fighters drop in.`,
					box,
				),
			);
		}
	}

	for (const { a, b, gap } of narrowGaps(PLAYER_WIDTH, world)) {
		const x = Math.min(a.x + a.w, b.x + b.w);
		const y = Math.max(a.y, b.y);
		issues.push(
			issue(
				"warning",
				"narrow-gap",
				`A ${Math.round(gap)}px gap — narrower than a fighter. Bots get pinned in pockets like this.`,
				{ x, y, w: gap, h: Math.min(a.y + a.h, b.y + b.h) - y },
			),
		);
	}

	// A space a fighter can walk into but not stand up in.
	for (const p of world.platforms) {
		for (const q of world.platforms) {
			if (p === q) continue;
			const headroom = p.y - (q.y + q.h);
			const overlap = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
			if (headroom > 0 && headroom < PLAYER_HEIGHT && overlap >= PLAYER_WIDTH) {
				issues.push(
					issue(
						"warning",
						"crawlspace",
						`Only ${headroom}px of headroom over a platform — a fighter is ${PLAYER_HEIGHT}px tall.`,
						{ x: Math.max(p.x, q.x), y: q.y + q.h, w: overlap, h: headroom },
					),
				);
			}
		}
	}

	for (const rect of unreachableSurfaces(world)) {
		issues.push(
			issue(
				"warning",
				"unreachable",
				`This platform looks out of jump reach (a double jump rises ~${REACH_RISE_PX}px, crosses ~${REACH_ACROSS_PX}px).`,
				rect,
			),
		);
	}

	if (world.screens < TDM_MIN_SCREENS) {
		issues.push(
			issue(
				"info",
				"tdm-narrow",
				`Team deathmatch needs ${TDM_MIN_SCREENS}+ screens; this map plays free-for-all only.`,
			),
		);
	} else {
		const left = declared.filter((s) => s.x < SCREEN_W).length;
		const right = declared.filter((s) => s.x >= world.right - SCREEN_W).length;
		if (left === 0 || right === 0) {
			issues.push(
				issue(
					"info",
					"tdm-spawns",
					"Team deathmatch spawns each side on its end screen — put spawns on the first and last screens.",
				),
			);
		}
	}
	return issues;
}

/** True when a map has no errors — the publish gate. */
export function publishable(issues: readonly MapIssue[]): boolean {
	return !issues.some((i) => i.level === "error");
}
