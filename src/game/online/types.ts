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
