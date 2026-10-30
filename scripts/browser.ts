import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium } from "playwright";

/** Is this host this machine? The only targets a probe may drive by default. */
function isLoopbackHost(host: string): boolean {
	const h = host.replace(/^\[|\]$/g, "").toLowerCase();
	return (
		h === "localhost" ||
		h === "::1" ||
		h === "0.0.0.0" ||
		h.startsWith("127.")
	);
}

/** Extract the host from `host:port`, `http://host:port` or `https://host`. */
function hostOf(value: string): string {
	try {
		const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
		return url.hostname;
	} catch {
		return value.split(/[:/]/)[0] ?? value;
	}
}

/**
 * Refuse to point a probe at somebody else's machine.
 *
 * `GOLPE_URL` and `GOLPE_SERVER` exist so a probe can measure a built client or
 * a second server — but a stray value in an agent shell is enough to send a
 * Playwright run at a developer's *personal* open game server, which starts a
 * real match there. Localhost is the default and the only target a probe may
 * choose implicitly; a remote target requires the explicit opt-in below.
 */
function assertLocalProbeTarget(): void {
	if (process.env.GOLPE_ALLOW_REMOTE_PROBES === "1") return;
	for (const key of ["GOLPE_URL", "GOLPE_SERVER"] as const) {
		const value = process.env[key];
		if (!value) continue;
		if (!isLoopbackHost(hostOf(value))) {
			throw new Error(
				`${key}=${value} is not this machine. Probes are local-only: ` +
					"set GOLPE_ALLOW_REMOTE_PROBES=1 only when you mean to drive that host.",
			);
		}
	}
}

/**
 * Chromium for every probe — on the GPU when the machine has one.
 *
 * Headless and launched here, never through a remote browser: a probe exists to
 * measure *this* checkout, and a browser on another display or machine would
 * talk to whatever server happens to be listening there.
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

export async function launchBrowser(
	options: Parameters<typeof chromium.launch>[0] = {},
): Promise<Browser> {
	assertLocalProbeTarget();
	const browser = await chromium.launch({
		...options,
		// Headless is the default and the contract: a probe must never drive a
		// visible browser on somebody's desktop, let alone another display.
		headless: options.headless ?? true,
		args: [...GPU_ARGS, ...(options.args ?? [])],
	});
	const server = process.env.GOLPE_SERVER;
	if (server) redirectGameServer(browser, server);
	guardForeignPages(browser);
	return browser;
}

/**
 * Close any page that is not this machine.
 *
 * The last line of defence after the env check: a probe that reaches a page
 * served from another host would otherwise drive that host's game server and
 * start a match on somebody else's computer. It fails loudly instead.
 */
function guardForeignPages(browser: Browser) {
	if (process.env.GOLPE_ALLOW_REMOTE_PROBES === "1") return;
	const watch = (page: import("playwright").Page) => {
		page.on("framenavigated", (frame) => {
			if (frame !== page.mainFrame()) return;
			const url = frame.url();
			if (!url.startsWith("http")) return;
			if (!isLoopbackHost(hostOf(url))) {
				console.error(
					`[probe] refusing a page from ${hostOf(url)} — probes are local-only`,
				);
				void page.close();
			}
		});
	};
	const newContext = browser.newContext.bind(browser);
	browser.newContext = async (...args) => {
		const ctx = await newContext(...args);
		ctx.on("page", watch);
		return ctx;
	};
	const newPage = browser.newPage.bind(browser);
	browser.newPage = async (...args) => {
		const page = await newPage(...args);
		watch(page);
		return page;
	};
}

/**
 * Point every page's `localhost:9208` at `GOLPE_SERVER` instead.
 *
 * `?server=` is a launch key, so a probe of the *menu* cannot carry it — and a
 * menu reads the game server's health from the page's own host. Routing the
 * requests (health, rooms, the WebRTC signalling POSTs) moves every probe to a
 * dev server on another port without touching one of them; the data channel's
 * UDP port is negotiated by ICE from that server, so it follows on its own.
 */
function redirectGameServer(browser: Browser, server: string) {
	const route = async (ctx: BrowserContext) => {
		await ctx.route(/^http:\/\/localhost:9208\//, async (r) => {
			const url = r.request().url().replace("localhost:9208", server);
			try {
				await r.fulfill({ response: await r.fetch({ url }) });
			} catch {
				// The page closed mid-request — nothing left to answer.
				await r.abort().catch(() => {});
			}
		});
		return ctx;
	};
	const newContext = browser.newContext.bind(browser);
	browser.newContext = async (...args) => route(await newContext(...args));
	browser.newPage = async (...args) => {
		const ctx = await browser.newContext(...args);
		const page = await ctx.newPage();
		page.on("close", () => void ctx.close());
		return page;
	};
}

/**
 * The game server a probe's *own* (Node-side) requests should reach — the
 * page's are routed by `launchBrowser`.
 */
export function gameServerUrl(): string {
	return `http://${process.env.GOLPE_SERVER ?? "localhost:9208"}`;
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
