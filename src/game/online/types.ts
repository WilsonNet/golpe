import type { PlayerPosition } from "../simulation/Physics";

/**
 * One tick of player intent. `seq` is what makes prediction work: the server
 * echoes back the last sequence it consumed so the client knows exactly which
 * of its predicted inputs are still unacknowledged and must be replayed.
 */
export interface PlayerInput {
	seq: number;
	left: boolean;
	right: boolean;
	up: boolean;
	attack: boolean;
	aimAngle: number;
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
}

export interface MatchMessage {
	roomId: string;
	playerCount: number;
}
