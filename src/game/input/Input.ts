/**
 * Raw keyboard and mouse state.
 *
 * Deliberately dumb: it records which buttons are down and where the cursor is,
 * and nothing else. **Edge detection does not belong here.** The simulation does
 * its own — jump height is analogue, a slash needs a press edge, a Massive fires
 * on release — and detecting edges in two places would mean the client and the
 * server disagreed about what a given frame's input was.
 */

import { EventBus } from "../EventBus";
import { bodyCentre } from "../render/ArenaRenderer";
import { NEUTRAL_INTENT, type PlayerIntent } from "../simulation/Physics";
import { type Action, bindings, mouseCode } from "./Bindings";

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
		};

		const pointerDown = (e: PointerEvent) => {
			if (this.suspended) return;
			const code = mouseCode(e.button);
			this.down.add(code);
			this.notePress(bindings.actionFor(code));
		};
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

		this.disposers.push(
			() => window.removeEventListener("keydown", keydown),
			() => window.removeEventListener("keyup", keyup),
			() => window.removeEventListener("blur", clearAll),
			() => window.removeEventListener("pointermove", pointerMove),
			() => window.removeEventListener("pointerdown", pointerDown),
			() => window.removeEventListener("pointerup", pointerUp),
			() => canvas.removeEventListener("contextmenu", contextMenu),
			offSuspend,
		);
	}

	isDown(code: string): boolean {
		return this.down.has(code);
	}

	/** True while any code bound to `action` is held. */
	actionDown(action: Action): boolean {
		for (const code of bindings.codesFor(action)) {
			if (this.down.has(code)) return true;
		}
		return false;
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
		if (action === "sword") this.swordStance = true;
		if (action === "gun") this.swordStance = false;
		if (action === "toggleAi") this.onToggleAi?.();
	}

	/** Take the dash direction, if one was gestured since the last call. */
	consumeDash(): number {
		return this.dashGesture.consume();
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

	/** Angle from a fighter's centre to the cursor. */
	aimAngle(bodyX: number, bodyY: number): number {
		if (this.overrideIntent && this.overrideAim !== null) {
			return this.overrideAim;
		}
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
				face: Math.cos(aimAngle) >= 0 ? 1 : -1,
				...override,
			};
		}
		return {
			...NEUTRAL_INTENT,
			left: this.actionDown("left"),
			right: this.actionDown("right"),
			up: this.actionDown("jump"),
			attack: this.actionDown("attack"),
			block: this.actionDown("block"),
			uppercut: this.actionDown("uppercut"),
			swordStance: this.swordStance,
			// You face where you aim. That is what lets a player retreat while still
			// guarding the side the attacker is coming from.
			face: Math.cos(aimAngle) >= 0 ? 1 : -1,
			// One-shot: consumed here so the impulse is sent exactly once, and the
			// server applies the same tick the client predicted.
			dash: this.consumeDash(),
		};
	}

	destroy() {
		for (const d of this.disposers) d();
		this.disposers.length = 0;
	}
}
