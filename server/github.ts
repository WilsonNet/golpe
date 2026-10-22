/**
 * The map maker's "Sign in with GitHub", relayed.
 *
 * GitHub's OAuth device flow is the sign-in a static page can do without a
 * secret: the page asks for a code, the player types it at
 * github.com/login/device, and the page polls for the token. The two endpoints
 * involved (`/login/device/code` and `/login/oauth/access_token`) do not send
 * CORS headers, so a browser cannot call them — this relays exactly those two
 * calls and nothing else. It holds only the OAuth app's **client id**, which is
 * public by design; the token it relays goes straight back to the player's tab
 * and is never stored or logged here.
 *
 * Configured by environment:
 *
 *   GOLPE_GITHUB_CLIENT_ID   an OAuth app with "Enable Device Flow" ticked
 *   GOLPE_MAP_REPO           where map PRs go (default WilsonNet/golpe)
 *
 * Without a client id, `/github/config` says so and the map maker offers its
 * other two routes (a pasted token, or a local checkout + `gh`).
 */

import type http from "node:http";

/** By variable, not literal — see `env` in `index.ts` for why. */
function env(name: string): string | undefined {
	return process.env[name];
}

const CLIENT_ID = env("GOLPE_GITHUB_CLIENT_ID") ?? "";
const MAP_REPO = env("GOLPE_MAP_REPO") ?? "WilsonNet/golpe";
/** Enough to open a PR on a public repository, and nothing more. */
const SCOPE = "public_repo";
const DEVICE_CODE_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_BODY_BYTES = 2048;

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;
const HTTP_BAD_GATEWAY = 502;

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function send(res: http.ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "Content-Type": "application/json", ...CORS });
	res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

async function relay(url: string, params: Record<string, string>) {
	const res = await fetch(url, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify(params),
	});
	return { status: res.status, body: (await res.json()) as unknown };
}

/** Handle a `/github/*` request. Returns false when the URL is not one. */
export function handleGithub(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): boolean {
	const path = (req.url ?? "").split("?")[0] ?? "";
	if (!path.startsWith("/github/")) return false;

	if (req.method === "OPTIONS") {
		res.writeHead(HTTP_NO_CONTENT, CORS);
		res.end();
		return true;
	}
	if (req.method === "GET" && path === "/github/config") {
		send(res, HTTP_OK, { deviceFlow: CLIENT_ID.length > 0, repo: MAP_REPO });
		return true;
	}
	if (req.method !== "POST" || CLIENT_ID.length === 0) {
		send(res, HTTP_UNAVAILABLE, {
			error: "github sign-in is not configured on this server",
		});
		return true;
	}

	void (async () => {
		try {
			if (path === "/github/device") {
				const out = await relay("https://github.com/login/device/code", {
					client_id: CLIENT_ID,
					scope: SCOPE,
				});
				send(res, out.status, out.body);
				return;
			}
			if (path === "/github/token") {
				const body = JSON.parse((await readBody(req)) || "{}") as {
					device_code?: unknown;
				};
				const code =
					typeof body.device_code === "string" ? body.device_code : "";
				if (!DEVICE_CODE_RE.test(code)) {
					send(res, HTTP_BAD_REQUEST, { error: "bad device_code" });
					return;
				}
				const out = await relay("https://github.com/login/oauth/access_token", {
					client_id: CLIENT_ID,
					device_code: code,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				});
				send(res, out.status, out.body);
				return;
			}
			send(res, HTTP_BAD_REQUEST, { error: "unknown github endpoint" });
		} catch (err) {
			send(res, HTTP_BAD_GATEWAY, { error: String(err) });
		}
	})();
	return true;
}
