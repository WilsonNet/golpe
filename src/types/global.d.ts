/**
 * The debug hooks the game installs on `window`.
 *
 * These are a real contract, not a convenience: `scripts/diagnose.mjs`,
 * `scripts/verify-modes.mjs` and `scripts/probe-online.mjs` all drive the game
 * through them, and the whole feedback loop reads their output. Declaring them
 * here means the harness and the game agree on the shape, and renaming one
 * breaks the build rather than the measurement.
 *
 * They were previously installed by casting `window` to
 * `Record<string, unknown>`, which typed away every mistake it could have
 * caught.
 */

import type { AIState } from "../game/characters/EnemyBrain";
import type {
	MatchEndReason,
	MatchPhase,
	Standing,
} from "../game/simulation/Deathmatch";
import type { MeleePhase, PlayerPosition } from "../game/simulation/Physics";
import type { TrainingApi } from "../game/training/report";

export interface GameStateSnapshot {
	aiVsAIMode: boolean;
	onlineMode: boolean;
	onlineAIMode: boolean;
	soloMatch: boolean;
	/** `?training=true`: the opponent is a scriptable dummy, not a bot. */
	trainingMode: boolean;
	playerHP: number;
	enemyHP: number;
	playerState: AIState | undefined;
	enemyState: AIState | undefined;
	playerPhys: PlayerPosition;
	/**
	 * The nearest thing to "the opponent" in a match that may have fifteen.
	 *
	 * Nullable, because a sixteen-fighter room legitimately has moments with no
	 * remote fighter yet — the first snapshot has not landed. A duel never did, so
	 * this used to be non-null and a probe would have crashed on the connecting
	 * frame rather than reporting it.
	 */
	enemyPhys: PlayerPosition | null;
	remote: { x: number; y: number } | null | undefined;
	/** Fighters in the room, the local one included. */
	fighterCount: number;
	bulletCount: number;
}

/**
 * The deathmatch's contract with the harness.
 *
 * `__gameState` describes two fighters, because that is what a duel is. A
 * sixteen-player match is a scoreboard and a clock, and those need saying
 * separately — `scripts/deathmatch-probe.mjs` asserts on exactly this.
 */
export interface MatchStateSnapshot {
	connected: boolean;
	/** The id the server scores this client under. */
	myId: string;
	myName: string;
	fighterCount: number;
	phase: MatchPhase;
	elapsedMs: number;
	timeLeftMs: number;
	scoreLimit: number;
	timeLimitMs: number;
	endReason: MatchEndReason;
	winnerId: string | null;
	winnerName: string;
	/** Ranked, by the same pure function the server ranks with. */
	standings: Standing[];
	/**
	 * Rollback quality: how often a remote fighter's prediction was wrong, and by
	 * how much. `rollbacks: 0` means no snapshots landed and nothing else here
	 * means anything.
	 */
	rollback: RollbackSummary | null;
	/** Snapshot bandwidth, plus the same rollback numbers. */
	net: {
		snapshots: number;
		fightersInSnapshot: number;
		avgSnapshotBytes: number;
		maxSnapshotBytes: number;
		estBytesPerSec: number;
		rollback: RollbackSummary;
	} | null;
}

export interface RollbackSummary {
	rollbacks: number;
	avgErrorPx: number;
	maxErrorPx: number;
	visibleCorrections: number;
	avgResimTicks: number;
	maxResimTicks: number;
	frozenRemoteTicks: number;
	teleports: number;
	avgLeadTicks: number;
	maxLeadTicks: number;
	primarySwitches: number;
}

/**
 * Everything that decides where the local fighter looks and shoots.
 *
 * Aim is the one system the AI-vs-AI loop cannot exercise: the bots hand the
 * simulation an angle directly and never touch a cursor, so a broken
 * screen→world conversion is invisible to `diagnose.mjs` and shows up only as
 * "the game struggles to follow the mouse". `scripts/aim-probe.mjs` drives a
 * real cursor and reads this.
 */
export interface AimSnapshot {
	/** Cursor in world pixels, after the screen→world conversion under test. */
	pointerX: number;
	pointerY: number;
	/** Centre of the local fighter's body, world pixels. */
	centreX: number;
	centreY: number;
	/** The angle the simulation and the gun both use, radians. */
	aimAngle: number;
	/** Which side of the fighter the cursor is on: -1, 0 or 1. */
	aimSide: number;
	/** The facing the simulation settled on. Should equal `aimSide`. */
	facing: number;
	/** Facing is not steerable during a swing's startup or active frames. */
	phase: MeleePhase;
	stance: "sword" | "gun";
	/** A dead fighter cannot fire — the probe must not read that as a bad angle. */
	hp: number;
	/** Logical viewport and camera the conversion was done against. */
	viewWidth: number;
	viewHeight: number;
	cameraX: number;
	cameraY: number;
	/** Live projectiles owned by the local fighter, with their headings. */
	bullets: { id: number; x: number; y: number; angle: number }[];
}

declare global {
	interface Window {
		/** Flip AI vs AI, same as pressing P. */
		__toggleAIVsAI?: () => void;
		/** HP, AI states and full simulation state for both fighters. */
		__gameState?: () => GameStateSnapshot;
		/** Scores, clock, winner and rollback quality for a deathmatch. */
		__matchState?: () => MatchStateSnapshot;
		/**
		 * Answer the name prompt from a script.
		 *
		 * Deliberately the same event the React modal fires, so an automated run
		 * exercises the path a human takes instead of a bypass nobody plays.
		 */
		__setPlayerName?: (name: string) => void;
		/** Collect frames for `durationMs`, then print `__DIAGNOSTIC_RESULT__…__END__`. */
		__physicsDiagnostic?: (durationMs?: number) => string;
		/** Where the cursor points, where the fighter looks, and where its shots go. */
		__aimState?: () => AimSnapshot;
		/**
		 * The training room's controller: configure the dummy, drive the local
		 * fighter, run a scenario, read a structured report.
		 *
		 * Present only under `?training=true`. It is a first-class deliverable
		 * rather than a debug convenience — an agent can set up a scenario, run it
		 * and read the result with no human involved, which is what turns "does
		 * RMB actually guard a slash from the left?" into a repeatable observation
		 * rather than something inferred from watching two brains fight.
		 */
		__training?: TrainingApi;
	}
}
