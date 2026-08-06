/**
 * The training room's vocabulary, shared verbatim by the client and the server.
 *
 * Imports carry `.js` extensions and everything is a **named export**, because
 * `server/TrainingDummy.ts` reaches through this file: under the server's
 * NodeNext resolution a default export resolves to the module namespace object
 * and an `export *` resolves to nothing at all, silently, and `tsc` sees
 * neither. See docs/invariants.md.
 *
 * Nothing here is known to `src/game/simulation/`. The dummy is an *input
 * source*, exactly like `EnemyBrain`: it produces one `PlayerIntent` per tick
 * and the simulation cannot tell the difference. If a `training` flag ever
 * reaches `tickPlayer`, the design has gone wrong.
 */

import type { AIOutput } from "../characters/types.js";
import type { MeleeAction, MeleePhase } from "../simulation/Physics.js";

/**
 * What the dummy does when left alone.
 *
 * Every one of these is expressible as a `DummyScript` except the four that
 * need to *react* to something — `blockAfterFirstHit`, `counterAttack`,
 * `mirror` and `playback` — plus `walk`, which needs to know where it is.
 * That split is deliberate: a script is a recording of a controller, and a
 * controller cannot see the game.
 *
 * Crouching is absent on purpose. The simulation has no ducking, and the
 * training room exposes the game rather than extending it.
 */
export type DummyBehaviour =
	| "idle"
	| "blockAll"
	| "blockAfterFirstHit"
	| "jump"
	| "walk"
	| "slash"
	| "uppercut"
	| "massive"
	| "butterfly"
	| "combo"
	| "counterAttack"
	| "mirror"
	| "record"
	| "playback"
	| "script";

/**
 * Buttons held for a whole beat. Anything omitted is *released*, which is the
 * point: the simulation does its own press-edge detection, so a rhythm is
 * defined as much by its gaps as by its presses.
 *
 * `ultimate` is held like any other button — the cast fires on the release,
 * exactly as a player's does — so the dummy is a complete input source rather
 * than a sword-only one.
 */
type DummyHold = Partial<
	Pick<
		AIOutput,
		| "moveLeft"
		| "moveRight"
		| "jump"
		| "attack"
		| "block"
		| "uppercut"
		| "ultimate"
	>
>;

/** One phase of a scripted rhythm: which buttons, for how long. */
export interface DummyBeat {
	/** How long this beat lasts, ms. */
	ms: number;
	hold?: DummyHold;
	/** Absolute stance for the beat. Defaults to the configured dummy stance. */
	swordStance?: boolean;
	/** -1 or 1 to face that way; 0 (or omitted) leaves the configured facing. */
	face?: number;
	/** One-shot burst impulse, applied on the beat's first tick only. */
	dash?: -1 | 0 | 1;
	/** Aim angle in radians, for the gun. Defaults to aiming at the player. */
	aimAngle?: number;
}

export interface DummyScript {
	beats: DummyBeat[];
	/** Repeat forever (the default) or run once and go idle. */
	loop?: boolean;
}

/**
 * Which way the dummy points.
 *
 * `away` exists for the backstab battery row: a block covers the side you face,
 * so proving that getting behind a guard beats it requires a guard that is
 * deliberately pointed the wrong way.
 */
type DummyFacing = "foe" | "away" | "left" | "right";

/** Behaviour timings. Every behaviour that has a clock reads one of these. */
export interface TrainingTiming {
	/** Gap between repetitions for the periodic behaviours. */
	periodMs: number;
	/** `counterAttack`: how long after the player's move goes active to swing. */
	delayMs: number;
	/** `blockAfterFirstHit`: how long the guard stays up. */
	blockMs: number;
	/** `walk`: the two x positions, in world pixels, it paces between. */
	walkLeftX: number;
	walkRightX: number;
	/** `mirror`: how far in the past the player's input is repeated from. */
	mirrorDelayMs: number;
	/** `record`: cap on the recording, so a buffer cannot grow forever. */
	recordMaxMs: number;
}

interface TrainingSpawnPoint {
	x: number;
	y: number;
}

interface TrainingSpawn {
	player: TrainingSpawnPoint;
	dummy: TrainingSpawnPoint;
}

/**
 * The whole training room, resolved — every field present.
 *
 * Clients send a `TrainingConfigPatch`; the server merges it into this and
 * echoes the result back, so the UI reflects what the room actually is rather
 * than its own optimistic copy.
 */
export interface TrainingConfig {
	behaviour: DummyBehaviour;
	/** Only meaningful for `behaviour: "script"`. */
	script?: DummyScript;
	/** Dummy HP, refilled every tick while `dummyInvincible`. */
	dummyHp: number;
	dummyInvincible: boolean;
	/** Refill the *player's* HP every tick, so a session never ends. */
	playerInvincible: boolean;
	/** Suppress the server's 1.5s round reset while training. */
	disableRoundReset: boolean;
	/** Where both fighters are placed on reset, in world pixels. */
	spawn: TrainingSpawn;
	dummyStance: "sword" | "gun";
	facing: DummyFacing;
	timing: TrainingTiming;
}

/**
 * A partial update. Nested groups merge field-by-field rather than wholesale,
 * so a panel that only knows about `periodMs` cannot wipe the walk bounds.
 */
export interface TrainingConfigPatch
	extends Partial<Omit<TrainingConfig, "timing" | "spawn">> {
	timing?: Partial<TrainingTiming>;
	spawn?: Partial<TrainingSpawn>;
}

/** What the dummy is doing *right now* — the readout the panel lives on. */
export interface DummyStatus {
	behaviour: DummyBehaviour;
	/** Which beat of the current rhythm, and how many there are. */
	beatIndex: number;
	beatCount: number;
	beatElapsedMs: number;
	recording: boolean;
	recordedFrames: number;
	recordedMs: number;
	playing: boolean;
	playbackIndex: number;
}

/** The dummy as the simulation sees it, for the same readout. */
export interface DummyFighterState {
	id: string;
	hp: number;
	x: number;
	y: number;
	/** Velocity too: an uppercut is defined by the launch, and `vy < 0` is how you see it. */
	vx: number;
	vy: number;
	facing: number;
	meleeAction: MeleeAction;
	phase: MeleePhase;
	blocking: boolean;
	stunned: boolean;
}

/**
 * Counters only the server can honestly supply.
 *
 * Damage is counted *before* invincibility refills the HP bar, so a practice
 * session with both fighters invincible still reports what actually landed —
 * and bullet hits are simply invisible to a client, which never learns why a
 * projectile disappeared.
 */
export interface TrainingFighterStats {
	bulletsFired: number;
	bulletHits: number;
	damageDealt: number;
	damageTaken: number;
	/** Damage the sword guard turned away. */
	damageBlocked: number;
	hp: number;
}

/** Server → client. Sent on change, never per tick. */
export interface TrainingStateMsg {
	config: TrainingConfig;
	status: DummyStatus;
	dummy: DummyFighterState;
	stats: { player: TrainingFighterStats; dummy: TrainingFighterStats };
	/** ms since the last `reset`, so a report can state the window it covers. */
	elapsedMs: number;
}

/**
 * Client → server. One message rather than three, because a reset and a config
 * change are the same conversation and ordering between them matters.
 */
export interface TrainingConfigMsg {
	config?: TrainingConfigPatch;
	/** Respawn both fighters at `spawn`, clear bullets, zero the counters. */
	reset?: boolean;
	/** Throw away the recorded input buffer. */
	clearRecording?: boolean;
}

/**
 * Where the two fighters start: side by side on open ground, inside slash range.
 *
 * Every coordinate here is load-bearing, and the obvious choices are all wrong:
 *
 * - The match's ordinary spawns (x=100 and x=668) are half an arena apart, so
 *   the first thing any scenario would have to do is walk.
 * - x=300 puts the dummy on top of `PILLAR_LEFT`, 100px above the player. It
 *   looks fine in a snapshot and no attack can ever reach it.
 * - 360 and 420 sit on the clear stretch of ground between the two pillars,
 *   60px apart. A slash reaches 42px past a 32px body, so it connects; and 60px
 *   is comfortably past `BACKSTAB_MIN_SEPARATION_PX`, so a dummy facing away
 *   can actually be backstabbed rather than being too close to count.
 */
const DEFAULT_TRAINING_SPAWN: TrainingSpawn = {
	player: { x: 360, y: 480 },
	dummy: { x: 420, y: 480 },
};

export const DEFAULT_TRAINING_TIMING: TrainingTiming = {
	periodMs: 1200,
	delayMs: 120,
	blockMs: 800,
	// Between the pillars, so a pacing dummy stays on the same floor it started on.
	walkLeftX: 330,
	walkRightX: 470,
	mirrorDelayMs: 500,
	recordMaxMs: 10000,
};

/**
 * The default room: a dummy that does nothing, close enough to hit.
 *
 * `idle` is the default because it is the only behaviour whose expected result
 * is unambiguous — every battery row that measures a *player* move needs an
 * opponent that contributes nothing to the outcome.
 */
export function defaultTrainingConfig(): TrainingConfig {
	return {
		behaviour: "idle",
		dummyHp: 100,
		dummyInvincible: true,
		playerInvincible: true,
		disableRoundReset: true,
		spawn: {
			player: { ...DEFAULT_TRAINING_SPAWN.player },
			dummy: { ...DEFAULT_TRAINING_SPAWN.dummy },
		},
		dummyStance: "sword",
		facing: "foe",
		timing: { ...DEFAULT_TRAINING_TIMING },
	};
}

/** Merge a patch into a resolved config, group by group. Pure. */
export function mergeTrainingConfig(
	base: TrainingConfig,
	patch: TrainingConfigPatch,
): TrainingConfig {
	const { timing, spawn, ...rest } = patch;
	return {
		...base,
		...rest,
		timing: { ...base.timing, ...timing },
		spawn: {
			player: { ...base.spawn.player, ...spawn?.player },
			dummy: { ...base.spawn.dummy, ...spawn?.dummy },
		},
	};
}
