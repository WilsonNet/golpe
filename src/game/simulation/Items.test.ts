/**
 * The items: the HE grenade's ballistics and blast, and the trap's placement,
 * trigger and friendly-fire filtering.
 *
 * The server owns charges, damage and the trap's destruction; this file pins
 * the physics both sides must agree on — the same module `tickPlayer` uses to
 * predict a trap's lock on the client.
 */

import { describe, expect, it } from "vitest";
import { DRAGON_SPEED } from "../../tweakables/ultimate.js";
import { DEFAULT_WORLD, PLAYER_HEIGHT, PLAYER_WIDTH } from "./Arena.js";
import { type HeroKit, kitFor } from "./Heroes.js";
import {
	HE_GRENADE_FUSE_MS,
	HE_GRENADE_GRAVITY,
	HE_GRENADE_MAX_DAMAGE,
	HE_GRENADE_RADIUS,
	HE_GRENADE_SPEED,
	heBlastDamage,
	heGrenadeEnd,
	heGrenadeTouches,
	ITEMS,
	launchHeGrenade,
	launchSmokeGrenade,
	launchTrapCanister,
	SMOKE_DURATION_MS,
	SMOKE_GRENADE_FUSE_MS,
	SMOKE_GRENADE_GRAVITY,
	SMOKE_GRENADE_SPEED,
	SMOKE_RADIUS,
	smokeCloudOverlaps,
	smokeGrenadeEnd,
	smokeHidesFrom,
	smokeLobAngle,
	TRAP_COLLIDE_R,
	TRAP_RADIUS,
	TRAP_THROW_GRAVITY,
	TRAP_THROW_SPEED,
	TRAP_TRIGGER_MS,
	type Trap,
	type TrapCanisterState,
	tickHeGrenade,
	tickSmokeGrenade,
	tickTrapCanister,
	trapCatches,
	trapFor,
} from "./Items.js";
import { MOVES, sweptThrustBox } from "./Melee.js";
import {
	createPlayerState,
	JUMP_BUFFER_MS,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics.js";
import type { TeamId } from "./Teams.js";

describe("the item registry", () => {
	it("gives Lia an HE grenade and Anands a trap", () => {
		expect(kitFor("lia").item.id).toBe("he-grenade");
		expect(kitFor("anands").item.id).toBe("trap");
	});

	it("gives Jeffs a smoke grenade", () => {
		expect(kitFor("jeffs").item.id).toBe("smoke-grenade");
	});

	it("sizes the charges to the item: the grenade is deadlier than the trap", () => {
		expect(ITEMS["he-grenade"].maxCharges).toBe(2);
		expect(ITEMS.trap.maxCharges).toBe(3);
		// The smoke hides — it does not hurt — so it gets the grenade's two.
		expect(ITEMS["smoke-grenade"].maxCharges).toBe(2);
	});
});

describe("the HE grenade", () => {
	const launch = () => launchHeGrenade(1, "me", 400, 300, 0);

	it("flies along the launch angle under its own gravity", () => {
		const g = launch();
		expect(g.vx).toBeCloseTo(HE_GRENADE_SPEED);
		expect(g.vy).toBeCloseTo(0);
		tickHeGrenade(g, 0.1);
		expect(g.x).toBeCloseTo(400 + HE_GRENADE_SPEED * 0.1);
		// Semi-implicit Euler: vy is updated before y, so the first step falls
		// `g·dt·dt`, not `½·g·dt²`.
		expect(g.y).toBeCloseTo(300 + HE_GRENADE_GRAVITY * 0.1 * 0.1);
	});

	it("detonates on the fuse or on a direct hit, never on geometry", () => {
		const fuse = launch();
		fuse.fuseMs = 0;
		expect(heGrenadeEnd(fuse, false)).toBe(true);

		const flying = launch();
		flying.y = 100;
		expect(heGrenadeEnd(flying, false)).toBe(false);

		const touched = launch();
		expect(heGrenadeEnd(touched, true)).toBe(true);
	});

	it("bounces off the floor instead of detonating on contact", () => {
		// Thrown straight down at the ground: it falls, the velocity flips, and
		// it stays in the world — the fuse, not the floor, is what ends it.
		const g = launchHeGrenade(2, "me", 400, 400, Math.PI / 2);
		let bounced = false;
		for (let i = 0; i < 120; i++) {
			tickHeGrenade(g, 1 / 60, DEFAULT_WORLD);
			if (g.vy < 0) bounced = true;
		}
		expect(bounced).toBe(true);
		expect(g.y).toBeLessThan(DEFAULT_WORLD.bottom);
		expect(heGrenadeEnd(g, false)).toBe(false);
	});

	it("touches a hostile fighter but passes through its own thrower", () => {
		const g = launch();
		expect(heGrenadeTouches(g, "me", 400, 300)).toBe(false);
		expect(heGrenadeTouches(g, "foe", 400, 300, null)).toBe(true);
	});

	it("keeps its fuse long enough to bounce", () => {
		expect(HE_GRENADE_FUSE_MS).toBe(2500);
	});

	it("falls off linearly from the epicentre, CS-style", () => {
		expect(heBlastDamage(0)).toBe(HE_GRENADE_MAX_DAMAGE);
		expect(heBlastDamage(HE_GRENADE_RADIUS)).toBe(0);
		const mid = heBlastDamage(HE_GRENADE_RADIUS / 2);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(HE_GRENADE_MAX_DAMAGE);
	});
});

describe("the trap", () => {
	/** An armed trap at a known spot. Owner is never the caught fighter. */
	const trapAt = (
		id: number,
		x: number,
		y: number,
		owner = "someone-else",
		ownerTeam: TeamId | null = null,
	): Trap => ({ id, ownerId: owner, ownerTeam, x, y });

	/** The old placement: one step in front of a fighter standing at `x`. */
	const inFrontOf = (
		id: number,
		bodyX: number,
		bodyY: number,
		owner = "someone-else",
	): Trap =>
		trapAt(id, bodyX + PLAYER_WIDTH / 2 + 30, bodyY + PLAYER_HEIGHT, owner);

	const trap = () => inFrontOf(1, 400, 480, "me");

	it("is thrown, not placed: the throw inherits the thrower's momentum", () => {
		// A standing throw: pure aim, no carry.
		const still = launchTrapCanister(1, "me", 400, 300, 0, 0, 0, null);
		expect(still.vx).toBeCloseTo(TRAP_THROW_SPEED);
		expect(still.vy).toBeCloseTo(0);
		// A dash-throw carries the dash: momentum adds to the throw.
		const dashing = launchTrapCanister(2, "me", 400, 300, 0, 300, 0, null);
		expect(dashing.vx).toBeCloseTo(TRAP_THROW_SPEED + 300);
		// A jump-throw's upward fall carries too.
		const falling = launchTrapCanister(3, "me", 400, 300, 0, 0, 250, null);
		expect(falling.vy).toBeCloseTo(250);
	});

	it("arcs under gravity and plants an armed trap where it lands", () => {
		const c = launchTrapCanister(1, "me", 400, 300, 0, 0, 0, null);
		// Its own gravity pulls the canister down, semi-implicit like the HE's.
		tickTrapCanister(c, 0.1, DEFAULT_WORLD);
		expect(c.vy).toBeCloseTo(TRAP_THROW_GRAVITY * 0.1);
		let planted = false;
		let x = c.x;
		let y = c.y;
		for (let i = 0; i < 60 * 4; i++) {
			if (tickTrapCanister(c, 1 / 60, DEFAULT_WORLD)) {
				planted = true;
				x = c.x;
				y = c.y;
				break;
			}
		}
		expect(planted).toBe(true);
		// It flew forward and fell: gravity, not a slide.
		expect(x).toBeGreaterThan(400);
		expect(c.vy).toBe(0);
		// The canister's box bottoms out on the floor — the server plants the
		// trap at `y + TRAP_COLLIDE_R`, the floor line the trigger lives on.
		expect(y + TRAP_COLLIDE_R).toBeCloseTo(DEFAULT_WORLD.bottom - 32, 0);
	});

	it("does not bounce: a wall scrub drops it to plant at the wall's base", () => {
		// Thrown at the arena's right wall (x 800) from chest height.
		const c = launchTrapCanister(2, "me", 700, 300, 0, 0, 0, null);
		let planted = false;
		let wallHit = false;
		for (let i = 0; i < 60 * 5; i++) {
			const wasVx = c.vx;
			if (tickTrapCanister(c, 1 / 60, DEFAULT_WORLD)) {
				planted = true;
				break;
			}
			if (wasVx !== 0 && c.vx === 0) wallHit = true;
		}
		expect(wallHit).toBe(true);
		expect(planted).toBe(true);
		// Planted at the wall's base, not carried through it.
		expect(c.x).toBeLessThan(DEFAULT_WORLD.right - 1);
		expect(c.y + TRAP_COLLIDE_R).toBeCloseTo(DEFAULT_WORLD.bottom - 32, 0);
	});

	it("does not plant a mine whose centre hangs over a ledge edge: it slides off", () => {
		// LOW_LEFT spans x 90..220 at y 450. Drop the canister straight down
		// with its centre 4px past the ledge's right edge: the canister's 12px
		// box catches a 2px sliver of the ledge, but the mine's centre of
		// gravity hangs over empty space, so it must not plant there.
		const c: TrapCanisterState = {
			id: 10,
			ownerId: "me",
			ownerTeam: null,
			x: 224,
			y: 400,
			vx: 0,
			vy: 0,
		};
		let planted = false;
		let floorY = 0;
		let finalX = 0;
		for (let i = 0; i < 60 * 8; i++) {
			if (tickTrapCanister(c, 1 / 60, DEFAULT_WORLD)) {
				planted = true;
				floorY = c.y + TRAP_COLLIDE_R;
				finalX = c.x;
				break;
			}
		}
		expect(planted).toBe(true);
		// It never planted on the ledge's top (450): the fall kept going until
		// the mine's centre had real ground under it — the arena floor.
		expect(floorY).toBeCloseTo(DEFAULT_WORLD.bottom - 32, 0);
		// It slid clear of LOW_LEFT's right edge (x 220) on its way down.
		expect(finalX).toBeGreaterThan(220);
	});

	it("plants a mine whose centre stays over the ledge", () => {
		// Centre 4px inside LOW_LEFT's right edge (x 220): the mine overhangs
		// by less than half, its centre of gravity is still supported, and it
		// plants on the ledge like a throw onto solid floor.
		const c: TrapCanisterState = {
			id: 11,
			ownerId: "me",
			ownerTeam: null,
			x: 216,
			y: 400,
			vx: 0,
			vy: 0,
		};
		let planted = false;
		let floorY = 0;
		for (let i = 0; i < 60 * 4; i++) {
			if (tickTrapCanister(c, 1 / 60, DEFAULT_WORLD)) {
				planted = true;
				floorY = c.y + TRAP_COLLIDE_R;
				break;
			}
		}
		expect(planted).toBe(true);
		expect(floorY).toBeCloseTo(450, 0);
	});

	it("catches by the feet, not the whole body", () => {
		const t = trap();
		// Standing right on it.
		expect(trapCatches(t, t.x - 16, t.y - 48)).toBe(true);
		// A step past the trigger radius is clear.
		expect(trapCatches(t, t.x - 16 - TRAP_RADIUS - 10, t.y - 48)).toBe(false);
		// A full jump clears it: the feet leave the patch's radius.
		expect(trapCatches(t, t.x - 16, t.y - 48 - 140)).toBe(false);
	});

	it("never catches its owner, and never catches a teammate", () => {
		const t = trap();
		expect(trapFor([t], "me", null)).toHaveLength(0);
		// The trap was placed teamless, so a team room's teammate is still an
		// enemy of it — the team case is the placed-by-a-teammate one below.
		expect(trapFor([t], "foe", null)).toHaveLength(1);

		const teamTrap = trapAt(
			9,
			400 + PLAYER_WIDTH / 2 + 30,
			480 + PLAYER_HEIGHT,
			"me",
			0,
		);
		expect(trapFor([teamTrap], "teammate", 0)).toHaveLength(0);
		expect(trapFor([teamTrap], "foe", 1)).toHaveLength(1);
		expect(trapFor([teamTrap], "foe", null)).toHaveLength(1);
	});

	it("locks mobility but not attacks in `tickPlayer`", () => {
		// The trap under a fighter standing on its patch.
		const state = groundedState(400);
		const t = inFrontOf(2, state.x, state.y);
		const kit: HeroKit = kitFor("lia");

		// A tick with the trap present sets the lock.
		const caught = tickPlayer(
			state,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(caught.trapTimer).toBeGreaterThan(0);

		// While locked, walking does not move the fighter...
		const locked = tickPlayer(
			caught,
			{ ...neutral(), right: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(locked.x).toBeCloseTo(caught.x, 1);

		// ...but an attack is not refused.
		const swing = tickPlayer(
			caught,
			{ ...neutral(), attack: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(swing.meleeAction).not.toBe("none");
	});

	it("does not re-trigger while already locked, and decays the lock", () => {
		const state = groundedState(400);
		const t = inFrontOf(3, state.x, state.y);
		const kit: HeroKit = kitFor("lia");
		const caught = tickPlayer(
			state,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		const locked = tickPlayer(
			caught,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(locked.trapTimer).toBeLessThan(caught.trapTimer);
		expect(locked.trapTimer).toBeCloseTo(TRAP_TRIGGER_MS - 1000 / 60, 0);
	});

	it("catches a dash dead: the burst's momentum dies with the catch", () => {
		// Open floor past the right pillar (x 496..520), clear of the ledges:
		// the fighter dashes across the patch at full speed.
		const kit: HeroKit = kitFor("anands");
		const s0 = groundedState(544);
		const t = trapAt(4, 610 + PLAYER_WIDTH / 2 + 30, 568); // centre x 656
		let caught: PlayerPosition | null = null;
		let s = s0;
		for (let i = 0; i < 60; i++) {
			const next = tickPlayer(
				s,
				{ ...neutral(), right: true, dash: 1 },
				1 / 60,
				DEFAULT_WORLD,
				null,
				kit,
				[t],
			);
			if (next.trapTimer > 0) {
				caught = next;
				break;
			}
			s = next;
		}
		expect(caught).not.toBeNull();
		if (caught === null) throw new Error("the dash must spring the trap");
		expect(caught.vx).toBe(0);
		expect(caught.dashActiveTimer).toBe(0);
		// The lock holds: the next tick's walk and dash input move nobody.
		const locked = tickPlayer(
			caught,
			{ ...neutral(), right: true, dash: 1 },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(locked.x).toBeCloseTo(caught.x, 1);
		expect(locked.vx).toBe(0);
	});

	it("catches a tumble dead: the roll's momentum dies with the catch", () => {
		const kit: HeroKit = kitFor("anands");
		const s0 = { ...groundedState(544), stance: "gun" as const };
		const t = trapAt(5, 610 + PLAYER_WIDTH / 2 + 30, 568); // centre x 656
		let caught: PlayerPosition | null = null;
		let s: PlayerPosition = s0;
		for (let i = 0; i < 60; i++) {
			const next = tickPlayer(
				s,
				{ ...neutral(), right: true, dash: 1 },
				1 / 60,
				DEFAULT_WORLD,
				null,
				kit,
				[t],
			);
			if (next.trapTimer > 0) {
				caught = next;
				break;
			}
			s = next;
		}
		expect(caught).not.toBeNull();
		if (caught === null) throw new Error("the roll must spring the trap");
		expect(caught.vx).toBe(0);
		expect(caught.tumbleActiveTimer).toBe(0);
		const locked = tickPlayer(
			caught,
			{ ...neutral(), right: true, dash: 1 },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(locked.x).toBeCloseTo(caught.x, 1);
	});

	it("a jump buffered before the catch cannot fire through the lock", () => {
		const kit: HeroKit = kitFor("anands");
		const state = groundedState(400);
		const t = inFrontOf(6, state.x, state.y);
		const caught = tickPlayer(
			state,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(caught.trapTimer).toBeGreaterThan(0);
		// The jump was buffered the tick the trap caught the fighter: the lock
		// discards it — no hop out of the trap; the press must be made again.
		const buffered = { ...caught, jumpBufferTimer: JUMP_BUFFER_MS };
		const locked = tickPlayer(
			buffered,
			{ ...neutral(), up: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(locked.vy).toBe(0);
		expect(locked.jumping).toBe(false);
	});

	it("counters the dagger's thrust and shoryuken, but not the stab", () => {
		const kit: HeroKit = kitFor("anands");
		const state = groundedState(400);
		const t = inFrontOf(7, state.x, state.y);
		const caught = tickPlayer(
			state,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(caught.trapTimer).toBeGreaterThan(0);
		// A shift press (the lunge) is refused while the lock holds...
		const thrust = tickPlayer(
			caught,
			{ ...neutral(), block: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(thrust.meleeAction).toBe("none");
		// ...and so is the uppercut button's shoryuken (the rise).
		const shoryuken = tickPlayer(
			caught,
			{ ...neutral(), uppercut: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(shoryuken.meleeAction).toBe("none");
		// The stab carries no body, so it still starts: the lock has the feet,
		// not the hands.
		const stab = tickPlayer(
			caught,
			{ ...neutral(), attack: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(stab.meleeAction).toBe("stab");
		// Without the lock the same presses start the moves: the refusal is the
		// trap's, not a broken input.
		const free = tickPlayer(
			state,
			{ ...neutral(), block: true },
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[],
		);
		expect(free.meleeAction).toBe("thrust");
	});

	it("does not counter the dragon thrust: a caught rider keeps riding", () => {
		const kit: HeroKit = kitFor("anands");
		const state = groundedState(400);
		const t = inFrontOf(8, state.x, state.y);
		const caught = tickPlayer(
			state,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(caught.trapTimer).toBeGreaterThan(0);
		// The ride is not the feet: a fighter caught mid-ride keeps riding, and
		// a trapped fighter can still cast the dragon.
		const riding = {
			...caught,
			dragonTimer: 500,
			dragonVX: DRAGON_SPEED,
			dragonVY: 0,
		};
		const after = tickPlayer(
			riding,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		expect(after.dragonTimer).toBeGreaterThan(0);
		expect(after.vx).toBeCloseTo(DRAGON_SPEED, 1);
	});

	it("freezes a mid-lunge's swept box: the lock lends the thrust no arc", () => {
		const kit: HeroKit = kitFor("anands");
		const state = groundedState(400);
		const t = inFrontOf(9, state.x, state.y);
		const caught = tickPlayer(
			state,
			neutral(),
			1 / 60,
			DEFAULT_WORLD,
			null,
			kit,
			[t],
		);
		// Mid-lunge, 40ms into the active window (startup 260, active 140).
		const midLunge = {
			...caught,
			meleeAction: "thrust" as const,
			meleeTimer: MOVES.thrust.startupMs + 40,
			facing: 1,
		};
		const box = sweptThrustBox(midLunge);
		expect(box).not.toBeNull();
		// Locked: the sweep is the reach ahead of the frozen body — no phantom
		// arc from a lunge the body never made.
		const travelled =
			((midLunge.meleeTimer - MOVES.thrust.startupMs) / 1000) *
			(MOVES.thrust.selfVx ?? 0);
		expect(travelled).toBeGreaterThan(0);
		expect(box?.w).toBeCloseTo(MOVES.thrust.reachPx + PLAYER_WIDTH);
		// The same lunge without the lock sweeps the full arc.
		const freeBox = sweptThrustBox({ ...midLunge, trapTimer: 0 });
		expect(freeBox?.w).toBeCloseTo(
			travelled + MOVES.thrust.reachPx + PLAYER_WIDTH,
		);
	});
});

describe("the smoke grenade", () => {
	it("flies along the launch angle and blooms on the fuse", () => {
		const g = launchSmokeGrenade(1, "me", 400, 300, 0);
		expect(g.vx).toBeCloseTo(SMOKE_GRENADE_SPEED);
		expect(g.vy).toBeCloseTo(0);
		expect(g.fuseMs).toBe(SMOKE_GRENADE_FUSE_MS);

		tickSmokeGrenade(g, 0.1);
		expect(g.x).toBeCloseTo(400 + SMOKE_GRENADE_SPEED * 0.1);
		// Its own gravity, like the HE's throw.
		expect(g.vy).toBeCloseTo(SMOKE_GRENADE_GRAVITY * 0.1);

		// The canister never detonates on contact — only the fuse ends it.
		expect(smokeGrenadeEnd(g)).toBe(false);
		g.fuseMs = 1;
		tickSmokeGrenade(g, 0.1);
		expect(smokeGrenadeEnd(g)).toBe(true);
	});

	it("hides nobody until the cloud is ally smoke and the viewer is hostile", () => {
		const cloud = {
			id: 1,
			ownerId: "me",
			ownerTeam: null,
			x: 400,
			y: 400,
			remainingMs: SMOKE_DURATION_MS,
		};

		// A fighter inside their own cloud vanishes from an enemy's view.
		expect(
			smokeHidesFrom(cloud, "me", null, "foe", null, 400 - 16, 400 - 24),
		).toBe(true);
		// Standing in your own smoke fades you to yourself — the cue that you
		// are invisible right now.
		expect(
			smokeHidesFrom(cloud, "me", null, "me", null, 400 - 16, 400 - 24),
		).toBe(true);
		// Outside the radius is visible.
		expect(
			smokeHidesFrom(cloud, "me", null, "foe", null, 400 - 16 - 400, 400 - 24),
		).toBe(false);
		// A fighter in a cloud that is not their side's is not hidden at all.
		expect(
			smokeHidesFrom(
				cloud,
				"foe",
				null,
				"enemy-of-foe",
				null,
				400 - 16,
				400 - 24,
			),
		).toBe(false);
	});

	it("a team cloud conceals teammates from the other side only", () => {
		const cloud = {
			id: 2,
			ownerId: "me",
			ownerTeam: 0 as TeamId,
			x: 400,
			y: 400,
			remainingMs: SMOKE_DURATION_MS,
		};
		// A teammate inside the cloud is hidden from the enemy side...
		expect(
			smokeHidesFrom(cloud, "teammate", 0, "foe", 1, 400 - 16, 400 - 24),
		).toBe(true);
		// ...and visible to their own side.
		expect(
			smokeHidesFrom(cloud, "teammate", 0, "other-ally", 0, 400 - 16, 400 - 24),
		).toBe(false);
		// You see your own fighter fade too, standing in your side's smoke —
		// team or free-for-all, the ghost is the "you are invisible" cue.
		expect(smokeHidesFrom(cloud, "me", 0, "me", 0, 400 - 16, 400 - 24)).toBe(
			true,
		);
	});

	it("the overlap is centre-to-centre against the cloud's radius", () => {
		const cloud = {
			id: 3,
			ownerId: "me",
			ownerTeam: null,
			x: 400,
			y: 400,
			remainingMs: SMOKE_DURATION_MS,
		};
		expect(smokeCloudOverlaps(cloud, 400 - 16, 400 - 24)).toBe(true);
		// One radius and a step outside is clear.
		expect(
			smokeCloudOverlaps(cloud, 400 - 16 - SMOKE_RADIUS - 40, 400 - 24),
		).toBe(false);
	});

	it("smokeLobAngle lands the canister where it is aimed", () => {
		// A flat 30px drop at 300px range.
		const a = smokeLobAngle(300, 0);
		const t = 300 / (SMOKE_GRENADE_SPEED * Math.cos(a));
		const landed =
			SMOKE_GRENADE_SPEED * Math.sin(a) * t -
			0.5 * SMOKE_GRENADE_GRAVITY * t * t;
		expect(landed).toBeCloseTo(0, 0);
		// A lob to a ledge 240px away and 120px up.
		const b = smokeLobAngle(240, -120);
		const t2 = 240 / (SMOKE_GRENADE_SPEED * Math.cos(b));
		const landed2 =
			SMOKE_GRENADE_SPEED * Math.sin(b) * t2 -
			0.5 * SMOKE_GRENADE_GRAVITY * t2 * t2;
		expect(landed2).toBeCloseTo(-120, 0);
		// Straight up when the target is directly overhead.
		expect(smokeLobAngle(0, -50)).toBeCloseTo(Math.PI / 2, 4);
	});
});

/** A fighter standing still on the default arena's floor. */
function groundedState(x: number): PlayerPosition {
	let s = createPlayerState(x, 480);
	// Fall to the floor.
	for (let i = 0; i < 60; i++) {
		const next = tickPlayer(s, neutral(), 1 / 60, DEFAULT_WORLD);
		if (next.grounded) return next;
		s = next;
	}
	return s;
}

function neutral(): PlayerIntent {
	return { ...NEUTRAL_INTENT };
}
