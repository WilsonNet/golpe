/**
 * The measurement half of the feedback loop.
 *
 * Emits a structured JSON report that Playwright scrapes and the agent reasons
 * over. Jitter alone was not enough: a build can be jitter-free and still have
 * players standing inside walls or floating on a moon-gravity jump, so this
 * also measures collision integrity and movement feel.
 *
 * Output is wrapped as `__DIAGNOSTIC_RESULT__{...}__END__` on one console line.
 */

import { penetrationDepth } from "../simulation/Arena";
import {
	BULLET_SPEED,
	MAX_FALL_SPEED,
	type MeleeAction,
	type MeleeMove,
	type MeleeOutcome,
	MOVES,
	moveDuration,
	type PlayerPosition,
} from "../simulation/Physics";

/**
 * Jitter thresholds are derived from the simulation constants and the *actual*
 * frame dt, not hardcoded.
 *
 * Fixed numbers rot: 25px for player_y was calibrated against GRAVITY = 300 and
 * kept flagging perfectly legal falls once MAX_FALL_SPEED became 950 (a single
 * 30fps frame legitimately moves 31.7px). A threshold that reports correct
 * physics as a defect trains you to ignore the metric.
 *
 * The question the metric should ask is "did this move further than physics
 * permits in this much time", so the bound is speed x dt with headroom.
 */
const JITTER_SAFETY = 1.6;
/** Floors, so a very short frame cannot produce a hair-trigger threshold. */
export const DIAG_JITTER_X = 35;
export const DIAG_JITTER_Y = 25;
export const DIAG_JITTER_CAM = 15;
/** Fastest an actor can move horizontally: a dash. */
const MAX_DASH_SPEED = 1000;

function jitterLimitX(dtMs: number): number {
	return Math.max(
		DIAG_JITTER_X,
		MAX_DASH_SPEED * (dtMs / 1000) * JITTER_SAFETY,
	);
}

function jitterLimitY(dtMs: number): number {
	return Math.max(
		DIAG_JITTER_Y,
		MAX_FALL_SPEED * (dtMs / 1000) * JITTER_SAFETY,
	);
}

/** Anything deeper than this is a genuine collision failure, not float noise. */
const PENETRATION_TOLERANCE_PX = 0.5;

/** Frames of jitter checking skipped after an announced teleport. */
const TELEPORT_SUPPRESSION_FRAMES = 4;

interface DiagnosticFrame {
	playerX: number;
	playerY: number;
	playerVy: number;
	enemyX: number;
	enemyY: number;
	cameraX: number;
	cameraY: number;
	grounded: boolean;
	penetration: number;
	t: number;
	dt: number;
	physicsSteps: number;
}

interface JitterEvent {
	frame: number;
	type: string;
	delta: number;
	expectedMax: number;
	severity: number;
}

interface ReconEvent {
	frame: number;
	errorPx: number;
	replayed: number;
}

interface PenetrationEvent {
	frame: number;
	who: string;
	depth: number;
	x: number;
	y: number;
}

/** A projectile as it is actually being drawn this frame. */
export interface BulletSample {
	id: number;
	x: number;
	y: number;
}

export interface DiagnosticSample {
	t: number;
	dt: number;
	physicsSteps: number;
	player: PlayerPosition;
	enemy: { x: number; y: number } | null;
	/**
	 * The opponent's full simulation state, when it is known.
	 *
	 * Sword combat is a two-sided conversation, so watching only the local
	 * fighter would miss half of every exchange — including every block and
	 * parry the local player is on the wrong end of.
	 */
	enemyState?: PlayerPosition | null;
	/** Rendered projectiles, keyed by stable id. */
	bullets?: BulletSample[];
	cameraX: number;
	cameraY: number;
}

interface BulletTrack {
	id: number;
	points: { x: number; y: number; t: number }[];
	steps: number[];
	/** Per-frame ratio of actual step to the step physics says to expect. */
	stepRatios: number[];
	teleports: number;
	frozen: number;
}

/**
 * Projectile thresholds.
 *
 * Bullets travel at a constant BULLET_SPEED in a straight line with no gravity,
 * so their motion is fully determined. Any deviation is a rendering defect, not
 * physics: a step far from the expected one means a jump or a stall, and any
 * bend in the path means the sprite was reassigned to a different bullet.
 */
const BULLET_TELEPORT_RATIO = 2.5;
const BULLET_FROZEN_RATIO = 0.15;
/** Max perpendicular deviation from a straight path before it counts as a bend. */
const BULLET_PATH_TOLERANCE_PX = 2;
/** Ignore tracks too short to say anything. */
const BULLET_MIN_POINTS = 4;

/**
 * Melee measurement thresholds.
 *
 * The frame data in `MOVES` is a contract: a move's phases last exactly as long
 * as the table says. `FRAME_TOLERANCE_MS` is one physics tick of slack, since a
 * move can only ever end on a tick boundary — anything beyond that is a state
 * machine that has stopped obeying its own table.
 */
const FRAME_TOLERANCE_MS = 1000 / 60 + 1;
/**
 * The same contract, judged against a fighter seen only through 20Hz snapshots.
 *
 * A remote's `meleeTimer` advances in ~50ms jumps, so a move that ends normally
 * between two snapshots is last observed up to a snapshot short of its declared
 * total — which reads as an early cancel and, on an uncancellable move, as a
 * frame data violation that never happened. The metric has to know the
 * resolution of what it is watching, or it reports the network as a bug.
 */
const SNAPSHOT_TOLERANCE_MS = 1000 / 20 + FRAME_TOLERANCE_MS;
/**
 * How soon a cancelled slash must be followed by another to count as a
 * butterfly, rather than two unrelated swings that happened to be close.
 */
const BUTTERFLY_WINDOW_MS = 260;

/** Per-fighter melee tracking. Two of these: the local fighter and the remote. */
interface MeleeTrack {
	lastAction: MeleeAction;
	lastTimer: number;
	wasBlocking: boolean;
	wasStunned: boolean;
	wasMassiveReady: boolean;
	/** ms since a slash was cancelled short, for butterfly chaining. */
	sinceCancelMs: number;
	chainLength: number;
}

function newMeleeTrack(): MeleeTrack {
	return {
		lastAction: "none",
		lastTimer: 0,
		wasBlocking: false,
		wasStunned: false,
		wasMassiveReady: false,
		sinceCancelMs: Number.POSITIVE_INFINITY,
		chainLength: 0,
	};
}

function stats(values: number[]) {
	if (values.length === 0) return { min: 0, max: 0, avg: 0, stdDev: 0 };
	const sum = values.reduce((a, b) => a + b, 0);
	const avg = sum / values.length;
	const variance =
		values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
	return {
		min: Math.min(...values),
		max: Math.max(...values),
		avg,
		stdDev: Math.sqrt(variance),
	};
}

const round = (n: number, places = 2) => {
	const f = 10 ** places;
	return Math.round(n * f) / f;
};

export class PhysicsDiagnostics {
	private active = false;
	private durationMs = 0;
	private frames: DiagnosticFrame[] = [];
	private frameCount = 0;
	private jitter: JitterEvent[] = [];
	private recon: ReconEvent[] = [];
	private penetrations: PenetrationEvent[] = [];
	private prev = { px: 0, py: 0, ex: 0, ey: 0, cx: 0, cy: 0 };
	private skipJitterFrames = 0;

	/** Projectile tracks, keyed by bullet id. */
	private bulletTracks = new Map<number, BulletTrack>();

	/**
	 * Melee counters.
	 *
	 * Deliberately two kinds. The `must be zero` group catches a system breaking
	 * its own rules; the counting group catches a system that is silently never
	 * used. Only the second kind can tell a genuinely clean run apart from a
	 * build where nobody ever drew a sword — and every zero-target below is
	 * trivially satisfied by the latter.
	 */
	private meleeTracks = new Map<string, MeleeTrack>();
	private moveCounts: Record<MeleeMove, number> = {
		slash: 0,
		uppercut: 0,
		massive: 0,
	};
	private outcomeCounts: Record<MeleeOutcome, number> = {
		hit: 0,
		backstab: 0,
		blocked: 0,
		parried: 0,
	};
	private outcomeByMove: Record<MeleeMove, Record<MeleeOutcome, number>> = {
		slash: { hit: 0, backstab: 0, blocked: 0, parried: 0 },
		uppercut: { hit: 0, backstab: 0, blocked: 0, parried: 0 },
		massive: { hit: 0, backstab: 0, blocked: 0, parried: 0 },
	};
	/** What broke the frame data contract, so a count is actionable. */
	private meleeViolations: object[] = [];
	private blocksRaised = 0;
	private cancels = 0;
	private butterflyChains = 0;
	private longestChain = 0;
	private stunsTaken = 0;
	private massivesArmed = 0;
	/** Rule violations. Every one of these must end the run at zero. */
	private illegalActions = 0;
	private blockedUnblockables = 0;
	private frameDataViolations = 0;
	private stuckActionFrames = 0;
	private meleeDesyncFrames = 0;

	/** Movement-feel counters. */
	private jumps = 0;
	private wallJumps = 0;
	private airFrames = 0;
	private peakRise = 0;
	private lastGroundY = 0;
	private wasGrounded = false;

	constructor(private readonly modeLabel: () => string) {}

	get isActive(): boolean {
		return this.active;
	}

	start(durationMs: number): string {
		if (this.active) return "DIAGNOSTIC_ALREADY_RUNNING";

		this.active = true;
		this.durationMs = durationMs;
		this.frames = [];
		this.frameCount = 0;
		this.jitter = [];
		this.recon = [];
		this.penetrations = [];
		this.bulletTracks.clear();
		this.skipJitterFrames = 1;
		this.jumps = 0;
		this.wallJumps = 0;
		this.airFrames = 0;
		this.peakRise = 0;
		this.wasGrounded = false;

		this.meleeTracks.clear();
		this.moveCounts = { slash: 0, uppercut: 0, massive: 0 };
		this.outcomeCounts = { hit: 0, backstab: 0, blocked: 0, parried: 0 };
		this.outcomeByMove = {
			slash: { hit: 0, backstab: 0, blocked: 0, parried: 0 },
			uppercut: { hit: 0, backstab: 0, blocked: 0, parried: 0 },
			massive: { hit: 0, backstab: 0, blocked: 0, parried: 0 },
		};
		this.meleeViolations = [];
		this.blocksRaised = 0;
		this.cancels = 0;
		this.butterflyChains = 0;
		this.longestChain = 0;
		this.stunsTaken = 0;
		this.massivesArmed = 0;
		this.illegalActions = 0;
		this.blockedUnblockables = 0;
		this.frameDataViolations = 0;
		this.stuckActionFrames = 0;
		this.meleeDesyncFrames = 0;

		setTimeout(() => {
			const report = this.finish();
			console.log(`__DIAGNOSTIC_RESULT__${JSON.stringify(report)}__END__`);
		}, durationMs);

		return `DIAGNOSTIC_STARTED: ${durationMs}ms`;
	}

	/**
	 * Teleports (round resets) are not jitter.
	 *
	 * Suppress a short window rather than a single frame: a respawn lands over
	 * several frames as the local snap, the remote snap and the first fresh
	 * snapshot arrive, and each would otherwise be counted separately.
	 */
	markTeleport(frames = TELEPORT_SUPPRESSION_FRAMES) {
		this.skipJitterFrames = Math.max(this.skipJitterFrames, frames);
	}

	recordReconciliation(
		errorPx: number,
		replayed: number,
		meleeDiverged = false,
	) {
		if (!this.active) return;
		this.recon.push({
			frame: this.frameCount,
			errorPx: round(errorPx),
			replayed,
		});
		// The melee counterpart of a position error: the replay landed on a
		// different sword state than was predicted, which means the client drew a
		// swing the server never ran.
		if (meleeDiverged) this.meleeDesyncFrames++;
	}

	/**
	 * A sword impact the server judged.
	 *
	 * Counted from events rather than inferred from state, because the outcome —
	 * blocked, parried, backstab — exists only at the instant of resolution and
	 * is gone by the next snapshot.
	 */
	recordMeleeEvent(move: MeleeMove, outcome: MeleeOutcome) {
		if (!this.active) return;
		this.outcomeCounts[outcome]++;
		// Also keyed by move. A flat "0 blocked" is ambiguous — it reads the same
		// whether guards are failing or whether everything that connected was
		// unblockable by design, and those need opposite fixes.
		this.outcomeByMove[move][outcome]++;
		// A block that stopped an unblockable move would mean the frame data table
		// and the resolver disagree about what blocking covers.
		if (
			!MOVES[move].blockable &&
			(outcome === "blocked" || outcome === "parried")
		) {
			this.blockedUnblockables++;
		}
	}

	record(sample: DiagnosticSample) {
		if (!this.active) return;
		this.frameCount++;

		const p = sample.player;
		const penetration = penetrationDepth(p.x, p.y);

		const frame: DiagnosticFrame = {
			playerX: p.x,
			playerY: p.y,
			playerVy: p.vy,
			enemyX: sample.enemy?.x ?? 0,
			enemyY: sample.enemy?.y ?? 0,
			cameraX: sample.cameraX,
			cameraY: sample.cameraY,
			grounded: p.grounded,
			penetration,
			t: sample.t,
			dt: sample.dt,
			physicsSteps: sample.physicsSteps,
		};
		this.frames.push(frame);

		if (penetration > PENETRATION_TOLERANCE_PX) {
			this.penetrations.push({
				frame: this.frameCount,
				who: "player",
				depth: round(penetration),
				x: round(p.x),
				y: round(p.y),
			});
		}

		if (sample.enemy) {
			const enemyPen = penetrationDepth(sample.enemy.x, sample.enemy.y);
			if (enemyPen > PENETRATION_TOLERANCE_PX) {
				this.penetrations.push({
					frame: this.frameCount,
					who: "enemy",
					depth: round(enemyPen),
					x: round(sample.enemy.x),
					y: round(sample.enemy.y),
				});
			}
		}

		this.trackMovement(p);
		this.trackBullets(sample);
		this.trackMelee("local", p, sample.dt, FRAME_TOLERANCE_MS);
		if (sample.enemyState) {
			this.trackMelee(
				"remote",
				sample.enemyState,
				sample.dt,
				SNAPSHOT_TOLERANCE_MS,
			);
		}

		if (this.skipJitterFrames > 0) {
			this.skipJitterFrames--;
			this.snapshotPrev(frame);
			return;
		}

		const limitX = jitterLimitX(sample.dt);
		const limitY = jitterLimitY(sample.dt);

		this.checkJitter("player_x", frame.playerX, this.prev.px, limitX);
		this.checkJitter("player_y", frame.playerY, this.prev.py, limitY);
		if (sample.enemy) {
			this.checkJitter("enemy_x", frame.enemyX, this.prev.ex, limitX);
			this.checkJitter("enemy_y", frame.enemyY, this.prev.ey, limitY);
		}
		this.checkJitter("camera_x", frame.cameraX, this.prev.cx, DIAG_JITTER_CAM);
		this.checkJitter("camera_y", frame.cameraY, this.prev.cy, DIAG_JITTER_CAM);

		this.snapshotPrev(frame);
	}

	/**
	 * Record where each projectile was drawn.
	 *
	 * Tracks are keyed by the bullet's own id, not by draw order — the whole
	 * point is to catch a sprite being reassigned between bullets, which an
	 * index-keyed view cannot see.
	 */
	private trackBullets(sample: DiagnosticSample) {
		if (!sample.bullets) return;

		const expectedStep = BULLET_SPEED * (sample.dt / 1000);

		for (const b of sample.bullets) {
			let track = this.bulletTracks.get(b.id);
			if (!track) {
				track = {
					id: b.id,
					points: [],
					steps: [],
					stepRatios: [],
					teleports: 0,
					frozen: 0,
				};
				this.bulletTracks.set(b.id, track);
			}

			const last = track.points[track.points.length - 1];
			if (last) {
				const step = Math.hypot(b.x - last.x, b.y - last.y);
				track.steps.push(step);
				if (expectedStep > 0) {
					const ratio = step / expectedStep;
					track.stepRatios.push(ratio);
					if (ratio > BULLET_TELEPORT_RATIO) track.teleports++;
					else if (ratio < BULLET_FROZEN_RATIO) track.frozen++;
				}
			}
			track.points.push({ x: b.x, y: b.y, t: sample.t });
		}
	}

	/**
	 * Largest perpendicular distance from the straight line joining a track's
	 * endpoints. A constant-velocity projectile should be ~0; anything larger
	 * means the sprite was drawn somewhere it never flew.
	 */
	private static pathDeviation(track: BulletTrack): number {
		const pts = track.points;
		if (pts.length < 3) return 0;
		const a = pts[0];
		const b = pts[pts.length - 1];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) return 0;

		let worst = 0;
		for (let i = 1; i < pts.length - 1; i++) {
			const p = pts[i];
			const dist = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
			worst = Math.max(worst, dist);
		}
		return worst;
	}

	private summariseBullets() {
		const tracks = [...this.bulletTracks.values()].filter(
			(t) => t.points.length >= BULLET_MIN_POINTS,
		);
		if (tracks.length === 0) return undefined;

		let teleports = 0;
		let frozen = 0;
		let maxDeviation = 0;
		let maxStepRatio = 0;
		const cvs: number[] = [];
		const worst: object[] = [];

		for (const t of tracks) {
			teleports += t.teleports;
			frozen += t.frozen;

			const deviation = PhysicsDiagnostics.pathDeviation(t);
			maxDeviation = Math.max(maxDeviation, deviation);
			maxStepRatio = Math.max(maxStepRatio, ...t.stepRatios);

			// Coefficient of variation of step length: how *even* the motion is.
			// A perfectly smooth projectile is ~0; stutter pushes it up.
			const mean = t.steps.reduce((a, b) => a + b, 0) / (t.steps.length || 1);
			if (mean > 0) {
				const variance =
					t.steps.reduce((s, v) => s + (v - mean) ** 2, 0) / t.steps.length;
				cvs.push(Math.sqrt(variance) / mean);
			}

			if (
				t.teleports > 0 ||
				t.frozen > 0 ||
				deviation > BULLET_PATH_TOLERANCE_PX
			) {
				worst.push({
					id: t.id,
					frames: t.points.length,
					teleports: t.teleports,
					frozen: t.frozen,
					deviationPx: round(deviation),
					maxStepPx: round(Math.max(...t.steps)),
				});
			}
		}

		const avgCv = cvs.length ? cvs.reduce((a, b) => a + b, 0) / cvs.length : 0;

		return {
			tracked: tracks.length,
			/** Frames a projectile jumped further than physics allows. */
			teleportFrames: teleports,
			/** Frames a projectile stalled mid-flight. */
			frozenFrames: frozen,
			/** Worst bend in a supposedly straight path. */
			maxPathDeviationPx: round(maxDeviation),
			/** Worst single step, as a multiple of the expected step. */
			maxStepRatio: round(maxStepRatio),
			/** Step-length variation; 0 is perfectly even motion. */
			avgStepCv: round(avgCv, 3),
			offenders: worst.slice(0, 8),
		};
	}

	/**
	 * Watch one fighter's sword state for a frame.
	 *
	 * Everything here is derived from transitions in `PlayerPosition` rather than
	 * from hooks in the combat code, on purpose: instrumentation that shares code
	 * with the thing it measures cannot catch that thing misbehaving. A state
	 * machine that skips a phase looks fine to itself.
	 */
	private trackMelee(
		who: string,
		s: PlayerPosition,
		dtMs: number,
		toleranceMs: number,
	) {
		let t = this.meleeTracks.get(who);
		if (!t) {
			t = newMeleeTrack();
			this.meleeTracks.set(who, t);
		}
		t.sinceCancelMs += dtMs;

		const stunned = s.stunTimer > 0;
		/**
		 * Was this fighter interrupted by a hit in the recent past?
		 *
		 * Being hit cancels whatever you were doing, uncancellable or not, so an
		 * early-ended heavy move is only a contract violation if nothing hit you.
		 * Stun alone is not a wide enough tell: after reconciliation the client can
		 * observe the move already gone while the (shorter) hitstun has expired.
		 * Invulnerability lasts longer than the lightest hitstun, so it is the
		 * reliable "you were just hit" marker.
		 */
		const interrupted = stunned || s.iframeTimer > 0;

		// Nothing may act while stunned. This is the single rule that, if broken,
		// makes every combo in the game meaningless.
		if (stunned && (s.meleeAction !== "none" || s.blocking)) {
			this.illegalActions++;
		}
		if (stunned && !t.wasStunned) this.stunsTaken++;

		// A move must not outlive the duration its own table declares.
		if (s.meleeAction !== "none") {
			const total = moveDuration(s.meleeAction);
			if (s.meleeTimer > total + toleranceMs) {
				this.stuckActionFrames++;
				if (t.lastAction !== s.meleeAction) {
					this.frameDataViolations++;
					this.noteViolation({
						who,
						kind: "overran",
						move: s.meleeAction,
						timerMs: round(s.meleeTimer),
						declaredMs: total,
					});
				}
			}
		}

		// ---- move started ----
		if (s.meleeAction !== "none" && s.meleeAction !== t.lastAction) {
			this.moveCounts[s.meleeAction]++;

			// A slash landing inside the butterfly window after a cancelled one is a
			// chain: the technique working as intended.
			if (s.meleeAction === "slash" && t.sinceCancelMs <= BUTTERFLY_WINDOW_MS) {
				t.chainLength++;
				this.butterflyChains++;
				this.longestChain = Math.max(this.longestChain, t.chainLength);
			} else {
				t.chainLength = 0;
			}
		}

		// ---- move ended ----
		if (t.lastAction !== "none" && s.meleeAction !== t.lastAction) {
			const total = moveDuration(t.lastAction);
			// Ending early means something cancelled it — a block, a stance switch,
			// or being hit. Ending early on a move the table says is uncancellable
			// is a contract violation.
			if (t.lastTimer < total - toleranceMs) {
				this.cancels++;
				t.sinceCancelMs = 0;
				if (!MOVES[t.lastAction].cancellable && !interrupted) {
					this.frameDataViolations++;
					this.noteViolation({
						who,
						kind: "uncancellable_move_ended_early",
						move: t.lastAction,
						timerMs: round(t.lastTimer),
						declaredMs: total,
					});
				}
			}
		}

		if (s.blocking && !t.wasBlocking) this.blocksRaised++;
		if (s.massiveReady && !t.wasMassiveReady) this.massivesArmed++;

		t.lastAction = s.meleeAction;
		t.lastTimer = s.meleeTimer;
		t.wasBlocking = s.blocking;
		t.wasStunned = stunned;
		t.wasMassiveReady = s.massiveReady;
	}

	private noteViolation(detail: object) {
		if (this.meleeViolations.length < 12) {
			this.meleeViolations.push({ frame: this.frameCount, ...detail });
		}
	}

	private summariseMelee() {
		const moves =
			this.moveCounts.slash +
			this.moveCounts.uppercut +
			this.moveCounts.massive;

		return {
			/** Did the mechanics fire at all? Zeroes here are a failed run. */
			slashes: this.moveCounts.slash,
			uppercuts: this.moveCounts.uppercut,
			massives: this.moveCounts.massive,
			blocks: this.blocksRaised,
			massivesArmed: this.massivesArmed,
			hits: this.outcomeCounts.hit,
			backstabs: this.outcomeCounts.backstab,
			blockedHits: this.outcomeCounts.blocked,
			parries: this.outcomeCounts.parried,
			stuns: this.stunsTaken,
			/** Cancels, and how many of them chained into a butterfly. */
			cancels: this.cancels,
			butterflyChains: this.butterflyChains,
			longestButterflyChain: this.longestChain,
			totalMoves: moves,
			/** Rule violations. Every one of these must be 0. */
			illegalActions: this.illegalActions,
			blockedUnblockables: this.blockedUnblockables,
			frameDataViolations: this.frameDataViolations,
			stuckActionFrames: this.stuckActionFrames,
			meleeDesyncFrames: this.meleeDesyncFrames,
			/** What each move actually ran into. Zero blocked slashes is a defect. */
			outcomeByMove: this.outcomeByMove,
			violations: this.meleeViolations,
		};
	}

	private trackMovement(p: PlayerPosition) {
		if (p.grounded) {
			this.lastGroundY = p.y;
		} else {
			this.airFrames++;
			this.peakRise = Math.max(this.peakRise, this.lastGroundY - p.y);
		}

		// A fresh upward launch from the ground is a jump; one in mid-air off a
		// wall is a wall jump.
		if (this.wasGrounded && !p.grounded && p.vy < 0) this.jumps++;
		if (!this.wasGrounded && p.wallJumpTimer > 0 && p.vy < 0) {
			// Only count the launch frame, not every frame of the lockout.
			if (!this.wallJumpLatch) {
				this.wallJumps++;
				this.wallJumpLatch = true;
			}
		}
		if (p.wallJumpTimer <= 0) this.wallJumpLatch = false;

		this.wasGrounded = p.grounded;
	}

	private wallJumpLatch = false;

	private snapshotPrev(frame: DiagnosticFrame) {
		this.prev = {
			px: frame.playerX,
			py: frame.playerY,
			ex: frame.enemyX,
			ey: frame.enemyY,
			cx: frame.cameraX,
			cy: frame.cameraY,
		};
	}

	private checkJitter(
		type: string,
		current: number,
		previous: number,
		threshold: number,
	) {
		const delta = Math.abs(current - previous);
		if (delta <= threshold) return;
		this.jitter.push({
			frame: this.frameCount,
			type,
			delta: round(delta),
			expectedMax: threshold,
			severity: round(delta / threshold),
		});
	}

	private finish(): object {
		this.active = false;

		const frames = this.frames;
		if (frames.length === 0) return { error: "no_frames_collected" };

		const dt = stats(frames.map((f) => f.dt));
		const fps = frames.map((f) => (f.dt > 0 ? 1000 / f.dt : 0));
		const stepCounts = frames.map((f) => f.physicsSteps);
		const countSteps = (n: number) => stepCounts.filter((s) => s === n).length;

		let travel = 0;
		for (let i = 1; i < frames.length; i++) {
			travel += Math.hypot(
				frames[i].playerX - frames[i - 1].playerX,
				frames[i].playerY - frames[i - 1].playerY,
			);
		}

		const byType: Record<string, number> = {};
		for (const j of this.jitter) byType[j.type] = (byType[j.type] ?? 0) + 1;

		const reconErrors = this.recon.map((r) => r.errorPx);
		const totalFrames = frames.length;

		const bulletSummary = this.summariseBullets();
		const meleeSummary = this.summariseMelee();

		const failures: string[] = [];
		if (this.jitter.length > 0) {
			failures.push(`${this.jitter.length} jitter events`);
		}
		if (this.penetrations.length > 0) {
			failures.push(`${this.penetrations.length} collision penetrations`);
		}
		if (bulletSummary) {
			const b = bulletSummary;
			if (b.teleportFrames > 0)
				failures.push(`${b.teleportFrames} projectile jumps`);
			if (b.frozenFrames > 0)
				failures.push(`${b.frozenFrames} projectile stalls`);
			if (b.maxPathDeviationPx > BULLET_PATH_TOLERANCE_PX) {
				failures.push(`projectile path bent ${b.maxPathDeviationPx}px`);
			}
		}

		// Sword combat breaking its own rules. Each of these is a contract the
		// frame data table makes and the resolver is supposed to keep.
		const m = meleeSummary;
		if (m.illegalActions > 0) {
			failures.push(`${m.illegalActions} actions while stunned`);
		}
		if (m.blockedUnblockables > 0) {
			failures.push(`${m.blockedUnblockables} unblockables blocked`);
		}
		if (m.frameDataViolations > 0) {
			failures.push(`${m.frameDataViolations} frame data violations`);
		}
		if (m.stuckActionFrames > 0) {
			failures.push(`${m.stuckActionFrames} frames stuck in a melee action`);
		}
		if (m.meleeDesyncFrames > 0) {
			failures.push(`${m.meleeDesyncFrames} melee prediction desyncs`);
		}

		return {
			mode: this.modeLabel(),
			durationMs: this.durationMs,
			totalFrames,
			fpsStats: {
				minFps: Math.round(Math.min(...fps)),
				maxFps: Math.round(Math.max(...fps)),
				avgFps: Math.round(1000 / dt.avg),
				avgDtMs: round(dt.avg),
				dtStdDevMs: round(dt.stdDev),
			},
			physicsStepDistribution: {
				zeroStepFrames: countSteps(0),
				oneStepFrames: countSteps(1),
				twoStepFrames: countSteps(2),
				pctZeroStep: Math.round((countSteps(0) / totalFrames) * 100),
			},
			playerMovement: {
				xRange: [
					Math.round(Math.min(...frames.map((f) => f.playerX))),
					Math.round(Math.max(...frames.map((f) => f.playerX))),
				],
				yRange: [
					Math.round(Math.min(...frames.map((f) => f.playerY))),
					Math.round(Math.max(...frames.map((f) => f.playerY))),
				],
				totalTravelPx: Math.round(travel),
			},
			/** Movement feel: is the fighter actually using the arena? */
			movementSummary: {
				jumps: this.jumps,
				wallJumps: this.wallJumps,
				pctAirborne: Math.round((this.airFrames / totalFrames) * 100),
				peakRisePx: Math.round(this.peakRise),
			},
			/** Collision integrity: must be all zeroes. */
			collisionSummary: {
				penetrationFrames: this.penetrations.length,
				maxPenetrationPx: this.penetrations.reduce(
					(m, p) => Math.max(m, p.depth),
					0,
				),
			},
			penetrationEvents: this.penetrations.slice(0, 20),
			/** Projectile trajectory quality. Bullets are ballistic, so all zeroes is achievable. */
			bulletSummary,
			/**
			 * Sword combat. Read both halves: the violation counters must be zero,
			 * and the move counters must not be — a run where nobody swung satisfies
			 * every zero-target trivially and proves nothing.
			 */
			meleeSummary,
			jitterEvents: this.jitter,
			jitterSummary: {
				total: this.jitter.length,
				avgSeverity:
					this.jitter.length > 0
						? round(
								this.jitter.reduce((s, j) => s + j.severity, 0) /
									this.jitter.length,
							)
						: 0,
				maxSeverity: this.jitter.reduce((m, j) => Math.max(m, j.severity), 0),
				byType,
			},
			reconciliationSummary:
				this.recon.length > 0
					? {
							totalCorrections: this.recon.length,
							avgErrorPx: round(
								reconErrors.reduce((a, b) => a + b, 0) / reconErrors.length,
							),
							maxErrorPx: round(Math.max(...reconErrors)),
							/** Corrections big enough for a player to notice. */
							visibleCorrections: reconErrors.filter((e) => e > 1).length,
						}
					: undefined,
			verdict:
				failures.length === 0
					? "PASS: No jitter detected"
					: `FAIL: ${failures.join(", ")}`,
		};
	}
}
