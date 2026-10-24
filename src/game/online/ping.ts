/**
 * Measuring the round trip the fight actually travels.
 *
 * The scoreboard's ping column is measured over the **same WebRTC data channel
 * the simulation already uses**, not with an HTTP request. That choice is the
 * whole design:
 *
 * - A `fetch` would measure a different path (a pooled HTTP connection, a
 *   different socket, possibly a different edge), and a cross-origin one that
 *   fails the "simple request" rules pays a CORS preflight before the timing
 *   even starts. The game channel is already open, already ordered by the
 *   server's tick, and is the path a player's input actually takes.
 * - It costs one tiny unreliable datagram each way per second. No connection,
 *   no keep-alive, no preflight, and nothing on the 20Hz snapshot.
 *
 * The server starts the clock because it is the only side that has to know
 * every player's number; the client just echoes the probe untouched. Recent
 * samples are kept in a short window and the **median** is reported, so one
 * stalled frame or one retransmit-shaped blip does not move the column.
 */

/** How often each human is probed. Once a second is what a scoreboard needs. */
export const PING_INTERVAL_MS = 1000;

/** How many round trips the median is taken over. */
export const PING_SAMPLE_COUNT = 5;

/**
 * The largest believable round trip, ms. A timestamp that claims more than this
 * is a clock jump rather than a link: clamping it keeps the column from reading
 * "31 hours" after the host's NTP wakes up.
 */
export const PING_MAX_MS = 9999;

/**
 * Turn two server-clock readings into a round trip, or null when the pair
 * cannot be one (a clock that went backwards, a value that is not a number).
 */
export function rttFrom(nowMs: number, sentAtMs: number): number | null {
	const rtt = nowMs - sentAtMs;
	if (!Number.isFinite(rtt) || rtt < 0) return null;
	return Math.min(PING_MAX_MS, Math.round(rtt));
}

/** Append one round trip, keeping only the recent window. */
export function addPingSample(samples: number[], rtt: number): void {
	samples.push(rtt);
	if (samples.length > PING_SAMPLE_COUNT) samples.shift();
}

/** The median of the window, or null before the first sample arrives. */
export function medianPing(samples: readonly number[]): number | null {
	if (samples.length === 0) return null;
	const sorted = [...samples].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	const a = sorted[middle];
	if (a === undefined) return null;
	if (sorted.length % 2 === 1) return a;
	const b = sorted[middle - 1] ?? a;
	return Math.round((a + b) / 2);
}
