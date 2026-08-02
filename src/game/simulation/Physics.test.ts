import { describe, expect, it } from "vitest";
import {
	GROUND,
	LOW_LEFT,
	MID,
	narrowGaps,
	PILLAR_LEFT,
	PILLAR_RIGHT,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	penetrationDepth,
	platforms,
} from "./Arena.js";
import {
	AIR_JUMP_VELOCITY,
	AIR_JUMPS,
	COYOTE_TIME_MS,
	createPlayerState,
	DASH_DURATION_MS,
	DASH_SPEED,
	FALL_GRAVITY_MULTIPLIER,
	GRAVITY,
	JUMP_BUFFER_MS,
	JUMP_CUT_MULTIPLIER,
	JUMP_HEIGHT_PX,
	JUMP_VELOCITY,
	MAX_FALL_SPEED,
	MOVES,
	meleePhase,
	NEUTRAL_INTENT,
	PLAYER_WALK_SPEED,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
	WALL_JUMP_HORIZONTAL,
	WALL_JUMP_LOCKOUT,
	WALL_JUMP_VERTICAL,
	WALL_SLIDE_SPEED,
	WORLD_RIGHT,
} from "./Physics.js";

const DT = 1 / 60;

// Surfaces are imported by name. They used to be looked up by index with the
// coordinates copied into a trailing comment, which had already drifted: the
// comments claimed the pillars sat at x=250 and x=526 long after they moved to
// 280 and 496 to close a fighter-trapping gap.
const PILLAR_L = PILLAR_LEFT;
const PILLAR_R = PILLAR_RIGHT;
/**
 * Clear stretch of ground for movement tests: far enough left that no ledge
 * overhangs it and no pillar blocks the run-up.
 */
const OPEN_X = 20;

/** Y a player rests at when standing on top of `platformY`. */
const standingOn = (platformY: number) => platformY - PLAYER_HEIGHT;

function state(overrides: Partial<PlayerPosition> = {}): PlayerPosition {
	return { ...createPlayerState(0, 0), ...overrides };
}

function input(overrides: Partial<PlayerIntent> = {}): PlayerIntent {
	return { ...NEUTRAL_INTENT, ...overrides };
}

function tick(
	p: PlayerPosition,
	i: Partial<PlayerIntent> = {},
	dt = DT,
): PlayerPosition {
	return tickPlayer(p, input(i), dt);
}

function ticks(
	p: PlayerPosition,
	i: Partial<PlayerIntent> = {},
	n = 1,
): PlayerPosition {
	let r = p;
	for (let k = 0; k < n; k++) r = tick(r, i);
	return r;
}

/** Run until `done`, returning the state and how many ticks it took. */
function until(
	p: PlayerPosition,
	i: Partial<PlayerIntent>,
	done: (s: PlayerPosition) => boolean,
	limit = 600,
): { state: PlayerPosition; ticks: number } {
	let s = p;
	for (let k = 0; k < limit; k++) {
		s = tick(s, i);
		if (done(s)) return { state: s, ticks: k + 1 };
	}
	return { state: s, ticks: limit };
}

describe("gravity & ground", () => {
	it("applies gravity each tick", () => {
		const r = tick(state({ x: 300, y: 100 }));
		expect(r.vy).toBeCloseTo(GRAVITY * DT, 6);
		expect(r.y).toBeCloseTo(100 + GRAVITY * DT * DT, 6);
	});

	it("falls faster than it rises", () => {
		const falling = tick(state({ x: 300, y: 100, vy: 10 }));
		expect(falling.vy).toBeCloseTo(
			10 + GRAVITY * FALL_GRAVITY_MULTIPLIER * DT,
			6,
		);
	});

	it("clamps to terminal velocity", () => {
		const r = ticks(state({ x: 300, y: 0, vy: MAX_FALL_SPEED }), {}, 5);
		expect(r.vy).toBeLessThanOrEqual(MAX_FALL_SPEED);
	});

	it("lands on the ground platform", () => {
		const r = tick(state({ x: OPEN_X, y: standingOn(GROUND.y) - 1, vy: 300 }));
		expect(r.grounded).toBe(true);
		expect(r.y).toBe(standingOn(GROUND.y));
		expect(r.vy).toBe(0);
	});

	it("lands on a floating platform", () => {
		const r = tick(
			state({ x: LOW_LEFT.x + 10, y: standingOn(LOW_LEFT.y) - 1, vy: 200 }),
		);
		expect(r.grounded).toBe(true);
		expect(r.y).toBe(standingOn(LOW_LEFT.y));
		expect(r.vy).toBe(0);
	});

	it("stops dead against a ceiling instead of passing through", () => {
		const r = ticks(
			state({ x: MID.x + 20, y: MID.y + MID.h + 4, vy: -700 }),
			{},
			4,
		);
		expect(r.y).toBeGreaterThanOrEqual(MID.y + MID.h);
		expect(penetrationDepth(r.x, r.y)).toBe(0);
	});
});

describe("jump feel", () => {
	it("ground jump launches upward", () => {
		const r = tick(
			state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true }),
			{
				up: true,
			},
		);
		expect(r.vy).toBeCloseTo(JUMP_VELOCITY + GRAVITY * DT, 6);
		expect(r.grounded).toBe(false);
	});

	it("a held jump clears the designed height", () => {
		const start = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });
		let s = tick(start, { up: true });
		let peak = s.y;
		for (let k = 0; k < 200 && !s.grounded; k++) {
			s = tick(s, { up: true });
			peak = Math.min(peak, s.y);
		}
		const rise = start.y - peak;
		expect(rise).toBeGreaterThan(JUMP_HEIGHT_PX * 0.9);
		expect(rise).toBeLessThanOrEqual(JUMP_HEIGHT_PX);
	});

	it("releasing jump early cuts the arc short", () => {
		const start = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });
		let s = tick(start, { up: true });
		s = ticks(s, { up: true }, 4);
		const risingVy = s.vy;
		const cut = tick(s, {});
		expect(cut.vy).toBeGreaterThan(risingVy * JUMP_CUT_MULTIPLIER * 0.99);
		expect(Math.abs(cut.vy)).toBeLessThan(Math.abs(risingVy));
	});

	it("a short hop is meaningfully lower than a full jump", () => {
		const start = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });

		const apex = (held: number) => {
			let s = tick(start, { up: true });
			let peak = s.y;
			for (let k = 0; k < 200 && !s.grounded; k++) {
				s = tick(s, { up: k < held });
				peak = Math.min(peak, s.y);
			}
			return start.y - peak;
		};

		expect(apex(3)).toBeLessThan(apex(60) * 0.75);
	});

	it("cannot jump in mid-air once the air jump is spent", () => {
		const r = tick(state({ x: 300, y: 100, vy: 100, airJumps: 0 }), {
			up: true,
		});
		expect(r.vy).toBeCloseTo(100 + GRAVITY * FALL_GRAVITY_MULTIPLIER * DT, 6);
	});

	it("coyote time lets you jump just after leaving a ledge", () => {
		const r = tick(
			state({ x: 300, y: 300, grounded: false, coyoteTimer: COYOTE_TIME_MS }),
			{ up: true },
		);
		expect(r.vy).toBeCloseTo(JUMP_VELOCITY + GRAVITY * DT, 6);
	});

	it("coyote time expires", () => {
		const stale = ticks(
			// Air jump already spent, so this measures coyote time and nothing else.
			state({ x: 300, y: 200, coyoteTimer: COYOTE_TIME_MS, airJumps: 0 }),
			{},
			Math.ceil(COYOTE_TIME_MS / (DT * 1000)) + 1,
		);
		expect(stale.coyoteTimer).toBe(0);
		const r = tick(stale, { up: true });
		expect(r.vy).toBeGreaterThan(0);
	});

	/**
	 * The buffer and the air jump want the same press, and the air jump wins.
	 *
	 * That is the honest resolution: a press in the air should always do something
	 * *now*, and a player who still has a double jump is not asking to land. The
	 * buffer keeps its job for the case it was built for — a press while falling
	 * with nothing left to spend.
	 */
	it("a jump pressed just before landing is buffered, once the air jump is spent", () => {
		// Press while still falling, then release: the press must survive to the ground.
		let s = state({
			x: OPEN_X,
			y: standingOn(GROUND.y) - 30,
			vy: 400,
			airJumps: 0,
		});
		s = tick(s, { up: true });
		expect(s.jumpBufferTimer).toBeGreaterThan(0);
		expect(s.grounded).toBe(false);

		const landed = until(s, {}, (p) => p.grounded);
		expect(landed.state.grounded).toBe(true);

		const afterLanding = tick(landed.state, {});
		expect(afterLanding.vy).toBeLessThan(0);
	});

	it("does not buffer a jump held from before (needs a fresh press)", () => {
		const r = tick(state({ x: 300, y: 300, jumpHeld: true }), { up: true });
		expect(r.jumpBufferTimer).toBe(0);
	});

	it("air jump launches from a standing fall", () => {
		const r = tick(state({ x: 300, y: 100, vy: 200 }), { up: true });
		expect(r.airJumps).toBe(0);
		expect(r.vy).toBeCloseTo(AIR_JUMP_VELOCITY + GRAVITY * DT, 6);
	});

	it("gives exactly one air jump, not a flight mode", () => {
		let s = state({ x: 300, y: 100, vy: 200 });
		// Press, release, press again — two distinct gestures.
		s = tick(s, { up: true });
		expect(s.airJumps).toBe(0);
		s = tick(s, {});
		const before = s.vy;
		s = tick(s, { up: true });
		expect(s.vy).toBeGreaterThan(before);
	});

	it("is weaker than a ground jump, so timing the first one still matters", () => {
		expect(Math.abs(AIR_JUMP_VELOCITY)).toBeLessThan(Math.abs(JUMP_VELOCITY));
	});

	it("comes back on landing", () => {
		let s = state({ x: OPEN_X, y: standingOn(GROUND.y) - 40, vy: 300 });
		s = tick(s, { up: true });
		expect(s.airJumps).toBe(0);
		s = until(s, {}, (p) => p.grounded).state;
		expect(s.airJumps).toBe(AIR_JUMPS);
	});

	/**
	 * A wall jump must **not** refill it, or a fighter alternates the two up a
	 * single flat wall forever.
	 */
	it("is not refilled by a wall jump", () => {
		const s = tick(
			state({
				x: 300,
				y: 200,
				vy: 100,
				airJumps: 0,
				wallTouch: "left",
				wallCoyoteTimer: 50,
			}),
			{ up: true },
		);
		expect(s.vy).toBeCloseTo(WALL_JUMP_VERTICAL + GRAVITY * DT, 6);
		expect(s.airJumps).toBe(0);
	});

	it("prefers the ground jump when both are available", () => {
		const s = tick(
			state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true }),
			{ up: true },
		);
		expect(s.vy).toBeCloseTo(JUMP_VELOCITY + GRAVITY * DT, 6);
		// The ground jump must not have spent the air jump on the way out.
		expect(s.airJumps).toBe(AIR_JUMPS);
	});

	it("can be cut short like any other jump", () => {
		let s = tick(state({ x: 300, y: 200, vy: 100 }), { up: true });
		const rising = s.vy;
		s = tick(s, {});
		expect(s.vy).toBeGreaterThan(rising * JUMP_CUT_MULTIPLIER * 0.99);
		expect(Math.abs(s.vy)).toBeLessThan(Math.abs(rising));
	});

	it("buffer expires if you never land", () => {
		const r = ticks(
			state({ x: 300, y: 100, jumpBufferTimer: JUMP_BUFFER_MS }),
			{},
			Math.ceil(JUMP_BUFFER_MS / (DT * 1000)) + 1,
		);
		expect(r.jumpBufferTimer).toBe(0);
	});
});

describe("horizontal movement", () => {
	it("accelerates toward walk speed rather than snapping", () => {
		const first = tick(
			state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true }),
			{ right: true },
		);
		expect(first.vx).toBeGreaterThan(0);
		expect(first.vx).toBeLessThan(PLAYER_WALK_SPEED);
	});

	it("reaches exactly walk speed and stays there", () => {
		// Stay inside the clear span between the pillars so nothing blocks the run.
		const r = ticks(
			state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true }),
			{ right: true },
			30,
		);
		expect(r.vx).toBeCloseTo(PLAYER_WALK_SPEED, 6);
		expect(r.x).toBeLessThan(PILLAR_R.x - PLAYER_WIDTH);
	});

	it("friction brings a grounded player to rest", () => {
		const r = ticks(
			state({
				x: OPEN_X,
				y: standingOn(GROUND.y),
				grounded: true,
				vx: PLAYER_WALK_SPEED,
			}),
			{},
			60,
		);
		expect(r.vx).toBe(0);
	});

	it("keeps momentum longer in the air than on the ground", () => {
		const air = ticks(state({ x: 300, y: 100, vx: 200 }), {}, 10);
		const ground = ticks(
			state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true, vx: 200 }),
			{},
			10,
		);
		expect(air.vx).toBeGreaterThan(ground.vx);
	});
});

describe("facing follows the pointer", () => {
	const grounded = () =>
		state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true, facing: 1 });

	it("turns to the aimed side while standing still", () => {
		const r = tick(grounded(), { face: -1 });
		expect(r.facing).toBe(-1);
	});

	it("turns against the walk direction when aim and feet disagree", () => {
		// Retreating while guarding the side the attacker is on.
		const r = ticks(grounded(), { right: true, face: -1 }, 10);
		expect(r.facing).toBe(-1);
		expect(r.vx).toBeGreaterThan(0);
	});

	it("will not turn during a swing's startup or active frames", () => {
		// The direction is a promise for as long as the hitbox is a threat.
		let s = tick(grounded(), { attack: true, face: 1 });
		const def = MOVES.slash;
		const activeEndMs = def.startupMs + def.activeMs;
		while (s.meleeTimer < activeEndMs - DT * 1000) {
			s = tick(s, { attack: true, face: -1 });
			expect(s.facing).toBe(1);
		}
	});

	it("turns back to the pointer during recovery", () => {
		// Regression: locking facing for the whole move meant a player holding the
		// attack button chained slashes and ignored the cursor for 332ms at a time.
		let s = tick(grounded(), { attack: true, face: 1 });
		const def = MOVES.slash;
		const recoveryStartMs = def.startupMs + def.activeMs;
		while (s.meleeTimer < recoveryStartMs + 1) {
			s = tick(s, { attack: true, face: 1 });
		}
		expect(meleePhase(s)).toBe("recovery");

		const turned = tick(s, { attack: true, face: -1 });
		expect(turned.facing).toBe(-1);
		expect(turned.meleeAction).toBe("slash");
	});

	it("will not turn while stunned", () => {
		const r = tick(state({ ...grounded(), stunTimer: 200 }), { face: -1 });
		expect(r.facing).toBe(1);
	});
});

describe("solid collision", () => {
	it("blocks a GROUNDED player walking into a pillar", () => {
		// Regression: side collision used to be skipped whenever grounded was true,
		// so a walking player passed straight through every platform.
		const start = state({
			x: PILLAR_L.x - 100,
			y: standingOn(GROUND.y),
			grounded: true,
		});
		const r = ticks(start, { right: true }, 180);
		expect(r.x).toBe(PILLAR_L.x - PLAYER_WIDTH);
		expect(r.wallTouch).toBe("right");
		expect(penetrationDepth(r.x, r.y)).toBe(0);
	});

	it("blocks an AIRBORNE player moving into a left face", () => {
		const r = tick(
			state({ x: MID.x - 8, y: MID.y + 4, vx: PLAYER_WALK_SPEED }),
			{ right: true },
		);
		expect(r.x).toBe(MID.x - PLAYER_WIDTH);
		expect(r.vx).toBe(0);
		expect(r.wallTouch).toBe("right");
	});

	it("blocks a player moving into a right face", () => {
		const r = tick(
			state({ x: MID.x + MID.w + 2, y: MID.y + 4, vx: -PLAYER_WALK_SPEED }),
			{ left: true },
		);
		expect(r.x).toBe(MID.x + MID.w);
		expect(r.vx).toBe(0);
		expect(r.wallTouch).toBe("left");
	});

	it("does not stop a player passing above or below a platform", () => {
		const below = tick(
			state({ x: MID.x - 10, y: MID.y + MID.h + 2, vx: PLAYER_WALK_SPEED }),
			{ right: true },
		);
		expect(below.x).toBeGreaterThan(MID.x - 10);

		const above = tick(
			state({
				x: MID.x - 10,
				y: MID.y - PLAYER_HEIGHT - 10,
				vx: PLAYER_WALK_SPEED,
			}),
			{ right: true },
		);
		expect(above.x).toBeGreaterThan(MID.x - 10);
	});

	it("clamps to the world bounds", () => {
		const left = ticks(state({ x: 5, y: 300, vx: -400 }), { left: true }, 10);
		expect(left.x).toBe(0);

		const right = ticks(
			state({ x: WORLD_RIGHT - PLAYER_WIDTH - 5, y: 300, vx: 400 }),
			{ right: true },
			10,
		);
		expect(right.x).toBe(WORLD_RIGHT - PLAYER_WIDTH);
	});

	it("never tunnels through geometry at dash speed", () => {
		let s = state({ x: 40, y: 400, vx: 1000 });
		let worst = 0;
		for (let k = 0; k < 240; k++) {
			s = tick(s, { right: k < 120 });
			worst = Math.max(worst, penetrationDepth(s.x, s.y));
		}
		expect(worst).toBe(0);
	});

	it("never tunnels at a low framerate (dt = 1/20)", () => {
		let s = state({ x: 40, y: 300, vx: 1000 });
		let worst = 0;
		for (let k = 0; k < 60; k++) {
			s = tickPlayer(s, input({ right: true }), 1 / 20);
			worst = Math.max(worst, penetrationDepth(s.x, s.y));
		}
		expect(worst).toBe(0);
	});

	it("stays out of solids across a long randomised run", () => {
		// Deterministic pseudo-random input, so a failure is reproducible.
		let seed = 12345;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};

		let s = state({ x: 400, y: 100 });
		let worst = 0;
		for (let k = 0; k < 4000; k++) {
			s = tick(s, {
				left: rand() < 0.35,
				right: rand() < 0.35,
				up: rand() < 0.2,
			});
			worst = Math.max(worst, penetrationDepth(s.x, s.y));
		}
		expect(worst).toBe(0);
	});
});

describe("wall interaction", () => {
	it("reports wall contact while resting against a wall", () => {
		// Perception matters even at zero velocity: the AI reads wallTouch to
		// decide whether a wall jump is available.
		const r = tick(
			state({ x: PILLAR_L.x - PLAYER_WIDTH, y: PILLAR_L.y + 10 }),
			{ right: true },
		);
		expect(r.wallTouch).toBe("right");
	});

	it("wall slide caps fall speed while pressing into the wall", () => {
		const r = ticks(
			state({
				x: PILLAR_L.x - PLAYER_WIDTH,
				y: PILLAR_L.y + 4,
				vy: 600,
				wallTouch: "right",
			}),
			{ right: true },
			5,
		);
		expect(r.vy).toBeLessThanOrEqual(WALL_SLIDE_SPEED + 1e-6);
	});

	it("launches away from the wall on a wall jump", () => {
		// Right pillar: open space to its left, so the launch arc hits nothing.
		const r = tick(
			state({
				x: PILLAR_R.x - PLAYER_WIDTH,
				y: PILLAR_R.y + 22,
				wallTouch: "right",
			}),
			{ right: true, up: true },
		);
		expect(r.vx).toBe(-WALL_JUMP_HORIZONTAL);
		expect(r.vy).toBeCloseTo(WALL_JUMP_VERTICAL + GRAVITY * DT, 6);
		expect(r.wallJumpTimer).toBe(WALL_JUMP_LOCKOUT);
	});

	it("ignores steering during the wall jump lockout", () => {
		const r = tick(
			state({
				x: 400,
				y: 300,
				vx: -WALL_JUMP_HORIZONTAL,
				wallJumpTimer: WALL_JUMP_LOCKOUT,
			}),
			{ right: true },
		);
		expect(r.vx).toBeLessThan(0);
	});

	it("lockout expires", () => {
		const r = ticks(
			state({ x: 400, y: 200, wallJumpTimer: WALL_JUMP_LOCKOUT }),
			{},
			Math.ceil(WALL_JUMP_LOCKOUT / (DT * 1000)) + 1,
		);
		expect(r.wallJumpTimer).toBe(0);
	});

	it("ground jump takes priority over wall jump", () => {
		const r = tick(
			state({
				x: PILLAR_L.x - PLAYER_WIDTH,
				y: standingOn(GROUND.y),
				grounded: true,
				wallTouch: "right",
			}),
			{ right: true, up: true },
		);
		expect(r.vy).toBeCloseTo(JUMP_VELOCITY + GRAVITY * DT, 6);
		expect(r.vx).not.toBe(-WALL_JUMP_HORIZONTAL);
	});

	it("chained wall jumps gain height on a flat wall", () => {
		let s = state({ x: 2, y: standingOn(GROUND.y), grounded: true });
		const y0 = s.y;
		let best = 0;
		let hold = -99;
		for (let k = 0; k < 300; k++) {
			if (hold <= -3 && (s.grounded || s.wallTouch !== "none")) hold = 12;
			s = tick(s, { left: true, up: hold > 0 });
			hold--;
			best = Math.max(best, y0 - s.y);
		}
		expect(best).toBeGreaterThan(JUMP_HEIGHT_PX * 1.5);
	});
});

describe("dash", () => {
	it("is an impulse carried by the intent, so both sides simulate it", () => {
		// It used to be applied straight to the client's predicted state and never
		// sent, so the server had no dash in its authoritative state and the very
		// next reconciliation erased it mid-dash.
		const start = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });
		const dashed = tick(start, { dash: 1 });
		expect(dashed.vx).toBe(DASH_SPEED);
	});

	it("refuses to re-dash until the lockout expires", () => {
		let s = tick(
			state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true }),
			{ dash: 1 },
		);
		expect(s.dashTimer).toBeGreaterThan(0);

		// Held down, it must not become a permanent speed boost.
		s = tick(s, { dash: 1 });
		expect(s.vx).toBeLessThan(DASH_SPEED);
	});

	it("carries far enough to actually create separation", () => {
		// The reason the AI needed one: walking away from someone who walks at
		// your speed never opens a gap.
		let s = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });
		const startX = s.x;
		s = tick(s, { dash: 1 });
		for (let i = 0; i < 30; i++) s = tick(s, {});
		expect(s.x - startX).toBeGreaterThan(PLAYER_WALK_SPEED * 0.3);
	});

	/**
	 * A dash is a *line*, not a dive.
	 *
	 * Falling while it travelled made the one thing a dash is for — crossing a gap,
	 * repositioning at the peak of a jump — depend on how far through the arc you
	 * happened to be. Holding Y is what makes the gesture aimable.
	 */
	it("holds its Y exactly while it travels", () => {
		let s = state({ x: OPEN_X, y: 300, vy: 400 });
		s = tick(s, { dash: 1 });
		const y = s.y;

		const frames = Math.floor(DASH_DURATION_MS / 1000 / DT) - 1;
		for (let i = 0; i < frames; i++) {
			s = tick(s, {});
			expect(s.vy).toBe(0);
			expect(s.y).toBe(y);
		}
	});

	it("travels the same line whether thrown rising, falling or level", () => {
		const from = (vy: number) => {
			let s = state({ x: OPEN_X, y: 300, vy });
			s = tick(s, { dash: 1 });
			for (let i = 0; i < 8; i++) s = tick(s, {});
			return { x: s.x, y: s.y };
		};
		expect(from(-500)).toEqual(from(0));
		expect(from(400)).toEqual(from(0));
	});

	it("gives gravity the reins back when it ends", () => {
		let s = state({ x: OPEN_X, y: 300 });
		s = tick(s, { dash: 1 });
		// Past the duration, and still short of the lockout.
		s = ticks(s, {}, Math.ceil(DASH_DURATION_MS / 1000 / DT) + 1);
		expect(s.dashActiveTimer).toBe(0);
		expect(s.vy).toBeGreaterThan(0);
	});

	/**
	 * The reason `DASH_DURATION_MS` is shorter than `DASH_LOCKOUT_MS`: the gap
	 * between them is the window gravity always gets. Make the duration longer and
	 * a chained dasher simply never comes down.
	 */
	it("cannot be chained into level flight", () => {
		let s = state({ x: 20, y: 120 });
		const startY = s.y;
		// Dash the instant the lockout allows it, for a full second.
		for (let i = 0; i < 60; i++) s = tick(s, { dash: 1 });
		expect(s.y).toBeGreaterThan(startY);
	});

	it("lets a jump out of it actually leave the ground", () => {
		// The jump sets a negative vy that the dash's flat line would otherwise zero.
		let s = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });
		s = tick(s, { dash: 1 });
		s = tick(s, { up: true });
		expect(s.dashActiveTimer).toBe(0);
		expect(s.vy).toBeLessThan(0);
	});

	/**
	 * Being hit beats a dash — and it has to, or the uppercut's launch would be
	 * silently eaten by the flat line the dash is holding.
	 */
	it("is interrupted by a stun, so a launch still launches", () => {
		let s = state({ x: OPEN_X, y: 300 });
		s = tick(s, { dash: 1 });
		expect(s.dashActiveTimer).toBeGreaterThan(0);

		// What `applyMeleeResult` does to a fighter it launches.
		s = { ...s, stunTimer: 400, vy: -620 };
		s = tick(s, {});
		expect(s.dashActiveTimer).toBe(0);
		expect(s.vy).toBeLessThan(0);
		expect(s.y).toBeLessThan(300);
	});

	/**
	 * A grounded dash must stay grounded.
	 *
	 * Suppressing gravity outright broke this: gravity is what presses a standing
	 * fighter *into* the floor, and floor contact is where `grounded` comes from. So
	 * a ground dash left the fighter airborne on paper — unable to jump, with coyote
	 * time never starting because it never registered as grounded in the first place.
	 */
	it("stays on the floor when dashed along it, and can still jump", () => {
		let s = state({ x: OPEN_X, y: standingOn(GROUND.y), grounded: true });
		s = tick(s, { dash: 1 });
		expect(s.grounded).toBe(true);
		expect(s.y).toBe(standingOn(GROUND.y));

		s = tick(s, { up: true });
		expect(s.vy).toBeLessThan(0);
	});

	it("flattens out when a ground dash carries it off a ledge", () => {
		// Dash right off the low-left ledge: grounded for the first tick, then a flat
		// line rather than a dive.
		let s = state({
			x: LOW_LEFT.x + LOW_LEFT.w - PLAYER_WIDTH,
			y: standingOn(LOW_LEFT.y),
			grounded: true,
		});
		s = tick(s, { dash: 1 });
		// The body only leaves the ledge once it has cleared its edge entirely.
		const airborne = until(s, {}, (p) => !p.grounded, 5).state;
		expect(airborne.grounded).toBe(false);
		expect(airborne.dashActiveTimer).toBeGreaterThan(0);

		const y = airborne.y;
		expect(tick(airborne, {}).y).toBe(y);
	});

	it("ends against a wall instead of hovering there", () => {
		// Dash left into the arena's left edge from right beside it.
		let s = state({ x: 2, y: standingOn(GROUND.y), grounded: true });
		s = tick(s, { dash: -1 });
		s = ticks(s, {}, 6);
		expect(s.dashActiveTimer).toBe(0);
	});
});

describe("level reachability", () => {
	it("every ledge is within one jump of the surface below it", () => {
		const tops = [...new Set(platforms.map((p) => p.y))].sort((a, b) => b - a);
		// Walk downward-to-upward in pairs: every step of the ladder must be
		// clearable from the surface beneath it.
		let below: number | undefined;
		for (const top of tops) {
			if (below !== undefined) {
				expect(below - top).toBeLessThanOrEqual(JUMP_HEIGHT_PX);
			}
			below = top;
		}
	});

	it("has no gap too narrow for a player to pass through", () => {
		// A sub-player-width gap is a pocket the AI walks into and never leaves.
		expect(narrowGaps()).toEqual([]);
	});

	it("lets a fighter cross the whole arena at ground level", () => {
		let s = state({ x: 10, y: standingOn(GROUND.y), grounded: true });
		let hold = -99;
		for (let k = 0; k < 900; k++) {
			// Walk right, jumping whenever something blocks the way.
			if (hold <= -3 && s.wallTouch === "right" && s.grounded) hold = 12;
			s = tick(s, { right: true, up: hold > 0 });
			hold--;
			if (s.x > WORLD_RIGHT - PLAYER_WIDTH - 10) break;
		}
		expect(s.x).toBeGreaterThan(WORLD_RIGHT - PLAYER_WIDTH - 10);
	});
});

describe("round freeze", () => {
	// Freezetime is a *simulation* rule, not a server one: both sides run this,
	// which is what lets a client predict the moment a round goes live instead of
	// waiting to be told and lurching a tick later.

	it("discards the intent entirely while it runs", () => {
		const frozen = { ...createPlayerState(400, 500), freezeTimer: 1000 };
		const after = ticks(frozen, { right: true, attack: true, up: true }, 20);
		expect(after.x).toBe(400);
		expect(after.vx).toBe(0);
		expect(after.meleeAction).toBe("none");
		expect(after.jumping).toBe(false);
	});

	it("keeps its facing, so a team starts the round looking at the enemy", () => {
		const frozen = {
			...createPlayerState(400, 500, -1),
			freezeTimer: 1000,
		};
		expect(ticks(frozen, { face: 1, right: true }, 20).facing).toBe(-1);
	});

	it("still falls — it is not a pause", () => {
		const frozen = { ...createPlayerState(400, 100), freezeTimer: 1000 };
		expect(ticks(frozen, {}, 10).y).toBeGreaterThan(100);
	});

	it("counts down in real time and hands control back exactly once", () => {
		const frozen = { ...createPlayerState(400, 500), freezeTimer: 100 };
		// 100ms is six ticks at 60Hz; the seventh must move.
		const held = ticks(frozen, { right: true }, 6);
		expect(held.x).toBe(400);
		expect(held.freezeTimer).toBe(0);
		expect(tick(held, { right: true }).x).toBeGreaterThan(400);
	});
});

describe("determinism (client/server parity)", () => {
	it("produces identical state for identical input", () => {
		const seq: Partial<PlayerIntent>[] = [];
		for (let k = 0; k < 200; k++) {
			seq.push({ left: k % 7 === 0, right: k % 3 === 0, up: k % 11 === 0 });
		}

		const run = () => {
			let s = createPlayerState(400, 200);
			for (const i of seq) s = tick(s, i);
			return s;
		};

		expect(run()).toEqual(run());
	});

	it("is unaffected by how the state object was built", () => {
		const a = createPlayerState(120, 300);
		const b = { ...createPlayerState(120, 300) };
		expect(ticks(a, { right: true }, 50)).toEqual(
			ticks(b, { right: true }, 50),
		);
	});
});
