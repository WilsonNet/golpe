/**
 * When the fighter is under a hand, the hand gets out of the way.
 *
 * A phone's controls sit over the arena's bottom corners. In a one-screen room
 * the camera cannot scroll, so a fighter at the left or right edge stands
 * directly under the move pad or the kit column — and an opaque button hides
 * the player's own feet. The deck fades the *hand* the fighter is under to a
 * third opacity; the controls stay hit-testable, and they return as soon as the
 * fighter walks out.
 *
 * Pure, so the thresholds are pinned by a test rather than tuned by a player
 * losing an exchange to their own UI. The fractions are of the visible arena,
 * which is what `HudState.playerScreenX/Y` carries.
 */

/** How far into the left third counts as "under the left hand". */
export const HAND_LEFT_X = 0.3;

/** How far into the right third counts as "under the right hand". */
export const HAND_RIGHT_X = 0.7;

/** The bottom of the arena, where the hands live. */
export const HAND_FADE_Y = 0.55;

export type FadedHand = "left" | "right" | null;

/**
 * Which hand, if any, the fighter is standing under.
 *
 * The middle 40% never fades: the hands are in the corners, and a control that
 * fades while the fighter is mid-arena is a control that flickers for no
 * reason.
 */
export function fadedHandFor(x: number, y: number): FadedHand {
	if (y < HAND_FADE_Y) return null;
	if (x < HAND_LEFT_X) return "left";
	if (x > HAND_RIGHT_X) return "right";
	return null;
}
