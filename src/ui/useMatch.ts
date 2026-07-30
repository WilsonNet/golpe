/**
 * The React layer's view of the match.
 *
 * Subscribes to the game → React bridge rather than reaching into the game.
 * `EventBus` is dependency-free on purpose, so the overlay never transitively
 * depends on the renderer — and the scoreboard is a DOM overlay for the same
 * reason the training panel is: canvas text cannot be selected, scrolled or laid
 * out by anything but hand.
 */

import { useEffect, useState } from "react";
import { EventBus } from "../game/EventBus";
import type { MatchOverMsg, MatchStatus } from "../game/online/types";
import type { Standing } from "../game/simulation/Deathmatch";

export interface MatchView {
	status: MatchStatus;
	standings: Standing[];
	/** The id the server scores this client under. */
	myId: string;
}

/**
 * The live match, or null before the first snapshot.
 *
 * Updated on every snapshot — 20 times a second, which React handles without
 * complaint because the payload is sixteen small rows and the tree it feeds is
 * hidden most of the time.
 */
export function useMatch(): MatchView | null {
	const [view, setView] = useState<MatchView | null>(null);

	useEffect(
		() =>
			EventBus.on("match-status", ((next: MatchView) => {
				setView(next);
			}) as never),
		[],
	);

	return view;
}

/** The final standings, once the match is over. Null while it is still running. */
export function useMatchOver(): MatchOverMsg | null {
	const [over, setOver] = useState<MatchOverMsg | null>(null);

	useEffect(() => {
		const offOver = EventBus.on("match-over", ((msg: MatchOverMsg) => {
			setOver(msg);
		}) as never);
		// A new match clears the podium. Without this the winner screen from the
		// previous match would sit over a live fight forever.
		const offReset = EventBus.on("match-reset", (() => setOver(null)) as never);
		return () => {
			offOver();
			offReset();
		};
	}, []);

	return over;
}

/**
 * True while a key is held.
 *
 * `keyup` alone is not enough: switching windows mid-hold never delivers one, so
 * the scoreboard would stay pinned open over a fight the player came back to.
 * `blur` releases it.
 */
export function useKeyHeld(code: string): boolean {
	const [held, setHeld] = useState(false);

	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.code !== code) return;
			// Tab moves focus by default, which would pull the keyboard off the canvas
			// and leave WASD going into whatever it landed on.
			e.preventDefault();
			setHeld(true);
		};
		const up = (e: KeyboardEvent) => {
			if (e.code !== code) return;
			e.preventDefault();
			setHeld(false);
		};
		const release = () => setHeld(false);

		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", release);
		};
	}, [code]);

	return held;
}

/** `m:ss`, for the match clock. */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
