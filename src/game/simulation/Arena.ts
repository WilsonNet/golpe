/**
 * The arena: one source of truth for world size, solid geometry and the
 * rectangle maths everything else (collision, rendering, line-of-sight,
 * bullets) is built on.
 *
 * Renderers MUST draw from `platforms` rather than hand-placing sprites —
 * that is what keeps what you see identical to what you collide with.
 *
 * The world is **parameterised by screen count**: one screen is the classic
 * 800x600 arena, and a wider room tiles the same layout per screen,
 * mirroring every other screen so long corridors do not repeat visually.
 * `buildWorld(screens)` is the single builder — client and server call the
 * same code, which is what keeps a 3-screen room physically identical on
 * both sides of the wire.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** One screen's width/height, in world px. The whole game is authored at this scale. */
export const SCREEN_W = 800;
const SCREEN_H = 600;
/** Upper bound on `?screen=N`, so a typo cannot build a world nobody can load. */
export const MAX_SCREENS = 8;

/**
 * The whole arena as a room owns it: bounds, solids and spawn points.
 *
 * An instance is shared by reference — the server builds one per room and
 * every client builds one, and the same object is handed to the physics, the
 * AI, the renderer and the diagnostics. The client mutates its instance in
 * place when the server's `match` message names the authoritative screen
 * count, so every holder sees the corrected geometry without re-plumbing.
 */
export interface World {
	screens: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
	platforms: readonly Rect[];
	spawnPoints: readonly SpawnPoint[];
}

const WORLD_LEFT = 0;
const WORLD_TOP = 0;
export const WORLD_BOTTOM = SCREEN_H;

export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 48;

/** Ledge thickness. Thick enough that a player can make side contact and wall jump. */
const LEDGE_H = 24;

/**
 * The ground: one solid spanning the whole world width, whatever the screen
 * count. Tiling it would only create seams at screen boundaries.
 */
export const GROUND: Rect = { x: 0, y: 568, w: SCREEN_W, h: 32 };

/**
 * One screen's worth of ledges and pillars, laid out so every surface is
 * reachable with a single jump from the surface below it (see JUMP_HEIGHT_PX
 * in Physics.ts). Tiled per screen by `buildWorld`, mirrored on odd screens.
 *
 *   y=170            [ top ]
 *   y=250   [ hi-L ]          [ hi-R ]
 *   y=360            [ mid ]
 *   y=450   [ lo-L ]          [ lo-R ]
 *   y=468        |P|      |P|              <- ground-level cover
 *   y=568   ==================== ground ====================
 */
export const LOW_LEFT: Rect = { x: 90, y: 450, w: 130, h: LEDGE_H };
const LOW_RIGHT: Rect = { x: 580, y: 450, w: 130, h: LEDGE_H };
export const MID: Rect = { x: 330, y: 360, w: 140, h: LEDGE_H };
const HIGH_LEFT: Rect = { x: 60, y: 250, w: 120, h: LEDGE_H };
const HIGH_RIGHT: Rect = { x: 620, y: 250, w: 120, h: LEDGE_H };
const TOP_CENTRE: Rect = { x: 350, y: 170, w: 100, h: LEDGE_H };

/**
 * Ground-level pillars: cover to break line-of-sight, plus wall-jump surfaces
 * and a route up that does not need the outer ledges.
 *
 * Keep them clear of the ledges above and either side: a gap narrower than
 * PLAYER_WIDTH under an overhang is a trap that pins the AI in place, which is
 * exactly what a 30px gap here used to do.
 */
export const PILLAR_LEFT: Rect = { x: 280, y: 468, w: 24, h: 100 };
export const PILLAR_RIGHT: Rect = { x: 496, y: 468, w: 24, h: 100 };

/** Everything except the ground, one screen's worth. */
const BASE_LEDGES: readonly Rect[] = [
	LOW_LEFT,
	LOW_RIGHT,
	MID,
	HIGH_LEFT,
	HIGH_RIGHT,
	TOP_CENTRE,
	PILLAR_LEFT,
	PILLAR_RIGHT,
];

/**
 * Where fighters enter the arena.
 *
 * Seventeen points for sixteen slots, so a respawn always has somewhere to go
 * that is not the point somebody is standing on. Every one sits on top of a
 * platform and clear of the pillars — a spawn inside geometry is depenetrated on
 * the first tick, which reads as a teleport on every other client.
 *
 * A deathmatch picks the point furthest from the nearest living fighter rather
 * than the next one in the list: spawning inside somebody's swing is the one
 * death a player cannot do anything about.
 */
export interface SpawnPoint {
	x: number;
	y: number;
	/** Which way to look on arrival — toward the middle of the arena. */
	facing: number;
}

/**
 * One screen's worth of spawn points — seventeen for sixteen slots, so a
 * respawn always has somewhere to go that is not the point somebody is
 * standing on. Every one sits on top of a platform and clear of the pillars —
 * a spawn inside geometry is depenetrated on the first tick, which reads as a
 * teleport on every other client.
 */
const BASE_SPAWN_POINTS: readonly SpawnPoint[] = [
	// Ground, avoiding the two pillars at x=280..304 and x=496..520.
	{ x: 40, y: 518, facing: 1 },
	{ x: 120, y: 518, facing: 1 },
	{ x: 200, y: 518, facing: 1 },
	{ x: 350, y: 518, facing: 1 },
	{ x: 450, y: 518, facing: -1 },
	{ x: 600, y: 518, facing: -1 },
	{ x: 680, y: 518, facing: -1 },
	{ x: 760, y: 518, facing: -1 },
	// Low ledges.
	{ x: 110, y: 400, facing: 1 },
	{ x: 175, y: 400, facing: 1 },
	{ x: 600, y: 400, facing: -1 },
	{ x: 665, y: 400, facing: -1 },
	// Mid.
	{ x: 345, y: 310, facing: 1 },
	{ x: 425, y: 310, facing: -1 },
	// High ledges.
	{ x: 85, y: 200, facing: 1 },
	{ x: 645, y: 200, facing: -1 },
	// The peak.
	{ x: 375, y: 120, facing: 1 },
];

/**
 * Build the world for a room of `screens` screens.
 *
 * Deterministic and shared verbatim by client and server, so what a player
 * collides with is exactly what every other client drew. Screen 0 carries the
 * original layout; every odd screen is mirrored (x' = SCREEN_W - (x + w)) so
 * corridors are not a wallpaper loop. The ground spans the whole width.
 */
export function buildWorld(screens: number): World {
	const count = Math.max(1, Math.min(Math.floor(screens), MAX_SCREENS));
	const right = SCREEN_W * count;

	const platforms: Rect[] = [
		// One ground across the whole width; tiling it would only create seams.
		{ ...GROUND, w: right },
	];
	const spawnPoints: SpawnPoint[] = [];

	for (let i = 0; i < count; i++) {
		const ox = i * SCREEN_W;
		const mirrored = i % 2 === 1;
		const px = (x: number) => (mirrored ? SCREEN_W - (x + PLAYER_WIDTH) : x);

		for (const p of BASE_LEDGES) {
			platforms.push({
				x: ox + (mirrored ? SCREEN_W - (p.x + p.w) : p.x),
				y: p.y,
				w: p.w,
				h: p.h,
			});
		}
		for (const s of BASE_SPAWN_POINTS) {
			spawnPoints.push({
				x: ox + px(s.x),
				y: s.y,
				// Mirror the facing with the layout, so an odd screen's spawns
				// still look in toward that screen's centre.
				facing: mirrored ? -s.facing : s.facing,
			});
		}
	}

	return {
		screens: count,
		left: WORLD_LEFT,
		top: WORLD_TOP,
		right,
		bottom: WORLD_BOTTOM,
		platforms,
		spawnPoints,
	};
}

/**
 * The world every caller gets when it does not ask for one: one screen.
 *
 * Kept as a module-level instance so unchanged call sites — tests included —
 * keep reading `platforms`/`SPAWN_POINTS`/`WORLD_*` exactly as they always
 * did, while everything that knows about rooms passes its own `World`.
 */
export const DEFAULT_WORLD: World = buildWorld(1);

/**
 * Rebuild `target` in place to describe a different screen count.
 *
 * Identity is preserved, so every holder of the reference — physics, AI,
 * renderer, diagnostics — sees the new geometry without being re-plumbed.
 * Used by the client when the server's `match` message names the room's
 * authoritative screen count, which can differ from what the URL asked for.
 */
export function applyWorld(target: World, screens: number): World {
	const next = buildWorld(screens);
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
 * Every solid in the default arena.
 *
 * Named rather than anonymous so nothing has to refer to a surface by index.
 * Tests used to reach for `platforms[3]` with the coordinates copied into a
 * trailing comment — which is both unreadable and a lie waiting to happen the
 * next time the list is reordered.
 */
export const platforms: readonly Rect[] = DEFAULT_WORLD.platforms;

/**
 * Where fighters enter the default arena.
 *
 * A deathmatch picks the point furthest from the nearest living fighter rather
 * than the next one in the list: spawning inside somebody's swing is the one
 * death a player cannot do anything about.
 */
export const SPAWN_POINTS: readonly SpawnPoint[] = DEFAULT_WORLD.spawnPoints;

/**
 * The spawn point furthest from everyone in `occupied`.
 *
 * Pure and deterministic, so client and server agree on where a fighter came
 * back — and so a test can assert the choice instead of eyeballing it. Ties go
 * to the earlier point in the list rather than to chance.
 */
export function pickSpawn(
	occupied: readonly { x: number; y: number }[],
	world: World = DEFAULT_WORLD,
): SpawnPoint {
	return pickFrom(world.spawnPoints, occupied);
}

/** `pickSpawn`, over an arbitrary candidate list. Ties go to the earlier point. */
function pickFrom(
	points: readonly SpawnPoint[],
	occupied: readonly { x: number; y: number }[],
): SpawnPoint {
	let best = points[0] as SpawnPoint;
	let bestScore = -1;

	for (const point of points) {
		let nearest = Number.POSITIVE_INFINITY;
		for (const other of occupied) {
			nearest = Math.min(
				nearest,
				Math.hypot(point.x - other.x, point.y - other.y),
			);
		}
		// An empty arena scores every point equally; take the first.
		const score = occupied.length === 0 ? 0 : nearest;
		if (score > bestScore) {
			bestScore = score;
			best = point;
		}
	}
	return best;
}

/**
 * The spawn points belonging to one side: **team 0 on the leftmost screen, team
 * 1 on the rightmost**.
 *
 * Exactly one screen each, whatever the room's width — not a fraction of it. A
 * screen is the unit the whole game is authored in and the unit a player reads:
 * "we start on the left screen, they start on the right, everything between is
 * contested" is a sentence somebody can hold in their head on a three-screen map
 * and on an eight-screen one. A third of the arena is the same thing at three
 * screens and a vague blob at eight.
 *
 * On a two-screen room the two zones meet in the middle with no neutral ground,
 * which is why team deathmatch has a three-screen floor.
 *
 * Falls back to the whole arena if the zone is empty, which cannot happen with
 * the shipped layout but would otherwise turn a level edit into a crash rather
 * than a bad spawn.
 */
export function teamSpawnPoints(
	world: World,
	team: number,
): readonly SpawnPoint[] {
	const lo = team === 0 ? world.left : world.right - SCREEN_W;
	const hi = team === 0 ? world.left + SCREEN_W : world.right;
	const zone = world.spawnPoints.filter((p) => p.x >= lo && p.x <= hi);
	return zone.length > 0 ? zone : world.spawnPoints;
}

/**
 * Where a team deathmatch fighter enters: their own end of the arena, at the
 * point furthest from everyone already placed.
 *
 * **Facing is overridden to point across the map**, not inherited from the spawn
 * point. The per-screen layout aims its spawns at the middle of *their screen*,
 * which on a three-screen arena leaves half a team starting with their back to
 * the fight — and facing is what decides which way a guard covers.
 */
export function pickTeamSpawn(
	occupied: readonly { x: number; y: number }[],
	world: World,
	team: number,
): SpawnPoint {
	const point = pickFrom(teamSpawnPoints(world, team), occupied);
	return { ...point, facing: team === 0 ? 1 : -1 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

function pointInRect(px: number, py: number, r: Rect): boolean {
	return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function pointInAnyPlatform(
	px: number,
	py: number,
	world: World = DEFAULT_WORLD,
): boolean {
	for (const p of world.platforms) {
		if (pointInRect(px, py, p)) return true;
	}
	return false;
}

/**
 * Sampled line-of-sight test. Used by the AI to decide whether it can shoot,
 * and by diagnostics. `samples` trades accuracy for cost.
 */
export function hasLineOfSight(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	samples = 24,
	world: World = DEFAULT_WORLD,
): boolean {
	for (let i = 1; i < samples; i++) {
		const t = i / samples;
		const x = fromX + (toX - fromX) * t;
		const y = fromY + (toY - fromY) * t;
		if (pointInAnyPlatform(x, y, world)) return false;
	}
	return true;
}

/**
 * Every horizontal gap between two solids that overlap vertically.
 *
 * A gap narrower than PLAYER_WIDTH is a pocket an actor can walk into and then
 * be pinned inside — invisible on screen, but it stops the AI dead. Tests
 * assert against this so level edits cannot reintroduce one.
 */
export function narrowGaps(
	minWidth = PLAYER_WIDTH,
	world: World = DEFAULT_WORLD,
): {
	a: Rect;
	b: Rect;
	gap: number;
}[] {
	const found: { a: Rect; b: Rect; gap: number }[] = [];
	world.platforms.forEach((a, i) => {
		for (const b of world.platforms.slice(i + 1)) {
			const verticallyOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
			if (!verticallyOverlap) continue;

			const gap = a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
			if (gap > 0 && gap < minWidth) found.push({ a, b, gap });
		}
	});
	return found;
}

/** Player-sized AABB at a position. */
function playerBox(x: number, y: number): Rect {
	return { x, y, w: PLAYER_WIDTH, h: PLAYER_HEIGHT };
}

/**
 * How deep a player box is buried inside solid geometry, in px.
 * Should be 0 every frame — diagnostics assert on this to catch collision
 * regressions that jitter thresholds cannot see.
 */
export function penetrationDepth(
	x: number,
	y: number,
	world: World = DEFAULT_WORLD,
): number {
	const box = playerBox(x, y);
	let worst = 0;
	for (const p of world.platforms) {
		if (!rectsOverlap(box, p)) continue;
		const overlapX = Math.min(box.x + box.w, p.x + p.w) - Math.max(box.x, p.x);
		const overlapY = Math.min(box.y + box.h, p.y + p.h) - Math.max(box.y, p.y);
		worst = Math.max(worst, Math.min(overlapX, overlapY));
	}
	return worst;
}
