/**
 * Opening a map's pull request from the browser, through the GitHub REST API.
 *
 * A player without a checkout, without git and without the `gh` CLI can still
 * contribute a map: they sign in (the device flow — a code typed at
 * github.com/login/device, no password ever reaches this page) or paste a
 * token, and the page does what a contributor would do by hand:
 *
 *   fork (if they cannot push) → sync the fork → upload every file as a blob →
 *   one tree, one commit, one branch → a pull request against the main repo
 *
 * The device flow's two token endpoints do not allow CORS, so the game server
 * relays them (`/github/device`, `/github/token` — see `server/github.ts`); it
 * only ever holds the public OAuth client id. Everything after sign-in talks
 * to api.github.com directly with the player's own token, which is kept in
 * this tab's memory and nowhere else.
 */

import { httpBaseFor, resolveGameEndpoint } from "../../game/online/regions";

const API = "https://api.github.com";

export interface PrFile {
	/** Path inside the repository, e.g. `maps/castle-keep/map.json`. */
	path: string;
	data: Blob | string;
}

export interface PrRequest {
	token: string;
	/** `owner/name` of the repository the PR is opened against. */
	repo: string;
	branch: string;
	title: string;
	message: string;
	files: PrFile[];
	/**
	 * The description, built once the commit exists, so the images in it can
	 * be pinned to the commit (`raw.githubusercontent.com/<fork>/<sha>/…`).
	 */
	body: (fork: string, sha: string) => string;
}

export interface PrResult {
	url: string;
	number: number;
	fork: string;
	sha: string;
}

export type Step =
	| "account"
	| "fork"
	| "sync"
	| "upload"
	| "commit"
	| "branch"
	| "pull-request";

class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function gh<T>(
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...init.headers,
		},
	});
	if (!res.ok) {
		let detail = "";
		try {
			const body = (await res.json()) as {
				message?: string;
				errors?: { message?: string }[];
			};
			detail = [body.message, ...(body.errors ?? []).map((e) => e.message)]
				.filter(Boolean)
				.join(" — ");
		} catch {
			// No JSON body: the status line is all there is.
		}
		throw new GitHubError(
			`${init.method ?? "GET"} ${path}: ${res.status} ${detail}`.trim(),
			res.status,
		);
	}
	return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function post<T>(token: string, path: string, body: unknown): Promise<T> {
	return gh<T>(token, path, { method: "POST", body: JSON.stringify(body) });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function base64(data: Blob | string): Promise<string> {
	const bytes =
		typeof data === "string"
			? new TextEncoder().encode(data)
			: new Uint8Array(await data.arrayBuffer());
	let binary = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/** Who a token belongs to — also the cheapest check that it works. */
export async function whoAmI(token: string): Promise<string> {
	const me = await gh<{ login: string }>(token, "/user");
	return me.login;
}

export async function openPullRequest(
	req: PrRequest,
	onStep: (s: Step) => void = () => {},
): Promise<PrResult> {
	const { token, repo } = req;
	onStep("account");
	const login = await whoAmI(token);
	const upstream = await gh<{
		default_branch: string;
		permissions?: { push?: boolean };
	}>(token, `/repos/${repo}`);
	const base = upstream.default_branch;
	const canPush = upstream.permissions?.push === true;

	// Contributors who cannot push to the main repo push to their fork, and
	// the PR comes from there — the ordinary open-source flow.
	let target = repo;
	if (!canPush) {
		onStep("fork");
		const fork = await post<{ full_name: string }>(
			token,
			`/repos/${repo}/forks`,
			{
				default_branch_only: true,
			},
		);
		target = fork.full_name;
		// A new fork takes a few seconds to exist.
		for (let i = 0; i < 20; i++) {
			try {
				await gh(token, `/repos/${target}/git/ref/heads/${base}`);
				break;
			} catch (err) {
				if (i === 19) throw err;
				await sleep(1500);
			}
		}
		onStep("sync");
		try {
			await post(token, `/repos/${target}/merge-upstream`, { branch: base });
		} catch {
			// An old fork that cannot fast-forward still makes a valid PR; the
			// diff is computed against upstream either way.
		}
	}

	const head = await gh<{ object: { sha: string } }>(
		token,
		`/repos/${target}/git/ref/heads/${base}`,
	);
	const parent = head.object.sha;
	const parentCommit = await gh<{ tree: { sha: string } }>(
		token,
		`/repos/${target}/git/commits/${parent}`,
	);

	onStep("upload");
	const tree = [];
	for (const file of req.files) {
		const blob = await post<{ sha: string }>(
			token,
			`/repos/${target}/git/blobs`,
			{
				content: await base64(file.data),
				encoding: "base64",
			},
		);
		tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
	}

	onStep("commit");
	const newTree = await post<{ sha: string }>(
		token,
		`/repos/${target}/git/trees`,
		{
			base_tree: parentCommit.tree.sha,
			tree,
		},
	);
	const commit = await post<{ sha: string }>(
		token,
		`/repos/${target}/git/commits`,
		{
			message: req.message,
			tree: newTree.sha,
			parents: [parent],
		},
	);

	onStep("branch");
	let branch = req.branch;
	for (let attempt = 0; ; attempt++) {
		try {
			await post(token, `/repos/${target}/git/refs`, {
				ref: `refs/heads/${branch}`,
				sha: commit.sha,
			});
			break;
		} catch (err) {
			// The branch name is taken (an earlier attempt): suffix it.
			if (!(err instanceof GitHubError) || err.status !== 422 || attempt > 4)
				throw err;
			branch = `${req.branch}-${Math.random().toString(36).slice(2, 7)}`;
		}
	}

	onStep("pull-request");
	const pr = await post<{ html_url: string; number: number }>(
		token,
		`/repos/${repo}/pulls`,
		{
			title: req.title,
			head: canPush ? branch : `${login}:${branch}`,
			base,
			body: req.body(target, commit.sha),
			maintainer_can_modify: true,
		},
	);
	return { url: pr.html_url, number: pr.number, fork: target, sha: commit.sha };
}

// ---------------------------------------------------------------------------
// Sign-in: the OAuth device flow, relayed by the game server.
// ---------------------------------------------------------------------------

function serverBase(): string {
	return httpBaseFor(
		resolveGameEndpoint(window.location.search, window.location.hostname),
		window.location.protocol,
	);
}

export interface GitHubConfig {
	/** The game server has an OAuth app configured — "Sign in with GitHub" works. */
	deviceFlow: boolean;
	repo: string;
}

export async function githubConfig(): Promise<GitHubConfig | null> {
	try {
		const res = await fetch(`${serverBase()}/github/config`);
		return res.ok ? ((await res.json()) as GitHubConfig) : null;
	} catch {
		return null;
	}
}

export interface DeviceCode {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
}

export async function startDeviceFlow(): Promise<DeviceCode> {
	const res = await fetch(`${serverBase()}/github/device`, { method: "POST" });
	if (!res.ok) throw new Error(`Sign-in is unavailable (${res.status})`);
	return (await res.json()) as DeviceCode;
}

/**
 * Wait for the player to type the code at github.com. Resolves with a token,
 * or rejects when they decline, the code expires or `signal` aborts.
 */
export async function waitForToken(
	code: DeviceCode,
	signal: AbortSignal,
): Promise<string> {
	let interval = Math.max(5, code.interval) * 1000;
	const deadline = Date.now() + code.expires_in * 1000;
	while (Date.now() < deadline) {
		await sleep(interval);
		if (signal.aborted) throw new Error("cancelled");
		const res = await fetch(`${serverBase()}/github/token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ device_code: code.device_code }),
		});
		const body = (await res.json()) as {
			access_token?: string;
			error?: string;
			interval?: number;
		};
		if (body.access_token) return body.access_token;
		if (body.error === "authorization_pending") continue;
		if (body.error === "slow_down") {
			interval = (body.interval ?? interval / 1000 + 5) * 1000;
			continue;
		}
		throw new Error(
			body.error === "access_denied"
				? "Sign-in was declined on GitHub"
				: `Sign-in failed: ${body.error}`,
		);
	}
	throw new Error("The sign-in code expired — try again");
}
