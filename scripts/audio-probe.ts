#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import type { Browser, Page } from "playwright";
/**
 * The audio feedback loop.
 *
 * Audio is the one sense the other probes cannot touch: they stop reading at
 * the frame the match ends and never listen at all. This drives a real page —
 * the root menu first, then a live bot match — and asserts what the audio
 * engine's diagnostics can prove:
 *
 *   1. the context reaches "running" once a gesture happens (the autoplay
 *      policy is the one thing that silences a game that was never muted),
 *   2. the *menu* music latches and plays on the root page,
 *   3. the mixer write path works and persists across a reload (a volume set
 *      here is the same `localStorage` the Sound menu writes),
 *   4. the fight music latches in a match, and real one-shots — swings, hits,
 *      jumps, shots — fire off the live room, not the menu's ui clicks.
 *
 *   tsx scripts/audio-probe.ts
 *   tsx scripts/audio-probe.ts --bots=4 --runs=2
 */
import { chromium } from "playwright";
import type { AudioKitState } from "../src/game/sound/engine";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";

/** How long the page's music gets to latch after the unlock click. */
const TRACK_LATCH_MS = 5000;
/** How long a bot match gets to produce combat sounds. A duel's first
 * exchange happens inside the first few seconds, but not always the first. */
const MATCH_LISTEN_MS = 16000;
/** Minimum one-shots the match must have produced. Failure really is silence. */
const MIN_MATCH_SOUNDS = 6;
/** sfx louder than the threshold compose the report — a single jackhammer
 * sound is a design bug, so the probe names what it heard. */
const SOUND_BAR = 3;

function arg(name: string, fallback?: string): string | undefined {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}

const RUNS = Number(arg("runs", "1") ?? "1");
const BOTS = Number(arg("bots", "2") ?? "2");

async function waitForAudio(page: Page): Promise<void> {
	await page.waitForFunction(() => typeof window.__audioState === "function", {
		timeout: 20000,
	});
}

async function audioState(page: Page): Promise<AudioKitState> {
	return page.evaluate(() => window.__audioState!());
}

async function waitForAudioField(
	page: Page,
	check: (s: AudioKitState) => boolean,
	timeoutMs: number,
): Promise<AudioKitState | null> {
	const deadline = Date.now() + timeoutMs;
	let last: AudioKitState | null = null;
	while (Date.now() < deadline) {
		last = await audioState(page);
		if (check(last)) return last;
		await page.waitForTimeout(200);
	}
	return last;
}

/** One run: menu silence-before-gesture → gesture → music → mixer → a match. */
async function runOne(browser: Browser) {
	const ctx = await browser.newContext({
		viewport: { width: 900, height: 900 },
	});
	const page = await ctx.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	// 1. The root menu. No gesture yet — the context must be suspended, and
	// that state is itself the check that we are not faking a headless render.
	await page.goto(BASE_URL);
	await waitForAudio(page);
	const before = await audioState(page);
	await page.mouse.move(20, 20);
	await page.mouse.click(20, 20); // unlock: any pointerdown anywhere

	const menu = await waitForAudioField(
		page,
		(s) => s.contextState === "running" && s.track === "title" && s.playing,
		TRACK_LATCH_MS,
	);

	// 2. The mixer write path, through the same store the Sound menu writes.
	await page.evaluate(() => window.__audioSetVolume!("music", 0.3));
	const withMix = await audioState(page);
	const musicVolume = withMix.preferences.volumes.music;

	// 3. Persistence: a reload must come back with the same mix.
	await page.reload();
	await waitForAudio(page);
	const reloaded = await audioState(page);

	// 4. A live match, with bots, heard from the local fighter's seat. The hero
	// is pinned so the track under test is Lia's theme, not a coin flip.
	const room = randomUUID().slice(0, 8);
	await page.goto(
		`${BASE_URL}/?ai=true&bots=${BOTS}&room=audio-probe-${room}&hero=lia`,
	);
	await waitForAudio(page);
	await page.waitForTimeout(1200);
	// The AI client never blocks on the name modal, but the *autoplay* policy
	// still needs one gesture for the context — the bots can't click.
	await page.mouse.click(20, 20);

	const fight = await waitForAudioField(
		page,
		(s) => s.track === "lia" && s.playing,
		TRACK_LATCH_MS,
	);

	// Listen while the bots exchange: a duel's first hit lands inside seconds.
	const listenUntil = Date.now() + MATCH_LISTEN_MS;
	let heard = await audioState(page);
	while (Date.now() < listenUntil) {
		heard = await audioState(page);
		if (heard.soundsPlayed >= MIN_MATCH_SOUNDS + 10) break;
		await page.waitForTimeout(500);
	}

	await ctx.close();

	return {
		failures: collectFailures(
			{ before, menu, musicVolume, reloaded, fight, heard, errors },
			MIN_MATCH_SOUNDS,
		),
		report: {
			beforeGesture: {
				contextState: before.contextState,
			},
			menu: menu
				? {
						track: menu.track,
						playing: menu.playing,
						sounds: listSounds(menu.byName, SOUND_BAR),
					}
				: null,
			mixer: { musicVolumeAfterWrite: musicVolume },
			reloadedMix: { musicVolume: reloaded.preferences.volumes.music },
			fight: fight
				? {
						track: fight.track,
						playing: fight.playing,
					}
				: null,
			matchSounds: {
				total: heard.soundsPlayed,
				heard: { ...heard.byName },
			},
			musicErrors: heard.musicErrors,
			pageErrors: errors.length,
		},
	};
}

function collectFailures(
	r: {
		before: AudioKitState;
		menu: AudioKitState | null;
		musicVolume: number;
		reloaded: AudioKitState;
		fight: AudioKitState | null;
		heard: AudioKitState;
		errors: string[];
	},
	minMatchSounds: number,
): string[] {
	const f: string[] = [];
	if (r.before.contextState !== "suspended") {
		f.push(`context was '${r.before.contextState}' before the first gesture`);
	}
	if (!r.menu) f.push("menu music did not latch");
	if (Math.abs(r.musicVolume - 0.3) > 0.001) {
		f.push(`mixer write did not stick (got ${r.musicVolume})`);
	}
	if (Math.abs(r.reloaded.preferences.volumes.music - 0.3) > 0.001) {
		f.push("mixer did not persist across reload");
	}
	if (!r.fight) f.push("fight music did not latch");
	if (r.heard.soundsPlayed < minMatchSounds) {
		f.push(`only ${r.heard.soundsPlayed} sounds in the match — silence?`);
	}
	if (r.heard.musicErrors > 0) {
		f.push(`${r.heard.musicErrors} music decode/fetch errors`);
	}
	if (r.errors.length) f.push(`page errors: ${r.errors.length}`);
	return f;
}

function listSounds(toList: Record<string, number>, bar: number): string[] {
	return Object.entries(toList)
		.filter(([name, count]) => count > bar && name.startsWith("ui") === false)
		.map(([name, count]) => `${name}x${count}`);
}

async function main() {
	const browser = await chromium.launch();
	let failed = false;
	for (let run = 0; run < RUNS; run++) {
		const report = await runOne(browser);
		console.log(`\n===== AUDIO run ${run + 1} =====`);
		console.log(JSON.stringify(report.report, null, 2));
		if (report.failures.length) {
			failed = true;
			console.log("failures:", report.failures);
		} else {
			console.log("verdict: PASS");
		}
	}
	await browser.close();
	process.exit(failed ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
