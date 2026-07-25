import { describe, expect, it } from "vitest";
import {
	applyMeleeResult,
	BACKSTAB_BONUS_STUN_MS,
	BACKSTAB_MIN_SEPARATION_PX,
	BLOCK_STARTUP_MS,
	GUARD_BREAK_STUN_MS,
	isBehind,
	isCancellable,
	isCommitted,
	MASSIVE_CHARGE_MS,
	MELEE_IFRAME_MS,
	type MeleeIntent,
	meleeHitbox,
	meleePhase,
	MOVES,
	moveDuration,
	PARRY_WINDOW_MS,
	resolveMelee,
	tickMelee,
} from "./Melee";
import {
	createPlayerState,
	JUMP_VELOCITY,
	NEUTRAL_INTENT,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./Physics";

const DT = 1 / 60;
const DT_MS = (DT * 1000) as number;

function intent(overrides: Partial<PlayerIntent> = {}): PlayerIntent {
	return { ...NEUTRAL_INTENT, ...overrides };
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
	let state = { ...s };
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
			// Massive needs arming first; give it the flag directly.
			const start = fighter(move === "massive" ? { massiveReady: true } : {});
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
		// One press, held for well over a full slash: exactly one slash happens.
		let s = melee(fighter(), { attack: true }, 40);
		expect(s.meleeAction).toBe("none");

		// ...and it does not restart while the button stays down, because the
		// charge has by now armed a Massive, which needs a release.
		s = melee(s, { attack: true }, 5);
		expect(s.meleeAction).toBe("none");
	});

	it("arms a Massive Strike after a full charge and fires it on release", () => {
		const charged = tickUntil(
			fighter(),
			{ attack: true },
			(x) => x.massiveReady,
		);
		expect(charged.elapsedMs).toBeGreaterThanOrEqual(MASSIVE_CHARGE_MS - DT_MS);

		const released = melee(charged.state, { attack: false });
		expect(released.meleeAction).toBe("massive");
		expect(released.massiveReady).toBe(false);
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

	it("absorbs a slash from the front for zero damage", () => {
		const { attacker, defender } = duel({ defenderBlockMs: 400 });
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("blocked");
		expect(applyMeleeResult(attacker, defender, result!)).toBe(0);
		expect(defender.stunTimer).toBe(0);
	});

	it("cannot stop a Massive Strike or an uppercut", () => {
		for (const move of ["massive", "uppercut"] as const) {
			const { attacker, defender } = duel({ defenderBlockMs: 400, move });
			const result = resolveMelee(attacker, defender);
			expect(result?.outcome).toBe("hit");
			expect(applyMeleeResult(attacker, defender, result!)).toBe(
				MOVES[move].damage,
			);
		}
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
		let s = melee(fighter({ massiveReady: true }), { attack: true });
		expect(s.meleeAction).toBe("massive");
		s = melee(s, { block: true }, 10);
		expect(s.blocking).toBe(false);
		expect(s.meleeAction).toBe("massive");
	});
});

describe("parrying", () => {
	it("guard-breaks the attacker and arms a free Massive Strike", () => {
		const { attacker, defender } = duel({ defenderBlockMs: PARRY_WINDOW_MS / 2 });
		const result = resolveMelee(attacker, defender);
		expect(result?.outcome).toBe("parried");

		expect(applyMeleeResult(attacker, defender, result!)).toBe(0);
		expect(attacker.stunTimer).toBe(GUARD_BREAK_STUN_MS);
		expect(attacker.meleeAction).toBe("none");
		// Stunned and blocking is a state the rules say cannot exist.
		expect(attacker.blocking).toBe(false);
		expect(defender.massiveReady).toBe(true);
	});

	it("is only a plain block once the window has passed", () => {
		const { attacker, defender } = duel({
			defenderBlockMs: PARRY_WINDOW_MS + 100,
		});
		expect(resolveMelee(attacker, defender)?.outcome).toBe("blocked");
	});

	it("does not re-arm while the button stays held", () => {
		// Hold block far past the window, interrupting it with a slash of our own
		// on the way. The window must not come back: otherwise butterflying with
		// block held would grant a free parry every cycle.
		let s = melee(fighter(), { block: true }, 20);
		s = melee(s, { block: true, attack: true });
		s = melee(s, { block: true }, 20);
		expect(s.blockTimer).toBeGreaterThan(PARRY_WINDOW_MS);
		expect(s.blocking).toBe(true);
	});

	it("re-arms after the button is released and pressed again", () => {
		let s = melee(fighter(), { block: true }, 20);
		expect(s.blockTimer).toBeGreaterThan(PARRY_WINDOW_MS);
		s = melee(s, { block: false });
		s = melee(s, { block: true });
		expect(s.blockTimer).toBeLessThan(PARRY_WINDOW_MS);
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

		applyMeleeResult(attacker, defender, result!);
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
			{ flags: { massiveReady: true }, key: "attack" as const, move: "massive" },
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
		applyMeleeResult(attacker, defender, result!);
		expect(attacker.hitLatch).toBe(true);

		const cancelled = melee(attacker, { block: true });
		expect(cancelled.meleeAction).toBe("none");
		expect(defender.stunTimer).toBeGreaterThan(0);
	});

	it("only lets one swing connect once", () => {
		const { attacker, defender } = duel({});
		applyMeleeResult(attacker, defender, resolveMelee(attacker, defender)!);
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
		applyMeleeResult(attacker, defender, resolveMelee(attacker, defender)!);

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
		applyMeleeResult(attacker, defender, resolveMelee(attacker, defender)!);
		expect(defender.iframeTimer).toBe(MELEE_IFRAME_MS);

		// A second, fresh swing lands inside the window and does nothing.
		const second = { ...attacker, hitLatch: false };
		expect(resolveMelee(second, defender)).toBeNull();
	});

	it("cancels whatever the target was doing", () => {
		const { attacker, defender } = duel({});
		defender.meleeAction = "slash";
		defender.meleeTimer = 60;
		applyMeleeResult(attacker, defender, resolveMelee(attacker, defender)!);
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
	move?: "slash" | "uppercut" | "massive";
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
