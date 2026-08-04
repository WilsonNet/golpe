/**
 * The server's highlight reel: a ring buffer of footage, and the judgement of
 * which slice of it was the match.
 *
 * Only the server can do this, and for the same reason only the server may
 * decide a hit landed: a play is made of kills, denies and round wipes, and no
 * client knows about all of them — a client only ever sees the ones it was
 * near. A client-side reel would give every player a different Play of the
 * Game, which is the one thing the ceremony cannot survive.
 *
 * **The footage is the broadcast, not a second recording.** Every frame here is
 * built from the `GameSnapshot` the room had already composed for its clients,
 * so a replay is a rerun of what the room actually sent. Recording the server's
 * internal state instead would have been a parallel encoding of the same
 * fighters — and the first time a field was added to `PlayerPosition`, exactly
 * one of the two would have learned about it.
 *
 * Memory is bounded by construction: `POTG_BUFFER_MS` of frames, trimmed on
 * every capture, plus at most one cut clip. See `scoring.ts` for why the buffer
 * is exactly as long as it is.
 */

import type { GameSnapshot } from "../src/game/online/types.js";
import {
	beats,
	describePlay,
	PlayTracker,
	POTG_BUFFER_MS,
	POTG_LEAD_MS,
	POTG_MAX_CLIP_MS,
	POTG_TAIL_MS,
} from "../src/game/potg/scoring.js";
import {
	type HighlightEvent,
	type HighlightKind,
	POTG_CLIP_VERSION,
	type PotgAnnounce,
	type PotgCastMember,
	type PotgClip,
	type PotgFrame,
	type PotgPlay,
} from "../src/game/potg/types.js";
import type { TeamId } from "../src/game/simulation/Teams.js";

/**
 * Shortest clip worth cutting, in frames.
 *
 * Half a second at the broadcast rate. A play scored in the opening moments of
 * a match has almost no lead-in to draw on, and a cinematic that opens on two
 * frames of footage is worse than no cinematic — the announcement still names
 * the player, which is the part that mattered.
 */
const MIN_CLIP_FRAMES = 10;

/** Two decimals is a tenth of a pixel: past what a replay can show, and half the JSON. */
const ROUND = 100;

function r2(n: number): number {
	return Math.round(n * ROUND) / ROUND;
}

/** One entry per *instant* a play scored, rebased onto the clip's clock. */
function dedupeBeats(events: readonly HighlightEvent[], base: number) {
	const seen = new Set<number>();
	const beats: PotgClip["beats"] = [];
	for (const e of events) {
		const t = Math.max(0, Math.round(e.t - base));
		if (seen.has(t)) continue;
		seen.add(t);
		beats.push({ t, kind: e.kind, victimName: e.victimName });
	}
	return beats;
}

/** What the recorder needs to know about the room it is filming. */
export interface PotgRoomInfo {
	roomId: string;
	/** Frames per second of footage — the room's broadcast rate. */
	hz: number;
	/** Arena width in 800px screens, so a replay builds the same world. */
	screens: number;
}

export class PotgRecorder {
	/** Footage, oldest first, trimmed to `POTG_BUFFER_MS`. */
	private frames: PotgFrame[] = [];
	/** Everybody who has appeared, in the order they first did. */
	private cast: PotgCastMember[] = [];
	private castIndex = new Map<string, number>();

	private readonly tracker: PlayTracker;
	private best: PotgPlay | null = null;
	private bestClip: PotgClip | null = null;

	/**
	 * The finished reel, once the match is over. Served over HTTP; see
	 * `server/index.ts`.
	 */
	private published: PotgClip | null = null;

	constructor(
		private readonly info: () => PotgRoomInfo,
		teamOf: (id: string) => TeamId | null,
	) {
		// Cut the moment a run closes rather than at the end of the match: the
		// footage of a play that happened four minutes ago is long gone from the
		// ring buffer by then, and keeping the whole match in memory to avoid this
		// would be a hundred megabytes per room to save one function call.
		this.tracker = new PlayTracker((play) => this.consider(play), teamOf);
	}

	/** The clip this match settled on, or null. */
	get clip(): PotgClip | null {
		return this.published;
	}

	/**
	 * Record a scoring moment.
	 *
	 * A frag is one `kill` plus a modifier event per thing that was notable about
	 * it, all at the same `t` — see `HIGHLIGHT_WEIGHTS`. The caller decides what
	 * was notable, because only the caller can see the state that made it so. A
	 * `damageDealt`/`damageAbsorbed` event carries its burst size in `amount`,
	 * which is what the card's stat line is built from.
	 */
	note(
		t: number,
		kind: HighlightKind,
		actor: { id: string; name: string },
		victim: { id: string; name: string } = { id: "", name: "" },
		amount?: number,
	) {
		const event: HighlightEvent = {
			t,
			kind,
			actorId: actor.id,
			actorName: actor.name,
			victimId: victim.id,
			victimName: victim.name,
			...(amount !== undefined ? { amount } : {}),
		};
		this.tracker.note(event);
	}

	/** Close runs whose window has expired. Called on the room's fixed tick. */
	tick(now: number) {
		this.tracker.tick(now);
	}

	/**
	 * Keep one frame of footage.
	 *
	 * Called from `broadcastState` with the snapshot that is about to go out, so
	 * the reel and the room can never be showing two different fights.
	 */
	capture(
		t: number,
		snap: GameSnapshot,
		member: (id: string) => PotgCastMember,
	) {
		const players = snap.players.map((p) => ({
			c: this.castOf(member(p.id)),
			s: p.state.map(r2),
			hp: Math.round(p.hp),
			a: (p.alive ? 1 : 0) as 0 | 1,
		}));

		const bullets: number[] = [];
		for (const b of snap.bullets) bullets.push(b.id, r2(b.x), r2(b.y));
		const grenades: number[] = [];
		for (const g of snap.grenades) grenades.push(r2(g.x), r2(g.y));

		const hole = snap.singularity;
		this.frames.push({
			t,
			p: players,
			b: bullets,
			g: grenades,
			h: hole
				? [r2(hole.x), r2(hole.y), this.castOf(member(hole.ownerId))]
				: null,
		});

		// Trimmed from the front on every capture rather than on a timer: the
		// buffer's length is the invariant, and a timer is one more thing that can
		// be forgotten in a code path that returns early.
		const oldest = t - POTG_BUFFER_MS;
		let drop = 0;
		while (drop < this.frames.length && (this.frames[drop]?.t ?? 0) < oldest) {
			drop++;
		}
		if (drop > 0) this.frames.splice(0, drop);
	}

	/**
	 * The match is over. Close everything, publish the winner, and say what to
	 * announce.
	 *
	 * Returns null when nothing happened worth showing — an empty room, or a
	 * match that ran out of clock with nobody having scored. A ceremony for a
	 * fight that never took place is worse than no ceremony.
	 */
	finish(): PotgAnnounce | null {
		this.tracker.flush();
		const play = this.best;
		if (!play) return null;

		this.published = this.bestClip;
		const { headline, subtitle } = describePlay(play);
		return {
			roomId: this.info().roomId,
			protagonistId: play.actorId,
			protagonistName: play.actorName,
			team: play.team,
			headline,
			subtitle,
			score: play.score,
			kills: play.kills,
			stats: { ...play.stats },
			hasClip: this.published !== null,
		};
	}

	/** A new match in the same room: forget everything, including the reel. */
	reset() {
		// Flushed **first**, because closing a run re-enters `consider` — doing it
		// after the clear would repopulate exactly what was just cleared.
		this.tracker.flush();
		this.frames.length = 0;
		this.cast.length = 0;
		this.castIndex.clear();
		this.best = null;
		this.bestClip = null;
		this.published = null;
	}

	/**
	 * A run closed. If it is the best so far, cut its footage out of the buffer
	 * **now**, while the footage still exists.
	 */
	private consider(play: PotgPlay) {
		if (!beats(play, this.best)) return;
		const clip = this.cut(play);
		if (!clip) return;
		this.best = play;
		this.bestClip = clip;
	}

	private cut(play: PotgPlay): PotgClip | null {
		const from = play.startMs - POTG_LEAD_MS;
		const to = Math.min(play.endMs + POTG_TAIL_MS, from + POTG_MAX_CLIP_MS);
		const window = this.frames.filter((f) => f.t >= from && f.t <= to);
		if (window.length < MIN_CLIP_FRAMES) return null;

		// Rebased onto the clip's own clock, and copied while doing it: the ring
		// buffer keeps growing under this, and a clip that aliased it would have its
		// timestamps rewritten by the next match.
		const base = window[0]?.t ?? 0;
		const frames = window.map((f) => ({ ...f, t: Math.round(f.t - base) }));
		const info = this.info();
		const protagonist = this.cast[this.castIndex.get(play.actorId) ?? -1] ?? {
			id: play.actorId,
			name: play.actorName,
			team: play.team,
			bot: false,
		};

		return {
			version: POTG_CLIP_VERSION,
			roomId: info.roomId,
			hz: info.hz,
			durationMs: frames[frames.length - 1]?.t ?? 0,
			actionAtMs: Math.max(0, Math.round(play.startMs - base)),
			protagonist,
			// **Moments, not events.** A single frag is a `kill` plus a modifier for
			// each thing that was notable about it, all sharing one timestamp — and
			// the client drives slow motion and the impact shake off this list, so
			// six entries at two instants would be six emphases at two instants. The
			// first event at each instant keeps the slot, which is the modifier that
			// made the moment unusual rather than the plain `kill` behind it.
			beats: dedupeBeats(play.events, base),
			score: play.score,
			kills: play.kills,
			stats: { ...play.stats },
			// A snapshot of the cast as it stands, so a fighter who leaves before the
			// match ends is still named in the replay they are in.
			cast: this.cast.map((c) => ({ ...c })),
			frames,
			screens: info.screens,
		};
	}

	/** This fighter's index in the cast, adding them if this is the first sight. */
	private castOf(member: PotgCastMember): number {
		const known = this.castIndex.get(member.id);
		if (known !== undefined) {
			// Refreshed rather than frozen at first sight: a human's name arrives in
			// the roster message, which can land after the first snapshot they are in.
			const entry = this.cast[known];
			if (entry) {
				entry.name = member.name;
				entry.team = member.team;
				entry.bot = member.bot;
			}
			return known;
		}
		const index = this.cast.length;
		this.cast.push({ ...member });
		this.castIndex.set(member.id, index);
		return index;
	}
}
