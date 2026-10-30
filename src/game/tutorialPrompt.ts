/**
 * The first-time tutorial card: whether it has been answered.
 *
 * The guided course lives under the hero picker — it teaches *this* kit, so it
 * belongs where the kit is chosen. A newcomer is exactly the player who does
 * not know that the good moves exist; they get offered the course once, in a
 * card, before the menu settles. Answering it either way is remembered here,
 * in `localStorage` like the name and the bindings: never the wire, and never a
 * nag.
 *
 * Clicking *Play the tutorial* also records the answer. The prompt's job is to
 * introduce the course, and it has done that the moment somebody accepts — a
 * player who quits on lesson one has still seen the offer, and the course stays
 * under the picker for them to come back to.
 *
 * **Skip is the session's answer, not the browser's.** A player who waves the
 * card away has not told us they never want it; the card returns next launch.
 * It must not return on the next visit to the menu in the same tab, which is
 * the nag the spec forbids — so the session skip lives in `sessionStorage`.
 */

const KEY = "golpe.tutorialPromptDismissed";
const SESSION_KEY = "golpe.tutorialPromptSkipped";

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

/** True when the player waved the card away in this tab already. */
export function tutorialPromptSkippedThisSession(): boolean {
	try {
		return window.sessionStorage.getItem(SESSION_KEY) === "1";
	} catch {
		return true;
	}
}

/** Wave the card away for the rest of this tab, without answering forever. */
export function skipTutorialPromptForSession() {
	try {
		window.sessionStorage.setItem(SESSION_KEY, "1");
	} catch {
		// A session store that cannot be written costs a card on the next
		// return to the menu, not the menu itself.
	}
}
