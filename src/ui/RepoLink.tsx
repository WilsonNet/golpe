/**
 * "Open source — star it on GitHub", with the live star count.
 *
 * The game is open source and the menu is the only page every player sees, so
 * the repository is named there, in the header, rather than in a README a
 * player never opens. The count is fetched from the public GitHub API once a
 * session; every way that can fail (rate limit, offline, a blocked request)
 * costs the number and nothing else — the link is the point, the count is
 * decoration.
 */

import { useEffect, useState } from "react";

const REPO = "WilsonNet/golpe";
export const REPO_URL = `https://github.com/${REPO}`;
const API_URL = `https://api.github.com/repos/${REPO}`;
const CACHE_KEY = "golpe.repoStars";
/** Unauthenticated GitHub allows 60 requests an hour per IP; ten minutes is plenty fresh. */
const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

function cachedStars(): number | null {
	try {
		const raw = sessionStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const { n, at } = JSON.parse(raw) as { n?: unknown; at?: unknown };
		if (typeof n !== "number" || typeof at !== "number") return null;
		return Date.now() - at < CACHE_MS ? n : null;
	} catch {
		return null;
	}
}

function storeStars(n: number) {
	try {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ n, at: Date.now() }));
	} catch {
		/* storage blocked: the next menu asks again */
	}
}

/** 1234 → "1.2k": the badge is a glance, not a ledger. */
export function formatStars(n: number): string {
	if (n < 1000) return String(n);
	const k = n / 1000;
	return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
}

export function RepoLink() {
	const [stars, setStars] = useState<number | null>(() => cachedStars());

	useEffect(() => {
		if (stars !== null) return;
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
		fetch(API_URL, {
			signal: ctrl.signal,
			headers: { Accept: "application/vnd.github+json" },
		})
			.then((r) => (r.ok ? r.json() : null))
			.then((d: { stargazers_count?: unknown } | null) => {
				const n = d?.stargazers_count;
				if (typeof n === "number") {
					storeStars(n);
					setStars(n);
				}
			})
			.catch(() => {
				/* no count, still a link */
			})
			.finally(() => window.clearTimeout(timer));
		return () => {
			window.clearTimeout(timer);
			ctrl.abort();
		};
	}, [stars]);

	return (
		<a
			className="gd-repo"
			href={REPO_URL}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`golpe is open source — star it on GitHub${stars === null ? "" : ` (${stars} stars)`}`}
		>
			<svg
				className="gd-repo-mark"
				viewBox="0 0 16 16"
				width="16"
				height="16"
				aria-hidden="true"
			>
				<path
					fill="currentColor"
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
				/>
			</svg>
			<span className="gd-repo-text">Open source</span>
			<span className="gd-repo-star">
				<span aria-hidden="true">★</span> Star
				{stars === null ? null : (
					<span className="gd-repo-count">{formatStars(stars)}</span>
				)}
			</span>
		</a>
	);
}
