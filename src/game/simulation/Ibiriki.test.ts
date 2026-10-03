/**
 * Ibiriki's kit, in the shared simulation: the hew chain, the Sunder's guard
 * crush, the berserk frenzy, the bloodlust's speed, the axes and the rupture's
 * bleed. See specs/ibiriki.md.
 */
import { describe, expect, it } from "vitest";
import {
	GUARD_CRUSH_DAMAGE_FRACTION,
	GUARD_CRUSH_STUN_MS,
	SUNDER_CHARGE_MS,
} from "../../tweakables/melee.js";
import {
	BERSERK_FRACTION,
	BLOODLUST_ATTACK_SPEED_BONUS,
	BLOODLUST_MOVE_SPEED_BONUS,
} from "../../tweakables/passive.js";
import {
	AXE_CHARGE_MS,
	AXE_MIN_DAMAGE,
	AXE_MIN_SPEED,
	RANGED_WEAPONS,
} from "../../tweakables/ranged.js";
import {
	RUPTURE_DAMAGE_PER_PX,
	RUPTURE_TELEPORT_PX,
} from "../../tweakables/ultimate.js";
import { buildWorld } from "./Arena.js";
import {
	axePickable,
	axeThrowFor,
	axeTouches,
	dropAxe,
	launchAxe,
	tickAxe,
} from "./Axes.js";
import { kitFor } from "./Heroes.js";
import {
	applyMeleeResult,
	createMeleeState,
	isBerserk,
	type MeleeState,
	MOVES,
	meleeHaste,
	moveDuration,
	resolveMelee,
	tickMelee,
} from "./Melee.js";
import { bloodlustFor } from "./Passive.js";
import {
	createPlayerState,
	NEUTRAL_INTENT,
	PLAYER_WIDTH,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics.js";
import { ruptureBleed } from "./Ultimate.js";

const DT = 1 / 60;
const KIT = kitFor("ibiriki");
const VIKING = KIT.melee;

function intent(overrides: Partial<PlayerIntent> = {}): PlayerIntent {
	return { ...NEUTRAL_INTENT, ...overrides };
}

type Body = MeleeState & {
	x: number;
	y: number;
	vx: number;
	vy: number;
	grounded: boolean;
	bloodlust?: number;
};

function body(x: number, facing = 1, extra: Partial<Body> = {}): Body {
	return {
		...createMeleeState(facing),
		x,
		y: 400,
		vx: 0,
		vy: 0,
		grounded: true,
		...extra,
	};
}

/** Tick a bare melee body until `pred` holds or `maxTicks` run out. */
function tickUntil(
	s: Body,
	input: PlayerIntent,
	pred: (s: Body) => boolean,
	maxTicks = 200,
): number {
	for (let i = 0; i < maxTicks; i++) {
		if (pred(s)) return i;
		tickMelee(s, input, DT, VIKING);
	}
	return -1;
}

describe("Ibiriki's kit", () => {
	it("is the viking sword, the axes, Rupture, the trap, and the bloodlust", () => {
		expect(KIT.melee.id).toBe("viking");
		expect(KIT.ranged.id).toBe("axe");
		expect(KIT.ultimate).toBe("rupture");
		expect(KIT.item.id).toBe("trap");
		expect(KIT.passive).toBe("bloodlust");
		for (const hero of ["lia", "anands", "jeffs"] as const) {
			expect(kitFor(hero).passive).toBeNull();
		}
	});
});

describe("the hew chain", () => {
	it("is heavier than the slash chain: more damage, more hitstun, slower", () => {
		expect(MOVES.hew.damage).toBeGreaterThan(MOVES.slash.damage);
		expect(MOVES.hew.hitstunMs).toBeGreaterThan(MOVES.slash.hitstunMs);
		expect(moveDuration("hew")).toBeGreaterThan(moveDuration("slash"));
		const hew = MOVES.hew3.damage + MOVES.hew.damage + MOVES.hew2.damage;
		const slash =
			MOVES.slash.damage + MOVES.slash2.damage + MOVES.slash3.damage;
		expect(hew).toBeGreaterThan(slash);
	});

	it("covers the gap to the next link's hitbox with each link's hitstun", () => {
		// The next link chains from this one's recovery and opens after its own
		// startup — the hitstun must outlast that gap or the chain is two swings.
		const links = ["hew", "hew2", "hew3"] as const;
		for (let i = 0; i < links.length - 1; i++) {
			const a = MOVES[links[i] as "hew"];
			const b = MOVES[links[i + 1] as "hew2"];
			const gap = a.activeMs + b.startupMs;
			expect(a.hitstunMs).toBeGreaterThan(gap);
		}
	});

	it("ends the finisher in neutral: knockdown equals active + recovery", () => {
		const d = MOVES.hew3;
		expect(d.knockdownMs).toBe(d.activeMs + d.recoveryMs);
	});

	it("chains hew → hew2 → hew3 on repeated presses from recovery", () => {
		const s = body(100);
		const seen: string[] = [];
		let held = false;
		for (let i = 0; i < 200; i++) {
			// Press on each recovery, release otherwise.
			const inRecovery =
				s.meleeAction !== "none" &&
				s.meleeTimer >=
					MOVES[s.meleeAction].startupMs + MOVES[s.meleeAction].activeMs;
			const press: boolean =
				s.meleeAction === "none" ? !held : inRecovery && !held;
			tickMelee(s, intent({ attack: press }), DT, VIKING);
			held = press;
			if (s.meleeAction !== "none" && seen.at(-1) !== s.meleeAction) {
				seen.push(s.meleeAction);
			}
			if (seen.length === 3) break;
		}
		expect(seen).toEqual(["hew", "hew2", "hew3"]);
	});
});

describe("the Sunder", () => {
	it("arms after SUNDER_CHARGE_MS and fires on the release", () => {
		const s = body(100);
		const held = intent({ attack: true });
		const armedAt = tickUntil(s, held, (b) => b.massiveReady);
		expect(armedAt).toBeGreaterThan(0);
		expect(armedAt * DT * 1000).toBeGreaterThanOrEqual(SUNDER_CHARGE_MS - 20);
		tickMelee(s, intent(), DT, VIKING);
		expect(s.meleeAction).toBe("sunder");
	});

	it("is swung in the air too — no plunge bomb on this sword", () => {
		const s = body(100, 1, { grounded: false });
		tickUntil(s, intent({ attack: true }), (b) => b.massiveReady);
		tickMelee(s, intent(), DT, VIKING);
		expect(s.meleeAction).toBe("sunder");
		expect(s.plunging).toBe(false);
	});

	it("crushes a front guard: a fraction of the damage and a mini stun, no guard break", () => {
		const attacker = body(100, 1, {
			meleeAction: "sunder",
			meleeTimer: MOVES.sunder.startupMs + 1,
		});
		const defender = body(100 + PLAYER_WIDTH + 20, -1, { blocking: true });
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("crushed");
		if (!result) return;
		expect(result.damage).toBe(
			Math.round(MOVES.sunder.damage * GUARD_CRUSH_DAMAGE_FRACTION),
		);
		const dealt = applyMeleeResult(attacker, defender, result);
		expect(dealt).toBe(result.damage);
		expect(defender.stunTimer).toBe(GUARD_CRUSH_STUN_MS);
		expect(defender.blocking).toBe(false);
		expect(attacker.stunTimer).toBe(0);
		expect(attacker.guardBroken).toBe(false);
	});

	it("a hew into the same guard is still a guard break", () => {
		const attacker = body(100, 1, {
			meleeAction: "hew",
			meleeTimer: MOVES.hew.startupMs + 1,
		});
		const defender = body(100 + PLAYER_WIDTH + 20, -1, { blocking: true });
		expect(resolveMelee(attacker, defender)?.outcome).toBe("parried");
	});
});

describe("bloodlust and berserk", () => {
	it("maps the weakest foe's HP to 0..1, full at the berserk line", () => {
		expect(bloodlustFor(null)).toBe(0);
		expect(bloodlustFor(1)).toBe(0);
		expect(bloodlustFor(0.9)).toBe(0);
		expect(bloodlustFor(0.6)).toBeCloseTo(0.5, 2);
		expect(bloodlustFor(BERSERK_FRACTION)).toBe(1);
		expect(bloodlustFor(0.05)).toBe(1);
	});

	it("is monotonic: a weaker foe never means less bloodlust", () => {
		let last = -1;
		for (let f = 1; f >= 0; f -= 0.01) {
			const b = bloodlustFor(f);
			expect(b).toBeGreaterThanOrEqual(last);
			last = b;
		}
	});

	it("speeds the melee clock by the attack-speed bonus", () => {
		expect(meleeHaste({ bloodlust: 0 })).toBe(1);
		expect(meleeHaste({ bloodlust: 1 })).toBeCloseTo(
			1 + BLOODLUST_ATTACK_SPEED_BONUS,
		);
		const calm = body(100);
		const hungry = body(100, 1, { bloodlust: 1 });
		tickMelee(calm, intent({ attack: true }), DT, VIKING);
		tickMelee(hungry, intent({ attack: true }), DT, VIKING);
		for (let i = 0; i < 5; i++) {
			tickMelee(calm, intent({ attack: true }), DT, VIKING);
			tickMelee(hungry, intent({ attack: true }), DT, VIKING);
		}
		expect(hungry.meleeTimer).toBeGreaterThan(calm.meleeTimer);
	});

	it("speeds the walk by the move-speed bonus", () => {
		const walk = (bloodlust: number) => {
			// An empty room: the walk's top speed, with no pillar to meet.
			const open = { ...buildWorld(1), platforms: [] };
			let s: PlayerPosition = { ...createPlayerState(100, 552), bloodlust };
			let top = 0;
			for (let i = 0; i < 30; i++) {
				s = tickPlayer(s, intent({ right: true }), DT, open, null, KIT);
				top = Math.max(top, s.vx);
			}
			return top;
		};
		expect(walk(1) / walk(0)).toBeCloseTo(1 + BLOODLUST_MOVE_SPEED_BONUS, 2);
	});

	it("runs the frenzy chain while berserk, the hew chain otherwise", () => {
		const s = body(100, 1, { bloodlust: 1 });
		expect(isBerserk(s)).toBe(true);
		tickMelee(s, intent({ attack: true }), DT, VIKING);
		expect(s.meleeAction).toBe("rend");
		const calm = body(100);
		tickMelee(calm, intent({ attack: true }), DT, VIKING);
		expect(calm.meleeAction).toBe("hew");
	});

	it("is fast: every frenzy link is quicker than a slash", () => {
		for (const m of ["rend", "rend2"] as const) {
			expect(moveDuration(m)).toBeLessThan(moveDuration("slash"));
		}
	});
});

describe("the throwing axe", () => {
	const world = buildWorld(1);
	/** The arena's bounds with nothing in them: a flight with no furniture. */
	const open = { ...world, platforms: [] };

	it("scales speed and damage with the charge, tap to full", () => {
		const tap = axeThrowFor(0);
		const full = axeThrowFor(AXE_CHARGE_MS);
		expect(tap.speed).toBe(AXE_MIN_SPEED);
		expect(tap.damage).toBe(AXE_MIN_DAMAGE);
		expect(tap.full).toBe(false);
		expect(full.speed).toBe(RANGED_WEAPONS.axe.speed);
		expect(full.damage).toBe(RANGED_WEAPONS.axe.damage);
		expect(full.full).toBe(true);
	});

	it("is ten a life with no reserve", () => {
		expect(RANGED_WEAPONS.axe.magazine).toBe(10);
		expect(RANGED_WEAPONS.axe.magazinesPerLife).toBe(1);
	});

	it("flies an arc and sticks in the floor, then never moves again", () => {
		const a = launchAxe(1, "ibi", null, 100, 400, -Math.PI / 4, 0);
		let stuckAt = -1;
		for (let i = 0; i < 600; i++) {
			if (tickAxe(a, DT, world)) {
				stuckAt = i;
				break;
			}
		}
		expect(stuckAt).toBeGreaterThan(0);
		expect(a.resting).toBe(true);
		const { x, y } = a;
		tickAxe(a, DT, world);
		expect(a.x).toBe(x);
		expect(a.y).toBe(y);
	});

	it("a full charge flies much farther than a tap", () => {
		const range = (charge: number) => {
			const a = launchAxe(1, "ibi", null, 20, 580, -Math.PI / 6, charge);
			for (let i = 0; i < 900 && !a.resting; i++) tickAxe(a, DT, open);
			return a.x - 60;
		};
		expect(range(AXE_CHARGE_MS)).toBeGreaterThan(range(0) * 2.5);
	});

	it("never sticks in the sky: a ceiling scrapes it back down", () => {
		const a = launchAxe(1, "ibi", null, 400, 60, -Math.PI / 2, AXE_CHARGE_MS);
		for (let i = 0; i < 900 && !a.resting; i++) tickAxe(a, DT, open);
		expect(a.resting).toBe(true);
		expect(a.y).toBeGreaterThan(open.bottom - 20);
	});

	it("hits hostiles only, and a dropped axe hits nobody", () => {
		const a = launchAxe(1, "ibi", 0, 100, 400, 0, 0);
		expect(axeTouches(a, "foe", 1, 100, 380)).toBe(true);
		expect(axeTouches(a, "mate", 0, 100, 380)).toBe(false);
		expect(axeTouches(a, "ibi", 0, 100, 380)).toBe(false);
		dropAxe(a);
		expect(axeTouches(a, "foe", 1, 100, 380)).toBe(false);
	});

	it("only its owner picks it up, and only at rest", () => {
		const a = launchAxe(1, "ibi", null, 100, 400, 0, 0);
		expect(axePickable(a, "ibi", 90, 380)).toBe(false);
		a.resting = true;
		expect(axePickable(a, "ibi", 90, 380)).toBe(true);
		expect(axePickable(a, "someone", 90, 380)).toBe(false);
		expect(axePickable(a, "ibi", 400, 380)).toBe(false);
	});

	it("charges on a held attack in gun stance, and the release resets it", () => {
		let s: PlayerPosition = {
			...createPlayerState(200, 520),
			stance: "gun",
			ammo: 10,
		};
		const hold = intent({ attack: true, swordStance: false });
		for (let i = 0; i < 30; i++)
			s = tickPlayer(s, hold, DT, undefined, null, KIT);
		expect(s.throwChargeTimer).toBeGreaterThan(400);
		s = tickPlayer(s, intent({ swordStance: false }), DT, undefined, null, KIT);
		expect(s.throwChargeTimer).toBe(0);
	});

	it("does not charge with no axes in hand", () => {
		let s: PlayerPosition = {
			...createPlayerState(200, 520),
			stance: "gun",
			ammo: 0,
		};
		const hold = intent({ attack: true, swordStance: false });
		for (let i = 0; i < 10; i++)
			s = tickPlayer(s, hold, DT, undefined, null, KIT);
		expect(s.throwChargeTimer).toBe(0);
	});

	it("a gun never charges a throw", () => {
		let s: PlayerPosition = {
			...createPlayerState(200, 520),
			stance: "gun",
			ammo: 10,
		};
		const hold = intent({ attack: true, swordStance: false });
		for (let i = 0; i < 10; i++) {
			s = tickPlayer(s, hold, DT, undefined, null, kitFor("lia"));
		}
		expect(s.throwChargeTimer).toBe(0);
	});
});

describe("the rupture", () => {
	it("bleeds per pixel moved, and nothing standing still", () => {
		expect(ruptureBleed(0, 0)).toBe(0);
		expect(ruptureBleed(100, 0)).toBeCloseTo(100 * RUPTURE_DAMAGE_PER_PX);
		expect(ruptureBleed(3, 4)).toBeCloseTo(5 * RUPTURE_DAMAGE_PER_PX);
	});

	it("never bleeds a teleport", () => {
		expect(ruptureBleed(RUPTURE_TELEPORT_PX + 1, 0)).toBe(0);
	});

	it("a stomp roots the caster and holds the sword", () => {
		let s: PlayerPosition = { ...createPlayerState(200, 520), stompTimer: 300 };
		for (let i = 0; i < 5; i++) {
			s = tickPlayer(
				s,
				intent({ right: true, attack: true }),
				DT,
				undefined,
				null,
				KIT,
			);
		}
		expect(s.vx).toBe(0);
		expect(s.meleeAction).toBe("none");
	});
});
