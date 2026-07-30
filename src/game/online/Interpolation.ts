/**
 * The shared timeline between this client and the server.
 *
 * This file used to hold entity interpolation as well: remote fighters were
 * drawn 150ms in the past and blended between the two snapshots straddling that
 * time. That is the standard technique and it is gone, because rollback replaced
 * it — a fighter is now *simulated* at the present instant from its last known
 * input (see `Rollback.ts`), which is the only way a swing arrives in time to be
 * reacted to. Keeping the interpolator around as a second path would have meant
 * two answers to "where is that fighter", and the netcode only survives having
 * one.
 *
 * What remains is the clock. Bullets are dead-reckoned rather than simulated, so
 * they still need to know how old a snapshot is.
 */

/**
 * Tracks the offset between the server clock and the local clock so snapshots
 * can be placed on a shared timeline. Uses the smallest observed offset, which
 * corresponds to the lowest-latency packet seen so far.
 */
export class ServerClock {
	private offset: number | null = null;

	/** Feed a snapshot's server timestamp as it arrives. */
	observe(serverT: number, localNow: number) {
		const sample = serverT - localNow;
		this.offset = this.offset === null ? sample : Math.max(this.offset, sample);
	}

	/** Current server time estimate. */
	now(localNow: number): number {
		return localNow + (this.offset ?? 0);
	}

	reset() {
		this.offset = null;
	}
}
