import type Phaser from "phaser";
import { syncSpriteToBody } from "../render/ArenaRenderer";
import { SpritePool } from "../render/SpritePool";
import { resolveOverlap } from "../simulation/Collision";
import {
	PLAYER_HEIGHT,
	PLAYER_WIDTH,
	type PlayerIntent,
} from "../simulation/Physics";
import { friLerp, RemoteInterpolator, ServerClock } from "./Interpolation";
import { OnlineManager } from "./OnlineManager";
import { PredictedPlayer, RenderSmoother } from "./Prediction";
import type { GameSnapshot } from "./types";

/** Beyond this, a remote position change is a teleport, not movement. */
const REMOTE_SNAP_PX = 100;

export interface OnlineCallbacks {
	onStatus: (msg: string) => void;
	onLocalHp: (hp: number) => void;
	onRemoteHp: (hp: number) => void;
	/** Reconciliation result, for the diagnostic. */
	onReconcile: (errorPx: number, replayed: number) => void;
	/** A discontinuity that is expected — respawns — so it is not counted as jitter. */
	onTeleport: () => void;
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
	private readonly bulletInterp = new Map<number, RemoteInterpolator>();

	private remoteSprite?: Phaser.GameObjects.Sprite;
	private remoteBody?: { x: number; y: number };
	private latestSnapshot?: GameSnapshot;

	private _localHp = 100;
	private _remoteHp = 100;
	private _remoteFacing = 1;
	private _matched = false;

	constructor(
		private readonly scene: Phaser.Scene,
		private readonly startX: number,
		private readonly startY: number,
		private readonly callbacks: OnlineCallbacks,
	) {
		this.predicted = new PredictedPlayer(startX, startY);
		this.bulletPool = new SpritePool(scene, "fireball");
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

	connect() {
		this.manager.connect(
			(snap) => this.onSnapshot(snap),
			(msg) => this.callbacks.onStatus(msg),
			() => this.onRoundReset(),
		);
	}

	/**
	 * The server has respawned both fighters. Drop all interpolation history —
	 * blending across a respawn would draw the remote sliding through the arena
	 * instead of reappearing at its start position.
	 */
	private onRoundReset() {
		this.remote.reset();
		this.smoother.reset();
		this.bulletInterp.clear();
		this.bulletPool.releaseAll();
		this.remoteBody = undefined;
		this.callbacks.onTeleport();
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
	fixedStep(
		intent: PlayerIntent,
		attack: boolean,
		aimAngle: number,
		dt: number,
	) {
		const seq = this.predicted.step(intent, dt);
		this.manager.sendInput({
			seq,
			left: intent.left,
			right: intent.right,
			up: intent.up,
			attack,
			aimAngle,
		});
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

			if (!this.remoteSprite) {
				this.remoteSprite = this.scene.add.sprite(0, 0, "dude");
				this.remoteSprite.setOrigin(0.5);
			}
			syncSpriteToBody(this.remoteSprite, this.remoteBody.x, this.remoteBody.y);
		}

		this.renderBullets(serverNow);

		return this.smoother.apply(
			this.predicted.state.x,
			this.predicted.state.y,
			dtSec,
		);
	}

	private renderBullets(serverNow: number) {
		const snap = this.latestSnapshot;
		if (!snap) return;

		const sprites = this.bulletPool.take(snap.bullets.length);
		snap.bullets.forEach((b, i) => {
			const interp = this.bulletInterp.get(b.id);
			const pos = interp?.sample(serverNow);
			// Interpolating between snapshots beats snapping every 50ms; before a
			// bullet has two samples, dead-reckon from its velocity instead.
			if (pos) {
				sprites[i].setPosition(pos.x, pos.y);
			} else {
				const ageSec = Math.max(0, serverNow - snap.t) / 1000;
				sprites[i].setPosition(b.x + b.vx * ageSec, b.y + b.vy * ageSec);
			}
		});
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
				this.callbacks.onReconcile(result.errorPx, result.replayed);
			} else {
				this._remoteHp = p.hp;
				this._remoteFacing = p.facingDir;
				this.callbacks.onRemoteHp(p.hp);
				this.remote.push(snap.t, p.state.x, p.state.y);
			}
		}

		if (!this._matched && snap.players.length >= 2) {
			this._matched = true;
			this.callbacks.onStatus("");
		}

		this.syncBulletInterpolators(snap);
	}

	private syncBulletInterpolators(snap: GameSnapshot) {
		const live = new Set<number>();
		for (const b of snap.bullets) {
			live.add(b.id);
			let interp = this.bulletInterp.get(b.id);
			if (!interp) {
				interp = new RemoteInterpolator();
				this.bulletInterp.set(b.id, interp);
			}
			interp.push(snap.t, b.x, b.y);
		}
		for (const id of this.bulletInterp.keys()) {
			if (!live.has(id)) this.bulletInterp.delete(id);
		}
	}

	/** Alpha for a fighter sprite — dead fighters fade out. */
	applyDeathAlpha(localSprite: Phaser.GameObjects.Sprite) {
		localSprite.setAlpha(this._localHp <= 0 ? 0.3 : 1);
		this.remoteSprite?.setAlpha(this._remoteHp <= 0 ? 0.3 : 1);
	}

	playRemoteAnim() {
		if (!this.remoteSprite) return;
		const key = this._remoteFacing < 0 ? "left" : "right";
		if (this.remoteSprite.anims.currentAnim?.key !== key) {
			this.remoteSprite.anims.play(key, true);
		}
	}

	/** Full local reset, e.g. after a round ends. */
	reset() {
		this.predicted.reset(this.startX, this.startY);
		this.remote.reset();
		this.smoother.reset();
		this.bulletInterp.clear();
		this.bulletPool.releaseAll();
	}
}
