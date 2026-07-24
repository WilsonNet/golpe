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

	recordReconciliation(errorPx: number, replayed: number) {
		if (!this.active) return;
		this.recon.push({
			frame: this.frameCount,
			errorPx: round(errorPx),
			replayed,
		});
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
