import {
	CP_POINT_COUNT,
	CP_SCREENS,
	CP_ZONE_H,
	CP_ZONE_W,
} from "../../tweakables/control.js";
import {
	GROUND,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	pickSpawnFrom,
	type Rect,
	SCREEN_W,
	type SpawnPoint,
	WORLD_BOTTOM,
	WORLD_LEFT,
	WORLD_TOP,
	type World,
} from "./Arena.js";
import type { ControlPad } from "./ControlPoints.js";

/**
 * The control arena: one point per screen, five screens, mirror-symmetric.
 *
 * The map *is* the mode. Five 800px modules in a line — base, yard, middle,
 * yard, base — with a capture pad at every module's centre, and the odd
 * modules mirrored from the even ones so the two halves are identical by
 * construction rather than by two hand-checked copies drifting apart.
 *
 * Built on the same vocabulary as the classic arena: solid `Rect`s and
 * `SpawnPoint`s, so collision, line of sight, the renderer and the diagnostics
 * do not know a second kind of level exists. The one addition is the pad table
 * (`ControlPad`), which is where capture reads its geometry from.
 *
 * The module parameters:
 *
 *   y=240              [ top ]                    <- mid module only
 *   y=320   [ hi ]
 *   y=340              [ mid ]
 *   y=440   [ledge]
 *   y=450   [ low ]          [ low ]
 *   y=468      |P|       |P|                      <- cover flanking the pad
 *   y=504   ......[ point ......]......           <- the capture pad's top edge
 *   y=568   ==================== ground ====================
 */

/** Ledge thickness, matching the classic arena's so wall play feels the same. */
const LEDGE_H = 24;

/**
 * AZURE's base module (screen 0; screen 4 is its mirror).
 *
 * The spawn room hugs the outer edge, the last point sits at the module's
 * centre, and there is cover between them so a last-point fight is a fight
 * rather than a firing squad at the spawn door.
 */
const BASE_MODULE: readonly Rect[] = [
	// Spawn ledges, two tiers.
	{ x: 30, y: 450, w: 150, h: LEDGE_H },
	{ x: 60, y: 340, w: 120, h: LEDGE_H },
	// Cover beside the pad, on the mid-facing side.
	{ x: 240, y: 468, w: 24, h: 100 },
	// A way station toward the yard.
	{ x: 560, y: 440, w: 140, h: LEDGE_H },
	{ x: 620, y: 320, w: 110, h: LEDGE_H },
];

const BASE_SPAWNS: readonly SpawnPoint[] = [
	// Ground, clear of the cover pillar at x=240..264.
	{ x: 40, y: 520, facing: 1 },
	{ x: 120, y: 520, facing: 1 },
	{ x: 200, y: 520, facing: 1 },
	{ x: 560, y: 520, facing: 1 },
	{ x: 640, y: 520, facing: 1 },
	{ x: 720, y: 520, facing: 1 },
	// Spawn ledges.
	{ x: 70, y: 402, facing: 1 },
	{ x: 140, y: 402, facing: 1 },
	{ x: 90, y: 292, facing: 1 },
	// Toward the yard.
	{ x: 600, y: 392, facing: 1 },
	{ x: 660, y: 272, facing: 1 },
];

/**
 * The yard module (screen 1; screen 3 is its mirror).
 *
 * The second point, flanked by two pillars and overlooked by a mid perch —
 * the hold the map is built around: an attacker wants the perch, a defender
 * wants to keep them off it.
 */
const YARD_MODULE: readonly Rect[] = [
	{ x: 80, y: 450, w: 130, h: LEDGE_H },
	{ x: 590, y: 450, w: 130, h: LEDGE_H },
	{ x: 330, y: 340, w: 140, h: LEDGE_H },
	{ x: 260, y: 468, w: 24, h: 100 },
	{ x: 516, y: 468, w: 24, h: 100 },
];

const YARD_SPAWNS: readonly SpawnPoint[] = [
	// Ground.
	{ x: 40, y: 520, facing: 1 },
	{ x: 120, y: 520, facing: 1 },
	{ x: 200, y: 520, facing: 1 },
	{ x: 600, y: 520, facing: 1 },
	{ x: 680, y: 520, facing: 1 },
	{ x: 760, y: 520, facing: 1 },
	// Low ledges.
	{ x: 110, y: 402, facing: 1 },
	{ x: 170, y: 402, facing: 1 },
	{ x: 620, y: 402, facing: 1 },
	{ x: 680, y: 402, facing: 1 },
	// The mid perch.
	{ x: 360, y: 292, facing: 1 },
	{ x: 430, y: 292, facing: 1 },
];

/**
 * The middle module (screen 2, self-symmetric).
 *
 * The neutral point, with a perch directly above it and a top platform above
 * *that*: taking mid means taking the room over it, which is the TF2 midfight
 * in two dimensions.
 */
const MID_MODULE: readonly Rect[] = [
	{ x: 40, y: 450, w: 130, h: LEDGE_H },
	{ x: 630, y: 450, w: 130, h: LEDGE_H },
	{ x: 330, y: 340, w: 140, h: LEDGE_H },
	{ x: 210, y: 468, w: 24, h: 100 },
	{ x: 566, y: 468, w: 24, h: 100 },
	{ x: 350, y: 240, w: 100, h: LEDGE_H },
];

const MID_SPAWNS: readonly SpawnPoint[] = [
	// Ground, clear of the pillars at x=210..234 and x=566..590.
	{ x: 40, y: 520, facing: 1 },
	{ x: 120, y: 520, facing: 1 },
	{ x: 170, y: 520, facing: 1 },
	{ x: 600, y: 520, facing: 1 },
	{ x: 680, y: 520, facing: 1 },
	{ x: 760, y: 520, facing: 1 },
	// Low ledges.
	{ x: 70, y: 402, facing: 1 },
	{ x: 130, y: 402, facing: 1 },
	{ x: 650, y: 402, facing: 1 },
	{ x: 710, y: 402, facing: 1 },
	// The perch and the top.
	{ x: 360, y: 292, facing: 1 },
	{ x: 430, y: 292, facing: 1 },
	{ x: 370, y: 192, facing: 1 },
	{ x: 410, y: 192, facing: 1 },
];

/** The three authored modules; screens 3 and 4 are mirrors of 1 and 0. */
const MODULES: readonly (readonly Rect[])[] = [
	BASE_MODULE,
	YARD_MODULE,
	MID_MODULE,
];
const MODULE_SPAWNS: readonly (readonly SpawnPoint[])[] = [
	BASE_SPAWNS,
	YARD_SPAWNS,
	MID_SPAWNS,
];

/** Which authored module a screen draws from. */
function moduleFor(screen: number): number {
	return screen < 3 ? screen : CP_SCREENS - 1 - screen;
}

/** Is this screen a mirror of its module? */
function isMirrored(screen: number): boolean {
	return screen >= CP_SCREENS / 2;
}

/** Mirror a rect within its own screen. */
function mirrorRect(p: Rect): Rect {
	return { x: SCREEN_W - (p.x + p.w), y: p.y, w: p.w, h: p.h };
}

/** Mirror a spawn's body within its screen, so the fighter lands mirrored too. */
function mirrorSpawn(s: SpawnPoint): SpawnPoint {
	return { x: SCREEN_W - (s.x + PLAYER_WIDTH), y: s.y, facing: -s.facing };
}

function moduleRects(screen: number): Rect[] {
	const module = MODULES[moduleFor(screen)] ?? BASE_MODULE;
	const mirrored = isMirrored(screen);
	const ox = screen * SCREEN_W;
	return module.map((p) => {
		const local = mirrored ? mirrorRect(p) : p;
		return { ...local, x: ox + local.x };
	});
}

function moduleSpawns(screen: number): SpawnPoint[] {
	const module = MODULE_SPAWNS[moduleFor(screen)] ?? BASE_SPAWNS;
	const mirrored = isMirrored(screen);
	const ox = screen * SCREEN_W;
	return module.map((s) => {
		const local = mirrored ? mirrorSpawn(s) : s;
		return { ...local, x: ox + local.x };
	});
}

/**
 * The five capture pads, left to right at every screen's centre.
 *
 * Built once from the same constants the capture logic reads, so the drawn pad
 * and the capture zone cannot disagree: **the pad is the zone**.
 */
export const CONTROL_PADS: readonly ControlPad[] = Array.from(
	{ length: CP_POINT_COUNT },
	(_, i) => ({
		x: i * SCREEN_W + SCREEN_W / 2 - CP_ZONE_W / 2,
		y: GROUND.y - CP_ZONE_H,
		w: CP_ZONE_W,
		h: CP_ZONE_H,
	}),
);

/** Every screen's spawn points, indexed by screen. Forward spawns pick here. */
export const CONTROL_SCREEN_SPAWNS: readonly (readonly SpawnPoint[])[] =
	Array.from({ length: CP_SCREENS }, (_, screen) => moduleSpawns(screen));

/**
 * Build the control arena's geometry.
 *
 * Deterministic and shared by client and server, exactly like `buildWorld`:
 * the same five pads, the same mirrored modules, the same spawn tables on both
 * sides of the wire.
 */
export function buildControlWorld(): World {
	const platforms: Rect[] = [{ ...GROUND, w: SCREEN_W * CP_SCREENS }];
	const spawnPoints: SpawnPoint[] = [];
	for (let screen = 0; screen < CP_SCREENS; screen++) {
		platforms.push(...moduleRects(screen));
		spawnPoints.push(...(CONTROL_SCREEN_SPAWNS[screen] ?? []));
	}
	return {
		screens: CP_SCREENS,
		left: WORLD_LEFT,
		top: WORLD_TOP,
		right: SCREEN_W * CP_SCREENS,
		bottom: WORLD_BOTTOM,
		platforms,
		spawnPoints,
	};
}

/**
 * Rebuild `target` in place as the control arena.
 *
 * The mirror of `applyWorld`: a latecomer who booted a one-screen classic
 * arena is corrected to the five-screen control map the room is playing, with
 * every holder of the reference seeing it without re-plumbing.
 */
export function applyControlWorld(target: World): World {
	const next = buildControlWorld();
	target.screens = next.screens;
	target.left = next.left;
	target.top = next.top;
	target.right = next.right;
	target.bottom = next.bottom;
	target.platforms = next.platforms;
	target.spawnPoints = next.spawnPoints;
	return target;
}

/**
 * Where a 5CP fighter enters: its side's front-line screen, at the point
 * furthest from everyone already placed, facing the enemy.
 *
 * `screen` comes from `controlSpawnScreen` — one step behind the team's
 * furthest-forward point — which is the whole of "forward spawns".
 */
export function pickControlSpawn(
	occupied: readonly { x: number; y: number }[],
	team: 0 | 1,
	screen: number,
): SpawnPoint {
	const zone = CONTROL_SCREEN_SPAWNS[screen] ?? CONTROL_SCREEN_SPAWNS[0] ?? [];
	// A module with no spawn points cannot ship — a test asserts every screen has
	// enough — but a level edit must degrade to a bad spawn, not a crash.
	const best =
		zone.length > 0
			? pickSpawnFrom(zone, occupied)
			: {
					x: screen * SCREEN_W + PLAYER_WIDTH,
					y: GROUND.y - PLAYER_HEIGHT,
					facing: 1,
				};
	return { ...best, facing: team === 0 ? 1 : -1 };
}
