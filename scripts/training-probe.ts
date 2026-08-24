#!/usr/bin/env node
import type { Page } from "playwright";
/**
 * Training-room feedback-loop harness.
 *
 * `diagnose.ts` measures a whole chaotic match; this measures **one
 * interaction**. Both are needed and neither replaces the other: the canonical
 * run answers "is the game healthy?", and this answers "does a block actually
 * stop a slash coming from the left?" — which no amount of watching two brains
 * fight can establish, because a brain never does the same thing twice.
 *
 * It also exists because the training room is the instrument other measurements
 * are taken with. A training room whose own correctness is unmeasured is worse
 * than none: a bug in it would launder itself into every later result.
 *
 * Every expectation below is derivable from specs/melee.md. They are assertions,
 * not eyeballs.
 *
 *   tsx scripts/training-probe.ts
 *   tsx scripts/training-probe.ts --only=backstab
 *   tsx scripts/training-probe.ts --keep-open   # leave the browser up
 */
import { chromium } from "playwright";
import type { MeleeEventMsg } from "../src/game/online/types";
import type { MeleeMove, MeleeOutcome } from "../src/game/simulation/Physics";
import { DRAGON_DAMAGE } from "../src/tweakables/ultimate";
import type {
	TrainingReport,
	TrainingScenario,
} from "../src/game/training/report";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";

/** Frame data from specs/melee.md. Duplicated on purpose — see `expectedDamage`. */
const DAMAGE = { slash: 7, slash2: 7, slash3: 11, uppercut: 11, massive: 24 };

/**
 * How far a measured phase may sit from its declared length.
 *
 * Two frames. Phases are sampled once per rendered frame, so a boundary is
 * observed up to a frame late at each end; at 60fps that is 33ms of honest
 * quantisation before anything is wrong.
 */
const FRAME_TOLERANCE_MS = 40;

/**
 * Reconciliation error a healthy scenario shows.
 *
 * A hit is an unpredictable discontinuity — only the server knows a swing
 * connected — so a scenario containing one necessarily carries a single large
 * correction. The respawn's own snap is deliberately outside the window: the
 * room settles before the measurement starts.
 */
const MAX_AVG_RECON_PX = 5;

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const ONLY = arg("only", "");
const KEEP_OPEN = process.argv.includes("--keep-open");
// `--hero=anands` runs the whole battery as the dagger hero: every row above
// exercises the sword game, and the dagger rows below only make sense when
// the player can actually play the dagger.
const HERO = arg("hero", "lia");

/**
 * Fail loudly if the game server is down.
 *
 * A training room without a server produces a report full of zeroes, and every
 * "must be zero" row passes. This exact shape of false PASS has happened before
 * — see `diagnose.ts`, which grew the same preflight for the same reason.
 */
async function assertServerUp() {
	const res = await fetch("http://localhost:9208/.wrtc/v2/connections", {
		method: "POST",
	}).catch(() => null);
	if (!res) {
		throw new Error(
			"game server unreachable on :9208 — start it with `pnpm run dev:herdr`",
		);
	}
}

/** Outcomes of the events caused by the local fighter, in order. */
function playerEvents(report: TrainingReport) {
	const dummyId = report.events.find((e) =>
		e.attackerId.startsWith("dummy-"),
	)?.attackerId;
	return report.events.filter((e) => e.attackerId !== dummyId);
}

function dummyEvents(report: TrainingReport) {
	return report.events.filter((e) => e.attackerId.startsWith("dummy-"));
}

/** Every check a row can make, expressed once. */
/**
 * Every swing of the ground chain, as one number.
 *
 * A slash is the first link of three, so any count that says "slashes" and reads
 * `moves.slash` is really counting *combos started*. Rows that care about how many
 * times the sword was swung have to add the links up.
 */
function chainSwings(side: TrainingReport["player"]) {
	const m = side.moves ?? {};
	return (m.slash ?? 0) + (m.slash2 ?? 0) + (m.slash3 ?? 0);
}

/** The assertion surface a row's `verify` is written in. */
interface Checks {
	fails: string[];
	swung(move?: MeleeMove): void;
	outcome(expected: MeleeOutcome, move?: MeleeMove): MeleeEventMsg | null;
	never(outcome: MeleeOutcome): void;
	damage(expected: number): void;
	eq(
		label: string,
		actual: number | string | boolean,
		expected: number | string | boolean,
	): void;
	atMost(label: string, actual: number, limit: number): void;
	atLeast(label: string, actual: number, limit: number): void;
}

function checks(report: TrainingReport): Checks {
	const fails: string[] = [];
	const mine = playerEvents(report);
	return {
		fails,
		/** A row that asserts nothing about a swing must still prove one happened. */
		swung(move = "slash") {
			if ((report.player.moves[move] ?? 0) < 1) {
				fails.push(`no ${move} was performed at all`);
			}
		},
		outcome(expected, move) {
			const hit = mine.find((e) => !move || e.move === move);
			if (!hit) {
				fails.push(`no ${move ?? "melee"} impact was judged`);
				return null;
			}
			if (hit.outcome !== expected) {
				fails.push(`outcome was ${hit.outcome}, expected ${expected}`);
			}
			return hit;
		},
		never(outcome) {
			const bad = mine.filter((e) => e.outcome === outcome);
			if (bad.length) fails.push(`${bad.length} ${outcome} events, expected 0`);
		},
		damage(expected) {
			if (report.player.damageDealt !== expected) {
				fails.push(
					`dealt ${report.player.damageDealt} damage, expected ${expected}`,
				);
			}
		},
		eq(label, actual, expected) {
			if (actual !== expected) {
				fails.push(`${label}: ${actual}, expected ${expected}`);
			}
		},
		atMost(label, actual, limit) {
			if (!(actual <= limit)) fails.push(`${label}: ${actual} > ${limit}`);
		},
		atLeast(label, actual, limit) {
			if (!(actual >= limit)) fails.push(`${label}: ${actual} < ${limit}`);
		},
	};
}

/**
 * The rules the training room must not break, whatever the row was testing.
 *
 * Applied to every scenario, because a room that quietly desyncs would make
 * every other assertion in the battery meaningless.
 */
function universalChecks(report: TrainingReport) {
	const fails: string[] = [];
	const m = report.melee;
	if (!report.connected) fails.push("no training-state was ever received");
	if ((m?.illegalActions ?? 0) > 0) {
		fails.push(`${m?.illegalActions} actions while stunned`);
	}
	if ((m?.blockedUnblockables ?? 0) > 0) {
		fails.push(`${m?.blockedUnblockables} unblockables blocked`);
	}
	if ((m?.airborneChainLinks ?? 0) > 0) {
		fails.push(`${m?.airborneChainLinks} combo links thrown airborne`);
	}
	if ((m?.frameDataViolations ?? 0) > 0) {
		fails.push(`${m?.frameDataViolations} frame data violations`);
	}
	if ((m?.meleeDesyncFrames ?? 0) > 0) {
		fails.push(`${m?.meleeDesyncFrames} melee prediction desyncs`);
	}
	const recon = report.reconciliation;
	if (!recon) {
		fails.push("no reconciliation at all — the client was simulating alone");
	} else if (recon.avgErrorPx > MAX_AVG_RECON_PX) {
		fails.push(
			`avg reconciliation error ${recon.avgErrorPx}px > ${MAX_AVG_RECON_PX}px`,
		);
	}
	return fails;
}

/**
 * Aim right, always.
 *
 * You face where you aim, and Playwright never moves the mouse here — so
 * without this the fighter faces whichever side of it the cursor's default
 * centre-screen position falls on, which flips when a scenario changes the
 * spawn. That is exactly how the separation row first "failed": the fighter
 * swung left, away from the dummy, and the probe could only report a miss.
 */
const AIM_RIGHT = 0;

const SLASH = { intent: { attack: true }, holdMs: 60, aimAngle: AIM_RIGHT };
const UPPERCUT = {
	intent: { uppercut: true },
	holdMs: 60,
	aimAngle: AIM_RIGHT,
};
/**
 * Charge past MASSIVE_CHARGE_MS (1600ms), then let go — the release is what fires.
 */
const MASSIVE = { intent: { attack: true }, holdMs: 2550, aimAngle: AIM_RIGHT };
/** A move's full duration, so the next step is not swallowed by its recovery. */
const REST = 500;

// ---- the dagger's steps -------------------------------------------------
// The dagger uses the same three buttons with different meanings: LMB stabs,
// Shift thrusts, F shoryukens. These steps drive them the way SLASH drives
// the sword, and the dagger rows below consume them.
const STAB = { intent: { attack: true }, holdMs: 60, aimAngle: AIM_RIGHT };
const THRUST = { intent: { block: true }, holdMs: 60, aimAngle: AIM_RIGHT };
const SHORYUKEN = {
	intent: { uppercut: true },
	holdMs: 60,
	aimAngle: AIM_RIGHT,
};

/**
 * The ground chain, as three presses.
 *
 * The gap is the whole point: a link becomes available when the previous swing
 * enters recovery, at `startup + active` = 160ms. Pressing at 170ms catches that
 * with a frame to spare — and a probe that pressed any earlier would measure a
 * swallowed input and call the combo broken.
 */
/** The massive-delivery row's dummy spawn — the poll target for the reset. */
const SPAWN_DUMMY_X = 330;

const CHAIN = [
	{ intent: { attack: true }, holdMs: 60, aimAngle: AIM_RIGHT },
	{ intent: {}, holdMs: 110, aimAngle: AIM_RIGHT },
	{ intent: { attack: true }, holdMs: 60, aimAngle: AIM_RIGHT },
	{ intent: {}, holdMs: 110, aimAngle: AIM_RIGHT },
	{ intent: { attack: true }, holdMs: 60, aimAngle: AIM_RIGHT },
];

/**
 * The battery.
 *
 * `run` receives the page and returns `{ report, extra }`; `verify` turns that
 * into a list of failures. Splitting them keeps the expectations readable as a
 * table, which is what makes them reviewable against the spec.
 */
interface BatteryRow {
	name: string;
	/** The row needs the Lia kit (her ultimate or her item). */
	lia?: boolean;
	/** The row needs the dagger kit. */
	dagger?: boolean;
	/** Drive the scenario by hand, returning the report and any extra state. */
	run?: (page: Page) => Promise<{ report: TrainingReport; extra: unknown }>;
	/** A custom read after a `scenario` row settles. */
	after?: (page: Page) => Promise<unknown>;
	/** The ordinary path: hand the scenario to `__training.run`. */
	scenario?: TrainingScenario;
	/** `extra` is the row's own shape — a number, a boolean or a bundle. */
	verify: (report: TrainingReport, extra: any) => string[];
}

const BATTERY: BatteryRow[] = [
	{
		name: "idle dummy does nothing",
		async run(page) {
			await page.evaluate(() => window.__training!.set({ behaviour: "idle" }));
			await page.evaluate(() => window.__training!.reset());
			const samples = await page.evaluate(async () => {
				const seen = [];
				for (let i = 0; i < 30; i++) {
					await new Promise((r) => setTimeout(r, 100));
					const s = window.__training!.state();
					seen.push(`${s.dummy.meleeAction}|${s.dummy.blocking}`);
				}
				return [...new Set(seen)];
			});
			return { report: await report(page), extra: { samples } };
		},
		verify(report, { samples }) {
			const c = checks(report);
			c.eq("distinct dummy states", samples.join(","), "none|false");
			c.eq("dummy slashes", report.dummy.moves.slash, 0);
			c.eq("dummy blocks", report.dummy.blocks, 0);
			c.eq("impacts", report.events.length, 0);
			return c.fails;
		},
	},
	{
		name: "slash lands on an idle dummy",
		scenario: {
			name: "slash lands",
			config: { behaviour: "idle" },
			steps: [SLASH],
			settleMs: 700,
		},
		verify(report) {
			const c = checks(report);
			c.swung("slash");
			c.outcome("hit", "slash");
			c.damage(DAMAGE.slash);
			return c.fails;
		},
	},
	{
		/**
		 * The feature this whole chain exists for, measured end to end: three
		 * different cuts, three landed hits, and the target on the floor.
		 *
		 * Worth its own row because every part of it can fail silently. A link
		 * window one tick too tight swallows the second press; invulnerability that
		 * the links do not pierce lets all three animations play for seven damage;
		 * a knockdown that never sets its timer looks exactly like a long stun.
		 */
		name: "the ground chain lands three hits and knocks down",
		scenario: {
			name: "ground chain",
			config: { behaviour: "idle" },
			steps: CHAIN,
			settleMs: 900,
		},
		verify(report) {
			const c = checks(report);
			c.swung("slash");
			c.swung("slash2");
			c.swung("slash3");
			c.eq(
				"chain outcomes",
				playerEvents(report)
					.map((e) => `${e.move}:${e.outcome}`)
					.join(","),
				"slash:hit,slash2:hit,slash3:hit",
			);
			c.damage(DAMAGE.slash + DAMAGE.slash2 + DAMAGE.slash3);
			c.atLeast("knockdowns", report.melee?.knockdowns ?? 0, 1);
			c.atLeast("combos finished", report.melee?.combosFinished ?? 0, 1);
			return c.fails;
		},
	},
	{
		name: "a block guard-breaks a slash",
		scenario: {
			name: "block breaks a slash",
			config: { behaviour: "blockAll", facing: "foe" },
			steps: [SLASH],
			settleMs: 700,
		},
		verify(report) {
			const c = checks(report);
			c.swung("slash");
			c.never("hit");
			c.never("backstab");
			c.damage(0);
			// Every guard that stops a sword attack breaks it — there is no
			// rewardless "blocked" tier any more.
			const e = playerEvents(report)[0];
			if (e && e.outcome !== "parried") {
				c.fails.push(`outcome ${e.outcome}, expected parried`);
			}
			c.atLeast("dummy blocks raised", report.dummy.blocks, 1);
			return c.fails;
		},
	},
	{
		name: "uppercut beats a block and launches",
		/**
		 * A launch is an *event*, so it is measured by watching, not by asking once
		 * afterwards.
		 *
		 * This used to read `__training.state().dummy.vy` after the settle, and that
		 * is the wrong instrument twice over. `training-state` is sent on change and
		 * its change signature deliberately excludes position — so the velocity in it
		 * is from whenever the config, script status or stats last moved, not from
		 * now. And a -620 launch is spent in ~340ms, so even a live single sample is a
		 * coin flip on where in the arc it lands.
		 *
		 * The snapshot is the live source: `enemyPhys` is the dummy's authoritative
		 * state, predicted every tick and corrected every snapshot. Polling it for
		 * the minimum answers the question actually being asked — did this fighter
		 * ever leave the ground?
		 */
		async run(page) {
			const running = page.evaluate(
				(s: TrainingScenario) => window.__training!.run(s),
				{
					name: "uppercut beats a block",
					config: { behaviour: "blockAll", facing: "foe" },
					steps: [UPPERCUT],
					settleMs: 900,
				} as TrainingScenario,
			);

			let minVy = Number.POSITIVE_INFINITY;
			for (let i = 0; i < 45; i++) {
				const vy = await page.evaluate(
					() => window.__gameState?.().enemyPhys?.vy ?? 0,
				);
				minVy = Math.min(minVy, vy);
				await page.waitForTimeout(20);
			}

			return { report: await running, extra: minVy };
		},
		verify(report, minVy) {
			const c = checks(report);
			c.swung("uppercut");
			c.outcome("hit", "uppercut");
			c.damage(DAMAGE.uppercut);
			if (!(minVy < 0)) {
				c.fails.push(
					`dummy never rose (lowest vy ${minVy}), expected a launch`,
				);
			}
			return c.fails;
		},
	},
	{
		/**
		 * The back-massive, end to end: a 1.6s charge *away* from a turtling
		 * opponent, then a release that slams the floor in front of the player.
		 * The turtle is behind the player — outside the swing, inside the
		 * blast's back reach — and the blast stuns straight through the guard.
		 *
		 * The opener slash goes with the aim: facing away means the press that
		 * starts the charge does not hand the turtle a free guard break.
		 */
		name: "a back massive blasts through a block",
		scenario: {
			name: "back massive",
			config: {
				behaviour: "blockAll",
				facing: "foe",
				spawn: { player: { x: 400, y: 480 }, dummy: { x: 440, y: 480 } },
			},
			steps: [{ ...MASSIVE, aimAngle: Math.PI }],
			settleMs: 1500,
		},
		verify(report) {
			const c = checks(report);
			c.swung("massive");
			const blast = playerEvents(report).find((e) => e.outcome === "blast");
			if (!blast) c.fails.push("no blast was judged");
			// The swing itself reached nobody — only the blast hit, for its 24.
			c.damage(DAMAGE.massive);
			return c.fails;
		},
	},
	{
		/**
		 * The plunge bomb, end to end — the dummy performs it, the player is the
		 * turtle it ignores.
		 *
		 * The dummy's script holds attack *continuously* across two beats: beat
		 * playback has no release frame between beats, which is the one thing the
		 * player-side step model cannot express — every step ends in a release,
		 * and the release fires the massive, so a player cannot charge, jump and
		 * release inside one step. So the bomb is driven where the tooling can
		 * say it: charge facing away (the opener slash must not hit the blocking
		 * player — a guard break would spend the charge), turn and jump, release
		 * mid-air. The dive lands beside the player and the blast ignores the
		 * guard: full damage, stun and knockup through a raised block.
		 */
		name: "a plunge bomb ignores a block and knocks up",
		async run(page) {
			const running = page.evaluate(
				(s: TrainingScenario) => window.__training!.run(s),
				{
					name: "plunge bomb",
					config: {
						behaviour: "script",
						script: {
							loop: true,
							beats: [
								// Turn away from the player first — facing is locked
								// through a swing, so the turn has to happen while
								// nothing is running, or the opener slash follows the
								// spawn-facing and hits the blocking player's guard,
								// which guard-breaks the charge away.
								{ ms: 150, face: 1 },
								// Charge, facing away from the player on the left.
								{ ms: 2450, hold: { attack: true }, face: 1 },
								// Turn toward the player and jump, still holding.
								{
									ms: 300,
									hold: { attack: true, jump: true },
									face: -1,
								},
								// Release mid-air: the dive begins.
								{ ms: 60 },
								// The dive, the stuck, and the next cycle's gap.
								{ ms: 700 },
							],
						},
					},
					// The guard has to outlast the first bomb's detonation (~3s in
					// with the 1.6s charge) but end before the dummy's second
					// cycle — the cycle is ~3.7s, so the second bomb lands ~6.5s
					// in. A hold of 4s clears the first bomb with a second of
					// margin on either side; the original 5s sat knife-edge against
					// the second cycle and the pass/fail flipped on a few frames of
					// server timing.
					steps: [{ intent: { block: true }, holdMs: 4000, aimAngle: 0 }],
					settleMs: 1200,
				} as TrainingScenario,
			);

			// The bomb detonates ~3s into the cycle, so the poll has to outlast
			// the charge. The player is the victim this time.
			let minVy = Number.POSITIVE_INFINITY;
			for (let i = 0; i < 400; i++) {
				const vy = await page.evaluate(
					() => window.__gameState?.().playerPhys?.vy ?? 0,
				);
				minVy = Math.min(minVy, vy);
				await page.waitForTimeout(20);
			}

			return { report: await running, extra: minVy };
		},
		verify(report, minVy) {
			const c = checks(report);
			const bomb = dummyEvents(report).find((e) => e.outcome === "bomb");
			if (!bomb) c.fails.push("no bomb blast was judged");
			// The bomb ignores the guard: the full 24 through a raised block.
			c.eq("damage taken through the guard", report.player.damageTaken, 24);
			if (!(minVy < 0)) {
				c.fails.push(
					`player never rose (lowest vy ${minVy}), expected a knockup`,
				);
			}
			return c.fails;
		},
	},
	{
		name: "backstab ignores a block",
		scenario: {
			name: "backstab",
			config: { behaviour: "blockAll", facing: "away" },
			steps: [SLASH],
			settleMs: 700,
		},
		verify(report) {
			const c = checks(report);
			c.swung("slash");
			c.outcome("backstab", "slash");
			c.damage(DAMAGE.slash);
			return c.fails;
		},
	},
	{
		name: "a backstab needs real separation",
		scenario: {
			name: "backstab needs separation",
			config: {
				behaviour: "blockAll",
				facing: "away",
				// 20px apart — inside BACKSTAB_MIN_SEPARATION_PX (a full body width).
				// Fighters do not collide with each other, so this is an ordinary close
				// exchange, and it must not be decided by which way two overlapping
				// bodies happen to be leaning: at half a body width a measured match
				// produced 11 backstabs to 1 clean hit.
				spawn: { player: { x: 400, y: 480 }, dummy: { x: 420, y: 480 } },
			},
			steps: [SLASH],
			settleMs: 700,
		},
		verify(report) {
			const c = checks(report);
			c.swung("slash");
			c.never("backstab");
			// A whiff would satisfy "no backstab" trivially, so the swing must have
			// actually been judged.
			c.atLeast("impacts judged", playerEvents(report).length, 1);
			return c.fails;
		},
	},
	{
		name: "frame data is honest",
		scenario: {
			name: "frame data",
			config: { behaviour: "idle" },
			steps: [
				{ ...SLASH, restMs: REST },
				{ ...UPPERCUT, restMs: REST + 200 },
				{ ...MASSIVE, restMs: REST },
			],
			settleMs: 1200,
		},
		verify(report) {
			const c = checks(report);
			c.atLeast("exchanges observed", report.exchanges.length, 3);
			for (const x of report.exchanges) {
				for (const phase of ["startupMs", "activeMs", "recoveryMs"] as const) {
					const drift = Math.abs(x.measured[phase] - x.declared[phase]);
					if (drift > FRAME_TOLERANCE_MS) {
						c.fails.push(
							`${x.move} ${phase} measured ${x.measured[phase]}ms vs declared ${x.declared[phase]}ms`,
						);
					}
				}
			}
			c.eq("frame data violations", report.melee?.frameDataViolations ?? 0, 0);
			return c.fails;
		},
	},
	{
		name: "recovery is punishable",
		scenario: {
			name: "counter-attack punishes recovery",
			config: {
				behaviour: "counterAttack",
				facing: "foe",
				timing: { delayMs: 120 },
			},
			/**
			 * A slash thrown at thin air, aimed *away* from the dummy.
			 *
			 * Whiffing is the honest case — recovery is what you are punished for
			 * when you miss — and it is also the only one that works. A move that
			 * connects stuns the dummy for longer than the counter's delay, so the
			 * punish the row exists to demonstrate never got to happen: it was
			 * measuring its own setup landing instead.
			 */
			steps: [{ intent: { attack: true }, holdMs: 60, aimAngle: Math.PI }],
			settleMs: 1500,
		},
		verify(report) {
			const c = checks(report);
			c.swung("slash");
			// The player's swing found nothing, so every impact in the window is the
			// dummy's — landed inside the recovery it was timed against.
			c.eq("damage dealt by the whiffing player", report.player.damageDealt, 0);
			c.atLeast("dummy counter-swings", report.dummy.moves.slash, 1);
			const landed = dummyEvents(report).filter(
				(e) => e.outcome === "hit" || e.outcome === "backstab",
			);
			c.atLeast("dummy hits landed", landed.length, 1);
			c.atLeast("damage taken", report.player.damageTaken, 1);
			return c.fails;
		},
	},
	{
		name: "script replay is deterministic",
		async run(page) {
			const script = {
				loop: true,
				beats: [
					{ ms: 55, hold: { attack: true } },
					{ ms: 105 },
					{ ms: 95, hold: { block: true } },
					{ ms: 245 },
				],
			};
			const once = async () => {
				await page.evaluate(
					(s) => window.__training!.set({ behaviour: "script", script: s }),
					script,
				);
				await page.evaluate(() => window.__training!.reset());
				await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));
				return report(page);
			};
			const a = await once();
			const b = await once();
			return { report: b, extra: { a, b } };
		},
		verify(_report, { a, b }) {
			const c = checks(a);
			const seq = (r: TrainingReport) =>
				r.events.map((e) => `${e.move}:${e.outcome}`);
			// Determinism is a property of the *script*, so the dummy's own move
			// count is the direct measure and the one that must match exactly.
			// Impacts are not: the first hit knocks the target out of range, so how
			// many of a fixed number of swings connect is a fact about knockback,
			// and requiring three of them made this row fail for reasons that had
			// nothing to do with determinism.
			c.atLeast("dummy moves in run A", a.dummy.moves.slash, 3);
			c.atLeast("dummy moves in run B", b.dummy.moves.slash, 3);
			// The window is wall-clock bounded, so the two runs can differ by the
			// last, partially-elapsed cycle. Everything before that must be identical
			// — if it is not, no measurement taken with this room means anything.
			const n = Math.min(seq(a).length, seq(b).length);
			if (Math.abs(seq(a).length - seq(b).length) > 1) {
				c.fails.push(
					`event counts ${seq(a).length} vs ${seq(b).length} differ by more than one cycle`,
				);
			}
			const left = seq(a).slice(0, n).join(",");
			const right = seq(b).slice(0, n).join(",");
			if (left !== right) {
				c.fails.push(`event sequences differ:\n  A ${left}\n  B ${right}`);
			}
			if (a.dummy.moves.slash !== b.dummy.moves.slash) {
				c.fails.push(
					`dummy slashes ${a.dummy.moves.slash} vs ${b.dummy.moves.slash}`,
				);
			}
			return c.fails;
		},
	},
	{
		name: "record and playback round-trip",
		async run(page) {
			// Record the player butterflying, then hand the recording back to the
			// dummy and watch it perform the same sequence.
			await page.evaluate(() =>
				window.__training!.set({ behaviour: "record", facing: "foe" }),
			);
			await page.evaluate(() => window.__training!.reset());
			for (let i = 0; i < 4; i++) {
				await page.evaluate(() =>
					window.__training!.input({ attack: true }, 60),
				);
				await page.evaluate(() =>
					window.__training!.input({ block: true }, 120),
				);
			}
			const recording = await report(page);
			const status = await page.evaluate(
				() => window.__training!.state().status,
			);

			await page.evaluate(() =>
				window.__training!.set({ behaviour: "playback" }),
			);
			await page.evaluate(() => window.__training!.reset());
			await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));
			const playback = await report(page);
			return { report: playback, extra: { recording, status, playback } };
		},
		verify(_r, { recording, status, playback }) {
			const c = checks(recording);
			c.atLeast("frames recorded", status.recordedFrames, 60);
			// Counted across the whole chain, not just its opener. A grounded
			// butterfly walks slash → slash2 → slash3, so asking for three of the
			// *first* link measures how deep the combo went rather than how many
			// swings were recorded — which is not what this row is about.
			c.atLeast("player slashes recorded", chainSwings(recording.player), 3);
			// The dummy replays the same buttons, so it must produce the same moves.
			c.atLeast("dummy slashes on playback", chainSwings(playback.dummy), 3);
			c.atLeast("dummy blocks on playback", playback.dummy.blocks, 1);
			return c.fails;
		},
	},
	{
		/**
		 * A guard covers the side you face, and that now includes bullets. The
		 * dummy holds a gun and shoots; the player guards, then turns away.
		 */
		name: "a block stops a bullet from the front",
		async run(page) {
			/**
			 * Sampled *while the guard is still up*, not after the scenario settles.
			 *
			 * `run()` reports once the steps are done, and the dummy keeps firing
			 * into an unguarded player for the whole settle window — so the first
			 * version of this row measured the three shots that landed after the
			 * block ended and called a working guard a failure.
			 */
			const holdAndSample = async (facing: number) => {
				await page.evaluate(() =>
					window.__training!.set({
						behaviour: "slash",
						dummyStance: "gun",
						facing: "foe",
						// Both fighters in the clear lane *between* the two pillars.
						// Far enough apart that the dummy's swings cannot reach and
						// only its shots can — otherwise a melee hit would be doing
						// the damage this row attributes to a bullet — and with no
						// cover in between: at x=200 every shot died on PILLAR_LEFT
						// and the row measured a wall rather than a guard.
						spawn: {
							player: { x: 330, y: 480 },
							dummy: { x: 460, y: 480 },
						},
						timing: { periodMs: 300 },
					}),
				);
				await page.evaluate(() => window.__training!.reset());
				return page.evaluate(async (f) => {
					const hold = window.__training!.input({ block: true }, 2600, f);
					let first = null;
					let last = null;
					for (let i = 0; i < 26; i++) {
						await new Promise((r) => setTimeout(r, 90));
						const s = window.__training!.state();
						if (!s.local.blocking) continue;
						// Damage is cumulative since the reset, so the total includes any
						// shot that landed in the moment before the guard came up. The
						// question is what the *guard* let through, which is the delta
						// across the window it was actually up.
						first ??= s;
						last = s;
					}
					await hold;
					return {
						samples: first && last ? 1 : 0,
						blocking: !!last?.local.blocking,
						facing: last?.local.facing ?? 0,
						damageWhileBlocking:
							(last?.stats.player.damageTaken ?? 0) -
							(first?.stats.player.damageTaken ?? 0),
					};
				}, facing);
			};

			// Aiming right faces the dummy — the shots arrive from the front.
			const front = await holdAndSample(0);
			// Aiming left turns the guard away from them.
			const back = await holdAndSample(Math.PI);
			return { report: await report(page), extra: { front, back } };
		},
		verify(report, { front, back }) {
			const c = checks(report);
			c.eq("guard was up while sampling", front.blocking, true);
			c.eq("facing the shots", front.facing, 1);
			c.eq("damage through a front guard", front.damageWhileBlocking, 0);
			// A guard pointed the wrong way must still let shots through, or this
			// row would pass just as well against a fighter nothing could reach.
			c.eq("guard was up while sampling (turned away)", back.blocking, true);
			c.eq("facing away from the shots", back.facing, -1);
			c.atLeast(
				"damage with the guard turned away",
				back.damageWhileBlocking,
				10,
			);
			return c.fails;
		},
	},
	{
		/**
		 * The sword guard is the universal counter to ultimates: the dummy holds
		 * block, the player casts the black hole straight into it, and the
		 * grenade is caught on the guard — no hole opens, the meter stays spent,
		 * and the deny is recorded. This is the whole "sword defend denies
		 * ultimates" rule, measured as one interaction.
		 */
		// The player casts the *black hole* at a blocking dummy. Jeffs' storm is
		// not a throw, so a jeffs run cannot measure this row — Lia-only.
		lia: true,
		name: "a block denies an ultimate",
		async run(page) {
			const running = page.evaluate(() =>
				window.__training!.run({
					name: "deny",
					config: {
						behaviour: "blockAll",
						facing: "foe",
						// Default spawns: 60px apart, both in the clear lane between
						// the pillars. A 60px throw is a ~77ms flight — comfortably
						// inside a held guard.
					},
					steps: [
						{
							intent: { ultimate: true },
							holdMs: 200,
							aimAngle: 0,
							restMs: 500,
						},
					],
					settleMs: 2600,
				}),
			);
			// The hole would live 4400ms if it opened; the deny kills the flight
			// about 77ms after it starts. Sample the room for a singularity either
			// way, so "no deny" cannot hide behind "nobody looked".
			let holeSeen = false;
			for (let i = 0; i < 40; i++) {
				const s = await page.evaluate(() => window.__ultState?.() ?? null);
				if (s?.singularity) holeSeen = true;
				await page.waitForTimeout(50);
			}
			const report_ = await running;
			return { report: report_, extra: holeSeen };
		},
		verify(report, holeSeen) {
			const c = checks(report);
			c.atLeast("denies recorded", report.denies, 1);
			c.eq("no hole opened after a deny", holeSeen, false);
			return c.fails;
		},
	},
	{
		/**
		 * The delivery rule: an armed massive is a weapon you carry. The dummy
		 * charges to full, then walks, dashes and walks again — all while still
		 * holding the button — and only then releases to fire the massive.
		 *
		 * This cannot be driven on the player's side: every step ends in a
		 * release, and the release fires the massive, so a player cannot express
		 * "charge, keep holding, walk". The dummy's beat scripts hold
		 * continuously, which is exactly the gesture. A stale server running
		 * the old root-everything rule fails this row loudly: the walk and dash
		 * never happen, and the massive fires from where the charge started.
		 */
		name: "an armed massive walks and dashes",
		async run(page) {
			const running = page.evaluate(
				(s: TrainingScenario) => window.__training!.run(s),
				{
					name: "armed massive delivery",
					config: {
						behaviour: "script",
						// The dummy starts at 330 and delivers right, away from the
						// player at 240. The lane between the ground pillars (280-304
						// and 496-520) gives the delivery ~165px of clear ground; the
						// default spawns put the right pillar 44px from the dummy,
						// which stopped the delivery dead at the wall.
						spawn: { player: { x: 240, y: 480 }, dummy: { x: 330, y: 480 } },
						script: {
							loop: true,
							beats: [
								// Turn away from the player first — the spawn-facing
								// is toward them, and facing locks through a swing, so
								// the turn has to happen before the opener slash.
								{ ms: 150, face: 1 },
								// Charge, facing away (the opener slash misses).
								{ ms: 2450, hold: { attack: true }, face: 1 },
								// The charge completes ~50ms into this beat: walk.
								{
									ms: 300,
									hold: { attack: true, moveRight: true },
									face: 1,
								},
								// Dash while armed — the burst closes distance. The
								// dash is a beat-level one-shot, not a held button.
								{ ms: 200, hold: { attack: true }, dash: 1, face: 1 },
								// Walk some more.
								{
									ms: 300,
									hold: { attack: true, moveRight: true },
									face: 1,
								},
								// Release: the massive fires from where the delivery
								// brought it — and whiffs, because the player is far
								// behind it. The eruption must still happen. Every
								// beat keeps the facing, or the dummy turns back to
								// "foe" the moment a beat forgets it — including this
								// one and the gap after.
								{ ms: 60, face: 1 },
								{ ms: 700, face: 1 },
							],
						},
					},
					// The player just guards for the whole cycle — holding the run
					// open past the charge and the delivery, without getting in the
					// way (the dummy faces away, so the guard never breaks its
					// charge).
					steps: [{ intent: { block: true }, holdMs: 6500, aimAngle: 0 }],
					settleMs: 800,
				} as TrainingScenario,
			);

			// The run's reset is async (a server round-trip), so the start
			// position must be read after it lands — otherwise the previous
			// row's dummy position is counted as this delivery's origin and a
			// full walk reads as a 4px shuffle. The dummy's charge keeps it at
			// its spawn for 2.6s, so polling for the spawn is safe: the read
			// happens while the dummy is still rooted there.
			await page.waitForFunction(
				(spawnX) => (window.__gameState?.().enemyPhys?.x ?? -1) === spawnX,
				SPAWN_DUMMY_X,
				{ timeout: 3000 },
			);
			const startX = await page.evaluate(
				() => window.__gameState?.().enemyPhys?.x ?? 0,
			);
			const report_ = await running;
			return { report: report_, extra: { startX } };
		},
		verify(report, { startX }) {
			const c = checks(report);
			c.atLeast("massives fired", report.dummy.moves.massive, 1);
			// The delivery, read from the server's own blast: the slam point is
			// 72px in front of the body, so the fighter fired from
			// `blast.x - 72`. The client's remote *view* of a scripted dummy
			// lags its prediction, so it cannot be trusted for this — the blast
			// position is the server's word.
			const blast = dummyEvents(report).find(
				(e) => e.outcome === "blast" && !e.victimId,
			);
			if (!blast) {
				c.fails.push("no whiffed blast was judged");
			} else {
				const firedFrom = blast.x - 72;
				// The armed walk always moves the fighter at least this far even
				// when the run's timing lands the release early — and a fighter
				// still rooted by a stale charge moves nothing at all. The full
				// walk-dash-walk gesture is asserted deterministically in
				// `Melee.test.ts`; this row guards the regression that made the
				// armed fighter unable to move at all.
				c.atLeast("delivery distance px", firedFrom - startX, 30);
			}
			// The whiffed massive still erupts: the blast event had no victim.
			c.atLeast(
				"whiffed blast erupted",
				dummyEvents(report).filter((e) => e.outcome === "blast" && !e.victimId)
					.length,
				1,
			);
			return c.fails;
		},
	},
	{
		/**
		 * The aim phase is the commitment: killed while holding the button, the
		 * whole meter is gone and the killer gets the DENY.
		 *
		 * The killer is the dummy's own black hole: a scripted cast lands the
		 * grenade on the wall-pinned player, the hole opens on them, and its
		 * 7-per-250ms holds them down through ~3.8s to death — the only weapon
		 * fast enough to kill inside a 9s button hold, now that a sword hit
		 * charges for 1.6 seconds. The player holds R and does nothing else.
		 */
		name: "killed while holding loses the ultimate",
		async run(page) {
			const running = page.evaluate(() =>
				window.__training!.run({
					name: "deny-kill",
					config: {
						behaviour: "script",
						script: {
							loop: true,
							beats: [
								// Aim at the player and cast on the release.
								{ ms: 400, hold: { ultimate: true }, aimAngle: Math.PI },
								// Recharge, then cast again if the first missed.
								{ ms: 5000 },
							],
						},
						// Pin the player so the grenade cannot miss its landing.
						spawn: {
							player: { x: 40, y: 480 },
							dummy: { x: 70, y: 480 },
						},
						// The player has to actually die — the default dummy stays
						// invincible, which is fine, but the player must not.
						playerInvincible: false,
					},
					steps: [
						{
							intent: { ultimate: true },
							holdMs: 9000,
							aimAngle: 0,
							restMs: 0,
						},
					],
					settleMs: 500,
				}),
			);
			const report_ = await running;
			const playerHp = await page.evaluate(
				() => window.__gameState?.().playerHP ?? 100,
			);
			return { report: report_, extra: playerHp };
		},
		verify(report, playerHp) {
			const c = checks(report);
			c.atLeast("denies recorded", report.denies, 1);
			c.eq("the player was killed while holding", playerHp <= 0, true);
			return c.fails;
		},
	},
	{
		name: "training does not desync",
		scenario: {
			name: "desync check",
			config: { behaviour: "butterfly", facing: "foe" },
			steps: [
				{ ...SLASH, restMs: REST },
				{
					intent: { block: true },
					holdMs: 300,
					aimAngle: AIM_RIGHT,
					restMs: 100,
				},
				SLASH,
			],
			settleMs: 2000,
		},
		verify(report) {
			const c = checks(report);
			c.eq("melee desync frames", report.melee?.meleeDesyncFrames ?? 0, 0);
			c.atLeast("dummy moves", report.dummy.moves.slash, 2);
			c.atLeast(
				"reconciliation corrections",
				report.reconciliation?.totalCorrections ?? 0,
				5,
			);
			c.atMost(
				"avg reconciliation error px",
				report.reconciliation?.avgErrorPx ?? 999,
				MAX_AVG_RECON_PX,
			);
			return c.fails;
		},
	},

	// ====================================================================
	//  THE DAGGER (Anands)
	//
	//  `--hero=anands` runs the whole battery as the dagger, and these rows
	//  measure the dagger's own moves. The numbers are restated rather than
	//  imported — a probe that shares arithmetic with the code under test
	//  cannot disagree with it.
	// ====================================================================

	{
		name: "dagger stabs land fast and weak",
		dagger: true,
		scenario: {
			name: "dagger stabs",
			config: { behaviour: "idle" },
			steps: [
				// Walk once into the 30px reach — 60px of spawn gap is outside
				// it — then let the spam do the rest. Each landed stab knocks
				// the dummy a few px back, and the reach swallows that drift, so
				// a stationary dagger wielder keeps hitting: that is what "very
				// spammable" means, and the row proves the whole rhythm lands.
				{ intent: { right: true }, holdMs: 150, aimAngle: AIM_RIGHT },
				{ ...STAB, restMs: 260 },
				{ ...STAB, restMs: 260 },
				{ ...STAB, restMs: 260 },
			],
			settleMs: 800,
		},
		verify(report) {
			const c = checks(report);
			c.eq(
				"stab outcomes",
				playerEvents(report)
					.map((e) => `${e.move}:${e.outcome}`)
					.join(","),
				"stab:hit,stab:hit,stab:hit",
			);
			c.damage(5 * 3);
			return c.fails;
		},
	},

	{
		name: "the thrust knocks the dummy down for a full second and a half",
		dagger: true,
		scenario: {
			name: "dagger thrust",
			config: { behaviour: "idle" },
			steps: [{ ...THRUST, restMs: 900 }],
			settleMs: 2200,
		},
		verify(report) {
			const c = checks(report);
			c.swung("thrust");
			c.outcome("hit", "thrust");
			c.damage(16);
			c.atLeast("knockdowns", report.melee?.knockdowns ?? 0, 1);
			return c.fails;
		},
	},

	{
		name: "a sword guard stops a stab — the spam has an answer",
		dagger: true,
		scenario: {
			name: "stab vs guard",
			config: { behaviour: "blockAll", dummyStance: "sword" },
			steps: [{ ...STAB, restMs: 600 }],
			settleMs: 1200,
		},
		verify(report) {
			const c = checks(report);
			c.outcome("parried", "stab");
			c.damage(0);
			c.atLeast("parries", report.melee?.parries ?? 0, 1);
			return c.fails;
		},
	},

	{
		name: "the shoryuken knocks down but is blockable",
		dagger: true,
		scenario: {
			name: "shoryuken",
			config: { behaviour: "idle" },
			steps: [{ ...SHORYUKEN, restMs: 900 }],
			settleMs: 1600,
		},
		verify(report) {
			const c = checks(report);
			c.swung("shoryuken");
			c.outcome("hit", "shoryuken");
			c.damage(8);
			c.atLeast("knockdowns", report.melee?.knockdowns ?? 0, 1);
			return c.fails;
		},
	},

	{
		name: "the machine gun streams: more shots, weaker rounds",
		dagger: true,
		scenario: {
			name: "machine gun",
			config: { behaviour: "idle", dummyStance: "gun" },
			steps: [
				{ intent: { swordStance: false }, holdMs: 100, aimAngle: AIM_RIGHT },
				{
					intent: { swordStance: false, attack: true },
					holdMs: 660,
					aimAngle: AIM_RIGHT,
				},
			],
			settleMs: 1200,
		},
		verify(report) {
			const c = checks(report);
			c.atLeast("bullets fired", report.bullets.fired ?? 0, 4);
			c.eq(
				"bullet damage",
				report.player.damageDealt,
				5 * (report.bullets.hits ?? 0),
			);
			return c.fails;
		},
	},

	{
		name: "the dragon thrust sweeps the line once — one hit per cast",
		dagger: true,
		scenario: {
			name: "dragon thrust",
			config: { behaviour: "idle" },
			steps: [{ intent: { ultimate: true }, holdMs: 300, aimAngle: AIM_RIGHT }],
			settleMs: 1600,
		},
		verify(report) {
			const c = checks(report);
			// One hit per cast, not per tick: the swept box keeps the knocked
			// victim inside it for the whole run, so the latch is what separates
			// a line sweep from a shredder.
			c.eq("dragon damage", report.player.damageDealt, DRAGON_DAMAGE);
			c.eq("dragon events", report.events.length, 1);
			c.atLeast("melee events", report.events.length, 1);
			return c.fails;
		},
	},

	// ---- the items ---------------------------------------------------------
	// The item button is the third member of the kit, and each hero's item is
	// measured the same way every other ability is: one press, one consequence,
	// judged by the server. `explosions` and `rooted` are counters on the
	// training report because a clean run where the item never fired would
	// prove nothing.

	{
		// The player throws the *HE* grenade. Jeffs' item is the smoke, so a
		// jeffs run cannot measure this row — Lia-only.
		lia: true,
		name: "an HE grenade lands and blasts the dummy",
		scenario: {
			name: "HE grenade",
			config: { behaviour: "idle" },
			steps: [{ intent: { item: true }, holdMs: 60, aimAngle: AIM_RIGHT }],
			// The grenade has to fly and explode; the blast lands after the fuse
			// or on contact, so the settle has to outlast the flight.
			settleMs: 1600,
		},
		verify(report) {
			const c = checks(report);
			c.atLeast("HE blasts", report.explosions, 1);
			// The dummy sits 60px away, so the throw connects close to the
			// epicentre — a third of a bar at minimum, and the point is that the
			// grenade is a real weapon, not a cosmetic lob.
			c.atLeast("blast damage", report.player.damageDealt, 30);
			return c.fails;
		},
	},

	{
		name: "a trap catches the walking dummy and roots it for the full 3s",
		dagger: true,
		// Custom run: the trap has to be thrown, then the *dummy* has to walk into
		// it — the trap's whole behaviour is about where the other fighter goes,
		// so a scenario that only pressed buttons at the player would never
		// spring anything. The root itself is measured: the dummy keeps pressing
		// left through the lock, so its x staying put for 3s and then moving is
		// the lock doing its job, sampled at 2.2s (still rooted) and 3.7s (free).
		async run(page) {
			return await page.evaluate(async () => {
				// `reset` clears the counters after its own settle, so it has to
				// be awaited before the trap is laid — otherwise the trap's spring
				// can race the counter reset.
				await window.__training!.reset();
				await new Promise((r) => setTimeout(r, 300));
				// Throw the trap at the dummy's feet: the canister arcs under its
				// own gravity and plants a step short of the aim, right in the
				// path the dummy walks left across.
				const s = window.__training!.state();
				const angle = Math.atan2(
					s.dummy.y + 48 - (s.local.y + 24),
					Math.max(1, s.dummy.x - s.local.x),
				);
				await window.__training!.input({ item: true }, 60, angle);
				await new Promise((r) => setTimeout(r, 400));
				// Walk the dummy left for a long beat: long enough that the 3s
				// lock visibly ends before the script does, so the *resume* is
				// observable rather than an idle coincidence.
				await window.__training!.set({
					behaviour: "script",
					script: {
						beats: [{ ms: 7000, hold: { moveLeft: true } }],
						loop: false,
					},
				});
				await new Promise((r) => setTimeout(r, 300));
				// The spring: the dummy crosses the planted trap within a second
				// of walking.
				let sprungX: number | null = null;
				for (let i = 0; i < 60; i++) {
					await new Promise((r) => setTimeout(r, 50));
					if (window.__training!.report().rooted >= 1) {
						sprungX = window.__training!.state().dummy.x;
						break;
					}
				}
				if (sprungX === null) {
					throw new Error("the dummy never walked onto the trap");
				}
				// 2.2s into the 3s lock: still rooted, the held walk moves nobody.
				await new Promise((r) => setTimeout(r, 2200));
				const lockedX = window.__training!.state().dummy.x;
				// 1.5s later (3.7s after the spring): the lock has lifted and the
				// walk has resumed.
				await new Promise((r) => setTimeout(r, 1500));
				const freeX = window.__training!.state().dummy.x;
				return {
					report: window.__training!.report(),
					extra: { sprungX, lockedX, freeX },
				};
			});
		},
		verify(report, { sprungX, lockedX, freeX }) {
			const c = checks(report);
			c.atLeast("trap roots", report.rooted, 1);
			// The little bit of damage that makes a sprung trap read as having
			// done something.
			c.atLeast("trap damage", report.player.damageDealt, 10);
			// The root is a *root*: 2.2s into a 3s lock the dummy has not moved
			// a pixel despite holding left the whole time.
			// The root is a *root*: 2.2s into a 3s lock the dummy has not walked —
			// a couple of px of reconciliation glide while the 20Hz snapshot
			// settles is noise; the 484px a free walk would cover is not.
			c.eq("rooted at 2.2s", Math.abs(lockedX - sprungX) < 10, true);
			// And the lock ends: 3.7s after the spring the walk is moving again.
			c.eq("walk resumed after the lock", freeX < lockedX - 60, true);
			// The samples themselves, so a failure says what the lock actually did.
			if (c.fails.length) {
				c.fails.push(
					`root samples: sprung ${sprungX} → locked ${lockedX} → free ${freeX}`,
				);
			}
			return c.fails;
		},
	},
];

const report = (page: Page) => page.evaluate(() => window.__training!.report());

/** Condense a report to what a human needs to read when a row fails. */
function digest(report: TrainingReport) {
	return {
		durationMs: report.durationMs,
		player: report.player,
		dummy: report.dummy,
		outcomes: report.outcomes,
		events: report.events.map((e) => `${e.move}:${e.outcome}`),
		bullets: report.bullets,
		recon: report.reconciliation,
		melee: report.melee && {
			slashes: report.melee.slashes,
			uppercuts: report.melee.uppercuts,
			massives: report.melee.massives,
			blocks: report.melee.blocks,
			parries: report.melee.parries,
			illegalActions: report.melee.illegalActions,
			blockedUnblockables: report.melee.blockedUnblockables,
			frameDataViolations: report.melee.frameDataViolations,
			meleeDesyncFrames: report.melee.meleeDesyncFrames,
		},
		lastExchange: report.lastExchange,
	};
}

async function main() {
	await assertServerUp();

	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: { width: 900, height: 900 },
	});
	const page = await ctx.newPage();
	const pageErrors: string[] = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));

	// No `ai=true`: the local fighter has to be driven by `__training.input()`,
	// and a brain would overwrite every intent it sets.
	//
	// `&ultCharge=100` arms the meter: the deny row needs a castable ultimate,
	// and at the real 0.35 charge/s the probe would be waiting out ~285s to
	// measure one interaction.
	await page.goto(
		`${BASE_URL}/?training=true&ultCharge=100${HERO !== "lia" ? `&hero=${HERO}` : ""}`,
	);
	await page.waitForFunction(() => !!window.__training, { timeout: 20000 });
	const seated = await page.evaluate(() => window.__training!.ready(20000));
	if (!seated) {
		throw new Error(
			"the training room never seated a dummy — the server is up but the room is empty",
		);
	}

	const rows = BATTERY.filter((r) => !ONLY || r.name.includes(ONLY)).filter(
		// The sword rows press buttons that mean different things to the
		// dagger (attack = stab, not slash), so a dagger run keeps only the
		// rows that are actually about the dagger, and a sword run drops
		// those — pressing attack as Lia is a slash, not a stab. Jeffs rows
		// also drop the Lia-only rows (the deny and the HE grenade are her
		// own ult and item, which a jeffs player cannot perform).
		(r) =>
			HERO === "anands"
				? r.dagger
				: HERO === "jeffs"
					? !r.dagger && !r.lia
					: !r.dagger,
	);
	const results: {
		name: string;
		pass: boolean;
		fails: string[];
		report: TrainingReport;
	}[] = [];

	for (const row of rows) {
		let report_: TrainingReport;
		let extra: unknown;
		if (row.run) {
			const out = await row.run(page);
			report_ = out.report;
			extra = out.extra;
		} else {
			report_ = await page.evaluate(
				(s: TrainingScenario) => window.__training!.run(s),
				row.scenario!,
			);
			extra = row.after ? await row.after(page) : undefined;
		}

		const fails = [...row.verify(report_, extra), ...universalChecks(report_)];
		results.push({
			name: row.name,
			pass: fails.length === 0,
			fails,
			report: report_,
		});
		console.log(
			`${fails.length === 0 ? "OK  " : "FAIL"} ${row.name}${
				fails.length ? `\n       ${fails.join("\n       ")}` : ""
			}`,
		);
		if (fails.length) console.log(`       ${JSON.stringify(digest(report_))}`);
	}

	if (pageErrors.length) {
		console.log(`FAIL page errors: ${pageErrors.join(" | ")}`);
	}

	const failed = results.filter((r) => !r.pass);
	const summary = {
		verdict: failed.length === 0 && pageErrors.length === 0 ? "PASS" : "FAIL",
		rows: results.length,
		failed: failed.map((r) => ({ name: r.name, fails: r.fails })),
		pageErrors,
		// The counters, not just the verdict. Every must-be-zero metric above is
		// trivially satisfied by a build where nothing happens, so a run that
		// swung no swords is a failed run however clean it looks.
		activity: results.reduce(
			(acc, r) => ({
				playerMoves:
					acc.playerMoves +
					r.report.player.moves.slash +
					r.report.player.moves.uppercut +
					r.report.player.moves.massive,
				dummyMoves:
					acc.dummyMoves +
					r.report.dummy.moves.slash +
					r.report.dummy.moves.uppercut +
					r.report.dummy.moves.massive,
				impacts: acc.impacts + r.report.events.length,
			}),
			{ playerMoves: 0, dummyMoves: 0, impacts: 0 },
		),
	};
	// Only meaningful for the whole battery: a filtered run may legitimately
	// contain no melee at all (the bullet row is entirely ranged), and failing it
	// for that would train everyone to ignore the check that matters.
	if (!ONLY && summary.activity.impacts === 0) {
		summary.verdict = "FAIL";
		summary.failed.push({
			name: "battery activity",
			fails: ["no impact was judged in the entire battery"],
		});
	}

	console.log(`__TRAINING_RESULT__${JSON.stringify(summary)}__END__`);

	if (!KEEP_OPEN) await browser.close();
	process.exit(summary.verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
