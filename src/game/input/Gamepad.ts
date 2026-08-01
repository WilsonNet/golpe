/**
 * A physical gamepad, read as codes.
 *
 * **Pad buttons live in the same namespace as keys and mouse buttons.** A
 * binding is a code string — `KeyboardEvent.code` for keys, `Mouse0` for the
 * pointer, `Pad0`/`PadUp` here — which is what lets a player put block on the
 * left trigger without the input layer growing a third code path, and lets them
 * put it back. `Input` asks "is any code bound to block held", and that question
 * has one answer only if every device answers in the same alphabet. See
 * `Bindings.ts`, which made the same argument about the mouse.
 *
 * **The d-pad and the left stick produce the same four codes.** Both are the
 * Contra input — move and aim at once — so quantising the stick to the d-pad's
 * alphabet means there is exactly one movement path, and the double-tap dash
 * gesture works off a stick flick for free. But the left stick also keeps its
 * raw deflection (see `PadFrame.contra`): the *aim* follows the angle the stick
 * is pushed at, not just the nearest of eight. The d-pad has no deflection, so
 * it stays eight.
 *
 * **The right stick does not become codes.** It is an angle, not a button, so it
 * goes to `AimController` as a vector. Quantising it would throw away the whole
 * point of it — it is the layer that is *not* eight directions.
 *
 * The Gamepad API has no events for button state: `navigator.getGamepads()`
 * returns a fresh snapshot and you poll it. There is nothing to unsubscribe, and
 * nothing here holds a reference across a frame.
 */

import { quantise8, STICK_DEADZONE, type Vec2 } from "./Aim";

/** The four directional codes, shared by the d-pad and the left stick. */
export const PAD_UP = "PadUp";
export const PAD_DOWN = "PadDown";
export const PAD_LEFT = "PadLeft";
export const PAD_RIGHT = "PadRight";

/**
 * Standard-mapping button indices that become `Pad<n>` codes.
 *
 * 12–15 are missing on purpose: those are the d-pad, and they come out as the
 * four directional codes above instead. Two codes for one physical button would
 * mean a player could bind the d-pad twice and have one of the bindings silently
 * lose.
 */
const DPAD = { up: 12, down: 13, left: 14, right: 15 } as const;

/** How a pad code reads in the controls dialog. */
const PAD_LABELS: Record<string, string> = {
	[PAD_UP]: "Pad Up",
	[PAD_DOWN]: "Pad Down",
	[PAD_LEFT]: "Pad Left",
	[PAD_RIGHT]: "Pad Right",
	Pad0: "Pad A",
	Pad1: "Pad B",
	Pad2: "Pad X",
	Pad3: "Pad Y",
	Pad4: "Pad LB",
	Pad5: "Pad RB",
	Pad6: "Pad LT",
	Pad7: "Pad RT",
	Pad8: "Pad Back",
	Pad9: "Pad Start",
	Pad10: "Pad L3",
	Pad11: "Pad R3",
	Pad16: "Pad Guide",
};

/** A gamepad button index, in the same namespace as keys and mouse buttons. */
export function padCode(button: number): string {
	return `Pad${button}`;
}

/** True for any code this module can produce. */
export function isPadCode(code: string): boolean {
	return code.startsWith("Pad");
}

/** A pad code as a player would recognise it, or undefined if it is not one. */
export function padLabel(code: string): string | undefined {
	if (!isPadCode(code)) return undefined;
	return PAD_LABELS[code] ?? code.replace("Pad", "Pad ");
}

/**
 * One frame of gamepad state.
 */
export interface PadFrame {
	/** True while at least one pad is connected and reporting. */
	connected: boolean;
	/** Every code held this frame. */
	down: Set<string>;
	/**
	 * The left stick, as a raw unit-ish vector, or null while it rests in its
	 * deadzone. The **analog** Contra aim: it is not quantised here, because the
	 * d-pad already speaks the four direction codes and an analog stick exists to
	 * say the angles in between. Null means "no analog contra input", not "aim
	 * right".
	 */
	contra: Vec2 | null;
	/**
	 * The right stick, as a unit-ish vector, or null while it rests in its
	 * deadzone. Null means "nobody is fine-aiming", not "aim right".
	 */
	fine: Vec2 | null;
}

const EMPTY: PadFrame = {
	connected: false,
	down: new Set(),
	contra: null,
	fine: null,
};

/**
 * Poll every connected pad and fold them into one frame.
 *
 * Deliberately merged rather than "pad 0 wins". A player who plugs in a second
 * controller, or whose browser reports a phantom pad at index 0, should not have
 * to work out which slot the game decided to listen to — and there is exactly
 * one local fighter, so there is nothing to keep apart.
 */
export function readPads(
	pads: readonly (Gamepad | null)[] | null | undefined,
): PadFrame {
	if (!pads) return EMPTY;
	const down = new Set<string>();
	let connected = false;
	let contra: Vec2 | null = null;
	let fine: Vec2 | null = null;

	for (const pad of pads) {
		if (!pad?.connected) continue;
		connected = true;

		for (let i = 0; i < pad.buttons.length; i++) {
			if (!pad.buttons[i]?.pressed) continue;
			if (i === DPAD.up) down.add(PAD_UP);
			else if (i === DPAD.down) down.add(PAD_DOWN);
			else if (i === DPAD.left) down.add(PAD_LEFT);
			else if (i === DPAD.right) down.add(PAD_RIGHT);
			else down.add(padCode(i));
		}

		// The left stick joins the d-pad rather than replacing it, so a player can
		// use either — or both, mid-match, without a mode to switch. It quantises
		// to the same four codes for *movement*, so the dash gesture works off a
		// stick flick and walking stays left or right — and it also keeps its raw
		// deflection, so the Contra *aim* can be any angle, not just the eight the
		// codes can name. A d-pad has no deflection to offer, which is the whole
		// difference between the two inputs.
		const lx = pad.axes[0] ?? 0;
		const ly = pad.axes[1] ?? 0;
		const step = quantise8(lx, ly);
		if (step.x < 0) down.add(PAD_LEFT);
		if (step.x > 0) down.add(PAD_RIGHT);
		if (step.y < 0) down.add(PAD_UP);
		if (step.y > 0) down.add(PAD_DOWN);
		if (Math.hypot(lx, ly) >= STICK_DEADZONE) {
			if (!contra || Math.hypot(lx, ly) > Math.hypot(contra.x, contra.y)) {
				contra = { x: lx, y: ly };
			}
		}

		const rx = pad.axes[2] ?? 0;
		const ry = pad.axes[3] ?? 0;
		// The largest deflection across pads wins, so a resting second controller
		// cannot argue the aim back to centre.
		if (Math.hypot(rx, ry) >= STICK_DEADZONE) {
			if (!fine || Math.hypot(rx, ry) > Math.hypot(fine.x, fine.y)) {
				fine = { x: rx, y: ry };
			}
		}
	}

	return { connected, down, contra, fine };
}

/**
 * The live gamepad, polled once per frame.
 *
 * A thin wrapper over `readPads` so `Input` has something to hold, and so the
 * "is a pad plugged in at all" question — which decides whether the game
 * suggests controller mode — has one owner.
 */
export class GamepadSource {
	private frame: PadFrame = EMPTY;
	/** Latched: a pad that was used once should not un-suggest itself at rest. */
	private everConnected = false;

	poll(): PadFrame {
		const pads =
			typeof navigator !== "undefined" && navigator.getGamepads
				? navigator.getGamepads()
				: null;
		this.frame = readPads(pads);
		if (this.frame.connected) this.everConnected = true;
		return this.frame;
	}

	get current(): PadFrame {
		return this.frame;
	}

	get available(): boolean {
		return this.everConnected;
	}
}
