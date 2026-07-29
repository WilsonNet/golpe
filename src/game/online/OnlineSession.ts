import type { Container, Sprite, Texture } from "pixi.js";
import type { BulletSample } from "../diagnostics/PhysicsDiagnostics";
import { SpritePool } from "../render/SpritePool";
import { pointInAnyPlatform } from "../simulation/Arena";
import { resolveOverlap } from "../simulation/Collision";
import {
	isBulletOutOfBounds,
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerIntent,
	type PlayerPosition,
} from "../simulation/Physics";
import type { TrainingConfigMsg, TrainingStateMsg } from "../training/types";
import { friLerp, RemoteInterpolator, ServerClock } from "./Interpolation";
import { OnlineManager } from "./OnlineManager";
import {
	PredictedPlayer,
	type ReconcileResult,
	RenderSmoother,
} from "./Prediction";
import type { GameSnapshot, MeleeEventMsg, SnapshotBullet } from "./types";

/** Beyond this, a remote position change is a teleport, not movement. */
const REMOTE_SNAP_PX = 100;

/** Cap on ballistic extrapolation, so a bad clock estimate cannot fling a bullet. */
const MAX_EXTRAPOLATION_MS = 250;

export interface OnlineCallbacks {
	onStatus: (msg: string) => void;
	onLocalHp: (hp: number) => void;
	onRemoteHp: (hp: number) => void;
	/** Reconciliation result, for the diagnostic. */
	onReconcile: (
		errorPx: number,
		replayed: number,
		meleeDiverged: boolean,
		divergence?: ReconcileResult["meleeDivergence"],
	) => void;
	/** A discontinuity that is expected — so it is not counted as jitter. */
	onTeleport: () => void;
	/** The server respawned both fighters: all continuity is legitimately broken. */
	onRoundReset: () => void;
	/** A sword impact the server judged, for effects only. */
	onMeleeEvent: (event: MeleeEventMsg) => void;
}

/**
 * Owns everything networked: the channel, the predicted local player, the
 * interpolated remote player, and server-owned bullets.
 *
 * The scene talks to this in terms of intent, not packets.
 */
export class OnlineSession {
	readonly manager: OnlineManager;
	readonly predicted: PredictedPlayer;

	private readonly remote = new RemoteInterpolator();
	private readonly clock = new ServerClock();
	private readonly smoother = new RenderSmoother();
	private readonly bulletPool: SpritePool;
	/** Ballistic anchor per bullet: position and velocity at a known local time. */
	private readonly bulletFlights = new Map<
		number,
		{ x0: number; y0: number; vx: number; vy: number; t0: number }
	>();
	/** Bullets already known to have hit geometry; never drawn again. */
	private readonly bulletDead = new Set<number>();
	/** Bullet id -> sprite, so a sprite never changes which bullet it represents. */
	private readonly bulletSprites = new Map<number, Sprite>();
	/** Where projectiles were drawn this frame, for the diagnostic. */
	private readonly renderedBullets: BulletSample[] = [];

	private remoteBody: { x: number; y: number } | undefined;
	private latestSnapshot: GameSnapshot | undefined;
	/** The remote fighter's authoritative simulation state, position aside. */
	private remoteAuthoritative: PlayerPosition | undefined;

	private _localHp = 100;
	private _remoteHp = 100;
	private _remoteFacing = 1;
	private _matched = false;

	constructor(
		layer: Container,
		bulletTexture: Texture,
		private readonly startX: number,
		private readonly startY: number,
		private readonly callbacks: OnlineCallbacks,
	) {
		this.predicted = new PredictedPlayer(startX, startY);
		this.bulletPool = new SpritePool(layer, bulletTexture);
		this.manager = new OnlineManager(
			`${location.protocol}//${location.hostname}`,
			9208,
		);
	}

	get connected(): boolean {
		return this.manager.connected;
	}

	get matched(): boolean {
		return this._matched;
	}

	get localHp(): number {
		return this._localHp;
	}

	get remoteHp(): number {
		return this._remoteHp;
	}

	get remoteFacing(): number {
		return this._remoteFacing;
	}

	/**
	 * Remote fighter position in *body* space (AABB top-left), matching what
	 * the simulation uses. Reading it off the sprite instead would be in
	 * centre-origin space and silently off by half a body.
	 */
	get remotePosition(): { x: number; y: number } | null {
		return this.remoteBody ? { ...this.remoteBody } : null;
	}

	/**
	 * The remote fighter's full state: combat straight from the snapshot,
	 * position from the interpolator.
	 *
	 * The two halves come from different clocks on purpose. Position must be
	 * interpolated or the remote stutters between 20Hz updates; sword state must
	 * not be, because a swing rendered 150ms late is a swing you cannot react to,
	 * and reacting is the entire game. Combat state is discrete and cheap to be
	 * slightly early with — position is not.
	 */
	get remoteState(): PlayerPosition | null {
		if (!this.remoteAuthoritative) return null;
		if (!this.remoteBody) return this.remoteAuthoritative;
		return {
			...this.remoteAuthoritative,
			x: this.remoteBody.x,
			y: this.remoteBody.y,
		};
	}

	connect(solo = false, training = false) {
		this.manager.connect(
			(snap) => this.onSnapshot(snap),
			(msg) => this.callbacks.onStatus(msg),
			() => this.onRoundReset(),
			solo,
			training,
		);
	}

	/**
	 * The training room's two extra messages, passed straight through.
	 *
	 * Deliberately thin: the training room is not netcode, it is a client of it,
	 * so this class gains a pipe rather than a mode.
	 */
	onTrainingState(handler: (state: TrainingStateMsg) => void) {
		this.manager.onTraining(handler);
	}

	sendTrainingConfig(msg: TrainingConfigMsg) {
		this.manager.sendTrainingConfig(msg);
	}

	/**
	 * The server has respawned both fighters. Drop all interpolation history —
	 * blending across a respawn would draw the remote sliding through the arena
	 * instead of reappearing at its start position.
	 */
	private onRoundReset() {
		this.remote.reset();
		this.smoother.reset();
		this.bulletPool.releaseAll();
		this.bulletSprites.clear();
		this.bulletFlights.clear();
		this.bulletDead.clear();
		this.remoteBody = undefined;
		this.remoteAuthoritative = undefined;
		this.callbacks.onRoundReset();
		console.log("[ONLINE] round reset");
	}

	disconnect() {
		this.manager.disconnect();
	}

	/**
	 * Advance one fixed physics step: predict locally and ship the input.
	 * Called once per PHYSICS_DT so the client and server consume input at the
	 * same rate.
	 */
	fixedStep(intent: PlayerIntent, aimAngle: number, dt: number) {
		const seq = this.predicted.step(intent, dt);
		// Spread the intent rather than listing its fields: `PlayerInput` extends
		// `PlayerIntent` precisely so a field added to the simulation cannot be
		// silently left out of the packet, which would make the server replay a
		// different input than the client predicted.
		this.manager.sendInput({ ...intent, seq, aimAngle });
	}

	/** Per-frame presentation update: remote interpolation and bullets. */
	render(dtSec: number): { x: number; y: number } {
		const serverNow = this.clock.now(Date.now());

		const remotePos = this.remote.sample(serverNow);
		if (remotePos) {
			// Ease toward the sampled point rather than assigning it. When the
			// snapshot buffer runs dry the sampler clamps to its newest sample,
			// which as a hard assignment reads as a teleport.
			//
			// A genuine teleport (round respawn) must still snap: easing across
			// 600px turns one honest jump into a long smear of fake motion.
			const jumped =
				this.remoteBody &&
				Math.hypot(
					remotePos.x - this.remoteBody.x,
					remotePos.y - this.remoteBody.y,
				) > REMOTE_SNAP_PX;

			if (!this.remoteBody || jumped) {
				if (jumped) {
					this.remote.reset();
					this.callbacks.onTeleport();
				}
				this.remoteBody = { ...remotePos };
			} else {
				this.remoteBody.x = friLerp(this.remoteBody.x, remotePos.x, 0.5, dtSec);
				this.remoteBody.y = friLerp(this.remoteBody.y, remotePos.y, 0.5, dtSec);
			}

			// An interpolated path is not simulated, so it can clip a corner that
			// neither endpoint touches. Push it back out before drawing.
			const box = {
				x: this.remoteBody.x,
				y: this.remoteBody.y,
				w: PLAYER_WIDTH,
				h: PLAYER_HEIGHT,
			};
			if (resolveOverlap(box)) {
				this.remoteBody.x = box.x;
				this.remoteBody.y = box.y;
			}
		}

		this.renderBullets(serverNow);

		return this.smoother.apply(
			this.predicted.state.x,
			this.predicted.state.y,
			dtSec,
		);
	}

	/**
	 * Draw projectiles by dead reckoning, not interpolation.
	 *
	 * A bullet flies at a constant velocity with no gravity and no collision
	 * response, so its position is a closed-form function of time: extrapolating
	 * from the last snapshot is *exact*, and it renders the bullet at the
	 * present instant instead of 150ms in the past. Interpolating them was
	 * strictly worse — it added latency to something that needs to feel sharp,
	 * and mixing an interpolated sample (rendered at now-150ms) with a
	 * dead-reckoned fallback (rendered at now) made the sprite jump ~90px
	 * whenever a bullet crossed from one path to the other.
	 *
	 * Sprites are keyed by bullet id. Indexing by position in the snapshot array
	 * meant a sprite jumped to a completely different bullet every time the
	 * server spliced a dead one out.
	 */
	private renderBullets(serverNow: number) {
		const snap = this.latestSnapshot;
		if (!snap) return;

		this.renderedBullets.length = 0;
		const live = new Set<number>();
		const now = performance.now();

		for (const b of snap.bullets) {
			live.add(b.id);
			if (this.bulletDead.has(b.id)) continue;

			// Anchor once, on first sight, then fly the bullet purely off the local
			// clock. Re-deriving the position from the newest snapshot every frame
			// looks correct but is not: each arriving snapshot moves the
			// extrapolation base, so any error in the clock estimate shows up as a
			// sawtooth — a small jump forward every 50ms and a stall in between.
			let flight = this.bulletFlights.get(b.id);
			if (!flight) {
				const ageSec =
					Math.min(Math.max(serverNow - snap.t, 0), MAX_EXTRAPOLATION_MS) /
					1000;
				flight = {
					x0: b.x + b.vx * ageSec,
					y0: b.y + b.vy * ageSec,
					vx: b.vx,
					vy: b.vy,
					t0: now,
				};
				this.bulletFlights.set(b.id, flight);
			}

			const t = (now - flight.t0) / 1000;
			const x = flight.x0 + flight.vx * t;
			const y = flight.y0 + flight.vy * t;

			// The server has almost certainly already destroyed a bullet that has
			// reached geometry; retire it now rather than flying it through a wall
			// for the rest of the snapshot interval. This is permanent: letting it
			// reappear past the platform made the sprite blink and jump.
			if (pointInAnyPlatform(x, y) || isBulletOutOfBounds({ ...b, x, y })) {
				this.bulletDead.add(b.id);
				const stale = this.bulletSprites.get(b.id);
				if (stale) {
					this.bulletPool.release(stale);
					this.bulletSprites.delete(b.id);
				}
				continue;
			}

			let sprite = this.bulletSprites.get(b.id);
			if (!sprite) {
				sprite = this.bulletPool.acquire();
				this.bulletSprites.set(b.id, sprite);
			}
			sprite.position.set(x, y);
			this.renderedBullets.push({ id: b.id, x, y });
		}

		for (const [id, sprite] of this.bulletSprites) {
			if (live.has(id)) continue;
			this.bulletPool.release(sprite);
			this.bulletSprites.delete(id);
		}
		for (const id of this.bulletFlights.keys()) {
			if (!live.has(id)) this.bulletFlights.delete(id);
		}
		for (const id of this.bulletDead) {
			if (!live.has(id)) this.bulletDead.delete(id);
		}
	}

	private onSnapshot(snap: GameSnapshot) {
		this.latestSnapshot = snap;
		this.clock.observe(snap.t, Date.now());

		for (const p of snap.players) {
			if (p.id === this.manager.myId) {
				this._localHp = p.hp;
				this.callbacks.onLocalHp(p.hp);

				const before = { x: this.predicted.state.x, y: this.predicted.state.y };
				const result = this.predicted.reconcile(p.state, p.lastSeq, 1 / 60);
				this.smoother.absorb(
					this.predicted.state.x - before.x,
					this.predicted.state.y - before.y,
				);
				this.callbacks.onReconcile(
					result.errorPx,
					result.replayed,
					result.meleeDiverged,
				);
			} else {
				this._remoteHp = p.hp;
				this._remoteFacing = p.facingDir;
				this.remoteAuthoritative = p.state;
				this.callbacks.onRemoteHp(p.hp);
				this.remote.push(snap.t, p.state.x, p.state.y);
			}
		}

		// Sword impacts are one-shot effects. A dropped datagram costs a spark,
		// never a consequence — those all travel in `state`.
		for (const event of snap.melee ?? []) {
			this.callbacks.onMeleeEvent(event);
		}

		if (!this._matched && snap.players.length >= 2) {
			this._matched = true;
			this.callbacks.onStatus("");
		}
	}

	/** Projectiles as drawn this frame, for the diagnostic. */
	get bullets(): readonly BulletSample[] {
		return this.renderedBullets;
	}

	/**
	 * The server's bullets with their velocities, for the aim probe.
	 *
	 * Read from the raw snapshot rather than `renderedBullets`, because the
	 * heading is authoritative: it is fixed at spawn from the aim angle the client
	 * sent, and it is the only way to check that a shot actually left in the
	 * direction the cursor was pointing.
	 */
	get bulletVectors(): readonly SnapshotBullet[] {
		return this.latestSnapshot?.bullets ?? [];
	}

	/**
	 * Drawing the remote fighter is not this class's job.
	 *
	 * It owns netcode state; the entity world owns what is on screen. The remote
	 * is an ordinary entity whose `body` is re-pointed at `remoteState` each
	 * frame, so the same animation, sprite-sync and effect systems that draw the
	 * local fighter draw it too — with no second code path to keep in step.
	 */

	/** Full local reset, e.g. after a round ends. */
	reset() {
		this.predicted.reset(this.startX, this.startY);
		this.remote.reset();
		this.smoother.reset();
		this.bulletPool.releaseAll();
	}
}
