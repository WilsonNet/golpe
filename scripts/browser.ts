import { type Browser, chromium } from "playwright";

/**
 * Chromium for every probe — on the GPU when the machine has one.
 *
 * Headless Chromium's default WebGL is SwiftShader, a CPU rasteriser, and the
 * game drew at 10-16fps under it. A client below 12fps hits the fixed step's
 * 5-step catch-up cap, so it simulated (and sent input) at half speed: the
 * server starved half its ticks and an input took 118ms to be acknowledged on
 * localhost. Every netcode number the probes reported was a measurement of a
 * client nobody plays on. These flags hand WebGL to the real GPU through ANGLE;
 * on a machine without one Chromium falls back to SwiftShader, as before, and
 * `diagnose.ts` reports the frame rate it got.
 */
export const GPU_ARGS = [
	"--enable-gpu",
	"--ignore-gpu-blocklist",
	"--use-angle=gl",
];

export function launchBrowser(
	options: Parameters<typeof chromium.launch>[0] = {},
): Promise<Browser> {
	return chromium.launch({
		...options,
		args: [...GPU_ARGS, ...(options.args ?? [])],
	});
}

/**
 * `GOLPE_SERVER=host:port` and `GOLPE_NETSIM=40/10/2` for a probe with no
 * flags of its own: the query to append to a game URL so the client dials that
 * game server, over that shaped link. Empty when neither is set.
 */
export function probeQuery(): string {
	const server = process.env.GOLPE_SERVER;
	const netsim = process.env.GOLPE_NETSIM;
	return (
		(server ? `&server=${server}` : "") + (netsim ? `&netsim=${netsim}` : "")
	);
}
