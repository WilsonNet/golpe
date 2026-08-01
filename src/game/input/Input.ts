/**
 * Raw keyboard, mouse, gamepad and touch state.
 *
 * Deliberately dumb: it records which buttons are down and where the cursor is,
 * and nothing else. **Edge detection does not belong here.** The simulation does
 * its own — jump height is analogue, a slash needs a press edge, a Massive fires
 * on release — and detecting edges in two places would mean the client and the
 * server disagreed about what a given frame's input was.
 *
 * **Four devices, one alphabet.** Keys, mouse buttons, pad buttons and the
 * on-screen deck all reduce to code strings in one namespace, so an action asks
 * "is any of my codes held" and gets one answer. See `Bindings.ts`.
 *
 * **Two ways to answer "where is this fighter aiming".** With a cursor, the
 * angle is the vector to a point on the screen. Without one — a pad, a trackpad,
 * a thumb — it comes from `AimController`, which has no idea a screen exists.
 * `inputSettings.scheme` picks between them, and the simulation is handed the
 * same `aimAngle` either way: it never learns which device produced it, and
 * therefore nothing about any of this can desync.
 */

import { EventBus } from "../EventBus";
import { bodyCentre } from "../render/ArenaRenderer";
import { NEUTRAL_INTENT, type PlayerIntent } from "../simulation/Physics";
import { AimController, type AimReport } from "./Aim";
import { type Action, bindings, mouseCode } from "./Bindings";
import { GamepadSource } from "./Gamepad";
import { inputSettings } from "./Scheme";

/**
 * Two taps inside this window are a dash rather than two steps.
 *
 * **300ms, up from 200.** At 200 the gesture was reliable standing still and
 * genuinely hard in the air: dashing at the peak of a jump means releasing the
 * direction you jumped with and then landing both taps inside the window, all
 * while the apex passes. Widening it is the cheapest forgiveness available and
 * costs nothing else.
 *
 * The ceiling is deliberate stepping. Players tap a direction to make a single
 * small step, and those taps come roughly 350ms apart or slower — so a window
 * much past 300 starts reading two intended steps as a dash, and an unwanted dash
 * across the arena is a far worse failure than a missed one.
 */
export const DASH_DOUBLE_TAP_MS = 300;

/**
 * Double-tap dash detection, as its own testable unit.
 *
 * Separated from `Input` so the *timing* can be tested without a DOM or a real
 * clock — the window is a feel constant, and a feel constant that nothing pins
 * gets retuned by accident. `Input` owns the keyboard; this owns the gesture.
 */
export class DoubleTapDash {
	private lastPress: Record<string, number> = {};
	private pending = 0;

	constructor(private readonly windowMs: number = DASH_DOUBLE_TAP_MS) {}

	/**
	 * Note a *press* — not a repeat, and not a release.
	 *
	 * Keyed by direction rather than by key code, because both are rebindable and
	 * an action can hold two of them: a player with left on both A and the left
	 * arrow is tapping "left" whichever one their finger lands on, and keying by
	 * code would refuse the pair.
	 */
	press(direction: -1 | 1, nowMs: number) {
		const key = String(direction);
		const previous = this.lastPress[key] ?? Number.NEGATIVE_INFINITY;
		if (nowMs - previous < this.windowMs) {
			this.pending = direction;
			// Consume the pair, so a third tap has to start a fresh gesture rather
			// than chaining a dash off every subsequent press.
			this.lastPress[key] = Number.NEGATIVE_INFINITY;
			return;
		}
		this.lastPress[key] = nowMs;
	}

	/** Take the dash direction, if one was gestured since the last call. */
	consume(): number {
		const d = this.pending;
		this.pending = 0;
		return d;
	}

	/**
	 * Forget everything, including a gesture that had already landed.
	 *
	 * Used when focus is lost. A dash held over a window switch would fire whenever
	 * the player came back, which is an input they made a minute ago.
	 */
	reset() {
		this.lastPress = {};
		this.pending = 0;
	}
}

/**
 * What the cursor has to be measured against to become a world position.
 *
 * `width`/`height` are the **logical** view — 800x600, the size the game is
 * authored in — never `canvas.width`/`canvas.height`. Under `autoDensity` the
 * canvas backing store is the logical size times `devicePixelRatio`, so on an
 * ordinary 2x display dividing by it put the cursor at twice its real world
 * coordinates: the fighter believed the pointer was almost always to its right
 * and below it, aim was up to 132° wrong, and shots left in a direction nobody
 * had pointed at. `app.screen` is the logical rectangle and stays correct
 * through a resize.
 *
 * The camera offset is included because the pointer is a *screen* fact and
 * everything it is compared against — body centres, aim angles, bullet spawns —
 * is a *world* fact. They coincide only while the camera sits at the origin,
 * which is exactly the condition that makes the missing term invisible today
 * and a silent bug the day the camera scrolls.
 */
export interface Viewport {
	readonly width: number;
	readonly height: number;
	readonly cameraX: number;
	readonly cameraY: number;
}

/**
 * Cursor to a fraction of the canvas.
 *
 * The canvas is letterboxed and scaled by CSS, so the displayed rectangle is
 * the only frame both the event and the element agree on — and the ratio is the
 * one quantity in the whole chain that no pixel ratio can distort.
 */
export function normalisePointer(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
): { u: number; v: number } {
	return {
		u: rect.width > 0 ? (clientX - rect.left) / rect.width : 0,
		v: rect.height > 0 ? (clientY - rect.top) / rect.height : 0,
	};
}

/** A canvas fraction to a world position. Pure, so it is testable. */
export function viewToWorld(
	u: number,
	v: number,
	view: Viewport,
): { x: number; y: number } {
	return {
		x: u * view.width + view.cameraX,
		y: v * view.height + view.cameraY,
	};
}

/**
 * How close to vertical an aim has to be before the feet decide the facing.
 *
 * A cosine, so 0.08 is about 4.6° either side of straight up or straight down.
 * Without it, `cos(-90°)` is a positive floating-point crumb and a fighter that
 * aims at the ceiling snaps to facing right — which in a game where facing
 * decides which side a guard covers is a free hit. `face: 0` is the intent's
 * existing "let the feet decide", so a fighter aiming straight up keeps looking
 * the way it is walking.
 *
 * It matters far more with a controller than with a mouse: straight up is a
 * place players actually sit — one of the eight on a d-pad, or wherever they
 * hold an analog stick — rather than a pixel-wide accident of where the cursor
 * landed.
 */
const VERTICAL_AIM_COS = 0.08;

/** Shared empty set, so a suspended frame allocates nothing. */
const EMPTY_CODES: ReadonlySet<string> = new Set<string>();

/** Which way an aim angle says to face, or 0 for "let the feet decide". */
export function faceFor(aimAngle: number): -1 | 0 | 1 {
	const c = Math.cos(aimAngle);
	if (Math.abs(c) < VERTICAL_AIM_COS) return 0;
	return c > 0 ? 1 : -1;
}

/** A DOM node that owns the keystrokes going into it. */
function isEditable(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el || typeof el.tagName !== "string") return false;
	const tag = el.tagName.toLowerCase();
	return (
		tag === "input" ||
		tag === "textarea" ||
		tag === "select" ||
		el.isContentEditable === true
	);
}

export class Input {
	/**
	 * Every code currently held — keys and mouse buttons in one set.
	 *
	 * The pointer used to have its own two booleans, which was fine while attack
	 * was left-click and block was right-click by definition. It stops being fine
	 * the moment a player can put block on Shift or attack on a mouse button that
	 * is not button 0: an action asks "is any of my codes down", and that question
	 * has one answer only if keys and buttons share a namespace. See Bindings.ts.
	 */
	private readonly down = new Set<string>();

	/**
	 * True while a DOM overlay owns the keyboard — the Esc menu, chiefly.
	 *
	 * Without it, rebinding block to `S` would walk the fighter into a corner
	 * while the player was choosing the key, and clicking "Reset to defaults"
	 * would swing the sword. Driven by `input-suspended` on the EventBus, which
	 * is the same bridge the rest of the React overlay talks over.
	 */
	private suspended = false;

	/**
	 * Cursor as a fraction of the canvas, resolved to world coordinates on read.
	 *
	 * Stored normalised rather than converted on the event, because a pointer that
	 * has not moved is still aiming somewhere: converting once would freeze the
	 * world position at the camera and view size of whichever frame the mouse last
	 * twitched, and the fighter would stop tracking a cursor the player is holding
	 * still while the camera moves under it.
	 */
	private pointerU = 0.5;
	private pointerV = 0.5;

	/**
	 * Pointer travel since the last poll, in CSS pixels.
	 *
	 * Controller mode aims with a *relative* mouse, because an absolute one cannot
	 * express "keep turning": it runs out of screen, and on the trackpad this mode
	 * mostly exists for it runs out of glass long before that. Accumulated here
	 * and drained once per frame, so a 240Hz mouse and a 60Hz frame agree on how
	 * far the hand actually moved.
	 */
	private mouseDeltaX = 0;
	private mouseDeltaY = 0;

	/**
	 * The physical gamepad, and the two-layer aim it feeds.
	 *
	 * The controller is polled rather than evented — the Gamepad API has no button
	 * events — so press edges for pad buttons are derived here, against the
	 * previous frame's set. `padPrevious` is what makes a held trigger a hold
	 * rather than a press repeated sixty times a second.
	 */
	private readonly pad = new GamepadSource();
	private padDown: ReadonlySet<string> = new Set();
	private padPrevious: ReadonlySet<string> = new Set();
	private readonly aim = new AimController();
	/** True while an absolute fine-aim source was live last frame. */
	private hadAbsoluteFine = false;
	/** Last seen scheme, so a change can be noticed without subscribing to it. */
	private lastScheme = inputSettings.scheme;

	/**
	 * Buttons the on-screen gamepad is holding, in the same code namespace.
	 *
	 * Separate from `down` because a finger can leave the deck's DOM without ever
	 * delivering a pointerup the canvas would see, and a stuck key set is how a
	 * fighter ends up swinging at nothing forever.
	 */
	private readonly virtual = new Set<string>();
	/** The on-screen thumb pad, as a unit vector, or null while nobody holds it. */
	private touchAim: { x: number; y: number } | null = null;
	/**
	 * The on-screen cross, as a raw unit vector, or null while nobody holds it.
	 *
	 * Separate from `touchAim` because the cross is the Contra layer — it *moves*
	 * the fighter too — while the thumb pad is the fine layer that overrides it.
	 * Both are analog, because a thumb is.
	 */
	private touchContra: { x: number; y: number } | null = null;

	/** Cursor in world coordinates. */
	get pointerX(): number {
		return viewToWorld(this.pointerU, this.pointerV, this.viewport).x;
	}

	get pointerY(): number {
		return viewToWorld(this.pointerU, this.pointerV, this.viewport).y;
	}

	/** Absolute, never a toggle — a toggle cannot survive a dropped packet. */
	swordStance = true;

	private readonly onToggleAi: (() => void) | undefined;
	private readonly disposers: (() => void)[] = [];

	constructor(
		canvas: HTMLCanvasElement,
		/** Live: read on every aim, so a resize or a camera scroll is picked up. */
		readonly viewport: Viewport,
		onToggleAi?: () => void,
	) {
		this.onToggleAi = onToggleAi;

		const keydown = (e: KeyboardEvent) => {
			// Typing into the training panel is not playing the game. Without this,
			// setting a walk bound to "500" also walked the fighter, and every WASD
			// character typed into a field was a movement command as well.
			if (isEditable(e.target)) return;
			if (this.suspended) return;
			const action = bindings.actionFor(e.code);
			// Space scrolls the page and Shift can start a text selection. A code
			// somebody bound to a move is a game input, not a browser one.
			if (action) e.preventDefault();
			this.down.add(e.code);
			// Browsers repeat a held key. A repeat is not a press, and treating it
			// as one would make simply holding a direction read as a dash.
			if (!e.repeat) this.notePress(action);
		};
		const keyup = (e: KeyboardEvent) => this.down.delete(e.code);

		// Chording sword-fighting inputs means several keys and buttons are held
		// at once; losing focus mid-exchange would otherwise leave them stuck down
		// forever, and the fighter would keep swinging at nothing.
		const clearAll = () => {
			this.down.clear();
			this.virtual.clear();
			this.touchAim = null;
			this.touchContra = null;
			this.mouseDeltaX = 0;
			this.mouseDeltaY = 0;
			this.aim.releaseFine();
			this.dashGesture.reset();
		};

		const pointerMove = (e: PointerEvent) => {
			const p = normalisePointer(
				e.clientX,
				e.clientY,
				canvas.getBoundingClientRect(),
			);
			this.pointerU = p.u;
			this.pointerV = p.v;
			// **A finger is not a trackpad.**
			//
			// The relative layer exists for a laptop with no controller. A touchscreen
			// has the deck's own thumb pad for the same job — and `movementX` is
			// populated for touch pointers too, so without this filter every thumb
			// drag on the d-pad also shoved the virtual stick: pressing *up* on the
			// cross reported an aim of 76° with the fine layer fully engaged, because
			// the thumb's travel across the glass had overridden the direction the
			// thumb was pressing.
			//
			// Kept whatever the scheme is, so switching to controller mode mid-match
			// does not need the player to jiggle the mouse before it responds.
			if (!this.suspended && e.pointerType === "mouse") {
				this.mouseDeltaX += e.movementX ?? 0;
				this.mouseDeltaY += e.movementY ?? 0;
			}
		};

		const pointerDown = (e: PointerEvent) => {
			if (this.suspended) return;
			// **Only a press on the game surface is a press at the fighter.**
			//
			// The listener is on `window` because a drag that starts on the canvas has
			// to keep being tracked when it leaves — but that also meant *every* tap
			// anywhere on the page counted as `Mouse0`, and `Mouse0` is attack. On a
			// phone the on-screen gamepad is DOM sitting right there, so a thumb on
			// Jump swung the sword as well as jumping, and so did the stance pills,
			// the d-pad and the menu button. Every button was a slash.
			//
			// `preventDefault` in the deck's own handler cannot fix it: it stops the
			// browser's default, not another listener on the same event.
			if (e.target !== canvas) return;
			const code = mouseCode(e.button);
			this.down.add(code);
			this.notePress(bindings.actionFor(code));
		};
		// Deliberately *not* gated on the target: a drag that starts on the canvas
		// and releases over the deck must still release. Deleting a code that was
		// never added is a no-op, so the asymmetry is free.
		const pointerUp = (e: PointerEvent) => {
			this.down.delete(mouseCode(e.button));
		};
		const contextMenu = (e: Event) => e.preventDefault();

		// A modal took the keyboard. Everything held is released, because a key
		// held when the menu opened will never deliver its keyup to the game.
		const suspend = (on: boolean) => {
			this.suspended = on;
			if (on) clearAll();
		};

		window.addEventListener("keydown", keydown);
		window.addEventListener("keyup", keyup);
		window.addEventListener("blur", clearAll);
		window.addEventListener("pointermove", pointerMove);
		window.addEventListener("pointerdown", pointerDown);
		window.addEventListener("pointerup", pointerUp);
		canvas.addEventListener("contextmenu", contextMenu);
		const offSuspend = EventBus.on("input-suspended", ((on: boolean) =>
			suspend(on)) as never);

		// The on-screen gamepad talks over the EventBus, the same bridge the rest of
		// the React overlay uses. It sends *codes*, not actions, so a thumb on the
		// deck's A button is bound and rebound exactly like a key — and the deck
		// itself has no idea what any of its buttons do.
		const offVirtual = EventBus.on("virtual-button", ((payload: {
			code: string;
			down: boolean;
		}) => {
			if (this.suspended) return;
			if (payload.down) {
				if (!this.virtual.has(payload.code)) {
					this.virtual.add(payload.code);
					this.notePress(bindings.actionFor(payload.code));
				}
			} else {
				this.virtual.delete(payload.code);
			}
		}) as never);
		const offVirtualAim = EventBus.on("virtual-aim", ((
			vector: { x: number; y: number } | null,
		) => {
			this.touchAim = this.suspended ? null : vector;
		}) as never);
		const offVirtualContra = EventBus.on("virtual-contra", ((
			vector: { x: number; y: number } | null,
		) => {
			this.touchContra = this.suspended ? null : vector;
		}) as never);

		this.disposers.push(
			() => window.removeEventListener("keydown", keydown),
			() => window.removeEventListener("keyup", keyup),
			() => window.removeEventListener("blur", clearAll),
			() => window.removeEventListener("pointermove", pointerMove),
			() => window.removeEventListener("pointerdown", pointerDown),
			() => window.removeEventListener("pointerup", pointerUp),
			() => canvas.removeEventListener("contextmenu", contextMenu),
			offSuspend,
			offVirtual,
			offVirtualAim,
			offVirtualContra,
		);
	}

	isDown(code: string): boolean {
		return (
			this.down.has(code) || this.virtual.has(code) || this.padDown.has(code)
		);
	}

	/** True while any code bound to `action` is held, on any device. */
	actionDown(action: Action): boolean {
		for (const code of bindings.codesFor(action)) {
			if (this.isDown(code)) return true;
		}
		return false;
	}

	/**
	 * Is the attack / fire button held?
	 *
	 * The ordinary path is any code bound to the attack action. There is one
	 * deck-only extra path on top: on a phone, the right thumb lives on the aim
	 * stick, and in gun mode a phone has no spare finger for the fire button — so
	 * the aim stick is the trigger too. Touching it both aims (the fine layer)
	 * and fires, which is what makes a phone gun a twin-stick shooter rather than
	 * a trap where aiming and firing are mutually exclusive.
	 *
	 * Deliberately the on-screen stick only, and gun mode only. A *physical*
	 * right stick has a trigger to hand, so it must not fire by itself; and in
	 * sword mode a touch of the aim stick must not slash. Like every other input
	 * fact here, this travels as `attack` in the intent — the simulation never
	 * learns that a thumb made it, so it cannot desync anything.
	 */
	private attackDown(): boolean {
		if (this.actionDown("attack")) return true;
		if (this.touchAim === null) return false;
		return inputSettings.scheme === "controller" && !this.swordStance;
	}

	/**
	 * Double-tap dash detection.
	 *
	 * This is the one place edge detection belongs in the input layer, because a
	 * dash is a *gesture* rather than a button: the simulation is handed the
	 * resulting impulse, not the taps. It stays outside `PlayerIntent` for the
	 * same reason — see how the impulse is applied in `Match`.
	 *
	 * The timing lives in `DoubleTapDash` so it can be tested against a fake clock.
	 */
	private readonly dashGesture = new DoubleTapDash();

	/**
	 * A press edge, routed by what the button *means* rather than which one it is.
	 *
	 * Stance and the AI toggle are edge-triggered here because they are not part
	 * of `PlayerIntent`'s per-tick button state — stance is absolute and the
	 * toggle is a debug switch, so neither can be re-derived by the simulation.
	 */
	private notePress(action: Action | undefined) {
		if (action === undefined) return;
		if (action === "left") this.dashGesture.press(-1, performance.now());
		if (action === "right") this.dashGesture.press(1, performance.now());
		if (action === "sword") {
			this.swordStance = true;
			// The deck draws different buttons in each stance, and the stance is
			// owned here — so a press that flips it tells React over the same
			// bridge the rest of the overlay talks over.
			EventBus.emit("stance-changed", true);
		}
		if (action === "gun") {
			this.swordStance = false;
			EventBus.emit("stance-changed", false);
		}
		if (action === "toggleAi") this.onToggleAi?.();
	}

	/** Take the dash direction, if one was gestured since the last call. */
	consumeDash(): number {
		return this.dashGesture.consume();
	}

	/**
	 * One frame of the polled devices, and one step of the aim handover.
	 *
	 * Called once per frame by `Match`, **before** the aim angle and the intent
	 * are read. Everything evented — keys, mouse buttons, the deck — has already
	 * updated itself by the time this runs; what is left is the gamepad, which the
	 * platform gives no events for, and the aim controller, which needs a `dtMs`.
	 *
	 * `facing` is only a fallback: it decides where a controller aims before it
	 * has ever pointed anywhere, so a fighter that spawns looking left does not
	 * open the match aiming across itself.
	 */
	poll(dtMs: number, facing: number) {
		const frame = this.pad.poll();
		// A menu that has taken the keyboard has taken the controller too. Otherwise
		// a held trigger would keep blocking behind the dialog, and nothing would
		// deliver its release.
		this.padDown = this.suspended ? EMPTY_CODES : frame.down;

		// Press edges, derived rather than delivered — the Gamepad API has no button
		// events, so without this a held button would read as a press every frame
		// and simply holding a direction would count as a dash.
		for (const code of this.padDown) {
			if (!this.padPrevious.has(code)) this.notePress(bindings.actionFor(code));
		}
		this.padPrevious = new Set(this.padDown);

		// A scheme change is a clean break. The aim controller stops being ticked the
		// moment mouse aim takes over, so its stick, its blend and its idle timer all
		// freeze — and coming back to controller mode would resume a stroke the player
		// made minutes ago, at an angle they have long since stopped meaning.
		const scheme = inputSettings.scheme;
		if (scheme !== this.lastScheme) {
			this.lastScheme = scheme;
			this.aim.reset(facing);
			this.hadAbsoluteFine = false;
			this.mouseDeltaX = 0;
			this.mouseDeltaY = 0;
		}

		if (scheme !== "controller") {
			// Nothing to accumulate into: the cursor is the aim. Draining the delta
			// anyway stops a switch into controller mode inheriting a whole window's
			// worth of mouse travel as one enormous flick.
			this.mouseDeltaX = 0;
			this.mouseDeltaY = 0;
			this.hadAbsoluteFine = false;
			return;
		}

		// The Contra layer: the same buttons that move you also aim you, which is
		// what makes aiming cost nothing extra to hold. An analog source — the left
		// stick, or a thumb on the deck's cross — aims at the angle it is pushed,
		// which is more than eight directions; only the d-pad and the arrow keys
		// are stuck with the eight their {-1, 0, 1} pairs can name. The analog
		// source wins while it is being held, because it is a superset of the
		// direction its codes resolve to.
		const contraVector = this.touchContra ?? frame.contra;
		if (contraVector) {
			this.aim.setContra(contraVector.x, contraVector.y, facing);
		} else {
			const x =
				(this.actionDown("right") ? 1 : 0) - (this.actionDown("left") ? 1 : 0);
			const y =
				(this.actionDown("aimDown") ? 1 : 0) -
				(this.actionDown("aimUp") ? 1 : 0);
			this.aim.setContra(x, y, facing);
		}

		// The fine layer, in priority order: a real right stick, then a thumb on the
		// deck, then the mouse. The first two are absolute and recentre themselves;
		// the mouse is relative and does not, which is the whole reason `AimController`
		// distinguishes the two.
		const absolute = frame.fine ?? this.touchAim;
		if (absolute) {
			this.aim.setFine(absolute.x, absolute.y);
		} else if (this.hadAbsoluteFine) {
			// The stick was let go. Say so exactly once, or the aim controller would
			// keep seeing it pushed and hold the override open for its full window.
			this.aim.setFine(0, 0);
		} else if (this.mouseDeltaX !== 0 || this.mouseDeltaY !== 0) {
			this.aim.pushFine(this.mouseDeltaX, this.mouseDeltaY);
		}
		this.hadAbsoluteFine = absolute !== null;

		this.mouseDeltaX = 0;
		this.mouseDeltaY = 0;
		this.aim.update(dtMs);
	}

	/** True once a gamepad has reported anything, so the menu can say so. */
	get padAvailable(): boolean {
		return this.pad.available;
	}

	/** What the two aim layers are doing, for the HUD and for `scripts/pad-probe.mjs`. */
	aimReport(): AimReport {
		return this.aim.report();
	}

	// -------------------------------------------------------------------------
	// Programmatic control
	//
	// The training room's `__training.input()` drives the fighter through here,
	// *above* the keyboard rather than beside it. A second input path would mean
	// an agent tested something a player can never produce; layered on top, what
	// it drives is exactly what a keyboard drives.
	//
	// Playwright can press keys, but it cannot express "hold attack for exactly
	// 420ms and release on this frame" — which is the whole of the Massive
	// Strike, and half of the frame data.
	// -------------------------------------------------------------------------

	private overrideIntent: Partial<PlayerIntent> | null = null;
	private overrideAim: number | null = null;
	private overrideUntilMs = 0;
	/**
	 * How many times the override has been read into an intent.
	 *
	 * A hold shorter than a frame would otherwise be set and cleared between two
	 * reads and never reach the simulation at all — an input that silently did
	 * not happen, which is the worst possible failure for an instrument.
	 */
	private overrideReads = 0;
	private static readonly MIN_OVERRIDE_READS = 2;

	get overrideActive(): boolean {
		return this.overrideIntent !== null;
	}

	/** Hold a set of buttons for `holdMs`, then fall back to the keyboard. */
	hold(intent: Partial<PlayerIntent>, holdMs: number, aimAngle?: number) {
		this.overrideIntent = intent;
		this.overrideAim = aimAngle ?? null;
		this.overrideUntilMs = performance.now() + Math.max(0, holdMs);
		this.overrideReads = 0;
	}

	/** Drop back to the keyboard immediately. */
	releaseOverride() {
		this.overrideIntent = null;
		this.overrideAim = null;
		this.overrideUntilMs = 0;
		this.overrideReads = 0;
	}

	private takeOverride(): Partial<PlayerIntent> | null {
		if (!this.overrideIntent) return null;
		const expired =
			performance.now() >= this.overrideUntilMs &&
			this.overrideReads >= Input.MIN_OVERRIDE_READS;
		if (expired) {
			this.releaseOverride();
			return null;
		}
		this.overrideReads++;
		return this.overrideIntent;
	}

	/**
	 * Where this fighter is aiming.
	 *
	 * With a cursor it is the vector to a point on the screen. Without one it is
	 * the Contra aim, overridden by the fine stick while that is being held — and
	 * the fighter's position is irrelevant, because a direction is not a place.
	 * The simulation is handed the same number either way.
	 */
	aimAngle(bodyX: number, bodyY: number): number {
		if (this.overrideIntent && this.overrideAim !== null) {
			return this.overrideAim;
		}
		if (inputSettings.scheme === "controller") return this.aim.angle;
		const c = bodyCentre(bodyX, bodyY);
		return Math.atan2(this.pointerY - c.y, this.pointerX - c.x);
	}

	/** Build one tick of simulation intent from the current button state. */
	intent(aimAngle: number): PlayerIntent {
		const override = this.takeOverride();
		if (override) {
			return {
				...NEUTRAL_INTENT,
				// Facing still follows the aim unless the caller states otherwise, so
				// a programmatic slash points where a player's would.
				face: faceFor(aimAngle),
				...override,
			};
		}
		return {
			...NEUTRAL_INTENT,
			left: this.actionDown("left"),
			right: this.actionDown("right"),
			up: this.actionDown("jump"),
			attack: this.attackDown(),
			block: this.actionDown("block"),
			uppercut: this.actionDown("uppercut"),
			swordStance: this.swordStance,
			// You face where you aim. That is what lets a player retreat while still
			// guarding the side the attacker is coming from.
			face: faceFor(aimAngle),
			// The dash gesture is *not* consumed here — it is pulled at the
			// fixed-step boundary instead. A rendered frame can run zero physics
			// steps (on a 120Hz+ display, roughly half of them), and a one-shot
			// consumed into a frame that ran none was dropped on the floor: the
			// player double-tapped and nothing happened, which read as a cooldown
			// far longer than the 250ms lockout. See `withDash` — the fixed step
			// pulls the gesture only when one actually runs.
			dash: 0,
		};
	}

	/**
	 * Fold a pending dash gesture into one fixed-step intent.
	 *
	 * `dash` is the only one-shot in `PlayerIntent`; every other field is held
	 * button state, so it is the only one that must be delivered *when a step
	 * runs* rather than whenever the rendered frame happened to poll. When the
	 * intent already carries a dash — a local AI brain, or a training override
	 * that spread one through `intent()` — that one wins and the gesture is left
	 * for later.
	 */
	static withDash(intent: PlayerIntent, gesture: number): PlayerIntent {
		if (intent.dash !== 0 || gesture === 0) return intent;
		return { ...intent, dash: gesture };
	}

	destroy() {
		for (const d of this.disposers) d();
		this.disposers.length = 0;
	}
}
