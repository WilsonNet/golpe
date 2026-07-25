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

export class Input {
	private readonly down = new Set<string>();
	private leftMouse = false;
	private rightMouse = false;

	/** Cursor in world coordinates. */
	pointerX = 0;
	pointerY = 0;

	/** Absolute, never a toggle — a toggle cannot survive a dropped packet. */
	swordStance = true;

	private readonly onToggleAi: (() => void) | undefined;
	private readonly disposers: (() => void)[] = [];

	constructor(canvas: HTMLCanvasElement, onToggleAi?: () => void) {
		this.onToggleAi = onToggleAi;

		const keydown = (e: KeyboardEvent) => {
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
			const rect = canvas.getBoundingClientRect();
			// Scale from CSS pixels to world pixels: the canvas is letterboxed, so
			// the two only coincide at exactly 1:1.
			this.pointerX = ((e.clientX - rect.left) / rect.width) * canvas.width;
			this.pointerY = ((e.clientY - rect.top) / rect.height) * canvas.height;
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

	/** Angle from a fighter's centre to the cursor. */
	aimAngle(bodyX: number, bodyY: number): number {
		const c = bodyCentre(bodyX, bodyY);
		return Math.atan2(this.pointerY - c.y, this.pointerX - c.x);
	}

	/** Build one tick of simulation intent from the current button state. */
	intent(aimAngle: number): PlayerIntent {
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
