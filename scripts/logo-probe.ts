/**
 * The logo probe: is the badge readable where it is actually drawn?
 *
 *     tsx scripts/logo-probe.ts
 *
 * A wordmark is not readable because it looks nice at 8x. It is readable when
 * the lettering clears the plate it sits on (WCAG AAA for large text), when
 * every letter survives as its own shape, when the thinnest stem is still a
 * stem at the size the menu draws, and when the frame gives the badge an edge
 * against the page behind it. So that is what this measures, on the exported
 * PNG and again on the live menu's rendered pixels:
 *
 * - **Contrast.** The plate's colour against the most common non-plate colour
 *   inside the word box — the worst band of a gradient letter — must clear
 *   7:1, the AAA floor for large text.
 * - **Separation.** The glyph boxes are the generator's own connected
 *   components (`art/logo/badge.json`): five of them, `golpe` in order, never
 *   closer than two pixels. A letter that merged with its neighbour would have
 *   changed that file, and generation refuses to write it in the first place.
 * - **Stroke.** The `l` — the face's thinnest letter — keeps a run of at least
 *   three grid pixels (six CSS pixels at the menu's 2x).
 * - **Size.** The menu's own box is measured: 352 CSS wide, and the `o`'s
 *   x-height therefore 30 CSS pixels.
 * - **The page's edge.** The frame's brightest band must clear 3:1 against
 *   every background the variant ships on, sampled from the real page for the
 *   menu and from the named page colours for the README themes.
 * - **Crispness.** The menu loads the 704px sheet into 352 CSS pixels at DPR 1
 *   and must draw it with `image-rendering: pixelated`: every rendered pixel
 *   is then an exact source colour, bar the one-pixel hairline an element
 *   screenshot can take from the page around it. A smooth resample shows up as
 *   colours that are not in the sheet at all.
 *
 * Screenshots land in `.playwright-mcp/logo/` so a human can look at what the
 * numbers are describing.
 */
import { mkdir, readFile } from "node:fs/promises";
import { launchBrowser } from "./browser";

const BASE = process.env.GOLPE_URL ?? "http://localhost:8084";
const SHOTS = ".playwright-mcp/logo";
const MANIFEST = "art/logo/badge.json";

interface Glyph {
	letter: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

interface Variant {
	file: string;
	plate: string;
	backgrounds: string[];
}

interface Manifest {
	grid: { w: number; h: number; scale: number; frame: number };
	word: { x: number; y: number; w: number; h: number };
	glyphs: Glyph[];
	display: { width: number };
	variants: Record<string, Variant>;
}

type Rgb = [number, number, number];

interface Sheet {
	width: number;
	height: number;
	contrast: number;
	plate: Rgb;
	letter: Rgb;
	frame: Record<string, { rgb: Rgb; ratio: number }>;
	glyphs: { letter: string; ink: number }[];
	stroke: number;
	purity?: number;
}

const manifest: Manifest = JSON.parse(await readFile(MANIFEST, "utf8"));

let failed = false;
const check = (ok: boolean, label: string, detail = "") => {
	console.log(`${ok ? "OK  " : "FAIL"} ${label.padEnd(52)} ${detail}`);
	if (!ok) failed = true;
};

/**
 * Run the page-side measurement (`scripts/logo-measure.js`, injected as a
 * script because tsx rewrites named closures on the way into `page.evaluate`).
 */
async function measure(
	page: import("playwright").Page,
	args: {
		url: string;
		manifest: Manifest;
		scale: number;
		plate: string;
		backgrounds: string[];
		purityFrom?: string;
	},
): Promise<Sheet> {
	// The args go in the expression: Playwright only calls a *function value*,
	// and a string expression that evaluates to one is returned unserialised.
	const sheet = await page.evaluate(
		`globalThis.logoMeasure(${JSON.stringify(args)})`,
	);
	return sheet as Sheet;
}

const hex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

await mkdir(SHOTS, { recursive: true });
const browser = await launchBrowser();
const ctx = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	deviceScaleFactor: 1,
});
await ctx.addInitScript(() => {
	window.localStorage.setItem("golpe.tutorialPromptDismissed", "1");
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/?mute=1`);
await page.waitForSelector(".gd-logo");
await page.addScriptTag({ path: "scripts/logo-measure.js" });
await page.waitForTimeout(400);

// --- the exported sheets, at their own 4x.
for (const [name, variant] of Object.entries(manifest.variants)) {
	const sheet = await measure(page, {
		url: `/assets/logo${name === "ink" ? "" : `-${name}`}.png`,
		manifest,
		scale: manifest.grid.scale,
		plate: variant.plate,
		backgrounds: variant.backgrounds,
	});
	const xHeight = manifest.glyphs.find((g) => g.letter === "o")?.h ?? 0;
	console.log(`\n--- ${name}: ${hex(sheet.plate)} plate, ${hex(sheet.letter)} lettering`);
	check(
		sheet.contrast >= 7,
		`${name}: lettering clears the plate`,
		`${sheet.contrast.toFixed(1)}:1 (AAA large text is 7:1)`,
	);
	check(
		sheet.glyphs.every((g) => g.ink > 0.12),
		`${name}: every one of the five letters is drawn`,
		sheet.glyphs.map((g) => `${g.letter} ${(g.ink * 100).toFixed(0)}%`).join(" "),
	);
	const tight = manifest.glyphs
		.slice(0, -1)
		.map((g, i) => (manifest.glyphs[i + 1]?.x ?? g.x) - (g.x + g.w));
	check(
		manifest.glyphs.length === 5 &&
			manifest.glyphs.map((g) => g.letter).join("") === "golpe" &&
			tight.every((gap) => gap >= 2),
		`${name}: five letters, none touching`,
		`${manifest.glyphs.map((g) => g.letter).join("")} · gaps ${tight.join(" ")}px`,
	);
	check(
		sheet.stroke >= 3,
		`${name}: the thinnest stem (the l)`,
		`${sheet.stroke}px of ${manifest.grid.scale}`,
	);
	check(xHeight >= 15, `${name}: x-height`, `${xHeight} grid px`);
	for (const background of variant.backgrounds) {
		const band = sheet.frame[background];
		if (!band) continue;
		check(
			band.ratio >= 3,
			`${name}: frame edges the badge off ${background}`,
			`${hex(band.rgb)} at ${band.ratio.toFixed(1)}:1`,
		);
	}
}

// --- the live menu: the size it is really drawn at, and the pixels it gets.
const logo = page.locator(".gd-logo");
const logoBox = await logo.boundingBox();
const shot = await logo.screenshot({ path: `${SHOTS}/menu-logo.png` });
await page.screenshot({ path: `${SHOTS}/menu.png` });
if (!logoBox) throw new Error("the menu drew no logo");

const pad = 6;
const cardShot = await page.screenshot({
	clip: {
		x: Math.max(0, logoBox.x - pad),
		y: Math.max(0, logoBox.y - pad),
		width: logoBox.width + pad * 2,
		height: logoBox.height + pad * 2,
	},
	path: `${SHOTS}/menu-logo-on-card.png`,
});

// The card's own colour, one pixel in from the clip's corner.
const cardColour = await page.evaluate(
	async ({ data }) => {
		const bitmap = await createImageBitmap(
			await (await fetch(`data:image/png;base64,${data}`)).blob(),
		);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		ctx.drawImage(bitmap, 0, 0);
		const [r = 0, g = 0, b = 0] = ctx.getImageData(1, 1, 1, 1).data;
		return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
	},
	{ data: cardShot.toString("base64") },
);

const menuSheet = manifest.variants.ink;
if (!menuSheet) throw new Error("the manifest has no ink variant to compare");
const rendered = await measure(page, {
	url: `data:image/png;base64,${shot.toString("base64")}`,
	manifest,
	scale: logoBox.width / manifest.grid.w,
	plate: menuSheet.plate,
	backgrounds: [cardColour],
	purityFrom: menuSheet.file.replace("public/", "/"),
});

const oHeight = manifest.glyphs.find((g) => g.letter === "o")?.h ?? 0;
const xHeightCss = (oHeight * logoBox.width) / manifest.grid.w;
console.log(`\n--- the menu, rendered at ${logoBox.width.toFixed(0)} CSS px on ${cardColour}`);
check(
	logoBox.width >= manifest.display.width - 1,
	"the menu draws the badge at its 352px size",
	`${logoBox.width.toFixed(1)} x ${logoBox.height.toFixed(1)}`,
);
check(xHeightCss >= 28, "the o's x-height on screen", `${xHeightCss.toFixed(1)} CSS px`);
check(rendered.contrast >= 7, "the rendered letters clear the plate", `${rendered.contrast.toFixed(1)}:1`);
check(
	rendered.purity !== undefined && rendered.purity > 0.99,
	"the sheet is drawn sharp, never resampled",
	`${((rendered.purity ?? 0) * 100).toFixed(2)}% of pixels are sheet colours`,
);
const renderedBand = rendered.frame[cardColour];
check(
	(renderedBand?.ratio ?? 0) >= 3,
	"the rendered frame edges the badge off the card",
	`${renderedBand ? hex(renderedBand.rgb) : "none"} at ${(renderedBand?.ratio ?? 0).toFixed(1)}:1`,
);
check(errors.length === 0, "no page errors", errors.join("; "));

await browser.close();
console.log(failed ? "\nLOGO PROBE: FAILED" : "\nLOGO PROBE: PASS");
console.log(`screenshots: ${SHOTS}/`);
if (failed) process.exit(1);
