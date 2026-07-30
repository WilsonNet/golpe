/**
 * Smoke-check every launch mode: does it connect, match, and actually fight?
 *
 * The game is online-first, so "does a match happen at all" is a netcode
 * question in every mode — including single player.
 */
import { chromium } from "playwright";

const BASE = process.env.VENTO_URL ?? "http://localhost:8080";

/**
 * `needsFight` only where a fighter is AI-driven. Playwright never presses a
 * key, so a human-controlled fighter is idle by definition — in those modes the
 * meaningful check is that an opponent exists and is moving under server
 * control, not that damage is dealt.
 */
const MODES = [
	{
		label: "solo vs server bot",
		url: "/",
		tabs: 1,
		needsFight: false,
		solo: true,
	},
	{ label: "AI vs AI (one tab)", url: "/?ai=true", tabs: 1, needsFight: true },
	{
		label: "PvP (two tabs)",
		url: "/?online=true&fill=2",
		tabs: 2,
		needsFight: false,
	},
	{
		label: "AI vs AI online (two tabs)",
		url: "/?online=true&ai=true&fill=2",
		tabs: 2,
		needsFight: true,
	},
	/**
	 * A room full of AI. The mode the deathmatch exists for, and the one where
	 * everything that only breaks at scale breaks: sixteen fighters, sixteen
	 * predicted bodies, a quadratic hitbox pass and a snapshot big enough to care
	 * about. `scripts/deathmatch-probe.mjs` measures it properly; this only asks
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

for (const mode of MODES) {
	const ctx = await browser.newContext();
	const pages = [];
	for (let i = 0; i < mode.tabs; i++) {
		const p = await ctx.newPage();
		await p.goto(BASE + mode.url);
		await p.waitForFunction(() => typeof window.__gameState === "function", {
			timeout: 20000,
		});
		// A human-controlled client will not connect until it has a name. Answered
		// through the same event the modal fires, so the smoke test walks the path a
		// player walks; an AI client has already named itself and ignores this.
		await p.evaluate((n) => window.__setPlayerName?.(n), `Tester${i + 1}`);
		pages.push(p);
	}

	// Let a match develop.
	const hps = new Set();
	const remotes = new Set();
	let sawBullet = false;
	for (let i = 0; i < 8; i++) {
		await pages[0].waitForTimeout(1000);
		const s = await pages[0].evaluate(() => window.__gameState());
		hps.add(`${s.playerHP}v${s.enemyHP}`);
		if (s.remote)
			remotes.add(`${Math.round(s.remote.x)},${Math.round(s.remote.y)}`);
		if (s.bulletCount > 0) sawBullet = true;
	}

	const s = await pages[0].evaluate(() => window.__gameState());
	// A training room is only seated when the agent API exists *and* the server
	// has described the room back to it. Either alone passes with an empty room.
	const training = mode.training
		? await pages[0].evaluate(
				() => !!window.__training && window.__training.state().connected,
			)
		: false;
	const fighting = hps.size > 1;
	// A room that was asked for sixteen fighters and seated three is a matchmaking
	// failure that every other check here would pass right through.
	const roomFull = mode.fighters ? s.fighterCount >= mode.fighters : true;
	// Two idle humans legitimately stand still, so presence is the signal there;
	// a server bot should actually move.
	const opponentPresent = remotes.size >= 1;
	const opponentMoved = remotes.size > 1;
	const ok =
		roomFull &&
		(mode.training
			? training && opponentPresent
			: mode.needsFight
				? fighting
				: mode.solo
					? opponentMoved
					: opponentPresent);
	console.log(
		`${ok ? "OK  " : "FAIL"} ${mode.label.padEnd(28)} online=${s.onlineMode} solo=${s.soloMatch} ai=${s.onlineAIMode} training=${s.trainingMode}${mode.training ? `/${training ? "seated" : "EMPTY"}` : ""} fighters=${s.fighterCount} opponent=${opponentMoved ? "moving" : opponentPresent ? "present" : "MISSING"} bullets=${sawBullet} hp=${[...hps].join(" -> ")}`,
	);
	await ctx.close();
	// Let the server notice the disconnects before the next mode connects.
	//
	// Public rooms are shared, which is the whole point of them — so tabs opened
	// immediately after a context closes join the room the previous mode was still
	// sitting in, and the next line of output reports four fighters in a room that
	// asked for two. The room was right; the test was too fast.
	// Four seconds, not one: a closed browser context does not tear its WebRTC
	// channel down instantly, and until the server notices, the *public* room is
	// still occupied — so the next mode's tabs join it and the line above reports
	// four fighters in a room that asked for two. The room is behaving correctly;
	// only the reading is wrong.
	await new Promise((done) => setTimeout(done, 4000));
}

await browser.close();
