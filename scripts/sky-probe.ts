/**
 * The skybox probe: does each candidate load, animate, and parallax?
 *
 *     tsx scripts/sky-probe.ts
 *
 * Two things are easy to get wrong and impossible to see in a still:
 *
 * 1. **A candidate that did not load falls back to the gradient silently.**
 *    The screenshot still shows a sky. `__skyboxDebug` says which manifest
 *    actually reached the renderer and how many layers it has.
 * 2. **A waterfall that animates but is not attached to its aqueduct** (or a
 *    layer whose factor is wrong) looks fine at camera x = 0 and peels away
 *    the moment the camera moves. The probe reads the camera and every layer's
 *    shift twice, and checks that each layer moved by exactly `camera x factor`.
 *
 * It also writes a screenshot of each candidate at one and three screens, in
 * `.playwright-mcp/skybox/`, for a human to judge the composition. The game
 * itself is the gallery: `?sky=hand` / `?sky=off`.
 */
import { mkdir } from "node:fs/promises";
import { launchBrowser } from "./browser";

const BASE = "http://localhost:8084";
const SHOTS = ".playwright-mcp/skybox";
const VARIANTS = ["hand"] as const;

interface DebugState {
	variant: string;
	loaded: boolean;
	layers: number;
	animatedFalls: number;
	frame: number;
	elapsedMs: number;
	shift: number;
	cameraX: number;
	panoramaWidth: number;
	haze: number;
	imageWidth: number;
	imageScale: number;
	order: {
		id: string;
		kind: "image" | "strip";
		factor: number;
		shift: number;
		drift: number;
	}[];
	movers: { id: string; x: number; y: number; speedX: number }[];
	ambient: { loopMs: number; groups: number; actors: number } | null;
	loops: { clockMs: number; groups: number; actors: number } | null;
	loopFrame: number;
}

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(52)} ${detail}`);
	if (!ok) failed = true;
};

const browser = await launchBrowser();
const ctx = await browser.newContext({
	viewport: { width: 1200, height: 900 },
	deviceScaleFactor: 1,
});
await mkdir(SHOTS, { recursive: true });

for (const variant of VARIANTS) {
	const errors: string[] = [];
	const page = await ctx.newPage();
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});

	const room = `sky-${variant}-${Date.now().toString(36)}`;
	// A solo room, not an AI duel: the probe drives the local fighter to the
	// right itself, so the camera movement the parallax check needs is the
	// probe's own, not a bot's mood.
	await page.goto(
		`${BASE}/?online=true&screen=3&mute=1&sky=${variant}&room=${room}`,
	);
	await page.waitForFunction(
		() => window.__skyboxDebug?.() !== undefined,
		undefined,
		{
			timeout: 20_000,
		},
	);
	await page.evaluate(() => window.__setPlayerName?.("Sky Probe"));
	await page
		.waitForFunction(
			() => window.__matchState?.().connected === true,
			undefined,
			{
				timeout: 20_000,
			},
		)
		.catch(() => {});
	await page.waitForTimeout(700);

	const first = (await page.evaluate(() =>
		window.__skyboxDebug?.(),
	)) as DebugState | null;
	if (!first) {
		check(false, `${variant}: skybox debug hook exists`);
		await page.close();
		continue;
	}

	check(
		first.loaded,
		`${variant}: manifest and layers loaded`,
		`layers=${first.layers}`,
	);
	check(
		first.variant === variant,
		`${variant}: the URL chose the candidate`,
		first.variant,
	);
	check(
		first.layers >= 5,
		`${variant}: at least five background layers`,
		`layers=${first.layers}`,
	);
	check(
		first.imageWidth === first.panoramaWidth && first.imageScale === 1,
		`${variant}: the panorama is drawn at world scale`,
		`width=${first.imageWidth} scale=${first.imageScale}`,
	);
	check(
		first.animatedFalls >= 1,
		`${variant}: at least one animated waterfall`,
		`falls=${first.animatedFalls}`,
	);
	if (variant === "hand") {
		check(
			first.movers.length >= 3,
			`${variant}: birds, zeppelin and boats are movers`,
			`movers=${first.movers.length}`,
		);
		check(
			first.ambient !== null &&
				first.ambient.groups >= 3 &&
				first.ambient.actors >= first.movers.length,
			`${variant}: one ambient plan drives every mover`,
			first.ambient
				? `loop=${first.ambient.loopMs}ms groups=${first.ambient.groups} actors=${first.ambient.actors}`
				: "no ambient plan",
		);
		check(
			first.loops !== null &&
				first.loops.groups >= 4 &&
				first.loops.actors >= 8,
			`${variant}: one loop plan drives the stationary people`,
			first.loops
				? `clock=${first.loops.clockMs}ms groups=${first.loops.groups} actors=${first.loops.actors}`
				: "no loops plan",
		);
	} else if (first.movers.length > 0) {
		console.log(
			`     ${variant}: ambient movers present (${first.movers.length})`,
		);
	}
	const factors = new Set(
		first.order.filter((l) => l.kind === "image").map((l) => l.factor),
	);
	check(
		factors.size >= 3,
		`${variant}: at least three distinct parallax factors`,
	);
	// A waterfall that follows its own factor peels away from the aqueduct it
	// falls out of. The runtime resolves `align`, so this is the manifest's
	// alignment proven end to end.
	const mid = first.order.find((l) => l.id === "mid");
	const falls = first.order.find((l) => l.id === "falls");
	check(
		!falls || !mid || falls.factor === mid.factor,
		`${variant}: the waterfalls follow the city they fall from`,
		falls && mid ? `falls=${falls.factor} mid=${mid.factor}` : "no falls",
	);

	// The waterfall clock must advance even if the fight is still. 2.3s also
	// guarantees at least one loop-frame change at the quay's 6-8 fps.
	const t0 = first.elapsedMs;
	await page.waitForTimeout(2300);
	const second = (await page.evaluate(() =>
		window.__skyboxDebug?.(),
	)) as DebugState | null;
	if (!second) {
		check(false, `${variant}: debug hook still alive after 1.6s`);
		await page.close();
		continue;
	}
	check(
		second.elapsedMs > t0,
		`${variant}: the animation clock advances`,
		`${t0} → ${second.elapsedMs}ms`,
	);
	if (first.animatedFalls > 0) {
		check(
			second.frame !== first.frame,
			`${variant}: the waterfall frame changes`,
			`frame ${first.frame} → ${second.frame}`,
		);
	}
	if (first.movers.length > 0) {
		const advanced = second.movers.some((m, i) => {
			const before = first.movers[i];
			return (
				before !== undefined &&
				(Math.abs(m.x - before.x) > 1 || Math.abs(m.y - before.y) > 0.5)
			);
		});
		check(
			advanced,
			`${variant}: the ambient movers advance`,
			`${first.movers.length} movers over ${second.elapsedMs - first.elapsedMs}ms`,
		);
	}
	if (first.loops) {
		check(
			second.loopFrame !== first.loopFrame,
			`${variant}: the stationary people loop`,
			`frame ${first.loopFrame} → ${second.loopFrame}`,
		);
	}

	// Walk the local fighter right and let the follow camera carry. A lone
	// spawn is a clean measurement: only the probe's input moves the world.
	// Jumps are held for a few frames — the simulation does its own press-edge
	// detection, so a zero-length `press` can fall entirely between ticks.
	await page.bringToFront();
	const a = (await page.evaluate(() => window.__skyboxDebug?.())) as DebugState;
	const cameraA = a.cameraX;
	await page.keyboard.down("KeyD");
	for (let i = 0; i < 16; i++) {
		await page.keyboard.down("Space");
		await page.waitForTimeout(120);
		await page.keyboard.up("Space");
		await page.waitForTimeout(500);
	}
	await page.keyboard.up("KeyD");
	await page.waitForTimeout(250);
	const b = (await page.evaluate(() => window.__skyboxDebug?.())) as DebugState;
	// Read the camera from the same snapshot as the layer shifts. The follow
	// camera is still settling after the walk; a separate `__gameState` read a
	// frame later used to report a 3px parallax "error" that was only lag.
	const cameraB = b.cameraX;
	const dc = cameraB - cameraA;
	const W = b.panoramaWidth;

	if (Math.abs(dc) > 8) {
		let worst = 0;
		let measured = 0;
		for (const layer of b.order) {
			if (layer.kind !== "image" || layer.factor === 0) continue;
			const before = a.order.find((l) => l.id === layer.id);
			if (!before) continue;
			const seen = ((((layer.shift - before.shift) % W) + W * 1.5) % W) - W / 2;
			const expected =
				((((dc * layer.factor + (layer.drift - before.drift)) % W) + W * 1.5) %
					W) -
				W / 2;
			worst = Math.max(worst, Math.abs(seen - expected));
			measured++;
		}
		check(
			measured >= 3 && worst <= 2,
			`${variant}: every layer moved by camera x factor`,
			`cam ${Math.round(dc)}px, ${measured} layers, worst error ${worst.toFixed(1)}px`,
		);
	} else {
		console.log(
			`SKIP ${variant}: the local fighter did not move the camera (${dc.toFixed(0)}px); parallax not measured`,
		);
	}

	const shot = page.locator("canvas").first();
	await shot.screenshot({ path: `${SHOTS}/${variant}-3-screens.png` });

	// A one-screen room never scrolls; it is the hero crop the contract asks
	// the art to be composed for.
	await page.goto(
		`${BASE}/?online=true&screen=1&mute=1&sky=${variant}&room=${room}-solo`,
	);
	await page.waitForFunction(
		() => window.__skyboxDebug?.()?.loaded === true,
		undefined,
		{ timeout: 20_000 },
	);
	await page.evaluate(() => window.__setPlayerName?.("Sky Probe"));
	await page.waitForTimeout(4000);
	await page
		.locator("canvas")
		.first()
		.screenshot({
			path: `${SHOTS}/${variant}-1-screen.png`,
		});

	check(
		errors.length === 0,
		`${variant}: no page errors`,
		errors.slice(0, 2).join(" | "),
	);
	await page.close();
}

await browser.close();
console.log(failed ? "SKY PROBE FAIL" : "SKY PROBE PASS");
console.log(`screenshots: ${SHOTS}/`);
process.exit(failed ? 1 : 0);
