import { describe, expect, it } from "vitest";
import { RANGED_WEAPONS } from "./Heroes.js";
import {
	type PlayerPosition,
	reserveRoundsFor,
	tickReload,
} from "./Physics.js";

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

describe("the reload", () => {
	it("every weapon loads one round at a time — never a whole magazine at once", () => {
		const rifle = state(11);
		// Half of a 70ms round has not landed yet.
		tickReload(
			rifle,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.03,
		);
		expect(rifle.ammo).toBe(11);
		expect(rifle.reloadTimer).toBeGreaterThan(0);
		// The rest of the round lands: exactly one.
		tickReload(
			rifle,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.05,
		);
		expect(rifle.ammo).toBe(12);
		expect(rifle.reserveRounds).toBe(998);
	});

	it("a partial reload moves exactly one round from the reserve — 19/40 reloads to 20/39", () => {
		const s = state(19, 40);
		tickReload(
			s,
			{ attack: false },
			// The user's example is a 20-round weapon; ours are 12/30/5, so use
			// the rifle's 12 and the same "one short, 40 behind" shape.
			{ ranged: { ...RANGED_WEAPONS.rifle, magazine: 20 } } as never,
			(RANGED_WEAPONS.rifle.reloadRoundMs + 1) / 1000,
		);
		expect(s.ammo).toBe(20);
		expect(s.reserveRounds).toBe(39);
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

	it("the round that loads from empty is the slow one, the rounds after it fast", () => {
		const shotgun = state(0);
		const firstMs = RANGED_WEAPONS.shotgun.reloadFirstRoundMs ?? 0;
		const roundMs = RANGED_WEAPONS.shotgun.reloadRoundMs;
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
		// One round lands (a whole-magazine refill would land all twelve; a
		// per-bullet reload lands one, and the held trigger fires it on the
		// next frame, so the load starts again from empty).
		expect(s.ammo).toBe(1);
		expect(s.reserveRounds).toBe(998);
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
		// The trigger comes back: the in-progress round is lost.
		tickReload(
			s,
			{ attack: true },
			{ ranged: RANGED_WEAPONS.shotgun } as never,
			0.1,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(2);
	});

	it("a sword-stance fighter reloads nothing and drops any reload in progress", () => {
		const s = state(4);
		// Less than one 70ms round, so the reload is mid-load, not landed.
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			0.04,
		);
		expect(s.reloadTimer).toBeGreaterThan(0);
		// The gun is holstered: the load is dropped where it stands.
		s.stance = "sword";
		tickReload(
			s,
			{ attack: false },
			{ ranged: RANGED_WEAPONS.rifle } as never,
			1.5,
		);
		expect(s.reloadTimer).toBe(0);
		expect(s.ammo).toBe(4);
	});

	it("a stance switch keeps the shotgun's loaded shells, only the round being loaded is lost", () => {
		const s = state(0);
		const firstMs = RANGED_WEAPONS.shotgun.reloadFirstRoundMs ?? 0;
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
		// Back on the gun, the reload restarts from the shell that was being
		// loaded — the one that already landed stays loaded.
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

	it("the reload draws only what the reserve has left, then the gun is dry", () => {
		const s = state(0, 5);
		// Five rounds, one per call — a call with a huge dt lands exactly one.
		for (let i = 0; i < 6; i++) {
			tickReload(
				s,
				{ attack: false },
				{ ranged: RANGED_WEAPONS.rifle } as never,
				0.5,
			);
		}
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
