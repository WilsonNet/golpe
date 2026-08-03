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
	/**
	 * World-scale field effects that fighters stand *in front of*.
	 *
	 * Exactly one thing lives here and it needs its own layer: the black hole's
	 * core is a 150px disc of pure black, and drawn in `effects` — above the
	 * actors, where every other effect belongs — it swallowed the fighters it was
	 * holding. A player could see the nameplate of somebody being torn apart and
	 * not the fighter. Behind the actors it does the opposite and better job:
	 * the caught silhouette reads against the dark.
	 *
	 * The hole's *particles* stay in `effects`, in front. Debris in front of the
	 * fighters and the void behind them is what makes a flat sprite read as depth.
	 */
	readonly field = new Container();
	/**
	 * Cast shadows, between the arena and the fighters that throw them.
	 *
	 * Its own layer for one reason: a shadow has to be *over* the platform it
	 * falls on and *under* every fighter, including the one standing on the ledge
	 * below. In `arena` it would be painted over by the next platform sprite; in
	 * `actors` it would sometimes be drawn on top of a fighter's feet.
	 */
	readonly shadows = new Container();
	readonly actors = new Container();
	readonly projectiles = new Container();
	readonly effects = new Container();
	/**
	 * Names and health bars, above everything else in the world.
	 *
	 * Inside the camera, because a plate tracks a moving fighter — but drawn last,
	 * because a label buried behind a sprite or a spark is worse than no label.
	 */
	readonly nameplates = new Container();

	private shakeMs = 0;
	private shakeDuration = 0;
	private shakeAmplitude = 0;

	constructor(root: Container) {
		this.scroll.addChild(this.shake);
		this.shake.addChild(
			this.background,
			this.arena,
			this.field,
			this.shadows,
			this.actors,
			this.projectiles,
			this.effects,
			this.nameplates,
		);
		root.addChild(this.scroll);
	}

	/**
	 * Camera scroll, in **world** pixels. Excludes shake, on purpose.
	 *
	 * Divided back out of the zoom rather than read raw off the container, so
	 * this stays the same quantity whether or not anything is zoomed. The
	 * diagnostic compares it frame to frame to spot camera jitter, and a metric
	 * whose unit changed the moment a cinematic pushed in would report the push
	 * as several hundred pixels of defect.
	 */
	get cameraX(): number {
		return -this.scroll.x / this.scroll.scale.x;
	}

	get cameraY(): number {
		return -this.scroll.y / this.scroll.scale.y;
	}

	/** How far the camera is pushed in. 1 during a match; only a replay changes it. */
	get zoom(): number {
		return this.scroll.scale.x;
	}

	/**
	 * Move the camera so the world point (x, y) is its top-left corner.
	 *
	 * Deliberate scroll, written straight to the scroll container — the same
	 * position the diagnostic reads, so the movement it reports is exactly the
	 * movement a player sees. The follow camera in `Match` clamps and paces
	 * this call so the movement never reads as jitter.
	 */
	setScroll(cameraX: number, cameraY: number) {
		this.setCamera(cameraX, cameraY, 1);
	}

	/**
	 * Scroll **and** zoom.
	 *
	 * Zoom is scale on the same container the scroll lives on, which is what
	 * keeps the two composable: the position is written in scaled units so
	 * `cameraX` still answers in world pixels, and every layer inside — arena,
	 * shadows, actors, nameplates — pushes in together instead of the world
	 * growing away from its own labels.
	 *
	 * **A match never calls this with anything but 1.** The only thing that
	 * pushes the camera in is the Play of the Game replay, which runs after the
	 * final whistle: a zoom during play would change how much arena a fighter can
	 * see, which is a competitive property and not a cosmetic one.
	 */
	setCamera(cameraX: number, cameraY: number, zoom: number) {
		this.scroll.scale.set(zoom);
		this.scroll.position.set(-cameraX * zoom, -cameraY * zoom);
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
		this.setCamera(0, 0, 1);
	}
}
