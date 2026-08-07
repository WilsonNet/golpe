import { describe, expect, it } from "vitest";
import type { AIInput, AIOutput } from "../src/game/characters/types.js";
import { DEFAULT_TRAINING_TIMING } from "../src/game/training/types.js";
import {
	createPlayerState,
	MASSIVE_CHARGE_MS,
	type MeleeMove,
	meleePhase,
	type PlayerIntent,
	type PlayerPosition,
	tickPlayer,
} from "./physics.js";
import { type ObservedInput, TrainingDummy } from "./TrainingDummy.js";

const DT = 1 / 60;
const DT_MS = 1000 / 60;

/**
 * A patch of open ground with nothing overhead.
 *
 * Every physics assertion below starts here. The obvious spawn — x=300, where
 * the dummy's default perception puts it — is inside `PILLAR_LEFT`, and a
 * fighter that starts inside a solid is depenetrated onto its roof with the
 * `MID` ledge over its head: the jump test measured a 36px rise and read as a
 * broken jump when what it had actually found was a ceiling.
 */
const OPEN_X = 744;
const OPEN_Y = 480;

/** The dummy stands at 300; the player stands to its right unless said otherwise. */
function perception(overrides: Partial<AIInput> = {}): AIInput {
	return {
		playerX: 360,
		playerY: 480,
		selfX: 300,
		selfY: 480,
		distanceToPlayer: 60,
		playerFacingDirection: -1,
		touchingDown: true,
		touchingLeft: false,
		touchingRight: false,
		hasLineOfSight: true,
		selfHP: 100,
		enemyHP: 100,
		enemyAction: "none",
		enemyPhase: "none",
		enemyBlocking: false,
		enemyStunned: false,
		enemyPlunging: false,
		enemyStuck: false,
		selfAction: "none",
		selfStunned: false,
		selfPlunging: false,
		selfStuck: false,
		selfMassiveReady: false,
			selfCharging: false,
		selfId: "dummy",
		selfHero: "lia",
		enemyHero: "lia",
		enemyGrounded: true,
		selfAirJumps: 1,
		selfUltCharge: 0,
		enemyVX: 0,
		enemyVY: 0,
		selfTeam: null,
		allies: [],
		foes: [],
		fields: [],
		traps: [],
		selfItemCharges: 0,
		...overrides,
	};
}

function observed(overrides: Partial<ObservedInput> = {}): ObservedInput {
	return {
		left: false,
		right: false,
		up: false,
		attack: false,
		block: false,
		uppercut: false,
		swordStance: true,
		face: 0,
		dash: 0,
		ultimate: false,
		item: false,
		aimAngle: 0,
		...overrides,
	};
}

/** Exactly the translation `GameRoom` does, so the tests drive the real path. */
function intentFrom(out: AIOutput): PlayerIntent {
	return {
		left: out.moveLeft,
		right: out.moveRight,
		up: out.jump,
		attack: out.attack,
		block: out.block,
		uppercut: out.uppercut,
		swordStance: out.swordStance,
		face: out.face,
		dash: out.dash,
		// A brain never presses it — see `GameRoom.scriptedInput`.
		ultimate: false,
		item: out.item,
	};
}

/** Run the dummy for `ms`, collecting every output. */
function run(
	dummy: TrainingDummy,
	ms: number,
	input: (tick: number) => AIInput = () => perception(),
	observe: (tick: number) => ObservedInput | null = () => null,
): AIOutput[] {
	const out: AIOutput[] = [];
	const ticks = Math.round(ms / DT_MS);
	for (let i = 0; i < ticks; i++) {
		dummy.observe(observe(i), DT_MS);
		out.push(dummy.decide(input(i), i * DT_MS, DT_MS));
	}
	return out;
}

/**
 * Feed the dummy's outputs through the real simulation and count the moves it
 * actually produced.
 *
 * This is the assertion that matters. A rhythm that emits `attack: true` looks
 * correct in isolation and can still produce zero swings, because the
 * simulation edge-detects its own buttons — which is exactly the bug the beat
 * format exists to avoid.
 */
function simulate(dummy: TrainingDummy, ms: number) {
	let body: PlayerPosition = createPlayerState(OPEN_X, OPEN_Y, 1);
	const moves: MeleeMove[] = [];
	let blockedFrames = 0;
	let last = body.meleeAction;
	const ticks = Math.round(ms / DT_MS);

	for (let i = 0; i < ticks; i++) {
		const out = dummy.decide(
			perception({ selfX: body.x, selfY: body.y }),
			i * DT_MS,
			DT_MS,
		);
		body = tickPlayer(body, intentFrom(out), DT);
		if (body.meleeAction !== "none" && body.meleeAction !== last) {
			moves.push(body.meleeAction);
		}
		if (body.blocking) blockedFrames++;
		last = body.meleeAction;
	}
	return { body, moves, blockedFrames, ticks };
}

describe("TrainingDummy: idle", () => {
	it("does nothing at all, for as long as you watch it", () => {
		const dummy = new TrainingDummy({ behaviour: "idle" });
		const outputs = run(dummy, 3000);
		expect(outputs).not.toHaveLength(0);
		for (const o of outputs) {
			expect(o.attack || o.block || o.uppercut || o.jump).toBe(false);
			expect(o.moveLeft || o.moveRight).toBe(false);
			expect(o.dash).toBe(0);
		}
	});

	it("leaves the simulation in `none` the whole time", () => {
		const { moves, blockedFrames } = simulate(
			new TrainingDummy({ behaviour: "idle" }),
			3000,
		);
		expect(moves).toHaveLength(0);
		expect(blockedFrames).toBe(0);
	});
});

describe("TrainingDummy: scripted rhythms", () => {
	it("blockAll raises exactly one guard and never drops it", () => {
		const dummy = new TrainingDummy({ behaviour: "blockAll" });
		const outputs = run(dummy, 2000);
		expect(outputs.every((o) => o.block)).toBe(true);

		const { blockedFrames, ticks } = simulate(
			new TrainingDummy({ behaviour: "blockAll" }),
			2000,
		);
		// One tick is spent getting the guard up.
		expect(blockedFrames).toBeGreaterThanOrEqual(ticks - 2);
	});

	it("slashes once per period, not once per tick", () => {
		const dummy = new TrainingDummy({
			behaviour: "slash",
			timing: { periodMs: 600 },
		});
		const { moves } = simulate(dummy, 3000);
		expect(moves.length).toBeGreaterThanOrEqual(4);
		expect(moves.every((m) => m === "slash")).toBe(true);
	});

	it("charges a Massive Strike and releases it", () => {
		const dummy = new TrainingDummy({
			behaviour: "massive",
			timing: { periodMs: 1200 },
		});
		// The charge is 4s now, so the hold must be watched across a full one.
		const outputs = run(dummy, MASSIVE_CHARGE_MS + 500);
		const heldMs = outputs.filter((o) => o.attack).length * DT_MS;
		expect(heldMs).toBeGreaterThan(MASSIVE_CHARGE_MS);
		// A release actually happened — the button went from held to released at
		// least once, which is the edge that fires the Massive.
		const releases = outputs.reduce(
			(n, o, i) => n + (i > 0 && outputs[i - 1]?.attack && !o.attack ? 1 : 0),
			0,
		);
		expect(releases).toBeGreaterThanOrEqual(1);

		const { moves } = simulate(
			new TrainingDummy({ behaviour: "massive", timing: { periodMs: 1200 } }),
			10000,
		);
		expect(moves).toContain("massive");
		expect(moves.filter((m) => m === "massive").length).toBeGreaterThanOrEqual(
			2,
		);
	});

	it("uppercuts on its own period", () => {
		const { moves } = simulate(
			new TrainingDummy({ behaviour: "uppercut", timing: { periodMs: 800 } }),
			3000,
		);
		expect(moves.filter((m) => m === "uppercut").length).toBeGreaterThanOrEqual(
			2,
		);
	});

	it("butterflies: slash, cancel into block, repeat", () => {
		const { moves, blockedFrames } = simulate(
			new TrainingDummy({ behaviour: "butterfly" }),
			3000,
		);
		// The cancel is the point: swings far shorter than the 330ms they declare.
		expect(moves.length).toBeGreaterThanOrEqual(6);
		expect(blockedFrames).toBeGreaterThan(0);

		/**
		 * The butterfly is *not* the combo, on the ground or anywhere else.
		 *
		 * A block cancel drops the chain, so this rhythm emits an endless run of
		 * identical openers. Letting the cancel carry the chain made the dummy
		 * commit to the uncancellable finisher every third swing — a move nobody
		 * asked it to throw, out of the one technique chosen for being safe.
		 */
		expect(moves.slice(0, 3)).toEqual(["slash", "slash", "slash"]);
		expect(moves.every((m) => m === "slash")).toBe(true);
	});

	/**
	 * The chain, thrown deliberately rather than as a side effect of butterflying.
	 *
	 * This is the rhythm a player has to find: press, wait for the hitbox to close,
	 * press again. A dummy that could not perform it would mean the window is too
	 * tight to hit on purpose, which is the difference between a combo and a
	 * coincidence.
	 */
	it("throws the whole three-hit chain, on its period", () => {
		const { moves } = simulate(
			new TrainingDummy({ behaviour: "combo", timing: { periodMs: 1200 } }),
			3000,
		);
		expect(moves.slice(0, 3)).toEqual(["slash", "slash2", "slash3"]);
		expect(moves.filter((m) => m === "slash3").length).toBeGreaterThanOrEqual(
			2,
		);
	});

	/**
	 * Jump height is analogue and edge-triggered: a one-frame press can only ever
	 * produce a minimum-height hop, which is how an earlier AI ended up unable to
	 * reach any of the arena's upper ledges.
	 */
	it("holds jump long enough for a real jump, repeatedly", () => {
		const dummy = new TrainingDummy({
			behaviour: "jump",
			timing: { periodMs: 800 },
		});
		let body: PlayerPosition = createPlayerState(OPEN_X, OPEN_Y, 1);
		let launches = 0;
		let peakRise = 0;
		let groundY = body.y;
		for (let i = 0; i < 240; i++) {
			const out = dummy.decide(
				perception({ selfX: body.x, selfY: body.y }),
				i * DT_MS,
				DT_MS,
			);
			const wasGrounded = body.grounded;
			body = tickPlayer(body, intentFrom(out), DT);
			if (body.grounded) groundY = body.y;
			else peakRise = Math.max(peakRise, groundY - body.y);
			if (wasGrounded && !body.grounded && body.vy < 0) launches++;
		}
		expect(launches).toBeGreaterThanOrEqual(2);
		expect(peakRise).toBeGreaterThan(100);
	});

	it("runs an explicit script and stops when it does not loop", () => {
		const dummy = new TrainingDummy({
			behaviour: "script",
			script: {
				loop: false,
				beats: [{ ms: 60, hold: { attack: true } }, { ms: 200 }],
			},
		});
		const { moves } = simulate(dummy, 2000);
		expect(moves).toEqual(["slash"]);
		expect(dummy.status.beatCount).toBe(0);
	});

	it("applies a dash once, not every tick of its beat", () => {
		const dummy = new TrainingDummy({
			behaviour: "script",
			script: { loop: false, beats: [{ ms: 200, dash: 1 }] },
		});
		const dashes = run(dummy, 400).filter((o) => o.dash !== 0);
		expect(dashes).toHaveLength(1);
	});
});

describe("TrainingDummy: reactive behaviours", () => {
	it("blockAfterFirstHit stands still until something lands", () => {
		const dummy = new TrainingDummy({
			behaviour: "blockAfterFirstHit",
			timing: { blockMs: 500 },
		});
		const before = run(dummy, 500);
		expect(before.every((o) => !o.block)).toBe(true);

		// One stunning hit, then the guard should come up and time out.
		const after = run(dummy, 1200, (tick) =>
			perception({ selfStunned: tick < 6 }),
		);
		expect(after.some((o) => o.block)).toBe(true);
		expect(after.at(-1)?.block).toBe(false);
	});

	it("counterAttack swings after the player's move goes active", () => {
		const dummy = new TrainingDummy({
			behaviour: "counterAttack",
			timing: { delayMs: 100 },
		});
		const outputs = run(dummy, 600, (tick) =>
			perception({
				enemyAction: "slash",
				enemyPhase: tick < 6 ? "active" : "recovery",
			}),
		);
		const firstAttack = outputs.findIndex((o) => o.attack);
		expect(firstAttack).toBeGreaterThan(0);
		// It must wait out the delay rather than swinging on the same frame.
		expect(firstAttack * DT_MS).toBeGreaterThanOrEqual(90);
	});

	it("walk paces between its bounds", () => {
		const dummy = new TrainingDummy({
			behaviour: "walk",
			timing: { walkLeftX: 260, walkRightX: 460 },
		});
		let x = 300;
		const dirs = new Set<string>();
		for (let i = 0; i < 400; i++) {
			const out = dummy.decide(perception({ selfX: x }), i * DT_MS, DT_MS);
			dirs.add(out.moveRight ? "right" : out.moveLeft ? "left" : "none");
			x += (out.moveRight ? 4 : 0) - (out.moveLeft ? 4 : 0);
		}
		expect(dirs.has("right")).toBe(true);
		expect(dirs.has("left")).toBe(true);
		expect(x).toBeGreaterThanOrEqual(250);
		expect(x).toBeLessThanOrEqual(470);
	});

	it("mirror repeats the player's buttons from the configured delay ago", () => {
		const dummy = new TrainingDummy({
			behaviour: "mirror",
			timing: { mirrorDelayMs: 200 },
		});
		// Attack for the first 100ms only.
		const outputs = run(
			dummy,
			1000,
			() => perception(),
			(tick) => observed({ attack: tick * DT_MS < 100 }),
		);
		const attacked = outputs
			.map((o, i) => (o.attack ? i * DT_MS : -1))
			.filter((t) => t >= 0);
		expect(attacked.length).toBeGreaterThan(0);
		// Delayed, not immediate.
		expect(Math.min(...attacked)).toBeGreaterThanOrEqual(150);
	});
});

describe("TrainingDummy: record and playback", () => {
	it("round-trips the player's input stream", () => {
		const dummy = new TrainingDummy({ behaviour: "record" });
		const script = (tick: number) =>
			observed({ attack: tick % 20 < 4, right: tick % 40 < 10 });

		// Recording: the dummy itself stands still.
		const whileRecording = run(dummy, 1000, () => perception(), script);
		expect(whileRecording.every((o) => !o.attack)).toBe(true);
		const frames = dummy.status.recordedFrames;
		expect(frames).toBeGreaterThan(50);

		dummy.configure({ behaviour: "playback" });
		const played = run(dummy, 1000);
		for (let i = 0; i < played.length; i++) {
			expect(played[i]?.attack, `frame ${i}`).toBe(script(i).attack);
			expect(played[i]?.moveRight, `frame ${i}`).toBe(script(i).right);
		}
	});

	it("never records more than the configured window", () => {
		const dummy = new TrainingDummy({
			behaviour: "record",
			timing: { recordMaxMs: 200 },
		});
		run(
			dummy,
			2000,
			() => perception(),
			() => observed(),
		);
		expect(dummy.status.recordedMs).toBeLessThanOrEqual(220);
	});

	it("does not record a frame the player never sent", () => {
		const dummy = new TrainingDummy({ behaviour: "record" });
		run(
			dummy,
			500,
			() => perception(),
			() => null,
		);
		expect(dummy.status.recordedFrames).toBe(0);
	});

	it("clears the recording on demand", () => {
		const dummy = new TrainingDummy({ behaviour: "record" });
		run(
			dummy,
			500,
			() => perception(),
			() => observed({ attack: true }),
		);
		expect(dummy.status.recordedFrames).toBeGreaterThan(0);
		dummy.clearRecording();
		expect(dummy.status.recordedFrames).toBe(0);
	});
});

describe("TrainingDummy: facing", () => {
	it("faces the player by default", () => {
		const dummy = new TrainingDummy({ behaviour: "blockAll" });
		expect(dummy.decide(perception({ playerX: 400 }), 0, DT_MS).face).toBe(1);
		expect(dummy.decide(perception({ playerX: 100 }), 0, DT_MS).face).toBe(-1);
	});

	/** The backstab battery row is only expressible with a guard pointed away. */
	it("faces away on request", () => {
		const dummy = new TrainingDummy({ behaviour: "blockAll", facing: "away" });
		expect(dummy.decide(perception({ playerX: 400 }), 0, DT_MS).face).toBe(-1);
		expect(dummy.decide(perception({ playerX: 100 }), 0, DT_MS).face).toBe(1);
	});

	it("takes an absolute side when told to", () => {
		const dummy = new TrainingDummy({ behaviour: "idle", facing: "left" });
		expect(dummy.decide(perception({ playerX: 400 }), 0, DT_MS).face).toBe(-1);
	});
});

describe("TrainingDummy: determinism", () => {
	/**
	 * The load-bearing property. The training room is the instrument every other
	 * measurement is taken with, so a script that drifts between runs would make
	 * every result it produces unfalsifiable.
	 */
	it("produces an identical output sequence on two runs", () => {
		const config = { behaviour: "butterfly" as const };
		const a = run(new TrainingDummy(config), 4000);
		const b = run(new TrainingDummy(config), 4000);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	it("restarts the rhythm on reset, so two sessions compare", () => {
		const dummy = new TrainingDummy({ behaviour: "slash" });
		const first = run(dummy, 2000);
		dummy.reset();
		const second = run(dummy, 2000);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});

	it("does not restart the rhythm for a config change that does not touch it", () => {
		const dummy = new TrainingDummy({ behaviour: "slash" });
		run(dummy, 200);
		const before = dummy.status.beatIndex;
		dummy.configure({ playerInvincible: false });
		expect(dummy.status.beatIndex).toBe(before);

		dummy.configure({ timing: { periodMs: 999 } });
		expect(dummy.status.beatIndex).toBe(0);
	});
});

describe("TrainingDummy: config", () => {
	it("merges patches group by group", () => {
		const dummy = new TrainingDummy({ timing: { periodMs: 400 } });
		dummy.configure({ timing: { delayMs: 30 } });
		expect(dummy.config.timing.periodMs).toBe(400);
		expect(dummy.config.timing.delayMs).toBe(30);
		expect(dummy.config.timing.blockMs).toBe(DEFAULT_TRAINING_TIMING.blockMs);
	});

	it("holsters the sword when asked for the gun", () => {
		const dummy = new TrainingDummy({ dummyStance: "gun" });
		expect(dummy.decide(perception(), 0, DT_MS).swordStance).toBe(false);
	});

	it("aims at the player", () => {
		const dummy = new TrainingDummy({ behaviour: "idle" });
		const out = dummy.decide(
			perception({ selfX: 100, selfY: 100, playerX: 200, playerY: 100 }),
			0,
			DT_MS,
		);
		expect(out.aimAngle).toBeCloseTo(0, 5);
	});
});

describe("TrainingDummy: phase timings honour the frame data", () => {
	/**
	 * The dummy must not be able to produce a move that breaks the table, because
	 * it drives the same `tickPlayer` everything else does. If this ever fails,
	 * the dummy is reaching around the simulation instead of feeding it.
	 */
	it("never leaves a move running past its declared duration", () => {
		const dummy = new TrainingDummy({ behaviour: "butterfly" });
		let body: PlayerPosition = createPlayerState(OPEN_X, OPEN_Y, 1);
		for (let i = 0; i < 600; i++) {
			const out = dummy.decide(perception(), i * DT_MS, DT_MS);
			body = tickPlayer(body, intentFrom(out), DT);
			if (body.meleeAction === "none") continue;
			expect(meleePhase(body)).not.toBe("none");
		}
	});
});
