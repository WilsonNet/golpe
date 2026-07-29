/**
 * Raw keyboard and mouse state.
 *
 * Deliberately dumb: it records which buttons are down and where the cursor is,
 * and nothing else. **Edge detection does not belong here.** The simulation does
 * its own — jump height is analogue, a slash needs a press edge, a Massive fires
 * on release — and detecting edges in two places would mean the client and the
 * server disagreed about what a given frame's input was.
 */

import { bodyCentre } from "../render/ArenaRenderer";
import { NEUTRAL_INTENT, type PlayerIntent } from "../simulation/Physics";

export const KEYS = {
	up: "KeyW",
	left: "KeyA",
	down: "KeyS",
	right: "KeyD",
	sword: "KeyQ",
	gun: "KeyE",
	/**
	 * Uppercut. On its own key rather than sharing right-click with block: a
	 * hold/tap split on one button would make the two moves ambiguous at exactly
	 * the moment precision matters. See specs/melee.md.
	 */
	uppercut: "KeyF",
	toggleAi: "KeyP",
} as const;

/** Two taps inside this window are a dash rather than two steps. */
const DOUBLE_TAP_MS = 200;

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
	private readonly down = new Set<string>();
	private leftMouse = false;
	private rightMouse = false;

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
			// Browsers repeat a held key. A repeat is not a press, and treating it
			// as one would make simply holding a direction read as a dash.
			if (!e.repeat) this.notePress(e.code);
			this.down.add(e.code);
			if (e.code === KEYS.sword) this.swordStance = true;
			if (e.code === KEYS.gun) this.swordStance = false;
			if (e.code === KEYS.toggleAi) this.onToggleAi?.();
		};
		const keyup = (e: KeyboardEvent) => this.down.delete(e.code);

		// Chording sword-fighting inputs means several keys and buttons are held
		// at once; losing focus mid-exchange would otherwise leave them stuck down
		// forever, and the fighter would keep swinging at nothing.
		const clearAll = () => {
			this.down.clear();
			this.leftMouse = false;
			this.rightMouse = false;
			this.lastPress = {};
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
			if (e.button === 0) this.leftMouse = true;
			if (e.button === 2) this.rightMouse = true;
		};
		const pointerUp = (e: PointerEvent) => {
			if (e.button === 0) this.leftMouse = false;
			if (e.button === 2) this.rightMouse = false;
		};
		const contextMenu = (e: Event) => e.preventDefault();

		window.addEventListener("keydown", keydown);
		window.addEventListener("keyup", keyup);
		window.addEventListener("blur", clearAll);
		window.addEventListener("pointermove", pointerMove);
		window.addEventListener("pointerdown", pointerDown);
		window.addEventListener("pointerup", pointerUp);
		canvas.addEventListener("contextmenu", contextMenu);

		this.disposers.push(
			() => window.removeEventListener("keydown", keydown),
			() => window.removeEventListener("keyup", keyup),
			() => window.removeEventListener("blur", clearAll),
			() => window.removeEventListener("pointermove", pointerMove),
			() => window.removeEventListener("pointerdown", pointerDown),
			() => window.removeEventListener("pointerup", pointerUp),
			() => canvas.removeEventListener("contextmenu", contextMenu),
		);
	}

	isDown(code: string): boolean {
		return this.down.has(code);
	}

	/**
	 * Double-tap dash detection.
	 *
	 * This is the one place edge detection belongs in the input layer, because a
	 * dash is a *gesture* rather than a button: the simulation is handed the
	 * resulting impulse, not the taps. It stays outside `PlayerIntent` for the
	 * same reason — see how the impulse is applied in `Match`.
	 */
	private lastPress: Record<string, number> = {};
	private pendingDash = 0;

	private notePress(code: string) {
		if (code !== KEYS.left && code !== KEYS.right) return;
		const now = performance.now();
		const previous = this.lastPress[code] ?? -Infinity;
		if (now - previous < DOUBLE_TAP_MS) {
			this.pendingDash = code === KEYS.left ? -1 : 1;
			// Consume the pair, so a third tap has to start a fresh gesture rather
			// than chaining a dash off every subsequent press.
			this.lastPress[code] = -Infinity;
			return;
		}
		this.lastPress[code] = now;
	}

	/** Take the dash direction, if one was gestured since the last call. */
	consumeDash(): number {
		const d = this.pendingDash;
		this.pendingDash = 0;
		return d;
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
			left: this.isDown(KEYS.left),
			right: this.isDown(KEYS.right),
			up: this.isDown(KEYS.up),
			attack: this.leftMouse,
			block: this.rightMouse,
			uppercut: this.isDown(KEYS.uppercut),
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
