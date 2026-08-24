/**
 * The ultimate's aim phase, drawn as the grenade's own arc.
 *
 * Holding R is the cast's aim phase: the meter is full, the button is held,
 * and the *ballistic solution* is shown rather than a straight beam — the
 * exact arc the grenade will fly if it is thrown on this angle, traced with
 * the same speed, gravity and fuse the simulation will use. It stops where a
 * grenade would stop: the first platform it hits, the floor of the world, or
 * where its fuse runs out. The last dot is where the hole will open.
 *
 * That is what makes the throw a skill instead of a guess. A flat angle reads
 * as a flat arc that dies on the ground; the 45° lob visibly clears a screen;
 * and a throw that would fall short under a ledge never gets to be a surprise,
 * because the arc dies under the ledge while the button is still held.
 *
 * Presentation only, like everything in `render/`. It is drawn from the
 * *drawn* position, never the body — the same rule the aim beam and the
 * nameplates follow — and nothing here is read back by the simulation.
 */

import { type Container, Graphics } from "pixi.js";
import { pointInAnyPlatform, type World } from "../simulation/Arena";
import {
	DRAGON_MIN_RIDE_MS,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	GRENADE_FUSE_MS,
	GRENADE_GRAVITY,
	GRENADE_SPEED,
} from "../simulation/Physics";
import { BLOSSOM_RADIUS_PX } from "../simulation/Ultimate";

/**
 * The ability's grenade violet, so the preview is recognisably *its* arc —
 * and the charge aura (see `MeleeFx`) imports the same constant, so the tell
 * and the throw can never drift apart.
 */
export const VIOLET = 0xb98bff;

/** How fast the arc fades in and out, in alpha per millisecond. */
const FADE_PER_MS = 1 / 140;
/** The most the arc is ever drawn at. A preview, not a guarantee. */
const MAX_ALPHA = 0.85;

/** Size of the ordinary arc dots, and of the landing dot. */
const DOT_RADIUS = 2.2;
const LANDING_RADIUS = 3.6;

/** Simulation step for tracing the arc, matching the server's own tick. */
const TRACE_DT = 1 / 60;

/** The prediction is re-traced when any of these change. */
interface TraceKey {
	x: number;
	y: number;
	angle: number;
	mode: "arc" | "beam" | "radial";
}

export class UltAimLine {
	private readonly gfx = new Graphics();
	private alpha = 0;
	private key: TraceKey = { x: -1, y: -1, angle: 0, mode: "arc" };
	private keyed = false;

	constructor(layer: Container) {
		layer.addChild(this.gfx);
	}

	/**
	 * Place the arc for this frame.
	 *
	 * `centreX`/`centreY` are **drawn** coordinates, like the aim beam: the
	 * render smoother offsets a sprite from its simulation state on purpose,
	 * and an arc growing out of the body would visibly detach from the fighter
	 * it belongs to by exactly the amount that smoothing is hiding.
	 *
	 * The grenade is launched from the body's centre, so the arc starts there
	 * too — a dot trail that begins at the chest reads as coming from the
	 * fighter rather than from the floor.
	 */
	/**
	 * The shape of the preview: the grenade's arc, the dragon's straight
	 * line, or the blossom's ring. Same contract, three geometries — the
	 * ability being aimed decides which, and the preview must show the
	 * *actual* path: a dragon aimed like a grenade would be a dragon aimed
	 * wrong, and a storm's radius is the one thing worth showing about it.
	 */
	update(
		dtMs: number,
		visible: boolean,
		centreX: number,
		centreY: number,
		angle: number,
		world: World,
		mode: "arc" | "beam" | "radial" = "arc",
	) {
		const target = visible ? MAX_ALPHA : 0;
		// Faded rather than toggled: coming out of the aim hold, or dying and
		// respawning, should not pop a bright arc on and off.
		this.alpha =
			this.alpha < target
				? Math.min(target, this.alpha + dtMs * FADE_PER_MS * MAX_ALPHA)
				: Math.max(target, this.alpha - dtMs * FADE_PER_MS * MAX_ALPHA);

		this.gfx.alpha = this.alpha;
		this.gfx.visible = this.alpha > 0.01;
		if (!this.gfx.visible) return;

		const angleChanged = !this.keyed || this.key.angle !== angle;
		const moved =
			!this.keyed || this.key.x !== centreX || this.key.y !== centreY;
		const modeChanged = !this.keyed || this.key.mode !== mode;
		if (!angleChanged && !moved && !modeChanged) return;
		this.key = { x: centreX, y: centreY, angle, mode };
		this.keyed = true;

		const dots =
			mode === "beam"
				? traceBeam(centreX, centreY, angle, world)
				: mode === "radial"
					? traceRing(centreX, centreY)
					: traceArc(centreX, centreY, angle, world);
		const landing = dots[dots.length - 1];

		this.gfx.clear();
		if (mode === "radial") {
			// A ring, not a dot trail: the storm has no landing dot. Drawn as
			// small dots around the circle so it shares the arc's visual voice
			// (and the same fade) instead of becoming a second iconography.
			for (const p of dots) {
				this.gfx.circle(p.x, p.y, DOT_RADIUS).fill({ color: VIOLET });
			}
			return;
		}
		for (const p of dots) {
			this.gfx.circle(p.x, p.y, DOT_RADIUS).fill({ color: VIOLET });
		}
		if (landing) {
			this.gfx.circle(landing.x, landing.y, LANDING_RADIUS).fill({
				color: VIOLET,
			});
		}
	}

	/** Hide it immediately — a respawn, or a match reset. */
	reset() {
		this.alpha = 0;
		this.gfx.alpha = 0;
		this.gfx.visible = false;
		this.gfx.clear();
		this.keyed = false;
	}

	destroy() {
		this.gfx.destroy();
	}
}

/**
 * Trace the grenade's arc on this angle, stopping where a grenade would stop.
 *
 * The same integration `tickGrenade` runs: gravity applied first, then
 * position, with the fuse counted in steps. The end conditions restate
 * `grenadeEnd` — a platform (or the floor of the world), a wall, the fuse
 * running out mid-air — so the preview and the throw agree on where the hole
 * will open.
 */
function traceArc(
	x0: number,
	y0: number,
	angle: number,
	world: World,
): { x: number; y: number }[] {
	const points: { x: number; y: number }[] = [];
	let x = x0;
	let y = y0;
	const vx = Math.cos(angle) * GRENADE_SPEED;
	let vy = Math.sin(angle) * GRENADE_SPEED;
	let fuseMs = GRENADE_FUSE_MS;

	points.push({ x, y });

	while (fuseMs > 0) {
		vy += GRENADE_GRAVITY * TRACE_DT;
		x += vx * TRACE_DT;
		y += vy * TRACE_DT;
		fuseMs -= TRACE_DT * 1000;

		if (x < world.left - 40 || x > world.right + 40) break;
		if (y > world.bottom + 80) break;
		points.push({ x, y });
		if (pointInAnyPlatform(x, y, world)) break;
	}
	return points;
}

/**
 * The storm's ring: the blast radius as a circle of dots around the caster.
 *
 * The radius is the one piece of information a radial ultimate has to give —
 * "whoever stands in this circle, when the button comes up, is in the storm"
 * — so this traces exactly `BLOSSOM_RADIUS_PX`, the number the simulation
 * damages against. The dots are spaced a couple of body-widths apart; dense
 * enough to read as a circle, sparse enough to see the fighters through.
 */
function traceRing(cx: number, cy: number): { x: number; y: number }[] {
	const dots: { x: number; y: number }[] = [];
	const count = 40;
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2;
		dots.push({
			x: cx + Math.cos(a) * BLOSSOM_RADIUS_PX,
			y: cy + Math.sin(a) * BLOSSOM_RADIUS_PX,
		});
	}
	return dots;
}

/**
 * Trace the dragon's straight line on this angle, stopping where the dragon
 * would stop.
 *
 * The dragon rides until an obstacle — the same end condition `tickPlayer`
 * applies (a wall, the ceiling, or a floor met while moving downward) — so
 * the preview walks the line step by step and stops at the first solid. The
 * ride's 900ms cap is the same cap the simulation has, so a line across an
 * open arena ends where the ride would.
 *
 * The **minimum commitment** is the same one the ride has: a launch that
 * starts against the obstacle in its own direction (a grounded caster aiming
 * at the floor, a fighter against the wall) cannot be a zero-length cast —
 * the dragon always shows the lunge before the solid claims it. The preview
 * draws that too, so the beam never promises a stop earlier than the cast
 * delivers.
 */
function traceBeam(
	x0: number,
	y0: number,
	angle: number,
	world: World,
): { x: number; y: number }[] {
	const points: { x: number; y: number }[] = [];
	let x = x0;
	let y = y0;
	const vx = Math.cos(angle) * DRAGON_SPEED;
	const vy = Math.sin(angle) * DRAGON_SPEED;
	let rideMs = DRAGON_RIDE_MS;

	points.push({ x, y });

	while (rideMs > 0) {
		x += vx * TRACE_DT;
		y += vy * TRACE_DT;
		rideMs -= TRACE_DT * 1000;
		const elapsedMs = DRAGON_RIDE_MS - rideMs;
		const hitSolid =
			pointInAnyPlatform(x, y, world) ||
			x < world.left ||
			x > world.right ||
			y < world.top ||
			y > world.bottom;
		points.push({ x, y });
		if (hitSolid && elapsedMs >= DRAGON_MIN_RIDE_MS) break;
	}
	return points;
}
