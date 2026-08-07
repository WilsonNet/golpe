import { describe, expect, it } from "vitest";
import { RANGED_WEAPONS } from "./Heroes.js";
import { tickReload } from "./Physics.js";

/** A fighter with `ammo` rounds left, not reloading. */
const state = (ammo: number) => ({ ammo, reloadTimer: 0 });

describe("the reload", () => {
	it("the rifle and the machine gun refill the whole magazine at once", () => {
		const rifle = state(3);
		// Half a reload later, nothing has landed yet — the mag refills whole.
		tickReload(
			rifle,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.4,
		);
		expect(rifle.ammo).toBe(3);
		expect(rifle.reloadTimer).toBeCloseTo(
			(RANGED_WEAPONS.rifle.reloadMs ?? 0) - 400,
			0,
		);
		tickReload(
			rifle,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.5,
		);
		expect(rifle.ammo).toBe(RANGED_WEAPONS.rifle.magazine);
		expect(rifle.reloadTimer).toBe(0);
	});

	it("a full magazine never reloads", () => {
		const full = state(RANGED_WEAPONS.shotgun.magazine);
		tickReload(
			full,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			5,
		);
		expect(full.ammo).toBe(RANGED_WEAPONS.shotgun.magazine);
		expect(full.reloadTimer).toBe(0);
	});

	it("the shotgun loads one shell at a time, the first from empty slowest", () => {
		const shotgun = state(0);
		const firstMs = RANGED_WEAPONS.shotgun.reloadFirstShellMs ?? 0;
		const shellMs = RANGED_WEAPONS.shotgun.reloadShellMs ?? 0;
		tickReload(
			shotgun,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			firstMs / 2000,
		);
		// The rack from empty is the slow shell; it has not landed yet.
		expect(shotgun.ammo).toBe(0);
		tickReload(
			shotgun,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			firstMs / 1000,
		);
		expect(shotgun.ammo).toBe(1);
		// The next shell is the faster one — but still slower than a blast.
		tickReload(
			shotgun,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			shellMs / 2000,
		);
		expect(shotgun.ammo).toBe(1);
		tickReload(
			shotgun,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			shellMs / 1000,
		);
		expect(shotgun.ammo).toBe(2);
		// The reload must never outpace the trigger: each shell takes longer
		// than the 900ms between blasts, or the gun would reload as fast as
		// it fires and the magazine would be a formality.
		expect(shellMs).toBeGreaterThan(RANGED_WEAPONS.shotgun.cooldownMs);
	});

	it("holding fire with rounds in the mag delays the reload", () => {
		const s = state(4);
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			1,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(4);
	});

	it("an empty magazine reloads even while the trigger is held", () => {
		const s = state(0);
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			1.5,
		);
		expect(s.ammo).toBe(RANGED_WEAPONS.rifle.magazine);
	});

	it("firing mid-reload cancels the load and keeps the loaded rounds", () => {
		const s = state(2);
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			0.2,
		);
		expect(s.reloadTimer).toBeGreaterThan(0);
		// The trigger comes back: the in-progress shell is lost.
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			0.1,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(2);
	});
});
