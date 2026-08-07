import { describe, expect, it } from "vitest";
import {
	applyMeleeResult,
	BACKSTAB_BONUS_STUN_MS,
	BACKSTAB_MIN_SEPARATION_PX,
	BLOCK_STARTUP_MS,
	blocksBullet,
	blocksUltimate,
	bombBlastFor,
	CHARGE_LOCK_MS,
	COMBO_CHAIN,
	COMBO_LINK_MS,
	createMeleeState,
	GUARD_BREAK_STUN_MS,
	isBehind,
	isCancellable,
	isCharging,
	isCommitted,
	KNOCKDOWN_MS,
	MASSIVE_CHARGE_MS,
	MASSIVE_SLAM_OFFSET_PX,
	MELEE_IFRAME_MS,
	type MeleeIntent,
	type MeleeMove,
	type MeleeResult,
	type MeleeState,
	MOVES,
	massiveSlamPoint,
	meleeHitbox,
	meleePhase,
	moveDuration,
	PARRY_MASSIVE_LIFETIME_MS,
	PLUNGE_BLAST_BASE_RADIUS_PX,
	PLUNGE_BLAST_MAX_RADIUS_PX,
	PLUNGE_KNOCKUP_BASE,
	PLUNGE_KNOCKUP_MAX,
	PLUNGE_SPEED,
	PLUNGE_STUCK_BASE_MS,
	PLUNGE_STUCK_MAX_MS,
	PLUNGE_STUN_BASE_MS,
	PLUNGE_STUN_MAX_MS,
	resolveMelee,
	tickMelee,
} from "./Melee.js";
import {
	BULLET_SPEED,
	createPlayerState,
	DASH_SPEED,
	JUMP_VELOCITY,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics.js";

const DT = 1 / 60;
const DT_MS = (DT * 1000) as number;

function intent(overrides: Partial<PlayerIntent> = {}): PlayerIntent {
	return { ...NEUTRAL_INTENT, ...overrides };
}

/**
 * Assert a swing connected, and hand back the result.
 *
 * `resolveMelee` returns null for a miss, so every call site otherwise needs a
 * non-null assertion — which silently turns "the hitbox stopped connecting" into
 * a null-deref several lines later instead of a failed expectation here.
 */
function connects(result: MeleeResult | null): MeleeResult {
	expect(result).not.toBeNull();
	return result as MeleeResult;
}

/** A fighter in open space, well clear of any platform. */
function fighter(overrides: Partial<PlayerPosition> = {}): PlayerPosition {
	return { ...createPlayerState(100, 100), ...overrides };
}

/** Advance melee state only, leaving the body where it is. */
function melee(
	s: PlayerPosition,
	i: Partial<MeleeIntent> = {},
	n = 1,
): PlayerPosition {
	const next = { ...s };
	for (let k = 0; k < n; k++) tickMelee(next, intent(i), DT);
	return next;
}

/** Tick until `predicate` holds, returning the elapsed simulated milliseconds. */
function tickUntil(
	s: PlayerPosition,
	i: Partial<MeleeIntent>,
	predicate: (s: PlayerPosition) => boolean,
	limitMs = 3000,
): { state: PlayerPosition; elapsedMs: number } {
	const state = { ...s };
	let elapsedMs = 0;
	while (!predicate(state) && elapsedMs < limitMs) {
		tickMelee(state, intent(i), DT);
		elapsedMs += DT_MS;
	}
	return { state, elapsedMs };
}

// ---------------------------------------------------------------------------
// Frame data
//
// The phase table is the balance of the game, so it is asserted rather than
// trusted. Each phase is checked to within one tick of its declared length.
// ---------------------------------------------------------------------------

describe("frame data", () => {
	it("runs a slash through startup, active and recovery in order", () => {
		let s = melee(fighter(), { attack: true });
		expect(s.meleeAction).toBe("slash");
		expect(meleePhase(s)).toBe("startup");

		const toActive = tickUntil(s, {}, (x) => meleePhase(x) === "active");
		expect(toActive.elapsedMs).toBeGreaterThanOrEqual(
			MOVES.slash.startupMs - DT_MS,
		);
		expect(toActive.elapsedMs).toBeLessThanOrEqual(
			MOVES.slash.startupMs + DT_MS,
		);

		s = toActive.state;
		const toRecovery = tickUntil(s, {}, (x) => meleePhase(x) === "recovery");
		expect(toRecovery.elapsedMs).toBeLessThanOrEqual(
			MOVES.slash.activeMs + DT_MS,
		);
	});

	it.each(["slash", "uppercut", "massive"] as const)(
		"ends %s within one tick of its declared duration",
		(move) => {
			const key = move === "uppercut" ? "uppercut" : "attack";
			// Massive needs arming first; a guard-break Massive (fires on the
			// press) is the way to start it without a charge.
			const start = fighter(
				move === "massive"
					? { massiveReady: true, parryMassiveTimer: 100, grounded: true }
					: {},
			);
			const s = melee(start, { [key]: true });
			expect(s.meleeAction).toBe(move);

			const done = tickUntil(s, {}, (x) => x.meleeAction === "none");
			const total = moveDuration(move);
			expect(done.elapsedMs).toBeGreaterThanOrEqual(total - 2 * DT_MS);
			expect(done.elapsedMs).toBeLessThanOrEqual(total + DT_MS);
		},
	);

	it("exposes a hitbox only during the active phase", () => {
		let s = melee(fighter(), { attack: true });
		expect(meleeHitbox(s)).toBeNull();

		s = tickUntil(s, {}, (x) => meleePhase(x) === "active").state;
		expect(meleeHitbox(s)).not.toBeNull();

		s = tickUntil(s, {}, (x) => meleePhase(x) === "recovery").state;
		expect(meleeHitbox(s)).toBeNull();
	});

	it("puts the hitbox in front of the fighter, on both facings", () => {
		const right = tickUntil(
			melee(fighter({ facing: 1 }), { attack: true }),
			{},
			(x) => meleePhase(x) === "active",
		).state;
		const left = tickUntil(
			melee(fighter({ facing: -1 }), { attack: true }),
			{},
			(x) => meleePhase(x) === "active",
		).state;

		expect(meleeHitbox(right)?.x).toBeGreaterThanOrEqual(right.x);
		expect(meleeHitbox(left)?.x).toBeLessThan(left.x);
	});
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

describe("attack inputs", () => {
	it("needs a press edge, so holding attack does not chain slashes", () => {
		// One press, held for well over a full slash but far short of the 4s
		// charge: exactly one slash happens.
		let s = melee(fighter(), { attack: true }, 40);
		expect(s.meleeAction).toBe("none");
		expect(s.massiveReady).toBe(false);

		// ...and it does not restart while the button stays down, because no
		// release means no new press edge.
		s = melee(s, { attack: true }, 5);
		expect(s.meleeAction).toBe("none");
	});

	it("arms a Massive Strike after a full charge and fires it on release", () => {
		const charged = tickUntil(
			fighter({ grounded: true }),
			{ attack: true },
			(x) => x.massiveReady,
			6000,
		);
		expect(charged.elapsedMs).toBeGreaterThanOrEqual(MASSIVE_CHARGE_MS - DT_MS);

		const released = melee(charged.state, { attack: false });
		expect(released.meleeAction).toBe("massive");
		expect(released.massiveReady).toBe(false);
	});

	it("fires the charged Massive only on the release, never on the press", () => {
		const charged = tickUntil(
			fighter({ grounded: true }),
			{ attack: true },
			(x) => x.massiveReady,
			6000,
		);
		// The press edge was the opener slash, long spent; a further hold with
		// no release starts nothing.
		const stillHeld = melee(charged.state, { attack: true });
		expect(stillHeld.meleeAction).toBe("none");
		expect(stillHeld.massiveReady).toBe(true);
	});

	it("does not arm a Massive Strike from a tap", () => {
		let s = melee(fighter(), { attack: true });
		s = melee(s, { attack: false });
		expect(s.massiveReady).toBe(false);
		expect(s.chargeTimer).toBe(0);
	});

	it("fires an uppercut on its own key", () => {
		const s = melee(fighter(), { uppercut: true });
		expect(s.meleeAction).toBe("uppercut");
	});
});

describe("the charge", () => {
	it("roots the walk only after the lock-in, so taps stay mobile", () => {
		expect(CHARGE_LOCK_MS).toBeLessThan(MASSIVE_CHARGE_MS);
		// A butterfly-length tap: still below the lock, not charging.
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 3);
		expect(s.meleeTimer).toBeGreaterThan(0);
		expect(isCharging(s)).toBe(false);
	});

	it("unlocks walking once the charge is armed", () => {
		// Accumulation roots the walk. The intent keeps attack held — a tick
		// without it would drop the charge, which is the rule, not a test bug.
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 60);
		expect(isCharging(s)).toBe(true);
		const rooted = tickPlayer(s, intent({ right: true, attack: true }), DT);
		expect(rooted.x).toBe(100);

		// ...but an armed charge is a weapon you carry, not a cast you endure:
		// walking is how the massive gets delivered into range.
		const charged = tickUntil(s, { attack: true }, (x) => x.massiveReady, 6000);
		expect(isCharging(charged.state)).toBe(false);
		const walking = tickPlayer(
			charged.state,
			intent({ right: true, attack: true }),
			DT,
		);
		expect(walking.x).toBeGreaterThan(100);
	});

	it("keeps dash and jump as charge delivery tools", () => {
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 60);
		expect(isCharging(s)).toBe(true);

		// Dash while charging: the burst is how the charge closes distance.
		const dashed = tickPlayer(s, intent({ dash: 1, attack: true }), DT);
		expect(dashed.vx).toBe(DASH_SPEED);

		// Jump while charging: the hop is how the bomb is made. The jump is
		// applied before gravity in the same tick, so the assertion is the
		// launch, not its post-gravity remainder.
		const jumped = tickPlayer(s, intent({ up: true, attack: true }), DT);
		expect(jumped.vy).toBeLessThan(0);
		expect(jumped.grounded).toBe(false);
	});

	it("dashes once armed too — the charge is carried, not endured", () => {
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 60);
		const charged = tickUntil(s, { attack: true }, (x) => x.massiveReady, 6000);
		const dashed = tickPlayer(
			charged.state,
			intent({ dash: 1, attack: true }),
			DT,
		);
		expect(dashed.vx).toBe(DASH_SPEED);
	});

	it("delivers the armed massive: walk, dash, walk — the whole gesture", () => {
		// The training probe's delivery row, reproduced in the pure sim: charge
		// to full, then walk, dash and walk again while holding, then release.
		// The dash is a one-shot on its beat's first tick, like the dummy emits
		// it.
		const beats = [
			{ ms: 150, face: 1 },
			{ ms: 2450, hold: { attack: true }, face: 1 },
			{ ms: 300, hold: { attack: true, moveRight: true }, face: 1 },
			{ ms: 200, hold: { attack: true }, dash: 1, face: 1 },
			{ ms: 300, hold: { attack: true, moveRight: true }, face: 1 },
			{ ms: 60, face: 1 },
			{ ms: 700, face: 1 },
		];
		let s = createPlayerState(300, 480, -1);
		let beatIdx = 0;
		let beatElapsed = 0;
		let beatFresh = true;
		let maxX = s.x;
		let massiveFired = false;
		for (let tick = 0; tick < 700; tick++) {
			const beat = beats[beatIdx % beats.length];
			if (!beat) break;
			s = tickPlayer(
				s,
				intent({
					attack: beat.hold?.attack ?? false,
					right: beat.hold?.moveRight ?? false,
					dash: beat.dash && beatFresh ? beat.dash : 0,
					face: beat.face ?? 0,
				}),
				DT,
			);
			maxX = Math.max(maxX, s.x);
			if (s.meleeAction === "massive") massiveFired = true;
			beatElapsed += DT_MS;
			beatFresh = false;
			if (beatElapsed >= beat.ms) {
				beatElapsed = 0;
				beatFresh = true;
				beatIdx = (beatIdx + 1) % beats.length;
			}
		}
		// The delivery: the walks (~132px) plus the dash. The lane from 300 to
		// the pillar at 496 gives it room.
		expect(maxX - 300).toBeGreaterThan(150);
		expect(massiveFired).toBe(true);
	});

	it("loses everything when released early", () => {
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 60);
		expect(s.chargeTimer).toBeGreaterThan(0);
		s = melee(s, { attack: false });
		expect(s.chargeTimer).toBe(0);
		expect(s.massiveReady).toBe(false);
		expect(s.meleeAction).toBe("none");
	});

	it("is cancelled by a stance switch", () => {
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 60);
		expect(s.chargeTimer).toBeGreaterThan(0);
		s = melee(s, { swordStance: false });
		expect(s.chargeTimer).toBe(0);
	});

	it("is spent by a stun", () => {
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true }, 60);
		expect(s.chargeTimer).toBeGreaterThan(0);
		s = melee({ ...s, stunTimer: 100 }, {});
		expect(s.chargeTimer).toBe(0);
		expect(s.massiveReady).toBe(false);
	});

	it("can be held with the guard up — block is a delivery tool", () => {
		// Charging and blocking at once is the move's cover: the charge is not a
		// swing, so the guard stays up for as long as both buttons are held.
		let s = fighter({ grounded: true });
		s = melee(s, { attack: true, block: true }, 100);
		expect(s.blocking).toBe(true);
		expect(s.chargeTimer).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// The ground chain
//
// Three slashes, linked out of each other's recovery. The rules that make it a
// technique rather than a mash: it needs the floor, the first two links can be
// cancelled and the finisher cannot, and it ends in a knockdown that leaves both
// fighters neutral.
// ---------------------------------------------------------------------------

describe("the ground chain", () => {
	/** A fighter standing on something, which is what the chain requires. */
	function standing(overrides: Partial<PlayerPosition> = {}): PlayerPosition {
		return fighter({ grounded: true, ...overrides });
	}

	/** Advance to the current move's recovery, then press attack once. */
	function linkOut(s: PlayerPosition): PlayerPosition {
		const recovering = tickUntil(s, {}, (x) => meleePhase(x) === "recovery");
		return melee(recovering.state, { attack: true });
	}

	it("walks slash into slash2 into slash3 out of each recovery", () => {
		let s = melee(standing(), { attack: true });
		expect(s.meleeAction).toBe("slash");
		expect(s.comboStep).toBe(1);

		s = linkOut(s);
		expect(s.meleeAction).toBe("slash2");
		expect(s.comboStep).toBe(2);
		// Linked, not queued: the previous move's timer is gone, not paused.
		expect(s.meleeTimer).toBeLessThanOrEqual(DT_MS);

		s = linkOut(s);
		expect(s.meleeAction).toBe("slash3");
		expect(s.comboStep).toBe(3);
	});

	/**
	 * The link costs nothing but the press.
	 *
	 * "Very little delay" is the whole feature, and the number that delivers it is
	 * the moment the previous link's hitbox closes — not a window that opens some
	 * time after the move is over.
	 */
	it("makes the next link available the instant the hitbox closes", () => {
		const s = melee(standing(), { attack: true });
		const recovering = tickUntil(s, {}, (x) => meleePhase(x) === "recovery");
		expect(recovering.elapsedMs).toBeLessThanOrEqual(
			MOVES.slash.startupMs + MOVES.slash.activeMs + DT_MS,
		);
		expect(melee(recovering.state, { attack: true }).meleeAction).toBe(
			"slash2",
		);
	});

	/**
	 * The frame data has to make the chain a *combo*, not three swings that happen
	 * to be near each other.
	 *
	 * A link's hitbox opens `active + startup` after the previous one did, so the
	 * previous link's hitstun has to outlast exactly that. Get this wrong and the
	 * defender gets free frames in the middle of a combo, which is invisible in
	 * every metric except a defender who blocks the second hit.
	 */
	it("keeps each link inside the previous one's hitstun", () => {
		const toSecond = MOVES.slash.activeMs + MOVES.slash2.startupMs;
		expect(MOVES.slash.hitstunMs).toBeGreaterThan(toSecond);

		const toThird = MOVES.slash2.activeMs + MOVES.slash3.startupMs;
		expect(MOVES.slash2.hitstunMs).toBeGreaterThan(toThird);
	});

	it("refuses to chain with no floor underfoot", () => {
		let s = melee(fighter({ grounded: false }), { attack: true });
		expect(s.meleeAction).toBe("slash");

		s = linkOut(s);
		// The press was refused outright rather than queued: an airborne butterfly
		// still swings, it just never reaches the finisher.
		expect(s.meleeAction).toBe("slash");
		expect(s.comboStep).toBe(1);

		s = tickUntil(s, {}, (x) => x.meleeAction === "none").state;
		expect(melee(s, { attack: true }).meleeAction).toBe("slash");
	});

	it("drops the chain when a link is cancelled into a block", () => {
		// The butterfly is the loop, not the on-ramp to the combo: cancel the link
		// and the next press opens a fresh chain at link 1.
		let s = melee(standing(), { attack: true });
		s = tickUntil(s, {}, (x) => meleePhase(x) === "active").state;
		s = melee(s, { block: true });
		expect(s.meleeAction).toBe("none");
		expect(s.comboStep).toBe(0);
		expect(s.comboTimer).toBe(0);

		s = melee(s, {});
		expect(melee(s, { attack: true }).meleeAction).toBe("slash");
	});

	it("drops the chain when the second link is cancelled into a block", () => {
		// Link 2 is cancellable too, so the same rule has to hold there — otherwise
		// the escape hatch out of link 2 would hand you the uncancellable finisher.
		let s = melee(standing(), { attack: true });
		s = linkOut(s);
		expect(s.meleeAction).toBe("slash2");

		s = tickUntil(s, {}, (x) => meleePhase(x) === "active").state;
		s = melee(s, { block: true });
		expect(s.meleeAction).toBe("none");
		expect(s.comboStep).toBe(0);

		s = melee(s, {});
		expect(melee(s, { attack: true }).meleeAction).toBe("slash");
	});

	it("drops the chain when a link is cancelled into a stance switch", () => {
		// The slash-shot is a cancel like any other. If it kept the chain it would be
		// the strictly better way to butterfly into a finisher.
		let s = melee(standing(), { attack: true });
		s = tickUntil(s, {}, (x) => meleePhase(x) === "active").state;
		s = melee(s, { swordStance: false });
		expect(s.meleeAction).toBe("none");
		expect(s.comboStep).toBe(0);

		s = melee(s, { swordStance: true });
		expect(melee(s, { attack: true }).meleeAction).toBe("slash");
	});

	it("repeats the opener forever through a grounded butterfly", () => {
		// The point of the reset: an endless slash-block loop on the ground, with
		// the finisher's uncancellable recovery reachable only on purpose.
		let s = standing();
		for (let cycle = 0; cycle < 4; cycle += 1) {
			s = melee(s, { attack: true });
			expect(s.meleeAction).toBe("slash");
			s = tickUntil(
				s,
				{ attack: true },
				(x) => meleePhase(x) === "active",
			).state;
			s = melee(s, { block: true });
			expect(s.meleeAction).toBe("none");
			// Release both buttons so the next press reads as a fresh edge.
			s = melee(s, {});
		}
	});

	it("lets the chain lapse once the link window runs out", () => {
		let s = melee(standing(), { attack: true });
		s = tickUntil(s, {}, (x) => x.meleeAction === "none").state;
		s = melee(s, {}, Math.ceil(COMBO_LINK_MS / DT_MS) + 2);
		expect(s.comboStep).toBe(0);
		expect(melee(s, { attack: true }).meleeAction).toBe("slash");
	});

	it("starts over after the finisher", () => {
		let s = melee(standing(), { attack: true });
		s = linkOut(s);
		s = linkOut(s);
		expect(s.meleeAction).toBe("slash3");

		s = tickUntil(s, {}, (x) => x.meleeAction === "none").state;
		expect(s.comboStep).toBe(0);
		expect(melee(s, { attack: true }).meleeAction).toBe("slash");
	});

	it("cancels the first two links and commits to the third", () => {
		expect(MOVES.slash.cancellable).toBe(true);
		expect(MOVES.slash2.cancellable).toBe(true);
		expect(MOVES.slash3.cancellable).toBe(false);

		let s = melee(standing(), { attack: true });
		s = linkOut(s);
		s = linkOut(s);
		s = tickUntil(s, {}, (x) => meleePhase(x) === "active").state;
		// Blocking out of the finisher is not on offer, at any point in it.
		expect(melee(s, { block: true }).meleeAction).toBe("slash3");
	});

	it("drops the chain when the attacker is stunned", () => {
		let s = melee(standing(), { attack: true });
		s = { ...s, stunTimer: 200 };
		s = melee(s, {});
		expect(s.comboStep).toBe(0);
		expect(s.meleeAction).toBe("none");
	});

	/**
	 * The finisher ends in neutral, by construction.
	 *
	 * The attacker's swing runs `active + recovery` past the frame its hitbox
	 * opened; the victim is on the floor for `KNOCKDOWN_MS` from that same frame.
	 * Equal means a landed combo buys position and damage, not a free follow-up —
	 * which is what pays for the finisher being uninterruptible.
	 */
	it("recovers exactly as fast as the knockdown it causes", () => {
		expect(MOVES.slash3.activeMs + MOVES.slash3.recoveryMs).toBe(KNOCKDOWN_MS);
		expect(MOVES.slash3.hitstunMs).toBe(KNOCKDOWN_MS);
	});

	it("knocks the target down, for a little more damage", () => {
		const { attacker, defender } = duel({ move: "slash3" });
		const result = connects(resolveMelee(attacker, defender));
		expect(result.outcome).toBe("hit");

		const damage = applyMeleeResult(attacker, defender, result);
		expect(damage).toBe(MOVES.slash3.damage);
		expect(damage).toBeGreaterThan(MOVES.slash.damage);
		expect(defender.knockdownTimer).toBe(KNOCKDOWN_MS);
		// A knockdown is a stun as well, or a downed fighter could act.
		expect(defender.stunTimer).toBeGreaterThanOrEqual(KNOCKDOWN_MS);
		// Spiked, not launched.
		expect(defender.vy).toBeGreaterThan(0);
	});

	it("only knocks down on the finisher", () => {
		for (const move of ["slash", "slash2", "uppercut", "massive"] as const) {
			const { attacker, defender } = duel({ move });
			applyMeleeResult(
				attacker,
				defender,
				connects(resolveMelee(attacker, defender)),
			);
			expect(defender.knockdownTimer).toBe(0);
		}
	});

	/**
	 * A combo has to beat the invulnerability its own opener applied.
	 *
	 * `MELEE_IFRAME_MS` is 180 and a link lands ~160ms after the one before it, so
	 * without piercing the second and third swings would pass through the fighter
	 * the first one just staggered: the animations would all play and the combo
	 * would deal seven damage.
	 */
	it("connects through the invulnerability the opener applied", () => {
		for (const move of ["slash2", "slash3"] as const) {
			const { attacker, defender } = duel({ move });
			defender.iframeTimer = MELEE_IFRAME_MS;
			expect(resolveMelee(attacker, defender)).not.toBeNull();
		}
	});

	it("still lets invulnerability stop everything else", () => {
		for (const move of ["slash", "uppercut", "massive"] as const) {
			const { attacker, defender } = duel({ move });
			defender.iframeTimer = MELEE_IFRAME_MS;
			expect(resolveMelee(attacker, defender)).toBeNull();
		}
	});

	it("is blockable at every link, including the finisher", () => {
		for (const move of COMBO_CHAIN) {
			expect(MOVES[move].blockable).toBe(true);
			const { attacker, defender } = duel({ move, defenderBlockMs: 400 });
			expect(resolveMelee(attacker, defender)?.outcome).toBe("parried");
		}
	});
});

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

describe("blocking", () => {
	it("comes up on the very first tick", () => {
		// No startup delay. Reacting to a 75ms slash across a 20Hz network is
		// already tight enough that any extra cost here removes the read entirely.
		expect(BLOCK_STARTUP_MS).toBe(0);
		expect(melee(fighter(), { block: true }).blocking).toBe(true);
	});

	it("leaves enough budget to actually react to a slash online", () => {
		// The guard has to be up before the hitbox is. Worst case the defender
		// learns of the swing a full snapshot late, so the slash's wind-up must
		// outlast that plus the guard's own delay — otherwise "block on reaction"
		// is a mechanic that cannot be performed.
		const snapshotIntervalMs = 1000 / 20;
		expect(MOVES.slash.startupMs).toBeGreaterThan(
			snapshotIntervalMs + BLOCK_STARTUP_MS,
		);
	});

	it("drops the instant the button is released", () => {
		const held = melee(fighter(), { block: true }, 10);
		expect(held.blocking).toBe(true);
		expect(melee(held, { block: false }).blocking).toBe(false);
	});

	it("turns every stopped swing into a guard break", () => {
		const { attacker, defender } = duel({ defenderBlockMs: 400 });
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("parried");
		expect(applyMeleeResult(attacker, defender, connects(result))).toBe(0);
		expect(defender.stunTimer).toBe(0);
		// The attacker is the one paying: a full second of helplessness.
		expect(attacker.stunTimer).toBe(GUARD_BREAK_STUN_MS);
	});

	it("stops the massive's swing too — the swing is blockable", () => {
		// The massive is blockable *at the swing*: a defender standing in the
		// blade's path stops it before it reaches the floor. That is what makes
		// the back-massive a technique rather than the only option.
		expect(MOVES.massive.blockable).toBe(true);
		const { attacker, defender } = duel({
			move: "massive",
			defenderBlockMs: 400,
		});
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("parried");
		expect(applyMeleeResult(attacker, defender, connects(result))).toBe(0);
	});

	it("cannot stop an uppercut", () => {
		const { attacker, defender } = duel({
			defenderBlockMs: 400,
			move: "uppercut",
		});
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("hit");
		expect(applyMeleeResult(attacker, defender, connects(result))).toBe(
			MOVES.uppercut.damage,
		);
	});

	it("cannot be held up through your own swing", () => {
		// Holding block while slashing would make the butterfly not just safe but
		// strictly free.
		let s = melee(fighter(), { block: true }, 6);
		expect(s.blocking).toBe(true);
		s = melee(s, { block: true, attack: true });
		expect(s.meleeAction).toBe("slash");
		expect(s.blocking).toBe(false);
	});

	it("cannot begin during a heavy move", () => {
		let s = melee(
			fighter({ massiveReady: true, parryMassiveTimer: 100, grounded: true }),
			{ attack: true },
		);
		expect(s.meleeAction).toBe("massive");
		s = melee(s, { block: true }, 10);
		expect(s.blocking).toBe(false);
		expect(s.meleeAction).toBe("massive");
	});
});

describe("guard breaks", () => {
	it("arms a full Massive and marks the attacker helpless", () => {
		const { attacker, defender } = duel({ defenderBlockMs: 400 });
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("parried");

		expect(applyMeleeResult(attacker, defender, connects(result))).toBe(0);
		expect(attacker.stunTimer).toBe(GUARD_BREAK_STUN_MS);
		expect(attacker.guardBroken).toBe(true);
		expect(attacker.meleeAction).toBe("none");
		// Stunned and blocking is a state the rules say cannot exist.
		expect(attacker.blocking).toBe(false);
		// The reward: a full massive, armed for a 4s window.
		expect(defender.massiveReady).toBe(true);
		expect(defender.parryMassiveTimer).toBe(PARRY_MASSIVE_LIFETIME_MS);
	});

	it("grants a Massive that fires on the press, not the release", () => {
		// The defender was not holding attack when the guard broke, so the
		// natural gesture is a click. A charge-massive needs a release; this
		// one must not wait for one.
		let s = fighter({
			massiveReady: true,
			parryMassiveTimer: 1000,
			grounded: true,
		});
		expect(s.meleeAction).toBe("none");
		s = melee(s, { attack: true });
		expect(s.meleeAction).toBe("massive");
	});

	it("lets the granted Massive fade after its lifetime", () => {
		const held = tickUntil(
			fighter({ massiveReady: true, parryMassiveTimer: 1000 }),
			{},
			(x) => !x.massiveReady,
			PARRY_MASSIVE_LIFETIME_MS + 500,
		);
		expect(held.state.massiveReady).toBe(false);
		expect(held.state.parryMassiveTimer).toBe(0);
	});

	it("clears the helpless pose once the stun drains", () => {
		const s = fighter({ stunTimer: GUARD_BREAK_STUN_MS, guardBroken: true });
		const recovered = tickUntil(s, {}, (x) => x.stunTimer <= 0);
		expect(recovered.state.guardBroken).toBe(false);
	});
});

describe("backstab", () => {
	it("needs real separation, not just an overlapping body leaning the wrong way", () => {
		// Fighters pass through each other, so in a scramble the two bodies sit on
		// top of one another. Deciding "behind" from the sign of a few pixels there
		// turned ordinary trades into backstabs and, since a backstab ignores the
		// guard, silently disabled blocking entirely.
		const attacker = createPlayerState(100, 100, 1);
		const defender = createPlayerState(100 + 4, 100, 1);
		expect(isBehind(attacker, defender)).toBe(false);

		const clearlyBehind = createPlayerState(
			100 + BACKSTAB_MIN_SEPARATION_PX + 4,
			100,
			1,
		);
		expect(isBehind(attacker, clearlyBehind)).toBe(true);
	});

	it("ignores a block and adds stun when it lands on the unfaced side", () => {
		// Defender faces away from the attacker, guard up. The guard covers the
		// wrong side, so it does nothing at all.
		const { attacker, defender } = duel({
			defenderBlockMs: 400,
			defenderFacing: 1,
		});
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("backstab");

		applyMeleeResult(attacker, defender, connects(result));
		expect(defender.stunTimer).toBe(
			MOVES.slash.hitstunMs + BACKSTAB_BONUS_STUN_MS,
		);
	});
});

// ---------------------------------------------------------------------------
// Cancels — the butterfly
// ---------------------------------------------------------------------------

describe("cancels", () => {
	it("lets block cut a slash short once it is past startup", () => {
		const uncancelled = tickUntil(
			melee(fighter(), { attack: true }),
			{},
			(x) => x.meleeAction === "none",
		);

		const active = tickUntil(
			melee(fighter(), { attack: true }),
			{},
			(x) => meleePhase(x) === "recovery",
		);
		const cancelled = melee(active.state, { block: true });
		expect(cancelled.meleeAction).toBe("none");

		// The whole point of the technique: the cancelled slash is over well
		// before the uncancelled one would have been.
		expect(active.elapsedMs).toBeLessThan(uncancelled.elapsedMs * 0.75);
	});

	it("will not cancel during startup", () => {
		const s = melee(fighter(), { attack: true });
		expect(meleePhase(s)).toBe("startup");
		expect(isCancellable(s)).toBe(false);
		expect(melee(s, { block: true }).meleeAction).toBe("slash");
	});

	it("will not cancel a heavy move, which is what makes it punishable", () => {
		for (const start of [
			{
				flags: { massiveReady: true, parryMassiveTimer: 100, grounded: true },
				key: "attack" as const,
				move: "massive",
			},
			{ flags: {}, key: "uppercut" as const, move: "uppercut" },
		]) {
			let s = melee(fighter(start.flags), { [start.key]: true });
			expect(s.meleeAction).toBe(start.move);
			s = tickUntil(s, {}, (x) => meleePhase(x) === "recovery").state;
			expect(isCommitted(s)).toBe(true);
			expect(melee(s, { block: true }).meleeAction).toBe(start.move);
		}
	});

	it("lets a stance switch cancel a slash — the slash-shot", () => {
		const s = tickUntil(
			melee(fighter(), { attack: true }),
			{},
			(x) => meleePhase(x) === "recovery",
		).state;
		const switched = melee(s, { swordStance: false });
		expect(switched.meleeAction).toBe("none");
		expect(switched.stance).toBe("gun");
	});

	it("keeps a hit that already landed when the slash is cancelled", () => {
		const { attacker, defender } = duel({});
		const result = resolveMelee(attacker, defender);
		applyMeleeResult(attacker, defender, connects(result));
		expect(attacker.hitLatch).toBe(true);

		const cancelled = melee(attacker, { block: true });
		expect(cancelled.meleeAction).toBe("none");
		expect(defender.stunTimer).toBeGreaterThan(0);
	});

	it("only lets one swing connect once", () => {
		const { attacker, defender } = duel({});
		applyMeleeResult(
			attacker,
			defender,
			connects(resolveMelee(attacker, defender)),
		);
		expect(resolveMelee(attacker, defender)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Consequences
// ---------------------------------------------------------------------------

describe("hit consequences", () => {
	it("launches the target with an uppercut", () => {
		const { attacker, defender } = duel({ move: "uppercut" });
		defender.grounded = true;
		applyMeleeResult(
			attacker,
			defender,
			connects(resolveMelee(attacker, defender)),
		);

		expect(defender.vy).toBe(MOVES.uppercut.launchVy);
		expect(defender.grounded).toBe(false);
	});

	it("launches less hard than a fighter can jump", () => {
		// A launch must be helpless without being an automatic ring-out, so it is
		// tuned against the jump rather than in isolation. Retuning the jump
		// retunes what being launched feels like, and this is what says so.
		expect(Math.abs(MOVES.uppercut.launchVy)).toBeLessThan(
			Math.abs(JUMP_VELOCITY),
		);
	});

	it("grants melee immunity so faster swinging stops paying", () => {
		const { attacker, defender } = duel({});
		applyMeleeResult(
			attacker,
			defender,
			connects(resolveMelee(attacker, defender)),
		);
		expect(defender.iframeTimer).toBe(MELEE_IFRAME_MS);

		// A second, fresh swing lands inside the window and does nothing.
		const second = { ...attacker, hitLatch: false };
		expect(resolveMelee(second, defender)).toBeNull();
	});

	it("cancels whatever the target was doing", () => {
		const { attacker, defender } = duel({});
		defender.meleeAction = "slash";
		defender.meleeTimer = 60;
		applyMeleeResult(
			attacker,
			defender,
			connects(resolveMelee(attacker, defender)),
		);
		expect(defender.meleeAction).toBe("none");
	});
});

describe("stun", () => {
	it("discards every melee input and cancels the move in progress", () => {
		let s = melee(fighter({ stunTimer: 300 }), { attack: true });
		expect(s.meleeAction).toBe("none");

		s = melee(s, { attack: true, block: true, uppercut: true }, 5);
		expect(s.meleeAction).toBe("none");
		expect(s.blocking).toBe(false);
		expect(s.massiveReady).toBe(false);
	});

	it("discards movement and jumping too, but still falls", () => {
		const start = createPlayerState(100, 100);
		start.stunTimer = 300;
		start.grounded = true;

		const s = tickPlayer(start, intent({ right: true, up: true }), DT);
		expect(s.vx).toBe(0);
		expect(s.vy).toBeGreaterThan(0);
	});

	it("requires a fresh press once it ends", () => {
		// Holding attack through a stun must not fire the moment it lifts: the
		// button state is latched as released so a decision has to be made.
		let s = fighter({ stunTimer: DT_MS * 2 });
		s = melee(s, { attack: true });
		expect(s.attackHeld).toBe(false);
		s = melee(s, { attack: true });
		expect(s.meleeAction).toBe("slash");
	});
});

describe("commitment", () => {
	it("roots a fighter for the whole of a heavy move", () => {
		let s = createPlayerState(100, 100);
		s.grounded = true;
		s.massiveReady = true;
		s.parryMassiveTimer = 100;
		s = tickPlayer(s, intent({ attack: true }), DT);
		expect(s.meleeAction).toBe("massive");

		const startX = s.x;
		for (let i = 0; i < 20; i++) {
			s = tickPlayer(s, intent({ right: true, up: true }), DT);
		}
		expect(s.meleeAction).toBe("massive");
		expect(s.x).toBe(startX);
		expect(s.grounded).toBe(true);
	});

	it("locks facing while a move runs", () => {
		let s = createPlayerState(100, 100, 1);
		s.grounded = true;
		s = tickPlayer(s, intent({ attack: true }), DT);
		s = tickPlayer(s, intent({ left: true }), DT);
		expect(s.facing).toBe(1);
	});

	it("slows a blocking fighter so circling behind them is possible", () => {
		const walk = (blocking: boolean) => {
			let s = createPlayerState(100, 500);
			s.grounded = true;
			for (let i = 0; i < 60; i++) {
				s = tickPlayer(s, intent({ right: true, block: blocking }), DT);
			}
			return s.x;
		};
		expect(walk(true)).toBeLessThan(walk(false));
	});
});

describe("the plunge bomb", () => {
	/** A fighter in the air with a full charge, ready to release it. */
	function bomber(y = 300): PlayerPosition {
		return bomberAt(100, y);
	}

	/** The same, somewhere specific on the ground plane. */
	function bomberAt(x: number, y: number): PlayerPosition {
		return fighter({
			x,
			y,
			grounded: false,
			massiveReady: true,
			chargeTimer: MASSIVE_CHARGE_MS,
		});
	}

	/** Hold the button for a tick so the release edge has something to fire. */
	function release(b: PlayerPosition): PlayerPosition {
		return melee(melee(b, { attack: true }), { attack: false });
	}

	it("refuses the swing and dives instead of an airborne massive", () => {
		const released = release(bomber());
		expect(released.meleeAction).toBe("none");
		expect(released.plunging).toBe(true);
		expect(released.massiveReady).toBe(false);
		expect(released.plungeOriginY).toBe(300);
	});

	it("drops faster than a fall can ever go", () => {
		expect(PLUNGE_SPEED).toBeGreaterThan(950); // MAX_FALL_SPEED
		let s = release(bomber());
		expect(s.plunging).toBe(true);
		// tickPlayer's gravity block pins the dive; the plunge is not a fall.
		s = tickPlayer(s, intent({}), DT);
		expect(s.vy).toBe(PLUNGE_SPEED);
	});

	it("is a commitment: nothing can be pressed mid-dive", () => {
		let s = release(bomber());
		s = melee(s, { attack: true, block: true, uppercut: true }, 10);
		expect(s.plunging).toBe(true);
		expect(s.meleeAction).toBe("none");
		expect(s.blocking).toBe(false);
	});

	it("plants the fighter and arms the stuck timer at floor contact", () => {
		// Diving at x=240: a clear lane down — the ground is the first solid
		// surface, at GROUND.y = 568, so a fighter that dives from y=320 falls
		// exactly 200px before standing on it.
		const fall = 200;
		let s = release(bomberAt(240, 320));
		expect(s.plunging).toBe(true);
		let landed = false;
		for (let i = 0; i < 120 && !landed; i++) {
			s = tickPlayer(s, intent({}), DT);
			landed = !s.plunging;
		}
		expect(landed).toBe(true);
		expect(s.grounded).toBe(true);
		expect(s.y).toBe(568 - 48);
		expect(s.plungeStuckTimer).toBeCloseTo(bombBlastFor(fall).stuckMs, 6);
	});

	it("breaks the stuck on a melee hit — the one cancel it has", () => {
		const { attacker, defender } = duel({});
		defender.plungeStuckTimer = 800;
		applyMeleeResult(
			attacker,
			defender,
			connects(resolveMelee(attacker, defender)),
		);
		expect(defender.plungeStuckTimer).toBe(0);
		// And the slash's own stun plays out on top.
		expect(defender.stunTimer).toBe(MOVES.slash.hitstunMs);
	});

	it("spends the stuck while rooted, then returns control", () => {
		let s = fighter({ grounded: true, plungeStuckTimer: 200 });
		s = tickPlayer(s, intent({ right: true }), DT);
		expect(s.x).toBe(100); // rooted
		expect(s.vx).toBe(0);
		const recovered = tickUntil(s, {}, (x) => x.plungeStuckTimer <= 0);
		expect(recovered.state.plungeStuckTimer).toBe(0);
	});
});

describe("the massive's blast geometry", () => {
	it("slams a little in front of the fighter, on both facings", () => {
		const right = massiveSlamPoint({ x: 100, y: 200, facing: 1 });
		expect(right.x).toBe(100 + 16 + MASSIVE_SLAM_OFFSET_PX);
		expect(right.y).toBe(248);
		const left = massiveSlamPoint({ x: 100, y: 200, facing: -1 });
		expect(left.x).toBe(100 + 16 - MASSIVE_SLAM_OFFSET_PX);
	});

	it("measures a bomb by its fall, clamped to the arena's reach", () => {
		expect(bombBlastFor(250).radiusPx).toBeGreaterThan(
			PLUNGE_BLAST_BASE_RADIUS_PX,
		);
		expect(bombBlastFor(250).stunMs).toBeGreaterThan(PLUNGE_STUN_BASE_MS);
		expect(bombBlastFor(250).knockupVy).toBeLessThan(PLUNGE_KNOCKUP_BASE);
		expect(bombBlastFor(250).stuckMs).toBeGreaterThan(PLUNGE_STUCK_BASE_MS);

		// The caps: a corner-of-the-map dive is not a nuke.
		expect(bombBlastFor(100000).radiusPx).toBe(PLUNGE_BLAST_MAX_RADIUS_PX);
		expect(bombBlastFor(100000).stunMs).toBe(PLUNGE_STUN_MAX_MS);
		expect(bombBlastFor(100000).knockupVy).toBe(PLUNGE_KNOCKUP_MAX);
		expect(bombBlastFor(100000).stuckMs).toBe(PLUNGE_STUCK_MAX_MS);
		expect(bombBlastFor(100000).radiusPx).toBeLessThanOrEqual(
			PLUNGE_BLAST_MAX_RADIUS_PX,
		);

		// Zero fall (a scrape along the floor) is still a bomb, just a small one.
		expect(bombBlastFor(0).radiusPx).toBe(PLUNGE_BLAST_BASE_RADIUS_PX);
		expect(bombBlastFor(-50).radiusPx).toBe(PLUNGE_BLAST_BASE_RADIUS_PX);
		// The fall is capped before it is priced: 10,000px is 500px, not 10,000.
		expect(bombBlastFor(100000).stuckMs).toBeLessThanOrEqual(
			PLUNGE_STUCK_MAX_MS,
		);
	});
});

describe("determinism", () => {
	it("produces identical state from identical inputs", () => {
		const script: Partial<PlayerIntent>[] = [
			{ attack: true },
			{ attack: true },
			{ block: true },
			{ block: true, right: true },
			{ uppercut: true },
			{ right: true },
		];
		const run = () => {
			let s = createPlayerState(100, 100);
			for (let i = 0; i < 200; i++) {
				s = tickPlayer(s, intent(script[i % script.length]), DT);
			}
			return s;
		};
		expect(run()).toEqual(run());
	});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DuelOptions {
	move?: MeleeMove;
	/** How long the defender has been holding block. Omit for no block at all. */
	defenderBlockMs?: number;
	/** Defaults to facing the attacker. */
	defenderFacing?: number;
}

/**
 * Two fighters in contact, the attacker mid-swing with a live hitbox.
 *
 * The attacker faces right at x=100; the defender overlaps its reach at x=140
 * and by default faces back at it, so a block counts as a front block.
 */
function duel(opts: DuelOptions): {
	attacker: PlayerPosition;
	defender: PlayerPosition;
} {
	const move = opts.move ?? "slash";
	const attacker = createPlayerState(100, 100, 1);
	attacker.meleeAction = move;
	// Park the timer in the middle of the active window.
	attacker.meleeTimer = MOVES[move].startupMs + MOVES[move].activeMs / 2;

	const defender = createPlayerState(140, 100, opts.defenderFacing ?? -1);
	if (opts.defenderBlockMs !== undefined) {
		defender.blockTimer = opts.defenderBlockMs;
		defender.blocking = opts.defenderBlockMs >= BLOCK_STARTUP_MS;
	}

	return { attacker, defender };
}

describe("blocksBullet", () => {
	/** A guard covers the side you face — the same rule melee already follows. */
	function guard(facing: number, blocking = true): MeleeState {
		const s = createMeleeState(facing);
		s.blocking = blocking;
		return s;
	}

	it("absorbs a shot arriving from the front", () => {
		// Travelling right means it came from the left, so a fighter facing left
		// is guarding it.
		expect(blocksBullet(guard(-1), BULLET_SPEED)).toBe(true);
		expect(blocksBullet(guard(1), -BULLET_SPEED)).toBe(true);
	});

	it("does not stop a shot from behind", () => {
		expect(blocksBullet(guard(1), BULLET_SPEED)).toBe(false);
		expect(blocksBullet(guard(-1), -BULLET_SPEED)).toBe(false);
	});

	it("does nothing without a raised guard", () => {
		expect(blocksBullet(guard(-1, false), BULLET_SPEED)).toBe(false);
	});

	/** Straight up or down there is no side for a front-only guard to cover. */
	it("does not stop a purely vertical shot", () => {
		expect(blocksBullet(guard(-1), 0)).toBe(false);
		expect(blocksBullet(guard(1), 0)).toBe(false);
	});

	/**
	 * The reason this is not a free defence: `blocking` is only ever set in sword
	 * stance, so a fighter absorbing shots cannot return fire.
	 */
	it("is unreachable in gun stance, because blocking is", () => {
		const s = createMeleeState(1);
		tickMelee(s, intent({ block: true, swordStance: false }), DT);
		expect(s.stance).toBe("gun");
		expect(s.blocking).toBe(false);
		expect(blocksBullet(s, -BULLET_SPEED)).toBe(false);
	});
});

describe("blocksUltimate", () => {
	/** The guard is the universal deny: the same rule as a bullet, by name. */
	function guard(facing: number, blocking = true): MeleeState {
		const s = createMeleeState(facing);
		s.blocking = blocking;
		return s;
	}

	it("catches an ultimate thrown from the front", () => {
		// The black hole's grenade flying right came from the left, so a fighter
		// facing left is in the way of it.
		expect(blocksUltimate(guard(-1), 780)).toBe(true);
		expect(blocksUltimate(guard(1), -780)).toBe(true);
	});

	it("does not catch a throw from behind", () => {
		expect(blocksUltimate(guard(1), 780)).toBe(false);
		expect(blocksUltimate(guard(-1), -780)).toBe(false);
	});

	it("does nothing without a raised guard", () => {
		expect(blocksUltimate(guard(-1, false), 780)).toBe(false);
	});

	it("is unreachable in gun stance, because blocking is", () => {
		const s = createMeleeState(1);
		tickMelee(s, intent({ block: true, swordStance: false }), DT);
		expect(blocksUltimate(s, -780)).toBe(false);
	});
});
