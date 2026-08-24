import { describe, expect, it } from "vitest";
import type { RangedWeaponDef } from "../../tweakables/ranged.js";
import { RANGED_WEAPONS } from "./Heroes.js";
import {
	type PlayerPosition,
	reserveRoundsFor,
	tickReload,
} from "./Physics.js";

/** The one-timer duration of a clip weapon — the test's dt divisor. */
const clipMs = (def: RangedWeaponDef): number =>
	def.reloadStyle === "clip" ? def.reloadMs : 0;

/** The first-round (empty-magazine) duration of a shell weapon. */
const firstShellMs = (def: RangedWeaponDef): number =>
	def.reloadStyle === "shell"
		? (def.reloadFirstRoundMs ?? def.reloadRoundMs)
		: 0;

/** The ordinary per-round duration of a shell weapon. */
const shellMs = (def: RangedWeaponDef): number =>
	def.reloadStyle === "shell" ? def.reloadRoundMs : 0;

/** The slice of a fighter's state `tickReload` mutates. */
type ReloadState = Pick<
	PlayerPosition,
	"ammo" | "reserveRounds" | "reloadTimer" | "stance"
>;

/** A fighter with `ammo` rounds left, the gun out, not reloading. */
const state = (ammo: number, reserveRounds = 999): ReloadState => ({
	ammo,
	reserveRounds,
	reloadTimer: 0,
	stance: "gun",
});

describe("the clip reload (rifle, machine gun)", () => {
	it("is full magazine or nothing — the ammo does not move until the whole rack lands", () => {
		const rifle = state(11);
		// Halfway into the rack: nothing has landed yet.
		tickReload(
			rifle,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			clipMs(RANGED_WEAPONS.rifle) / 2000,
		);
		expect(rifle.ammo).toBe(11);
		expect(rifle.reserveRounds).toBe(999);
		expect(rifle.reloadTimer).toBeGreaterThan(0);
		// The rest of the rack lands: the whole magazine at once, the reserve
		// debited for only the round it was missing.
		tickReload(
			rifle,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			clipMs(RANGED_WEAPONS.rifle) / 2000,
		);
		expect(rifle.ammo).toBe(12);
		expect(rifle.reserveRounds).toBe(998);
		expect(rifle.reloadTimer).toBe(0);
	});

	it("an interrupted rack contributes nothing — no partial reload worth shooting", () => {
		const s = state(5);
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.4,
		);
		expect(s.reloadTimer).toBeGreaterThan(0);
		// The trigger interrupts the rack mid-flight: the ammo and the
		// reserve are exactly as they were before it started.
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.1,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(5);
		expect(s.reserveRounds).toBe(999);
	});

	it("a one-round top-up costs the full rack — close to full is not cheaper", () => {
		const s = state(11);
		// The rack's timer comes up at the weapon's full `reloadMs` even
		// though only one round is missing.
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			clipMs(RANGED_WEAPONS.rifle) / 1000,
		);
		expect(s.ammo).toBe(12);
		expect(s.reserveRounds).toBe(998);
		const stream = state(11);
		tickReload(
			stream,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.machinegun } as never,
			clipMs(RANGED_WEAPONS.machinegun) / 1000,
		);
		expect(stream.ammo).toBe(30);
		expect(stream.reserveRounds).toBe(980);
	});

	it("draws only what the reserve has left — a short reserve leaves the mag partially full", () => {
		const s = state(10, 1);
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			clipMs(RANGED_WEAPONS.rifle) / 1000,
		);
		expect(s.ammo).toBe(11);
		expect(s.reserveRounds).toBe(0);
	});

	it("firing mid-reload aborts the load with the rounds it held, and an empty mag reloads even while held", () => {
		const s = state(2);
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.2,
		);
		expect(s.reloadTimer).toBeGreaterThan(0);
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.1,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(2);

		// From empty there is nothing to abort with: the rack runs on under a
		// held trigger, and lands the whole magazine.
		const empty = state(0);
		tickReload(
			empty,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			clipMs(RANGED_WEAPONS.rifle) / 1000,
		);
		expect(empty.ammo).toBe(12);
		expect(empty.reserveRounds).toBe(987);
	});
});

describe("the shell reload (shotgun)", () => {
	it("loads one round per cycle — a partial reload that can shoot", () => {
		const shotgun = state(0);
		const firstMs = firstShellMs(RANGED_WEAPONS.shotgun);
		const roundMs = shellMs(RANGED_WEAPONS.shotgun);
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
		// The next round is the faster one — but still slower than a blast.
		tickReload(
			shotgun,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			roundMs / 2000,
		);
		expect(shotgun.ammo).toBe(1);
		tickReload(
			shotgun,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			roundMs / 1000,
		);
		expect(shotgun.ammo).toBe(2);
		// The reload must never outpace the trigger: each round takes longer
		// than the 900ms between blasts, or the gun would reload as fast as
		// it fires and the magazine would be a formality.
		expect(roundMs).toBeGreaterThan(RANGED_WEAPONS.shotgun.cooldownMs);
	});

	it("firing mid-reload cancels the pump and keeps the loaded shells", () => {
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

	it("a stance switch keeps the loaded shells, only the shell being pumped is lost", () => {
		const s = state(0);
		const firstMs = firstShellMs(RANGED_WEAPONS.shotgun);
		// One shell lands, the next is mid-load.
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			firstMs / 1000 + 0.05,
		);
		expect(s.ammo).toBe(1);
		expect(s.reloadTimer).toBeGreaterThan(0);
		// The gun is holstered mid-load.
		s.stance = "sword";
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			0.2,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(1);
		// Back on the gun, the reload restarts from the shells that landed.
		s.stance = "gun";
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			0.2,
		);
		expect(s.reloadTimer).toBeGreaterThan(0);
		expect(s.ammo).toBe(1);
	});
});

describe("the rules both styles share", () => {
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

	it("a sword-stance fighter reloads nothing and drops any reload in progress", () => {
		const s = state(4);
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.04,
		);
		expect(s.reloadTimer).toBeGreaterThan(0);
		// The gun is holstered: the rack is dropped where it stands — all
		// progress gone, nothing loaded.
		s.stance = "sword";
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			1.5,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(4);
		expect(s.reserveRounds).toBe(999);
	});

	it("the reload draws only what the reserve has left, then the gun is dry", () => {
		const s = state(0, 5);
		// Five rounds in the reserve: a clip reload lands all five at once,
		// then there is nothing left to draw.
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			5,
		);
		expect(s.ammo).toBe(5);
		expect(s.reserveRounds).toBe(0);
		expect(s.reloadTimer).toBe(0);
	});

	it("an empty reserve never reloads — a dry gun stays dry", () => {
		const s = state(0, 0);
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			5,
		);
		expect(s.ammo).toBe(0);
		expect(s.reloadTimer).toBe(0);
	});

	it("a fighter with rounds left but no reserve keeps what is loaded, and no more", () => {
		const s = state(3, 0);
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			5,
		);
		expect(s.ammo).toBe(3);
		expect(s.reloadTimer).toBe(0);
	});

	it("the reserve is everything but the loaded magazine of a life's magazines", () => {
		expect(reserveRoundsFor(RANGED_WEAPONS.rifle)).toBe(
			(RANGED_WEAPONS.rifle.magazinesPerLife - 1) *
				RANGED_WEAPONS.rifle.magazine,
		);
	});
});
