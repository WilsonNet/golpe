#!/usr/bin/env node
/**
 * The ultimate — the black hole grenade — measured online.
 *
 * Nothing else in the harness can see any of it. AI vs AI never presses the
 * button (a brain has no charge meter to reason about), so `diagnose.mjs` and
 * `deathmatch-probe.mjs` run whole matches in which the ability does not exist.
 * The physics diagnostic reads positions, and would happily report a room that
 * froze on one client and not the other as excellent jitter numbers.
 *
 * **Two scenarios, because the feature asks two different questions and each
 * needs a different room.**
 *
 * ## A — the netcode contract, in a two-client deathmatch room
 *
 * 1. **The meter is server-owned and arrives.** `?ultCharge=100` seats both
 *    clients armed. A client that never sees a charge is one whose HUD is lying
 *    and whose cast will be refused for reasons it cannot show.
 * 2. **Holding R is the aim phase, and casts nothing.** The arc is up while the
 *    button is held; no freeze, no grenade. The cast is decided at the release,
 *    so a press that fires early would throw the grenade before the player
 *    finished aiming.
 * 3. **A cast freezes BOTH clients, for about as long as the server declared.**
 *    This is the whole netcode risk: a freeze one client honours and the other
 *    does not is two rooms simulating different tick counts, and it would
 *    present as unexplained correction forever afterwards. A cutscene that never
 *    lifts is a hang.
 * 4. **A grenade flies and one hole opens, in one place, on both clients.** The
 *    field is an argument to every `tickPlayer` both of them run, so a
 *    disagreement about where it is is a disagreement about physics.
 * 5. **The victim's own client predicts the pull**, measured with
 *    `__physicsDiagnostic` — the tuned instrument — on the client whose *own*
 *    locally predicted fighter is the one being dragged.
 *
 * ## B — the capture, in a training room
 *
 * 5. **Somebody gets caught, takes damage, and it is never the caster.**
 *
 * Staged rather than fought for. The first version of this probe tried to check
 * the capture in scenario A and spent every run losing to the *arena*: a bot
 * closes to melee range and detonates the grenade on contact inside one frame; a
 * stationary opponent is 660px away and a grenade is a lob, so the throw hits the
 * underside of a ledge; walking there means solving two pillars, and a jump held
 * into a pillar is a wall jump that goes backwards. All of that is the game
 * working correctly and none of it is the ultimate.
 *
 * The training room is the project's own answer to exactly this — a scriptable
 * dummy 60px away on clear ground, and `__training.input()` to press a button
 * with an exact aim angle. It is still a real online room, still predicted and
 * still reconciled, so nothing about the measurement is weakened by staging it.
 *
 * Run: `node scripts/ultimate-probe.mjs` with both dev servers up.
 *
 * `--no-cast` runs scenario A with the button never pressed. That is the
 * control, and it is not decoration — it is how the first version of this probe
 * was caught measuring the wrong thing. It reported 4.5px of average *rollback*
 * error after a cast and failed a 3px budget, which read exactly like the pull
 * leaking outside `tickPlayer`. The control showed 4.0px with no ultimate cast
 * at all: rollback error is about a *remote* fighter predicted from a
 * carried-forward input, and a bot changing its mind sixty times a second
 * produces that number whatever the ultimate does. The metric could not have
 * discriminated, so it was replaced with one that can.
 */
import { chromium } from "playwright";

/** `--no-cast`: the control. Scenario A, same room, no button pressed. */
const CAST = !process.argv.includes("--no-cast");

const BASE = "http://localhost:8080";
const ROOM = `ultprobe-${Date.now().toString(36)}`;
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

/**
 * The ability's numbers, restated from `simulation/Ultimate.ts`.
 *
 * Deliberately copied rather than imported — the same reason `aim-probe.mjs`
 * restates the world size. A probe that shares arithmetic with the code under
 * test cannot disagree with it. If these drift from the simulation the probe
 * stops landing throws, which is the failure you want: loud, and about the thing
 * that changed.
 */
const GRENADE_SPEED = 780;
const GRENADE_GRAVITY = 860;
/** `v² / g`: the range of a 45° lob, and the hard limit on any throw. */
const GRENADE_MAX_RANGE_PX = (GRENADE_SPEED * GRENADE_SPEED) / GRENADE_GRAVITY;
/** 5 damage every 250ms over 2200ms. */
const SINGULARITY_FULL_DAMAGE = 40;
const CINEMATIC_MS = 1100;

/**
 * Reconciliation budget for the fighter the hole is holding.
 *
 * The netcode reconciles to ~0.0px in steady state, so this is mostly headroom:
 * the hole's `remainingMs` is decayed locally between snapshots, so a replayed
 * tick at the very end of its life can disagree with the server about whether
 * the field was still open. That is a pixel or two, by design — see
 * specs/ultimate.md.
 *
 * What it has to separate this from is large and unmissable. An unpredicted pull
 * drags a fighter hundreds of pixels over the hold, corrected across ~44
 * snapshots: double digits on every single one.
 */
const MAX_AVG_ERROR_PX = 3;

const RESULT_RE = /__DIAGNOSTIC_RESULT__(\{.*?\})__END__/s;

const fail = [];
const round = (n) => Math.round(n * 100) / 100;

function sink(page) {
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	return errors;
}

/** Collect a page's console, so `__physicsDiagnostic`'s report can be read back. */
function consoleSink(page) {
	const lines = [];
	page.on("console", (m) => lines.push(m.text()));
	return lines;
}

async function readDiagnostic(page, lines) {
	// The report is printed when the run ends, not returned — give it a beat.
	await page.waitForTimeout(1200);
	const hit = lines.find((l) => RESULT_RE.test(l));
	return hit ? JSON.parse(hit.match(RESULT_RE)[1]) : null;
}

async function ultState(page) {
	return page.evaluate(() => window.__ultState?.() ?? null);
}

/** Canvas rect in CSS pixels — the only frame Playwright's mouse speaks. */
async function canvasRect(page) {
	return page.evaluate(() => {
		const b = document.querySelector("canvas").getBoundingClientRect();
		return { x: b.x, y: b.y, width: b.width, height: b.height };
	});
}

/** Point the real cursor at a world coordinate, the way `aim-probe.mjs` does. */
async function aimAt(page, rect, worldX, worldY) {
	await page.mouse.move(
		rect.x + (worldX / GAME_WIDTH) * rect.width,
		rect.y + (worldY / GAME_HEIGHT) * rect.height,
	);
	await page.waitForTimeout(80);
}

/**
 * The launch angle that lands a grenade on a point, low arc.
 *
 * A cursor aimed *at* a target is not a throw at a target: the grenade is a lob
 * under its own gravity, so pointing straight at somebody 660px away produces a
 * three-degree throw that hits the floor a third of the way there. That is the
 * ability working as designed, and a probe measuring the wrong thing.
 *
 * The standard ballistic solution, with y measured up:
 *
 *   tan θ = (v² − √(v⁴ − g(g·dx² + 2·dyUp·v²))) / (g·dx)
 *
 * Returns null when the point is out of range — the discriminant going negative
 * *is* `GRENADE_MAX_RANGE_PX`, so a null has taught you something about the
 * tuning rather than found a bug.
 */
function ballisticAngle(
	fromX,
	fromY,
	toX,
	toY,
	v = GRENADE_SPEED,
	g = GRENADE_GRAVITY,
) {
	const dx = toX - fromX;
	const dyUp = fromY - toY;
	if (Math.abs(dx) < 1) return null;
	const disc = v ** 4 - g * (g * dx * dx + 2 * dyUp * v * v);
	if (disc < 0) return null;
	const tan = (v * v - Math.sqrt(disc)) / (g * Math.abs(dx));
	// `tan` is the launch angle above horizontal; the game's y grows downward.
	return Math.atan2(-tan, Math.sign(dx));
}

/**
 * Sample every client as fast as the loop allows, for `ms`.
 *
 * Polling rather than hooking an event: the question is "was this client frozen
 * at the same wall-clock moments as that one", and only sampling both on one
 * timeline can answer it. 25ms, because a grenade is airborne for a few hundred
 * milliseconds even when it is thrown well — a slower sampler reported "no
 * grenade was ever in flight" for a cast that worked perfectly.
 */
async function watch(pages, ms, stepMs = 25) {
	const frames = [];
	const until = Date.now() + ms;
	while (Date.now() < until) {
		frames.push({
			t: Date.now(),
			states: await Promise.all(pages.map(ultState)),
		});
		await pages[0].waitForTimeout(stepMs);
	}
	return frames;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } });

// =========================================================
//  A — the netcode contract
// =========================================================

// The caster: human-driven, so a real R keypress and a real cursor reach the
// simulation. `?ai=true` would hand the intent to a brain and the probe would
// measure nothing. `bots=0` keeps the room to the two clients.
const caster = await ctx.newPage();
// The witness: also human-driven, and therefore standing still at its spawn. It
// is here to answer "did the freeze reach a second client" and "does that
// client's own prediction survive the field" — not to fight.
const witness = await ctx.newPage();
const errorsA = [...sink(caster), ...sink(witness)];
const witnessConsole = consoleSink(witness);

const url = `${BASE}/?online=true&room=${ROOM}&bots=0&ultCharge=100&timeLimit=600`;

await caster.goto(url);
await caster.waitForFunction(() => typeof window.__ultState === "function");
// A human client is asked for a name before it connects, and the prompt is a DOM
// modal over the canvas — unanswered, there is no match and no cursor reaching
// the game. This is the same event the modal fires, so it is the path a player
// takes rather than a bypass.
await caster.evaluate(() => window.__setPlayerName?.("Caster"));

await witness.goto(url);
await witness.waitForFunction(() => typeof window.__ultState === "function");
await witness.evaluate(() => window.__setPlayerName?.("Witness"));

await caster.waitForTimeout(4000);

const pages = [caster, witness];

// --- A1: the meter arrived, on both, from the server ---
const armed = await Promise.all(pages.map(ultState));
const charge = {
	caster: Math.round(armed[0]?.charge ?? -1),
	witness: Math.round(armed[1]?.charge ?? -1),
	casterReady: armed[0]?.ready ?? false,
};
if (!armed[0] || !armed[1]) fail.push("a client never exposed __ultState");
if (charge.caster < 100) {
	fail.push(`caster charge ${charge.caster}, want 100 from ?ultCharge=100`);
}
if (!charge.casterReady) fail.push("caster is armed but not `ready`");

// --- A2-A4: one throw, watched on both clients ---
//
// Aimed at open floor a short way off, and **not** at the witness. A throw that
// has to cross the arena has to clear whatever is between here and there, and a
// probe that keeps losing to a ledge is measuring the level, not the ability.
// The capture is scenario B's job.
const rect = await canvasRect(caster);
const home = await caster.evaluate(
	() => window.__ultState?.()?.playerPhys ?? null,
);
const homeX = home?.x ?? 100;
const homeY = home?.y ?? 480;
const chest = { x: homeX + 16, y: homeY + 24 };
// 260px toward the middle of the arena, level with the feet: a short flat lob
// onto the floor, well inside the maximum range and under every ledge.
const landing = {
	x: homeX + (homeX < GAME_WIDTH / 2 ? 260 : -260),
	y: homeY + 60,
};
const angle = ballisticAngle(chest.x, chest.y, landing.x, landing.y);
if (angle === null) {
	fail.push(
		`the probe's own landing point is out of the grenade's ` +
			`${Math.round(GRENADE_MAX_RANGE_PX)}px range — the throw was retuned`,
	);
}
// The cursor is a *direction*, so any point along the launch ray does; 120px out
// is inside the arena whatever the angle turns out to be.
const aimPoint = {
	x: chest.x + Math.cos(angle ?? 0) * 120,
	y: chest.y + Math.sin(angle ?? 0) * 120,
};

// The witness measures its own prediction across the whole event. Started before
// the press, so the untouched ticks are in the same window as the pulled ones —
// a clean number must not be able to come from having measured only the quiet
// part.
await witness.evaluate(() => window.__physicsDiagnostic?.(6000));

await aimAt(caster, rect, aimPoint.x, aimPoint.y);
await caster.waitForTimeout(120);
const aimCheck = await caster.evaluate(() => window.__aimState?.() ?? null);

// Sampling starts before the press, so the freeze is caught as it happens rather
// than inferred from its aftermath.
const watching = watch(pages, 6000);
await caster.waitForTimeout(150);
// The cast is decided at the **release**, and the hold before it is the aim
// phase: R down shows the arc and must cast nothing, R up is what casts. Sampled
// mid-hold so a cast-on-press regression is caught here, where the button is
// down and the room is still moving.
if (CAST) await caster.keyboard.down("KeyR");
await caster.waitForTimeout(500);
const aimHeld = CAST ? await Promise.all(pages.map(ultState)) : null;
if (CAST) await caster.keyboard.up("KeyR");
const frames = await watching;

const casterId = armed[0]?.myId ?? "";

const frozenCaster = frames.filter((f) => f.states[0]?.frozen);
const frozenWitness = frames.filter((f) => f.states[1]?.frozen);
const span = (l) => (l.length === 0 ? 0 : l[l.length - 1].t - l[0].t);

const freeze = {
	casterFrames: frozenCaster.length,
	witnessFrames: frozenWitness.length,
	bothFrames: frames.filter((f) => f.states[0]?.frozen && f.states[1]?.frozen)
		.length,
	casterSpanMs: span(frozenCaster),
	witnessSpanMs: span(frozenWitness),
	declaredMs:
		frames.find((f) => f.states[0]?.cinematic)?.states[0]?.cinematic?.totalMs ??
		0,
	casterUnfroze: !frames[frames.length - 1]?.states[0]?.frozen,
	witnessUnfroze: !frames[frames.length - 1]?.states[1]?.frozen,
	/** Who the cinematic named. Both clients must agree, and it must be the caster. */
	announced: [
		...new Set(
			frames.flatMap((f) =>
				f.states.map((s) => s?.cinematic?.casterId).filter(Boolean),
			),
		),
	],
};

if (!CAST) {
	// The control asserts the opposite of everything below. A room that froze on
	// its own would invalidate every cast run this probe has ever passed.
	if (freeze.casterFrames || freeze.witnessFrames) {
		fail.push("a client froze with the ultimate never pressed");
	}
} else {
	// The hold was the aim phase: the arc was up, and nothing was cast yet.
	// "Nothing" is the whole point — a press that fires early would throw the
	// grenade before the player finished aiming.
	if (!aimHeld?.[0]?.aiming) {
		fail.push("holding R never entered the aim phase");
	}
	if (aimHeld?.[0]?.frozen) {
		fail.push("the cast happened on the press, not the release");
	}
	if (aimHeld?.[1]?.frozen) {
		fail.push("the witness froze while the button was still held");
	}
	if ((aimHeld?.[0]?.grenades?.length ?? 0) > 0) {
		fail.push("a grenade flew before the button was released");
	}
	if (freeze.casterFrames === 0) fail.push("the caster never froze");
	if (freeze.witnessFrames === 0) {
		fail.push("the witness never froze — the cinematic did not reach it");
	}
	// The two clients learn about the freeze half a round trip apart, so their
	// windows are offset rather than identical. What must not happen is one of
	// them missing it, or the overlap being a single sample.
	if (freeze.bothFrames < 4) {
		fail.push(`only ${freeze.bothFrames} samples had both clients frozen`);
	}
	if (freeze.declaredMs !== CINEMATIC_MS) {
		fail.push(
			`server declared a ${freeze.declaredMs}ms cinematic, spec says ${CINEMATIC_MS}ms`,
		);
	}
	for (const [who, ms] of [
		["caster", freeze.casterSpanMs],
		["witness", freeze.witnessSpanMs],
	]) {
		// Generous both ways: the sampler runs at 25ms and the freeze is announced
		// on a 50ms snapshot, so a span within a couple of hundred ms of the
		// declared length is the best this can resolve.
		if (ms > freeze.declaredMs + 400 || ms < freeze.declaredMs - 400) {
			fail.push(
				`${who} froze for ${ms}ms, server declared ${freeze.declaredMs}ms`,
			);
		}
	}
	if (freeze.announced.length !== 1 || freeze.announced[0] !== casterId) {
		fail.push(
			`cinematic named ${JSON.stringify(freeze.announced)}, want [${casterId}]`,
		);
	}
}
if (!freeze.casterUnfroze || !freeze.witnessUnfroze) {
	fail.push("a client was still frozen when the run ended");
}

// --- A3: the grenade flew and one hole opened, in one place, on both ---
const grenadeSeen = frames.some((f) =>
	f.states.some((s) => s?.grenades?.length),
);
const holes = frames.flatMap((f) =>
	f.states.map((s) => s?.singularity).filter(Boolean),
);
const holeIds = [...new Set(holes.map((h) => h.id))];
const holeOnBoth = frames.some(
	(f) => f.states[0]?.singularity && f.states[1]?.singularity,
);
// Grouped by id, so this compares each hole against itself rather than against
// a different one.
const holePosSpread = Math.max(
	0,
	...holeIds.map((id) => {
		const same = holes.filter((h) => h.id === id);
		return Math.max(
			...same.map((h) => Math.hypot(h.x - same[0].x, h.y - same[0].y)),
		);
	}),
);

const detonation = {
	aimedAt: { x: Math.round(landing.x), y: Math.round(landing.y) },
	launchDeg: angle === null ? null : Math.round((angle * 180) / Math.PI),
	cursorLandedOn: aimCheck
		? { x: Math.round(aimCheck.pointerX), y: Math.round(aimCheck.pointerY) }
		: null,
	grenadeSeen,
	holeIds,
	holeOnBoth,
	holePosSpread: round(holePosSpread),
	holesAt: holeIds.map((id) => {
		const h = holes.find((x) => x.id === id);
		return { id, x: Math.round(h.x), y: Math.round(h.y) };
	}),
	holeOwners: [...new Set(holes.map((h) => h.ownerId))],
};

if (!CAST) {
	if (grenadeSeen) fail.push("a grenade flew with the ultimate never pressed");
	if (holeIds.length)
		fail.push("a hole opened with the ultimate never pressed");
} else {
	if (!grenadeSeen) fail.push("no grenade was ever in flight");
	if (holeIds.length !== 1) {
		fail.push(`${holeIds.length} holes opened from one cast, want 1`);
	}
	if (!holeOnBoth) fail.push("only one client ever saw the singularity");
}
if (holePosSpread > 0.5) {
	fail.push(`clients disagree on the hole's position by ${holePosSpread}px`);
}
if (detonation.holeOwners.some((o) => o !== casterId)) {
	fail.push(
		`hole credited to ${JSON.stringify(detonation.holeOwners)}, want ${casterId}`,
	);
}
// The caster is immune to their own field, so this must hold even here, where
// the hole is deliberately opened only 260px from where they are standing.
if (frames.some((f) => f.states.some((s) => s?.held?.includes(casterId)))) {
	fail.push("the caster was caught in their own black hole");
}

// --- A4: the witness's own client predicted the pull ---
const diag = await readDiagnostic(witness, witnessConsole);
const recon = diag?.reconciliationSummary ?? null;
const net = await caster.evaluate(() => window.__matchState?.()?.net ?? null);
const prediction = {
	snapshots: net?.snapshots ?? 0,
	/** Context only. Not a pass/fail signal — see the `--no-cast` note above. */
	casterRollbackAvgPx: net?.rollback?.avgErrorPx ?? -1,
	witnessCorrections: recon?.totalCorrections ?? 0,
	witnessAvgErrorPx: recon?.avgErrorPx ?? -1,
	witnessMaxErrorPx: recon?.maxErrorPx ?? -1,
	witnessVerdict: diag?.verdict ?? null,
};
if (prediction.snapshots === 0) {
	fail.push("no snapshots arrived — nothing here measured the netcode");
}
if (!recon) {
	fail.push("the witness never reconciled — its client was simulating alone");
} else if (prediction.witnessAvgErrorPx > MAX_AVG_ERROR_PX) {
	fail.push(
		`witness reconciliation error ${prediction.witnessAvgErrorPx}px avg / ` +
			`${prediction.witnessMaxErrorPx}px max, budget ${MAX_AVG_ERROR_PX}px`,
	);
}

await caster.close();
await witness.close();

// =========================================================
//  B — the capture, staged in a training room
// =========================================================

let capture = { skipped: true };
if (CAST) {
	const room = await ctx.newPage();
	const errorsB = sink(room);
	// The training room places the two fighters 60px apart on the clear stretch of
	// ground between the pillars — see `DEFAULT_TRAINING_SPAWN`. That is the whole
	// reason this scenario exists: nothing to walk around and nothing overhead.
	await room.goto(`${BASE}/?training=true&ultCharge=100`);
	await room.waitForFunction(() => typeof window.__training === "object");
	await room.evaluate(() => window.__training.ready(15000));
	// Both mortal: an invincible dummy would make the damage check vacuous, and an
	// invincible player would make the friendly-fire check vacuous in the other
	// direction.
	await room.evaluate(() =>
		window.__training.set({
			behaviour: "idle",
			dummyInvincible: false,
			playerInvincible: false,
		}),
	);
	await room.evaluate(() => window.__training.reset());
	await room.waitForTimeout(1200);

	const before = await room.evaluate(() => {
		const t = window.__training.state();
		const u = window.__ultState();
		return {
			dummyId: t.dummy.id,
			dummyHp: t.dummy.hp,
			dummyX: t.dummy.x,
			dummyY: t.dummy.y,
			playerHp: window.__gameState().playerHP,
			playerX: u.playerPhys.x,
			playerY: u.playerPhys.y,
			charge: u.charge,
			myId: u.myId,
		};
	});

	// Straight at the dummy's centre. At 60px the arc is irrelevant — the grenade
	// touches it within a couple of frames — but it is solved rather than guessed,
	// so a retune of the ballistics cannot silently turn this into a lob over its
	// head.
	const castAngle =
		ballisticAngle(
			before.playerX + 16,
			before.playerY + 24,
			before.dummyX + 16,
			before.dummyY + 24,
		) ?? 0;

	// `__training.input` is the sanctioned programmatic controller: it layers over
	// the keyboard through `Input.hold`, so what it drives is exactly what a key
	// drives — and unlike a key it can state an exact aim angle.
	await room.evaluate(
		(a) => window.__training.input({ ultimate: true }, 200, a),
		castAngle,
	);

	// Through the freeze, the throw and the whole hold.
	const capFrames = await watch([room], CINEMATIC_MS + 3600);

	const heldEver = [
		...new Set(
			capFrames.flatMap((f) => f.states.flatMap((s) => s?.held ?? [])),
		),
	];
	const capHole = capFrames.map((f) => f.states[0]?.singularity).find(Boolean);
	const after = await room.evaluate(() => ({
		dummyHp: window.__training.state().dummy.hp,
		playerHp: window.__gameState().playerHP,
	}));

	capture = {
		skipped: false,
		// First, because "no hole opened" has exactly two causes and this
		// distinguishes them: an unarmed meter, or a throw that went nowhere.
		chargeBefore: Math.round(before.charge),
		castDeg: Math.round((castAngle * 180) / Math.PI),
		gapPx: Math.round(
			Math.hypot(
				before.dummyX - before.playerX,
				before.dummyY - before.playerY,
			),
		),
		holeAt: capHole
			? { x: Math.round(capHole.x), y: Math.round(capHole.y) }
			: null,
		heldEver,
		dummyHeld: heldEver.includes(before.dummyId),
		casterHeld: heldEver.includes(before.myId),
		dummyHp: `${before.dummyHp} -> ${after.dummyHp}`,
		playerHp: `${before.playerHp} -> ${after.playerHp}`,
		dummyDamage: before.dummyHp - after.dummyHp,
		playerDamage: before.playerHp - after.playerHp,
		errors: errorsB,
	};

	if (before.charge < 100) {
		fail.push(
			`training room seated the player with ${Math.round(before.charge)} charge, ` +
				"want 100 from ?ultCharge=100 — nothing below could have been cast",
		);
	}
	if (!capHole) fail.push("no hole opened in the training room");
	if (!capture.dummyHeld) {
		fail.push(
			`the dummy was ${capture.gapPx}px away and a hole opened on it, but it ` +
				"was never held — the grip test disagrees with the field",
		);
	}
	if (capture.casterHeld) {
		fail.push("the caster was caught in their own black hole");
	}
	if (capture.dummyDamage <= 0) {
		fail.push("the dummy was held and took no damage");
	}
	if (capture.dummyDamage > SINGULARITY_FULL_DAMAGE) {
		fail.push(
			`the dummy took ${capture.dummyDamage}, more than a full hold's ` +
				`${SINGULARITY_FULL_DAMAGE} — the damage interval is running fast`,
		);
	}
	// The hole opened within arm's reach of the caster and did nothing to it.
	if (capture.playerDamage !== 0) {
		fail.push(
			`the caster took ${capture.playerDamage} damage from their own hole`,
		);
	}
	// A hole that grabbed nobody but the dummy. Anything else in this room would
	// be the exclusion predicate keying off the wrong id.
	if (heldEver.some((id) => id !== before.dummyId)) {
		fail.push(`held ${JSON.stringify(heldEver)}, want only the dummy`);
	}
	errorsA.push(...errorsB);
}

if (errorsA.length) fail.push(`page errors: ${errorsA.join(" | ")}`);

console.log(
	JSON.stringify(
		{ cast: CAST, charge, freeze, detonation, prediction, capture },
		null,
		2,
	),
);

await browser.close();

if (fail.length) {
	console.error(`FAIL:\n${fail.map((f) => `  - ${f}`).join("\n")}`);
	process.exit(1);
}
console.log(
	CAST
		? "PASS: the hold aimed and the release cast, both clients froze and recovered " +
				"together, one hole in one place, the dummy was caught and damaged, the " +
				"caster never was, prediction held"
		: "PASS (control): no press, no freeze, no hole — baseline " +
				`reconciliation ${prediction.witnessAvgErrorPx}px`,
);
