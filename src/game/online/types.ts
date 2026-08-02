import type {
	MatchEndReason,
	MatchPhase,
	ScoreEntry,
} from "../simulation/Deathmatch.js";
import type {
	MeleeMove,
	MeleeOutcome,
	PlayerIntent,
} from "../simulation/Physics.js";
import type { PackedIntent, PackedState } from "./wire.js";

/**
 * Send this message until it arrives.
 *
 * Geckos datagrams are unreliable by default, which is right for everything that
 * repeats: a lost input is what the server's starvation freeze exists for, and a
 * lost snapshot is followed by another one 50ms later. It is wrong for a one-shot
 * control message with no second chance, and the failures are silent and
 * session-ruining rather than glitchy:
 *
 * - a lost `join` puts a player in **a different room** from the friend who
 *   invited them, because no `room` means "make a new one";
 * - a lost `match` means the client never learns the id the server scores it
 *   under, so it reads somebody else's scoreboard row;
 * - a lost `match-over` means no podium at the end of a match;
 * - a lost `training-state` hangs an agent awaiting `__training.set()`.
 *
 * Ten sends at 150ms, deduplicated by id on receipt, so a handler still runs
 * exactly once. Deliberately **not** used for `state`, `input`, `roster` (which
 * has its own 2s heartbeat) or `respawn` (which a >100px correction covers) — a
 * message that repeats or self-heals does not need paying for ten times.
 */
export const RELIABLE = { reliable: true } as const;

/**
 * One tick of player intent. `seq` is what makes prediction work: the server
 * echoes back the last sequence it consumed so the client knows exactly which
 * of its predicted inputs are still unacknowledged and must be replayed.
 *
 * It extends `PlayerIntent` so the wire format cannot drift from what the
 * simulation actually consumes: adding a field to the simulation and forgetting
 * to send it would mean the server replays a different input than the client
 * predicted, which is invisible until it shows up as unexplained correction.
 *
 * Sent unpacked, unlike the snapshot: it is one small message per client per
 * tick, so the bandwidth is not worth a layer of encoding between the input a
 * player pressed and the input the server simulates.
 */
export interface PlayerInput extends PlayerIntent {
	seq: number;
	aimAngle: number;
}

/**
 * A melee impact that happened server-side, for the client to play effects from.
 *
 * Events, not state: they are one-shot and a client that misses a datagram loses
 * a spark rather than desyncing. Everything with lasting consequence — stun,
 * launch, knockback — travels in `PlayerPosition` instead.
 */
export interface MeleeEventMsg {
	attackerId: string;
	/** Who was hit, so the struck sprite is the one that takes the punch. */
	victimId: string;
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
}

export interface SnapshotPlayer {
	id: string;
	hp: number;
	/** Highest input sequence from this player already folded into `state`. */
	lastSeq: number;
	/** Full authoritative simulation state, packed. See `wire.ts`. */
	state: PackedState;
	/**
	 * The intent this fighter's state was advanced with on this snapshot's tick.
	 *
	 * This is what makes rollback possible for a fighter the client does not
	 * control: the client carries this input forward to predict the fighter at the
	 * present instant, instead of drawing it 150ms in the past. `null` means the
	 * server froze the fighter that tick (a starved input queue), which the client
	 * must reproduce rather than invent motion for.
	 */
	input: PackedIntent | null;
	kills: number;
	deaths: number;
	alive: boolean;
	/**
	 * Ultimate charge, 0..100.
	 *
	 * Beside `hp` and the scores rather than inside `state`, and for the same
	 * reason they are: it is paid out of damage, and only the server knows a hit
	 * landed. Putting it in `PlayerPosition` would oblige the client to predict a
	 * number it has no way to compute, and would put it on the replay path for no
	 * benefit — the simulation never reads it.
	 */
	ult: number;
}

export interface SnapshotBullet {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon between 20Hz snapshots. */
	vx: number;
	vy: number;
}

/**
 * The match clock and scores, as they stand.
 *
 * Deliberately *not* the ranked standings. Ranking is a pure function of these
 * numbers and the roster, so it is computed on the client from
 * `rankScores` — the same function the server uses — rather than being sent
 * sixteen names deep at 20Hz.
 */
export interface MatchStatus {
	phase: MatchPhase;
	elapsedMs: number;
	scoreLimit: number;
	timeLimitMs: number;
	endReason: MatchEndReason;
	/** Who won, once `phase` is "over". */
	winnerId: string | null;
	/** ms until the next match starts, while the podium is up. */
	nextMatchInMs: number;
}

/** A black hole grenade in flight. Server-owned, like a bullet. */
export interface SnapshotGrenade {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	/** Carried so the client can dead-reckon the arc between 20Hz snapshots. */
	vx: number;
	vy: number;
}

/**
 * The open singularity, if there is one. At most one per room.
 *
 * Sent in full every snapshot rather than announced once: it is what the client
 * feeds into `tickPlayer` for every fighter it predicts, so a lost datagram must
 * not be able to leave a client pulling people into a hole that has closed — or
 * worse, not pulling them into one that is open.
 */
export interface SnapshotSingularity {
	id: number;
	ownerId: string;
	x: number;
	y: number;
	remainingMs: number;
}

/**
 * The room is frozen for an ultimate cast.
 *
 * Present for exactly the ticks the server is not simulating. A client that
 * sees this stops running fixed steps — see specs/netcode.md for why that is
 * the *only* safe way to freeze a networked game, and why it is nothing like
 * the hitstop that is banned everywhere else.
 */
export interface SnapshotCinematic {
	casterId: string;
	/** ms of freeze left, for the overlay's own progress. */
	remainingMs: number;
	/** Total length, so the overlay can animate a fraction without a second constant. */
	totalMs: number;
}

export interface GameSnapshot {
	/** Server time the snapshot was taken, for clock sync and dead reckoning. */
	t: number;
	/**
	 * The server tick this snapshot describes.
	 *
	 * The rollback anchor: the client rewinds every fighter to this tick and
	 * re-simulates forward to the present.
	 */
	tick: number;
	players: SnapshotPlayer[];
	bullets: SnapshotBullet[];
	/** Melee impacts since the previous snapshot. Effects only. */
	melee: MeleeEventMsg[];
	match: MatchStatus;
	/** Black hole grenades in flight. Usually empty; at most one per cast. */
	grenades: SnapshotGrenade[];
	/** The open black hole, or null. At most one per room. */
	singularity: SnapshotSingularity | null;
	/** Set only while the room is frozen for a cast. */
	cinematic: SnapshotCinematic | null;
}

/**
 * Who is in the room, by name.
 *
 * Its own message, sent only when the roster changes. Names are stable strings
 * and there are sixteen of them; putting them in the snapshot would spend
 * bandwidth every 50ms restating something that changes when somebody connects.
 */
export interface RosterEntry {
	id: string;
	name: string;
	/** A server-hosted bot, so the scoreboard can say so. */
	bot: boolean;
}

export interface RosterMsg {
	players: RosterEntry[];
}

export interface MatchMessage {
	roomId: string;
	playerCount: number;
	/** The id the server knows this client by — never assume the channel id. */
	youId: string;
	/**
	 * How many 800px screens wide the room's arena is.
	 *
	 * Set by the client that created the room (`?screen=N`) and authoritative
	 * from then on — a latecomer's `?screen=` is ignored, exactly like the
	 * shortened rules. The client builds its world from this rather than from
	 * its own URL, so every client in a room simulates the same geometry.
	 */
	screens?: number;
}

/** A single fighter returning to the arena. Announced, never inferred. */
export interface RespawnMsg {
	id: string;
	t: number;
}

/**
 * The final standings, sent once when the match ends.
 *
 * The live scoreboard rebuilds the same ranking from the snapshot every frame,
 * so this is redundant by construction — deliberately. The podium is the one
 * screen a player will stare at and remember, and it should not depend on a
 * client having kept up with the last snapshot of a match.
 */
export interface MatchOverMsg {
	reason: MatchEndReason;
	winnerId: string | null;
	standings: ScoreEntry[];
}
