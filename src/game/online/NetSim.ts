/**
 * A bad network, on demand: `?netsim=<latencyMs>/<jitterMs>/<lossPct>`.
 *
 * Every probe runs against a server on the same machine, where a datagram is
 * never late, never reordered and never lost — so every netcode path that only
 * runs on a real connection (a lost input, a late one, a starved server queue)
 * was invisible to the feedback loop. `tc netem` needs root and does not travel
 * with a probe; this does, and it shapes both directions from the one place a
 * client can reach: the messages this client sends and the ones it hears.
 *
 * - `latencyMs` is **one-way**, applied to each direction, so the round trip
 *   is twice it.
 * - `jitterMs` spreads each message uniformly over ±jitter around the latency.
 *   Delays are independent, so jitter reorders datagrams exactly as a real
 *   unordered channel does.
 * - `lossPct` drops that share of *unreliable* messages (input, snapshots,
 *   roster). Reliable ones are only delayed: geckos retransmits them, and a
 *   lost `join` would measure a client that never connected.
 *
 * Diagnostics only. It is not a launch key and changes nothing about the game
 * a player sees without it.
 */
export interface NetSimConfig {
	latencyMs: number;
	jitterMs: number;
	/** 0..1 */
	loss: number;
}

const PERCENT = 100;

/** Parse `80/20/5` (ms / ms / percent). Anything malformed means no shaping. */
export function parseNetSim(raw: string | null): NetSimConfig | null {
	if (!raw) return null;
	const [lat, jit, loss] = raw.split("/").map(Number);
	if (lat === undefined || !Number.isFinite(lat) || lat < 0) return null;
	return {
		latencyMs: lat,
		jitterMs: Number.isFinite(jit) && (jit ?? 0) > 0 ? (jit as number) : 0,
		loss:
			Number.isFinite(loss) && (loss ?? 0) > 0
				? Math.min(1, (loss as number) / PERCENT)
				: 0,
	};
}

export class NetSim {
	/** Unreliable messages thrown away, both directions. */
	dropped = 0;
	/** Messages that went through the shaper, both directions. */
	shaped = 0;

	constructor(
		readonly config: NetSimConfig,
		private readonly random: () => number = Math.random,
	) {}

	static fromLocation(): NetSim | null {
		if (typeof location === "undefined") return null;
		const cfg = parseNetSim(new URLSearchParams(location.search).get("netsim"));
		return cfg ? new NetSim(cfg) : null;
	}

	/** Deliver `fn` after one shaped one-way trip; `lossy` messages may vanish. */
	deliver(fn: () => void, lossy: boolean) {
		this.shaped++;
		if (lossy && this.random() < this.config.loss) {
			this.dropped++;
			return;
		}
		const { latencyMs, jitterMs } = this.config;
		const delay = Math.max(0, latencyMs + (this.random() * 2 - 1) * jitterMs);
		setTimeout(fn, delay);
	}
}
