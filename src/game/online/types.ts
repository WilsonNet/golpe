import type {
	MeleeMove,
	MeleeOutcome,
	PlayerIntent,
	PlayerPosition,
} from "../simulation/Physics";

/**
 * One tick of player intent. `seq` is what makes prediction work: the server
 * echoes back the last sequence it consumed so the client knows exactly which
 * of its predicted inputs are still unacknowledged and must be replayed.
 *
 * It extends `PlayerIntent` so the wire format cannot drift from what the
 * simulation actually consumes: adding a field to the simulation and forgetting
 * to send it would mean the server replays a different input than the client
 * predicted, which is invisible until it shows up as unexplained correction.
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
	move: MeleeMove;
	outcome: MeleeOutcome;
	x: number;
	y: number;
	dir: number;
}

export interface SnapshotPlayer {
	id: string;
	hp: number;
	facingDir: number;
	/** Highest input sequence from this player already folded into `state`. */
	lastSeq: number;
	/** Full authoritative simulation state — everything tickPlayer needs to resume. */
	state: PlayerPosition;
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

export interface GameSnapshot {
	/** Server time the snapshot was taken, for interpolation. */
	t: number;
	players: SnapshotPlayer[];
	bullets: SnapshotBullet[];
	/** Melee impacts since the previous snapshot. Effects only. */
	melee: MeleeEventMsg[];
}

export interface MatchMessage {
	roomId: string;
	playerCount: number;
}
