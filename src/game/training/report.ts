/**
 * The agent-facing half of the training room: what you can ask it to do, and
 * what it hands back.
 *
 * Client-only, unlike `types.ts` — none of this crosses the wire, so it is free
 * to name client types such as `MeleeEventMsg` directly.
 *
 * The console API is a first-class deliverable, equal to the UI. It is typed
 * here and installed in `src/types/global.d.ts` alongside `__gameState` and
 * `__physicsDiagnostic`, because those are a contract: declaring them means a
 * rename breaks the build rather than the measurement.
 */

import type { MeleeEventMsg } from "../online/types";
import type {
	MeleeMove,
	MeleeOutcome,
	MeleePhase,
	PlayerIntent,
	PlayerPosition,
} from "../simulation/Physics";
import type {
	DummyFighterState,
	DummyScript,
	DummyStatus,
	TrainingConfig,
	TrainingConfigPatch,
	TrainingFighterStats,
} from "./types";

export type MoveCount = Record<MeleeMove, number>;

/** The four phase lengths of one move, as declared and as observed. */
export interface PhaseTimings {
	startupMs: number;
	activeMs: number;
	recoveryMs: number;
	totalMs: number;
}

/**
 * One completed move by the local fighter, with what the server made of it.
 *
 * This is the training room's answer to "what actually happened just then",
 * and the thing a frame data readout is built from: the move, its measured
 * phases against the `MOVES` table, and the outcome only the server could know.
 */
export interface TrainingExchange {
	move: MeleeMove;
	/** null when the swing whiffed — nothing was there to judge. */
	outcome: MeleeOutcome | null;
	damage: number;
	measured: PhaseTimings;
	declared: PhaseTimings;
	/** ms into the session, so two exchanges can be ordered. */
	atMs: number;
}

/** Everything that happened since the last `reset()`. */
export interface TrainingReport {
	scenario?: string;
	durationMs: number;
	player: {
		moves: MoveCount;
		blocks: number;
		/** Server-counted, before invincibility refills anyone's HP bar. */
		damageDealt: number;
		damageTaken: number;
	};
	dummy: {
		moves: MoveCount;
		blocks: number;
		parries: number;
		damageDealt: number;
		damageTaken: number;
	};
	/** Every server-judged impact, in order. */
	events: MeleeEventMsg[];
	/** Times an ultimate was denied by the dummy (or by the player). */
	denies: number;
	/** HE blasts the server reported. */
	explosions: number;
	/** Times a trap rooted somebody. */
	rooted: number;
	outcomes: Record<MeleeOutcome, number>;
	bullets: { fired: number; hits: number };
	/** The melee half of `PhysicsDiagnostics` — not a second implementation. */
	violations: unknown[];
	melee: MeleeSummaryView | undefined;
	reconciliation: ReconciliationView | undefined;
	exchanges: TrainingExchange[];
	lastExchange: TrainingExchange | null;
	/** Loud rather than absent: a report taken with no server is not a clean one. */
	connected: boolean;
}

/**
 * The slices of `PhysicsDiagnostics`'s report the training room reads.
 *
 * Declared structurally rather than imported, because the diagnostic's report
 * is a JSON document by design — it is printed to a console line and parsed by
 * a harness, so its shape is a wire format rather than a class.
 */
interface MeleeSummaryView {
	slashes: number;
	/** The ground chain: continuations thrown, chains that reached the finisher. */
	comboLinks: number;
	combosFinished: number;
	knockdowns: number;
	uppercuts: number;
	massives: number;
	/** Bomb dives begun — the airborne half of the massive. */
	plunges: number;
	blocks: number;
	hits: number;
	backstabs: number;
	blasts: number;
	bombs: number;
	parries: number;
	illegalActions: number;
	airborneChainLinks: number;
	blockedUnblockables: number;
	frameDataViolations: number;
	stuckActionFrames: number;
	meleeDesyncFrames: number;
	/** Per fighter: the room has a "local" side and a "remote" dummy side. */
	movesByFighter: Partial<Record<"local" | "remote", MoveCount>>;
	blocksByFighter: Partial<Record<"local" | "remote", number>>;
	violations: unknown[];
}

interface ReconciliationView {
	totalCorrections: number;
	avgErrorPx: number;
	maxErrorPx: number;
	visibleCorrections: number;
}

export interface DiagnosticView {
	meleeSummary?: MeleeSummaryView;
	reconciliationSummary?: ReconciliationView;
}

/** The training room as it is right now, for the panel and for an agent. */
export interface TrainingState {
	connected: boolean;
	config: TrainingConfig;
	status: DummyStatus;
	/** From the last `training-state`, overlaid with the live snapshot. */
	dummy: DummyFighterState;
	stats: { player: TrainingFighterStats; dummy: TrainingFighterStats };
	elapsedMs: number;
	local: {
		hp: number;
		x: number;
		y: number;
		facing: number;
		meleeAction: PlayerPosition["meleeAction"];
		phase: MeleePhase;
		blocking: boolean;
		stunned: boolean;
		massiveReady: boolean;
		stance: PlayerPosition["stance"];
	};
	lastExchange: TrainingExchange | null;
}

interface TrainingStep {
	intent: Partial<PlayerIntent>;
	holdMs: number;
	/**
	 * Where to aim while the buttons are held. Defaults to the live cursor.
	 *
	 * Worth setting on anything that swings. Facing follows the aim, and a
	 * headless run never moves the mouse — so the fighter faces whichever side of
	 * it the cursor's default position happens to fall on, which changes with the
	 * spawn. A scenario that moved its fighters 40px once started swinging the
	 * other way and reported a clean miss.
	 */
	aimAngle?: number;
	/**
	 * Idle time after the release, before the next step.
	 *
	 * Moves start from neutral only, so a step fired during the previous move's
	 * recovery is simply swallowed: three chained attacks produced two moves and
	 * the report could only say the third had never happened.
	 */
	restMs?: number;
}

/** A whole test in one call: set the room up, act, settle, report. */
export interface TrainingScenario {
	name: string;
	config?: TrainingConfigPatch;
	/** Shorthand for `config: { behaviour: "script", script }`. */
	script?: DummyScript;
	steps?: TrainingStep[];
	/** Extra settle time before the report is taken. */
	settleMs?: number;
}

export interface TrainingApi {
	/** Set behaviour and options. Merges with the current config. */
	set(config: TrainingConfigPatch): Promise<TrainingState>;
	/** Load an explicit beat script and run it. */
	script(script: DummyScript): Promise<TrainingState>;
	/** Throw away the recorded input buffer, leaving the config alone. */
	clearRecording(): Promise<TrainingState>;
	/** Current config, dummy state and player state. Synchronous. */
	state(): TrainingState;
	/** Reset both fighters to spawn, clear bullets, zero the counters. */
	reset(): Promise<void>;
	/** Drive the *local* fighter programmatically — the agent's controller. */
	input(
		intent: Partial<PlayerIntent>,
		holdMs: number,
		aimAngle?: number,
	): Promise<void>;
	/** Everything that happened since the last `reset()`. */
	report(): TrainingReport;
	/** Run a scenario end to end and resolve with its report. */
	run(scenario: TrainingScenario): Promise<TrainingReport>;
	/** Wait for the room to be seated and the dummy to be live. */
	ready(timeoutMs?: number): Promise<boolean>;
}
