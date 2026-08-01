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

import {
	DEFAULT_WORLD,
	PLAYER_HEIGHT,
	penetrationDepth,
	type World,
} from "../simulation/Arena";
import {
	BULLET_SPEED,
	COMBO_CHAIN,
	isComboSlash,
	MAX_FALL_SPEED,
	MELEE_MOVES,
	type MeleeAction,
	type MeleeMove,
	type MeleeOutcome,
	MOVES,
	moveDuration,
	type PlayerPosition,
	zeroMoveCounts,
} from "../simulation/Physics";

/** A fresh outcome tally per move, built from the move list. */
function zeroOutcomesByMove(): Record<MeleeMove, Record<MeleeOutcome, number>> {
	const out = {} as Record<MeleeMove, Record<MeleeOutcome, number>>;
	for (const move of MELEE_MOVES) {
		out[move] = { hit: 0, backstab: 0, blocked: 0, parried: 0 };
	}
	return out;
}

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

/**
 * A correction this large is a respawn, not a misprediction.
 *
 * The same threshold `RenderSmoother` snaps at, and the same one `Match` uses to
 * decide a melee divergence is not the netcode's fault. It lives here because
 * *this* is the layer that has to act on it: a respawn wipes a fighter caught
 * mid-move with no stun and no invulnerability, which is indistinguishable in
 * the state from an uncancellable move ending early.
 */
export const RESPAWN_CORRECTION_PX = 100;

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

/**
 * A reconciliation that landed on a different sword state than was predicted.
 *
 * `reason` is the reconciler's own verdict on whether the client could have
 * known: `stun`, `iframe` and `massive-armed` are all facts only the server
 * holds, and `unexplained` is the one that is actually a bug.
 */
export interface MeleeReplacement {
	reason: string | null;
	detail?: object | undefined;
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
	wasKnockedDown: boolean;
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
		wasKnockedDown: false,
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
	/**
	 * Sword-state replacements the server handed down, with their reasons.
	 *
	 * Instrumentation before conclusion: an uncancellable move that ends early is
	 * a contract violation *or* a state the server replaced, and the two are
	 * indistinguishable from the local fighter's state alone.
	 */
	private meleeReplacements: (MeleeReplacement & { frame: number })[] = [];
	private pendingMeleeReplacement: MeleeReplacement | null = null;
	/**
	 * The same move and block counts, split by fighter.
	 *
	 * A flat total cannot tell "both fighters are swinging" from "one fighter is
	 * swinging and the other has been standing still for the whole run" — and the
	 * second is the shape of every training scenario, where knowing which side a
	 * move came from *is* the measurement.
	 */
	private movesByFighter: Record<string, Record<MeleeMove, number>> = {};
	private blocksByFighter: Record<string, number> = {};
	private moveCounts: Record<MeleeMove, number> = zeroMoveCounts();
	private outcomeCounts: Record<MeleeOutcome, number> = {
		hit: 0,
		backstab: 0,
		blocked: 0,
		parried: 0,
	};
	private outcomeByMove: Record<MeleeMove, Record<MeleeOutcome, number>> =
		zeroOutcomesByMove();
	/** What broke the frame data contract, so a count is actionable. */
	private meleeViolations: object[] = [];
	private blocksRaised = 0;
	private cancels = 0;
	private butterflyChains = 0;
	/** Chain continuations thrown — the second and third links of a combo. */
	private comboLinks = 0;
	/** Chains that reached the finisher. */
	private combosFinished = 0;
	private knockdowns = 0;
	private longestChain = 0;
	private stunsTaken = 0;
	private massivesArmed = 0;
	/** Rule violations. Every one of these must end the run at zero. */
	private illegalActions = 0;
	/** Links thrown with no floor underfoot. Must be zero: the chain is grounded. */
	private airborneChainLinks = 0;
	private blockedUnblockables = 0;
	private frameDataViolations = 0;
	private stuckActionFrames = 0;
	private meleeDesyncFrames = 0;

	/**
	 * Arena coverage.
	 *
	 * A fight can satisfy every correctness metric while happening inside a
	 * 118px box in the middle of an 800px arena — which is exactly what the AI
	 * did once it learned to sword-fight. Every ledge, the wall jumps, the
	 * line-of-sight cover and the whole ranged game go untested by such a run,
	 * and nothing in the report said so.
	 */
	private surfacesUsed = new Set<number>();
	private highestY = Number.POSITIVE_INFINITY;

	/** Movement-feel counters. */
	private jumps = 0;
	private wallJumps = 0;
	private airFrames = 0;
	private peakRise = 0;
	private lastGroundY = 0;
	private wasGrounded = false;

	constructor(
		private readonly modeLabel: () => string,
		/**
		 * Bandwidth and rollback quality, read at report time.
		 *
		 * A supplier rather than accumulated counters, because the netcode already
		 * keeps these and a second copy fed by a second code path is how two
		 * measurements of the same thing start disagreeing. Absent offline, where
		 * there is no wire to measure.
		 */
		private readonly netSummary: (() => object | null) | undefined = undefined,
		/**
		 * The geometry being measured. A wide room must be judged against its
		 * own bounds — `arenaSummary.xSpanPct` normalises by the world's width,
		 * which is what keeps "did the fighters actually use the arena" readable
		 * on a multi-screen map instead of always reading 100%.
		 */
		private readonly world: World = DEFAULT_WORLD,
	) {}

	get isActive(): boolean {
		return this.active;
	}

	start(durationMs: number): string {
		// An *open* run (the training room's) is superseded rather than protected:
		// it has no end time of its own, so refusing here would make
		// `__physicsDiagnostic()` permanently unusable in training mode.
		if (this.active && this.durationMs > 0) return "DIAGNOSTIC_ALREADY_RUNNING";
		this.reset(durationMs);

		setTimeout(() => {
			const report = this.finish();
			console.log(`__DIAGNOSTIC_RESULT__${JSON.stringify(report)}__END__`);
		}, durationMs);

		return `DIAGNOSTIC_STARTED: ${durationMs}ms`;
	}

	/**
	 * Start collecting with no end time, for the training room.
	 *
	 * The timed `start` answers "was this match clean?"; a training scenario is a
	 * window bounded by a `reset` at one end and a `report()` at the other, and
	 * its length is decided by the scenario rather than known in advance. Same
	 * collector, same counters, same thresholds — a second measurement stack that
	 * disagreed with this one would be worse than no second stack.
	 */
	startOpen() {
		this.reset(0);
	}

	/** The report as it stands, without stopping. */
	peek(): object {
		return this.buildReport();
	}

	private reset(durationMs: number) {
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
		this.surfacesUsed.clear();
		this.highestY = Number.POSITIVE_INFINITY;

		this.meleeTracks.clear();
		this.moveCounts = zeroMoveCounts();
		this.outcomeCounts = { hit: 0, backstab: 0, blocked: 0, parried: 0 };
		this.outcomeByMove = zeroOutcomesByMove();
		this.meleeViolations = [];
		this.meleeReplacements = [];
		this.pendingMeleeReplacement = null;
		this.blocksRaised = 0;
		this.cancels = 0;
		this.butterflyChains = 0;
		this.comboLinks = 0;
		this.combosFinished = 0;
		this.knockdowns = 0;
		this.longestChain = 0;
		this.stunsTaken = 0;
		this.massivesArmed = 0;
		this.illegalActions = 0;
		this.airborneChainLinks = 0;
		this.blockedUnblockables = 0;
		this.frameDataViolations = 0;
		this.stuckActionFrames = 0;
		this.meleeDesyncFrames = 0;
		this.movesByFighter = {};
		this.blocksByFighter = {};
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

	/**
	 * A round ended and both fighters were replaced at their spawns.
	 *
	 * Melee tracking compares each frame against the last, so a respawn breaks the
	 * comparison rather than failing it: a fighter caught mid-Massive has its
	 * state wiped with no stun and no invulnerability, which looks exactly like an
	 * uncancellable move ending 650ms early. That produced a FAIL in roughly one
	 * run in three, always on a legitimate KO.
	 *
	 * Dropping the tracks is the honest answer — after an announced discontinuity
	 * there is no continuity left to judge. It is deliberately *not* folded into
	 * `markTeleport`, which also fires on every sword impact; clearing there would
	 * reset the butterfly chain counter dozens of times a match and mask real
	 * violations.
	 */
	markRoundReset() {
		this.markTeleport();
		this.meleeTracks.clear();
	}

	recordReconciliation(
		errorPx: number,
		replayed: number,
		meleeDiverged = false,
		replacement?: MeleeReplacement,
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

		// A respawn-sized correction breaks melee continuity as thoroughly as it
		// breaks positional continuity, and the metric must not wait to be told.
		//
		// `round-reset` announces a respawn, and relying on that announcement alone
		// was the bug: it is a datagram, and the snapshot carrying the respawned
		// state races it. When the snapshot won, a fighter caught mid-Massive was
		// observed with its move gone, no stun and no invulnerability — reported as
		// an uncancellable move ending 400ms early, in roughly one canonical run in
		// five. This is the same fact derived from the correction itself, which
		// cannot be dropped or reordered.
		if (errorPx > RESPAWN_CORRECTION_PX) {
			this.markRoundReset();
			return;
		}

		// Every replacement, including the ones the reconciler legitimately
		// excuses. Snapshots arrive between frames, so this is remembered and
		// consumed by the next `record()` — which is exactly when its effect on
		// the local fighter's sword state first becomes observable.
		if (replacement) {
			this.pendingMeleeReplacement = replacement;
			this.meleeReplacements.push({
				frame: this.frameCount,
				...replacement,
			});
			if (this.meleeReplacements.length > 24) this.meleeReplacements.shift();
		}
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
		const penetration = penetrationDepth(p.x, p.y, this.world);

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
			const enemyPen = penetrationDepth(
				sample.enemy.x,
				sample.enemy.y,
				this.world,
			);
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
		// Only the local fighter's *predicted* sword state is judged here, so only it
		// can have had that state replaced by a reconciliation. Every other fighter
		// is predicted too now, but `sample.enemyState` is deliberately the
		// authoritative state rather than the prediction — see `Match.record`.
		const replacement = this.pendingMeleeReplacement;
		this.pendingMeleeReplacement = null;
		this.trackMelee("local", p, sample.dt, FRAME_TOLERANCE_MS, replacement);
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
		const a = pts[0];
		const b = pts.at(-1);
		if (pts.length < 3 || !a || !b) return 0;

		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) return 0;

		let worst = 0;
		// Endpoints define the line, so only the interior points can deviate from it.
		for (const p of pts.slice(1, -1)) {
			const dist = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
			worst = Math.max(worst, dist);
		}
		return worst;
	}

	private summariseBullets() {
		const tracks = [...this.bulletTracks.values()].filter(
			(t) => t.points.length >= BULLET_MIN_POINTS,
		);
		// Report an empty run as a loud zero, never as an absent section. Returning
		// undefined here meant "no projectile was fired at all" and "projectiles
		// were flawless" printed identically — so the entire ranged pipeline could
		// go untested by the canonical run without anything looking wrong.
		if (tracks.length === 0) {
			return {
				tracked: 0,
				teleportFrames: 0,
				frozenFrames: 0,
				maxPathDeviationPx: 0,
				maxStepRatio: 0,
				avgStepCv: 0,
				offenders: [],
			};
		}

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
		replacement: MeleeReplacement | null = null,
	) {
		let t = this.meleeTracks.get(who);
		if (!t) {
			t = newMeleeTrack();
			this.meleeTracks.set(who, t);
		}
		t.sinceCancelMs += dtMs;

		/**
		 * The observation interval, not the simulation interval.
		 *
		 * State is sampled once per *frame* while the simulation steps at 60Hz, so
		 * the last value seen before a move ends can be a whole frame stale — plus
		 * up to a tick, since the move can only end on a tick boundary. Below 60fps
		 * a frame is the longer of the two, and judging against a fixed one-tick
		 * tolerance reported perfectly legal moves as contract violations: a
		 * Massive observed ending at 700ms of its declared 720ms, purely because
		 * the run was averaging 49fps.
		 */
		const tolerance = Math.max(toleranceMs, dtMs + FRAME_TOLERANCE_MS);

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
			if (s.meleeTimer > total + tolerance) {
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
			let mine = this.movesByFighter[who];
			if (!mine) {
				mine = zeroMoveCounts();
				this.movesByFighter[who] = mine;
			}
			mine[s.meleeAction]++;

			// ---- the ground chain ----
			//
			// A link is a *continuation*: `comboStep` past 1 means this swing came out
			// of another one. Counting starts rather than hits, because a chain that
			// is never thrown and a chain that is thrown and whiffed are different
			// defects with different fixes.
			if (isComboSlash(s.meleeAction) && s.comboStep > 1) {
				this.comboLinks++;
				if (s.comboStep >= COMBO_CHAIN.length) this.combosFinished++;
				// The chain is a *ground* technique. A link thrown in the air means
				// `canChain` let go of the one rule that keeps a combo from being a
				// free three-hit string out of a jump-in.
				if (!s.grounded) {
					this.airborneChainLinks++;
					this.noteViolation({
						who,
						kind: "chained_in_the_air",
						move: s.meleeAction,
						comboStep: s.comboStep,
					});
				}
			}

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
			if (t.lastTimer < total - tolerance) {
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
						stunTimer: round(s.stunTimer),
						iframeTimer: round(s.iframeTimer),
						// The question this instrumentation exists to answer: did the
						// server replace this state, or did the state machine break its
						// own table?
						replacedThisFrame: replacement ?? null,
						recentReplacements: this.meleeReplacements.slice(-3),
					});
				}
			}
		}

		// On the floor. Counted on the rising edge, like a stun — a knockdown lasts
		// half a second, and per-frame counting would report one as thirty.
		const downed = s.knockdownTimer > 0;
		if (downed && !t.wasKnockedDown) this.knockdowns++;
		// A knockdown is a stun that also puts you down. If the two ever come apart,
		// a fighter is lying on the floor and allowed to act.
		if (downed && !stunned) this.illegalActions++;
		t.wasKnockedDown = downed;

		if (s.blocking && !t.wasBlocking) {
			this.blocksRaised++;
			this.blocksByFighter[who] = (this.blocksByFighter[who] ?? 0) + 1;
		}
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
		const moves = MELEE_MOVES.reduce((n, move) => n + this.moveCounts[move], 0);

		return {
			/** Did the mechanics fire at all? Zeroes here are a failed run. */
			slashes: this.moveCounts.slash,
			/**
			 * The ground chain. `comboLinks: 0` alongside a healthy `slashes` count
			 * means every combo is being dropped at the first swing — which is what
			 * a link window that is too tight and a chain that never becomes
			 * available both look like from the outside.
			 */
			comboLinks: this.comboLinks,
			combosFinished: this.combosFinished,
			knockdowns: this.knockdowns,
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
			airborneChainLinks: this.airborneChainLinks,
			blockedUnblockables: this.blockedUnblockables,
			frameDataViolations: this.frameDataViolations,
			stuckActionFrames: this.stuckActionFrames,
			meleeDesyncFrames: this.meleeDesyncFrames,
			/** What each move actually ran into. Zero blocked slashes is a defect. */
			outcomeByMove: this.outcomeByMove,
			/** Sword states the server replaced, and whether the client could have known. */
			meleeReplacements: this.meleeReplacements,
			/** Who did what: "local" is the fighter this client is predicting. */
			movesByFighter: this.movesByFighter,
			blocksByFighter: this.blocksByFighter,
			violations: this.meleeViolations,
		};
	}

	private trackMovement(p: PlayerPosition) {
		this.highestY = Math.min(this.highestY, p.y);
		if (p.grounded) {
			// Which surface is underfoot: the body's feet rest on a platform's top.
			this.world.platforms.forEach((plat, i) => {
				const onTop = Math.abs(p.y + PLAYER_HEIGHT - plat.y) < 2;
				const withinSpan =
					p.x + PLAYER_HEIGHT > plat.x && p.x < plat.x + plat.w;
				if (onTop && withinSpan) this.surfacesUsed.add(i);
			});
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
		return this.buildReport();
	}

	private buildReport(): object {
		const frames = this.frames;
		if (frames.length === 0) return { error: "no_frames_collected" };

		const dt = stats(frames.map((f) => f.dt));
		const fps = frames.map((f) => (f.dt > 0 ? 1000 / f.dt : 0));
		const stepCounts = frames.map((f) => f.physicsSteps);
		const countSteps = (n: number) => stepCounts.filter((s) => s === n).length;

		let travel = 0;
		let previous: DiagnosticFrame | undefined;
		for (const f of frames) {
			if (previous) {
				travel += Math.hypot(
					f.playerX - previous.playerX,
					f.playerY - previous.playerY,
				);
			}
			previous = f;
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
		if (m.airborneChainLinks > 0) {
			failures.push(`${m.airborneChainLinks} combo links thrown airborne`);
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
			/**
			 * How much of the arena the fight actually touched.
			 *
			 * Correctness metrics say whether what happened was legal; these say
			 * whether enough happened to be worth trusting. A duel confined to a
			 * narrow band in the middle never tests the ledges, the wall jumps, the
			 * line-of-sight cover or the ranged game.
			 */
			arenaSummary: {
				xSpanPct: Math.round(
					((Math.max(...frames.map((f) => f.playerX)) -
						Math.min(...frames.map((f) => f.playerX))) /
						this.world.right) *
						100,
				),
				ySpanPct: Math.round(
					((Math.max(...frames.map((f) => f.playerY)) -
						Math.min(...frames.map((f) => f.playerY))) /
						this.world.bottom) *
						100,
				),
				/** Distinct platforms stood on, out of every solid in the arena. */
				surfacesUsed: this.surfacesUsed.size,
				surfacesAvailable: this.world.platforms.length,
				highestY: Math.round(this.highestY),
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
			/**
			 * The wire, and how well remote fighters are predicted.
			 *
			 * Rollback trades a fixed visual delay for occasional misprediction, and
			 * the only way to know that trade came out ahead is to measure how often
			 * it mispredicts and by how much. `snapshots: 0` means nothing arrived and
			 * every number above describes a client simulating alone.
			 */
			netSummary: this.netSummary?.() ?? undefined,
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
