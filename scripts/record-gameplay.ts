#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Record README gameplay from the live, authoritative game.
 *
 * Boots a private room full of AI (`?ai=true`, so no name prompt and no human
 * seat), samples the scoreboard every 250ms, then cuts the busiest `--seconds`
 * window of the recording instead of hoping the last half minute was good.
 *
 * Produces an H.264 MP4 (the real video) and an animated WebP (the inline
 * README hero — GitHub autoplays WebP and strips `<video>` tags).
 *
 *   tsx scripts/record-gameplay.ts
 *   tsx scripts/record-gameplay.ts --bots=15 --capture=90
 *   tsx scripts/record-gameplay.ts --url="http://localhost:8084/?ai=true&bots=7&ultCharge=100"
 */
import type { MatchStateSnapshot } from "../src/types/global";

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const BOTS = Number(arg("bots", "7"));
const SECONDS = Number(arg("seconds", "30"));
const CAPTURE_SEC = Number(arg("capture", "90"));
const WIDTH = Number(arg("width", "800"));
const HEIGHT = Number(arg("height", "600"));
const FPS = Number(arg("fps", "15"));
const QUALITY = Number(arg("quality", "55"));
const CRF = Number(arg("crf", "23"));
const OUT = arg("out", "media");
const NAME = arg("name", "gameplay");
const URL =
	arg("url", "") || `${BASE_URL}/?ai=true&bots=${BOTS}&mute=1&scoreLimit=999`;

const SAMPLE_MS = 250;
/** The sample cadence is the scoring resolution; a window is found to 250ms. */
const LEAD_IN_SEC = 1;
/** The most ultimate cinematic one `--seconds` window may contain. */
const MAX_CARD_SEC = Number(arg("maxCards", "3"));

interface Sample {
	t: number;
	kills: number;
	frozen: boolean;
	phase: string;
}

/** Sample frags and the ultimate's freeze card so the cut can be chosen by action. */
async function sampleRoom(
	page: import("playwright").Page,
	captureSec: number,
): Promise<Sample[]> {
	const samples: Sample[] = [];
	const t0 = Date.now();
	while ((Date.now() - t0) / 1000 < captureSec) {
		const state: MatchStateSnapshot | null = await page.evaluate(
			() => window.__matchState?.() ?? null,
		);
		if (!state) {
			await page.waitForTimeout(SAMPLE_MS);
			continue;
		}
		const frozen = await page.evaluate(
			() => window.__ultState?.().cinematic !== null,
		);
		const kills = state.standings.reduce((sum, s) => sum + s.kills, 0);
		samples.push({
			t: (Date.now() - t0) / 1000,
			kills,
			frozen,
			phase: state.phase,
		});
		if (state.phase === "over") break;
		await page.waitForTimeout(SAMPLE_MS);
	}
	return samples;
}

/** What one second of a freeze card costs a window, in frags. */
const FROZEN_WEIGHT = 1.5;

/**
 * The start of the window with the most fighting: frags minus card time.
 *
 * `maxCardSec` caps how much ultimate cinematic a window may contain, so the
 * cut cannot be a sequence of portrait cards — the ultimate barrage a full
 * meter buys lands early and coincides with most of the frags. Windows over
 * the cap are only used if no window is under it.
 */
function busiestWindow(
	samples: Sample[],
	windowSec: number,
	maxCardSec: number,
): { start: number; kills: number; frozen: number } {
	if (samples.length === 0) return { start: 0, kills: 0, frozen: 0 };
	const total = samples[samples.length - 1]!.t;
	if (total <= windowSec) return { start: 0, kills: 0, frozen: 0 };
	type Candidate = {
		start: number;
		kills: number;
		frozen: number;
		score: number;
	};
	// Three tiers, best first: a clean open under the card cap, then any clean
	// open, then anything. Opening on a freeze card is the one flaw a README
	// hero cannot have — it is the frame that decides whether anyone watches.
	const capped: Candidate[] = [];
	const clean: Candidate[] = [];
	const any: Candidate[] = [];
	for (let start = 0; start + windowSec <= total; start += SAMPLE_MS / 1000) {
		const end = start + windowSec;
		const first = samples.find((s) => s.t >= start - LEAD_IN_SEC);
		let kills = 0;
		let frozen = 0;
		for (let i = 1; i < samples.length; i++) {
			const a = samples[i - 1]!;
			const b = samples[i]!;
			if (b.t < start || b.t > end) continue;
			kills += Math.max(0, b.kills - a.kills);
			if (b.frozen) frozen += SAMPLE_MS / 1000;
		}
		const candidate = {
			start,
			kills,
			frozen,
			score: kills - FROZEN_WEIGHT * frozen,
		};
		any.push(candidate);
		if (first && !first.frozen) {
			clean.push(candidate);
			if (frozen <= maxCardSec) capped.push(candidate);
		}
	}
	const pick = (pool: Candidate[]) =>
		pool.length === 0
			? null
			: pool.reduce((a, b) => (b.score > a.score ? b : a));
	const chosen = pick(capped) ?? pick(clean) ?? pick(any);
	if (chosen === null) return { start: 0, kills: 0, frozen: 0 };
	return { ...chosen, start: Math.max(0, chosen.start - LEAD_IN_SEC) };
}

/** The freeze-card intervals inside the cut, relative to its start. */
function cardIntervals(
	samples: Sample[],
	start: number,
	windowSec: number,
): string[] {
	const out: string[] = [];
	let open: number | null = null;
	for (const s of samples) {
		if (s.t < start || s.t > start + windowSec) continue;
		if (s.frozen && open === null) open = s.t;
		if (!s.frozen && open !== null) {
			out.push(`${(open - start).toFixed(1)}–${(s.t - start).toFixed(1)}s`);
			open = null;
		}
	}
	if (open !== null) out.push(`${(open - start).toFixed(1)}–end`);
	return out;
}

function ffmpeg(args: string[]) {
	execFileSync(
		"ffmpeg",
		["-hide_banner", "-loglevel", "error", "-y", ...args],
		{
			stdio: "inherit",
		},
	);
}

function sizeMB(file: string): string {
	return `${(statSync(file).size / 1_000_000).toFixed(1)}MB`;
}

async function main() {
	const outDir = path.resolve(OUT);
	mkdirSync(outDir, { recursive: true });
	const framesDir = mkdtempSync(path.join(tmpdir(), "golpe-frames-"));

	const browser = await chromium.launch();
	const startedAt = Date.now();
	const context = await browser.newContext({
		viewport: { width: WIDTH, height: HEIGHT },
		recordVideo: { dir: framesDir, size: { width: WIDTH, height: HEIGHT } },
	});
	const page = await context.newPage();
	page.on("pageerror", (e) => console.error(`[PAGEERROR] ${e.message}`));
	await page.goto(URL);
	await page.waitForFunction(() => typeof window.__matchState === "function", {
		timeout: 20000,
	});
	console.log(`[REC] ${URL}`);
	console.log(`[REC] sampling ${CAPTURE_SEC}s of fight at ${WIDTH}x${HEIGHT}`);
	await page.waitForFunction(
		() => {
			const s = window.__matchState?.();
			return !!s && s.phase === "live" && s.fighterCount > 1;
		},
		{ timeout: 30000 },
	);
	// The video clock starts when the context is created, seconds before the
	// room is live. Sample times must be shifted by that boot offset before
	// they can be used as ffmpeg seeks.
	const bootSec = (Date.now() - startedAt) / 1000;
	const samples = await sampleRoom(page, CAPTURE_SEC);
	const frags = (samples.at(-1)?.kills ?? 0) - (samples[0]?.kills ?? 0);
	console.log(
		`[REC] ${frags} frags sampled across ${samples.at(-1)?.t.toFixed(1) ?? 0}s`,
	);

	const video = page.video();
	await context.close();
	await browser.close();
	const webm = await video?.path();
	if (!webm) throw new Error("playwright recorded no video");

	const cut = busiestWindow(samples, SECONDS, MAX_CARD_SEC);
	const seek = bootSec + cut.start;
	console.log(
		`[REC] busiest ${SECONDS}s starts at ${cut.start.toFixed(1)}s ` +
			`(${cut.kills} frags, ${cut.frozen.toFixed(1)}s of cards) ` +
			`— video ${seek.toFixed(1)}s after ${bootSec.toFixed(1)}s of boot`,
	);
	console.log(
		`[REC] cards in cut: ${cardIntervals(samples, cut.start, SECONDS).join(", ") || "none"}`,
	);

	ffmpeg([
		"-ss",
		String(seek),
		"-t",
		String(SECONDS),
		"-i",
		webm,
		"-vf",
		`fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
		path.join(framesDir, "f-%05d.png"),
	]);
	const frames = readdirSync(framesDir)
		.filter((f) => f.endsWith(".png"))
		.sort()
		.map((f) => path.join(framesDir, f));
	if (frames.length === 0) throw new Error("no frames cut from the recording");

	const mp4 = path.join(outDir, `${NAME}.mp4`);
	ffmpeg([
		"-ss",
		String(seek),
		"-t",
		String(SECONDS),
		"-i",
		webm,
		"-vf",
		`scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
		"-c:v",
		"libx264",
		"-preset",
		"slow",
		"-crf",
		String(CRF),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		"-an",
		mp4,
	]);

	const webp = path.join(outDir, `${NAME}.webp`);
	execFileSync(
		"img2webp",
		[
			"-loop",
			"0",
			frames[0]!,
			"-lossy",
			"-q",
			String(QUALITY),
			"-m",
			"4",
			"-d",
			String(Math.round(1000 / FPS)),
			...frames.slice(1),
			"-o",
			webp,
		],
		{ stdio: "inherit" },
	);

	console.log(`[REC] ${frames.length} frames → ${NAME}.mp4 ${sizeMB(mp4)}`);
	console.log(`[REC] ${frames.length} frames → ${NAME}.webp ${sizeMB(webp)}`);
	rmSync(framesDir, { recursive: true, force: true });
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
