// Solar Voxel — Three.js pre-render to pixel art.
//
// Bundled by generate.mjs with esbuild, run in headless Chromium. The scene is
// built once as four InstancedMeshes (one per parallax layer) and rendered at
// 800 x 300 with an orthographic, slightly pitched, zero-yaw camera. Each
// render is quantised to art/skybox/palette.json at 800 x 300, then nearest
// neighbour upscaled 2x to the contracted 1600 x 600.

import * as THREE from "three";
import palette from "../../../art/skybox/palette.json";
import { buildLayer, buildLayout, fallsSpec, H, W } from "./layout.js";

THREE.ColorManagement.enabled = false;

const RW = 800;
const RH = 300;
const SCALE = 2;
const PITCH = THREE.MathUtils.degToRad(8);
const PITCH_TAN = Math.tan(PITCH);
const PITCH_COS = Math.cos(PITCH);
const CAM_DIST = 1400;
const LAYERS = ["sky", "far", "mid", "near"];

const PALETTE_RGB = palette.all.map((hex) => {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

const BAYER8 = [
	[0, 32, 8, 40, 2, 34, 10, 42],
	[48, 16, 56, 24, 50, 18, 58, 26],
	[12, 44, 4, 36, 14, 46, 6, 38],
	[60, 28, 52, 20, 62, 30, 54, 22],
	[3, 35, 11, 43, 1, 33, 9, 41],
	[51, 19, 59, 27, 49, 17, 57, 25],
	[15, 47, 7, 39, 13, 45, 5, 37],
	[63, 31, 55, 23, 61, 29, 53, 21],
];

let renderer;
let camera;
let scene;
const meshes = {};
let layout;
const layerCounts = {};
const finalCanvases = {};
let fallsCanvas = null;
let gradientCanvas = null;
let stats = {};

const nearestCache = new Map();

function nearestPalette(r, g, b) {
	const key = (r << 16) | (g << 8) | b;
	const cached = nearestCache.get(key);
	if (cached !== undefined) return cached;
	let best = 0;
	let bestD = Number.POSITIVE_INFINITY;
	for (let i = 0; i < PALETTE_RGB.length; i++) {
		const p = PALETTE_RGB[i];
		const dr = r - p[0];
		const dg = g - p[1];
		const db = b - p[2];
		// a mild perceptual weighting keeps warm shadows out of the blues
		const d = dr * dr * 1.05 + dg * dg * 1.25 + db * db * 0.9;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	nearestCache.set(key, best);
	return best;
}

function makeFaceMaterialGeometry() {
	const geo = new THREE.BoxGeometry(1, 1, 1);
	const normals = geo.attributes.normal;
	const colors = new Float32Array(normals.count * 3);
	for (let i = 0; i < normals.count; i++) {
		const nx = normals.getX(i);
		const ny = normals.getY(i);
		const nz = normals.getZ(i);
		let brightness;
		if (ny > 0.5) brightness = 1.0;
		else if (nz > 0.5) brightness = 0.97;
		else if (ny < -0.5) brightness = 0.7;
		else if (nx > 0.5) brightness = 0.88;
		else if (nx < -0.5) brightness = 0.78;
		else brightness = 0.84;
		colors[i * 3] = brightness;
		colors[i * 3 + 1] = brightness;
		colors[i * 3 + 2] = brightness;
	}
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	return geo;
}

function hexToRgb(hex) {
	const n = Number.parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function buildMesh(items) {
	const geo = makeFaceMaterialGeometry();
	const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
	const mesh = new THREE.InstancedMesh(geo, mat, items.length);
	mesh.frustumCulled = false;
	const m = mesh.instanceMatrix.array;
	const colors = new Float32Array(items.length * 3);
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		const c = Math.cos(it.rotZ);
		const s = Math.sin(it.rotZ);
		const o = i * 16;
		m[o] = it.sx * c;
		m[o + 1] = it.sx * s;
		m[o + 4] = -it.sy * s;
		m[o + 5] = it.sy * c;
		m[o + 10] = it.sz;
		m[o + 12] = it.x - W / 2;
		// shear z back into y so a voxel's centre lands on its design y
		m[o + 13] = H / 2 - (it.y - it.z * PITCH_TAN);
		m[o + 14] = it.z;
		m[o + 15] = 1;
		const col = hexToRgb(it.color);
		colors[i * 3] = col[0];
		colors[i * 3 + 1] = col[1];
		colors[i * 3 + 2] = col[2];
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
	mesh.instanceColor.needsUpdate = true;
	mesh.visible = false;
	return mesh;
}

function initThree() {
	renderer = new THREE.WebGLRenderer({
		canvas: document.createElement("canvas"),
		antialias: false,
		alpha: true,
		preserveDrawingBuffer: true,
		powerPreference: "high-performance",
	});
	renderer.setPixelRatio(1);
	renderer.setSize(RW, RH, false);
	renderer.setClearColor(0x000000, 0);
	renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
	renderer.autoClear = true;

	scene = new THREE.Scene();
	camera = new THREE.OrthographicCamera(
		-W / 2,
		W / 2,
		(H / 2) * PITCH_COS,
		(-H / 2) * PITCH_COS,
		1,
		5000,
	);
	camera.position.set(0, CAM_DIST * PITCH_TAN, CAM_DIST);
	camera.rotation.x = -PITCH;
	camera.updateMatrixWorld();

	layout = buildLayout();
	for (const name of LAYERS) {
		const built = buildLayer(name, layout);
		layerCounts[name] = {
			original: built.original,
			total: built.items.length,
			duplicates: built.duplicates,
		};
		const mesh = buildMesh(built.items);
		meshes[name] = mesh;
		scene.add(mesh);
	}
	gradientCanvas = makeSkyGradient();
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function gradientAt(t) {
	const stops = [
		[0.0, [47, 107, 152]], // #2f6b98
		[0.22, [63, 136, 173]], // #3f88ad
		[0.46, [90, 166, 189]], // #5aa6bd
		[0.62, [120, 194, 199]], // #78c2c7
		[0.75, [154, 216, 205]], // #9ad8cd
		[0.86, [198, 235, 220]], // #c6ebdc
		[1.0, [234, 243, 223]], // #eaf3df
	];
	for (let i = 0; i < stops.length - 1; i++) {
		const [ta, ca] = stops[i];
		const [tb, cb] = stops[i + 1];
		if (t <= tb) {
			const u = Math.max(0, Math.min(1, (t - ta) / (tb - ta)));
			return [
				lerp(ca[0], cb[0], u),
				lerp(ca[1], cb[1], u),
				lerp(ca[2], cb[2], u),
			];
		}
	}
	return stops[stops.length - 1][1];
}

function makeSkyGradient() {
	const canvas = document.createElement("canvas");
	canvas.width = RW;
	canvas.height = RH;
	const ctx = canvas.getContext("2d");
	const img = ctx.createImageData(RW, RH);
	const d = img.data;
	const sunX = 618 / 2;
	const sunY = 78 / 2;
	for (let y = 0; y < RH; y++) {
		for (let x = 0; x < RW; x++) {
			const t = y / (RH - 1);
			let [r, g, b] = gradientAt(t);
			// warm sun bloom, dithered into the palette below
			const dx = x - sunX;
			const dy = y - sunY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const glow =
				Math.max(0, 1 - dist / 174) ** 2.0 * 0.72 +
				Math.max(0, 1 - dist / 300) ** 2.0 * 0.2;
			r = lerp(r, 255, glow);
			g = lerp(g, 231, glow);
			b = lerp(b, 169, glow);
			const dither = (BAYER8[y & 7][x & 7] / 64 - 0.5) * 20;
			const idx = nearestPalette(
				Math.max(0, Math.min(255, Math.round(r + dither))),
				Math.max(0, Math.min(255, Math.round(g + dither))),
				Math.max(0, Math.min(255, Math.round(b + dither))),
			);
			const p = PALETTE_RGB[idx];
			const o = (y * RW + x) * 4;
			d[o] = p[0];
			d[o + 1] = p[1];
			d[o + 2] = p[2];
			d[o + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

function quantizeCanvas(canvas, opaque) {
	const ctx = canvas.getContext("2d");
	const img = ctx.getImageData(0, 0, RW, RH);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const a = d[i + 3];
		if (!opaque && a < 128) {
			d[i] = 34;
			d[i + 1] = 33;
			d[i + 2] = 58;
			d[i + 3] = 0;
			continue;
		}
		const idx = nearestPalette(d[i], d[i + 1], d[i + 2]);
		const p = PALETTE_RGB[idx];
		d[i] = p[0];
		d[i + 1] = p[1];
		d[i + 2] = p[2];
		d[i + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
}

function renderScene(name) {
	for (const key of LAYERS) meshes[key].visible = key === name;
	renderer.setClearAlpha(0);
	renderer.clear(true, true, true);
	renderer.render(scene, camera);
	return renderer.domElement;
}

function composeLayer(name) {
	const source = renderScene(name);
	const base = document.createElement("canvas");
	base.width = RW;
	base.height = RH;
	const bctx = base.getContext("2d");
	bctx.imageSmoothingEnabled = false;
	if (name === "sky") bctx.drawImage(gradientCanvas, 0, 0);
	bctx.drawImage(source, 0, 0);
	quantizeCanvas(base, name === "sky");

	const final = document.createElement("canvas");
	final.width = W;
	final.height = H;
	const fctx = final.getContext("2d");
	fctx.imageSmoothingEnabled = false;
	fctx.drawImage(base, 0, 0, W, H);
	finalCanvases[name] = final;
	return final.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// animated falls: 24 x 120 art pixels per frame, nearest-upscaled to 48 x 240

function fallsFrame(frame) {
	const fw = 24;
	const fh = 120;
	const canvas = document.createElement("canvas");
	canvas.width = fw;
	canvas.height = fh;
	const ctx = canvas.getContext("2d");
	const img = ctx.createImageData(fw, fh);
	const d = img.data;
	const phase = frame * 16; // 6 frames x 16 px = 96 px loop
	const frameAngle = (frame / 6) * Math.PI * 2;
	const mistPulse = 0.5 + 0.5 * Math.sin(frameAngle);
	const half = (y) => {
		if (y < 7) return 10.6;
		if (y < 102) return 8.2 + 1.5 * Math.sin(y * 0.08 + frameAngle);
		return 9.5 + (y - 102) * 0.32 + mistPulse * 1.5;
	};
	for (let y = 0; y < fh; y++) {
		const hw = half(y);
		for (let x = 0; x < fw; x++) {
			const dx = x - (fw - 1) / 2;
			const ad = Math.abs(dx);
			const o = (y * fw + x) * 4;
			let color = null;
			let alpha = 255;
			if (ad <= hw) {
				const yLoop = (((y - phase) % 96) + 96) % 96;
				const n1 =
					Math.floor(Math.sin((x * 7 + yLoop * 3) * 0.7) * 100) / 100;
				if (y < 5) {
					// foam lip at the aqueduct mouth
					color = ad < hw - 2 ? "#effff4" : "#c8f7ec";
					if (n1 > 0.6 && ad > hw - 3) color = null;
				} else if (y < 100) {
					// long vertical streaks, scrolling down one step per frame
					const band = Math.floor(x / 3) % 4;
					const streak = Math.sin((yLoop + x * 5) * 0.24);
					if (ad > hw - 1.8) {
						alpha = n1 > 0.15 ? 0 : 255;
						color = "#2f8ba8";
					} else if (streak > 0.78) {
						color = "#effff4";
					} else if (streak > 0.44) {
						color = "#c8f7ec";
					} else if (streak < -0.66) {
						color = "#2f8ba8";
					} else if (band === 0) {
						color = "#96e8dc";
					} else if (band === 1) {
						color = "#66d0cf";
					} else if (band === 2) {
						color = "#42b2c2";
					} else {
						color = "#96e8dc";
					}
					// a few bright foam ridges travelling with the loop
					if (((yLoop + 9) % 23) < 2 && n1 > -0.4) color = "#c8f7ec";
					if (y < 9 && n1 > 0.15) color = "#effff4";
				} else {
					// mist fan at the bottom: dithered, no soft alpha
					const puff =
						Math.max(0, 1 - Math.abs(dx) / (hw + 3)) *
						(0.6 + 0.4 * mistPulse);
					const n2 = Math.abs(Math.sin((x * 5.7 + y * 3.1 + frameAngle) * 1.3)) % 1;
					if (n2 > 0.34 + puff * 0.44) color = null;
					else color = n2 > 0.72 ? "#effff4" : n2 > 0.42 ? "#c8f7ec" : "#96e8dc";
					if (y > 112 && n2 > 0.5) color = null;
					if (color === null) alpha = 0;
				}
				if (color === null) alpha = 0;
			} else {
				alpha = 0;
			}
			if (alpha === 0) {
				d[o] = 34;
				d[o + 1] = 33;
				d[o + 2] = 58;
				d[o + 3] = 0;
				continue;
			}
			const n = Number.parseInt(color.slice(1), 16);
			d[o] = (n >> 16) & 255;
			d[o + 1] = (n >> 8) & 255;
			d[o + 2] = n & 255;
			d[o + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

function makeFallsStrip() {
	const strip = document.createElement("canvas");
	strip.width = 48 * 6;
	strip.height = 240;
	const ctx = strip.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	for (let f = 0; f < 6; f++) {
		const frame = fallsFrame(f);
		ctx.drawImage(frame, 0, 0, 24, 120, f * 48, 0, 48, 240);
	}
	return strip;
}

function makeContact() {
	const contact = document.createElement("canvas");
	contact.width = W;
	contact.height = H;
	const ctx = contact.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(finalCanvases.sky, 0, 0);
	ctx.drawImage(finalCanvases.far, 0, 0);
	ctx.drawImage(finalCanvases.mid, 0, 0);
	for (const item of fallsSpec()) {
		ctx.drawImage(fallsCanvas, 0, 0, 48, 240, item.u, item.v, 48, 240);
	}
	ctx.drawImage(finalCanvases.near, 0, 0);
	return contact;
}

function makeSeamCheck() {
	const qw = 400;
	const qh = 600;
	const gap = 4;
	const canvas = document.createElement("canvas");
	canvas.width = qw * 2 + gap * 3;
	canvas.height = qh * 2 + gap * 3;
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = "#22213a";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const positions = {
		sky: [gap, gap],
		far: [qw + gap * 2, gap],
		mid: [gap, qh + gap * 2],
		near: [qw + gap * 2, qh + gap * 2],
	};
	for (const name of LAYERS) {
		const [ox, oy] = positions[name];
		ctx.save();
		ctx.beginPath();
		ctx.rect(ox, oy, qw, qh);
		ctx.clip();
		// checkerboard so transparent layers show their true silhouette
		if (name !== "sky") {
			const c = 20;
			for (let y = 0; y < qh; y += c) {
				for (let x = 0; x < qw; x += c) {
					ctx.fillStyle = (x / c + y / c) % 2 === 0 ? "#2d2b4b" : "#3b395e";
					ctx.fillRect(ox + x, oy + y, c, c);
				}
			}
		}
		// crop 1400..1800: the two copies meet at local x = 200
		ctx.drawImage(finalCanvases[name], ox - 1400, oy);
		ctx.drawImage(finalCanvases[name], ox + 200, oy);
		ctx.restore();
		ctx.fillStyle = "#fff2d6";
		ctx.font = "12px monospace";
		ctx.fillText(name.toUpperCase(), ox + 8, oy + 17);
	}
	return canvas;
}

// ---------------------------------------------------------------------------
// exported page API

export function init() {
	initThree();
	fallsCanvas = makeFallsStrip();
	stats = {
		layers: layerCounts,
		totalVoxels: LAYERS.reduce((n, k) => n + layerCounts[k].total, 0),
		pitchDeg: 8,
		render: [RW, RH],
		output: [W, H],
		palette: palette.all.length,
	};
	return stats;
}

export function renderLayer(name) {
	if (!LAYERS.includes(name)) throw new Error(`unknown layer ${name}`);
	return composeLayer(name);
}

export function renderFalls() {
	return fallsCanvas.toDataURL("image/png");
}

export function renderContact() {
	return makeContact().toDataURL("image/png");
}

export function renderSeamCheck() {
	return makeSeamCheck().toDataURL("image/png");
}

// Numerical proof that the wrap is exact: compare the boundary between column
// 1599 and column 0 with every other adjacent column boundary. A seam that is
// an outlier (rank near 100, far above p95) means a silhouette was cut.
export function seamMetrics() {
	const out = {};
	for (const name of LAYERS) {
		const ctx = finalCanvases[name].getContext("2d");
		const d = ctx.getImageData(0, 0, W, H).data;
		const means = new Float64Array(W);
		for (let x = 0; x < W; x++) {
			const nx = (x + 1) % W;
			let sum = 0;
			for (let y = 0; y < H; y++) {
				const i = (y * W + x) * 4;
				const j = (y * W + nx) * 4;
				sum +=
					Math.abs(d[i] - d[j]) +
					Math.abs(d[i + 1] - d[j + 1]) +
					Math.abs(d[i + 2] - d[j + 2]) +
					Math.abs(d[i + 3] - d[j + 3]);
			}
			means[x] = sum / (H * 4);
		}
		const seam = means[W - 1];
		const sorted = Array.from(means).sort((a, b) => a - b);
		const rank = sorted.filter((v) => v <= seam).length;
		out[name] = {
			seamMean: Math.round(seam * 100) / 100,
			medianMean: Math.round(sorted[Math.floor(W / 2)] * 100) / 100,
			p95Mean: Math.round(sorted[Math.floor(W * 0.95)] * 100) / 100,
			seamPercentile: Math.round((rank / W) * 1000) / 10,
		};
	}
	return out;
}

export function getStats() {
	return stats;
}

export function getFallsItems() {
	return fallsSpec();
}
