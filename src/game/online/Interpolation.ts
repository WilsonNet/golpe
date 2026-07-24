/**
 * Entity interpolation for objects the client does not simulate (the remote
 * player, server-owned bullets).
 *
 * Snapshots arrive at 20Hz and rendering runs at 60Hz+, so drawing the newest
 * snapshot directly shows every network hiccup as a stutter. Instead we render
 * the world slightly in the past and interpolate between the two snapshots
 * that straddle that render time — smooth output at the cost of a fixed,
 * predictable delay.
 */

/**
 * How far behind the newest snapshot to render, in ms.
 *
 * Three snapshot intervals at 20Hz. Two was not enough headroom: a single late
 * or dropped datagram emptied the buffer, the sampler clamped to the newest
 * sample, and the remote player visibly teleported ~100px in one frame.
 */
export const INTERPOLATION_DELAY_MS = 150;

interface Sample {
	t: number;
	x: number;
	y: number;
}

/** Frame-rate independent exponential smoothing toward a target. */
export function friLerp(
	current: number,
	target: number,
	factor: number,
	dtSec: number,
): number {
	const t = 1 - (1 - factor) ** (dtSec * 60);
	return current + (target - current) * t;
}

export class RemoteInterpolator {
	private samples: Sample[] = [];

	constructor(private readonly delayMs = INTERPOLATION_DELAY_MS) {}

	get hasData(): boolean {
		return this.samples.length > 0;
	}

	push(t: number, x: number, y: number) {
		// Out-of-order or duplicate snapshots are dropped rather than reordered.
		const last = this.samples[this.samples.length - 1];
		if (last && t <= last.t) return;

		this.samples.push({ t, x, y });

		// Keep a little more history than the delay needs.
		const cutoff = t - this.delayMs * 4;
		while (this.samples.length > 2 && this.samples[0].t < cutoff) {
			this.samples.shift();
		}
	}

	/**
	 * Position to draw at, for a given current server-clock time.
	 * Falls back to the newest sample when there is nothing to interpolate.
	 */
	sample(nowServerMs: number): { x: number; y: number } | null {
		if (this.samples.length === 0) return null;
		if (this.samples.length === 1) {
			return { x: this.samples[0].x, y: this.samples[0].y };
		}

		const target = nowServerMs - this.delayMs;

		for (let i = this.samples.length - 1; i > 0; i--) {
			const b = this.samples[i];
			const a = this.samples[i - 1];
			if (a.t <= target && target <= b.t) {
				const span = b.t - a.t;
				const f = span > 0 ? (target - a.t) / span : 1;
				return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
			}
		}

		// Target is outside the buffer: clamp to the nearest end rather than
		// extrapolating, which would overshoot on a stall.
		const newest = this.samples[this.samples.length - 1];
		const oldest = this.samples[0];
		return target > newest.t
			? { x: newest.x, y: newest.y }
			: { x: oldest.x, y: oldest.y };
	}

	reset() {
		this.samples.length = 0;
	}
}

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
