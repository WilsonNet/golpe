import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium } from "playwright";

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

/**
 * Serve a local client build in place of the page origin's own files.
 *
 * `GOLPE_URL=https://golpe.quest diagnose --dist=dist` measures a client that
 * has not shipped against the live server, over the real internet, from the
 * live origin — so the page is HTTPS and dials the server exactly as a player's
 * would. Anything the build lacks falls through to the network.
 */
export async function serveDist(
	ctx: BrowserContext,
	origin: string,
	dist: string,
): Promise<void> {
	const root = resolve(dist);
	await ctx.route(`${origin}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		const file = join(root, path === "/" ? "index.html" : path);
		if (
			!file.startsWith(root) ||
			!existsSync(file) ||
			!statSync(file).isFile()
		) {
			return route.fallback();
		}
		return route.fulfill({
			body: readFileSync(file),
			contentType: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
		});
	});
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".webp": "image/webp",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".svg": "image/svg+xml",
};
