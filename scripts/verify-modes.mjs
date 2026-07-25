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
	{ label: "PvP (two tabs)", url: "/?online=true", tabs: 2, needsFight: false },
	{
		label: "AI vs AI online (two tabs)",
		url: "/?online=true&ai=true",
		tabs: 2,
		needsFight: true,
	},
	{
		label: "offline escape hatch",
		url: "/?offline=true&ai=true",
		tabs: 1,
		needsFight: true,
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
	const fighting = hps.size > 1;
	// Two idle humans legitimately stand still, so presence is the signal there;
	// a server bot should actually move.
	const opponentPresent = remotes.size >= 1;
	const opponentMoved = remotes.size > 1;
	const ok = mode.needsFight
		? fighting
		: mode.solo
			? opponentMoved
			: opponentPresent;
	console.log(
		`${ok ? "OK  " : "FAIL"} ${mode.label.padEnd(28)} online=${s.onlineMode} solo=${s.soloMatch} ai=${s.onlineAIMode} opponent=${opponentMoved ? "moving" : opponentPresent ? "present" : "MISSING"} bullets=${sawBullet} hp=${[...hps].join(" -> ")}`,
	);
	await ctx.close();
}

await browser.close();
