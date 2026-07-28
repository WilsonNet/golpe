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
import type { MeleePhase, PlayerPosition } from "../game/simulation/Physics";

export interface GameStateSnapshot {
	aiVsAIMode: boolean;
	onlineMode: boolean;
	onlineAIMode: boolean;
	soloMatch: boolean;
	playerHP: number;
	enemyHP: number;
	playerState: AIState | undefined;
	enemyState: AIState | undefined;
	playerPhys: PlayerPosition;
	enemyPhys: PlayerPosition;
	remote: { x: number; y: number } | null | undefined;
	bulletCount: number;
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
		/** Collect frames for `durationMs`, then print `__DIAGNOSTIC_RESULT__…__END__`. */
		__physicsDiagnostic?: (durationMs?: number) => string;
		/** Where the cursor points, where the fighter looks, and where its shots go. */
		__aimState?: () => AimSnapshot;
	}
}
