import type { NetReportMsg } from "../src/game/online/types.js";

/**
 * What one client's input stream looked like from the server's side.
 *
 * The client can measure everything about the snapshots it receives, and
 * nothing about the inputs it sends: whether one was lost, arrived late, was
 * thrown away by the queue cap or starved the tick it was meant for is known
 * only here. Every one of those is a tick the server simulated differently
 * from the client's prediction, so they are counted where they happen and sent
 * back to their own client (`net`) for the diagnostic report.
 */
const MS_PER_WINDOW = 1000;
const MAX_PACKETS_PER_WINDOW = 180;

export class InputLink {
	/** Input messages heard, redundant copies included. */
	packets = 0;
	/** Distinct inputs queued for simulation. */
	accepted = 0;
	/**
	 * Copies of an input already queued or simulated — redundancy at work, and
	 * also an original that arrived after the server had moved past it.
	 */
	duplicates = 0;
	/**
	 * Inputs the server simulated past without ever having — a seq gap at
	 * consumption. Each is a tick the client predicted and the server never ran:
	 * a permanent divergence only a correction can repair.
	 */
	lost = 0;
	/** Inputs discarded by the queue cap. Same consequence as `lost`. */
	overflow = 0;
	/** Ticks frozen waiting for input (`MAX_STARVED_TICKS` and under). */
	starved = 0;
	/** Ticks past the freeze cap, simulated on a repeat of the last input. */
	repeated = 0;
	/** Input messages refused by the rate budget. */
	throttled = 0;
	private windowStart = 0;
	private windowCount = 0;

	/**
	 * Is one more input message allowed this second?
	 *
	 * A client sends one per fixed step — 60 a second, a few percent more while
	 * its clock runs fast — so three times that is never reached by a player
	 * and is a flood by anything else.
	 */
	admit(nowMs: number): boolean {
		if (nowMs - this.windowStart >= MS_PER_WINDOW) {
			this.windowStart = nowMs;
			this.windowCount = 0;
		}
		if (++this.windowCount > MAX_PACKETS_PER_WINDOW) {
			this.throttled++;
			return false;
		}
		return true;
	}

	/** Queue depth after each consumed tick, for the jitter buffer's size. */
	private depthSum = 0;
	private depthSamples = 0;
	private depthMax = 0;

	sampleDepth(depth: number) {
		this.depthSum += depth;
		this.depthSamples++;
		if (depth > this.depthMax) this.depthMax = depth;
	}

	/** The `net` message: plain numbers, cumulative since the client joined. */
	report(): NetReportMsg {
		return {
			packets: this.packets,
			accepted: this.accepted,
			duplicates: this.duplicates,
			lost: this.lost,
			overflow: this.overflow,
			starved: this.starved,
			repeated: this.repeated,
			throttled: this.throttled,
			avgDepth:
				this.depthSamples > 0
					? Math.round((this.depthSum / this.depthSamples) * 100) / 100
					: 0,
			maxDepth: this.depthMax,
		};
	}
}
