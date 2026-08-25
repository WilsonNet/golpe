/**
 * The ultimate's simulation half.
 *
 * These are the checks a probe cannot make cheaply: exact grip boundaries,
 * determinism under replay, and the friendly-fire predicate. The *behaviour* —
 * does a cast freeze both clients, does the hole catch anybody — is measured
 * online by `scripts/ultimate-probe.ts`, because a unit test of a networked
 * feature proves only that the unit is fine.
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { buildWorld } from "./Arena.js";
import { kitFor } from "./Heroes.js";
import { applyHitToDefender, type MeleeResult } from "./Melee.js";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	PLAYER_HEIGHT,
	PLAYER_WALK_SPEED,
	PLAYER_WIDTH,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics.js";
import type { TeamId } from "./Teams.js";
import {
	addCharge,
	BLOSSOM_DURATION_MS,
	BLOSSOM_RADIUS_PX,
	BLOSSOM_TICK_DAMAGE,
	blossomAffects,
	blossomSweeps,
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
	ultCap,
	ultChargeMultiplier,
	ultReady,
} from "./Ultimate.js";

const DT = 1 / 60;
const WORLD = buildWorld(1);

function hole(
	x: number,
	y: number,
	ownerId = "caster",
	ownerTeam: TeamId | null = null,
): Singularity {
	return {
		id: 1,
		ownerId,
		ownerTeam,
		x,
		y,
		remainingMs: SINGULARITY_DURATION_MS,
	};
}

/** A body whose *centre* sits at (x, y), which is the space the field works in. */
function bodyAtCentre(x: number, y: number): PlayerPosition {
	return createPlayerState(x - 16, y - 24);
}

const IDLE: PlayerIntent = { ...NEUTRAL_INTENT };

describe("the Death Blossom", () => {
	const blossom = () => ({
		id: 1,
		ownerId: "caster",
		ownerTeam: null,
		x: 400,
		y: 300,
		remainingMs: BLOSSOM_DURATION_MS,
	});

	it("hostility is the caster's team's: never the caster, never a teammate", () => {
		const b = blossom();
		expect(blossomAffects(b, "caster", null)).toBe(false);
		expect(blossomAffects(b, "foe", null)).toBe(true);

		const team = { ...b, ownerTeam: 0 as TeamId };
		expect(blossomAffects(team, "teammate", 0)).toBe(false);
		expect(blossomAffects(team, "foe", 1)).toBe(true);
		// In a free-for-all every fighter is null, so everyone but the caster.
		expect(blossomAffects(team, "other", null)).toBe(true);
	});

	it("sweeps only what is inside the radius with a corridor", () => {
		const b = blossom();
		// Inside the ring, same floor: swept.
		expect(blossomSweeps(b, "foe", null, 400 - 16, 300 - 24, WORLD)).toBe(true);
		// Beyond the radius: clear.
		expect(
			blossomSweeps(
				b,
				"foe",
				null,
				400 - 16 - BLOSSOM_RADIUS_PX - 60,
				300 - 24,
				WORLD,
			),
		).toBe(false);
		// A platform between the storm and the fighter blocks the shots.
		// The default arena has a platform above the floor; put the foe up
		// there with a solid between and the sweep refuses.
		expect(blossomSweeps(b, "foe", null, 400 - 16, 60, WORLD)).toBe(false);
	});

	it("the channel lives in PlayerPosition: walk halved, no dash, no jump", () => {
		const kit = kitFor("jeffs");
		let s = createPlayerState(400, 480);
		s = tickPlayer(s, NEUTRAL_INTENT, DT, WORLD, null, kit);
		s.grounded = true;
		s.blossomTimer = BLOSSOM_DURATION_MS;
		s.vx = 0;

		// Walk speed is halved while the storm runs: the fighter accelerates
		// toward the slowed target, not the full walk.
		const walking = tickPlayer(
			s,
			{ ...NEUTRAL_INTENT, right: true },
			DT,
			WORLD,
			null,
			kit,
		);
		expect(walking.vx).toBeGreaterThan(0);
		expect(walking.vx).toBeLessThan(PLAYER_WALK_SPEED * DT * 2600);

		// No jump: the buffer never arms.
		const jumping = tickPlayer(
			s,
			{ ...NEUTRAL_INTENT, up: true },
			DT,
			WORLD,
			null,
			kit,
		);
		expect(jumping.jumpBufferTimer).toBe(0);

		// No dash: the impulse is refused.
		const dashing = tickPlayer(
			s,
			{ ...NEUTRAL_INTENT, dash: 1 },
			DT,
			WORLD,
			null,
			kit,
		);
		expect(dashing.dashActiveTimer).toBe(0);
	});

	it("an air cast stops in the air: the channel suspends gravity", () => {
		const kit = kitFor("jeffs");
		// Airborne, well above the floor at y=568: the first tick proves it.
		let s = createPlayerState(400, 300);
		s = tickPlayer(s, NEUTRAL_INTENT, DT, WORLD, null, kit);
		expect(s.grounded).toBe(false);
		s.vy = 400;
		s.blossomTimer = BLOSSOM_DURATION_MS;

		// The fall is stopped: vy pinned to zero, the height held for the
		// whole channel — Reaper's hover, so an air cast stays an air cast.
		const hovering = tickPlayer(s, NEUTRAL_INTENT, DT, WORLD, null, kit);
		expect(hovering.vy).toBe(0);
		expect(hovering.y).toBe(s.y);

		// The moment the channel ends, gravity takes the caster back.
		const after = { ...s, blossomTimer: 0 };
		const falling = tickPlayer(after, NEUTRAL_INTENT, DT, WORLD, null, kit);
		expect(falling.vy).toBeGreaterThan(0);
		expect(falling.y).toBeGreaterThan(s.y);
	});

	it("a knockdown ends the channel; a plain hitstun does not", () => {
		const kit = kitFor("jeffs");
		let s = createPlayerState(400, 480);
		s = tickPlayer(s, NEUTRAL_INTENT, DT, WORLD, null, kit);
		s.blossomTimer = BLOSSOM_DURATION_MS;

		// The finisher's knockdown (the move with `knockdown: true`) zeroes it.
		const finisher: MeleeResult = {
			move: "slash3",
			outcome: "hit",
			damage: 11,
			x: 400,
			y: 480,
			dir: 1,
		};
		applyHitToDefender(s, finisher);
		expect(s.blossomTimer).toBe(0);

		// The opener's ordinary hitstun leaves the storm running.
		s.blossomTimer = BLOSSOM_DURATION_MS;
		const slash: MeleeResult = {
			move: "slash",
			outcome: "hit",
			damage: 7,
			x: 400,
			y: 480,
			dir: -1,
		};
		applyHitToDefender(s, slash);
		expect(s.blossomTimer).toBe(BLOSSOM_DURATION_MS);
	});

	it("the channel decays on both sides and feeds no meter", () => {
		const kit = kitFor("jeffs");
		let s = createPlayerState(400, 480);
		s = tickPlayer(s, NEUTRAL_INTENT, DT, WORLD, null, kit);
		s.blossomTimer = BLOSSOM_DURATION_MS;
		const next = tickPlayer(s, NEUTRAL_INTENT, DT, WORLD, null, kit);
		expect(next.blossomTimer).toBeLessThan(s.blossomTimer);
		// The damage stat is the server's — the shared state only carries the
		// channel, and the constant it damages against exists for the server.
		expect(BLOSSOM_TICK_DAMAGE).toBeGreaterThan(0);
	});
});

describe("charge", () => {
	it("clamps to the meter at both ends", () => {
		expect(addCharge(0, -50)).toBe(0);
		expect(addCharge(90, 90)).toBe(ULT_MAX_CHARGE);
	});

	it("is only ready at a full meter", () => {
		expect(ultReady(ULT_MAX_CHARGE - 0.01)).toBe(false);
		expect(ultReady(ULT_MAX_CHARGE)).toBe(true);
	});

	it("arms each ultimate at its own cap — the blossom is the cheap one", () => {
		expect(ultCap("black-hole")).toBe(ULT_MAX_CHARGE);
		expect(ultCap("dragon-thrust")).toBe(ULT_MAX_CHARGE);
		expect(ultCap("death-blossom")).toBeLessThan(ULT_MAX_CHARGE);
		// Armed is the hero's own cap, not a hard-coded full meter.
		expect(
			ultReady(ultCap("death-blossom") - 0.01, ultCap("death-blossom")),
		).toBe(false);
		expect(ultReady(ultCap("death-blossom"), ultCap("death-blossom"))).toBe(
			true,
		);
		// And the cap bounds the meter, so a blossom cannot overfill past it.
		expect(addCharge(0, 1000, ultCap("death-blossom"))).toBe(
			ultCap("death-blossom"),
		);
	});

	it("charges the blossom faster per source, and everything else at parity", () => {
		expect(ultChargeMultiplier("black-hole")).toBe(1);
		expect(ultChargeMultiplier("dragon-thrust")).toBe(1);
		expect(ultChargeMultiplier("death-blossom")).toBeGreaterThan(1);
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

	it("never affects the caster's own side", () => {
		// The pull is an argument to `tickPlayer` on both sides of the wire, so a
		// disagreement here is not a scoring bug — it is a client dragging its own
		// teammates somewhere the server is not.
		const field = hole(400, 300, "me", 0);
		expect(fieldAffects(field, "ally", 0)).toBe(false);
		expect(fieldFor(field, "ally", 0)).toBeNull();
		expect(fieldAffects(field, "enemy", 1)).toBe(true);
		expect(fieldFor(field, "enemy", 1)).toBe(field);
	});

	it("affects everybody when there are no sides", () => {
		const field = hole(400, 300, "me");
		expect(fieldAffects(field, "them", null)).toBe(true);
	});

	it("passes a thrown grenade straight through a teammate", () => {
		// A lob that detonated on the ally it was thrown over would make the
		// ultimate a way to lose the round.
		const g = launchGrenade(0, "me", 400, 300, 0, 0);
		expect(grenadeTouches(g, "ally", 390, 280, 0)).toBe(false);
		expect(grenadeTouches(g, "enemy", 390, 280, 1)).toBe(true);
	});

	it("means the caster is not gripped even standing dead centre", () => {
		const field = hole(400, 300, "me");
		expect(singularityGrip(fieldFor(field, "me"), 384, 276)).toBe("clear");
		expect(singularityGrip(fieldFor(field, "them"), 384, 276)).toBe("held");
	});

	/**
	 * The friendly-fire rule is written once — never the caster, never a
	 * teammate — and every weapon asks it. Swept over arbitrary ids and teams,
	 * the hole, the blossom and the grenade must all agree about whose side a
	 * fighter is on; the one place the rule lives keeps them from drifting.
	 */
	test.prop([
		fc.constantFrom("me", "them", "ally", "enemy"),
		fc.constantFrom(null, 0 as TeamId, 1 as TeamId),
		fc.constantFrom("me", "them", "ally", "enemy"),
		fc.constantFrom(null, 0 as TeamId, 1 as TeamId),
	])(
		"the hole, the blossom and the grenade agree about hostility",
		(ownerId, ownerTeam, fighterId, fighterTeam) => {
			const field = hole(400, 300, ownerId, ownerTeam);
			const hostile = fieldAffects(field, fighterId, fighterTeam);

			// The blossom is pure hostility — no geometry to confound it.
			expect(
				blossomAffects(
					{
						id: 1,
						ownerId,
						ownerTeam,
						x: 400,
						y: 300,
						remainingMs: BLOSSOM_DURATION_MS,
					},
					fighterId,
					fighterTeam,
				),
			).toBe(hostile);

			// The grenade, dead-centre on the fighter so only the side rule can
			// change the answer.
			const g = launchGrenade(0, ownerId, 400, 300, 0, ownerTeam);
			expect(grenadeTouches(g, fighterId, 400, 300, fighterTeam)).toBe(hostile);
		},
	);
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

	/**
	 * The bands are a pure partition of the plane by distance from the centre:
	 * held inside the horizon, fringe between the horizon and the outer reach,
	 * clear beyond. Swept over arbitrary body offsets, this catches an off-by-one
	 * or a gap where a fighter is neither held nor clearly free.
	 */
	test.prop([
		fc.integer({ min: -500, max: 500 }),
		fc.integer({ min: -500, max: 500 }),
	])("is a contiguous partition by distance from the centre", (ox, oy) => {
		// A body whose top-left is offset (ox, oy) from the hole's centre — the
		// same coordinate the grip function measures from (its own centre).
		const bodyX = field.x + ox - PLAYER_WIDTH / 2;
		const bodyY = field.y + oy - PLAYER_HEIGHT / 2;
		const cx = bodyX + PLAYER_WIDTH / 2;
		const cy = bodyY + PLAYER_HEIGHT / 2;
		const distSq = (field.x - cx) ** 2 + (field.y - cy) ** 2;

		const grip = singularityGrip(field, bodyX, bodyY);
		if (distSq <= SINGULARITY_RADIUS * SINGULARITY_RADIUS) {
			expect(grip).toBe("held");
		} else if (distSq <= SINGULARITY_REACH * SINGULARITY_REACH) {
			expect(grip).toBe("fringe");
		} else {
			expect(grip).toBe("clear");
		}
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
