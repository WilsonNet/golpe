/**
 * Drive the root menu the way a player would, and prove it cannot lie.
 *
 * The menu's whole contract is that it is a URL generator: a click must produce
 * the launch request the address bar shows, and the game must boot from that
 * URL. So this probe asserts on the *URL after a commit* and on the game that
 * boots from it — not on styling. It also proves the agentic path is intact: a
 * URL that already carries a launch key must never show the menu.
 *
 * Run with the dev servers up (npm run dev:herdr).
 */
import { chromium } from "playwright";

const BASE = process.env.VENTO_URL ?? "http://localhost:8080";

/** A launch key the menu must never add on its own. */
function launchKeys(url) {
	const params = new URLSearchParams(new URL(url).search);
	return [
		"room",
		"ai",
		"offline",
		"training",
		"training-room",
		"bots",
		"fill",
		"scoreLimit",
		"timeLimit",
		"ultCharge",
		"mode",
		"freezeTime",
		"screen",
	].filter((k) => params.get(k) !== null);
}

let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(38)} ${detail}`);
	if (!ok) failures++;
}

const browser = await chromium.launch();

// --- 1. the bare URL is the menu --------------------------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(BASE);
	await page.waitForSelector(".vd-menu-page", { timeout: 10000 });
	check("bare URL shows the menu", true);
	check("menu has no launch keys", launchKeys(page.url()).length === 0);
	// The server status line is the feedback the menu exists for — a game that
	// loads with no server behind it must say so before a match is started.
	await page.waitForSelector(".vd-server", { timeout: 5000 });
	await page.waitForFunction(
		() =>
			document
				.querySelector(".vd-server")
				?.textContent?.includes("Game server online"),
		{ timeout: 8000 },
	);
	check("server status says online (health endpoint)", true);
	await ctx.close();
}

// --- 2. quick match: one click to a fight, name remembered ------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(BASE);
	await page.waitForSelector(".vd-menu-page", { timeout: 10000 });

	// The menu's name field writes the same store the in-game prompt reads, so
	// a player named here must never be asked again.
	await page.fill("#vd-name", "ProbeA");
	await page.click(".vd-play-item-primary");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	check("quick match boots the game", true);
	check("quick match commits bots=1", launchKeys(page.url()).includes("bots"));
	const myName = await page.evaluate(() => window.__matchState()?.myName);
	check("menu name is the match name", myName === "ProbeA", `myName=${myName}`);
	// A player named by the menu never sees the name prompt's share box, so the
	// fight window must say the link is in the address bar once.
	await page.waitForFunction(
		() => document.body.textContent.includes("address bar"),
		{ timeout: 10000 },
	);
	check("room link is announced once", true);
	await ctx.close();
}

// --- 3. practice is one click, and boots training --------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(BASE);
	await page.waitForSelector(".vd-menu-page", { timeout: 10000 });
	const items = await page.$$(".vd-play-item");
	for (const el of items) {
		if ((await el.textContent())?.includes("Practice")) {
			await el.click();
			break;
		}
	}
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const s = await page.evaluate(() => window.__gameState());
	check("practice boots training", s.trainingMode === true);
	check(
		"practice commits training=true",
		new URLSearchParams(new URL(page.url()).search).get("training") === "true",
	);
	await ctx.close();
}

// --- 4. join: a bare room id, typed by hand ---------------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(BASE);
	await page.waitForSelector(".vd-menu-page", { timeout: 10000 });
	const room = `menu-probe-${Date.now().toString(36)}`;
	const items = await page.$$(".vd-play-item");
	for (const el of items) {
		if ((await el.textContent())?.includes("Join a match")) {
			await el.click();
			break;
		}
	}
	await page.fill(".vd-card input[placeholder='room id or link']", room);
	await page.click(".vd-card button[type='submit']");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const got = new URL(page.url()).searchParams.get("room");
	check("join boots into the room", got === room, `room=${got}`);
	await ctx.close();
}

// --- 5. a launch key in the URL never shows the menu ------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?bots=1`);
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const menuVisible = await page.evaluate(
		() => document.querySelector(".vd-menu-page") !== null,
	);
	check("?bots=1 boots without the menu", !menuVisible);
	await ctx.close();
}

// --- 6. the host form: mode and constraints land in the URL -----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(BASE);
	await page.waitForSelector(".vd-menu-page", { timeout: 10000 });
	const items = await page.$$(".vd-play-item");
	for (const el of items) {
		if ((await el.textContent())?.includes("Host a match")) {
			await el.click();
			break;
		}
	}
	await page.click(".vd-chip:has-text('Team deathmatch')");
	// A team room's three-screen floor is a constraint the form must show, not a
	// surprise the server delivers.
	const summary = await page.textContent(".vd-summary");
	check(
		"team mode floors the arena at 3 screens",
		(summary ?? "").includes("3 screens"),
		`summary="${summary?.trim()}"`,
	);
	const widthInput = await page.$(".vd-field input[type='number']");
	const width = widthInput
		? Number(await widthInput.getAttribute("value"))
		: null;
	check("arena width input shows the floor", width === 3, `width=${width}`);
	await page.click(".vd-card button:has-text('Create match')");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const params = new URLSearchParams(new URL(page.url()).search);
	const s = await page.evaluate(() => window.__gameState());
	check("host form commits mode=tdm", params.get("mode") === "tdm");
	check(
		"server seated a team arena",
		s.worldScreens >= 3 && s.fighterCount === 1,
		`screens=${s.worldScreens} fighters=${s.fighterCount}`,
	);
	await ctx.close();
}

await browser.close();
console.log(
	failures === 0 ? "MENU PROBE PASS" : `MENU PROBE FAIL (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
