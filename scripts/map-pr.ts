#!/usr/bin/env node
/**
 * Open a pull request for a map in `maps/<id>/` — the map maker's checkout
 * route (Publish → "Save into this checkout", then this).
 *
 *   tsx scripts/map-pr.ts castle-keep              # media present? open the PR
 *   tsx scripts/map-pr.ts castle-keep --record     # (re)film it against bots first
 *   tsx scripts/map-pr.ts castle-keep --dry-run    # everything but git and gh
 *
 * What it does:
 *
 * 1. Reads `maps/<id>/map.json` through the server's own sanitiser and runs the
 *    map maker's checks; an error stops it here, as it stops Publish.
 * 2. Makes sure the PR has its proof. Anything missing — the overview, the
 *    play-test screenshots, the clip — is produced by driving the running dev
 *    servers with Playwright: the overview from the editor's own renderer, the
 *    frames and the clip from a real online match on the map against bots
 *    (`?map=draft&ai=true`, AI vs AI, filmed by Playwright).
 * 3. Commits the folder on a branch `map/<id>` in a throwaway worktree based on
 *    `origin/<base>` — your working tree is never touched — pushes it (to your
 *    fork when you cannot push to the repository) and runs `gh pr create` with
 *    the same description the browser route writes (`game/maps/pullRequest.ts`).
 *
 * Needs the dev servers for step 2 (`pnpm run dev:herdr`) and an authenticated
 * `gh` for step 3. `ffmpeg`, when present, trims the clip's boot frames.
 */

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { checkMap, publishable } from "../src/game/maps/checks";
import {
	commitMessage,
	MAP_REPO,
	MAX_PR_SHOTS,
	mediaNames,
	prBody,
	prBranch,
	prTitle,
} from "../src/game/maps/pullRequest";
import {
	sanitizeTilemap,
	type TilemapSpec,
} from "../src/game/simulation/Tilemap";

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const ID = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
const DRY = flag("dry-run");
const RECORD = flag("record");
const REPO = arg("repo", MAP_REPO);
const BASE = arg("base", "main");
const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const BOTS = Number(arg("bots", "5"));
const CLIP_SEC = Number(arg("seconds", "20"));
/** The match boots and shows FIGHT before anything worth filming happens. */
const LEAD_IN_SEC = 3;
const SHOT_AT_SEC = [6, 12, 18];

const ROOT = process.cwd();
const DIR = path.join(ROOT, "maps", ID);

function sh(cmd: string, args: string[], cwd = ROOT): string {
	return execFileSync(cmd, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function has(bin: string): boolean {
	try {
		execFileSync(bin, ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		try {
			execFileSync(bin, ["--version"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	}
}

function fail(msg: string): never {
	console.error(`✖ ${msg}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. The map
// ---------------------------------------------------------------------------

if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(ID))
	fail("usage: tsx scripts/map-pr.ts <map-id> [--record] [--dry-run]");
if (!existsSync(path.join(DIR, "map.json")))
	fail(`maps/${ID}/map.json not found`);
const raw = JSON.parse(
	readFileSync(path.join(DIR, "map.json"), "utf8"),
) as unknown;
const sanitised = sanitizeTilemap(raw);
if (!sanitised) fail(`maps/${ID}/map.json is not a readable golpe map`);
const spec: TilemapSpec = {
	...sanitised,
	meta: { ...sanitised.meta, id: ID, name: sanitised.meta?.name ?? ID },
};
const issues = checkMap(spec);
for (const i of issues)
	console.log(
		`  ${i.level === "error" ? "✖" : i.level === "warning" ? "▲" : "ℹ"} ${i.message}`,
	);
if (!publishable(issues))
	fail("the map has errors — fix them in the map maker first");
console.log(
	`✓ ${spec.meta?.name} (${spec.theme}, ${spec.width / 100} screen${spec.width === 100 ? "" : "s"}) passes the checks`,
);

// ---------------------------------------------------------------------------
// 2. The proof
// ---------------------------------------------------------------------------

const files = () => readdirSync(DIR);
const shots = () =>
	files()
		.filter((f) => /^screenshot-[2-4]\.png$/.test(f))
		.sort();
const clip = () => files().find((f) => /^preview\.(webm|mp4)$/.test(f)) ?? null;
const needOverview = RECORD || !files().includes("screenshot-1.png");
const needPlay = RECORD || shots().length === 0 || clip() === null;

if (needOverview || needPlay) {
	try {
		await fetch(BASE_URL);
	} catch {
		fail(
			`media is missing and the dev server is not answering at ${BASE_URL} — run pnpm run dev:herdr`,
		);
	}
	const browser = await chromium.launch();
	try {
		if (needOverview) {
			const page = await browser.newPage();
			await page.goto(`${BASE_URL}/?mapmaker=true&mute=1`);
			await page.waitForFunction(() => window.__mapmaker !== undefined);
			await page.evaluate((m) => window.__mapmaker?.load(m), spec);
			// The theme's tiles load asynchronously; give the renderer a beat.
			await page.waitForTimeout(800);
			const bytes = await page.evaluate(async () =>
				Array.from((await window.__mapmaker?.overview()) ?? []),
			);
			writeFileSync(path.join(DIR, "screenshot-1.png"), Buffer.from(bytes));
			console.log("✓ overview rendered → screenshot-1.png");
			await page.close();
		}
		if (needPlay) {
			const videoDir = mkdtempSync(path.join(tmpdir(), "golpe-map-pr-"));
			const context = await browser.newContext({
				viewport: { width: 800, height: 600 },
				recordVideo: { dir: videoDir, size: { width: 800, height: 600 } },
			});
			// The play-test slot, exactly as the editor fills it.
			await context.addInitScript((m) => {
				window.localStorage.setItem(
					"golpe:mapmaker:playtest",
					JSON.stringify(m),
				);
			}, spec);
			const page = await context.newPage();
			const started = Date.now();
			await page.goto(
				`${BASE_URL}/?map=draft&ai=true&bots=${BOTS}&private=true&mute=1`,
			);
			await page.waitForFunction(
				() => (window.__tilemapDebug?.()?.platforms ?? 0) > 0,
				undefined,
				{ timeout: 20_000 },
			);
			for (const f of shots()) rmSync(path.join(DIR, f));
			for (const [i, t] of SHOT_AT_SEC.slice(0, MAX_PR_SHOTS).entries()) {
				const wait = started + (LEAD_IN_SEC + t) * 1000 - Date.now();
				if (wait > 0) await page.waitForTimeout(wait);
				await page
					.locator("#game-container canvas")
					.screenshot({ path: path.join(DIR, `screenshot-${i + 2}.png`) });
			}
			const end = started + (LEAD_IN_SEC + CLIP_SEC + 1) * 1000 - Date.now();
			if (end > 0) await page.waitForTimeout(end);
			const video = page.video();
			await context.close();
			const recorded = await video?.path();
			if (!recorded) fail("Playwright did not record a video");
			const old = clip();
			if (old) rmSync(path.join(DIR, old));
			const out = path.join(DIR, "preview.webm");
			if (has("ffmpeg")) {
				sh("ffmpeg", [
					"-y",
					"-loglevel",
					"error",
					"-ss",
					String(LEAD_IN_SEC),
					"-i",
					recorded,
					"-t",
					String(CLIP_SEC),
					"-c:v",
					"libvpx-vp9",
					"-b:v",
					"700k",
					"-maxrate",
					"900k",
					"-bufsize",
					"1800k",
					"-an",
					out,
				]);
			} else {
				copyFileSync(recorded, out);
			}
			rmSync(videoDir, { recursive: true, force: true });
			console.log(
				`✓ filmed ${CLIP_SEC}s against ${BOTS} bots → preview.webm (${Math.round(statSync(out).size / 1024)} KB) + ${shots().length} screenshots`,
			);
		}
	} finally {
		await browser.close();
	}
}

const video = clip();
const names = mediaNames(
	shots().length,
	video ? (video.endsWith("mp4") ? "mp4" : "webm") : null,
);
// The folder as the PR will hold it: the sanitised map, then the media.
writeFileSync(
	path.join(DIR, "map.json"),
	`${JSON.stringify(spec, null, "\t")}\n`,
);

// ---------------------------------------------------------------------------
// 3. The pull request
// ---------------------------------------------------------------------------

const title = prTitle(spec);
if (DRY) {
	console.log(`\n--dry-run: would open "${title}" on ${REPO} with:`);
	for (const f of files()) console.log(`  maps/${ID}/${f}`);
	console.log(`\n${prBody(spec, issues, names, (n) => `maps/${ID}/${n}`)}`);
	process.exit(0);
}

if (!has("gh")) fail("the GitHub CLI (gh) is needed to open the pull request");
const login = sh("gh", ["api", "user", "--jq", ".login"]);
const permission = sh("gh", [
	"repo",
	"view",
	REPO,
	"--json",
	"viewerPermission",
	"--jq",
	".viewerPermission",
]);
const canPush = ["ADMIN", "MAINTAIN", "WRITE"].includes(permission);
let pushRepo = REPO;
if (!canPush) {
	sh("gh", ["repo", "fork", REPO, "--clone=false"]);
	pushRepo = `${login}/${REPO.split("/")[1]}`;
	console.log(`✓ using your fork ${pushRepo}`);
}

let branch = prBranch(ID);
try {
	sh("git", ["rev-parse", "--verify", "--quiet", branch]);
	branch = `${branch}-${Date.now().toString(36)}`;
} catch {
	// The branch name is free.
}

sh("git", ["fetch", "origin", BASE]);
const tree = mkdtempSync(path.join(tmpdir(), "golpe-map-pr-tree-"));
rmSync(tree, { recursive: true, force: true });
sh("git", ["worktree", "add", "-b", branch, tree, `origin/${BASE}`]);
try {
	const target = path.join(tree, "maps", ID);
	execFileSync("mkdir", ["-p", target]);
	for (const f of files())
		copyFileSync(path.join(DIR, f), path.join(target, f));
	sh("git", ["add", `maps/${ID}`], tree);
	sh("git", ["commit", "-m", commitMessage(spec)], tree);
	const sha = sh("git", ["rev-parse", "HEAD"], tree);
	const remote = canPush ? "origin" : `https://github.com/${pushRepo}.git`;
	sh("git", ["push", remote, `HEAD:refs/heads/${branch}`], tree);
	const bodyFile = path.join(tmpdir(), `golpe-map-pr-${ID}.md`);
	writeFileSync(
		bodyFile,
		prBody(
			spec,
			issues,
			names,
			(n) =>
				`https://raw.githubusercontent.com/${pushRepo}/${sha}/maps/${ID}/${n}`,
		),
	);
	const url = sh("gh", [
		"pr",
		"create",
		"--repo",
		REPO,
		"--base",
		BASE,
		"--head",
		canPush ? branch : `${login}:${branch}`,
		"--title",
		title,
		"--body-file",
		bodyFile,
	]);
	console.log(`\n🎉 ${url}`);
} finally {
	sh("git", ["worktree", "remove", "--force", tree]);
}
