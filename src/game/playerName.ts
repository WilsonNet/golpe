/**
 * The fighter name, shared by the match and the main menu.
 *
 * A human types their name once; both the connection gate (`Match`) and the
 * menu's name field read and write the same key, so a player who names
 * themselves in the menu never sees the in-game prompt. A script answers
 * through `window.__setPlayerName` instead, which fires the same event the
 * modal fires — one path in.
 */

const PLAYER_NAME_KEY = "golpe.playerName";

/** Matches the server's cap, so nothing a player types is silently truncated. */
export const MAX_NAME = 16;

export function readStoredName(): string | null {
	try {
		return window.localStorage.getItem(PLAYER_NAME_KEY);
	} catch {
		// Private browsing, or storage disabled. A name prompt every session is a
		// far better failure than a game that will not start.
		return null;
	}
}

export function storeName(name: string) {
	try {
		window.localStorage.setItem(PLAYER_NAME_KEY, name);
	} catch {
		/* not fatal — see readStoredName */
	}
}
