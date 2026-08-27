/**
 * Drive the root menu the way a player would, and prove it cannot lie.
 *
 * The menu's whole contract is that it is a URL generator: a click must produce
 * the launch request the address bar shows, and the game must boot from that
 * URL. So this probe asserts on the *URL after a commit* and on the game that
 * boots from it — not on styling. It also proves the agentic path is intact: a
 * URL that already carries a launch key must never show the menu.
 *
 * Run with the dev servers up (pnpm run dev:herdr).
 */
import { chromium } from "playwright";

const BASE = process.env.GOLPE_URL ?? "http://localhost:8084";

/** The game server's room list — the same address the menu's status line checks. */
const ROOMS_URL = `http://${new URL(BASE).hostname}:9208/rooms`;

/** A launch key the menu must never add on its own. */
function launchKeys(url: string): string[] {
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
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(38)} ${detail}`);
	if (!ok) failures++;
}

const browser = await chromium.launch();

// --- 1. the bare URL is the menu --------------------------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });
	check("bare URL shows the menu", true);
	check("menu has no launch keys", launchKeys(page.url()).length === 0);
	// The server status line is the feedback the menu exists for — a game that
	// loads with no server behind it must say so before a match is started.
	await page.waitForSelector(".gd-server", { timeout: 5000 });
	await page.waitForFunction(
		() =>
			document
				.querySelector(".gd-server")
				?.textContent?.includes("Game server online"),
		{ timeout: 8000 },
	);
	check("server status says online (health endpoint)", true);
	await ctx.close();
}

// --- 2. quick match: an open room is joined, otherwise a duel is made ----
{
	// A room for quick match to find: a human client (no `?ai=true`) named
	// through the same localStorage the menu writes, so the in-game prompt never
	// blocks the seat. Kept open until the discovery below has used it.
	const hostCtx = await browser.newContext();
	const hostPage = await hostCtx.newPage();
	await hostPage.addInitScript(() => {
		localStorage.setItem("golpe.playerName", "ProbeHost");
	});
	const openRoom = `qm-open-${Date.now().toString(36)}`;
	await hostPage.goto(`${BASE}/?room=${openRoom}&mute=1`);
	await hostPage.waitForFunction(
		() => typeof window.__gameState === "function",
		{
			timeout: 20000,
		},
	);

	// Wait until the game server actually lists the room — the seat happens a
	// beat after the client boots, and quick match must not race it.
	let discoverable = false;
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(ROOMS_URL);
			const data = (await res.json()) as {
				rooms?: { id?: string }[] | null;
			};
			if (data.rooms?.some((r) => r.id === openRoom)) {
				discoverable = true;
				break;
			}
		} catch {
			/* server not up yet — keep polling */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	check("open room is discoverable via /rooms", discoverable);

	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });
	await page.click(".gd-play-item-primary");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const joinedRoom = new URL(page.url()).searchParams.get("room");
	check(
		"quick match joins the open room",
		joinedRoom === openRoom,
		`room=${joinedRoom}`,
	);

	// Closing the host's context empties the room, and an empty room is reaped.
	await ctx.close();
	await hostCtx.close();
}

// --- 3. quick match with no room open creates a duel ------------
{
	// The fallback: when `/rooms` has nothing to offer, quick match must still
	// boot — by creating a `?bots=1` duel. On a shared dev server a step-2 room
	// (or another probe's) may still be open, so the assertion accepts either a
	// fresh duel or a join; both are valid answers and both boot the game.
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });

	// The menu's name field writes the same store the in-game prompt reads, so
	// a player named here must never be asked again.
	await page.fill("#gd-name", "ProbeA");
	await page.click(".gd-play-item-primary");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	check("quick match boots the game", true);
	const q = new URLSearchParams(new URL(page.url()).search);
	const joinedOpen = q.get("room") !== null;
	const createdDuel = q.get("bots") === "1";
	check(
		"quick match joins or creates a duel",
		joinedOpen || createdDuel,
		`room=${q.get("room")} bots=${q.get("bots")}`,
	);
	const myName = await page.evaluate(() => window.__matchState?.()?.myName);
	check("menu name is the match name", myName === "ProbeA", `myName=${myName}`);
	// A player named by the menu never sees the name prompt's share box, so the
	// fight window must say the link is in the address bar once.
	await page.waitForFunction(
		() => document.body.textContent?.includes("address bar") ?? false,
		{ timeout: 10000 },
	);
	check("room link is announced once", true);
	await ctx.close();
}

// --- 4. a probe room (created by ?ai=true) is never offered to quick match ---
{
	const probeCtx = await browser.newContext();
	const probePage = await probeCtx.newPage();
	const probeRoom = `qm-probe-${Date.now().toString(36)}`;
	// `?ai=true` names itself and never blocks, exactly like every probe.
	await probePage.goto(`${BASE}/?ai=true&room=${probeRoom}&mute=1`);
	await probePage.waitForFunction(
		() => typeof window.__gameState === "function",
		{
			timeout: 20000,
		},
	);

	// The room is created the moment the probe is seated; it must stay out of
	// `/rooms` for as long as it lives. A few polls prove it is not merely not
	// *yet* registered.
	let offered = false;
	const deadline = Date.now() + 4000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(ROOMS_URL);
			const data = (await res.json()) as {
				rooms?: { id?: string }[] | null;
			};
			if (data.rooms?.some((r) => r.id === probeRoom)) {
				offered = true;
				break;
			}
		} catch {
			/* server not up yet — keep polling */
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	check("ai room is never offered by /rooms", !offered);

	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });
	await page.click(".gd-play-item-primary");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const joined = new URL(page.url()).searchParams.get("room");
	check(
		"quick match does not join the ai room",
		joined !== probeRoom,
		`room=${joined}`,
	);

	await ctx.close();
	await probeCtx.close();
}

// --- 5. practice is one click, and boots training --------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });
	const items = await page.$$(".gd-play-item");
	for (const el of items) {
		if ((await el.textContent())?.includes("Practice")) {
			await el.click();
			break;
		}
	}
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const s = await page.evaluate(() => window.__gameState!());
	check("practice boots training", s.trainingMode === true);
	check(
		"practice commits training=true",
		new URLSearchParams(new URL(page.url()).search).get("training") === "true",
	);
	await ctx.close();
}

// --- 6. join: a bare room id, typed by hand ---------------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });
	const room = `menu-probe-${Date.now().toString(36)}`;
	const items = await page.$$(".gd-play-item");
	for (const el of items) {
		if ((await el.textContent())?.includes("Join a match")) {
			await el.click();
			break;
		}
	}
	await page.fill(".gd-card input[placeholder='room id or link']", room);
	await page.click(".gd-card button[type='submit']");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const got = new URL(page.url()).searchParams.get("room");
	check("join boots into the room", got === room, `room=${got}`);
	await ctx.close();
}

// --- 7. a launch key in the URL never shows the menu ------------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?bots=1&mute=1`);
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const menuVisible = await page.evaluate(
		() => document.querySelector(".gd-menu-page") !== null,
	);
	check("?bots=1 boots without the menu", !menuVisible);
	await ctx.close();
}

// --- 8. the host form: mode and constraints land in the URL -----
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });
	const items = await page.$$(".gd-play-item");
	for (const el of items) {
		if ((await el.textContent())?.includes("Host a match")) {
			await el.click();
			break;
		}
	}
	await page.click(".gd-chip:has-text('Team deathmatch')");
	// A team room's three-screen floor is a constraint the form must show, not a
	// surprise the server delivers.
	const summary = await page.textContent(".gd-summary");
	check(
		"team mode floors the arena at 3 screens",
		(summary ?? "").includes("3 screens"),
		`summary="${summary?.trim()}"`,
	);
	const widthInput = await page.$(".gd-field input[type='number']");
	const width = widthInput
		? Number(await widthInput.getAttribute("value"))
		: null;
	check("arena width input shows the floor", width === 3, `width=${width}`);
	await page.click(".gd-card button:has-text('Create match')");
	await page.waitForFunction(() => typeof window.__gameState === "function", {
		timeout: 20000,
	});
	const params = new URLSearchParams(new URL(page.url()).search);
	const s = await page.evaluate(() => window.__gameState!());
	check("host form commits mode=tdm", params.get("mode") === "tdm");
	check(
		"server seated a team arena",
		s.worldScreens >= 3 && s.fighterCount === 1,
		`screens=${s.worldScreens} fighters=${s.fighterCount}`,
	);
	await ctx.close();
}

// --- 9. learn: how to play is grouped, move list opens for the pick ---------
{
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto(`${BASE}/?mute=1`);
	await page.waitForSelector(".gd-menu-page", { timeout: 10000 });

	// How to play: one view, three named groups, nine one-line rows.
	for (const el of await page.$$(".gd-play-item")) {
		if ((await el.textContent())?.includes("How to play")) {
			await el.click();
			break;
		}
	}
	await page.waitForSelector(".gd-how-row", { timeout: 5000 });
	const heads = (await page.$$(".gd-section-head")).length;
	const rows = (await page.$$(".gd-how-row")).length;
	check("how to play groups into sections", heads >= 3, `heads=${heads}`);
	check("how to play rows are one line each", rows === 9, `rows=${rows}`);
	await page.click(".gd-how-actions button:has-text('Back')");

	// The move list opens for the hero the picker has selected.
	for (const el of await page.$$(".gd-hero-chip")) {
		if ((await el.textContent())?.includes("Anands")) {
			await el.click();
			break;
		}
	}
	for (const el of await page.$$(".gd-play-item")) {
		if ((await el.textContent())?.includes("Move list")) {
			await el.click();
			break;
		}
	}
	await page.waitForSelector(".ml-root", { timeout: 15000 });
	const heroName = (await page.textContent(".ml-hero-name"))?.trim();
	check("move list opens in the menu", true);
	check(
		"move list shows the picked hero",
		heroName === "Anands",
		`hero=${heroName}`,
	);

	// Esc returns to the home menu, and the move list is gone.
	await page.keyboard.press("Escape");
	await page.waitForSelector(".gd-menu-page", { timeout: 5000 });
	await page.waitForFunction(() => !document.querySelector(".ml-root"), {
		timeout: 5000,
	});
	check("esc returns from the move list to the menu", true);
	await ctx.close();
}

await browser.close();
console.log(
	failures === 0 ? "MENU PROBE PASS" : `MENU PROBE FAIL (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
