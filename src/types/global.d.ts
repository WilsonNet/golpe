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
import type { PlayerPosition } from "../game/simulation/Physics";

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

declare global {
	interface Window {
		/** Flip AI vs AI, same as pressing P. */
		__toggleAIVsAI?: () => void;
		/** HP, AI states and full simulation state for both fighters. */
		__gameState?: () => GameStateSnapshot;
		/** Collect frames for `durationMs`, then print `__DIAGNOSTIC_RESULT__…__END__`. */
		__physicsDiagnostic?: (durationMs?: number) => string;
	}
}
