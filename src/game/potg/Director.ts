/**
 * The camera edit: what a Play of the Game looks like, as a function of time.
 *
 * The footage is the easy half. A replay that simply re-ran the recording with
 * the ordinary follow camera would answer "what happened" and nothing else —
 * you would be watching a fight you had just watched, from the same distance,
 * with no idea which of the sixteen fighters on screen the ceremony was about.
 * Overwatch's version works because the camera *tells you who to look at* before
 * anything happens, which is what the pre-roll here is for.
 *
 * Five movements:
 *
 * 1. **Establish** — wide and slightly off the protagonist, drifting toward
 *    them, footage crawling. The title card is over this. It is the only moment
 *    in the sequence where the whole arena is legible.
 * 2. **Push** — a hard push in to a tight framing, the name card sliding under
 *    it. This is the sentence "it was *this* one".
 * 3. **Whip** — a fast pan that overshoots them and swings back, easing out of
 *    the tight framing. It costs 700ms and buys the thing a straight cut cannot:
 *    the feeling that a camera operator is following a person.
 * 4. **Roll** — the play itself, at speed, camera leading the fighter's
 *    movement, dropping into slow motion and punching the zoom on every scoring
 *    beat the server recorded.
 * 5. **Outro** — the last frame held, pulled back out, cards returned.
 *
 * **This file is pure.** It owns no Pixi object, reads no clock and draws
 * nothing: it is fed a delta and a way to ask where the protagonist was at a
 * given moment of footage, and it answers with a shot. That is what makes the
 * edit testable — `Director.test.ts` runs the whole sequence in milliseconds
 * and asserts the movements happen in order — and it is why the replay's
 * plumbing (`Replay.ts`) has no timing logic of its own to disagree with.
 */

import type { PotgClip } from "./types";

export type PotgPhase =
	| "establish"
	| "push"
	| "whip"
	| "roll"
	| "outro"
	| "done";

/** One frame of the edit: where the camera is, and what the overlay should show. */
export interface PotgShot {
	phase: PotgPhase;
	/** Where in the footage to sample, in ms. */
	clipMs: number;
	/** Camera focus, in world pixels — the point the view is centred on. */
	focusX: number;
	focusY: number;
	zoom: number;
	/** How far the letterbox bars are extended, 0..1. */
	letterbox: number;
	/** Opacity of the big "PLAY OF THE GAME" title, 0..1. */
	title: number;
	/** Opacity of the protagonist's name card, 0..1. */
	card: number;
	/** Impact shake to request this frame, in pixels. Zero most frames. */
	shake: number;
	/** How fast the footage is running. 1 is real time; 0 is a held frame. */
	rate: number;
	/** How much of the whole sequence has played, 0..1, for a progress bar. */
	progress: number;
}

// ---------------------------------------------------------------------------
// The movements
// ---------------------------------------------------------------------------

const ESTABLISH_MS = 1200;
const PUSH_MS = 1000;
const WHIP_MS = 700;
const OUTRO_MS = 1800;
/** Everything before the play itself. Named because the probe asserts on it. */
export const POTG_PREROLL_MS = ESTABLISH_MS + PUSH_MS + WHIP_MS;

/** Wide enough that a fighter reads as a figure in a place rather than a portrait. */
const ESTABLISH_ZOOM = 0.82;
/** The tight framing the push arrives at. Deliberately closer than anything else. */
const PUSH_ZOOM = 1.8;
/** What the roll settles at: close enough to follow, wide enough to see a sword. */
const ROLL_ZOOM = 1.15;
/** Where the outro pulls back to. */
const OUTRO_ZOOM = 0.95;

/** How far the establish shot starts off the protagonist, in world px. */
const ESTABLISH_OFFSET_X = 170;
const ESTABLISH_OFFSET_Y = -70;
/** How far the whip pan overshoots before swinging back. */
const WHIP_OVERSHOOT_PX = 150;

/** Footage speed while the camera is doing its own work, before the play. */
const PREROLL_RATE = 0.35;
/** Footage speed at a scoring beat. */
const BEAT_RATE = 0.32;
/** How far either side of a beat the slow motion reaches, in footage ms. */
const BEAT_WINDOW_MS = 420;
/** Extra zoom punched in at a beat, decaying over `BEAT_PUNCH_MS`. */
const BEAT_PUNCH_ZOOM = 0.28;
const BEAT_PUNCH_MS = 520;
/** Shake at the instant of a beat, in pixels. */
const BEAT_SHAKE_PX = 9;

/** How far ahead of a moving fighter the roll camera looks, per px/s of velocity. */
const LEAD_PER_VELOCITY = 0.22;
const LEAD_MAX_PX = 110;

/** Letterbox bars slide in over this, and back out over the same at the end. */
const BARS_MS = 400;

/**
 * How much of the frame each letterbox bar covers when fully extended.
 *
 * **Shared with the stylesheet and with the replay's camera clamp**, and it has
 * to be: the bars are opaque and they cover *arena*. The camera is allowed to
 * pan this far past the top and bottom of the world precisely because the bars
 * are what is drawn there — which is what puts the floor line exactly on the top
 * edge of the bottom bar instead of hiding the ground everybody is standing on.
 * Three copies of this number would have been three chances to hide the floor.
 */
export const POTG_BAR_FRACTION = 0.08;

/** How fast the camera catches up to its target, per second. Below 1 is a glide. */
const FOCUS_SMOOTHING = 9;

/** Fraction of the push over which the title leaves, and after which the card arrives. */
const TITLE_OUT_FRACTION = 0.5;
const CARD_IN_FRACTION = 0.45;

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * clamp(t, 0, 1);
}

/** Ease-out cubic — the shape of a camera arriving somewhere on purpose. */
function easeOut(t: number): number {
	const u = 1 - clamp(t, 0, 1);
	return 1 - u * u * u;
}

/** Ease-in-out, for the push: a camera that starts and stops with weight. */
function easeInOut(t: number): number {
	const u = clamp(t, 0, 1);
	return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/** Where the protagonist is, and how fast, at a given moment of footage. */
export interface Subject {
	x: number;
	y: number;
	vx: number;
}

export class PotgDirector {
	/** ms of *footage* played so far. Advances at `rate`, so never wall time. */
	private clipMs = 0;
	/** ms of wall clock spent in the current movement. */
	private phaseMs = 0;
	private phase: PotgPhase = "establish";
	/** Where the camera actually is, as opposed to where it is being asked to go. */
	private camX = 0;
	private camY = 0;
	private camReady = false;
	/** Beats already fired, so a punch happens once and not once per frame. */
	private firedBeats = 0;
	/** ms since the last beat's punch, for its decay. */
	private punchMs = Number.POSITIVE_INFINITY;
	private elapsedMs = 0;

	constructor(
		private readonly clip: PotgClip,
		/** Where the protagonist was at a moment of footage. */
		private readonly subjectAt: (clipMs: number) => Subject,
	) {}

	get done(): boolean {
		return this.phase === "done";
	}

	/**
	 * Advance the edit by one rendered frame and say what to draw.
	 *
	 * The footage cursor is advanced by `dtMs * rate` rather than by wall time,
	 * which is what makes slow motion free: everything downstream samples at
	 * `clipMs` and has no idea the clock is being bent underneath it.
	 */
	step(dtMs: number): PotgShot {
		this.elapsedMs += dtMs;
		this.clipMs = Math.min(
			this.clip.durationMs,
			this.clipMs + dtMs * this.rateNow(),
		);
		this.phaseMs += dtMs;
		this.punchMs += dtMs;

		this.advancePhase();
		// Reported *after* the phase advances, so the shot says what is running now
		// rather than what ran to get here. Read the other way round, the frame that
		// entered the outro claimed the footage was still playing at full speed on
		// the very frame it was frozen.
		const rate = this.rateNow();

		const subject = this.subjectAt(this.clipMs);
		const target = this.targetFor(subject);
		// The camera glides to its target rather than being teleported onto it, for
		// the same reason the follow camera in a live match is capped: a hard cut to
		// a moving point reads as a glitch, and a whip pan is only a whip pan if the
		// camera has weight to overshoot with.
		if (!this.camReady) {
			this.camX = target.x;
			this.camY = target.y;
			this.camReady = true;
		} else {
			const t = clamp((FOCUS_SMOOTHING * dtMs) / 1000, 0, 1);
			this.camX = lerp(this.camX, target.x, t);
			this.camY = lerp(this.camY, target.y, t);
		}

		const shake = this.consumeBeatShake();

		return {
			phase: this.phase,
			clipMs: this.clipMs,
			focusX: this.camX,
			focusY: this.camY,
			zoom: target.zoom,
			letterbox: this.letterbox(),
			title: this.titleAlpha(),
			card: this.cardAlpha(),
			shake,
			rate,
			progress: clamp(this.clipMs / Math.max(1, this.clip.durationMs), 0, 1),
		};
	}

	/** Cut to the end. What the skip button does. */
	skip() {
		this.phase = "done";
	}

	// -----------------------------------------------------------------------

	private advancePhase() {
		switch (this.phase) {
			case "establish":
				if (this.phaseMs >= ESTABLISH_MS) this.enter("push");
				return;
			case "push":
				if (this.phaseMs >= PUSH_MS) this.enter("whip");
				return;
			case "whip":
				if (this.phaseMs >= WHIP_MS) this.enter("roll");
				return;
			case "roll":
				// The roll ends when the footage does, never on a timer: the clip's
				// length is the play's length, and a timer would cut a long one short
				// and hold a still frame at the end of a short one.
				if (this.clipMs >= this.clip.durationMs) this.enter("outro");
				return;
			case "outro":
				if (this.phaseMs >= OUTRO_MS) this.enter("done");
				return;
			case "done":
				return;
		}
	}

	private enter(phase: PotgPhase) {
		this.phase = phase;
		this.phaseMs = 0;
	}

	/** How fast the footage should run right now. */
	private rateNow(): number {
		if (this.phase === "outro" || this.phase === "done") return 0;
		if (this.phase !== "roll") return PREROLL_RATE;

		// Slow motion around every scoring beat, ramping in and out rather than
		// switching: a hard cut to 0.32x reads as a dropped frame, and the ramp is
		// what makes it read as emphasis.
		let nearest = Number.POSITIVE_INFINITY;
		for (const beat of this.clip.beats) {
			nearest = Math.min(nearest, Math.abs(beat.t - this.clipMs));
		}
		if (nearest >= BEAT_WINDOW_MS) return 1;
		return lerp(BEAT_RATE, 1, nearest / BEAT_WINDOW_MS);
	}

	/**
	 * Fire the punch and shake for any beat the footage has just crossed.
	 *
	 * Counted rather than time-windowed: slow motion means a beat can be inside
	 * the window for a dozen frames, and a shake re-triggered on each of them
	 * would be a rattle instead of an impact.
	 */
	private consumeBeatShake(): number {
		let shake = 0;
		while (
			this.firedBeats < this.clip.beats.length &&
			(this.clip.beats[this.firedBeats]?.t ?? Number.POSITIVE_INFINITY) <=
				this.clipMs
		) {
			this.firedBeats++;
			this.punchMs = 0;
			shake = BEAT_SHAKE_PX;
		}
		return shake;
	}

	/** The camera's target this frame: where to look, and from how close. */
	private targetFor(subject: Subject): { x: number; y: number; zoom: number } {
		const t = clamp(this.phaseMs / this.phaseLength(), 0, 1);
		switch (this.phase) {
			case "establish":
				return {
					x: subject.x + ESTABLISH_OFFSET_X * (1 - easeOut(t)),
					y: subject.y + ESTABLISH_OFFSET_Y * (1 - easeOut(t)),
					zoom: lerp(ESTABLISH_ZOOM, ESTABLISH_ZOOM + 0.06, easeOut(t)),
				};
			case "push":
				return {
					x: subject.x,
					y: subject.y,
					zoom: lerp(ESTABLISH_ZOOM + 0.06, PUSH_ZOOM, easeInOut(t)),
				};
			case "whip": {
				// One overshoot and back: a half sine, so the camera is exactly on the
				// subject at both ends of the movement and furthest off it in the
				// middle. Anything with a discontinuity here reads as a bug.
				const swing = Math.sin(t * Math.PI) * WHIP_OVERSHOOT_PX;
				return {
					x: subject.x + swing,
					y: subject.y,
					zoom: lerp(PUSH_ZOOM, ROLL_ZOOM, easeInOut(t)),
				};
			}
			case "roll": {
				const lead = clamp(
					subject.vx * LEAD_PER_VELOCITY,
					-LEAD_MAX_PX,
					LEAD_MAX_PX,
				);
				const punch =
					BEAT_PUNCH_ZOOM * (1 - clamp(this.punchMs / BEAT_PUNCH_MS, 0, 1));
				return { x: subject.x + lead, y: subject.y, zoom: ROLL_ZOOM + punch };
			}
			case "outro":
				return {
					x: subject.x,
					y: subject.y,
					zoom: lerp(ROLL_ZOOM, OUTRO_ZOOM, easeOut(t)),
				};
			case "done":
				return { x: subject.x, y: subject.y, zoom: 1 };
		}
	}

	private phaseLength(): number {
		switch (this.phase) {
			case "establish":
				return ESTABLISH_MS;
			case "push":
				return PUSH_MS;
			case "whip":
				return WHIP_MS;
			case "outro":
				return OUTRO_MS;
			default:
				// The roll has no fixed length — the footage decides — so a fraction of
				// it is meaningless and every user of `t` in that branch ignores it.
				return 1;
		}
	}

	/**
	 * The bars slide in at the very start and out at the very end, and are fully
	 * extended for everything between. They are the frame around the whole
	 * ceremony rather than an effect inside it.
	 */
	private letterbox(): number {
		if (this.phase === "done") return 0;
		if (this.phase === "outro") {
			return (
				1 - easeOut(Math.max(0, this.phaseMs - (OUTRO_MS - BARS_MS)) / BARS_MS)
			);
		}
		return easeOut(this.elapsedMs / BARS_MS);
	}

	/**
	 * "PLAY OF THE GAME": up over the establish, and **gone by half the push**.
	 *
	 * Faster than the push it rides on, so the title has left before the name card
	 * arrives. Crossfading the two put a headline through the middle of the title
	 * for a third of a second, which reads as two overlays fighting rather than as
	 * one handing over to the other.
	 */
	private titleAlpha(): number {
		if (this.phase === "establish") return easeOut(this.phaseMs / BARS_MS);
		if (this.phase === "push") {
			return 1 - easeOut(this.phaseMs / (PUSH_MS * TITLE_OUT_FRACTION));
		}
		return 0;
	}

	/** The name card: after the title has gone, held through the whip, back for the outro. */
	private cardAlpha(): number {
		if (this.phase === "push") {
			const from = PUSH_MS * CARD_IN_FRACTION;
			return easeOut((this.phaseMs - from) / (PUSH_MS - from));
		}
		if (this.phase === "whip") return 1 - easeInOut(this.phaseMs / WHIP_MS);
		if (this.phase === "outro") return easeOut(this.phaseMs / BARS_MS);
		return 0;
	}
}
