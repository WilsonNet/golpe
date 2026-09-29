/**
 * Smoke-check every launch mode: does it connect, match, and actually fight?
 *
 * The game is online-first, so "does a match happen at all" is a netcode
 * question in every mode — including single player.
 */

import type { Page } from "playwright";
import { chromium } from "playwright";

const BASE = process.env.GOLPE_URL ?? "http://localhost:8084";

/** One launch mode under test. Optional flags describe what the mode seats. */
interface Mode {
	label: string;
	url: string;
	tabs: number;
	needsFight: boolean;
	/** Exact number of fighters the room must seat. */
	fighters?: number;
	/** Pass when the room is empty of opponents (an empty room). */
	alone?: boolean;
	/** Pass when a server bot merely moved (an idle human cannot). */
	solo?: boolean;
	/** The room is a training room; assert the agent API is seated. */
	training?: boolean;
	/**
	 * The ruleset `__matchState` must report. Without it, a URL that asked for
	 * 5CP but booted a deathmatch would pass this smoke test.
	 */
	mode?: "ffa" | "tdm" | "5cp";
}

/**
 * `needsFight` only where a fighter is AI-driven. Playwright never presses a
 * key, so a human-controlled fighter is idle by definition — in those modes the
 * meaningful check is that an opponent exists and is moving under server
 * control, not that damage is dealt.
 */
const MODES: Mode[] = [
	/**
	 * An empty room. **The default now that bots are opt-in**, and worth checking
	 * on its own: it is a fully served, predicted, reconciled match with nobody
	 * else in it, and it is what a player sees for the second before their friends
	 * arrive.
	 */
	{
		label: "empty room (no bots)",
		url: "/",
		tabs: 1,
		needsFight: false,
		alone: true,
		fighters: 1,
	},
	{
		label: "vs one server bot",
		url: "/?bots=1",
		tabs: 1,
		needsFight: false,
		solo: true,
		fighters: 2,
	},
	{
		label: "AI vs AI (one tab)",
		url: "/?ai=true&bots=1",
		tabs: 1,
		needsFight: true,
		fighters: 2,
	},
	/**
	 * Control points: the five-point line. Shortened rules so the smoke check
	 * runs a real capture instead of five minutes of midfight, and a bot on both
	 * sides so the objective module — not just the mode plumbing — is exercised.
	 */
	{
		label: "5 control points (AI vs AI)",
		url: "/?ai=true&bots=3&mode=5cp&capTime=1&freezeTime=1&scoreLimit=1&timeLimit=120",
		tabs: 1,
		needsFight: true,
		fighters: 4,
		mode: "5cp",
	},
	/**
	 * Two humans and **no `fill`**: with bots opt-in, a room of two clients is a
	 * room of two fighters, so there is nothing to evict and nothing to ask for.
	 */
	{
		label: "PvP (two tabs)",
		url: "/?online=true",
		tabs: 2,
		needsFight: false,
		fighters: 2,
	},
	{
		label: "AI vs AI online (two tabs)",
		url: "/?online=true&ai=true",
		tabs: 2,
		needsFight: true,
		fighters: 2,
	},
	/**
	 * The second hero: a dagger-vs-dagger AI duel. The whole hero pipeline —
	 * the kit on the wire, the per-hero sheets, the dagger brain — must boot
	 * and fight exactly like the sword game does.
	 */
	{
		label: "AI vs AI, dagger hero (two tabs)",
		url: "/?online=true&ai=true&hero=anands",
		tabs: 2,
		needsFight: true,
		fighters: 2,
	},
	/**
	 * A room full of AI. The mode the deathmatch exists for, and the one where
	 * everything that only breaks at scale breaks: sixteen fighters, sixteen
	 * predicted bodies, a quadratic hitbox pass and a snapshot big enough to care
	 * about. `scripts/deathmatch-probe.ts` measures it properly; this only asks
	 * whether it stands up.
	 */
	{
		label: "16-fighter deathmatch",
		url: "/?ai=true&bots=15",
		tabs: 1,
		needsFight: true,
		fighters: 16,
	},
	{
		label: "offline escape hatch",
		url: "/?offline=true&ai=true",
		tabs: 1,
		needsFight: true,
	},
	/**
	 * The training room. `needsFight: false` because Playwright presses no keys
	 * and the default dummy is deliberately idle — the check is that a dummy was
	 * seated at all and the match is live, which is what `training` asserts below.
	 */
	{
		label: "training room",
		url: "/?training=true",
		tabs: 1,
		needsFight: false,
		training: true,
	},
];

const browser = await chromium.launch();

for (const [modeIndex, mode] of MODES.entries()) {
	const ctx = await browser.newContext();
	const pages: Page[] = [];
	// One room per mode, shared by that mode's tabs.
	//
	// Both halves matter. Rooms are addressed rather than matchmade, so two tabs
	// opened without a `room` land in two *different* rooms and a PvP check can
	// never pass. And a fresh id per mode is what stopped each mode joining the room
	// the previous one had not finished leaving, which used to report four fighters
	// in a room that asked for two.
	const room = `verify-${modeIndex}-${Date.now().toString(36)}`;
	const separator = mode.url.includes("?") ? "&" : "?";

	for (let i = 0; i < mode.tabs; i++) {
		const p = await ctx.newPage();
		await p.goto(`${BASE + mode.url + separator}room=${room}&mute=1`);
		await p.waitForFunction(() => typeof window.__gameState === "function", {
			timeout: 20000,
		});
		// A human-controlled client will not connect until it has a name. Answered
		// through the same event the modal fires, so the smoke test walks the path a
		// player walks; an AI client has already named itself and ignores this.
		await p.evaluate((n) => window.__setPlayerName?.(n), `Tester${i + 1}`);
		pages.push(p);
	}

	const first = pages[0];
	if (!first) throw new Error("mode created no pages");

	// Let a match develop.
	const hps = new Set();
	const remotes = new Set();
	let sawBullet = false;
	for (let i = 0; i < 8; i++) {
		await first.waitForTimeout(1000);
		const s = await first.evaluate(() => window.__gameState!());
		hps.add(`${s.playerHP}v${s.enemyHP}`);
		if (s.remote)
			remotes.add(`${Math.round(s.remote.x)},${Math.round(s.remote.y)}`);
		if (s.bulletCount > 0) sawBullet = true;
	}

	const s = await first.evaluate(() => window.__gameState!());
	// The ruleset the room actually plays, not the one the URL asked for. A mode
	// smoke test that cannot tell 5CP from a deathmatch is not testing the mode.
	const match = await first.evaluate(() => window.__matchState?.() ?? null);
	const modeOk = mode.mode ? match?.mode === mode.mode : true;
	const controlOk =
		mode.mode === "5cp" ? Boolean(match?.teams?.control?.points.length) : true;
	// A training room is only seated when the agent API exists *and* the server
	// has described the room back to it. Either alone passes with an empty room.
	const training = mode.training
		? await first.evaluate(
				() => !!window.__training && window.__training.state().connected,
			)
		: false;
	const fighting = hps.size > 1;
	// Exact, not "at least".
	//
	// A room asked for sixteen and seated three is a matchmaking failure every
	// other check here passes right through — and now that bots are opt-in, a room
	// that seated a bot *nobody asked for* is the failure worth catching, which
	// only an exact count can see.
	const roomFull = mode.fighters ? s.fighterCount === mode.fighters : true;
	// Two idle humans legitimately stand still, so presence is the signal there;
	// a server bot should actually move.
	const opponentPresent = remotes.size >= 1;
	const opponentMoved = remotes.size > 1;
	// An empty room legitimately has nobody in it, so "no opponent" is the pass
	// condition rather than the failure — and the exact fighter count above is what
	// proves the room really is empty rather than merely quiet.
	const fought = mode.training
		? training && opponentPresent
		: mode.needsFight
			? fighting
			: mode.solo
				? opponentMoved
				: opponentPresent;
	const ok =
		modeOk && controlOk && roomFull && (mode.alone ? !opponentPresent : fought);
	console.log(
		`${ok ? "OK  " : "FAIL"} ${mode.label.padEnd(28)} online=${s.onlineMode} solo=${s.soloMatch} ai=${s.onlineAIMode} training=${s.trainingMode}${mode.training ? `/${training ? "seated" : "EMPTY"}` : ""} fighters=${s.fighterCount} opponent=${opponentMoved ? "moving" : opponentPresent ? "present" : "MISSING"} bullets=${sawBullet} hp=${[...hps].join(" -> ")}${mode.mode ? ` mode=${match?.mode ?? "?"}${mode.mode === "5cp" ? ` control=${controlOk ? "yes" : "NO"}` : ""}` : ""}`,
	);
	await ctx.close();
	// Let the server notice the disconnects before the next mode connects.
	//
	// Each mode has its own room id now, so this is belt and braces rather than the
	// load-bearing fix it once was — a closed browser context does not tear its
	// WebRTC channel down instantly, and a room is only reaped once the server has
	// noticed its last human leave.
	await new Promise((done) => setTimeout(done, 4000));
}

await browser.close();
