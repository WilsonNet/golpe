/**
 * The client the LAN pack serves.
 *
 * `dist` is the same Vite build the hosted site serves. The pack does not build
 * a LAN client, patch one, or ship a second one: it stages `pnpm build`'s output
 * and hands it to the browser. That is the first half of "the LAN binary is a
 * distribution, not a fork".
 *
 * The handler is synchronous at the routing decision and hands the actual bytes
 * to `sirv`, which already knows about ranges, conditional requests and MIME
 * types. It is deliberately not a general-purpose static server: no directory
 * listings, no dotfiles, no SPA rewrite.
 */

import { statSync } from "node:fs";
import type http from "node:http";
import { join, normalize, resolve, sep } from "node:path";
import sirv from "sirv";

/** The one request hook `createGameServer` accepts. */
export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
) => boolean;

const INDEX = "index.html";

/** The cache policy the hosted Caddy file already uses. */
const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

function resolveRequest(root: string, url: string | undefined): string | null {
	const pathname = (url ?? "/").split("?")[0] ?? "/";
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	// `/` is the game; everything else is a path under the build. A directory
	// request is not a file, so it falls through to the game's own 404 rather
	// than silently serving an index the build does not have.
	const rel = decoded === "/" ? INDEX : decoded.replace(/^\/+/, "");
	if (rel.length === 0 || rel.endsWith("/")) return null;
	const file = normalize(join(root, rel));
	if (!file.startsWith(`${root}${sep}`) && file !== root) return null;
	try {
		return statSync(file).isFile() ? file : null;
	} catch {
		return null;
	}
}

/**
 * Serve `dist` for the requests a file actually answers.
 *
 * Returns `true` only when a file exists; a miss falls through so `/health`,
 * `/rooms`, `/potg` and the geckos signalling paths keep their own handlers.
 */
export function staticRoutes(root: string): RouteHandler {
	const absolute = resolve(root);
	const serve = sirv(absolute, {
		dev: false,
		etag: true,
		// The hash in the filename is the invalidation for `assets/`; the rest is
		// small and gets revalidated, exactly like the deployed client.
		maxAge: 0,
		extensions: [],
		dotfiles: false,
		setHeaders: (res, pathname) => {
			res.setHeader(
				"Cache-Control",
				pathname.includes("/assets/") ? IMMUTABLE : NO_CACHE,
			);
		},
	});

	return (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") return false;
		if (resolveRequest(absolute, req.url) === null) return false;
		// `sirv` does not turn a directory request into its index by itself, and
		// this build has no directory routes. `/` is the game; rewrite it before
		// handing the request over.
		const raw = req.url ?? "/";
		if (raw === "/" || raw.startsWith("/?")) {
			req.url = `/index.html${raw.slice(1)}`;
		}
		serve(req, res);
		return true;
	};
}
