/**
 * The container tree everything is drawn into, and the camera.
 *
 * The split between `scroll` and `shake` is load-bearing rather than tidy.
 * Camera shake is the only thing that sells a heavy sword impact now that
 * hitstop is unavailable, and it moves the view every frame it is active — so
 * if the diagnostic read the same transform the shake writes to, every Massive
 * Strike would be reported as camera jitter. `scroll` is deliberate camera
 * movement and is what the diagnostic measures; `shake` is cosmetic and lives
 * below it.
 */

import { Container } from "pixi.js";

export class Stage {
	/** Deliberate camera movement. What the diagnostic reads. */
	readonly scroll = new Container();
	/** Cosmetic impact shake. Never measured. */
	readonly shake = new Container();

	/** Draw order, back to front. */
	readonly background = new Container();
	readonly arena = new Container();
	readonly actors = new Container();
	readonly projectiles = new Container();
	readonly effects = new Container();
	/** Screen-space, outside the camera, so shake never moves the HUD. */
	readonly hud = new Container();

	private shakeMs = 0;
	private shakeDuration = 0;
	private shakeAmplitude = 0;

	constructor(root: Container) {
		this.scroll.addChild(this.shake);
		this.shake.addChild(
			this.background,
			this.arena,
			this.actors,
			this.projectiles,
			this.effects,
		);
		root.addChild(this.scroll, this.hud);
	}

	/** Camera scroll, in world pixels. Excludes shake, on purpose. */
	get cameraX(): number {
		return -this.scroll.x;
	}

	get cameraY(): number {
		return -this.scroll.y;
	}

	/** Kick off an impact shake. Cosmetic only — never touches the simulation. */
	startShake(durationMs: number, amplitudePx: number) {
		// Let a bigger hit override a smaller one already running, rather than
		// queueing: two impacts in quick succession should read as one heavier
		// one, not as a long rattle.
		if (this.shakeMs > 0 && amplitudePx < this.shakeAmplitude) return;
		this.shakeMs = durationMs;
		this.shakeDuration = durationMs;
		this.shakeAmplitude = amplitudePx;
	}

	update(dtMs: number) {
		if (this.shakeMs <= 0) {
			this.shake.position.set(0, 0);
			return;
		}
		this.shakeMs = Math.max(0, this.shakeMs - dtMs);
		const falloff = this.shakeMs / this.shakeDuration;
		const a = this.shakeAmplitude * falloff;
		this.shake.position.set(
			(Math.random() * 2 - 1) * a,
			(Math.random() * 2 - 1) * a,
		);
	}

	reset() {
		this.shakeMs = 0;
		this.shake.position.set(0, 0);
		this.scroll.position.set(0, 0);
	}
}
