#!/usr/bin/env node
/**
 * Play of the Game: the ceremony, end to end.
 *
 * **Nothing else in the suite can see any of this.** Every other probe stops
 * reading the moment `phase === "over"` — which is the exact frame this begins.
 * A server that scored nobody, a clip that never downloaded, a pre-roll that
 * silently degraded into a static wide shot, a replay drawing zero fighters: all
 * of it leaves `diagnose`, `deathmatch` and `tdm` green.
 *
 * So this plays a short AI-vs-AI match to a winner and then watches what happens
 * *after* the whistle:
 *
 *   - the server announced a play, with a headline and a protagonist;
 *   - the footage was fetchable over HTTP, and is a real clip;
 *   - every camera movement ran, in order, and each one actually moved;
 *   - the footage played, dropped into slow motion on a scoring beat, and shook
 *     once per beat rather than once per frame;
 *   - the replay drew fighters rather than an empty arena;
 *   - the podium waited, and then arrived.
 *
 *   node scripts/potg-probe.mjs
 *   node scripts/potg-probe.mjs --fighters=6 --scoreLimit=4
 *   node scripts/potg-probe.mjs --mode=tdm --scoreLimit=1
 */
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE_URL = process.env.VENTO_URL ?? "http://localhost:8080";
const SERVER_URL = process.env.VENTO_SERVER_URL ?? "http://localhost:9208";

function arg(name, fallback) {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split("=")[1] : fallback;
}

const FIGHTERS = Number(arg("fighters", 4));
const SCORE_LIMIT = Number(arg("scoreLimit", 3));
const TIME_LIMIT_SEC = Number(arg("timeLimit", 120));
const MODE = arg("mode", "ffa");
/**
 * Arm everybody, so the reel has an ultimate in it.
 *
 * The black hole is the one thing in the footage that is not a fighter: the
 * grenade, the singularity and the caster's immunity are all recorded per frame
 * and replayed from the clip rather than from the live match. Without this the
 * replay path for all three is simply never taken in a probe.
 */
const ULT_CHARGE = arg("ultCharge", "");
/** Give up rather than hang if the match never ends. */
const MATCH_TIMEOUT_MS = (TIME_LIMIT_SEC + 60) * 1000;
/** The whole ceremony: pre-roll, footage and outro. Generous — a long play runs ~20s. */
const CEREMONY_TIMEOUT_MS = 45000;

/** The movements, in the order the director must run them. */
const MOVEMENTS = ["establish", "push", "whip", "roll", "outro"];

function sinkConsole(page, lines = []) {
	page.on("console", (msg) => lines.push(msg.text()));
	page.on("pageerror", (err) => lines.push(`[PAGEERROR] ${err.message}`));
	return lines;
}

async function assertServerUp() {
	const res = await fetch(`${SERVER_URL}/health`).catch(() => null);
	if (!res?.ok) {
		throw new Error(
			`game server unreachable on ${SERVER_URL} — start it with \`npm run dev:herdr\``,
		);
	}
}

async function poll(page, read, done, timeoutMs, everyMs = 200) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await page.evaluate(read);
		if (last && done(last)) return last;
		await page.waitForTimeout(everyMs);
	}
	return last;
}

/**
 * Watch the ceremony while it runs, keeping the richest state seen.
 *
 * Sampled rather than read once at the end, because most of what is being
 * checked only exists *during* the replay: `phase`, `zoom`, `drawn` and the
 * live camera track are all gone the moment it hands the screen back.
 */
async function watchCeremony(page) {
	const deadline = Date.now() + CEREMONY_TIMEOUT_MS;
	const phases = [];
	let best = null;
	let sawActive = false;
	let minZoom = Number.POSITIVE_INFINITY;
	let maxZoom = 0;
	let maxDrawn = 0;
	let minRate = Number.POSITIVE_INFINITY;

	while (Date.now() < deadline) {
		const state = await page.evaluate(() => window.__potgState?.() ?? null);
		if (state) {
			if (state.announced) best = { ...state, track: state.track };
			if (state.active) {
				sawActive = true;
				minZoom = Math.min(minZoom, state.zoom);
				maxZoom = Math.max(maxZoom, state.zoom);
				maxDrawn = Math.max(maxDrawn, state.drawn);
				if (state.rate > 0) minRate = Math.min(minRate, state.rate);
				if (state.phase && phases[phases.length - 1] !== state.phase) {
					phases.push(state.phase);
				}
			}
			// The ceremony is over once it went active and stopped being so.
			if (sawActive && !state.active) break;
			// Card-only: announced, never active, and the announcement clears itself.
			if (best && !state.announced && !state.active) break;
		}
		await page.waitForTimeout(60);
	}

	return { best, phases, sawActive, minZoom, maxZoom, maxDrawn, minRate };
}

function assess({ ceremony, clipOverHttp, final, podium, lines, hudDuring }) {
	const failures = [];
	const notes = [];
	const { best, phases, sawActive, minZoom, maxZoom, maxDrawn, minRate } =
		ceremony;

	if (!best?.announced) {
		failures.push("no play of the game was announced");
		return { failures, notes };
	}

	const announced = best.announced;
	if (!announced.protagonistName) failures.push("the play has no protagonist");
	if (!announced.headline) failures.push("the play has no headline");
	if (!(announced.score > 0)) failures.push("the play scored zero");

	if (!announced.hasClip) {
		failures.push("the server kept no footage of its own play of the game");
	}

	// The footage, fetched the way the client fetches it. Checked from node as
	// well as through the page, because a CORS header the browser silently
	// enforces is exactly the kind of thing that only breaks in one of the two.
	if (!clipOverHttp) {
		failures.push("GET /potg/<room> served no clip");
	} else {
		if (!(clipOverHttp.frames > 0)) failures.push("the clip has no frames");
		if (!(clipOverHttp.cast > 0)) failures.push("the clip has no cast");
		if (!(clipOverHttp.beats > 0)) {
			failures.push("the clip has no scoring beats");
		}
		if (!(clipOverHttp.durationMs > 1000)) {
			failures.push(`the clip is only ${clipOverHttp.durationMs}ms long`);
		}
		if (!(clipOverHttp.actionAtMs > 0)) {
			// The lead-in is what the pre-roll holds on. Zero means the play opens on
			// its own kill, which reads as a cut rather than as a highlight.
			notes.push("the clip has no lead-in before the first scoring beat");
		}
	}

	if (!sawActive) {
		failures.push("the replay never played — announcement only");
		return { failures, notes, announced };
	}

	// Every movement, in order. A subsequence check rather than equality: the
	// sampler runs at 60ms and can miss nothing, but it must never see them out
	// of order or see one missing entirely.
	let cursor = 0;
	for (const phase of phases) {
		const at = MOVEMENTS.indexOf(phase, cursor);
		if (at < 0) {
			failures.push(`camera movements out of order at "${phase}"`);
			break;
		}
		cursor = at;
	}
	for (const movement of MOVEMENTS) {
		if (!phases.includes(movement)) {
			failures.push(`the "${movement}" movement never ran`);
		}
	}

	// The pre-roll's whole job is to move a camera, and this is the only thing
	// that can tell it did. A static shot passes every other check in this file.
	const track = best.track ?? [];
	const byPhase = new Map(track.map((t) => [t.phase, t]));
	const establish = byPhase.get("establish");
	const push = byPhase.get("push");
	const whip = byPhase.get("whip");
	const roll = byPhase.get("roll");

	// Asserted relative to the push rather than against 1.0, because the replay
	// camera is floored at the zoom that still fills the arena — the game's world
	// is exactly one viewport tall, so "wide" here means "wide *for this level*".
	if (push && establish && !(establish.maxZoom < push.maxZoom * 0.7)) {
		failures.push(
			`the establishing shot was not wide (${establish.maxZoom.toFixed(2)} vs push ${push.maxZoom.toFixed(2)})`,
		);
	}
	if (push && establish && !(push.maxZoom > establish.maxZoom * 1.5)) {
		failures.push(
			`the push did not push in (${establish.maxZoom.toFixed(2)} -> ${push.maxZoom.toFixed(2)})`,
		);
	}
	if (whip && !(whip.travel > 20)) {
		failures.push(`the whip pan did not swing (${whip.travel.toFixed(1)}px)`);
	}
	if (!(maxZoom > minZoom * 1.4)) {
		failures.push(
			`the camera never really moved (zoom ${minZoom.toFixed(2)}..${maxZoom.toFixed(2)})`,
		);
	}

	// Slow motion on a beat, and one shake per beat rather than one per frame.
	if (!(minRate < 0.9)) {
		failures.push(`the footage never slowed down (min rate ${minRate})`);
	}
	if (roll && clipOverHttp && roll.shakes > clipOverHttp.beats) {
		failures.push(
			`${roll.shakes} impact shakes for ${clipOverHttp.beats} beats — a rattle, not an impact`,
		);
	}
	if (roll && roll.shakes === 0) {
		notes.push("no impact shake fired during the roll");
	}
	if (roll && !(roll.maxRate >= 1)) {
		failures.push("the footage never reached full speed");
	}

	// A clean run is not a good run: everything above holds for a replay of an
	// empty arena.
	if (maxDrawn === 0) failures.push("the replay drew no fighters");

	if (hudDuring.podium) {
		failures.push("the podium was up during the replay");
	}
	if (hudDuring.hud) {
		failures.push("the fight HUD was up during the replay");
	}
	if (!hudDuring.overlay) {
		failures.push("the ceremony's overlay never rendered");
	}

	if (!podium) failures.push("the podium never arrived after the ceremony");
	if (final?.phase !== "over") {
		notes.push(`match phase is ${final?.phase} after the ceremony`);
	}

	const errors = lines.filter((l) => /\[PAGEERROR\]/.test(l));
	if (errors.length > 0) failures.push(`${errors.length} page error(s)`);

	return { failures, notes, announced, errors: errors.slice(0, 3) };
}

async function main() {
	await assertServerUp();
	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const lines = sinkConsole(page);

	// A private room the probe owns, on rules short enough to reach a winner.
	// `ai=true` makes the local fighter a bot and skips the name prompt.
	const room = randomUUID();
	const url =
		`${BASE_URL}/?ai=true&room=${room}&bots=${FIGHTERS - 1}` +
		`&scoreLimit=${SCORE_LIMIT}&timeLimit=${TIME_LIMIT_SEC}` +
		(MODE === "tdm" ? "&mode=tdm&freezeTime=1" : "") +
		(ULT_CHARGE ? `&ultCharge=${ULT_CHARGE}` : "");
	console.log(`[PROBE] ${url}`);
	await page.goto(url);
	await page.waitForFunction(() => typeof window.__potgState === "function", {
		timeout: 20000,
	});

	const seated = await poll(
		page,
		() => window.__matchState?.() ?? null,
		(s) => s.connected && s.fighterCount >= FIGHTERS,
		20000,
	);
	console.log(`[PROBE] seated: ${seated?.fighterCount ?? 0} fighters`);

	const over = await poll(
		page,
		() => window.__matchState?.() ?? null,
		(s) => s.phase === "over",
		MATCH_TIMEOUT_MS,
		400,
	);
	console.log(`[PROBE] match over: ${over?.winnerName ?? "nobody"}`);

	// Watch the ceremony, and sample the DOM while it is up: the podium waiting
	// its turn is a real requirement and is invisible to `__potgState`.
	const hudDuring = { podium: false, hud: false, overlay: false };
	const watcher = watchCeremony(page);
	const domWatcher = (async () => {
		const deadline = Date.now() + CEREMONY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const seen = await page
				.evaluate(() => ({
					active: window.__potgState?.().active ?? false,
					overlay: !!document.querySelector(".vp-root"),
					podium: !!document.querySelector(".vd-veil"),
					hud: !!document.querySelector(".vdh-hud"),
				}))
				.catch(() => null);
			if (!seen) break;
			if (seen.active) {
				hudDuring.overlay ||= seen.overlay;
				hudDuring.podium ||= seen.podium;
				hudDuring.hud ||= seen.hud;
			}
			if (hudDuring.overlay && !seen.active) break;
			await page.waitForTimeout(80);
		}
	})();
	const ceremony = await watcher;
	await domWatcher;

	// The footage, fetched exactly the way the client fetches it.
	const roomId = over?.roomId ?? room;
	const raw = await fetch(`${SERVER_URL}/potg/${roomId}`).catch(() => null);
	const clip = raw?.ok ? await raw.json() : null;
	const clipOverHttp = clip && {
		bytes: JSON.stringify(clip).length,
		frames: clip.frames?.length ?? 0,
		cast: clip.cast?.length ?? 0,
		beats: clip.beats?.length ?? 0,
		durationMs: clip.durationMs ?? 0,
		actionAtMs: clip.actionAtMs ?? 0,
		protagonist: clip.protagonist?.name ?? "",
	};

	// And the podium, which had to wait for its turn.
	const podium = await poll(
		page,
		() => !!document.querySelector(".vd-veil"),
		(seen) => seen === true,
		8000,
	);
	const final = await page.evaluate(() => window.__matchState?.() ?? null);

	const verdict = assess({
		ceremony,
		clipOverHttp,
		final,
		podium,
		lines,
		hudDuring,
	});

	console.log("\n===== PLAY OF THE GAME =====");
	console.log(
		JSON.stringify(
			{
				verdict:
					verdict.failures.length === 0
						? "PASS"
						: `FAIL: ${verdict.failures.join("; ")}`,
				notes: verdict.notes,
				play: verdict.announced && {
					protagonist: verdict.announced.protagonistName,
					headline: verdict.announced.headline,
					subtitle: verdict.announced.subtitle,
					score: verdict.announced.score,
					kills: verdict.announced.kills,
					hasClip: verdict.announced.hasClip,
				},
				clip: clipOverHttp,
				movements: ceremony.phases,
				camera: {
					zoom: [
						Number(ceremony.minZoom.toFixed(2)),
						Number(ceremony.maxZoom.toFixed(2)),
					],
					slowestFootage: Number(ceremony.minRate.toFixed(2)),
					fightersDrawn: ceremony.maxDrawn,
				},
				track: (ceremony.best?.track ?? []).map((t) => ({
					phase: t.phase,
					ms: Math.round(t.ms),
					travelPx: Number(t.travel.toFixed(1)),
					zoom: [Number(t.minZoom.toFixed(2)), Number(t.maxZoom.toFixed(2))],
					rate: [Number(t.minRate.toFixed(2)), Number(t.maxRate.toFixed(2))],
					shakes: t.shakes,
				})),
				overlay: hudDuring,
				pageErrors: verdict.errors,
			},
			null,
			2,
		),
	);

	await ctx.close();
	await browser.close();
	if (verdict.failures.length > 0) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
