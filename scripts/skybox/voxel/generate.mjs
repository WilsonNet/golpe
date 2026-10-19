// Regenerate the voxel skybox: bundle scene.js, render it in headless Chromium,
// write the PNGs and the content-hashed manifest.
//
//   node scripts/skybox/voxel/generate.mjs
//
// Requires the repo's playwright + chromium and the esbuild binary in
// node_modules/.bin (both are already installed).

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.join(root, "public/assets/skybox/voxel");
const buildDir = path.join(here, ".build");
const bundlePath = path.join(buildDir, "scene.bundle.js");

// esbuild is a transitive dependency here and is not linked at node_modules
// root, so resolve the package inside pnpm's store rather than the broken
// .bin shim (which tries to run the native binary with node).
function loadEsbuild() {
	const store = path.join(root, "node_modules/.pnpm");
	const dir = fs.readdirSync(store).find((name) => name.startsWith("esbuild@"));
	if (!dir) throw new Error("esbuild not found in node_modules/.pnpm");
	return require(path.join(store, dir, "node_modules/esbuild/lib/main.js"));
}

const W = 1600;
const H = 600;

function dataUrlToBuffer(dataUrl) {
	const comma = dataUrl.indexOf(",");
	if (comma < 0) throw new Error("not a data URL");
	return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

function writePng(name, dataUrl, dir = outDir) {
	const buf = dataUrlToBuffer(dataUrl);
	const file = path.join(dir, name);
	fs.writeFileSync(file, buf);
	return {
		file,
		buf,
		version: crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12),
	};
}

function pngSize(file) {
	const b = fs.readFileSync(file);
	if (b.toString("ascii", 1, 4) !== "PNG")
		throw new Error(`${file} is not a PNG`);
	return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function assertSize(file, width, height) {
	const s = pngSize(file);
	if (s.width !== width || s.height !== height) {
		throw new Error(
			`${path.basename(file)} is ${s.width}x${s.height}, expected ${width}x${height}`,
		);
	}
	return s;
}

async function main() {
	fs.mkdirSync(outDir, { recursive: true });
	fs.mkdirSync(buildDir, { recursive: true });
	// stale debug output from an older run must not linger in the shipped folder
	fs.rmSync(path.join(outDir, "seam-check.png"), { force: true });

	await loadEsbuild().build({
		entryPoints: [path.join(here, "scene.js")],
		bundle: true,
		format: "iife",
		globalName: "Skybox",
		platform: "browser",
		target: "chrome120",
		loader: { ".json": "json" },
		outfile: bundlePath,
		logLevel: "warning",
	});

	const browser = await chromium.launch();
	let stats;
	const files = {};
	try {
		const page = await browser.newPage({
			viewport: { width: 1000, height: 720 },
		});
		page.on("pageerror", (err) => console.error("[page]", err));
		await page.setContent(
			'<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#22213a}canvas{display:block}</style></head><body></body></html>',
		);
		await page.addScriptTag({ path: bundlePath });
		stats = await page.evaluate(() => window.Skybox.init());
		console.log("voxels:", stats.totalVoxels);
		for (const [name, counts] of Object.entries(stats.layers)) {
			console.log(
				`  ${name.padEnd(4)} ${String(counts.total).padStart(6)}  (${counts.duplicates} wrap duplicates)`,
			);
		}

		for (const name of ["sky", "far", "mid", "near"]) {
			const dataUrl = await page.evaluate(
				(n) => window.Skybox.renderLayer(n),
				name,
			);
			files[name] = writePng(`${name}.png`, dataUrl);
			assertSize(files[name].file, W, H);
			console.log(`wrote ${name}.png  ${W}x${H}`);
		}

		const seams = await page.evaluate(() => window.Skybox.seamMetrics());
		stats.seamMetrics = seams;
		console.log("seam wrap check (boundary 1599->0):");
		for (const [name, m] of Object.entries(seams)) {
			console.log(
				`  ${name.padEnd(4)} seam ${String(m.seamMean).padStart(5)} vs median ${String(m.medianMean).padStart(5)} p95 ${String(m.p95Mean).padStart(5)} (percentile ${m.seamPercentile})`,
			);
		}

		const falls = writePng(
			"falls.png",
			await page.evaluate(() => window.Skybox.renderFalls()),
		);
		assertSize(falls.file, 288, 240);
		files.falls = falls;
		console.log("wrote falls.png  288x240");

		const contact = writePng(
			"contact.png",
			await page.evaluate(() => window.Skybox.renderContact()),
		);
		assertSize(contact.file, W, H);
		files.contact = contact;
		console.log("wrote contact.png  1600x600");

		const seam = writePng(
			"seam-check.png",
			await page.evaluate(() => window.Skybox.renderSeamCheck()),
			here,
		);
		assertSize(seam.file, 812, 1212);
		files.seam = seam;
		console.log(
			"wrote seam-check.png  812x1212 (debug, 4 layers tiled across the seam)",
		);
	} finally {
		await browser.close();
	}

	const items = [
		{ u: 276, v: 260 },
		{ u: 896, v: 300 },
	];
	const manifest = {
		name: "voxel",
		title: "Solar Voxel",
		width: W,
		height: H,
		// The city is denser than the hand candidate; 1.15 is the smallest
		// atmospheric lift that keeps the local detail budget in the same band
		// as the flat-sky control. See specs/skybox.md.
		haze: 1.15,
		layers: [
			{
				id: "sky",
				type: "image",
				src: "assets/skybox/voxel/sky.png",
				version: files.sky.version,
				factor: 0.015,
				driftX: 0.6,
				alpha: 1,
			},
			{
				id: "far",
				type: "image",
				src: "assets/skybox/voxel/far.png",
				version: files.far.version,
				factor: 0.06,
			},
			{
				id: "mid",
				type: "image",
				src: "assets/skybox/voxel/mid.png",
				version: files.mid.version,
				factor: 0.18,
			},
			{
				id: "falls",
				type: "strip",
				src: "assets/skybox/voxel/falls.png",
				version: files.falls.version,
				factor: 0.3,
				align: "mid",
				frameW: 48,
				frameH: 240,
				frames: 6,
				fps: 9,
				items,
			},
			{
				id: "near",
				type: "image",
				src: "assets/skybox/voxel/near.png",
				version: files.near.version,
				factor: 0.5,
				// The near foliage is the closest thing to the floor and would
				// otherwise sit in the fighter's value band at full strength.
				// 20% keeps the framing and lets the pale mid city carry the
				// silhouette. See specs/skybox.md.
				alpha: 0.2,
			},
		],
	};
	fs.writeFileSync(
		path.join(outDir, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	const buildStats = {
		generated: new Date().toISOString(),
		command: "node scripts/skybox/voxel/generate.mjs",
		stats,
		files: Object.fromEntries(
			Object.entries(files).map(([k, v]) => [
				k,
				{ version: v.version, ...pngSize(v.file) },
			]),
		),
	};
	fs.writeFileSync(
		path.join(here, "build-stats.json"),
		`${JSON.stringify(buildStats, null, 2)}\n`,
	);

	console.log("wrote manifest.json");
	console.log(
		Object.entries(files)
			.map(([k, v]) => `  ${k.padEnd(8)} ${v.version}`)
			.join("\n"),
	);
}

main()
	.catch((err) => {
		console.error(err);
		console.error(
			"\nIf Chromium is missing: pnpm exec playwright install chromium",
		);
		process.exitCode = 1;
	})
	.finally(() => {
		fs.rmSync(buildDir, { recursive: true, force: true });
	});
