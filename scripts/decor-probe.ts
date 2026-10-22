#!/usr/bin/env node
/**
 * The map maker's decorations and vertical maps, driven like a player would.
 *
 *   tsx scripts/decor-probe.ts
 *
 * What it proves, each a thing a screenshot would only suggest:
 *
 * 1. The Decor drawer lists the whole catalogue, its categories filter it,
 *    and search finds a prop by name.
 * 2. Every attach rule lands where it says: a window clicked on a platform is
 *    mounted inside that platform below the lip, a bird in the sky stays where
 *    it was put.
 * 3. A Row stroke lays many props in one gesture, and one undo removes them all.
 * 4. Prettify dresses a selected platform (windows on the face, birds on top),
 *    and "Prettify the whole map" dresses everything.
 * 5. **A vertical map plays vertically**: a three-row Sky tower is a world
 *    1800px tall in the real game, the follow camera scrolls down to the
 *    fighter, and the animated props are animated sprites in the match.
 *
 * Needs the dev servers (`pnpm run dev:herdr`). Writes screenshots to
 * `--out=<dir>` (default: the OS temp dir). Exits non-zero on any FAIL.
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Frame, type Page } from "playwright";
import catalog from "../src/game/maps/propCatalog.json" with { type: "json" };

const BASE_URL = process.env.GOLPE_URL ?? "http://localhost:8084";
const OUT =
	process.argv.find((a) => a.startsWith("--out="))?.slice(6) ??
	path.join(tmpdir(), "golpe-decor-probe");
mkdirSync(OUT, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
	results.push({ name, ok, detail });
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
	);
}

interface Obj {
	type?: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

async function layers(page: Page) {
	return page.evaluate(() => {
		const m = window.__mapmaker?.map();
		// No named inner functions: tsx wraps them in a \`__name\` helper the
		// page does not have.
		const out = {
			platforms: [] as Obj[],
			props: [] as Obj[],
			height: m?.height ?? 0,
		};
		for (const l of m?.layers ?? []) {
			const objects = ((l as unknown as { objects?: Obj[] }).objects ??
				[]) as Obj[];
			if (l.type === "platforms") out.platforms.push(...objects);
			if (l.type === "props") out.props.push(...objects);
		}
		return out;
	});
}

/** A world point → a client point on the editor canvas. */
async function toClient(page: Page, wx: number, wy: number) {
	const box = await page.getByTestId("mapmaker-canvas").boundingBox();
	const view = await page.evaluate(() => window.__mapmaker?.view());
	if (!box || !view) throw new Error("no canvas view");
	return {
		x: box.x + (wx - view.panX) * view.zoom,
		y: box.y + (wy - view.panY) * view.zoom,
	};
}

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1500, height: 950 },
});
const page = await context.newPage();
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

try {
	await page.goto(`${BASE_URL}/?mapmaker=true&mute=1`);
	await page.waitForFunction(() => window.__mapmaker !== undefined, undefined, {
		timeout: 15_000,
	});

	// A map with a tall block to mount things on: the classic arena plus a
	// 200×120 building in the open sky of screen one.
	await page.evaluate(() => {
		const m = window.__mapmaker?.map();
		if (!m) return;
		const plats = m.layers.find((l) => l.type === "platforms") as unknown as {
			objects: Obj[];
		};
		plats.objects.push({ x: 480, y: 40, w: 200, h: 96 });
		window.__mapmaker?.load(m);
	});

	// 1. The drawer.
	await page.keyboard.press("d");
	const drawer = page.getByTestId("mapmaker-decor");
	await drawer.waitFor();
	const all = await drawer
		.locator(".mm-prop-grid")
		.last()
		.locator("button")
		.count();
	check(
		"the drawer lists the whole catalogue",
		all === catalog.props.length,
		`${all} of ${catalog.props.length}`,
	);
	await page.getByTestId("decor-cat-critters").click();
	const critters = await drawer
		.locator(".mm-prop-grid")
		.last()
		.locator("button")
		.count();
	const wantCritters = catalog.props.filter(
		(p) => p.category === "critters",
	).length;
	check(
		"a category tab filters it",
		critters === wantCritters,
		`${critters} critters`,
	);
	await page.getByTestId("mapmaker-decor-search").fill("bird");
	const birds = await drawer
		.locator(".mm-prop-grid")
		.last()
		.locator("button")
		.count();
	const hasBird = await drawer.getByTestId("decor-birdFlying").count();
	check(
		"search finds props by name",
		birds > 0 && birds < 12 && hasBird > 0,
		`${birds} matches`,
	);
	await page.screenshot({ path: path.join(OUT, "decor-drawer.png") });

	// 2. Attach rules, through the pointer.
	await page.getByTestId("mapmaker-decor-search").fill("lit window");
	await page.getByTestId("mapmaker-decor-search").press("Enter");
	await page.getByTestId("mapmaker-decor-search").press("Escape");
	let before = (await layers(page)).props.length;
	let at = await toClient(page, 560, 42);
	await page.mouse.click(at.x, at.y);
	let after = await layers(page);
	const win = after.props.at(-1);
	check(
		"a window clicked on a platform mounts inside it, below the lip",
		after.props.length === before + 1 &&
			win?.type === "windowLit" &&
			win.x >= 480 &&
			win.x + 12 <= 680 &&
			win.y >= 48 &&
			win.y + 14 <= 136,
		JSON.stringify(win),
	);
	await page.getByTestId("decor-cat-sky").click();
	await page.getByTestId("decor-birdFlying").click();
	before = (await layers(page)).props.length;
	at = await toClient(page, 300, 100);
	await page.mouse.click(at.x, at.y);
	after = await layers(page);
	const bird = after.props.at(-1);
	check(
		"a bird in the air stays where it is put",
		bird?.type === "birdFlying" &&
			Math.abs(bird.x + 6 - 300) <= 1 &&
			Math.abs(bird.y + 3 - 100) <= 1,
		JSON.stringify(bird),
	);

	// 3. A Row stroke along the floor.
	await page.getByTestId("decor-cat-town").click();
	await page.getByTestId("decor-fence").click();
	await page.getByTestId("decor-brush-row").click();
	before = (await layers(page)).props.length;
	const a = await toClient(page, 40, 540);
	const b = await toClient(page, 260, 540);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps: 20 });
	await page.mouse.up();
	after = await layers(page);
	const fences = after.props.slice(before);
	check(
		"a Row stroke lays a row in one gesture, on the floor",
		fences.length >= 6 &&
			fences.every((f) => f.type === "fence" && f.y + 11 === 568),
		`${fences.length} fences`,
	);
	await page.keyboard.press("ControlOrMeta+z");
	check(
		"one undo removes the whole stroke",
		(await layers(page)).props.length === before,
	);
	await page.getByTestId("decor-brush-stamp").click();

	// 4. Prettify the building.
	await page.keyboard.press("v");
	at = await toClient(page, 580, 120);
	await page.mouse.click(at.x, at.y);
	await page.getByTestId("mapmaker-prettify").waitFor();
	before = (await layers(page)).props.length;
	await page.getByTestId("dress-windows").click();
	await page.getByTestId("dress-critters").click();
	after = await layers(page);
	const onFace = after.props.filter(
		(p) => p.x >= 480 && p.x < 680 && p.y >= 48 && p.y < 136,
	).length;
	const onTop = after.props.filter(
		(p) => p.x >= 470 && p.x < 680 && p.y < 40,
	).length;
	check(
		"Prettify puts windows on the face and birds on top",
		onFace >= 4 && onTop >= 1,
		`${onFace} on the face, ${onTop} on top`,
	);
	await page.keyboard.press("Escape");
	await page.getByTestId("mapmaker-prettify-map").click();
	const dressed = (await layers(page)).props.length;
	check(
		"Prettify the whole map dresses everything",
		dressed >= 30,
		`${dressed} props`,
	);
	await page.keyboard.press("0");
	await page.screenshot({ path: path.join(OUT, "decor-prettified.png") });

	// 5. A vertical map, played.
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("button", { name: /Sky tower/ }).click();
	await page.getByRole("button", { name: "Create" }).click();
	await page.getByTestId("mapmaker-rows").waitFor();
	const rowsText = await page.getByTestId("mapmaker-rows").innerText();
	await page.getByTestId("mapmaker-prettify-map").click();
	const tower = await layers(page);
	check(
		"Sky tower is three rows tall",
		tower.height === 225 && rowsText.startsWith("3 tall"),
		`${rowsText}, ${tower.height} cells, ${tower.props.length} props`,
	);
	await page.keyboard.press("0");
	await page.screenshot({ path: path.join(OUT, "tower-editor.png") });

	await page.getByTestId("mapmaker-test").click();
	await page.getByTestId("test-watch").check();
	await page.getByTestId("test-start").click();
	await page.getByTestId("mapmaker-playtest").waitFor({ timeout: 10_000 });
	let inner: Frame | undefined;
	for (let i = 0; i < 100 && !inner; i++) {
		inner = page.frames().find((f) => f.url().includes("map=draft"));
		if (!inner) await page.waitForTimeout(200);
	}
	if (!inner) throw new Error("the play-test frame never loaded");
	await inner.waitForFunction(
		() =>
			(window.__tilemapDebug?.()?.platforms ?? 0) > 0 &&
			window.__gameState?.() != null,
		undefined,
		{ timeout: 25_000 },
	);
	const world = await inner.evaluate(() => window.__gameState?.());
	check(
		"the game builds a world as tall as the map",
		world?.worldHeight === 1800,
		`worldHeight=${world?.worldHeight}`,
	);
	const cams: number[] = [];
	for (let i = 0; i < 16; i++) {
		await page.waitForTimeout(500);
		const s = await inner.evaluate(() => window.__gameState?.());
		if (s) cams.push(Math.round(s.cameraY));
	}
	check(
		"the follow camera scrolls vertically to the fighter",
		Math.max(...cams) > 600,
		`cameraY ${Math.min(...cams)}..${Math.max(...cams)}`,
	);
	const tiles = await inner.evaluate(() => window.__tilemapDebug?.());
	check(
		"the match draws every decoration, the animated ones animated",
		tiles?.props === tower.props.length && (tiles?.animatedProps ?? 0) > 0,
		`${tiles?.props}/${tower.props.length} drawn, ${tiles?.animatedProps} animated`,
	);
	await page.screenshot({ path: path.join(OUT, "tower-playtest.png") });
} catch (e) {
	check("probe ran to the end", false, String(e));
} finally {
	check(
		"no page errors",
		pageErrors.length === 0,
		pageErrors.slice(0, 3).join(" | "),
	);
	await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(
	`\n${failed ? "FAIL" : "PASS"}  ${results.length - failed}/${results.length}`,
);
console.log(`screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
