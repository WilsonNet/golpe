#!/usr/bin/env node
/**
 * Training-room feedback-loop harness.
 *
 * `diagnose.mjs` measures a whole chaotic match; this measures **one
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
 *   node scripts/training-probe.mjs
 *   node scripts/training-probe.mjs --only=backstab
 *   node scripts/training-probe.mjs --keep-open   # leave the browser up
 */
import { chromium } from "playwright";

const BASE_URL = process.env.VENTO_URL ?? "http://localhost:8080";

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

function arg(name, fallback) {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split("=")[1] : fallback;
}

const ONLY = arg("only", "");
const KEEP_OPEN = process.argv.includes("--keep-open");

/**
 * Fail loudly if the game server is down.
 *
 * A training room without a server produces a report full of zeroes, and every
 * "must be zero" row passes. This exact shape of false PASS has happened before
 * — see `diagnose.mjs`, which grew the same preflight for the same reason.
 */
async function assertServerUp() {
	const res = await fetch("http://localhost:9208/.wrtc/v2/connections", {
		method: "POST",
	}).catch(() => null);
	if (!res) {
		throw new Error(
			"game server unreachable on :9208 — start it with `npm run dev:herdr`",
		);
	}
}

/** Outcomes of the events caused by the local fighter, in order. */
function playerEvents(report) {
	const dummyId = report.events.find((e) =>
		e.attackerId.startsWith("dummy-"),
	)?.attackerId;
	return report.events.filter((e) => e.attackerId !== dummyId);
}

function dummyEvents(report) {
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
function chainSwings(side) {
	const m = side.moves ?? {};
	return (m.slash ?? 0) + (m.slash2 ?? 0) + (m.slash3 ?? 0);
}

function checks(report) {
	const fails = [];
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
function universalChecks(report) {
	const fails = [];
	const m = report.melee ?? {};
	if (!report.connected) fails.push("no training-state was ever received");
	if (m.illegalActions > 0)
		fails.push(`${m.illegalActions} actions while stunned`);
	if (m.blockedUnblockables > 0) {
		fails.push(`${m.blockedUnblockables} unblockables blocked`);
	}
	if (m.airborneChainLinks > 0) {
		fails.push(`${m.airborneChainLinks} combo links thrown airborne`);
	}
	if (m.frameDataViolations > 0) {
		fails.push(`${m.frameDataViolations} frame data violations`);
	}
	if (m.meleeDesyncFrames > 0) {
		fails.push(`${m.meleeDesyncFrames} melee prediction desyncs`);
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
/** Charge past MASSIVE_CHARGE_MS (420ms), then let go — the release is what fires. */
const MASSIVE = { intent: { attack: true }, holdMs: 470, aimAngle: AIM_RIGHT };
/** A move's full duration, so the next step is not swallowed by its recovery. */
const REST = 500;

/**
 * The ground chain, as three presses.
 *
 * The gap is the whole point: a link becomes available when the previous swing
 * enters recovery, at `startup + active` = 160ms. Pressing at 170ms catches that
 * with a frame to spare — and a probe that pressed any earlier would measure a
 * swallowed input and call the combo broken.
 */
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
const BATTERY = [
	{
		name: "idle dummy does nothing",
		async run(page) {
			await page.evaluate(() => window.__training.set({ behaviour: "idle" }));
			await page.evaluate(() => window.__training.reset());
			const samples = await page.evaluate(async () => {
				const seen = [];
				for (let i = 0; i < 30; i++) {
					await new Promise((r) => setTimeout(r, 100));
					const s = window.__training.state();
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
		name: "block stops a slash from the front",
		scenario: {
			name: "block stops a slash",
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
			const e = playerEvents(report)[0];
			if (e && e.outcome !== "blocked" && e.outcome !== "parried") {
				c.fails.push(`outcome ${e.outcome}, expected blocked or parried`);
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
			const running = page.evaluate((s) => window.__training.run(s), {
				name: "uppercut beats a block",
				config: { behaviour: "blockAll", facing: "foe" },
				steps: [UPPERCUT],
				settleMs: 900,
			});

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
		name: "Massive Strike beats a block",
		scenario: {
			name: "massive beats a block",
			config: { behaviour: "blockAll", facing: "foe" },
			steps: [MASSIVE],
			settleMs: 1200,
		},
		verify(report) {
			const c = checks(report);
			c.swung("massive");
			// Holding attack starts a slash *and* charges, so the leading slash is
			// expected — it is what the button does. Only the Massive is asserted on.
			c.outcome("hit", "massive");
			c.eq("massives armed", report.melee?.massives ?? 0, 1);
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
				for (const phase of ["startupMs", "activeMs", "recoveryMs"]) {
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
					(s) => window.__training.set({ behaviour: "script", script: s }),
					script,
				);
				await page.evaluate(() => window.__training.reset());
				await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));
				return report(page);
			};
			const a = await once();
			const b = await once();
			return { report: b, extra: { a, b } };
		},
		verify(_report, { a, b }) {
			const c = checks(a);
			const seq = (r) => r.events.map((e) => `${e.move}:${e.outcome}`);
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
				window.__training.set({ behaviour: "record", facing: "foe" }),
			);
			await page.evaluate(() => window.__training.reset());
			for (let i = 0; i < 4; i++) {
				await page.evaluate(() =>
					window.__training.input({ attack: true }, 60),
				);
				await page.evaluate(() =>
					window.__training.input({ block: true }, 120),
				);
			}
			const recording = await report(page);
			const status = await page.evaluate(
				() => window.__training.state().status,
			);

			await page.evaluate(() =>
				window.__training.set({ behaviour: "playback" }),
			);
			await page.evaluate(() => window.__training.reset());
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
			const holdAndSample = async (facing) => {
				await page.evaluate(
					(f) =>
						window.__training.set({
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
					facing,
				);
				await page.evaluate(() => window.__training.reset());
				return page.evaluate(async (f) => {
					const hold = window.__training.input({ block: true }, 2600, f);
					let first = null;
					let last = null;
					for (let i = 0; i < 26; i++) {
						await new Promise((r) => setTimeout(r, 90));
						const s = window.__training.state();
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
];

const report = (page) => page.evaluate(() => window.__training.report());

/** Condense a report to what a human needs to read when a row fails. */
function digest(report) {
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
	const pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));

	// No `ai=true`: the local fighter has to be driven by `__training.input()`,
	// and a brain would overwrite every intent it sets.
	await page.goto(`${BASE_URL}/?training=true`);
	await page.waitForFunction(() => !!window.__training, { timeout: 20000 });
	const seated = await page.evaluate(() => window.__training.ready(20000));
	if (!seated) {
		throw new Error(
			"the training room never seated a dummy — the server is up but the room is empty",
		);
	}

	const rows = BATTERY.filter((r) => !ONLY || r.name.includes(ONLY));
	const results = [];

	for (const row of rows) {
		let report_;
		let extra;
		if (row.run) {
			const out = await row.run(page);
			report_ = out.report;
			extra = out.extra;
		} else {
			report_ = await page.evaluate(
				(s) => window.__training.run(s),
				row.scenario,
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
