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
 * Seven movements, and the first two are the ones Overwatch's own ceremony is
 * built on — a title card that owns the screen, then camera work that keeps
 * narrowing the frame until it has no choice but to be about one fighter:
 *
 * 1. **Intro** — the arena is **hidden**, and a full-screen title card slams the
 *    wordmark in over a flare. This is the part that does the hyping, and it is
 *    the part the first version did not have: a title fading in *over* a visible
 *    replay reads as a caption, not as an event. Overwatch spends five seconds
 *    on its hero card; this version of the same beat is the same length.
 * 2. **Establish** — the wipe reveals the arena, wide and slightly off the
 *    protagonist, drifting toward them, footage crawling. The only moment in the
 *    sequence where the whole level is legible.
 * 3. **Orbit** — the camera cranes up and swings in an arc around the fighter:
 *    a hero shot. In film language this is the shot that says "this one is
 *    special" without a word — the camera operator circling the subject is the
 *    oldest way in the book to lift them out of their surroundings. The orbit
 *    also plays with the one axis the arena has to spare: a lateral swing is
 *    flat on a single-screen level, so the arc climbs and descends as it turns.
 * 4. **Push** — a hard push in to a tight framing, the name card sliding under
 *    it. This is the sentence "it was *this* one".
 * 5. **Whip** — a fast pan that overshoots them and swings back, easing out of
 *    the tight framing. It costs 800ms and buys the thing a straight cut cannot:
 *    the feeling that a camera operator is following a person.
 * 6. **Roll** — the play itself, at speed, camera leading the fighter's
 *    movement, dropping into slow motion and punching the zoom on every scoring
 *    beat the server recorded. It *coils* just before a beat — a slow pull-back
 *    that makes the punch land harder, the same anticipation a batter gets from
 *    winding up — and heavier beats punch harder than light ones.
 * 7. **Outro** — the last frame held, pulled back out, cards returned.
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
	| "intro"
	| "establish"
	| "orbit"
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
	/**
	 * How much of the arena the title card is covering, 0..1.
	 *
	 * 1 for almost all of the intro, then wiped to 0. This is the number that
	 * makes the card an *event* rather than a caption: while it is 1 there is
	 * nothing else on screen, so the reveal has something to reveal.
	 */
	curtain: number;
	/** Opacity of the intro card as a whole, 0..1. */
	title: number;
	/**
	 * Progress through the intro, 0..1.
	 *
	 * The card's internal animation is CSS keyframes rather than driven from
	 * here — legitimate because the intro is the one movement with a *fixed*
	 * duration, exactly like the ultimate's 1100ms cutscene. This is what the
	 * overlay hands the stylesheet so the two cannot drift, and what the probe
	 * reads to prove the card ran.
	 */
	intro: number;
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

/**
 * The title card, in full. Exported because the stylesheet times the wordmark's
 * entrance against it and the probe asserts the card actually stood.
 *
 * Overwatch's own ceremony spends five seconds on the hero card before a frame
 * of gameplay shows; this is that beat, long enough for four words, a byline
 * and a stat line to arrive one at a time and to *hold* — the stillness after
 * the slam is what lets the reveal land as an event. It grew from 2.8s because
 * the buildup is the ceremony: ten seconds of camera work after this would
 * play badly against a card that was already gone.
 */
export const POTG_INTRO_MS = 4500;
/** How long the card takes to wipe off the arena at the end of the intro. */
export const POTG_WIPE_MS = 550;

const ESTABLISH_MS = 1500;
/** The camera's arc around the fighter: a hero shot, and the new pre-roll's heart. */
const ORBIT_MS = 1500;
const PUSH_MS = 1400;
const WHIP_MS = 800;
const OUTRO_MS = 2200;
/**
 * Everything before the play itself. Named because the probe asserts on it.
 *
 * 4.5s card + 5.2s of camera work — ten seconds of buildup, close enough to
 * Overwatch's own that the difference is the footage, not the appetite.
 */
export const POTG_PREROLL_MS =
	POTG_INTRO_MS + ESTABLISH_MS + ORBIT_MS + PUSH_MS + WHIP_MS;

/** Wide enough that a fighter reads as a figure in a place rather than a portrait. */
const ESTABLISH_ZOOM = 0.8;
/**
 * The orbit's framing: looser than the fight, so the push that follows it has
 * room to be a *move*. The orbit sells itself with the crane, not the zoom —
 * on a one-screen arena the lateral half of its arc clamps away, and the zoom
 * staying modest is what keeps the establish → orbit → push ladder from being
 * three nearly identical distances.
 */
const ORBIT_ZOOM = 1.15;
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

/**
 * The orbit's arc, as a circle around the subject.
 *
 * `ORBIT_R` is the radius; `ORBIT_SWEEP` the angle of arc swung through (130°,
 * deliberately less than a full circle — the camera stays on the fighter's
 * side of the arena, and the 180° rule says a camera that crosses the action
 * axis mid-shot disorients rather than glorifies). `ORBIT_Y_FACTOR` squashes
 * the vertical leg of the arc, because a camera that rose a full circle would
 * leave the ground the fight is about to happen on; `ORBIT_Y_BIAS` tips the
 * arc so it starts above the fighter and descends through the swing, the crane
 * move's classic shape.
 */
const ORBIT_R = 170;
const ORBIT_Y_FACTOR = 0.6;
const ORBIT_Y_BIAS = -40;
const ORBIT_SWEEP = (130 * Math.PI) / 180;

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
/**
 * How much each kind of beat is allowed to punch.
 *
 * A deny ends a fighter's ultimate and a wipe ends a round; a plain frag is
 * Tuesday. The punch is scaled by the *first* event at the beat's instant —
 * the one that made it unusual — so the reel's emphasis matches what the
 * server thought mattered.
 */
const PUNCH_SCALE: Readonly<Record<string, number>> = {
	deny: 1.4,
	wipeKill: 1.3,
	ultimateKill: 1.2,
	finisherKill: 1.15,
};
const PUNCH_SCALE_DEFAULT = 1;

/**
 * The coil: a slow pull-back over the footage-ms just before a beat.
 *
 * The punch is a zoom-in; a zoom that comes out of nowhere reads as a twitch.
 * Winding the zoom *out* in the 320ms before the beat makes the punch a
 * contrast instead of an event, which is what makes it land — the anticipation
 * is the same reason a swing telegraphs.
 */
const COIL_MS = 320;
const COIL_ZOOM = 0.09;

/** How far ahead of a moving fighter the roll camera looks, per px/s of velocity. */
const LEAD_PER_VELOCITY = 0.22;
const LEAD_MAX_PX = 110;
/** Looking-room when the fighter is standing still: a small bias toward their facing. */
const STILL_LEAD_PX = 22;

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
	/** Which way they face, 1 or -1 — the roll's looking-room when they stand still. */
	facing: number;
}

export class PotgDirector {
	/** ms of *footage* played so far. Advances at `rate`, so never wall time. */
	private clipMs = 0;
	/** ms of wall clock spent in the current movement. */
	private phaseMs = 0;
	private phase: PotgPhase = "intro";
	/** Where the camera actually is, as opposed to where it is being asked to go. */
	private camX = 0;
	private camY = 0;
	private camReady = false;
	/** Beats already fired, so a punch happens once and not once per frame. */
	private firedBeats = 0;
	/** ms since the last beat's punch, for its decay. */
	private punchMs = Number.POSITIVE_INFINITY;
	/** The punch's peak zoom this beat, scaled by what the beat was. */
	private punchPeak = BEAT_PUNCH_ZOOM;
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
			curtain: this.curtain(),
			title: this.titleAlpha(),
			intro:
				this.phase === "intro" ? clamp(this.phaseMs / POTG_INTRO_MS, 0, 1) : 0,
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
			case "intro":
				if (this.phaseMs >= POTG_INTRO_MS) this.enter("establish");
				return;
			case "establish":
				if (this.phaseMs >= ESTABLISH_MS) this.enter("orbit");
				return;
			case "orbit":
				if (this.phaseMs >= ORBIT_MS) this.enter("push");
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
		// The card owns the screen; there is nothing to see, so nothing runs. Held
		// rather than crawling because the 2.5s lead-in is a budget — spending any
		// of it behind an opaque card is spending it on nobody.
		if (this.phase === "intro") return 0;
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
	 * would be a rattle instead of an impact. The punch's *size* is remembered
	 * from the beat's kind, so a deny punches harder than a plain frag.
	 */
	private consumeBeatShake(): number {
		let shake = 0;
		while (
			this.firedBeats < this.clip.beats.length &&
			(this.clip.beats[this.firedBeats]?.t ?? Number.POSITIVE_INFINITY) <=
				this.clipMs
		) {
			const beat = this.clip.beats[this.firedBeats];
			this.firedBeats++;
			this.punchMs = 0;
			this.punchPeak =
				BEAT_PUNCH_ZOOM *
				(PUNCH_SCALE[beat?.kind ?? ""] ?? PUNCH_SCALE_DEFAULT);
			shake = BEAT_SHAKE_PX;
		}
		return shake;
	}

	/** The camera's target this frame: where to look, and from how close. */
	private targetFor(subject: Subject): { x: number; y: number; zoom: number } {
		const t = clamp(this.phaseMs / this.phaseLength(), 0, 1);
		switch (this.phase) {
			case "intro":
				// Parked exactly where the establish will start from, so the wipe
				// reveals a composed frame rather than a camera arriving into one.
				// Nothing is visible during this, which is precisely why it must
				// already be right when something is.
				return {
					x: subject.x + ESTABLISH_OFFSET_X * this.facingDir(subject),
					y: subject.y + ESTABLISH_OFFSET_Y,
					zoom: ESTABLISH_ZOOM,
				};
			case "establish":
				// Drifting from the parking spot onto the fighter, and the drift is
				// *facing-aware*: a fighter looking right is framed on the left
				// third, looking across the shot — the rule-of-thirds version of
				// "whose play is this" that the whole pre-roll is reaching for.
				return {
					x:
						subject.x +
						ESTABLISH_OFFSET_X * (1 - easeOut(t)) * this.facingDir(subject),
					y: subject.y + ESTABLISH_OFFSET_Y * (1 - easeOut(t)),
					zoom: lerp(ESTABLISH_ZOOM, ESTABLISH_ZOOM + 0.06, easeOut(t)),
				};
			case "orbit": {
				// The hero shot: an arc around the fighter, from high on one side
				// through eye level in front of them to high on the other, with the
				// zoom breathing up a touch as it closes. One sweep, no reversals:
				// the camera is always moving the same way around the subject,
				// which is what reads as *circling* rather than wobbling.
				const theta = lerp(-ORBIT_SWEEP / 2, ORBIT_SWEEP / 2, easeInOut(t));
				return {
					x: subject.x + ORBIT_R * Math.cos(theta),
					y:
						subject.y +
						ORBIT_R * Math.sin(theta) * ORBIT_Y_FACTOR +
						ORBIT_Y_BIAS,
					zoom: lerp(ORBIT_ZOOM - 0.05, ORBIT_ZOOM + 0.05, easeInOut(t)),
				};
			}
			case "push":
				return {
					x: subject.x,
					y: subject.y,
					zoom: lerp(ORBIT_ZOOM + 0.05, PUSH_ZOOM, easeInOut(t)),
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
				// Lead room: ahead of a moving fighter, and a little toward their
				// facing when they stand still — the camera never dead-centres a
				// subject, because a dead-centre subject is a fighter on a poster,
				// not a fighter about to act.
				const moving = Math.abs(subject.vx) > 1;
				const lead = clamp(
					subject.vx * LEAD_PER_VELOCITY,
					-LEAD_MAX_PX,
					LEAD_MAX_PX,
				);
				const still = moving ? 0 : subject.facing * STILL_LEAD_PX;
				// The coil: in the last `COIL_MS` of footage before an upcoming
				// beat, the zoom eases *out*, so the punch has something to contrast
				// with. It only coils toward the next un-fired beat; a spent beat is
				// spent.
				const nextBeat = this.clip.beats[this.firedBeats];
				let coil = 0;
				if (nextBeat) {
					const until = nextBeat.t - this.clipMs;
					if (until >= 0 && until < COIL_MS) {
						coil = -(1 - until / COIL_MS) * COIL_ZOOM;
					}
				}
				const punch =
					this.punchPeak * (1 - clamp(this.punchMs / BEAT_PUNCH_MS, 0, 1));
				return {
					x: subject.x + lead + still,
					y: subject.y,
					zoom: ROLL_ZOOM + punch + coil,
				};
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

	/**
	 * The side the establish parks on: ahead of the fighter's facing, so the
	 * shot is "looking across the frame at them" whichever way they face.
	 * Zero-facing (no direction pressed) parks dead centre, which is exactly as
	 * neutral as the subject is.
	 */
	private facingDir(subject: Subject): number {
		return subject.facing >= 0 ? 1 : -1;
	}

	private phaseLength(): number {
		switch (this.phase) {
			case "intro":
				return POTG_INTRO_MS;
			case "establish":
				return ESTABLISH_MS;
			case "orbit":
				return ORBIT_MS;
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
	 * How much of the arena the title card is hiding.
	 *
	 * Solid for the whole intro but its last `POTG_WIPE_MS`, then off. **The
	 * curtain is the entire difference between a title card and a caption**: the
	 * first version faded a title in over a visible replay and it read as a
	 * subtitle on footage that was already playing. Something has to own the
	 * screen before it can hand it over.
	 */
	private curtain(): number {
		if (this.phase !== "intro") return 0;
		const from = POTG_INTRO_MS - POTG_WIPE_MS;
		return 1 - easeInOut((this.phaseMs - from) / POTG_WIPE_MS);
	}

	/**
	 * The intro card's own opacity.
	 *
	 * It leaves slightly *ahead* of the curtain — the words are gone by the time
	 * the arena is fully revealed, so the reveal is of the arena and not of a
	 * headline sitting on top of it.
	 */
	private titleAlpha(): number {
		if (this.phase !== "intro") return 0;
		const from = POTG_INTRO_MS - POTG_WIPE_MS;
		return (
			1 - easeOut((this.phaseMs - from) / (POTG_WIPE_MS * TITLE_OUT_FRACTION))
		);
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
