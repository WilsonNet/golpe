/**
 * The items: the HE grenade's ballistics and blast, and the trap's placement,
 * trigger and friendly-fire filtering.
 *
 * The server owns charges, damage and the trap's destruction; this file pins
 * the physics both sides must agree on — the same module `tickPlayer` uses to
 * predict a trap's lock on the client.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "./Arena.js";
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
	placeTrap,
	TRAP_PLACE_OFFSET,
	TRAP_RADIUS,
	TRAP_TRIGGER_MS,
	tickHeGrenade,
	trapCatches,
	trapFor,
} from "./Items.js";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics.js";

describe("the item registry", () => {
	it("gives Lia an HE grenade and Anands a trap", () => {
		expect(kitFor("lia").item.id).toBe("he-grenade");
		expect(kitFor("anands").item.id).toBe("trap");
	});

	it("sizes the charges to the item: the grenade is deadlier than the trap", () => {
		expect(ITEMS["he-grenade"].maxCharges).toBe(2);
		expect(ITEMS.trap.maxCharges).toBe(3);
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
