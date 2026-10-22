/**
 * Publish: from "I enjoyed this map" to a pull request on the main repo.
 *
 * Three steps on one sheet, each one unlocking the next, so the player always
 * sees what is missing rather than discovering it at the end:
 *
 *   1. **About** — name, GitHub username, a sentence. The slug is derived.
 *   2. **Proof** — the checks pass, one play-test clip, and screenshots. The
 *      overview is rendered from the map; the rest come from play-tests, and
 *      "Play-test now" is right there when they are missing.
 *   3. **Send** — sign in with GitHub (device flow), paste a token, or, on a
 *      dev server, save into this checkout for `pnpm map:pr`.
 *
 * The PR body is previewed as it will be posted, and the same builder
 * (`game/maps/pullRequest.ts`) is what the command-line route uses.
 */

import { useEffect, useState } from "react";
import { checkMap, type MapIssue, publishable } from "../../game/maps/checks";
import {
	commitMessage,
	MAP_REPO,
	MAX_PR_SHOTS,
	mediaNames,
	prBody,
	prBranch,
	prTitle,
} from "../../game/maps/pullRequest";
import { clipExtension } from "./capture";
import {
	type DeviceCode,
	type GitHubConfig,
	githubConfig,
	openPullRequest,
	type PrFile,
	type Step,
	startDeviceFlow,
	waitForToken,
	whoAmI,
} from "./github";
import { type EditorMap, playableSpec, slugify } from "./model";
import { renderOverview } from "./scene";
import { listMedia, type MediaItem, putMedia, removeMedia } from "./storage";

interface Props {
	map: EditorMap;
	onChange: (patch: Partial<EditorMap>) => void;
	onPlaytest: () => void;
	onClose: () => void;
	/** Bumped by the shell whenever a play-test saves media. */
	mediaVersion: number;
}

const STEP_LABELS: Record<Step, string> = {
	account: "Checking your account",
	fork: "Forking the repository",
	sync: "Syncing your fork",
	upload: "Uploading the map, screenshots and clip",
	commit: "Committing",
	branch: "Creating the branch",
	"pull-request": "Opening the pull request",
};

type Send =
	| { kind: "idle" }
	| { kind: "device"; code: DeviceCode }
	| { kind: "working"; step: Step }
	| { kind: "done"; url: string }
	| { kind: "saved"; path: string }
	| { kind: "error"; message: string };

function useObjectUrls(items: MediaItem[]): Map<string, string> {
	const [urls, setUrls] = useState(new Map<string, string>());
	useEffect(() => {
		const next = new Map(items.map((i) => [i.id, URL.createObjectURL(i.blob)]));
		setUrls(next);
		return () => {
			for (const u of next.values()) URL.revokeObjectURL(u);
		};
	}, [items]);
	return urls;
}

/** Is this page served by the dev server, which can write into the checkout? */
async function devSaveAvailable(): Promise<boolean> {
	try {
		const res = await fetch("/__mapmaker/ping");
		return res.ok;
	} catch {
		return false;
	}
}

export function Publish({
	map,
	onChange,
	onPlaytest,
	onClose,
	mediaVersion,
}: Props) {
	const [media, setMedia] = useState<MediaItem[]>([]);
	const [overview, setOverview] = useState<Blob | null>(null);
	const [config, setConfig] = useState<GitHubConfig | null>(null);
	const [devSave, setDevSave] = useState(false);
	const [token, setToken] = useState("");
	const [showToken, setShowToken] = useState(false);
	const [send, setSend] = useState<Send>({ kind: "idle" });
	const [abort, setAbort] = useState<AbortController | null>(null);
	const urls = useObjectUrls(media);
	const [overviewUrl, setOverviewUrl] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-read when a play-test saved something.
	useEffect(() => {
		void listMedia(map.localId).then(setMedia);
	}, [map.localId, mediaVersion]);

	useEffect(() => {
		let url: string | null = null;
		void renderOverview(map).then((blob) => {
			setOverview(blob);
			url = URL.createObjectURL(blob);
			setOverviewUrl(url);
		});
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	}, [map]);

	useEffect(() => {
		void githubConfig().then(setConfig);
		void devSaveAvailable().then(setDevSave);
	}, []);

	const spec = playableSpec(map);
	const issues: MapIssue[] = spec ? checkMap(spec) : [];
	const errors = issues.filter((i) => i.level === "error");
	const shots = media.filter((m) => m.kind === "shot");
	const videos = media.filter((m) => m.kind === "video");
	const pickedShots = shots.filter((s) => s.selected).slice(0, MAX_PR_SHOTS);
	const video = videos.filter((v) => v.selected).at(-1) ?? null;
	const videoExt = video ? clipExtension(video.blob.type) : null;

	const aboutOk = map.name.trim().length > 0 && map.author.trim().length > 0;
	const proofOk =
		!!spec && publishable(issues) && !!video && pickedShots.length > 0;
	const ready = aboutOk && proofOk && !!overview;

	const names = mediaNames(pickedShots.length, videoExt);
	const files = (): PrFile[] => {
		if (!spec || !overview) return [];
		const dir = `maps/${map.slug}`;
		const out: PrFile[] = [
			{
				path: `${dir}/map.json`,
				data: `${JSON.stringify(spec, null, "\t")}\n`,
			},
			{ path: `${dir}/${names.overview}`, data: overview },
		];
		pickedShots.forEach((s, i) => {
			const name = names.shots[i];
			if (name) out.push({ path: `${dir}/${name}`, data: s.blob });
		});
		if (video && names.video)
			out.push({ path: `${dir}/${names.video}`, data: video.blob });
		return out;
	};

	const toggle = async (item: MediaItem) => {
		const selected = !item.selected;
		// One clip per PR: picking a clip un-picks the others.
		if (item.kind === "video" && selected) {
			for (const v of videos)
				if (v.selected && v.id !== item.id)
					await putMedia({ ...v, selected: false });
		}
		if (item.kind === "shot" && selected && pickedShots.length >= MAX_PR_SHOTS)
			return;
		await putMedia({ ...item, selected });
		setMedia(await listMedia(map.localId));
	};

	const drop = async (item: MediaItem) => {
		await removeMedia(item.id);
		setMedia(await listMedia(map.localId));
	};

	const run = async (tok: string) => {
		if (!spec) return;
		setSend({ kind: "working", step: "account" });
		try {
			const result = await openPullRequest(
				{
					token: tok,
					repo: config?.repo ?? MAP_REPO,
					branch: prBranch(map.slug),
					title: prTitle(spec),
					message: commitMessage(spec),
					files: files(),
					body: (fork, sha) =>
						prBody(
							spec,
							issues,
							names,
							(name) =>
								`https://raw.githubusercontent.com/${fork}/${sha}/maps/${map.slug}/${name}`,
						),
				},
				(step) => setSend({ kind: "working", step }),
			);
			setSend({ kind: "done", url: result.url });
		} catch (err) {
			setSend({
				kind: "error",
				message: String(err instanceof Error ? err.message : err),
			});
		}
	};

	const signIn = async () => {
		const controller = new AbortController();
		setAbort(controller);
		try {
			const code = await startDeviceFlow();
			setSend({ kind: "device", code });
			const tok = await waitForToken(code, controller.signal);
			await run(tok);
		} catch (err) {
			if (!controller.signal.aborted)
				setSend({
					kind: "error",
					message: String(err instanceof Error ? err.message : err),
				});
		}
	};

	const withToken = async () => {
		try {
			await whoAmI(token.trim());
		} catch {
			setSend({
				kind: "error",
				message:
					"That token was refused by GitHub. It needs the public_repo scope (or Contents + Pull requests: write on a fine-grained token).",
			});
			return;
		}
		await run(token.trim());
	};

	const saveLocal = async () => {
		setSend({ kind: "working", step: "upload" });
		try {
			const payload: Record<string, string> = {};
			for (const f of files()) {
				const name = f.path.split("/").at(-1) ?? "";
				const blob = typeof f.data === "string" ? new Blob([f.data]) : f.data;
				payload[name] = await blobToBase64(blob);
			}
			const res = await fetch("/__mapmaker/save", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: map.slug, files: payload }),
			});
			const body = (await res.json()) as { path?: string; error?: string };
			if (!res.ok || !body.path)
				throw new Error(body.error ?? `save failed (${res.status})`);
			setSend({ kind: "saved", path: body.path });
		} catch (err) {
			setSend({
				kind: "error",
				message: String(err instanceof Error ? err.message : err),
			});
		}
	};

	const body = spec
		? prBody(spec, issues, names, (name) => `maps/${map.slug}/${name}`)
		: "";

	return (
		<div
			className="mm-sheet-veil"
			role="dialog"
			aria-modal="true"
			aria-label="Publish your map"
		>
			<div className="mm-sheet mm-publish" data-testid="mapmaker-publish">
				<header className="mm-sheet-head">
					<h2>Publish to the golpe repository</h2>
					<p className="mm-muted">
						Your map becomes a pull request on <b>{config?.repo ?? MAP_REPO}</b>{" "}
						— with screenshots and a play-test clip — so it can join the game's
						map list.
					</p>
					<button
						type="button"
						className="mm-x"
						onClick={() => {
							abort?.abort();
							onClose();
						}}
						aria-label="Close"
					>
						✕
					</button>
				</header>

				<section className={`mm-step ${aboutOk ? "ok" : ""}`}>
					<h3>
						<span className="mm-step-n">1</span> About the map
					</h3>
					<div className="mm-form">
						<label>
							Map name
							<input
								value={map.name}
								maxLength={60}
								onChange={(e) =>
									onChange({
										name: e.target.value,
										slug: slugify(e.target.value),
									})
								}
								data-testid="publish-name"
							/>
						</label>
						<label>
							Your GitHub username
							<input
								value={map.author}
								maxLength={39}
								placeholder="octocat"
								onChange={(e) =>
									onChange({ author: e.target.value.replace(/^@/, "") })
								}
								data-testid="publish-author"
							/>
						</label>
						<label className="mm-wide">
							<span>
								One line about it <span className="mm-muted">(optional)</span>
							</span>
							<input
								value={map.description}
								maxLength={200}
								placeholder="What makes this map fun?"
								onChange={(e) => onChange({ description: e.target.value })}
							/>
						</label>
						<div className="mm-muted mm-wide">
							Folder: <code>maps/{map.slug}/</code> · plays at{" "}
							<code>?map={map.slug}</code>
						</div>
					</div>
				</section>

				<section className={`mm-step ${proofOk ? "ok" : ""}`}>
					<h3>
						<span className="mm-step-n">2</span> Proof it plays
					</h3>
					<ul className="mm-checklist">
						<li className={spec && publishable(issues) ? "ok" : "bad"}>
							{spec && publishable(issues)
								? `Checks pass${issues.some((i) => i.level === "warning") ? ` (${issues.filter((i) => i.level === "warning").length} warnings — fine to publish)` : ""}`
								: `Fix ${errors.length} error${errors.length === 1 ? "" : "s"} in the Checks panel first`}
						</li>
						<li className={video ? "ok" : "bad"}>
							{video
								? `Play-test clip: ${video.seconds}s`
								: "Record a play-test clip against bots"}
						</li>
						<li className={pickedShots.length > 0 ? "ok" : "bad"}>
							{pickedShots.length > 0
								? `${pickedShots.length} play-test screenshot${pickedShots.length === 1 ? "" : "s"} picked (up to ${MAX_PR_SHOTS})`
								: "Take at least one play-test screenshot"}
						</li>
					</ul>
					{!video || pickedShots.length === 0 ? (
						<button
							type="button"
							className="mm-btn mm-btn-primary"
							onClick={onPlaytest}
							data-testid="publish-playtest"
						>
							▶ Play-test now — the clip and screenshots are captured for you
						</button>
					) : null}
					<div className="mm-media">
						{overviewUrl ? (
							<figure className="mm-media-item picked fixed">
								<img src={overviewUrl} alt="The whole map" />
								<figcaption>Overview · always included</figcaption>
							</figure>
						) : null}
						{videos.map((v) => (
							<figure
								key={v.id}
								className={`mm-media-item ${v.selected ? "picked" : ""}`}
							>
								<video
									src={urls.get(v.id)}
									muted
									loop
									playsInline
									onMouseEnter={(e) => void e.currentTarget.play()}
									onMouseLeave={(e) => e.currentTarget.pause()}
								/>
								<figcaption>
									<button type="button" onClick={() => void toggle(v)}>
										{v.selected ? "✓ The clip" : "Use this clip"}
									</button>
									<button
										type="button"
										className="mm-link"
										onClick={() => void drop(v)}
									>
										delete
									</button>
								</figcaption>
							</figure>
						))}
						{shots.map((s) => (
							<figure
								key={s.id}
								className={`mm-media-item ${s.selected ? "picked" : ""}`}
							>
								<img src={urls.get(s.id)} alt={`Play-test at ${s.seconds}s`} />
								<figcaption>
									<button type="button" onClick={() => void toggle(s)}>
										{s.selected ? "✓ Included" : "Include"}
									</button>
									<button
										type="button"
										className="mm-link"
										onClick={() => void drop(s)}
									>
										delete
									</button>
								</figcaption>
							</figure>
						))}
					</div>
				</section>

				<section className={`mm-step ${send.kind === "done" ? "ok" : ""}`}>
					<h3>
						<span className="mm-step-n">3</span> Send it
					</h3>
					{!ready ? (
						<p className="mm-muted">Finish steps 1 and 2 to send.</p>
					) : null}
					{send.kind === "done" ? (
						<p className="mm-success" data-testid="publish-done">
							🎉 Pull request opened:{" "}
							<a href={send.url} target="_blank" rel="noreferrer">
								{send.url}
							</a>
						</p>
					) : send.kind === "saved" ? (
						<div className="mm-success" data-testid="publish-saved">
							<p>
								Saved into <code>{send.path}</code>. Open the pull request from
								your checkout:
							</p>
							<pre>pnpm map:pr {map.slug}</pre>
						</div>
					) : send.kind === "device" ? (
						<div className="mm-device">
							<p>
								Open{" "}
								<a
									href={send.code.verification_uri}
									target="_blank"
									rel="noreferrer"
								>
									{send.code.verification_uri}
								</a>{" "}
								and enter:
							</p>
							<div className="mm-code">{send.code.user_code}</div>
							<p className="mm-muted">Waiting for GitHub…</p>
						</div>
					) : send.kind === "working" ? (
						<p className="mm-working">⏳ {STEP_LABELS[send.step]}…</p>
					) : (
						<div className="mm-send">
							{config?.deviceFlow ? (
								<button
									type="button"
									className="mm-btn mm-btn-primary"
									disabled={!ready}
									onClick={() => void signIn()}
								>
									Sign in with GitHub & open the PR
								</button>
							) : null}
							{devSave ? (
								<button
									type="button"
									className={`mm-btn ${config?.deviceFlow ? "" : "mm-btn-primary"}`}
									disabled={!ready}
									onClick={() => void saveLocal()}
									data-testid="publish-save-local"
								>
									Save into this checkout, then run pnpm map:pr
								</button>
							) : null}
							<button
								type="button"
								className="mm-link"
								onClick={() => setShowToken((v) => !v)}
							>
								{showToken ? "Hide" : "Use a GitHub token instead"}
							</button>
							{showToken ? (
								<div className="mm-token">
									<input
										type="password"
										placeholder="ghp_… or github_pat_…"
										value={token}
										onChange={(e) => setToken(e.target.value)}
										autoComplete="off"
									/>
									<button
										type="button"
										className="mm-btn"
										disabled={!ready || token.trim().length < 20}
										onClick={() => void withToken()}
									>
										Open the PR
									</button>
									<p className="mm-muted">
										Create one at github.com → Settings → Developer settings →
										Tokens, with <code>public_repo</code>. It is used in this
										tab only and never saved.
									</p>
								</div>
							) : null}
						</div>
					)}
					{send.kind === "error" ? (
						<p className="mm-error">
							{send.message}{" "}
							<button
								type="button"
								className="mm-link"
								onClick={() => setSend({ kind: "idle" })}
							>
								Try again
							</button>
						</p>
					) : null}
				</section>

				<details className="mm-preview">
					<summary>Preview the pull request description</summary>
					<pre data-testid="publish-body">{body}</pre>
				</details>
			</div>
		</div>
	);
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}
