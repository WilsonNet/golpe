/**
 * The items: the HE grenade's ballistics and blast, and the trap's placement,
 * trigger and friendly-fire filtering.
 *
 * The server owns charges, damage and the trap's destruction; this file pins
 * the physics both sides must agree on — the same module `tickPlayer` uses to
 * predict a trap's lock on the client.
 */

import { describe, expect, it } from "vitest";
import { DRAGON_SPEED } from "../../../tweakables/ultimate.js";
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
	placeTrap,
	SMOKE_DURATION_MS,
	SMOKE_GRENADE_FUSE_MS,
	SMOKE_GRENADE_GRAVITY,
	SMOKE_GRENADE_SPEED,
	SMOKE_RADIUS,
	smokeCloudOverlaps,
	smokeGrenadeEnd,
	smokeHidesFrom,
	smokeLobAngle,
	TRAP_PLACE_OFFSET,
	TRAP_RADIUS,
	TRAP_TRIGGER_MS,
	tickHeGrenade,
	tickSmokeGrenade,
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
	const trap = () => placeTrap(1, "me", 400, 480, 1, null);

	it("is placed on the floor, one step in front of the fighter", () => {
		const t = trap();
		expect(t.x).toBeCloseTo(400 + 16 + TRAP_PLACE_OFFSET);
		expect(t.y).toBeCloseTo(480 + 48);
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

		const teamTrap = placeTrap(9, "me", 400, 480, 1, 0);
		expect(trapFor([teamTrap], "teammate", 0)).toHaveLength(0);
		expect(trapFor([teamTrap], "foe", 1)).toHaveLength(1);
		expect(trapFor([teamTrap], "foe", null)).toHaveLength(1);
	});

	it("locks mobility but not attacks in `tickPlayer`", () => {
		// The trap under a fighter standing on its patch.
		const state = groundedState(400);
		const t = placeTrap(2, "someone-else", state.x, state.y, 1, null);
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
		const t = placeTrap(3, "someone-else", state.x, state.y, 1, null);
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
		const t = placeTrap(4, "someone-else", 610, 568 - PLAYER_HEIGHT, 1, null); // centre x 656
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
		const t = placeTrap(5, "someone-else", 610, 568 - PLAYER_HEIGHT, 1, null); // centre x 656
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
		const t = placeTrap(6, "someone-else", state.x, state.y, 1, null);
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
		const t = placeTrap(7, "someone-else", state.x, state.y, 1, null);
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
		const t = placeTrap(8, "someone-else", state.x, state.y, 1, null);
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
		const t = placeTrap(9, "someone-else", state.x, state.y, 1, null);
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
		// The local fighter is never hidden from themselves.
		expect(
			smokeHidesFrom(cloud, "me", null, "me", null, 400 - 16, 400 - 24),
		).toBe(false);
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
