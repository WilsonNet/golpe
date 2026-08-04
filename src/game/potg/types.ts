/**
 * Play of the Game: the wire shapes.
 *
 * Two things travel, and they travel by different roads on purpose.
 *
 * - **The announcement** (`PotgAnnounce`) is a small reliable datagram, sent
 *   the instant the match ends. It carries everything the splash needs — who,
 *   what, how good — so the card can be up before a single byte of footage has
 *   arrived.
 * - **The clip** (`PotgClip`) is fetched over the game server's own HTTP
 *   endpoint (`GET /potg/<roomId>`). It is hundreds of kilobytes of packed
 *   fighter state, which is three orders of magnitude past what a datagram
 *   wants; the same rule that made the snapshot a packed array rather than JSON
 *   says a ten-second replay does not belong on the realtime channel at all.
 *
 * The split also decides what happens when the footage is lost: the splash
 * still names the player and their kill, and the replay is simply skipped. A
 * design where the announcement *was* the clip could only fail silently.
 */

import type { TeamId } from "../simulation/Teams.js";

/**
 * What made a moment worth watching.
 *
 * Weights live in `scoring.ts`; this is only the vocabulary. Each kind is a
 * thing a player would describe out loud after it happened, which is the test
 * for whether a new one belongs here.
 */
export type HighlightKind =
	/** An ordinary frag. The unit every play is built out of. */
	| "kill"
	/** A frag credited to the black hole. */
	| "ultimateKill"
	/** A frag landed with the combo's overhead finisher, or a Massive Strike. */
	| "finisherKill"
	/** The victim was in the air when they died. */
	| "airKill"
	/** The killer was themself nearly dead. */
	| "clutchKill"
	/** The frag that wiped a side, in team deathmatch. */
	| "wipeKill"
	/** An ultimate taken away: killed mid-hold, or the grenade guarded. */
	| "deny"
	/**
	 * A burst of damage dealt — about one health bar's worth, see
	 * `POTG_DAMAGE_BURST`. Cheap on purpose: it colours a play, and a fighter
	 * who was merely present should never out-score one who closed a kill.
	 */
	| "damageDealt"
	/**
	 * A burst of damage the sword guard turned away. The cheapest weight in the
	 * game, because blocking well is *true* but reads as nothing on a screen.
	 */
	| "damageAbsorbed";

/**
 * One scoring moment, as the server saw it.
 *
 * `t` is match-clock milliseconds, not wall clock: it is the same number the
 * recorder stamps its frames with, so an event and the footage of it cannot
 * drift apart.
 */
export interface HighlightEvent {
	t: number;
	kind: HighlightKind;
	/** Who did it — the fighter the play belongs to. */
	actorId: string;
	/** Who it happened to. Empty when nobody was on the receiving end. */
	victimId: string;
	/** Names, captured at the time: a fighter can leave before the match ends. */
	actorName: string;
	victimName: string;
	/**
	 * Damage points behind a `damageDealt`/`damageAbsorbed` event — the burst
	 * size, roughly `POTG_DAMAGE_BURST`. What the card's stat line is built
	 * from; the score uses the kind's weight, never this number.
	 */
	amount?: number;
}

/**
 * What a play did, summed into the four lines the title card shows.
 *
 * `damage` and `absorbed` are raw points of damage, not scores — a play's
 * *worth* is `score`, and these exist so the ceremony can say "1,240 damage"
 * rather than a number only the server could explain.
 */
export interface PlayStats {
	kills: number;
	/** Damage dealt, in points. */
	damage: number;
	/** Ultimates taken away, both kinds. */
	denies: number;
	/** Damage the sword guard turned away, in points. */
	absorbed: number;
}

/** A run of one fighter's scoring moments, and what it was worth. */
export interface PotgPlay {
	actorId: string;
	actorName: string;
	team: TeamId | null;
	/** Weighted total. Only ever compared against another play's. */
	score: number;
	/** Frags in the run — what the headline is mostly made of. */
	kills: number;
	/** The stat line the card is built from. */
	stats: PlayStats;
	events: HighlightEvent[];
	/** Match-clock ms of the first and last scoring moment. */
	startMs: number;
	endMs: number;
}

/** Who was on the field, named once so a frame can refer to them by index. */
export interface PotgCastMember {
	id: string;
	name: string;
	team: TeamId | null;
	bot: boolean;
}

/**
 * One fighter in one frame of footage.
 *
 * `s` is a `PackedState` — the *same* encoding the snapshot uses, so the replay
 * unpacks into a real `PlayerPosition` and the ordinary animation, sprite-sync
 * and sword-effect systems draw it with no second code path. A replay format of
 * its own would have been a second renderer to keep in step, and it would have
 * drifted the first time a timer was added to the simulation.
 */
interface PotgFramePlayer {
	/** Index into `PotgClip.cast`. */
	c: number;
	s: number[];
	hp: number;
	/** 1 up, 0 down. A number because it is packed beside numbers. */
	a: 0 | 1;
}

/**
 * One frame of footage. Field names are one letter because there are hundreds
 * of these in a clip and the key strings are most of the JSON.
 */
export interface PotgFrame {
	/** ms from the start of the clip. */
	t: number;
	p: PotgFramePlayer[];
	/** Bullets, flat: `[id, x, y, ...]`. */
	b: number[];
	/** Grenades in flight, flat: `[x, y, ...]`. */
	g: number[];
	/** The open singularity as `[x, y, castIndexOfCaster]`, or null. */
	h: [number, number, number] | null;
}

/** The clip format's version, bumped whenever a frame's shape changes. */
export const POTG_CLIP_VERSION = 2;

export interface PotgClip {
	version: number;
	roomId: string;
	/** Frames per second of footage. The server's broadcast rate. */
	hz: number;
	durationMs: number;
	/**
	 * ms into the clip where the first scoring moment lands.
	 *
	 * The whole reason the clip starts earlier than the play does: the pre-roll
	 * needs footage to hold on while it does its camera work, and the roll needs
	 * a beat of ordinary movement before the kill so the kill reads as an event
	 * rather than as the first thing that happens.
	 */
	actionAtMs: number;
	protagonist: PotgCastMember;
	/** Every scoring moment, in ms *from the start of the clip*. */
	beats: { t: number; kind: HighlightKind; victimName: string }[];
	score: number;
	kills: number;
	/** The stat line the title card shows. */
	stats: PlayStats;
	cast: PotgCastMember[];
	frames: PotgFrame[];
	/** The arena's width in 800px screens, so a replay builds the right world. */
	screens: number;
}

/**
 * One camera movement of the replay, summarised while it runs.
 *
 * For `scripts/potg-probe.mjs` and nothing else. The pre-roll's entire job is to
 * move a camera, and no other metric in the game reads one — so a cinematic that
 * quietly degraded into a static wide shot would leave every existing probe
 * green. `travel` is the furthest the camera got from where the movement
 * started, which is what separates a whip pan (which ends back on its subject
 * and would otherwise look motionless) from no pan at all.
 */
export interface PotgTrackEntry {
	phase: string;
	/** Wall-clock ms spent in this movement. */
	ms: number;
	/** Where the camera was when the movement began, in world px. */
	x0: number;
	y0: number;
	/** Where it ended up. */
	x: number;
	y: number;
	/** Furthest it got from the start, in world px. */
	travel: number;
	minZoom: number;
	maxZoom: number;
	/** How fast the footage ran, at its slowest and fastest, during this movement. */
	minRate: number;
	maxRate: number;
	/** Impact shakes fired. One per scoring beat, never more. */
	shakes: number;
}

/**
 * The reliable datagram that says a play of the game exists.
 *
 * Deliberately self-sufficient: everything on the splash card is in here, so
 * the ceremony is identical whether the footage arrives, arrives late, or never
 * arrives at all.
 */
export interface PotgAnnounce {
	roomId: string;
	protagonistId: string;
	protagonistName: string;
	team: TeamId | null;
	/** "QUADRUPLE KILL", "BLACK HOLE", "DENIED" — the big line. */
	headline: string;
	/** The small line under it. */
	subtitle: string;
	score: number;
	kills: number;
	/** The stat line the title card shows. */
	stats: PlayStats;
	/** False when the play was scored but no footage survived to go with it. */
	hasClip: boolean;
}
