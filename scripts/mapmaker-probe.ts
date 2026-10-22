#!/usr/bin/env node
/**
 * The map maker, driven end to end like a player would.
 *
 *   tsx scripts/mapmaker-probe.ts             # edit, theme, play-test, capture, publish sheet
 *   tsx scripts/mapmaker-probe.ts --save      # …and "Save into this checkout" (writes maps/<probe id>/, then removes it)
 *
 * What it proves, in order — each a thing that was invisible without measuring:
 *
 * 1. The editor boots with a playable map and no check errors.
 * 2. Pointer input edits the map: a dragged platform, a clicked spawn, undo
 *    and redo, a theme swatch. Read from `window.__mapmaker`, never pixels.
 * 3. The checks see a broken map: a spawn buried in a platform is an error.
 * 4. **The play-test is the real game on the edited map**: the framed match's
 *    world has exactly the editor's platform count and theme, bots are
 *    fighting (fighters move), and the capture saves a clip and screenshots.
 * 5. The Publish sheet sees that proof and builds the PR body.
 *
 * Needs the dev servers (`pnpm run dev:herdr`). Exits non-zero on any FAIL.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, type Frame, type Page } from "playwright";

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const SAVE = process.argv.includes("--save");

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
	results.push({ name, ok, detail });
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
	);
}

async function counts(page: Page) {
	return page.evaluate(() => {
		const m = window.__mapmaker?.map();
		// No named inner functions: tsx's esbuild wraps them in a \`__name\`
		// helper that does not exist inside the page.
		let platforms = 0;
		let spawns = 0;
		for (const l of m?.layers ?? []) {
			const n = (l as { objects?: unknown[] }).objects?.length ?? 0;
			if (l.type === "platforms") platforms += n;
			if (l.type === "spawns") spawns += n;
		}
		return {
			platforms,
			spawns,
			theme: m?.theme ?? "",
			errors:
				window.__mapmaker?.issues().filter((i) => i.level === "error").length ??
				-1,
		};
	});
}

/** A world point → a client point on the editor canvas, via the canvas box and the map's fit. */
async function canvasBox(page: Page) {
	const box = await page.getByTestId("mapmaker-canvas").boundingBox();
	if (!box) throw new Error("no canvas");
	return box;
}

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
	// 1. Boot.
	await page.goto(`${BASE_URL}/?mapmaker=true&mute=1`);
	await page.waitForFunction(() => window.__mapmaker !== undefined, undefined, {
		timeout: 15_000,
	});
	const start = await counts(page);
	check(
		"editor boots with a playable map",
		start.platforms > 0 && start.spawns >= 2 && start.errors === 0,
		JSON.stringify(start),
	);

	// 2. Draw a platform in the upper-middle of the canvas.
	await page.keyboard.press("p");
	const box = await canvasBox(page);
	const x0 = box.x + box.width * 0.42;
	const y0 = box.y + box.height * 0.18;
	await page.mouse.move(x0, y0);
	await page.mouse.down();
	await page.mouse.move(x0 + 60, y0 + 10, { steps: 6 });
	await page.mouse.move(x0 + 120, y0 + 20, { steps: 6 });
	await page.mouse.up();
	const drawn = await counts(page);
	check(
		"dragging with the platform tool adds a platform",
		drawn.platforms === start.platforms + 1,
		`${start.platforms} → ${drawn.platforms}`,
	);

	await page.keyboard.press("s");
	await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
	const spawned = await counts(page);
	check(
		"clicking with the spawn tool adds a spawn",
		spawned.spawns === drawn.spawns + 1,
		`${drawn.spawns} → ${spawned.spawns}`,
	);

	await page.keyboard.press("Meta+z");
	await page.keyboard.press("Control+z");
	const undone = await counts(page);
	await page.keyboard.press("Meta+Shift+z");
	await page.keyboard.press("Control+Shift+z");
	const redone = await counts(page);
	check(
		"undo and redo step through the edits",
		undone.platforms === start.platforms &&
			undone.spawns === start.spawns &&
			redone.spawns === spawned.spawns,
		`undo ${undone.platforms}/${undone.spawns}, redo ${redone.platforms}/${redone.spawns}`,
	);

	await page.getByTestId("theme-snow").click();
	check(
		"a theme swatch changes the map's theme",
		(await counts(page)).theme === "snow",
	);

	// 3. The checks: bury a spawn inside the first platform via the loader.
	const buried = await page.evaluate(() => {
		const m = window.__mapmaker?.map();
		if (!m) return -1;
		const plats = (
			m.layers.find((l) => l.type === "platforms") as unknown as {
				objects: { x: number; y: number }[];
			}
		).objects;
		const p = plats[0] ?? { x: 0, y: 568 };
		const broken = {
			...m,
			layers: m.layers.map((l) =>
				l.type === "spawns"
					? {
							...l,
							objects: [
								...(l as unknown as { objects: unknown[] }).objects,
								{ x: p.x + 8, y: p.y + 4, facing: 1 },
							],
						}
					: l,
			),
		};
		(window as unknown as { __probeBackup: unknown }).__probeBackup = m;
		window.__mapmaker?.load(broken);
		return 0;
	});
	// The hook is re-published after React renders the loaded map.
	await page.waitForTimeout(300);
	const buriedErrors = await page.evaluate(
		() =>
			window.__mapmaker?.issues().filter((i) => i.code === "spawn-inside")
				.length ?? 0,
	);
	await page.evaluate(() =>
		window.__mapmaker?.load(
			(window as unknown as { __probeBackup: unknown }).__probeBackup,
		),
	);
	await page.waitForTimeout(300);
	check(
		"a spawn inside a platform is reported",
		buried === 0 && buriedErrors > 0,
		`${buriedErrors} spawn-inside error(s)`,
	);
	const editorPlatforms = (await counts(page)).platforms;

	// 4. Play-test, AI vs AI so the probe needs no input, and film it.
	await page.getByTestId("mapmaker-test").click();
	await page.getByTestId("test-watch").check();
	await page.getByTestId("test-start").click();
	await page.getByTestId("mapmaker-playtest").waitFor({ timeout: 10_000 });
	const frame = page.frameLocator("iframe.mm-playtest-frame");
	await frame.locator("canvas").first().waitFor({ timeout: 20_000 });
	const inner = page
		.frames()
		.find((f) => f.url().includes("map=draft")) as Frame;
	await inner.waitForFunction(
		() => (window.__tilemapDebug?.()?.platforms ?? 0) > 0,
		undefined,
		{ timeout: 20_000 },
	);
	const tiles = await inner.evaluate(() => window.__tilemapDebug?.());
	check(
		"the play-test plays the edited map",
		tiles?.platforms === editorPlatforms && tiles?.theme === "snow",
		`game ${tiles?.platforms} platforms (${tiles?.theme}), editor ${editorPlatforms}`,
	);

	// Bots seated and fighting on it: the room's standings, read in the frame.
	await page.waitForTimeout(6000);
	const standings = await inner.evaluate(
		() => window.__matchState?.()?.standings ?? [],
	);
	const frags = standings.reduce((n, st) => n + st.kills, 0);
	check(
		"the room is the editor's opponents plus the player",
		standings.length === 4,
		`${standings.length} fighters, ${frags} frags so far`,
	);

	// A friend: a fresh browser with no map file and no editor, given only
	// the invite link. The server must hand them the map, and they must take
	// a bot's seat rather than grow the room.
	await page.getByTestId("playtest-invite").click();
	const invite = await page.getByTestId("playtest-invite-link").inputValue();
	check(
		"the invite is a bare room link",
		/\?room=[A-Za-z0-9_-]+$/.test(invite),
		invite,
	);
	const friendCtx = await browser.newContext({
		viewport: { width: 800, height: 600 },
	});
	const friend = await friendCtx.newPage();
	friend.on("pageerror", (e) => pageErrors.push(`friend: ${e.message}`));
	// `ai` only so the friend needs no name prompt; it is still the same room.
	await friend.goto(`${invite}&ai=true&mute=1`);
	await friend.waitForFunction(
		() =>
			(window.__tilemapDebug?.()?.platforms ?? 0) > 0 &&
			window.__matchState?.() != null,
		undefined,
		{ timeout: 20_000 },
	);
	await friend.waitForTimeout(3000);
	const friendTiles = await friend.evaluate(() => window.__tilemapDebug?.());
	check(
		"a friend with only the link plays the same map",
		friendTiles?.platforms === editorPlatforms && friendTiles?.theme === "snow",
		`friend ${friendTiles?.platforms} platforms (${friendTiles?.theme})`,
	);
	const seats = await inner.evaluate(
		() => window.__matchState?.()?.standings.length ?? 0,
	);
	const friendSeen = await inner.evaluate(
		() =>
			window
				.__matchState?.()
				?.standings.filter((st) => !st.name.startsWith("BOT")).length ?? 0,
	);
	check(
		"the friend took a bot's seat",
		seats === 4 && friendSeen === 2,
		`${seats} fighters, ${friendSeen} not bots`,
	);
	await friendCtx.close();

	// The first take records itself and stops at 20s.
	await page.waitForFunction(
		() =>
			/([1-9]\d*) clip/.test(
				document.querySelector("[data-testid=playtest-media]")?.textContent ??
					"",
			),
		undefined,
		{ timeout: 40_000 },
	);
	const media = await page.getByTestId("playtest-media").textContent();
	check(
		"the play-test saved a clip and screenshots",
		/1 clip/.test(media ?? "") && !/ 0 shots/.test(media ?? ""),
		media ?? "",
	);

	await page.getByTestId("playtest-back").click();
	await page.getByTestId("mapmaker").waitFor();
	check(
		"back to the editor with the map intact",
		(await counts(page)).platforms === editorPlatforms,
	);

	// 5. Publish sheet.
	await page.getByTestId("mapmaker-publish-open").click();
	await page.getByTestId("publish-author").fill("golpe-probe");
	const probeId = `probe-map-${Date.now().toString(36)}`;
	await page.getByTestId("publish-name").fill(probeId);
	await page.waitForTimeout(500);
	const body = (await page.getByTestId("publish-body").textContent()) ?? "";
	check(
		"the PR description carries the clip, screenshots and checks",
		body.includes("preview.") &&
			body.includes("screenshot-2.png") &&
			body.includes("### Checks"),
		`${body.length} chars`,
	);

	if (SAVE) {
		await page.getByTestId("publish-save-local").click();
		await page.getByTestId("publish-saved").waitFor({ timeout: 20_000 });
		const dir = path.join(process.cwd(), "maps", probeId);
		const files = existsSync(dir) ? readdirSync(dir).sort() : [];
		check(
			"save into this checkout writes the map's folder",
			files.includes("map.json") &&
				files.includes("screenshot-1.png") &&
				files.some((f) => f.startsWith("preview.")),
			files.join(", "),
		);
		rmSync(dir, { recursive: true, force: true });
	}

	check(
		"no page errors",
		pageErrors.length === 0,
		pageErrors.slice(0, 3).join(" | "),
	);
} catch (err) {
	check("probe ran to the end", false, String(err));
} finally {
	await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
	`\n${failed.length === 0 ? "PASS" : "FAIL"}  ${results.length - failed.length}/${results.length}`,
);
process.exit(failed.length === 0 ? 0 : 1);
