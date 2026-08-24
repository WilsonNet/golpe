/**
 * The debug hooks the game installs on `window`.
 *
 * These are a real contract, not a convenience: `scripts/diagnose.ts`,
 * `scripts/verify-modes.ts` and `scripts/probe-online.ts` all drive the game
 * through them, and the whole feedback loop reads their output. Declaring them
 * here means the harness and the game agree on the shape, and renaming one
 * breaks the build rather than the measurement.
 *
 * They were previously installed by casting `window` to
 * `Record<string, unknown>`, which typed away every mistake it could have
 * caught.
 */

import type { AIState } from "../game/characters/EnemyBrain";
import type { AimReport } from "../game/input/Aim";
import type { AimScheme, DeckSetting } from "../game/input/Scheme";
import type { RosterEntry, TeamStatus } from "../game/online/types";
import type { PotgPhase } from "../game/potg/Director";
import type { PotgAnnounce, PotgTrackEntry } from "../game/potg/types";
import type {
	MatchEndReason,
	MatchPhase,
	Standing,
} from "../game/simulation/Deathmatch";
import type { MeleePhase, PlayerPosition } from "../game/simulation/Physics";
import type { MatchMode, TeamId } from "../game/simulation/Teams";
import type { AudioKitState } from "../game/sound/engine";
import type { AudioChannel } from "../game/sound/mixer";
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
	/** How many 800px screens wide the arena is (`?screen=N`). */
	worldScreens: number;
	/** The world's width in px. */
	worldWidth: number;
	/** The follow camera's top-left, world px. */
	cameraX: number;
	cameraY: number;
	/** Item charges left in the local fighter's life, and the life's maximum. */
	itemCharges: number;
	itemMaxCharges: number;
}

/**
 * The deathmatch's contract with the harness.
 *
 * `__gameState` describes two fighters, because that is what a duel is. A
 * sixteen-player match is a scoreboard and a clock, and those need saying
 * separately — `scripts/deathmatch-probe.ts` asserts on exactly this.
 */
export interface MatchStateSnapshot {
	connected: boolean;
	/**
	 * The room this client is in.
	 *
	 * Rooms are addressed rather than matchmade, so a probe that wants two clients
	 * in one match must pass the same `?room=` to both.
	 */
	roomId: string;
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
	 * Which ruleset the room plays. `"ffa"` is the deathmatch every other field
	 * here describes.
	 */
	mode: MatchMode;
	/**
	 * The round scoreboard in a team deathmatch, or `null` in a free-for-all.
	 *
	 * Its own object because a team match is not answerable from the individual
	 * standings: sixteen frag counts say nothing about whether a side was ever
	 * wiped out, which is the only thing that scores in this mode.
	 * `scripts/tdm-probe.ts` reads exactly this.
	 */
	teams: TeamStatus | null;
	/** The local fighter's side, so a probe can check its own friendly fire. */
	myTeam: TeamId | null;
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
	/** How many 800px screens wide the arena is (`?screen=N`). */
	worldScreens: number;
	/** The world's width in px. */
	worldWidth: number;
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
 * screen→world conversion is invisible to `diagnose.ts` and shows up only as
 * "the game struggles to follow the mouse". `scripts/aim-probe.ts` drives a
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

/**
 * Which scheme is aiming this fighter, and what its two layers are doing.
 *
 * Controller mode is invisible to every other probe for exactly the reason aim
 * was: the AI brains hand the simulation an angle and never touch a stick, and
 * Playwright cannot press a physical gamepad button. `scripts/pad-probe.ts`
 * stubs `navigator.getGamepads` and reads this.
 */
export interface InputSnapshot {
	scheme: AimScheme;
	deck: DeckSetting;
	/** Whether the on-screen gamepad is actually drawn right now. */
	deckVisible: boolean;
	/** True once a gamepad has reported anything at all. */
	padAvailable: boolean;
	/** The Contra aim, the fine stick, and the handover between them. */
	aim: AimReport;
	/** What the intent asked for: -1, 1, or 0 meaning "let the feet decide". */
	face: number;
	/** What the simulation settled on. */
	facing: number;
}

/**
 * Everything the ultimate is doing, from one client's point of view.
 *
 * Its own snapshot because no existing probe can see any of it: AI vs AI never
 * presses the button (a brain has no charge meter to reason about), the
 * deathmatch probe reads scores, and the physics diagnostic reads positions.
 * `scripts/ultimate-probe.ts` reads exactly this, on two clients at once —
 * which is the only way to check that the cinematic froze *both* of them.
 */
export interface UltSnapshot {
	myId: string;
	/** Local fighter's charge, 0..100. Server-owned. */
	charge: number;
	ready: boolean;
	/** True while the ultimate button is held and a cast is legal. */
	aiming: boolean;
	/** True while this client is running no fixed steps at all. */
	frozen: boolean;
	cinematic: {
		casterId: string;
		remainingMs: number;
		totalMs: number;
	} | null;
	grenades: { id: number; ownerId: string; x: number; y: number }[];
	singularity: {
		id: number;
		ownerId: string;
		/** The caster's side, so a probe can check the team's immunity too. */
		ownerTeam: TeamId | null;
		x: number;
		y: number;
		remainingMs: number;
	} | null;
	/**
	 * Everybody this client's own grip test says is caught.
	 *
	 * Derived with the shared `fieldFor` + `singularityGrip`, so a caster
	 * appearing in here would be a friendly-fire bug and not a reporting one.
	 */
	held: string[];
	/** Charge for every fighter this client knows about, by id. */
	charges: Record<string, number>;
	/** Local simulation state, so a probe can watch the pull directly. */
	playerPhys: PlayerPosition;
}

/**
 * The Play of the Game ceremony, from one client's point of view.
 *
 * Nothing else can see any of it. Every other probe stops reading at the frame
 * the match ends, which is the frame this starts — so a cinematic that
 * degraded into a static shot, or a clip that never downloaded, would leave the
 * whole suite green. `scripts/potg-probe.ts` reads exactly this.
 */
export interface PotgSnapshot {
	/** The reliable announcement, or null before one arrives. */
	announced: PotgAnnounce | null;
	/** True while the replay owns the camera and the fighters. */
	active: boolean;
	/** Which camera movement is running. */
	phase: PotgPhase | null;
	/** Where in the footage the projector is, in ms. */
	clipMs: number;
	/** How fast the footage is running: 1 real time, less in slow motion, 0 held. */
	rate: number;
	/** The camera's push-in. 1 everywhere except inside a replay. */
	zoom: number;
	letterbox: number;
	/**
	 * How much of the arena the title card is covering, 0..1.
	 *
	 * The only way to tell a title *card* from a caption: it has to reach 1 —
	 * nothing else on screen — and then come back to 0. A card that faded in over
	 * a visible replay satisfies every other metric in this snapshot.
	 */
	curtain: number;
	/** Progress through the title card, 0..1. */
	intro: number;
	clip: {
		roomId: string;
		durationMs: number;
		actionAtMs: number;
		frames: number;
		cast: number;
		beats: number;
		protagonist: string;
	} | null;
	/**
	 * One entry per camera movement, in order, with where the camera ended up.
	 *
	 * The pre-roll exists to move a camera, and no other metric in the game reads
	 * one. This is the only way to assert that the establish shot was wide, that
	 * the push actually pushed, and that the whip pan swung.
	 */
	track: PotgTrackEntry[];
	/** Fighters the replay drew this frame. */
	drawn: number;
	/** Cast members conjured because they had left the room. */
	ghosts: number;
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
		/** Which input scheme is live, and what the two aim layers are doing. */
		__inputState?: () => InputSnapshot;
		/** Charge, the cinematic freeze, the grenade and the open black hole. */
		__ultState?: () => UltSnapshot;
		/** The end-of-match ceremony: the announcement, the clip, and the camera edit. */
		__potgState?: () => PotgSnapshot;
		/**
		 * Switch aiming scheme from a script.
		 *
		 * Deliberately the same store the Esc menu writes, so an automated run
		 * exercises the path a player takes instead of a bypass nobody plays.
		 */
		__setInputScheme?: (scheme: AimScheme) => void;
		/** Live roster, with teams and admin flags — the Esc menu's Room panel. */
		__rosterState?: () => RosterEntry[];
		/** Switch side in a team room — same channel the Room panel uses. */
		__sendTeam?: (team: TeamId) => void;
		/** Add a server bot mid-match (admins only). */
		__sendBotAdd?: (team?: TeamId | null) => void;
		/** Remove a server bot mid-match (admins only). */
		__sendBotRemove?: (team?: TeamId | null) => void;
		/** Grant or revoke bot rights — creator only. */
		__sendAdmin?: (targetId: string, admin: boolean) => void;
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
		/**
		 * The move-list preview's fighter, while a preview stage is mounted:
		 * the story clock, the fighter's position and its live melee state.
		 * What a preview must prove is that the scripted intent reached the
		 * simulation — a story whose attack never fired would otherwise
		 * preview as a fighter standing still.
		 */
		__previewState?: () => {
			t: number;
			story: number;
			speed: number;
			x?: number;
			y?: number;
			meleeAction?: string;
			meleeTimer?: number;
			dragonTimer?: number;
			stance?: string;
			vx?: number;
			grounded?: boolean;
		};
		/** Study a preview frame by frame: 1 is real time, 0.25 is a quarter. */
		__previewSpeed?: (speed: number) => void;
		/**
		 * Every sound that has played, which music track is latched, the
		 * context state and the mixer preferences — the audio feedback loop's
		 * eye. `scripts/audio-probe.ts` reads exactly this.
		 */
		__audioState?: () => AudioKitState;
		/** Play one SFX by bank name — the same path the game uses. */
		__audioPlay?: (name: string) => void;
		/**
		 * Write a mixer channel's volume — deliberately the same store the
		 * Sound menu writes, so an automated run exercises the path a player
		 * takes instead of a bypass nobody plays.
		 */
		__audioSetVolume?: (channel: AudioChannel, value: number) => void;
	}
}
