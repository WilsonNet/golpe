/**
 * Where a fighter looks when there is no cursor to look at.
 *
 * The mouse answers "aim" by pointing at a place. A controller cannot: a stick
 * gives a *direction*, and a d-pad gives one of eight. So controller mode aims
 * with two layers that this module owns and nothing else does:
 *
 * - **Contra aim.** The d-pad or the left stick, quantised to eight directions,
 *   exactly the way a run-and-gun aims. It is the same input that moves you, so
 *   the aim follows the run for free and there is nothing extra to hold.
 * - **Fine aim.** The right stick, full 360°, at whatever angle it is pushed.
 *   It **overrides** the contra aim while it is being touched, which is what lets
 *   a fighter run right and cover the door on the left. Let go and it falls back
 *   to the contra aim, because a stick that stayed where it was left would be a
 *   fighter aiming at a wall nobody is pointing at.
 *
 * **This module is pure and clock-free** — it is handed `dtMs` and never reads
 * one. That is what lets the decay timings be pinned by tests instead of by a
 * playtest, and they are *feel* constants, which is the category that gets
 * retuned by accident when nothing pins it.
 *
 * Nothing here touches the DOM, the Gamepad API or the simulation. The input
 * layer feeds it, and hands the resulting angle to `PlayerIntent` exactly the
 * way the cursor's angle was handed over — the simulation never learns which
 * device produced it, and therefore nothing about this can desync.
 */

/**
 * Below this, a stick is at rest.
 *
 * Generous, because a worn thumbstick that rests at 0.12 would otherwise hold
 * the fine aim on forever and the contra aim would never come back — a fault
 * that reads as "aiming is broken" rather than as "my controller is old".
 */
export const STICK_DEADZONE = 0.25;

/**
 * How far the mouse must travel to push the virtual stick from centre to rim.
 *
 * In CSS pixels of pointer movement, so it is a *sensitivity*: smaller means the
 * aim swings further for the same flick. 90px is roughly a comfortable trackpad
 * stroke — the whole reason this mode exists is people playing on a laptop, and
 * a trackpad has perhaps 300px of usable travel in each direction before the
 * finger runs out of glass.
 */
export const FINE_AIM_RADIUS_PX = 90;

/**
 * How long the fine aim survives after the last touch.
 *
 * Long enough to aim, fire and re-aim without the contra aim snatching the
 * reticle back mid-exchange; short enough that a player who has genuinely let go
 * is not left aiming at yesterday. It is deliberately longer than a swing.
 */
export const FINE_AIM_HOLD_MS = 900;

/**
 * How long the fall back to the contra aim takes once the hold expires.
 *
 * Eased rather than snapped. A snap is a frame where the fighter faces somewhere
 * nobody chose, and in a game where facing decides which side a guard covers,
 * that frame is a free hit. Short enough that it still reads as "it reset".
 */
export const FINE_AIM_RELEASE_MS = 260;

/** A two-component vector, in whatever units the caller is working in. */
export interface Vec2 {
	x: number;
	y: number;
}

/** Directly right, in screen coordinates where +y is *down*. */
const RIGHT = 0;

/**
 * Snap a stick to the nearest of eight directions.
 *
 * Returns a unit-ish vector with components in {-1, 0, 1} — the same shape a
 * d-pad produces — so the stick and the d-pad reach the rest of the input layer
 * as the same thing and there is no second code path for either.
 *
 * Inside the deadzone the answer is the origin, which callers read as "no
 * contra input this frame" rather than as "aim right".
 */
export function quantise8(
	x: number,
	y: number,
	deadzone = STICK_DEADZONE,
): Vec2 {
	if (Math.hypot(x, y) < deadzone) return { x: 0, y: 0 };
	const step = Math.PI / 4;
	const angle = Math.round(Math.atan2(y, x) / step) * step;
	// Rounding the cosine is what turns 45° into (1,1) and 90° into (0,1): the
	// components are only ever -1, 0 or 1, never 0.707.
	return { x: Math.round(Math.cos(angle)), y: Math.round(Math.sin(angle)) };
}

/**
 * The eight-direction aim, from a direction pair.
 *
 * `null` means "nothing is held" — the caller keeps whatever the last committed
 * direction was, because releasing the d-pad should not make a fighter forget
 * which way it was looking.
 */
export function contraAngle(x: number, y: number): number | null {
	if (x === 0 && y === 0) return null;
	return Math.atan2(y, x);
}

/**
 * Push a virtual analogue stick by a mouse delta.
 *
 * This is the trigonometry that makes a mouse feel like a right stick, and it is
 * prior art rather than an invention: Steam Input ships the same thing as its
 * *Mouse Joystick* style, and the rim behaviour is what Flick Stick calls
 * rotating along the gate.
 *
 * Two regimes, and the second is the one that matters:
 *
 * - **Inside the gate**, movement accumulates the way you would expect. Slide
 *   right and the stick goes right; the magnitude is clamped at the rim so the
 *   aim saturates instead of wandering off to infinity.
 * - **At the rim**, the delta is decomposed into a radial and a tangential
 *   component. The tangential part *rotates* the stick — one radius of
 *   tangential travel is one radian — and only the inward radial part can pull
 *   it back off the rim. Pushing straight outward does nothing, because a gate
 *   does not give.
 *
 * The rim case is the whole feature. Plain Cartesian accumulation with a clamp
 * looks correct and is not: aiming right and then sliding up one radius at a
 * time gives 45°, then 63°, then 71° — it crawls towards straight up and a
 * player who wants to aim at the ceiling gives up before it arrives. Rotating
 * along the rim gives 57°, then 88°, then 90°, and carries on round the circle
 * as long as the stroke keeps curving, so every one of the 360° is reachable.
 */
export function pushStick(
	stick: Vec2,
	dx: number,
	dy: number,
	radius = FINE_AIM_RADIUS_PX,
): Vec2 {
	const length = Math.hypot(stick.x, stick.y);
	// A hair inside, so floating-point drift on a stick sitting exactly at the rim
	// cannot flip between the two regimes frame to frame.
	if (length < radius - 1e-6) {
		const nx = stick.x + dx;
		const ny = stick.y + dy;
		const n = Math.hypot(nx, ny);
		if (n <= radius) return { x: nx, y: ny };
		return { x: (nx / n) * radius, y: (ny / n) * radius };
	}

	const ux = stick.x / length;
	const uy = stick.y / length;
	// Tangent to the rim, pointing the way the angle increases.
	const radial = dx * ux + dy * uy;
	const tangential = dx * -uy + dy * ux;
	const angle = Math.atan2(stick.y, stick.x) + tangential / radius;
	// Only an inward push shrinks the stick. Pushing further out at the rim is a
	// player leaning on the gate, and a gate does not give.
	const magnitude = Math.min(radius, Math.max(0, length + Math.min(radial, 0)));
	return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
}

/** Interpolate between two angles the short way round. */
export function lerpAngle(from: number, to: number, t: number): number {
	let delta = (to - from) % (Math.PI * 2);
	if (delta > Math.PI) delta -= Math.PI * 2;
	if (delta < -Math.PI) delta += Math.PI * 2;
	return from + delta * t;
}

/** What the aim controller is doing right now, for the HUD and for a probe. */
export interface AimReport {
	/** The angle the simulation is handed, radians, +y down. */
	angle: number;
	/** The eight-direction aim underneath, whether or not it is winning. */
	contra: number;
	/** The fine stick's angle. Meaningless while `fine` is 0. */
	fineAngle: number;
	/** How far the fine stick is pushed, 0 to 1. */
	fine: number;
	/** How much of the reported angle is the fine stick's, 0 to 1. */
	blend: number;
	/** True while the fine stick is overriding the contra aim at all. */
	overriding: boolean;
	/** Milliseconds since the fine stick was last touched. */
	idleMs: number;
}

/**
 * The two aim layers, and the handover between them.
 *
 * One instance per local fighter. Fed every frame by whatever input scheme is
 * active — the same object serves a real gamepad, a trackpad and a thumb on a
 * piece of glass, because all three arrive here as either a direction pair or a
 * stick vector.
 */
export class AimController {
	/** The last committed eight-direction angle. Survives releasing the d-pad. */
	private contra = RIGHT;
	/** The fine stick, in the same pixel units `pushStick` accumulates in. */
	private stick: Vec2 = { x: 0, y: 0 };
	/** Milliseconds since the fine stick was last moved or held off-centre. */
	private idleMs = Number.POSITIVE_INFINITY;
	/** Touched since the last `update`. Reset every frame by `update`. */
	private touched = false;
	/** How much of the output is the fine stick's: 0 contra, 1 fine. */
	private blend = 0;
	/** Frozen at the moment the hold expires, so the ease-out has a start point. */
	private fineAngle = RIGHT;
	/** Whether the d-pad has ever named a direction. Until it has, facing does. */
	private contraSet = false;

	constructor(private readonly radius: number = FINE_AIM_RADIUS_PX) {}

	/**
	 * Set the eight-direction aim from a direction pair.
	 *
	 * `facing` is the fallback for a controller that has never pointed anywhere —
	 * a fighter that spawns facing right should aim right, not at some remembered
	 * default from a previous match.
	 */
	setContra(x: number, y: number, facing: number) {
		const angle = contraAngle(x, y);
		if (angle !== null) {
			this.contra = angle;
			this.contraSet = true;
			return;
		}
		if (!this.contraSet) this.contra = facing < 0 ? Math.PI : RIGHT;
	}

	/**
	 * Push the fine stick by a relative delta — a mouse or a trackpad.
	 *
	 * Deliberately *relative*. An absolute cursor cannot express "keep turning":
	 * it runs out of screen, and on a trackpad it runs out of glass long before
	 * that. See `pushStick` for why the rim rotates rather than clamps.
	 */
	pushFine(dx: number, dy: number) {
		if (dx === 0 && dy === 0) return;
		this.stick = pushStick(this.stick, dx, dy, this.radius);
		this.touched = true;
	}

	/**
	 * Set the fine stick from an absolute unit vector — a real right stick, or a
	 * thumb on the on-screen pad.
	 *
	 * A physical stick returns to centre on its own, so there is nothing to decay
	 * here: releasing it puts the magnitude inside the deadzone and the handover
	 * back to the contra aim starts on its own.
	 */
	setFine(x: number, y: number) {
		const magnitude = Math.hypot(x, y);
		if (magnitude < STICK_DEADZONE) {
			// Not "touched": a stick sitting at rest is a stick nobody is holding, and
			// counting it would hold the override open forever.
			this.stick = { x: 0, y: 0 };
			return;
		}
		const scale = Math.min(1, magnitude) * this.radius;
		this.stick = { x: (x / magnitude) * scale, y: (y / magnitude) * scale };
		this.touched = true;
	}

	/** Drop the fine aim immediately — a scheme change, or a lost window. */
	releaseFine() {
		this.stick = { x: 0, y: 0 };
		this.touched = false;
		this.idleMs = Number.POSITIVE_INFINITY;
		this.blend = 0;
	}

	/** Forget everything, including which way the contra aim was pointing. */
	reset(facing = 1) {
		this.releaseFine();
		this.contra = facing < 0 ? Math.PI : RIGHT;
		this.contraSet = false;
	}

	/**
	 * Advance the handover by one frame.
	 *
	 * Called once per frame, after the inputs for that frame have been fed in.
	 * Ticking before them would spend a frame of the hold on input that had not
	 * arrived yet, which at 60Hz is invisible and at 20Hz is a stutter in the aim.
	 */
	update(dtMs: number) {
		const pushed = Math.hypot(this.stick.x, this.stick.y) / this.radius;
		const live = this.touched || pushed >= STICK_DEADZONE;

		if (this.touched) this.idleMs = 0;
		else this.idleMs += dtMs;
		this.touched = false;

		if (live && this.idleMs < FINE_AIM_HOLD_MS) {
			this.fineAngle = Math.atan2(this.stick.y, this.stick.x);
			// Ramp in over the same time it ramps out, so grabbing the stick mid-decay
			// is continuous rather than a snap back to where it was.
			this.blend = Math.min(1, this.blend + dtMs / FINE_AIM_RELEASE_MS);
			return;
		}

		this.blend = Math.max(0, this.blend - dtMs / FINE_AIM_RELEASE_MS);
		// Fully handed back. Recentre, because the next stroke has to *leave from
		// the centre* — a virtual stick that resumed from where it was abandoned
		// would answer the same flick with a different angle every time.
		if (this.blend === 0) this.stick = { x: 0, y: 0 };
	}

	/** The angle to hand the simulation. */
	get angle(): number {
		if (this.blend <= 0) return this.contra;
		if (this.blend >= 1) return this.fineAngle;
		return lerpAngle(this.contra, this.fineAngle, this.blend);
	}

	/** True while the fine stick has any say at all in the angle. */
	get overriding(): boolean {
		return this.blend > 0;
	}

	report(): AimReport {
		return {
			angle: this.angle,
			contra: this.contra,
			fineAngle: this.fineAngle,
			fine: Math.min(1, Math.hypot(this.stick.x, this.stick.y) / this.radius),
			blend: this.blend,
			overriding: this.overriding,
			idleMs: this.idleMs === Number.POSITIVE_INFINITY ? -1 : this.idleMs,
		};
	}
}
