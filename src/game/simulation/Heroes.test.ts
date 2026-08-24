/**
 * The hero kit: what each hero's weapons are, and the dagger's whole moveset —
 * stab spam, the thrust sweep, the shoryuken gate, the machine gun, and the
 * dragon-thrust ride. The sword's own behaviour is covered by Melee.test.ts
 * and Physics.test.ts; these are the rules that exist because there is a
 * second hero.
 */

import { describe, expect, it } from "vitest";
import { pelletDamageAt } from "../../tweakables/ranged.js";
import { buildWorld } from "./Arena.js";
import type { MeleeBody } from "./Melee.js";
import {
	applyHitToDefender,
	applyMeleeResult,
	bodyRect,
	createPlayerState,
	DAGGER_DASH_DURATION_MS,
	DAGGER_DASH_LOCKOUT_MS,
	DAGGER_DASH_SPEED,
	DRAGON_RIDE_MS,
	DRAGON_SPEED,
	dragonSweptRect,
	dragonVelocity,
	isKnockedDown,
	kitFor,
	LIA_KIT,
	MELEE_WEAPONS,
	MOVES,
	meleePhase,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	RANGED_WEAPONS,
	rectsOverlap,
	resolveMelee,
	SINGULARITY_HOLD_STUN_MS,
	type Singularity,
	sweptThrustBox,
	tickPlayer,
} from "./Physics.js";

const DT = 1 / 60;
const WORLD = buildWorld(1);
const KIT = kitFor("anands");

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
	field: Singularity | null = null,
): PlayerPosition {
	return tickPlayer(p, input(i), dt, WORLD, field, KIT);
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

/** A dagger fighter planted on the ground at x=100, facing right. */
function dagger(overrides: Partial<PlayerPosition> = {}): PlayerPosition {
	return state({
		x: 100,
		y: 400,
		grounded: true,
		airJumps: 1,
		...overrides,
	});
}

function body(s: PlayerPosition): MeleeBody {
	return { ...s } as MeleeBody;
}

/** Assert a sweep exists and hand it back without a non-null assertion. */
function swept(
	box: ReturnType<typeof sweptThrustBox>,
): NonNullable<ReturnType<typeof sweptThrustBox>> {
	expect(box).not.toBeNull();
	return box as NonNullable<typeof box>;
}

describe("hero registry", () => {
	it("Lia carries the sword kit, unchanged", () => {
		expect(LIA_KIT.hero).toBe("lia");
		expect(LIA_KIT.melee).toBe(MELEE_WEAPONS.sword);
		expect(LIA_KIT.ranged).toBe(RANGED_WEAPONS.rifle);
		expect(LIA_KIT.ultimate).toBe("black-hole");
		expect(LIA_KIT.item.id).toBe("he-grenade");
	});

	it("Anands carries the dagger kit", () => {
		const kit = kitFor("anands");
		expect(kit.melee).toBe(MELEE_WEAPONS.dagger);
		expect(kit.ranged).toBe(RANGED_WEAPONS.machinegun);
		expect(kit.ultimate).toBe("dragon-thrust");
		expect(kit.item.id).toBe("trap");
	});

	it("Jeffs carries the sword and the shotgun, the storm and the smoke", () => {
		const kit = kitFor("jeffs");
		// The blade is the blade: the exact same table Lia's sword stance uses.
		expect(kit.melee).toBe(MELEE_WEAPONS.sword);
		expect(kit.ranged).toBe(RANGED_WEAPONS.shotgun);
		expect(kit.ultimate).toBe("death-blossom");
		expect(kit.item.id).toBe("smoke-grenade");
	});

	it("the shotgun is slow, lethal and fanned: a deterministic spread", () => {
		const shotgun = RANGED_WEAPONS.shotgun;
		// The delay is the weapon: nearly four pistol shots between blasts.
		expect(shotgun.cooldownMs).toBeGreaterThan(
			RANGED_WEAPONS.rifle.cooldownMs * 3,
		);
		// Point blank is lethal: all six pellets at 17 land 102 — a full bar.
		expect(shotgun.pellets).toBe(6);
		expect((shotgun.pellets ?? 1) * shotgun.damage).toBeGreaterThanOrEqual(100);
		// A pellet is a fast round — the fan must arrive before it drifts off.
		expect(shotgun.speed).toBeGreaterThan(RANGED_WEAPONS.rifle.speed);
		// The cone is fixed at the muzzle: no randomness to desync over.
		expect(shotgun.spreadDeg).toBeGreaterThan(0);
	});

	it("the shotgun's damage falls off with distance — lethal only at point blank", () => {
		const shotgun = RANGED_WEAPONS.shotgun;
		expect(shotgun.falloffStartPx).toBeDefined();
		expect(shotgun.falloffEndPx).toBeDefined();
		const start = shotgun.falloffStartPx ?? 0;
		const end = shotgun.falloffEndPx ?? 0;

		// The blast is a one-shot at the muzzle and for the first start px.
		expect(pelletDamageAt(shotgun, 0)).toBe(shotgun.damage);
		expect(pelletDamageAt(shotgun, start)).toBe(shotgun.damage);
		expect(
			(shotgun.pellets ?? 1) * pelletDamageAt(shotgun, start),
		).toBeGreaterThanOrEqual(100);

		// Past the start it slides toward the floor: at 100px a pellet is down
		// from 17 to 13 — a reduced hit, and a blast there is ~half a bar once
		// the fan's edge pellets have already left the body (4 × 13 = 52).
		expect(pelletDamageAt(shotgun, 100)).toBeLessThan(shotgun.damage);
		expect(pelletDamageAt(shotgun, 100)).toBeGreaterThanOrEqual(
			shotgun.minDamage ?? 0,
		);

		// At the far end it has hit the floor and stays there — a warning shot.
		expect(pelletDamageAt(shotgun, end)).toBe(shotgun.minDamage);
		expect(pelletDamageAt(shotgun, end * 2)).toBe(shotgun.minDamage);
		expect(shotgun.minDamage ?? 0).toBeLessThan(shotgun.damage);
	});

	it("falloff is a shotgun rule only: a rifle round is its card damage at any range", () => {
		const rifle = RANGED_WEAPONS.rifle;
		expect(rifle.falloffStartPx).toBeUndefined();
		expect(pelletDamageAt(rifle, 0)).toBe(rifle.damage);
		expect(pelletDamageAt(rifle, 500)).toBe(rifle.damage);
	});

	it("the machine gun fires faster than the pistol and hits weaker", () => {
		expect(RANGED_WEAPONS.machinegun.cooldownMs).toBeLessThan(
			RANGED_WEAPONS.rifle.cooldownMs,
		);
		expect(RANGED_WEAPONS.machinegun.damage).toBeLessThan(
			RANGED_WEAPONS.rifle.damage,
		);
		expect(RANGED_WEAPONS.machinegun.speed).toBeGreaterThan(
			RANGED_WEAPONS.rifle.speed,
		);
	});

	it("the dagger's dash is quicker than the sword's", () => {
		expect(DAGGER_DASH_SPEED).toBeGreaterThan(1000);
		expect(DAGGER_DASH_LOCKOUT_MS).toBeLessThan(250);
		expect(DAGGER_DASH_DURATION_MS).toBeLessThan(160);
	});
});

describe("the dagger stab", () => {
	it("is a fast, weak poke with a short stun", () => {
		const def = MOVES.stab;
		expect(def.damage).toBeLessThan(MOVES.slash.damage);
		expect(def.startupMs).toBeLessThan(MOVES.slash.startupMs);
		expect(def.recoveryMs).toBeLessThan(MOVES.slash.recoveryMs);
		expect(def.hitstunMs).toBeLessThan(MOVES.slash.hitstunMs);
		expect(def.reachPx).toBeLessThan(MOVES.slash.reachPx);
	});

	it("spams: each press edge starts a fresh stab", () => {
		let s = dagger();
		s = ticks(s, { attack: true }, 2);
		expect(s.meleeAction).toBe("stab");
		// Release, then press again — the spam rhythm.
		s = ticks(s, {}, 12); // past the whole stab: 190ms ≈ 12 ticks
		expect(s.meleeAction).toBe("none");
		s = ticks(s, { attack: true }, 2);
		expect(s.meleeAction).toBe("stab");
	});

	it("is stopped by a sword guard — the guard break hits the dagger", () => {
		const attacker = body(
			dagger({
				meleeAction: "stab",
				meleeTimer: MOVES.stab.startupMs + 10,
			}),
		);
		const defender = body(
			state({
				x: 140,
				y: 400,
				grounded: true,
				facing: -1,
				blocking: true,
			}),
		);
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("parried");
		if (!result) throw new Error("expected a parry result");
		const damage = applyMeleeResult(attacker, defender, result);
		expect(damage).toBe(0);
		// The sword's guard breaks the dagger for a full second and arms the
		// defender a Massive: the spam has an answer.
		expect(attacker.stunTimer).toBeGreaterThan(900);
		expect(defender.massiveReady).toBe(true);
	});
});

describe("the thrust", () => {
	it("is the dagger's Shift move: a block press starts it, holding does not repeat", () => {
		let s = dagger();
		s = ticks(s, { block: true }, 1);
		expect(s.meleeAction).toBe("thrust");
		expect(meleePhase(s)).toBe("startup");
		// Held through the whole move: no second thrust.
		s = ticks(s, { block: true }, 100);
		expect(s.meleeAction).toBe("none");
	});

	it("has a long anticipation, then dashes flat along the facing", () => {
		let s = dagger();
		s = ticks(s, { block: true }, 1);
		// During startup the body does not move.
		const before = s.x;
		s = ticks(s, {}, Math.floor(MOVES.thrust.startupMs / (1000 * DT)) - 1);
		expect(Math.abs(s.x - before)).toBeLessThan(1);

		// Through the active window the body travels at selfVx.
		const start = s.x;
		s = ticks(s, {}, Math.floor(MOVES.thrust.activeMs / (1000 * DT)));
		expect(s.x - start).toBeGreaterThan((MOVES.thrust.selfVx ?? 0) * 0.12);
		expect(s.vx).toBeCloseTo(MOVES.thrust.selfVx ?? 0);
	});

	it("an airborne thrust does not fall — it is a flat line, like a dash", () => {
		// Open air at x=100, y=300: clear of every platform on the way down.
		let s = dagger({ grounded: false, y: 300, vy: 0, x: 100 });
		s = ticks(s, { block: true }, 1);
		// Through the startup the fighter falls normally…
		s = ticks(s, {}, Math.floor(MOVES.thrust.startupMs / (1000 * DT)) - 1);
		expect(s.y).toBeGreaterThan(340);
		// …then the active window pins the line: no further fall.
		const lineY = s.y;
		s = ticks(s, {}, Math.floor(MOVES.thrust.activeMs / (1000 * DT)));
		expect(Math.abs(s.y - lineY)).toBeLessThan(0.001);
	});

	it("is unblockable: a raised guard cannot stop the lunge", () => {
		const attacker = dagger({
			meleeAction: "thrust",
			meleeTimer: MOVES.thrust.startupMs + 10,
		});
		const defender = body(
			state({
				x: 140,
				y: 400,
				facing: -1,
				blocking: true,
			}),
		);
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("hit");
	});

	it("sweeps: the swept box covers the whole path taken so far", () => {
		const s = dagger({
			meleeAction: "thrust",
			// Mid-active: 70ms into the dash.
			meleeTimer: MOVES.thrust.startupMs + 70,
			hitLatch: false,
		});
		const travelled = (70 / 1000) * (MOVES.thrust.selfVx ?? 0);
		const box = swept(sweptThrustBox(s));
		// The body's original spot is inside the sweep…
		expect(rectsOverlap(box, bodyRect(s.x - travelled, s.y))).toBe(true);
		// …and the reach ahead is too, but a distant fighter is not.
		expect(rectsOverlap(box, bodyRect(s.x + 36, s.y))).toBe(true);
		expect(rectsOverlap(box, bodyRect(s.x + 400, s.y))).toBe(false);
	});

	it("knocks down everyone in its path, without spending a single-hit latch", () => {
		const attacker = body(
			dagger({
				meleeAction: "thrust",
				meleeTimer: MOVES.thrust.startupMs + 70,
			}),
		);
		const first = body(state({ x: 150, y: 400 }));
		const second = body(state({ x: 180, y: 400 }));
		const d1 = applyHitToDefender(first, {
			move: "thrust",
			outcome: "hit",
			damage: MOVES.thrust.damage,
			x: 150,
			y: 400,
			dir: 1,
		});
		const d2 = applyHitToDefender(second, {
			move: "thrust",
			outcome: "hit",
			damage: MOVES.thrust.damage,
			x: 180,
			y: 400,
			dir: 1,
		});
		expect(d1).toBe(MOVES.thrust.damage);
		expect(d2).toBe(MOVES.thrust.damage);
		expect(first.knockdownTimer).toBe(MOVES.thrust.knockdownMs);
		expect(second.knockdownTimer).toBe(MOVES.thrust.knockdownMs);
		expect(isKnockedDown(first)).toBe(true);
		// The attacker's latch was never spent: the sweep can go on.
		expect(attacker.hitLatch).toBe(false);
	});

	it("its knockdown lasts a full second and a half", () => {
		expect(MOVES.thrust.knockdownMs).toBe(1500);
	});
});

describe("the shoryuken", () => {
	it("is the dagger's F move and gives a weaker knockdown", () => {
		const def = MOVES.shoryuken;
		expect(def.knockdownMs).toBe(900);
		expect(def.knockdownMs).toBeLessThan(MOVES.thrust.knockdownMs ?? 0);
	});

	it("is blockable, unlike the sword's uppercut", () => {
		const attacker = dagger({
			meleeAction: "shoryuken",
			meleeTimer: MOVES.shoryuken.startupMs + 10,
		});
		const defender = body(
			state({ x: 140, y: 400, facing: -1, blocking: true }),
		);
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("parried");
	});

	it("fires on F while the second jump is in hand", () => {
		let s = dagger();
		s = ticks(s, { uppercut: true }, 1);
		expect(s.meleeAction).toBe("shoryuken");
	});

	it("is refused once the second jump is spent — it is not a third jump", () => {
		let s = dagger({ airJumps: 0 });
		s = ticks(s, { uppercut: true }, 1);
		expect(s.meleeAction).toBe("none");
		// And it does not consume the jump it requires.
		let t = dagger({ airJumps: 1 });
		t = ticks(t, { uppercut: true }, 1);
		expect(t.airJumps).toBe(1);
	});

	it("rises through its active window, then falls in recovery", () => {
		let s = dagger();
		s = ticks(s, { uppercut: true }, 1);
		const startY = s.y;
		// 14 ticks cover the whole active window (90+140ms): the rise pins for
		// ~8 of them.
		s = ticks(s, {}, 14);
		expect(s.y).toBeLessThan(startY - 40);
	});

	it("reaches into the air: its hitbox starts above the head", () => {
		expect(MOVES.shoryuken.boxTopOffset).toBeLessThan(-40);
		expect(MOVES.shoryuken.boxHeight).toBeGreaterThan(80);
	});
});

describe("the dragon thrust", () => {
	it("rides the launch angle at speed, gravity suppressed", () => {
		const dir = dragonVelocity(-Math.PI / 2); // straight up
		expect(dir.vy).toBeCloseTo(-DRAGON_SPEED);
		// Open ground at x=240: no platform above the first 100px of sky.
		let s = dagger({
			x: 240,
			y: 480,
			grounded: false,
			dragonTimer: DRAGON_RIDE_MS,
			dragonVX: dir.vx,
			dragonVY: dir.vy,
		});
		const before = s.y;
		s = ticks(s, {}, 5);
		expect(s.y).toBeLessThan(before - 100); // 1500 px/s for 83ms
		expect(s.vy).toBeCloseTo(-DRAGON_SPEED);
	});

	it("is stopped by a wall: the range is until an obstacle", () => {
		let s = dagger({
			x: 700,
			y: 400,
			dragonTimer: DRAGON_RIDE_MS,
			dragonVX: DRAGON_SPEED,
			dragonVY: 0,
		});
		s = ticks(s, {}, 30);
		expect(s.dragonTimer).toBe(0);
		expect(s.x).toBeLessThanOrEqual(WORLD.right);
	});

	it("endures the commitment when launched into the floor at its feet", () => {
		// A grounded caster releasing into the floor is already in contact with
		// the obstacle at launch. Without the minimum the ride ended on the
		// launch's own first tick: zero ticks long, no lunge, no flight — a
		// spent ultimate with no visible cast at all. The minimum keeps the
		// ride alive past the first tick, and the obstacle claims it once it
		// has flown.
		let s = dagger({
			dragonTimer: DRAGON_RIDE_MS,
			dragonVX: 0,
			dragonVY: DRAGON_SPEED,
		});
		s = ticks(s, {}, 1);
		expect(s.dragonTimer).toBeGreaterThan(0);
		// 200ms of commitment: 12 ticks at 60Hz, 14 covers the clock jitter.
		s = ticks(s, {}, 14);
		expect(s.dragonTimer).toBe(0);
		expect(s.vx).toBe(0);
		expect(s.vy).toBe(0);
	});

	it("sweeps the whole path: the swept box reaches back to the launch point", () => {
		const s = {
			x: 400,
			y: 300,
			dragonTimer: DRAGON_RIDE_MS / 2,
			dragonVX: DRAGON_SPEED,
			dragonVY: 0,
		};
		const box = swept(dragonSweptRect(s));
		// 450ms travelled at 1500 px/s = 675px back to the launch point.
		expect(rectsOverlap(box, bodyRect(s.x - 600, s.y))).toBe(true);
		expect(rectsOverlap(box, bodyRect(s.x + 40, s.y))).toBe(true);
		expect(rectsOverlap(box, bodyRect(s.x + 900, s.y))).toBe(false);
	});

	it("expiring the ride leaves the rider with no carried speed", () => {
		let s = dagger({
			x: 400,
			y: 400,
			grounded: false,
			dragonTimer: 30,
			dragonVX: DRAGON_SPEED,
			dragonVY: 0,
		});
		s = ticks(s, {}, 3);
		expect(s.dragonTimer).toBe(0);
		expect(s.vx).toBe(0);
	});

	it("the only thing that stops it early is a hostile black hole", () => {
		const field: Singularity = {
			id: 1,
			ownerId: "other",
			ownerTeam: null,
			x: 400,
			y: 400,
			remainingMs: 1000,
		};
		let s = dagger({
			x: 400,
			y: 400,
			grounded: false,
			dragonTimer: DRAGON_RIDE_MS,
			dragonVX: DRAGON_SPEED,
			dragonVY: 0,
		});
		s = tick(s, {}, DT, field);
		expect(s.dragonTimer).toBe(0);
		// The hold's stun, minus the one tick tickMelee already decayed.
		expect(s.stunTimer).toBeGreaterThan(SINGULARITY_HOLD_STUN_MS - 20);
	});
});

describe("dagger burst", () => {
	it("uses the dagger's own dash numbers", () => {
		let s = dagger();
		s = ticks(s, { dash: 1 }, 1);
		expect(s.vx).toBe(DAGGER_DASH_SPEED);
		expect(s.dashActiveTimer).toBe(DAGGER_DASH_DURATION_MS);
		expect(s.dashTimer).toBe(DAGGER_DASH_LOCKOUT_MS);
	});
});
