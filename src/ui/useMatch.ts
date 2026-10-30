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
import type { HeroId } from "../game/simulation/Heroes";
import type { Standing } from "../game/simulation/Deathmatch";

export interface MatchView {
	status: MatchStatus;
	standings: Standing[];
	/** The id the server scores this client under. */
	myId: string;
	/** The kit this client is actually playing — not the stored preference. */
	hero: HeroId;
}

/**
 * A cache of the live kit, so a menu opened after the event still knows it.
 *
 * `match-status` is online-only, and the Esc menu exists in offline practice
 * too. `Match` announces the kit it is playing (`local-hero`) at construction
 * and on every accepted hero echo; this module listens from load, so the value
 * is there even if no component was mounted at the moment it was announced.
 */
let cachedHero: HeroId | null = null;
let heroListenerInstalled = false;
function installHeroCache() {
	if (heroListenerInstalled) return;
	heroListenerInstalled = true;
	EventBus.on("local-hero", ((hero: HeroId) => {
		cachedHero = hero;
	}) as never);
}
installHeroCache();

/** The kit actually playing, or `fallback` before the match has said. */
export function useLocalHero(fallback: HeroId): HeroId {
	const [hero, setHero] = useState<HeroId>(() => cachedHero ?? fallback);
	useEffect(
		() =>
			EventBus.on("local-hero", ((next: HeroId) => {
				cachedHero = next;
				setHero(next);
			}) as never),
		[],
	);
	return hero;
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
 * The server's latest round trip per fighter, ms.
 *
 * Updated once a second — not on the snapshot — so the scoreboard can hold it
 * open without a 20Hz state churn for a number that moves at dial-up speed.
 * Bots are simply absent: they have no channel to measure, and the table draws
 * a dash rather than inventing a latency for them.
 */
export function usePings(): Record<string, number> {
	const [pings, setPings] = useState<Record<string, number>>({});

	useEffect(
		() =>
			EventBus.on("pings", ((next: Record<string, number>) =>
				setPings(next)) as never),
		[],
	);

	return pings;
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
			// A menu is a keyboard surface too: Tab must move focus through it, or
			// the dialog cannot be operated without a mouse. Only the game surface
			// swallows Tab to keep the scoreboard from stealing the keyboard.
			if (document.querySelector(".gd-veil")) return;
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

/**
 * The room this client is in, once the game has decided.
 *
 * Emitted before the name prompt appears and again if the server chose a
 * different id, so a host can copy the link before anything has connected.
 */
export function useRoomId(): string {
	const [id, setId] = useState("");
	useEffect(
		() => EventBus.on("room-id", ((next: string) => setId(next)) as never),
		[],
	);
	return id;
}

/**
 * Copy text to the clipboard, on a plain-HTTP origin too.
 *
 * `navigator.clipboard` requires a secure context, and a LAN game served over
 * `http://192.168.x.x:8084` does not have one — which is exactly the situation
 * the share link exists for. So: try the modern API, fall back to the deprecated
 * one that still works on insecure origins, and report honestly if neither did so
 * the caller can tell the player to press Ctrl+C themselves.
 */
export async function copyText(
	text: string,
	fallbackField?: HTMLInputElement | null,
): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Insecure context or a denied permission. Fall through.
	}

	if (fallbackField) {
		fallbackField.select();
		try {
			// execCommand is deprecated, but it is the only copy path that works on
			// a plain-HTTP origin, which is where LAN games are served.
			return document.execCommand("copy");
		} catch {
			return false;
		}
	}
	return false;
}

import { MS_PER_SECOND, SECONDS_PER_MINUTE } from "../game/simulation/units";
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / MS_PER_SECOND));
	return `${Math.floor(total / SECONDS_PER_MINUTE)}:${String(total % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}
