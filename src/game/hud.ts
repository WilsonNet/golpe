/**
 * The game → HUD contract.
 *
 * Everything the match HUD needs to draw, in one place. `Match` composes a
 * `HudState` and emits it on `hud-state`; the React HUD subscribes. The two
 * sides of the canvas/DOM boundary must agree on the shape, so it lives here
 * rather than being duplicated in each — a field added to the interface and
 * never emitted is a HUD feature that silently never appears.
 */

import type { KillCause } from "./online/types";
import type { HeroId } from "./simulation/Heroes";
import type { TeamId } from "./simulation/Teams";

/**
 * One frag, ready for the feed. `Match` resolves the ids to names and the
 * killer's hero before emitting — the feed's presentation layer never touches
 * a roster or an info map.
 */
export interface HudKillEvent {
	killerId: string | null;
	/** The killer's name, or "the arena" when nobody is credited. */
	killer: string;
	victimId: string;
	victim: string;
	/** What dealt the blow — the feed's icon and label. */
	cause: KillCause;
	/** The killer's kit, so the feed can name the gun or the ultimate. */
	hero: HeroId | null;
	/**
	 * The two fighters' sides, so the feed wears the *actual* team colours —
	 * `null` in a free-for-all, where the names keep the neutral cyan/red.
	 */
	killerTeam: TeamId | null;
	victimTeam: TeamId | null;
	/** The local fighter is one of the two — the row gets the accent. */
	mine: boolean;
}

/**
 * One bleeding hostile on Ibiriki's hunt: enough to point at it, on screen or
 * beyond the edge of it. Positions are fractions of the visible arena and may
 * sit outside 0..1 — the HUD pins them to the frame's edge.
 */
export interface HudPrey {
	id: string;
	/** HP as a fraction of max, 0..1. */
	hp: number;
	screenX: number;
	screenY: number;
}

/** Health values in hit points; `ult` in 0..`ultCap` like the simulation. */
export interface HudState {
	hp: number;
	maxHp: number;
	/** Ultimate charge, 0..`ultCap`. The hero's own meter. */
	ult: number;
	/**
	 * The charge at which the local hero's ultimate arms (100 for the hole and
	 * the dragon, lower for the blossom). Carried so the HUD can show the
	 * absolute value and its target — the blossom's smaller number is what
	 * tells a player it charges faster.
	 */
	ultCap: number;
	/** Item charges left this life, server-counted. */
	itemCharges: number;
	/** The kit's full charge count, so the HUD can draw the pips. */
	itemMaxCharges: number;
	/** The item's badge — "HE GRENADE" or "TRAP". */
	itemLabel: string;
	/** Rounds left in the magazine. Server-counted, like the charges. */
	ammo: number;
	/** The magazine's full size, so the HUD can draw the count and the bar. */
	magazine: number;
	/**
	 * Rounds in the reserve — the rest of the life's magazines. When `ammo`
	 * and this are both zero, the gun is dry until the next life.
	 */
	reserveRounds: number;
	/**
	 * The magazine as a fraction, including the round being reloaded — the
	 * reload bar's fill. 1 when full; while a shotgun loads a shell it climbs
	 * past the shells already in, so the bar reads "how full is the gun
	 * becoming" rather than "how long until the current shell lands".
	 */
	reloadProgress: number;
	/** The local fighter's stance — the badge beside the name. */
	stance: "sword" | "gun";
	/** The local fighter's hero — the badge reads "SWORD" or "SHOTGUN" from it. */
	hero: HeroId;
	/** The primary remote's hero, for the mirrored duel panel. */
	foeHero: HeroId;
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
	 * The charge so far, 0..1, for the on-screen deck's ring.
	 *
	 * Zero for a weapon without a charge. It is the *button's* feedback, not a
	 * second source of truth: the simulation still decides when the charge is
	 * armed, and `massiveReady` is the authority on that.
	 */
	charge: number;
	/**
	 * The throwing axe's charge so far, 0..1.
	 *
	 * Zero for a gun. The axe's hold-to-charge is a second charge ring on the
	 * deck's weapon button, and it is separate from the melee charge because the
	 * axe is a ranged weapon — the same button means a different thing in each
	 * stance.
	 */
	throwCharge: number;
	/** True while the guard is actually up, rather than merely held. */
	blocking: boolean;
	/** The local fighter's facing (-1 or 1), for a deck with no direction held. */
	facing: number;
	/**
	 * The local fighter's centre as a fraction of the visible arena, 0..1.
	 *
	 * The deck uses it to fade the hand the fighter is standing under; the
	 * camera is included, so a wide room reports the same screen position a
	 * player sees.
	 */
	playerScreenX: number;
	playerScreenY: number;
	/** Ibiriki is berserk: the badge says so and the panel burns. */
	berserk: boolean;
	/**
	 * The local fighter's bloodlust, 0..1 — the buff the nearest bleeding prey
	 * is feeding him — or `null` for a kit without the passive (no meter
	 * drawn).
	 */
	bloodlust: number | null;
	/**
	 * Ibiriki's bleeding prey, empty for every other kit. The HUD marks each one
	 * — above its nameplate in view, pinned to the frame's edge and turned at it
	 * when outside — because the hunt should not have to search a wide arena
	 * for the blood that is feeding it.
	 */
	prey: HudPrey[];
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
	/** A frag, for the turn-away kill feed. Effects only. */
	kill: "hud-kill",
} as const;
