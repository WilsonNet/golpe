/**
 * The launch URL: one source of truth for how a match is asked for.
 *
 * Every way the game is started — typed URL, shared link, or the main menu —
 * ends as a query string, and this module is the only place that query string
 * is read or written. `Match` parses it at boot, the menu serialises it when
 * a player commits a choice, and the two cannot drift because they share the
 * code. This is also what keeps the URL the *authority*: what the address bar
 * says after the menu commits is exactly the link that would boot that match
 * if it were opened anywhere else.
 *
 * The params mirror the server's `JoinMsg` in intent but are deliberately not
 * the same type — the wire carries the server's decisions back, these are only
 * the requests.
 */

import type { MatchMode } from "../simulation/Teams";

/** A match the URL can ask for. `undefined` means "not asked". */
export interface LaunchParams {
	/** Which room to join, or null to make a new one. */
	room: string | null;
	/** `?ai=true` — this client's fighter is brain-driven. */
	ai: boolean;
	/** The vestigial `?online=` — kept so older links keep their meaning. */
	online: boolean;
	/** `?offline=true` — the escape hatch that bypasses the server. */
	offline: boolean;
	/** `?training=true` (or `?training-room=true`) — the practice room. */
	training: boolean;
	/** `?bots=N` — opponents to seat. `0` is a legitimate answer: an empty room. */
	bots: number | undefined;
	/** `?fill=N` — keep the room at N fighters, bots as ballast. */
	fill: number | undefined;
	/** `?scoreLimit=N` — frags to win, rounds to win in a team match. */
	scoreLimit: number | undefined;
	/** `?timeLimit=S`, in seconds. */
	timeLimitSec: number | undefined;
	/** `?ultCharge=N` — the charge every fighter starts with, 0..100. */
	ultCharge: number | undefined;
	/**
	 * `?mode=tdm` (or `?mode=team`) — the ruleset. Null means the free-for-all
	 * was not asked for, which is different from asking for it by name.
	 */
	mode: MatchMode | null;
	/** `?freezeTime=S` — a team round's countdown, in seconds. */
	freezeTime: number | undefined;
	/** `?screen=N` — how many 800px screens wide the arena is, 1..8. */
	screens: number | undefined;
}

/**
 * The keys that select a match. Their *presence* — even a nonsensical value —
 * is the signal to boot straight into the game rather than show the menu: a
 * URL someone was sent, saved or typed with one of these is a URL with intent,
 * and every probe and diagnostic runs exactly this way. `online` is absent on
 * purpose: it is vestigial, and a bare `?online=true` is just the old spelling
 * of the bare URL, which is the menu's own page.
 */
const LAUNCH_KEYS = [
	"room",
	"ai",
	"offline",
	"training",
	"training-room",
	"bots",
	"fill",
	"scoreLimit",
	"timeLimit",
	"ultCharge",
	"mode",
	"freezeTime",
	"screen",
] as const;

const LAUNCH_KEY_SET = new Set<string>(LAUNCH_KEYS);

/**
 * True when the URL carries no match intent, so the root menu should show.
 *
 * The root URL *is* a match — an empty new room — but it is also the page a
 * stranger lands on, and a page that silently seats them in an empty arena
 * answers none of their questions. The rule is purely structural: any launch
 * key present means the person (or script) that built this URL knew what they
 * were asking for, so the game boots without ceremony. Nothing here reads a
 * value, so `?ai=false` boots exactly like `?ai=true` — explicit is explicit.
 */
export function isMenuShape(search: string): boolean {
	const params = new URLSearchParams(search);
	for (const key of LAUNCH_KEY_SET) {
		if (params.get(key) !== null) return false;
	}
	return true;
}

/** A positive integer URL parameter, or undefined when absent or nonsense. */
function numberParam(params: URLSearchParams, key: string): number | undefined {
	const raw = params.get(key);
	if (raw === null) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Like `numberParam`, but zero is a legitimate answer. */
function countParam(params: URLSearchParams, key: string): number | undefined {
	const raw = params.get(key);
	if (raw === null) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Read the launch request out of a query string. */
export function parseLaunchParams(search: string): LaunchParams {
	const params = new URLSearchParams(search);
	return {
		room: params.get("room"),
		ai: params.get("ai") === "true",
		online: params.get("online") === "true",
		offline: params.get("offline") === "true",
		training:
			params.get("training") === "true" ||
			params.get("training-room") === "true",
		bots: countParam(params, "bots"),
		fill: numberParam(params, "fill"),
		scoreLimit: numberParam(params, "scoreLimit"),
		timeLimitSec: numberParam(params, "timeLimit"),
		ultCharge: countParam(params, "ultCharge"),
		mode: parseMode(params.get("mode")),
		freezeTime: countParam(params, "freezeTime"),
		screens: numberParam(params, "screen"),
	};
}

/**
 * The ruleset a URL asked for, or null when it did not say.
 *
 * Anything unrecognised is treated the way the server treats it — as a
 * deathmatch — but only `ffa` asked by name survives as a value: a nonsense
 * mode is a typo, not a request.
 */
function parseMode(raw: string | null): MatchMode | null {
	if (raw === "tdm" || raw === "team") return "tdm";
	if (raw === "ffa") return "ffa";
	return null;
}

/**
 * Write a launch request back out as a query string.
 *
 * Only what was actually asked for is written: an absent optional is left
 * absent, so the URL says exactly as much as the person who built it decided.
 */
export function serializeLaunchParams(params: LaunchParams): string {
	const url = new URLSearchParams();
	if (params.room !== null) url.set("room", params.room);
	if (params.ai) url.set("ai", "true");
	if (params.online) url.set("online", "true");
	if (params.offline) url.set("offline", "true");
	if (params.training) url.set("training", "true");
	if (params.bots !== undefined) url.set("bots", String(params.bots));
	if (params.fill !== undefined) url.set("fill", String(params.fill));
	if (params.scoreLimit !== undefined)
		url.set("scoreLimit", String(params.scoreLimit));
	if (params.timeLimitSec !== undefined)
		url.set("timeLimit", String(params.timeLimitSec));
	if (params.ultCharge !== undefined)
		url.set("ultCharge", String(params.ultCharge));
	if (params.mode !== null) url.set("mode", params.mode);
	if (params.freezeTime !== undefined)
		url.set("freezeTime", String(params.freezeTime));
	if (params.screens !== undefined) url.set("screen", String(params.screens));
	return url.toString();
}

/** The absolute URL a launch request means, on this origin and path. */
export function launchUrl(params: LaunchParams): string {
	const url = new URL(window.location.href);
	url.search = serializeLaunchParams(params);
	return url.toString();
}
