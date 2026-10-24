/**
 * The on-screen deck's contract with the input layer.
 *
 * **The deck speaks actions, not pad codes.** That is the opposite of what it
 * used to do, and the reversal is deliberate. A physical device speaks codes
 * because a player can rebind it; a *painted* control is already a binding —
 * the button that says Guard is the guard. Emitting `Pad6` meant rebinding
 * block to `Pad1` silently turned the deck's Guard button into the ultimate
 * and left the guard unreachable. Emitting `block` makes the label true no
 * matter what the keyboard and the gamepad are doing.
 *
 * The deck is therefore an input source beside the network queue and the AI
 * brain, not a fake gamepad. Physical keys, mouse buttons and pad buttons still
 * share one code alphabet (see `Bindings.ts`); the deck joins at the *action*
 * layer, which is the layer the simulation already consumes.
 *
 * Everything here is pure maths and constants so the layout can be unit-tested
 * without a DOM, and so the feel numbers live in one place rather than in a
 * React component's JSX.
 */

import type { Action } from "./Bindings";

/** Event names on the `EventBus`, so both sides cannot drift. */
export const DECK_EVENTS = {
	/** `{ action, down }` — a painted control pressed or released. */
	action: "deck-action",
	/** `-1 | 1` — the dash button, which is a one-shot rather than a held button. */
	dash: "deck-dash",
} as const;

/** What a deck button sends. */
export interface DeckAction {
	action: Action;
	down: boolean;
}

/**
 * How far the thumb must travel before the move pad reads a direction.
 *
 * In CSS pixels, measured from the pad's centre. 14px is deliberate: a thumb
 * resting on the pad has a contact patch wider than this, but the *centroid*
 * does not wander 14px, and walking is full speed from the first pixel of
 * intent. The release threshold is tighter than the press, which is the
 * hysteresis that stops a thumb sitting exactly on the line from stuttering
 * left/right sixty times a second.
 */
export const MOVE_PRESS_PX = 14;
export const MOVE_RELEASE_PX = 8;

/**
 * How far above the pad's centre the jump band begins.
 *
 * The pad is a rocker with a jump cap, not a d-pad: pushing up 44px jumps
 * while the horizontal position keeps steering, so a running jump is one thumb
 * movement rather than two controls. The band has to be far enough up that a
 * hard diagonal walk cannot graze it.
 */
const JUMP_BAND_PX = 44;

/**
 * The shortest a jump is allowed to be held by the deck.
 *
 * The simulation cuts a jump when the button is released, and a phone tap is
 * 60-100ms — which produced a 76px hop out of a 136px jump. **A tap on glass
 * is not a tap on a keyboard**: nobody holds a key for 300ms to jump, they
 * press it while doing something else. 320ms is just short of the jump's 389ms
 * apex, so a tap reaches ~93% of full height (127px of 136 measured). The latch
 * is a floor, not a ceiling: a short hop is not available from a tap, and a
 * second tap inside it flushes the release and re-presses for the double jump.
 * It is an input-layer latch, so both sides simulate exactly the same button.
 */
export const JUMP_MIN_HOLD_MS = 320;

/**
 * How long the ultimate button must be held before it arms.
 *
 * The ultimate is a 60-second resource and the press is also the start of its
 * aim phase. 260ms is long enough that a brush of the thumb does nothing, and
 * short enough that it is not a second gesture to learn.
 */
export const ULT_ARM_MS = 260;

/**
 * How long the item's press is held on release.
 *
 * The item is used on the **press edge**, with the aim angle of that press.
 * A drag-aimed throw therefore withholds the press until the thumb comes up and
 * then holds it for a few frames, so the server sees the press at the angle the
 * player released on. One frame would be enough; 90ms survives a bad frame.
 */
export const ITEM_PULSE_MS = 90;

/**
 * Below this deflection a drag is a tap, not an aim.
 *
 * **One deadzone, and it matches the aim controller's.** The old deck had two:
 * a 0.18 emission threshold under a 0.25 `setFine` threshold, so a thumb in
 * between showed a nub and moved nothing. A drag is measured from where the
 * thumb *landed*, not from the button's centre, so this is how far the thumb
 * has travelled — 12px at the 48px drag radius, about one contact patch.
 */
export const DRAG_DEADZONE = 0.25;

/**
 * How far a thumb must travel to push a drag to the rim.
 *
 * Independent of the button's size: the weapon button and the 56px item should
 * need the same gesture, and a small button must not become a hair-trigger.
 */
export const AIM_DRAG_RADIUS_PX = 48;

/**
 * The direction the move pad reads from a horizontal offset.
 *
 * `current` is the direction it read last frame, which is what supplies the
 * hysteresis. Pure, so the boundary behaviour is pinned by a test rather than
 * discovered by a player whose fighter stutters on the centre line.
 */
export function moveDirection(dx: number, current: -1 | 0 | 1 = 0): -1 | 0 | 1 {
	if (dx <= -MOVE_PRESS_PX) return -1;
	if (dx >= MOVE_PRESS_PX) return 1;
	if (current === -1 && dx < -MOVE_RELEASE_PX) return -1;
	if (current === 1 && dx > MOVE_RELEASE_PX) return 1;
	return 0;
}

/**
 * True while a thumb is on the painted jump cap.
 *
 * `dy` is measured from the pad's centre, and the cap is the top
 * `JUMP_BAND_PX` of the pad — so the boundary depends on how tall the pad is.
 * Getting this from the pad's real height is what makes the thing a player
 * sees the thing that jumps; a fixed centre offset drifted a few pixels into
 * the move lane on one screen and stopped short of the cap on another.
 */
export function inJumpBand(dy: number, padHeight: number): boolean {
	return dy <= JUMP_BAND_PX - padHeight / 2;
}

/**
 * A drag on a button as an absolute aim vector, clamped to the rim.
 *
 * The caller measures the offset from **where the thumb landed**, not from the
 * button's centre: a tap is zero displacement and keeps the facing, while a
 * drag is exactly what the thumb did. Measuring from the centre made an
 * off-centre press an arbitrary aim.
 */
export function dragVector(
	dx: number,
	dy: number,
	radius: number,
): { x: number; y: number; magnitude: number } {
	if (radius <= 0) return { x: 0, y: 0, magnitude: 0 };
	let x = dx / radius;
	let y = dy / radius;
	const magnitude = Math.hypot(x, y);
	if (magnitude > 1) {
		x /= magnitude;
		y /= magnitude;
	}
	return { x, y, magnitude: Math.min(1, magnitude) };
}
