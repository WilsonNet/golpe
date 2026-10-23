/**
 * The first-time tutorial card: whether it has been answered.
 *
 * The home screen is a short list, so the guided course lives behind *More* —
 * most players do not need it. A newcomer, though, is exactly the player who
 * does not know that the good moves exist; they get offered the course once,
 * in a card, before the menu settles. Answering it either way is remembered
 * here, in `localStorage` like the name and the bindings: never the wire, and
 * never a nag.
 *
 * Clicking *Play the tutorial* also records the answer. The prompt's job is to
 * introduce the course, and it has done that the moment somebody accepts — a
 * player who quits on lesson one has still seen the offer, and the course stays
 * in *More* for them to come back to.
 */

const KEY = "golpe.tutorialPromptDismissed";

/**
 * Whether this browser has already answered the card.
 *
 * Storage that throws (private mode, a blocked origin, hand-edited state)
 * counts as *answered*: an offer that can never be silenced is worse than an
 * offer never made. The course is still one click away in *More*.
 */
export function tutorialPromptDismissed(): boolean {
	try {
		return window.localStorage.getItem(KEY) === "1";
	} catch {
		return true;
	}
}

/** Remember, forever, that the player has answered the first-time card. */
export function dismissTutorialPromptForever() {
	try {
		window.localStorage.setItem(KEY, "1");
	} catch {
		// Same reasoning: losing the record costs one card, throwing costs the menu.
	}
}
