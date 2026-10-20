/**
 * The platform-art probe: does the map format draw real surfaces, and does the
 * Art/Flat switch happen without resetting the fight?
 *
 *     tsx scripts/tiles-probe.ts
 *
 * A screenshot cannot tell a painted tilemap from a stale flat sprite, and it
 * cannot tell a live switch from a page reload. `__tilemapDebug` reports the
 * style, the map's object counts and whether the atlas actually loaded; the
 * probe also records the local fighter's position and the skybox's variant
 * across the switch.
 *
 * The Waterfront art and the plain `?sky=off` background are deliberately
 * independent: this run boots with the sky off and the platforms painted, then
 * proves the platform switch leaves the sky off.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.GOLPE_URL ?? "http://localhost:8084";
const SHOTS = ".playwright-mcp/tiles";

interface TileDebug {
	style: string;
	artReady: boolean;
	platforms: number;
	props: number;
	sprites: number;
	tileset: {
		loaded: boolean;
		name: string;
		tiles: number;
		props: number;
		tileWidth: number;
		tileHeight: number;
	};
}

interface GameState {
	playerPhys: { x: number; y: number };
}

interface SkyDebug {
	variant: string;
	loaded: boolean;
}

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(58)} ${detail}`);
	if (!ok) failed = true;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
	viewport: { width: 1200, height: 900 },
	deviceScaleFactor: 1,
});
await mkdir(SHOTS, { recursive: true });

const errors: string[] = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
	if (m.type() === "error") errors.push(m.text());
});

const room = `tiles-${Date.now().toString(36)}`;
await page.goto(
	`${BASE}/?online=true&screen=1&mute=1&tiles=art&sky=off&room=${room}`,
);
await page.waitForFunction(
	() => window.__tilemapDebug !== undefined,
	undefined,
	{
		timeout: 20_000,
	},
);
await page.evaluate(() => window.__setPlayerName?.("Tiles Probe"));
await page
	.waitForFunction(
		() => window.__matchState?.().connected === true,
		undefined,
		{
			timeout: 20_000,
		},
	)
	.catch(() => {});
await page.waitForTimeout(900);

const art = (await page.evaluate(() =>
	window.__tilemapDebug?.(),
)) as TileDebug | null;
if (!art) {
	check(false, "tilemap debug hook exists");
	await browser.close();
	process.exit(1);
}

check(
	art.style === "art",
	"URL chooses the Waterfront platform art",
	art.style,
);
check(art.artReady, "atlas and props loaded");
check(art.tileset.loaded, "tileset manifest reached the renderer");
check(
	art.tileset.tileWidth === 8 && art.tileset.tileHeight === 8,
	"tiles are the 8px map cell",
	`${art.tileset.tileWidth}x${art.tileset.tileHeight}`,
);
check(
	art.tileset.tiles >= 13,
	"tileset has the 9-slice and variants",
	`tiles=${art.tileset.tiles}`,
);
check(
	art.platforms === 9,
	"the map describes every arena platform",
	`platforms=${art.platforms}`,
);
check(art.props > 0, "vines are placed on the map", `props=${art.props}`);
check(
	art.sprites > art.platforms,
	"the painted layer is more than one sprite per platform",
	`sprites=${art.sprites}`,
);

const skyOff = (await page.evaluate(() =>
	window.__skyboxDebug?.(),
)) as SkyDebug | null;
check(
	skyOff?.variant === "off" && skyOff.loaded === false,
	"skybox Off stays the plain gradient",
	`variant=${skyOff?.variant} loaded=${skyOff?.loaded}`,
);

const before = (await page.evaluate(() =>
	window.__gameState?.(),
)) as GameState | null;
await page.screenshot({ path: `${SHOTS}/art-sky-off.png` });

// The Graphics menu, the same path a player takes. Esc takes the keyboard,
// not the simulation; the platform switch redraws only the arena.
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Graphics", exact: true }).click();
await page.getByRole("button", { name: "Flat — competitive" }).click();
await page.waitForTimeout(250);
const flat = (await page.evaluate(() =>
	window.__tilemapDebug?.(),
)) as TileDebug | null;
check(
	flat?.style === "flat",
	"Graphics switches the platforms to Flat",
	flat?.style,
);
check(flat?.props === 0, "Flat draws no painted props", `props=${flat?.props}`);
check(
	flat?.sprites === flat?.platforms,
	"Flat is exactly one block per platform",
	`sprites=${flat?.sprites} platforms=${flat?.platforms}`,
);
const skyStillOff = (await page.evaluate(() =>
	window.__skyboxDebug?.(),
)) as SkyDebug | null;
check(
	skyStillOff?.variant === "off",
	"switching platforms does not turn the skybox back on",
	skyStillOff?.variant,
);
await page.screenshot({ path: `${SHOTS}/flat-sky-off.png` });

await page.getByRole("button", { name: "Waterfront art" }).click();
await page.waitForTimeout(250);
const back = (await page.evaluate(() =>
	window.__tilemapDebug?.(),
)) as TileDebug | null;
check(back?.style === "art", "switching back to Art is live", back?.style);
check(
	back?.props !== undefined && back.props > 0,
	"Art restores the props",
	`props=${back?.props}`,
);

const after = (await page.evaluate(() =>
	window.__gameState?.(),
)) as GameState | null;
const moved =
	before && after
		? Math.hypot(
				after.playerPhys.x - before.playerPhys.x,
				after.playerPhys.y - before.playerPhys.y,
			)
		: Number.POSITIVE_INFINITY;
check(
	moved < 2,
	"the fighter did not teleport across the live switch",
	`moved=${Number.isFinite(moved) ? moved.toFixed(2) : "n/a"}px`,
);
check(
	await page.evaluate(() => window.__matchState?.().phase === "live"),
	"the match is still running after both switches",
);

// A link must be able to pin the competitive skin without opening a menu.
const urlPage = await ctx.newPage();
const urlRoom = `tiles-url-${Date.now().toString(36)}`;
await urlPage.goto(
	`${BASE}/?online=true&screen=1&mute=1&tiles=flat&sky=off&room=${urlRoom}`,
);
await urlPage.waitForFunction(
	() => window.__tilemapDebug !== undefined,
	undefined,
	{ timeout: 20_000 },
);
await urlPage.waitForTimeout(400);
const byUrl = (await urlPage.evaluate(() =>
	window.__tilemapDebug?.(),
)) as TileDebug | null;
check(byUrl?.style === "flat", "?tiles=flat pins the competitive skin", byUrl?.style);
await urlPage.close();

check(errors.length === 0, "no page or console errors", errors[0] ?? "");
await browser.close();

if (failed) process.exit(1);
console.log(`\nScreenshots: ${SHOTS}`);
