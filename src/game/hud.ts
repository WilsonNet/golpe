/**
 * The game → HUD contract.
 *
 * Everything the match HUD needs to draw, in one place. `Match` composes a
 * `HudState` and emits it on `hud-state`; the React HUD subscribes. The two
 * sides of the canvas/DOM boundary must agree on the shape, so it lives here
 * rather than being duplicated in each — a field added to the interface and
 * never emitted is a HUD feature that silently never appears.
 */

/** Health values in hit points; `ult` in 0..100 like the simulation. */
export interface HudState {
	hp: number;
	maxHp: number;
	/** Ultimate charge, 0..100. */
	ult: number;
	/** The local fighter's stance — the badge beside the name. */
	stance: "sword" | "gun";
	/** The local fighter's hero — the badge reads "SWORD" or "DAGGER" from it. */
	hero: "lia" | "anands";
	/** The primary remote's hero, for the mirrored duel panel. */
	foeHero: "lia" | "anands";
	/** The local fighter's name, once the roster knows it. */
	name: string;
	/** The primary remote fighter, for a duel's mirrored panel. */
	foeName: string;
	foeHp: number;
	/** Everybody in the room, local included. Two is a duel. */
	fighterCount: number;
	/** False in the `?offline=true` escape hatch, where there is no server. */
	online: boolean;
	/** The held slash has finished charging — the Massive Strike is armed. */
	massiveReady: boolean;
	/**
	 * The local fighter's side in a team deathmatch, or `null` in a free-for-all.
	 *
	 * The HUD's own panel wears it, because the one thing a player must never have
	 * to work out is which colour they are: everything else on screen is tinted
	 * relative to that answer.
	 */
	team: 0 | 1 | null;
}

/** Event names, so the emitter and the subscriber cannot drift. */
export const HUD_EVENTS = {
	/** A fresh `HudState`, at snapshot cadence. */
	state: "hud-state",
	/**
	 * A battle message — "Connecting...", "That room is full." — for the
	 * Chrono Trigger message window. An empty string hides it.
	 */
	status: "hud-status",
} as const;
