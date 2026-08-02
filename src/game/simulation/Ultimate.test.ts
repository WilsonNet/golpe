/**
 * The ultimate's simulation half.
 *
 * These are the checks a probe cannot make cheaply: exact grip boundaries,
 * determinism under replay, and the friendly-fire predicate. The *behaviour* —
 * does a cast freeze both clients, does the hole catch anybody — is measured
 * online by `scripts/ultimate-probe.mjs`, because a unit test of a networked
 * feature proves only that the unit is fine.
 */

import { describe, expect, it } from "vitest";
import { buildWorld } from "./Arena.js";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics.js";
import {
	addCharge,
	fieldAffects,
	fieldFor,
	GRENADE_FUSE_MS,
	grenadeEnd,
	grenadeTouches,
	launchGrenade,
	SINGULARITY_DURATION_MS,
	SINGULARITY_RADIUS,
	SINGULARITY_REACH,
	type Singularity,
	singularityGrip,
	tickGrenade,
	ULT_MAX_CHARGE,
	ultReady,
} from "./Ultimate.js";

const DT = 1 / 60;
const WORLD = buildWorld(1);

function hole(x: number, y: number, ownerId = "caster"): Singularity {
	return { id: 1, ownerId, x, y, remainingMs: SINGULARITY_DURATION_MS };
}

/** A body whose *centre* sits at (x, y), which is the space the field works in. */
function bodyAtCentre(x: number, y: number): PlayerPosition {
	return createPlayerState(x - 16, y - 24);
}

const IDLE: PlayerIntent = { ...NEUTRAL_INTENT };

describe("charge", () => {
	it("clamps to the meter at both ends", () => {
		expect(addCharge(0, -50)).toBe(0);
		expect(addCharge(90, 90)).toBe(ULT_MAX_CHARGE);
	});

	it("is only ready at a full meter", () => {
		expect(ultReady(ULT_MAX_CHARGE - 0.01)).toBe(false);
		expect(ultReady(ULT_MAX_CHARGE)).toBe(true);
	});
});

describe("friendly fire", () => {
	it("never affects the caster", () => {
		const field = hole(400, 300, "me");
		expect(fieldAffects(field, "me")).toBe(false);
		expect(fieldFor(field, "me")).toBeNull();
	});

	it("affects everybody else", () => {
		const field = hole(400, 300, "me");
		expect(fieldAffects(field, "them")).toBe(true);
		expect(fieldFor(field, "them")).toBe(field);
	});

	it("means the caster is not gripped even standing dead centre", () => {
		const field = hole(400, 300, "me");
		expect(singularityGrip(fieldFor(field, "me"), 384, 276)).toBe("clear");
		expect(singularityGrip(fieldFor(field, "them"), 384, 276)).toBe("held");
	});
});

describe("grip bands", () => {
	const field = hole(400, 300);

	it("holds at the centre and just inside the horizon", () => {
		expect(singularityGrip(field, 384, 276)).toBe("held");
		const body = bodyAtCentre(400 + SINGULARITY_RADIUS - 1, 300);
		expect(singularityGrip(field, body.x, body.y)).toBe("held");
	});

	it("only tugs just outside the horizon", () => {
		const body = bodyAtCentre(400 + SINGULARITY_RADIUS + 1, 300);
		expect(singularityGrip(field, body.x, body.y)).toBe("fringe");
	});

	it("does nothing past the outer reach", () => {
		const body = bodyAtCentre(400 + SINGULARITY_REACH + 1, 300);
		expect(singularityGrip(field, body.x, body.y)).toBe("clear");
	});

	it("measures from the body's centre, not its corner", () => {
		// Approaching from the left, the top-left corner is 178px out — past the
		// horizon — while the centre it actually stands on is 162px out and caught.
		// Getting this wrong is half a body of error, and it reads as the hole
		// grabbing people who are standing outside it.
		const body = { x: 400 - SINGULARITY_RADIUS - 10, y: 300 - 24 };
		expect(Math.abs(body.x - 400)).toBeGreaterThan(SINGULARITY_RADIUS);
		expect(singularityGrip(field, body.x, body.y)).toBe("held");
	});
});

describe("the pull, through tickPlayer", () => {
	it("drags a held fighter toward the centre", () => {
		const field = hole(400, 300);
		let s = bodyAtCentre(400 + 120, 300);
		const before = s.x;
		for (let i = 0; i < 20; i++) s = tickPlayer(s, IDLE, DT, WORLD, field);
		expect(s.x).toBeLessThan(before - 40);
	});

	it("suspends gravity on a held fighter", () => {
		// Level with the hole and in mid-air: without the suspension this fighter
		// would gain hundreds of px/s of downward velocity over a third of a second.
		const field = hole(400, 300);
		let s = bodyAtCentre(400 + 100, 300);
		for (let i = 0; i < 20; i++) s = tickPlayer(s, IDLE, DT, WORLD, field);
		expect(Math.abs(s.vy)).toBeLessThan(40);
	});

	it("disables a held fighter", () => {
		const field = hole(400, 300);
		const s = tickPlayer(bodyAtCentre(400, 300), IDLE, DT, WORLD, field);
		expect(s.stunTimer).toBeGreaterThan(0);
	});

	it("leaves a fighter on the fringe in control", () => {
		const field = hole(400, 300);
		const at = bodyAtCentre(400 + SINGULARITY_RADIUS + 40, 300);
		const s = tickPlayer(at, IDLE, DT, WORLD, field);
		expect(s.stunTimer).toBe(0);
	});

	it("lets a dash beat the fringe tug", () => {
		// The counterplay, stated as a test: a walk loses ground near the lip and a
		// dash does not. If the tug is ever tuned past the dash this fails, which is
		// exactly when somebody needs to be told.
		const field = hole(400, 300);
		const start = 400 + SINGULARITY_RADIUS + 20;
		let walking = bodyAtCentre(start, 300);
		let dashing = bodyAtCentre(start, 300);
		const away: PlayerIntent = { ...IDLE, right: true };
		const dash: PlayerIntent = { ...IDLE, right: true, dash: 1 };
		walking = tickPlayer(walking, away, DT, WORLD, field);
		dashing = tickPlayer(dashing, dash, DT, WORLD, field);
		for (let i = 0; i < 9; i++) {
			walking = tickPlayer(walking, away, DT, WORLD, field);
			dashing = tickPlayer(dashing, away, DT, WORLD, field);
		}
		expect(dashing.x).toBeGreaterThan(walking.x);
		expect(singularityGrip(field, dashing.x, dashing.y)).toBe("clear");
	});

	it("never drags anybody through the floor", () => {
		// A hole opened below the ground still has to obey collision, or it becomes
		// a way to delete fighters.
		const field = hole(400, WORLD.bottom + 60);
		let s = createPlayerState(384, 480);
		for (let i = 0; i < 90; i++) s = tickPlayer(s, IDLE, DT, WORLD, field);
		expect(s.y + 48).toBeLessThanOrEqual(WORLD.bottom + 1);
	});

	it("changes nothing at all when the field is null", () => {
		// The whole feature has to be invisible to every existing test and every
		// existing caller, which is why `field` defaults to null.
		let withNull = createPlayerState(100, 300);
		let without = createPlayerState(100, 300);
		for (let i = 0; i < 60; i++) {
			withNull = tickPlayer(withNull, IDLE, DT, WORLD, null);
			without = tickPlayer(without, IDLE, DT, WORLD);
		}
		expect(withNull).toEqual(without);
	});

	it("is deterministic under replay", () => {
		// The property the whole netcode rests on: the same state, input, dt and
		// field must replay to a bit-identical result, or reconciliation would fight
		// the pull forever.
		const field = hole(400, 300);
		const inputs: PlayerIntent[] = Array.from({ length: 40 }, (_, i) => ({
			...IDLE,
			right: i % 3 === 0,
			up: i % 7 === 0,
		}));
		const run = () => {
			let s = bodyAtCentre(400 + 200, 260);
			for (const input of inputs) s = tickPlayer(s, input, DT, WORLD, field);
			return s;
		};
		expect(run()).toEqual(run());
	});
});

describe("the grenade", () => {
	it("arcs: it loses height it was thrown with", () => {
		const g = launchGrenade(0, "me", 100, 300, -Math.PI / 4);
		const rising = g.vy;
		for (let i = 0; i < 60; i++) tickGrenade(g, DT);
		expect(rising).toBeLessThan(0);
		expect(g.vy).toBeGreaterThan(0);
		expect(g.x).toBeGreaterThan(100);
	});

	it("detonates on a platform", () => {
		// Straight down into the floor.
		const g = launchGrenade(0, "me", 400, 300, Math.PI / 2);
		let end = grenadeEnd(g, WORLD, false);
		for (let i = 0; i < 120 && end === null; i++) {
			tickGrenade(g, DT);
			end = grenadeEnd(g, WORLD, false);
		}
		expect(end).toBe("platform");
	});

	it("detonates when its fuse runs out", () => {
		// Thrown flat into open air along the top of the arena, so nothing else can
		// end it first.
		const g = launchGrenade(0, "me", 60, 120, 0);
		g.vy = 0;
		let end: ReturnType<typeof grenadeEnd> = null;
		for (let i = 0; i < 200 && end === null; i++) {
			// Gravity is what would otherwise put it in the floor before the fuse.
			g.fuseMs -= DT * 1000;
			g.x += 40 * DT;
			end = grenadeEnd(g, WORLD, false);
		}
		expect(end).toBe("fuse");
		expect(g.fuseMs).toBeLessThanOrEqual(0);
	});

	it("fizzles out of the top of the world and nowhere else", () => {
		const up = launchGrenade(0, "me", 400, 300, -Math.PI / 2);
		up.y = WORLD.top - 100;
		expect(grenadeEnd(up, WORLD, false)).toBe("fizzle");
	});

	it("passes through the caster and stops on anybody else", () => {
		const g = launchGrenade(0, "me", 400, 300, 0);
		expect(grenadeTouches(g, "me", 390, 280)).toBe(false);
		expect(grenadeTouches(g, "you", 390, 280)).toBe(true);
		expect(grenadeTouches(g, "you", 700, 280)).toBe(false);
	});

	it("carries a fuse long enough to cross most of a screen", () => {
		// Intent, not an implementation detail: a grenade whose fuse expired before
		// it could reach anybody would make the ability a self-detonation.
		const g = launchGrenade(0, "me", 40, 300, -0.35);
		for (let i = 0; i < Math.round((GRENADE_FUSE_MS / 1000) * 60); i++) {
			tickGrenade(g, DT);
		}
		expect(g.x - 40).toBeGreaterThan(500);
	});
});
