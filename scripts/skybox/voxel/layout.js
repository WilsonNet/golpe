// Solar Voxel — the shared city layout and voxel builders.
//
// One layout describes the whole panorama. Each of the four parallax layers is
// built from a subset of it, so towers, aqueducts and the falls mouths can
// never drift apart between layers. All instance colours come from
// art/skybox/palette.json; per-face brightness is baked into box vertex
// colours by scene.js and quantised back to the palette at the end.
//
// Design coordinates are FINAL pixels: 1600 x 600, y down. scene.js maps them
// to Three world space (y up) with a 1600 x 600 orthographic camera.

import palette from "../../../art/skybox/palette.json";

export const W = 1600;
export const H = 600;
const VOX = 5;

const G = palette.groups;
const P = {
	sky: G.sky,
	sun: G.sun,
	clouds: G.clouds,
	far: G.farCity,
	cream: G.cityCream,
	stone: G.cityStone,
	brass: G.brass,
	green: G.greens,
	water: G.water,
	flower: G.flowers,
	shadow: G.shadows,
	accent: G.accents,
};
const PALETTE = new Set(palette.all.map((c) => c.toLowerCase()));

// ---------------------------------------------------------------------------
// colour families

const STYLES = {
	cream: {
		body: ["#fff2d6", "#f3e0bb", "#f3e0bb"],
		dark: "#e4c99b",
		edge: "#d2b07c",
		light: "#fff2d6",
		trim: "#f7c85f",
		band: "#66d0cf",
		soil: "#9b6a50",
	},
	stone: {
		body: ["#f3e0bb", "#e2b98c", "#e2b98c"],
		dark: "#cfa074",
		edge: "#b9855e",
		light: "#f3e0bb",
		trim: "#e4a73f",
		band: "#78c2c7",
		soil: "#7f5446",
	},
	teal: {
		body: ["#c6ebdc", "#9ad8cd", "#c6ebdc"],
		dark: "#78c2c7",
		edge: "#5aa6bd",
		light: "#eaf3df",
		trim: "#ffe08a",
		band: "#e4a73f",
		soil: "#72586e",
	},
	far: {
		body: ["#9ad8cd", "#8ea9ae", "#8ea9ae"],
		dark: "#7b98a3",
		edge: "#688596",
		light: "#c6ebdc",
		trim: "#e4c99b",
		band: "#9ad8cd",
		soil: "#587387",
	},
};

const FALLS = [
	{ u: 276, v: 260 }, // left edge of the 48 px fall, top edge
	{ u: 896, v: 300 },
];

// ---------------------------------------------------------------------------
// deterministic noise + colour pickers

function h01(a, b, c, seed = 0) {
	let h = Math.imul((a | 0) + 1, 374761393);
	h ^= Math.imul((b | 0) + 3, 668265263);
	h ^= Math.imul((c | 0) + 7, 2147483647);
	h ^= Math.imul((seed | 0) + 11, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function pick(arr, r) {
	return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(r * arr.length)))];
}

function fitColor(hex) {
	if (!PALETTE.has(hex.toLowerCase())) {
		throw new Error(`Colour outside art/skybox/palette.json: ${hex}`);
	}
	return hex;
}

// ---------------------------------------------------------------------------
// builder + tiling

class Builder {
	constructor(layer) {
		this.layer = layer;
		this.items = [];
	}

	add(x, y, z, color, sx = VOX, sy = VOX, sz = VOX, rotZ = 0) {
		this.items.push({ x, y, z, color: fitColor(color), sx, sy, sz, rotZ });
		return this;
	}

	// Horizontal run of boxes at a fixed y. Handy for trim, sills, water lines.
	addRun(x0, x1, y, z, color, sy = VOX, sz = VOX) {
		const step = VOX;
		for (let x = x0; x < x1; x += step) {
			this.add(x + step / 2, y, z, color, step, sy, sz);
		}
		return this;
	}

	// Duplicate everything that crosses the left or right edge at x +/- 1600.
	// The camera has no yaw, so world x maps exactly to screen x and this is
	// all a horizontally tileable panorama needs.
	finish() {
		const original = this.items.length;
		const base = this.items.slice();
		for (const it of base) {
			const c = Math.abs(Math.cos(it.rotZ));
			const s = Math.abs(Math.sin(it.rotZ));
			const halfW = (it.sx * c + it.sy * s) * 0.5;
			if (it.x - halfW < 0) this.items.push({ ...it, x: it.x + W });
			if (it.x + halfW > W) this.items.push({ ...it, x: it.x - W });
		}
		return {
			layer: this.layer,
			items: this.items,
			original,
			duplicates: this.items.length - original,
		};
	}
}

// ---------------------------------------------------------------------------
// shared layout

export function buildLayout() {
	const layout = {
		sky: {
			planet: { x: 236, y: 92, r: 52, z: -40, seed: 3 },
			moon: { x: 392, y: 52, r: 11, z: -55, seed: 9 },
			sun: { x: 618, y: 76, r: 36, z: -70 },
			clouds: [
				{ x: 18, y: 180, w: 260, h: 140, z: -8, seed: 1 },
				{ x: 430, y: 160, w: 220, h: 112, z: -16, seed: 2 },
				{ x: 792, y: 120, w: 208, h: 108, z: 4, seed: 3 },
				{ x: 1040, y: 172, w: 252, h: 136, z: -4, seed: 4 },
				{ x: 1300, y: 108, w: 238, h: 118, z: 2, seed: 5 },
				{ x: 1544, y: 190, w: 196, h: 112, z: 6, seed: 6 },
			],
			airships: [
				{ x: 470, y: 118, len: 76, h: 28, z: 30, seed: 4, big: true },
				{ x: 1040, y: 96, len: 58, h: 21, z: 18, seed: 5, big: true },
				{ x: 1462, y: 194, len: 42, h: 16, z: 8, seed: 6, far: true },
			],
			flocks: [
				{ x: 700, y: 118, n: 5, seed: 2 },
				{ x: 1130, y: 118, n: 4, seed: 5 },
				{ x: 332, y: 158, n: 3, seed: 8 },
			],
		},

		// pale skyline behind everything
		far: {
			towers: [
				{ x: 18, base: 388, top: 268, w: 74, dome: "round", seed: 11 },
				{ x: 106, base: 384, top: 232, w: 48, dome: "spire", seed: 12 },
				{ x: 190, base: 390, top: 286, w: 104, dome: "flat", seed: 13 },
				{ x: 286, base: 384, top: 244, w: 56, dome: "onion", seed: 14 },
				{ x: 386, base: 392, top: 208, w: 42, dome: "spire", seed: 15 },
				{ x: 548, base: 390, top: 238, w: 54, dome: "flat", seed: 17 },
				{ x: 636, base: 384, top: 206, w: 38, dome: "onion", seed: 18 },
				{ x: 714, base: 390, top: 292, w: 98, dome: "round", seed: 19 },
				{ x: 814, base: 388, top: 246, w: 46, dome: "spire", seed: 20 },
				{ x: 892, base: 392, top: 214, w: 40, dome: "round", seed: 21 },
				{ x: 1148, base: 390, top: 198, w: 36, dome: "spire", seed: 24 },
				{ x: 1216, base: 386, top: 268, w: 92, dome: "round", seed: 25 },
				{ x: 1308, base: 390, top: 238, w: 58, dome: "onion", seed: 26 },
				{ x: 1400, base: 384, top: 284, w: 84, dome: "flat", seed: 27 },
				{ x: 1494, base: 390, top: 246, w: 50, dome: "round", seed: 28 },
				{ x: 1574, base: 388, top: 222, w: 44, dome: "spire", seed: 29 },
			],
			domes: [
				{ x: 470, base: 384, r: 58, h: 68, seed: 33, minarets: true },
				{ x: 1010, base: 384, r: 64, h: 76, seed: 34, minarets: true },
			],
			aqueducts: [
				{ x0: 168, x1: 468, yTop: 332, height: 56, arches: 3, seed: 31 },
				{ x0: 1246, x1: 1502, yTop: 320, height: 64, arches: 3, seed: 32 },
			],
		},

		mid: {
			// The city is a handful of strong landmarks with sky between them,
			// not a wall of towers. The hero crop reads left to right:
			// low seam garden → tall domed tower → aqueduct and fall → water
			// tower → low gardens → the giant tree.
			towers: [
				{
					cx: 150,
					base: 572,
					bodyTop: 252,
					w: 104,
					depth: 30,
					z: 4,
					style: "cream",
					dome: "onion",
					domeR: 48,
					domeH: 86,
					seed: 41,
					porthole: true,
					balconies: [350, 432, 502],
					vines: true,
				},
				{
					cx: 60,
					base: 566,
					bodyTop: 404,
					w: 66,
					depth: 18,
					z: -18,
					style: "stone",
					dome: "round",
					domeR: 30,
					domeH: 30,
					seed: 42,
					garden: true,
				},
				{
					cx: 486,
					base: 570,
					bodyTop: 250,
					w: 66,
					depth: 22,
					z: -6,
					style: "stone",
					dome: "round",
					domeR: 30,
					domeH: 30,
					domeStyle: "teal",
					seed: 43,
					balconies: [322, 400, 478],
					vines: true,
				},
				{
					cx: 828,
					base: 570,
					bodyTop: 300,
					w: 84,
					depth: 24,
					z: -10,
					style: "cream",
					dome: "onion",
					domeR: 40,
					domeH: 78,
					seed: 44,
					porthole: true,
					balconies: [390, 466],
					vines: true,
				},
				{
					cx: 1070,
					base: 568,
					bodyTop: 310,
					w: 56,
					depth: 20,
					z: -12,
					style: "stone",
					dome: "round",
					domeR: 26,
					domeH: 26,
					seed: 45,
					garden: true,
				},
				{
					cx: 1136,
					base: 576,
					bodyTop: 410,
					w: 154,
					depth: 32,
					z: 22,
					style: "cream",
					dome: "round",
					domeR: 76,
					domeH: 88,
					domeStyle: "teal",
					seed: 46,
					balconies: [474],
				},
				{
					cx: 1450,
					base: 570,
					bodyTop: 360,
					w: 82,
					depth: 22,
					z: -8,
					style: "stone",
					dome: null,
					seed: 47,
					garden: true,
					turbine: true,
					turbineH: 84,
					turbineR: 48,
				},
				{
					cx: 980,
					base: 570,
					bodyTop: 400,
					w: 54,
					depth: 18,
					z: 20,
					style: "cream",
					dome: null,
					seed: 48,
					garden: true,
					turbine: true,
					turbineH: 70,
					turbineR: 40,
				},
				{
					cx: 1588,
					base: 574,
					bodyTop: 500,
					w: 120,
					depth: 20,
					z: -2,
					style: "stone",
					dome: "round",
					domeR: 40,
					domeH: 28,
					seed: 50,
					garden: true,
				},
			],
			trees: [
				{
					x: 704,
					base: 576,
					height: 430,
					spread: 136,
					z: 28,
					seed: 61,
					scale: 1,
				},
				{
					x: 1300,
					base: 576,
					height: 300,
					spread: 86,
					z: 14,
					seed: 62,
					scale: 0.8,
					blossom: true,
				},
			],
			aqueducts: [
				{
					x0: 206,
					x1: 486,
					yTop: 250,
					height: 130,
					arches: 3,
					z: 2,
					style: "cream",
					mouth: 0,
					seed: 71,
				},
				{
					x0: 848,
					x1: 1070,
					yTop: 300,
					height: 116,
					arches: 2,
					z: -6,
					style: "stone",
					mouth: 1,
					seed: 72,
				},
			],
			bridges: [
				{ x0: 356, x1: 472, yTop: 490, height: 46, z: 36, seed: 81 },
				{ x0: 980, x1: 1096, yTop: 496, height: 42, z: 28, seed: 82 },
			],
			pools: [
				{ x: 300, y: 508, rx: 64, ry: 20, z: 44, seed: 91 },
				{ x: 920, y: 538, rx: 46, ry: 13, z: 36, seed: 92 },
			],
			waterwheels: [{ x: 346, y: 498, r: 26, z: 52, seed: 191 }],
			turbines: [{ x: 60, y: 370, h: 74, r: 38, z: -8, seed: 201 }],
			// low garden pavilions fill the bottom terraces between towers
			pavilions: [
				{
					cx: 550,
					base: 566,
					bodyTop: 454,
					w: 66,
					depth: 20,
					z: 30,
					style: "cream",
					dome: "onion",
					domeR: 26,
					domeH: 38,
					domeStyle: "teal",
					seed: 113,
					garden: true,
					vines: true,
				},
				{
					cx: 620,
					base: 568,
					bodyTop: 486,
					w: 74,
					depth: 16,
					z: 28,
					style: "teal",
					dome: "round",
					domeR: 24,
					domeH: 22,
					seed: 114,
					garden: true,
				},
				{
					cx: 960,
					base: 570,
					bodyTop: 466,
					w: 90,
					depth: 20,
					z: 26,
					style: "stone",
					dome: null,
					seed: 115,
					garden: true,
				},
				{
					cx: 1230,
					base: 568,
					bodyTop: 468,
					w: 84,
					depth: 18,
					z: 24,
					style: "cream",
					dome: null,
					seed: 116,
					garden: true,
				},
				{
					cx: 1338,
					base: 570,
					bodyTop: 500,
					w: 64,
					depth: 16,
					z: 28,
					style: "stone",
					dome: "round",
					domeR: 24,
					domeH: 22,
					seed: 117,
					garden: true,
				},
			],
			solar: [
				{ x: 332, y: 452, w: 62, z: 36, seed: 101 },
				{ x: 924, y: 440, w: 70, z: 34, seed: 102 },
				{ x: 1350, y: 338, w: 62, z: 34, seed: 103 },
				{ x: 1200, y: 444, w: 56, z: 30, seed: 104 },
			],
			canals: [
				{ x0: 356, x1: 522, y: 540, z: 42, seed: 121 },
				{ x0: 960, x1: 1120, y: 548, z: 38, seed: 122 },
			],
		},

		near: {
			// framing foliage, kept out of the mid-screen corridor
			ferns: [
				{ x: 24, y: 612, scale: 1.5, z: 82, seed: 131, angle: -0.5 },
				{ x: 96, y: 606, scale: 1.12, z: 60, seed: 132, angle: 0.16 },
				{ x: 742, y: 612, scale: 1.32, z: 86, seed: 133, angle: 3.55 },
				{ x: 824, y: 606, scale: 1.0, z: 58, seed: 134, angle: 3.02 },
				{ x: 1512, y: 612, scale: 1.5, z: 80, seed: 135, angle: -3.45 },
				{ x: 1588, y: 606, scale: 1.15, z: 62, seed: 136, angle: -2.9 },
			],
			leaves: [
				{ x: 34, y: 540, angle: -0.85, len: 174, wid: 64, z: 96, seed: 141 },
				{ x: 114, y: 582, angle: -0.28, len: 150, wid: 56, z: 70, seed: 142 },
				{ x: 700, y: 548, angle: 3.75, len: 182, wid: 66, z: 96, seed: 143 },
				{ x: 792, y: 590, angle: 3.1, len: 132, wid: 48, z: 68, seed: 144 },
				{ x: 1544, y: 544, angle: -3.7, len: 182, wid: 62, z: 92, seed: 145 },
				{ x: 1600, y: 590, angle: -2.95, len: 132, wid: 50, z: 66, seed: 146 },
			],
			planters: [
				{ x: 292, y: 596, w: 150, z: 52, seed: 151 },
				{ x: 566, y: 600, w: 100, z: 44, seed: 152 },
				{ x: 986, y: 598, w: 140, z: 46, seed: 153 },
				{ x: 1288, y: 600, w: 100, z: 42, seed: 154 },
			],
			rooftops: [
				{ x0: -12, x1: 230, y: 580, z: 40, seed: 161, style: "stone" },
				{ x0: 638, x1: 886, y: 576, z: 36, seed: 162, style: "cream" },
				{ x0: 1238, x1: 1424, y: 584, z: 32, seed: 163, style: "stone" },
			],
			rails: [
				{ x0: 196, x1: 628, y: 590, z: 54, seed: 181 },
				{ x0: 904, x1: 1246, y: 592, z: 48, seed: 182 },
			],
			lanterns: [
				{ x: 792, y: 506, z: 100, seed: 171 },
				{ x: 86, y: 524, z: 94, seed: 172 },
			],
		},
	};

	return layout;
}

// ---------------------------------------------------------------------------
// sky

function drawCloud(b, spec) {
	const { x, y, w, h, z, seed } = spec;
	// A cumulus is a stack of lobes, not one ellipse: a wide base, three or
	// four tall puffs and a small crown. Each lobe is shaded on its own, so the
	// cloud reads as billowing volume instead of horizontal stripes. The lobe
	// layout is jittered per seed, or every cloud is the same cloud scaled.
	const puffs = [
		{ dx: 0, dy: h * 0.2, rx: w * 0.42, ry: h * 0.25, base: true },
		{ dx: -w * 0.3, dy: h * 0.04, rx: w * 0.2, ry: h * 0.31 },
		{ dx: -w * 0.08, dy: -h * 0.12, rx: w * 0.27, ry: h * 0.38 },
		{ dx: w * 0.16, dy: -h * 0.15, rx: w * 0.25, ry: h * 0.41 },
		{ dx: w * 0.36, dy: h * 0.01, rx: w * 0.17, ry: h * 0.28 },
		{ dx: w * 0.02, dy: -h * 0.29, rx: w * 0.16, ry: h * 0.22 },
	];
	for (let pi = 0; pi < puffs.length; pi++) {
		const p = puffs[pi];
		const j = pi * 3 + 1;
		p.rx *= 1 + (h01(seed, j, 1) - 0.5) * 0.34;
		p.ry *= 1 + (h01(seed, j, 2) - 0.5) * 0.4;
		p.dx += (h01(seed, j, 3) - 0.5) * w * 0.09;
		p.dy += (h01(seed, j, 4) - 0.5) * h * 0.08;
	}
	// an extra shoulder or crown on some clouds
	const extras = 1 + Math.floor(h01(seed, 9, 9) * 2);
	for (let e = 0; e < extras; e++) {
		puffs.push({
			dx: (h01(seed, e, 21) - 0.5) * w * 0.5,
			dy: -h * (0.2 + h01(seed, e, 22) * 0.2),
			rx: w * (0.13 + h01(seed, e, 23) * 0.1),
			ry: h * (0.16 + h01(seed, e, 24) * 0.14),
		});
	}
	for (let pi = 0; pi < puffs.length; pi++) {
		const p = puffs[pi];
		for (let yy = -p.ry; yy <= p.ry; yy += VOX) {
			for (let xx = -p.rx; xx <= p.rx; xx += VOX) {
				const d2 = (xx / p.rx) ** 2 + (yy / p.ry) ** 2;
				if (d2 > 1) continue;
				const edgeHash = h01(xx + 100, yy + 100, seed, pi);
				if (d2 > 0.72 && edgeHash < 0.16 + d2 * 0.12) continue;
				const px = x + p.dx + xx;
				const py = y + p.dy + yy;
				const jitter = (h01(px, py, seed, 31) - 0.5) * 0.07;
				const rel = (yy + p.ry) / (p.ry * 2) + jitter; // 0 top, 1 bottom
				let color;
				if (rel < 0.42) color = "#fff8e8";
				else if (rel < 0.74) color = "#f6e6c9";
				else if (rel < 0.92) color = "#e9c9a2";
				else if (rel < 0.975) color = "#d3a17f";
				else color = "#a87876";
				// warm sun rim on the upper-right shoulder
				if (rel < 0.34 && xx > p.rx * 0.12 && h01(px, py, seed, 7) < 0.26) color = "#ffe6a1";
				// the shaded left flank is warm, never a big brown slab
				if (xx < -p.rx * 0.58 && rel > 0.35 && rel < 0.9) color = "#e9c9a2";
				const zz = z + 8 + 28 * Math.sqrt(Math.max(0, 1 - d2));
				b.add(px, py, zz, color, VOX, VOX, VOX);
			}
		}
	}
	// cauliflower knobs under the base, so the underside is never a flat cut
	for (let i = 0; i < 4; i++) {
		const px = x + (h01(i, seed, 3, 1) - 0.5) * w * 0.66;
		const py = y + h * 0.4 + (h01(i, seed, 4, 1) - 0.5) * 8;
		const r = 9 + h01(i, seed, 5, 1) * 14;
		for (let yy = -r; yy <= r; yy += VOX) {
			for (let xx = -r; xx <= r; xx += VOX) {
				if (xx * xx + yy * yy > r * r) continue;
				if (h01(xx, yy, i, seed) < 0.18) continue;
				const c = h01(xx, yy, i, seed + 1) > 0.7 ? "#e9c9a2" : "#d3a17f";
				b.add(px + xx, py + yy, z + 5, c, VOX, VOX, VOX);
			}
		}
	}
}

function drawPlanet(b, spec) {
	const { x, y, r, z, seed } = spec;
	const ringRx = r * 1.82;
	const ringRy = r * 0.48;
	const ringZ = 34;

	// ring: an annulus of chunky voxels, the lower half in front of the planet
	for (let yy = -ringRy - 8; yy <= ringRy + 8; yy += VOX) {
		for (let xx = -ringRx - 8; xx <= ringRx + 8; xx += VOX) {
			const d = Math.sqrt((xx / ringRx) ** 2 + (yy / ringRy) ** 2);
			if (d < 0.64 || d > 1.02) continue;
			const band = (d - 0.64) / 0.38;
			let color;
			if (band < 0.18) color = "#e4a73f";
			else if (band < 0.34) color = "#fff2d6";
			else if (band < 0.46) color = "#c9852f";
			else if (band < 0.54) color = "#587387";
			else if (band < 0.78) color = "#ffe08a";
			else color = "#e4a73f";
			if (band > 0.3 && band < 0.38 && h01(xx, yy, seed, 3) < 0.45)
				color = "#f7c85f";
			const front = yy > 2;
			b.add(x + xx, y + yy, z + (front ? ringZ : -ringZ), color, VOX, VOX, VOX);
		}
	}

	// planet sphere built as a front-relief disc
	for (let yy = -r; yy <= r; yy += VOX) {
		for (let xx = -r; xx <= r; xx += VOX) {
			const d2 = (xx * xx + yy * yy) / (r * r);
			if (d2 > 1) continue;
			const band = Math.floor((yy + r) / (r * 0.28));
			let color = [
				"#eaf3df",
				"#c6ebdc",
				"#9ad8cd",
				"#e9c9a2",
				"#c6ebdc",
				"#eaf3df",
				"#f6e6c9",
			][band % 7];
			// terminator: lower-left falls into indigo/plum
			if (xx < -r * 0.25 && yy > -r * 0.1)
				color = d2 > 0.65 ? "#72586e" : "#8ea9ae";
			if (xx < -r * 0.55 && yy > r * 0.05) color = "#4c4a72";
			// sunlit upper-right rim
			if (xx > r * 0.35 && yy < 0) color = "#fff3c9";
			if (d2 > 0.9) color = xx < 0 ? "#688596" : "#ffe6a1";
			const zz = z + 10 + 24 * Math.sqrt(Math.max(0, 1 - d2));
			b.add(x + xx, y + yy, zz, color, VOX, VOX, VOX);
		}
	}
}

function drawMoon(b, spec) {
	const { x, y, r, z } = spec;
	for (let yy = -r; yy <= r; yy += VOX) {
		for (let xx = -r; xx <= r; xx += VOX) {
			if (xx * xx + yy * yy > r * r) continue;
			const color = xx + yy > 0 ? "#fff2d6" : "#d2b07c";
			b.add(x + xx, y + yy, z, color, VOX, VOX, VOX);
		}
	}
}

function drawSun(b, spec) {
	const { x, y, r, z } = spec;
	for (let yy = -r; yy <= r; yy += VOX) {
		for (let xx = -r; xx <= r; xx += VOX) {
			const d2 = (xx * xx + yy * yy) / (r * r);
			if (d2 > 1) continue;
			let color;
			if (d2 < 0.4) color = "#fff3c9";
			else if (d2 < 0.7) color = "#ffe6a1";
			else if (d2 < 0.9) color = "#ffd37a";
			else color = "#f6b45b";
			b.add(x + xx, y + yy, z, color, VOX, VOX, VOX);
		}
	}
}

function drawAirship(b, spec) {
	const { x, y, len, h, z, seed, far } = spec;
	const body = far ? ["#c6ebdc", "#9ad8cd"] : ["#fff2d6", "#f3e0bb", "#e4c99b"];
	const edge = far ? "#688596" : "#b98f61";
	const trim = far ? "#e4a73f" : "#f7c85f";
	const step = far ? 4 : VOX;
	const halfLen = len / 2;
	const halfH = h / 2;
	for (let xx = -halfLen; xx <= halfLen; xx += step) {
		const taper = Math.sqrt(Math.max(0, 1 - (xx / halfLen) ** 2));
		const hh = halfH * taper;
		const rows = Math.max(1, Math.round((hh * 2) / step));
		for (let ri = 0; ri < rows; ri++) {
			const yy = -hh + (ri + 0.5) * step;
			const rel = (yy + halfH) / h;
			let color =
				rel < 0.25
					? body[0]
					: rel > 0.75
						? edge
						: pick(body, h01(xx, ri, seed, 1));
			if (Math.abs(xx) < len * 0.06) color = trim;
			if (Math.abs(xx + halfLen * 0.8) < 3) color = trim;
			b.add(x + xx, y + yy, z + 6 + 6 * taper, color, step, step, step);
		}
	}
	// tail fins
	for (let i = 0; i < 4; i++) {
		b.add(x - halfLen - i * 4, y - i * 3, z + 4, trim, 5, 5, 5);
		b.add(x - halfLen - i * 4, y + i * 3, z + 4, edge, 5, 5, 5);
	}
	// gondola
	const gy = y + halfH + 7;
	b.add(x + 2, gy, z + 14, far ? "#688596" : "#9b6a50", 24, 8, 8);
	for (let i = -1; i <= 1; i++) {
		b.add(x + 2 + i * 8, gy + 1, z + 18, far ? "#c6ebdc" : "#ffe08a", 3, 3, 3);
	}
	// propeller
	const px = x + halfLen + 3;
	b.add(px, y, z + 18, "#7f5446", 3, 8, 3);
	b.add(px + 4, y - 6, z + 18, "#d2b07c", 2, 12, 3, 0.55);
	b.add(px + 4, y + 6, z + 18, "#d2b07c", 2, 12, 3, -0.55);
}

function drawFlock(b, spec) {
	const { x, y, n, seed } = spec;
	for (let i = 0; i < n; i++) {
		const px = x + (h01(i, seed, 1, 2) - 0.5) * 120;
		const py = y + (h01(i, seed, 2, 3) - 0.5) * 42;
		const s = 1.0 + h01(i, seed, 3, 4) * 0.65;
		const color = i % 2 ? "#4b657e" : "#587387";
		b.add(px - 4 * s, py - 2 * s, 8, color, 9 * s, 2 * s, 2, 0.5);
		b.add(px + 4 * s, py - 2 * s, 8, color, 9 * s, 2 * s, 2, -0.5);
		b.add(px, py, 8, color, 3 * s, 3 * s, 3);
	}
}

// ---------------------------------------------------------------------------
// far skyline

function drawFarTower(b, spec) {
	const { x, base, top, w, dome, seed } = spec;
	const half = w / 2;
	const bodyH = base - top;
	for (let y = top; y < base; y += VOX) {
		const t = (base - y) / bodyH;
		let hw = half * (0.86 + 0.14 * Math.sin(t * Math.PI * 1.4));
		if (t > 0.95) hw *= 0.7;
		const step = VOX;
		const cols = Math.max(1, Math.round((hw * 2) / step));
		for (let ci = 0; ci < cols; ci++) {
			const px = x - hw + step / 2 + ci * step;
			const nx = (px - x) / hw;
			const z = -10 + 12 * Math.sqrt(Math.max(0, 1 - nx * nx));
			let color = pick(STYLES.far.body, h01(ci, y, seed, 2));
			if (Math.abs(nx) > 0.84) color = STYLES.far.edge;
			if (t > 0.965) color = STYLES.far.light;
			if (y < top + 16 && nx > 0.3) color = "#c6ebdc";
			b.add(px, y + step / 2, z, color, step, step, step);
		}
	}
	// crown
	const crownY = top - 3;
	if (dome === "round") {
		const r = Math.min(w * 0.52, 34);
		for (let yy = -r; yy <= 0; yy += VOX) {
			for (let xx = -r; xx <= r; xx += VOX) {
				if (xx * xx + yy * yy > r * r) continue;
				const color = yy < -r * 0.4 ? "#c6ebdc" : "#8ea9ae";
				b.add(x + xx, crownY + yy, 2, color, VOX, VOX, VOX);
			}
		}
	} else if (dome === "onion") {
		const r = Math.min(w * 0.8, 42);
		const h = r * 1.4;
		for (let yy = 0; yy < h; yy += VOX) {
			const t = yy / h;
			const rr = r * (1 - t) ** 0.6 * (1 + 0.3 * Math.sin(Math.PI * t));
			for (let xx = -rr; xx <= rr; xx += VOX) {
				const nx = rr > 0 ? xx / rr : 0;
				b.add(
					x + xx,
					crownY - yy,
					2 + 6 * Math.sqrt(Math.max(0, 1 - nx * nx)),
					t > 0.8 ? "#c6ebdc" : "#8ea9ae",
					VOX,
					VOX,
					VOX,
				);
			}
		}
	} else if (dome === "spire") {
		for (let i = 0; i < 7; i++) {
			b.add(
				x,
				crownY - i * 5,
				6,
				i < 5 ? "#8ea9ae" : "#c6ebdc",
				Math.max(2, 6 - i),
				6 - i * 0.4,
				5,
			);
		}
	}
	// warm finial ties the far skyline to the cream city
	if (dome === "round" || dome === "onion") {
		const rr = dome === "round" ? Math.min(w * 0.52, 34) : Math.min(w * 0.8, 42) * 1.4;
		b.add(x, crownY - rr - 4, 8, "#e4c99b", 3, 9, 3);
		b.add(x, crownY - rr - 11, 8, "#c6ebdc", 4, 4, 4);
	}
	// a few pale roof-garden tufts to break the box tops
	if (w > 60) {
		for (let i = 0; i < 3; i++) {
			const px = x + (i - 1) * w * 0.22;
			b.add(px, top + 5, 11, "#9ad8cd", 9, 5, 5);
			b.add(px + 2, top + 1, 12, "#c6ebdc", 5, 5, 5);
		}
	}
}

function drawFarDome(b, spec) {
	const { x, base, r, h, seed, minarets } = spec;
	const domeBase = base - h * 0.32;
	const bodyW = r * 2.15;
	// low drum: simple, pale, with a cream cornice
	for (let y = domeBase; y < base; y += VOX) {
		const t = (base - y) / (base - domeBase);
		const hw = (bodyW / 2) * (0.94 + 0.06 * t);
		const cols = Math.max(1, Math.round((hw * 2) / VOX));
		for (let ci = 0; ci < cols; ci++) {
			const px = x - hw + VOX / 2 + ci * VOX;
			const nx = (px - x) / hw;
			let color = pick(["#8ea9ae", "#8ea9ae", "#7b98a3"], h01(ci, y, seed, 1));
			if (Math.abs(nx) > 0.84) color = "#688596";
			if (t > 0.9) color = "#c6ebdc";
			b.add(
				px,
				y + VOX / 2,
				-4 + 10 * Math.sqrt(Math.max(0, 1 - nx * nx)),
				color,
				VOX,
				VOX,
				VOX,
			);
		}
	}
	// a single broad onion dome, not a stack of coloured rings
	const rows = Math.max(6, Math.round(h / VOX));
	for (let ri = 0; ri < rows; ri++) {
		const t = (ri + 0.5) / rows;
		const rr = r * (1 - t) ** 0.56 * (1 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.3)));
		if (rr < 2) continue;
		const y = domeBase - t * h;
		for (let xx = -rr; xx <= rr; xx += VOX) {
			const nx = xx / rr;
			let color = "#8ea9ae";
			if (t > 0.8) color = "#c6ebdc";
			else if (xx > rr * 0.72 && t < 0.72) color = "#9ad8cd";
			b.add(
				x + xx,
				y,
				2 + 16 * Math.sqrt(Math.max(0, 1 - nx * nx)),
				color,
				VOX,
				VOX,
				VOX,
			);
		}
	}
	// brim + finial
	b.add(x, domeBase + 2, 6, "#e4c99b", r * 2.1, 4, 12);
	const top = domeBase - h;
	for (let i = 0; i < 4; i++) {
		b.add(x, top - i * 4, 8, i < 2 ? "#e4c99b" : "#c6ebdc", 5 - i, 5, 5);
	}
	// tall minarets
	if (minarets) {
		for (let side = -1; side <= 1; side += 2) {
			const mx = x + side * (r + 18);
			const mh = h * 1.45;
			for (let y = base - mh; y < base; y += VOX) {
				const t = (y - (base - mh)) / mh;
				const hw = 4 + (1 - t) * 1.5;
				let color = "#8ea9ae";
				if (t < 0.16) color = "#7b98a3";
				if (t > 0.88) color = "#c6ebdc";
				b.add(mx, y + VOX / 2, -2, color, hw * 2, VOX, hw * 2);
				if (Math.abs(t - 0.55) < 0.03) b.add(mx, y, 1, "#c6ebdc", hw * 2 + 3, 3, hw * 2 + 3);
			}
			const capY = base - mh - 2;
			for (let yy = 0; yy < 16; yy += VOX) {
				const rr = 7 * Math.sqrt(Math.max(0, 1 - (yy / 16) ** 2));
				b.add(
					mx,
					capY - yy,
					2,
					yy < 6 ? "#c6ebdc" : "#9ad8cd",
					Math.max(4, rr * 2),
					VOX,
					8,
				);
			}
			b.add(mx, capY - 20, 3, "#e4c99b", 3, 7, 3);
		}
	}
}

function drawFarAqueduct(b, spec) {
	const { x0, x1, yTop, height, arches, seed } = spec;
	const deckH = 7;
	const baseY = yTop + height;
	const span = x1 - x0;
	const pierW = 9;
	const openW = (span - pierW * (arches + 1)) / arches;
	for (let x = x0; x < x1; x += VOX) {
		b.add(x + VOX / 2, yTop, -6, "#9ad8cd", VOX, 4, 8);
		b.add(x + VOX / 2, yTop + deckH / 2 + 2, 0, "#8ea9ae", VOX, deckH, 10);
	}
	for (let k = 0; k <= arches; k++) {
		const px = x0 + k * (pierW + openW) + pierW / 2;
		for (let y = yTop + deckH; y < baseY; y += VOX) {
			b.add(
				px,
				y + VOX / 2,
				2,
				h01(k, y, seed) > 0.7 ? "#7b98a3" : "#8ea9ae",
				pierW,
				VOX,
				9,
			);
		}
	}
	for (let k = 0; k < arches; k++) {
		const start = x0 + pierW + k * (pierW + openW);
		const end = start + openW;
		const mid = (start + end) / 2;
		const rr = openW / 2;
		for (let x = start; x < end; x += VOX) {
			const dx = x + VOX / 2 - mid;
			const bottom =
				yTop + deckH + (rr - Math.sqrt(Math.max(0, rr * rr - dx * dx)));
			for (let y = bottom; y < yTop + deckH; y += VOX) {
				b.add(x + VOX / 2, y + VOX / 2, 4, "#7b98a3", VOX, VOX, 8);
			}
			b.add(x + VOX / 2, bottom + VOX * 0.5, 8, "#c6ebdc", VOX, 3, 3);
		}
	}
}

// ---------------------------------------------------------------------------
// mid city

function drawTower(b, spec) {
	const {
		cx,
		base,
		bodyTop,
		w,
		depth = 20,
		z = 0,
		style,
		taper = 0.1,
		seed,
		dome = null,
		domeR = 0,
		domeH = 0,
		domeStyle = null,
		windows = true,
		balconies = [],
		garden = false,
		porthole = false,
		turbine = false,
		turbineH = 58,
		turbineR = 34,
		vines = false,
	} = spec;
	const st = STYLES[style] ?? STYLES.cream;
	const half = w / 2;
	const bodyH = base - bodyTop;
	const step = VOX;
	const innerDepth = Math.max(10, depth);

	for (let y = bodyTop; y < base; y += step) {
		const t = (base - y) / bodyH;
		let hw = half * (1 - taper * t);
		// a gentle ceramic belly keeps the towers from reading as boxes
		hw *= 1 + 0.055 * Math.sin(Math.PI * Math.min(1, t * 1.08));
		if (t > 0.92) hw *= 0.8 + (0.2 * (1 - t)) / 0.08;
		if (t < 0.055) hw *= 1.07;
		const cols = Math.max(1, Math.round((hw * 2) / step));
		for (let ci = 0; ci < cols; ci++) {
			const px = cx - hw + step / 2 + ci * step;
			const nx = (px - cx) / hw;
			const zf = z + 4 + innerDepth * 0.5 * Math.sqrt(Math.max(0, 1 - nx * nx));
			let color;
			if (Math.abs(nx) > 0.86) color = st.edge;
			else if (t > 0.955) color = st.light;
			else color = pick(st.body, h01(ci, y, seed, 2));
			if (t < 0.18 && t > 0.14 && Math.abs(nx) > 0.55) color = st.dark;
			const bandRow = Math.round((base - y) / step) % 17;
			if (bandRow === 0 && Math.abs(nx) < 0.86 && t < 0.96) color = st.trim;
			// two brass meridian ribs on the wider towers
			if (w > 90 && Math.abs(Math.abs(nx) - 0.57) < 0.045 && t < 0.94)
				color = st.trim;
			b.add(px, y + step / 2, zf, color, step, step, step);
			// a darker second skin gives the silhouette a real thickness
			if (ci % 2 === 0 && depth >= 16) {
				b.add(px, y + step / 2, zf - step * 0.92, st.edge, step, step, step);
			}
		}
	}

	// cornice
	const corniceY = bodyTop - 2;
	b.add(cx, corniceY, z + 6, st.light, w + 14, 8, innerDepth + 12);
	b.add(cx, corniceY + 7, z + 4, st.trim, w + 18, 3, innerDepth + 14);
	if (garden && !dome)
		drawRoofGarden(b, cx, corniceY - 4, w * 0.86, z + 6, seed, st);

	// windows
	if (windows) drawWindows(b, spec, st);

	// porthole
	if (porthole)
		drawPorthole(b, cx, bodyTop + 66, 23, z + 4 + innerDepth * 0.5, st, seed);

	// balconies
	for (let i = 0; i < balconies.length; i++) {
		drawBalcony(b, cx, balconies[i], w, depth, z, st, seed + i * 3, vines);
	}

	// dome
	if (dome)
		drawDome(
			b,
			cx,
			bodyTop - 3,
			domeR,
			domeH,
			z + 2,
			domeStyle ? STYLES[domeStyle] : st,
			dome,
			seed,
		);

	// roof turbine
	if (turbine) {
		const roofY = dome ? bodyTop - domeH - 12 : bodyTop - 8;
		drawTurbine(b, cx - w * 0.2, roofY, turbineH, turbineR, z + 18, seed + 5);
	}
}

function drawWindows(b, spec, st) {
	const { cx, base, bodyTop, w, depth = 20, z = 0, seed } = spec;
	const half = w / 2;
	// Bigger, sparser openings. A grid of tiny squares read as a modern office
	// block; a few brass-silled arches read as ceramic architecture.
	for (let y = bodyTop + 46; y < base - 44; y += 38) {
		const hw = half - 30;
		if (hw < 12) continue;
		for (let px = cx - hw; px <= cx + hw; px += 34) {
			if (h01(px, y, seed, 5) < 0.52) continue;
			const nx = Math.max(-0.9, Math.min(0.9, (px - cx) / half));
			const zf =
				z + 4 + depth * 0.5 * Math.sqrt(Math.max(0, 1 - nx * nx)) + 2.6;
			const quiet = y < 372;
			let color;
			if (quiet) color = h01(px, y, seed, 6) > 0.5 ? "#78c2c7" : "#587387";
			else if (h01(px, y, seed, 7) < 0.16) color = "#ffe08a";
			else color = h01(px, y, seed, 8) > 0.5 ? "#2b6c8b" : "#3b395e";
			b.add(px, y, zf, color, 9, 14, 3);
			if (!quiet) {
				b.add(px, y + 8, zf - 1, st.trim, 12, 2, 2);
				// stepped arch head on some openings
				if (h01(px, y, seed, 9) > 0.55) b.add(px, y - 10, zf, color, 5, 5, 3);
			}
		}
	}
}

function drawPorthole(b, cx, cy, r, z, st, seed) {
	for (let yy = -r; yy <= r; yy += VOX) {
		for (let xx = -r; xx <= r; xx += VOX) {
			const d = Math.sqrt(xx * xx + yy * yy);
			if (d > r) continue;
			let color;
			if (d > r - 5) color = st.trim;
			else if (d > r - 8) color = st.dark;
			else color = xx + yy < -r * 0.35 ? "#66d0cf" : "#2b6c8b";
			if (d < r * 0.45 && xx > 0 && yy < 0) color = "#c6ebdc";
			b.add(cx + xx, cy + yy, z + 2, color, VOX, VOX, 3);
		}
	}
	// cross mullions
	b.add(cx, cy, z + 4, st.trim, r * 2, 2, 2);
	b.add(cx, cy, z + 4, st.trim, 2, r * 2, 2);
}

function drawBalcony(b, cx, y, w, depth, z, st, seed, vines) {
	const bw = w + 20;
	b.add(cx, y, z + depth * 0.5 + 9, st.light, bw, 6, 12);
	b.add(cx, y + 4, z + depth * 0.5 + 10, st.trim, bw + 2, 3, 13);
	for (let x = cx - bw / 2 + 6; x < cx + bw / 2 - 4; x += 16) {
		b.add(x, y - 7, z + depth * 0.5 + 24, st.trim, 3, 11, 3);
		b.add(x, y - 12, z + depth * 0.5 + 24, st.light, 6, 3, 4);
	}
	// planter greenery on the slab
	for (let i = 0; i < 4; i++) {
		const px = cx - bw * 0.4 + i * (bw * 0.26) + (h01(i, seed, 2) - 0.5) * 10;
		const r = 6 + h01(i, seed, 3) * 7;
		for (let yy = -r; yy <= r; yy += VOX) {
			for (let xx = -r; xx <= r; xx += VOX) {
				if (xx * xx + yy * yy > r * r) continue;
				const c = pick(
					["#8dc46f", "#68a963", "#478a58", "#b7d879"],
					h01(xx, yy, i, seed),
				);
				b.add(px + xx, y - 10 + yy, z + depth * 0.5 + 18, c, VOX, VOX, VOX);
			}
		}
		if (h01(i, seed, 7) < 0.45)
			b.add(px, y - r - 8, z + depth * 0.5 + 19, "#f49bb8", 4, 4, 4);
		if (vines && (i === 1 || i === 3))
			drawVine(
				b,
				px,
				y + 4,
				z + depth * 0.5 + 20,
				24 + h01(i, seed, 4) * 28,
				seed + i,
			);
	}
	if (vines && h01(seed, y, 1) < 0.55)
		drawVine(b, cx - bw * 0.46, y + 4, z + depth * 0.5 + 20, 26, seed + 9);
}

function drawVine(b, x, y, z, len, seed) {
	const n = Math.max(2, Math.floor(len / 6));
	for (let i = 0; i < n; i++) {
		const px = x + Math.sin(i * 0.8 + seed) * 4;
		b.add(
			px,
			y + i * 6,
			z,
			pick(["#2f6c4d", "#235342", "#478a58"], h01(i, seed, 1)),
			3,
			6,
			3,
		);
		if (i > 0 && i % 2 === 0) {
			b.add(px + 4, y + i * 6 + 1, z, "#478a58", 5, 3, 3);
			if (h01(i, seed, 3) < 0.22)
				b.add(px + 5, y + i * 6 + 4, z, "#f49bb8", 4, 4, 4);
		}
	}
}

function drawRoofGarden(b, cx, y, w, z, seed, st) {
	b.add(cx, y + 2, z, st.soil, w, 8, 20);
	for (let i = 0; i < 7; i++) {
		const px = cx - w * 0.42 + i * (w * 0.14) + (h01(i, seed, 1) - 0.5) * 8;
		const r = 8 + h01(i, seed, 2) * 12;
		for (let yy = -r; yy <= r; yy += VOX) {
			for (let xx = -r; xx <= r; xx += VOX) {
				if (xx * xx + yy * yy > r * r) continue;
				const c = pick(
					["#8dc46f", "#68a963", "#478a58", "#b7d879", "#2f6c4d"],
					h01(xx, yy, i, seed),
				);
				b.add(px + xx, y - 4 + yy, z + 8, c, VOX, VOX, VOX);
			}
		}
		if (h01(i, seed, 4) < 0.55) b.add(px, y - r - 2, z + 9, "#f49bb8", 4, 4, 4);
		if (h01(i, seed, 5) < 0.3)
			b.add(px + 3, y - r - 6, z + 9, "#ffe08a", 3, 3, 3);
	}
	// trailing vines over the edge
	for (let i = 0; i < 2; i++) {
		const px = cx - w * 0.3 + i * w * 0.6;
		drawVine(b, px, y + 8, z + 12, 20 + h01(i, seed, 6) * 22, seed + i);
	}
}

function drawDome(b, cx, baseY, r, h, z, st, type, seed) {
	const rows = Math.max(4, Math.round(h / VOX));
	for (let ri = 0; ri < rows; ri++) {
		const t = (ri + 0.5) / rows; // 0 base, 1 tip
		let rr;
		if (type === "round") rr = r * Math.sqrt(Math.max(0, 1 - t * t));
		else
			rr =
				r *
				(1 - t) ** 0.58 *
				(1 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.32)));
		if (rr < 2) continue;
		const y = baseY - t * h;
		for (let xx = -rr; xx <= rr; xx += VOX) {
			const nx = xx / rr;
			const zf = z + 8 + 18 * Math.sqrt(Math.max(0, 1 - nx * nx));
			let color;
			if (t < 0.1) color = st.trim;
			else if (t < 0.24) color = st.light;
			else if (t > 0.88) color = st.trim;
			else if (t > 0.56 && t < 0.64) color = st.band;
			else color = pick(st.body, h01(xx, ri, seed, 2));
			// a few meridian ribs
			if (Math.abs(Math.abs(nx) - 0.62) < 0.055 && t > 0.16 && t < 0.9)
				color = st.trim;
			if (r > 55 && Math.abs(Math.abs(nx) - 0.3) < 0.045 && t > 0.12 && t < 0.9)
				color = st.trim;
			b.add(cx + xx, y, zf, color, VOX, VOX, VOX);
		}
	}
	// a grand oculus gives the big civic dome a human scale
	if (r > 55) {
		const oy = baseY - h * 0.42;
		const orr = Math.min(18, r * 0.25);
		for (let yy = -orr; yy <= orr; yy += VOX) {
			for (let xx = -orr; xx <= orr; xx += VOX) {
				const d = Math.sqrt(xx * xx + yy * yy);
				if (d > orr) continue;
				let color;
				if (d > orr - 4) color = st.trim;
				else if (d > orr - 7) color = st.dark;
				else color = xx + yy < -orr * 0.3 ? "#66d0cf" : "#2b6c8b";
				b.add(cx + xx, oy + yy, z + 29, color, VOX, VOX, 3);
			}
		}
		b.add(cx, oy, z + 31, st.trim, orr * 2, 2, 2);
	}
	// base ring
	b.add(cx, baseY, z + 10, st.trim, r * 2 + 12, 5, 18);
	b.add(cx, baseY - 5, z + 10, st.light, r * 2 + 6, 4, 16);
	// finial
	const fy = baseY - h;
	const finial = type === "round" ? 10 : 16;
	for (let i = 0; i < 5; i++) {
		b.add(cx, fy - i * 4, z + 8, i < 3 ? st.trim : st.band, 7 - i, 5, 6);
	}
	b.add(cx, fy - finial, z + 8, st.light, 3, 8, 3);
	// a little orb + crescent
	b.add(cx, fy - finial - 5, z + 8, st.band, 6, 6, 6);
}

function drawTurbine(b, x, yBase, h, r, z, seed) {
	const topY = yBase - h;
	const thick = r > 40 ? 6 : 4;
	const poleW = r > 40 ? 6 : 4;
	for (let y = topY; y < yBase; y += 6) {
		b.add(x, y, z, y < topY + h * 0.4 ? "#f3e0bb" : "#e4c99b", poleW, 6, poleW);
	}
	b.add(x + 2, topY + 6, z - 1, "#d2b07c", 3, h * 0.6, 3);
	b.add(x, yBase - 4, z + 2, "#9b6a50", 12, 8, 12);
	b.add(x, topY - 2, z + 2, "#fff2d6", 16, 8, 8);
	b.add(x, topY - 1, z + 8, "#f7c85f", 6, 6, 4);
	const hub = { x: x, y: topY - 2 };
	for (let k = 0; k < 3; k++) {
		const a = k * ((Math.PI * 2) / 3) + 0.5 + h01(seed, k, 1) * 0.1;
		const len = r;
		const px = hub.x - Math.sin(a) * len * 0.5;
		const py = hub.y - Math.cos(a) * len * 0.5;
		b.add(px, py, z + 4, "#fff2d6", thick, len, thick, a);
		b.add(
			hub.x - Math.sin(a) * len * 0.92,
			hub.y - Math.cos(a) * len * 0.92,
			z + 4,
			"#f7c85f",
			5,
			8,
			5,
			a,
		);
	}
}

function drawPavilion(b, spec) {
	drawTower(b, {
		...spec,
		taper: 0.03,
		windows: false,
		balconies: [],
		vines: false,
		porthole: false,
		turbine: false,
		style: spec.style ?? "stone",
	});
}

function drawSolarArray(b, spec) {
	const { x, y, w, z, seed } = spec;
	const cols = Math.max(3, Math.floor(w / 9));
	const rows = 2;
	for (let r = 0; r < rows; r++) {
		for (let i = 0; i < cols; i++) {
			const px = x + i * 9 + r * 7;
			const py = y + r * 13 + Math.floor(i / 3) * 4;
			b.add(
				px,
				py,
				z + 8,
				h01(i, r, seed) > 0.5 ? "#2b6c8b" : "#244f7d",
				8,
				5,
				5,
			);
			if (i % 3 === 0) b.add(px, py - 2, z + 9, "#66d0cf", 8, 2, 4);
			b.add(px, py + 3, z + 7, "#c9852f", 8, 1, 4);
		}
	}
	// legs
	b.add(x + w * 0.2, y + 26, z + 4, "#9b6a50", 4, 18, 4);
	b.add(x + w * 0.7, y + 28, z + 4, "#9b6a50", 4, 18, 4);
}

function drawPool(b, spec) {
	const { x, y, rx, ry, z, seed } = spec;
	for (let yy = -ry; yy <= ry; yy += VOX) {
		for (let xx = -rx; xx <= rx; xx += VOX) {
			if ((xx / rx) ** 2 + (yy / ry) ** 2 > 1) continue;
			const d = Math.sqrt((xx / rx) ** 2 + (yy / ry) ** 2);
			let color;
			if (d > 0.92) color = h01(xx, yy, seed, 3) > 0.5 ? "#d2b07c" : "#e4c99b";
			else if (d > 0.84) color = "#fff2d6";
			else if (d > 0.76) color = "#effff4";
			else if (yy < -2) color = "#effff4";
			else if (h01(xx, yy, seed) < 0.12) color = "#effff4";
			else color = h01(xx, yy, seed, 2) > 0.4 ? "#66d0cf" : "#96e8dc";
			b.add(x + xx, y + yy, z + 4, color, VOX, 4, VOX);
		}
	}
	// stone lip and foam
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * Math.PI * 2;
		b.add(
			x + Math.cos(a) * rx * 0.96,
			y + Math.sin(a) * ry * 0.98,
			z + 8,
			i % 3 === 0 ? "#b9855e" : "#e4c99b",
			6,
			4,
			6,
		);
	}
	// splash where the falls hits the pool, clear of the 48 px fall itself
	for (let i = 0; i < 9; i++) {
		const side = i % 2 ? 1 : -1;
		b.add(
			x + side * (24 + h01(i, seed, 4) * 18),
			y - 3 - h01(i, seed, 5) * 8,
			z + 12,
			i % 3 === 0 ? "#effff4" : "#c8f7ec",
			4 + h01(i, seed, 6) * 3,
			3,
			4,
		);
	}
	// lily pads and a lotus
	for (let i = 0; i < 3; i++) {
		const px = x + (i - 1) * 26 + 8;
		const py = y + (i % 2 ? 7 : -4);
		for (let yy = -5; yy <= 5; yy += VOX) {
			for (let xx = -9; xx <= 9; xx += VOX) {
				if ((xx / 9) ** 2 + (yy / 5) ** 2 > 1) continue;
				b.add(px + xx, py + yy, z + 11, i === 1 ? "#478a58" : "#68a963", VOX, 3, VOX);
			}
		}
		if (i === 1) b.add(px + 2, py - 2, z + 14, "#f49bb8", 5, 5, 5);
	}
}

function drawCanal(b, spec) {
	const { x0, x1, y, z, seed } = spec;
	for (let x = x0; x < x1; x += VOX) {
		const wobble = Math.sin(x * 0.06 + seed) * 1.5;
		b.add(
			x + VOX / 2,
			y + wobble,
			z + 4,
			h01(x, seed, 1) > 0.7 ? "#effff4" : "#66d0cf",
			VOX,
			5,
			5,
		);
		b.add(x + VOX / 2, y - 4 + wobble, z + 3, "#96e8dc", VOX, 2, 4);
		b.add(x + VOX / 2, y + 4 + wobble, z + 2, "#9b6a50", VOX, 4, 6);
		b.add(x + VOX / 2, y - 6 + wobble, z + 2, "#b9855e", VOX, 3, 5);
		if (h01(x, seed, 2) < 0.12)
			b.add(x + VOX / 2, y - 6, z + 8, "#effff4", 4, 3, 4);
	}
}

function drawAqueduct(b, spec) {
	const { x0, x1, yTop, height, arches, z, style, mouth, seed } = spec;
	const st = STYLES[style] ?? STYLES.cream;
	const deckH = 10;
	const deckBottom = yTop + deckH;
	const baseY = yTop + height;
	const span = x1 - x0;
	const pierW = 11;
	const openW = (span - pierW * (arches + 1)) / arches;

	// channel water + deck
	for (let x = x0; x < x1; x += VOX) {
		b.add(
			x + VOX / 2,
			yTop - 3,
			z + 5,
			h01(x, seed, 1) > 0.3 ? "#66d0cf" : "#96e8dc",
			VOX,
			5,
			7,
		);
		b.add(x + VOX / 2, yTop + 2, z + 2, st.light, VOX, 5, 14);
		b.add(x + VOX / 2, yTop + deckH - 1, z + 2, st.dark, VOX, 3, 15);
		b.add(x + VOX / 2, yTop + deckH + 1.5, z + 4, st.trim, VOX, 2, 12);
	}
	// piers
	for (let k = 0; k <= arches; k++) {
		const px = x0 + k * (pierW + openW) + pierW / 2;
		for (let y = deckBottom; y < baseY; y += VOX) {
			const c =
				Math.round((baseY - y) / VOX) % 9 === 0
					? st.trim
					: pick(st.body, h01(k, y, seed, 2));
			b.add(px, y + VOX / 2, z, c, pierW, VOX, 14);
			b.add(px, y + VOX / 2, z - 5, st.dark, pierW, VOX, 5);
		}
		b.add(px, baseY, z + 2, st.dark, pierW + 12, 6, 18);
	}
	// spandrels and arch rims
	for (let k = 0; k < arches; k++) {
		const start = x0 + pierW + k * (pierW + openW);
		const end = start + openW;
		const mid = (start + end) / 2;
		const rr = openW / 2;
		for (let x = start; x < end; x += VOX) {
			const dx = x + VOX / 2 - mid;
			const arch = Math.sqrt(Math.max(0, rr * rr - dx * dx));
			const bottom = deckBottom + (rr - arch);
			for (let y = bottom; y < deckBottom; y += VOX) {
				b.add(
					x + VOX / 2,
					y + VOX / 2,
					z,
					pick(st.body, h01(x, y, seed, 3)),
					VOX,
					VOX,
					12,
				);
			}
			b.add(x + VOX / 2, bottom, z + 4, st.light, VOX, 3, 5);
			b.add(x + VOX / 2, bottom + 4, z + 3, st.trim, VOX, 2, 5);
		}
		// corbel / keystone
		b.add(mid, deckBottom + 3, z + 8, st.trim, 7, 8, 4);
	}
	// mouth spout where the animated fall is attached
	if (mouth !== null) {
		const f = FALLS[mouth];
		const spoutX = f.u + 24;
		b.add(spoutX, f.v - 7, z + 14, st.trim, 56, 7, 10);
		b.add(spoutX, f.v - 3, z + 17, "#2f8ba8", 44, 5, 4);
		b.add(spoutX, f.v - 10, z + 16, "#ffe08a", 52, 3, 8);
		// brackets
		b.add(spoutX - 30, f.v - 1, z + 10, st.dark, 6, 12, 6);
		b.add(spoutX + 30, f.v - 1, z + 10, st.dark, 6, 12, 6);
	}
	// vines and moss on the channel
	for (let i = 0; i < Math.max(2, Math.floor(span / 90)); i++) {
		const vx = x0 + 20 + i * 83;
		drawVine(
			b,
			vx,
			deckBottom + 8,
			z + 10,
			18 + h01(i, seed, 6) * 26,
			seed + i,
		);
	}
}

function drawBridge(b, spec) {
	const { x0, x1, yTop, height, z, seed } = spec;
	const st = STYLES.stone;
	const span = x1 - x0;
	const rr = span / 2;
	// deck: a gentle curve, higher at the middle
	for (let x = x0; x < x1; x += VOX) {
		const t = (x - x0) / span;
		const y = yTop - Math.sin(t * Math.PI) * 10;
		b.add(x + VOX / 2, y, z, "#e4c99b", VOX, 6, 14);
		b.add(x + VOX / 2, y + 3, z + 2, "#7f5446", VOX, 3, 12);
		b.add(x + VOX / 2, y - 4, z + 5, "#f7c85f", VOX, 2, 5);
		if (Math.round((x - x0) / VOX) % 3 === 0) {
			b.add(x + VOX / 2, y - 10, z + 12, "#fff2d6", 3, 10, 3);
		}
	}
	// arch underside
	for (let x = x0; x < x1; x += VOX) {
		const dx = x + VOX / 2 - (x0 + x1) / 2;
		const open = Math.sqrt(Math.max(0, rr * rr - dx * dx));
		const bottom = yTop + height - (rr - open);
		for (let y = bottom; y < yTop; y += VOX) {
			b.add(x + VOX / 2, y, z, pick(st.body, h01(x, y, seed, 2)), VOX, VOX, 10);
		}
		if (Math.round((x - x0) / VOX) % 2 === 0)
			b.add(x + VOX / 2, bottom, z + 4, "#e4c99b", VOX, 3, 4);
		b.add(x + VOX / 2, bottom + 3, z + 2, "#9b6a50", VOX, 3, 5);
	}
	// planters on the bridge
	for (let i = 0; i < 4; i++) {
		const px = x0 + span * (0.18 + i * 0.2);
		const t = (px - x0) / span;
		const y = yTop - Math.sin(t * Math.PI) * 10;
		b.add(px, y - 8, z + 10, "#9b6a50", 12, 6, 8);
		b.add(px, y - 14, z + 12, "#68a963", 14, 8, 8);
		b.add(px + 4, y - 18, z + 14, "#f49bb8", 4, 4, 4);
		drawVine(b, px, y + 4, z + 14, 18, seed + i);
	}
}

// ---------------------------------------------------------------------------
// trees

function drawCanopyBlob(b, cx, cy, rx, ry, z, seed, blossom = false) {
	for (let yy = -ry; yy <= ry; yy += VOX) {
		for (let xx = -rx; xx <= rx; xx += VOX) {
			const d2 = (xx / rx) ** 2 + (yy / ry) ** 2;
			if (d2 > 1) continue;
			if (d2 > 0.68 && h01(xx, yy, seed, 1) < 0.1 + (d2 - 0.68) * 0.55)
				continue;
			const rel = (yy + ry) / (ry * 2); // 0 top, 1 bottom
			const rr = h01(xx, yy, seed, 3);
			let color;
			if (rel < 0.16) color = rr < 0.74 ? "#d7e98c" : "#b7d879";
			else if (rel < 0.4) color = rr < 0.68 ? "#b7d879" : "#8dc46f";
			else if (rel < 0.66) color = rr < 0.7 ? "#8dc46f" : "#68a963";
			else if (rel < 0.88) color = rr < 0.6 ? "#68a963" : "#478a58";
			else color = rr < 0.55 ? "#2f6c4d" : "#235342";
			// a flowering tree keeps its green underside and breaks into blossom
			if (blossom && rel < 0.72 && h01(xx, yy, seed, 30) < 0.3) {
				color =
					rel < 0.28
						? pick(["#ffd2e0", "#f49bb8", "#fff3c9"], rr)
						: pick(["#f49bb8", "#e66d97", "#ffd2e0"], rr);
			}
			// warm sunlit rim on the upper-right quadrant
			if (rel < 0.24 && xx > rx * 0.25 && h01(xx, yy, seed, 7) < 0.16) color = "#d7e98c";
			const zz = z + 8 + 34 * Math.sqrt(Math.max(0, 1 - d2));
			b.add(cx + xx, cy + yy, zz, color, VOX, VOX, VOX);
			// occasional flower / fruit
			if (h01(xx, yy, seed, 8) < 0.014 && rel > 0.1 && rel < 0.72) {
				b.add(
					cx + xx,
					cy + yy,
					zz + 3,
					h01(xx, yy, seed, 9) > 0.5 ? "#f49bb8" : "#ffd2e0",
					4,
					4,
					4,
				);
			}
			if (h01(xx, yy, seed, 10) < 0.008 && rel > 0.2 && rel < 0.62) {
				b.add(cx + xx, cy + yy, zz + 3, "#ff8a4c", 3, 3, 3);
			}
		}
	}
	// little leaf sprigs just outside the rim break the billiard-ball edge
	for (let i = 0; i < 7; i++) {
		const a = (i / 7) * Math.PI * 2 + h01(i, seed, 11) * 0.7;
		const px = cx + Math.cos(a) * rx * (0.95 + h01(i, seed, 12) * 0.12);
		const py = cy + Math.sin(a) * ry * (0.95 + h01(i, seed, 13) * 0.12);
		for (let k = 0; k < 3; k++) {
			const qx = px + (h01(i, k, seed, 14) - 0.5) * 9;
			const qy = py + (h01(i, k, seed, 15) - 0.5) * 9;
			b.add(qx, qy, z + 20, k === 0 ? "#b7d879" : "#8dc46f", 5, 5, 5);
		}
	}
}

function drawTree(b, spec) {
	const { x, base, height, spread, z, seed, scale = 1, blossom = false } = spec;
	const topY = base - height;
	const trunkTop = base - height * 0.54;

	// Trunk: a leaning, tapering column with a pale sunlit edge and dark bark.
	const rows = Math.floor((base - trunkTop) / VOX);
	for (let i = 0; i < rows; i++) {
		const t = i / Math.max(1, rows - 1); // 0 base, 1 top
		const cy = base - (i + 0.5) * VOX;
		const cxx = x + Math.sin(t * 2.1 + seed) * 12 * scale + t * 8 * scale;
		let hw = (34 - 21 * t) * scale;
		if (t < 0.16) hw *= 1.12;
		const cols = Math.max(2, Math.round((hw * 2) / VOX));
		for (let ci = 0; ci < cols; ci++) {
			const px = cxx - hw + VOX / 2 + ci * VOX;
			const nx = (px - cxx) / hw;
			let color = pick(["#b9855e", "#9b6a50", "#b9855e"], h01(ci, i, seed, 1));
			if (nx < -0.55) color = "#d2b07c";
			if (nx > 0.62) color = "#7f5446";
			if (Math.abs(nx) < 0.12 && i % 3 === 0) color = "#d2b07c";
			if (i % 9 === 0) color = "#9b6a50";
			b.add(
				px,
				cy,
				z + 12 + 12 * Math.sqrt(Math.max(0, 1 - nx * nx)),
				color,
				VOX,
				VOX,
				VOX,
			);
		}
	}

	// Buttress roots: stepped wedges spilling left and right.
	for (let side = -1; side <= 1; side += 2) {
		for (let i = 0; i < 7; i++) {
			const px = x + side * (30 + i * 7) * scale;
			const py = base - 2 - i * 2.4;
			const h = (10 - i * 0.7) * scale;
			b.add(px, py, z + 16, i % 2 ? "#9b6a50" : "#7f5446", 9, h, 13);
		}
	}

	// Branches: five visible limbs holding the canopy up.
	const branchEnds = [
		{ x: x - spread * 0.76, y: topY + 112, thick: 9 },
		{ x: x + spread * 0.74, y: topY + 102, thick: 10 },
		{ x: x - spread * 0.5, y: topY + 52, thick: 8 },
		{ x: x + spread * 0.48, y: topY + 44, thick: 8 },
		{ x: x + spread * 0.52, y: topY + 184, thick: 7 },
		{ x: x - spread * 0.52, y: topY + 180, thick: 7 },
	];
	for (let bi = 0; bi < branchEnds.length; bi++) {
		const end = branchEnds[bi];
		const sx = x + (bi % 2 ? 6 : -6);
		const sy = trunkTop + 16 + bi * 15;
		const cx1 = (sx + end.x) / 2 + (bi % 2 ? 28 : -28) * scale;
		const cy1 = (sy + end.y) / 2 - 12;
		const steps = 20;
		for (let s = 0; s < steps; s++) {
			const t = s / (steps - 1);
			const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx1 + t * t * end.x;
			const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy1 + t * t * end.y;
			const thick = (end.thick - 4 * t) * scale;
			const color =
				s % 4 === 0 ? "#b9855e" : s % 4 === 1 ? "#9b6a50" : "#7f5446";
			b.add(px, py, z + 22 + 10 * (1 - t), color, thick, thick, thick);
		}
	}

	// Canopy: a wide umbrella of overlapping lobes, not one round ball.
	const s = scale;
	const blobs = [
		{ x: x + 6, y: topY + 38, rx: 96, ry: 54 },
		{ x: x - spread * 0.62, y: topY + 108, rx: 74, ry: 46 },
		{ x: x + spread * 0.64, y: topY + 98, rx: 84, ry: 50 },
		{ x: x - spread * 0.42, y: topY + 172, rx: 68, ry: 42 },
		{ x: x + spread * 0.48, y: topY + 180, rx: 72, ry: 44 },
		{ x: x + 4, y: topY + 142, rx: 80, ry: 46 },
	];
	for (let i = 0; i < blobs.length; i++) {
		const bl = blobs[i];
		drawCanopyBlob(
			b,
			bl.x,
			bl.y,
			bl.rx * s,
			bl.ry * s,
			z + i * 5,
			seed + i * 7,
			blossom,
		);
	}
	// top sprigs break the crown into a few distinct peaks
	for (let i = 0; i < 4; i++) {
		const bx = x - spread * 0.3 + i * spread * 0.2;
		const by = topY + 18 - h01(i, seed, 20) * 14;
		drawCanopyBlob(
			b,
			bx,
			by,
			(24 + h01(i, seed, 21) * 14) * s,
			(18 + h01(i, seed, 22) * 10) * s,
			z + 40,
			seed + 40 + i,
			blossom,
		);
	}

	// Aerial roots: the banyan signature — thin strands hanging out of the crown.
	for (let i = 0; i < 6; i++) {
		const rx = x - spread * 0.5 + i * spread * 0.2;
		const ry = topY + 190 + h01(i, seed, 23) * 50;
		const len = 40 + h01(i, seed, 24) * 80;
		for (let k = 0; k < len / 6; k++) {
			b.add(
				rx + Math.sin(k * 0.7 + i) * 3,
				ry + k * 6,
				z + 24,
				k % 2 ? "#9b6a50" : "#b9855e",
				3,
				6,
				3,
			);
			if (k % 3 === 0 && k > 2)
				b.add(rx + 3, ry + k * 6, z + 25, "#478a58", 4, 4, 4);
		}
	}

	// vines and flowers off the lower canopy
	for (let i = 0; i < 7; i++) {
		const vx = x - spread * 0.55 + i * spread * 0.18;
		const vy = topY + 180 + h01(i, seed, 2) * 45;
		drawVine(b, vx, vy, z + 38, 30 + h01(i, seed, 3) * 55, seed + i);
	}
}

// ---------------------------------------------------------------------------
// near layer

function drawLeaf(b, spec) {
	const { x, y, angle, len, wid, z, seed } = spec;
	const ca = Math.cos(angle);
	const sa = Math.sin(angle);
	const step = 6;
	const baseX = x - ca * len * 0.5;
	const baseY = y - sa * len * 0.5;
	// stem
	for (let s = 0; s < len * 0.3; s += step) {
		b.add(baseX + ca * s, baseY + sa * s, z - 2, "#2f6c4d", 4, 4, 4);
	}
	for (let u = -len * 0.5; u <= len * 0.5; u += step) {
		const t = u / (len * 0.5);
		const taper = Math.max(0, 1 - t * t) ** 0.62;
		const half = wid * 0.5 * taper;
		if (half < 2) continue;
		for (let v = -half; v <= half; v += step) {
			// a couple of leaf slits, monstera-style
			if (
				Math.abs(t) > 0.2 &&
				Math.abs(t) < 0.85 &&
				Math.abs(v) < half * 0.4 &&
				Math.floor((t + 1) * 6) % 3 === 0
			)
				continue;
			const px = x + ca * u - sa * v;
			const py = y + sa * u + ca * v;
			const edge = Math.abs(v) > half - step * 1.1;
			const rib = Math.abs(v) < step * 0.9;
			let color;
			if (rib) color = "#68a963";
			else if (edge) color = "#478a58";
			else
				color = pick(["#2f6c4d", "#235342", "#2f6c4d"], h01(px, py, seed, 2));
			if (t < -0.2 && u < 0 && v > 0) color = "#478a58";
			// radial side veins
			if (
				!rib &&
				Math.floor((u + len * 0.5) / (step * 3)) % 4 === 0 &&
				Math.abs(v) < half * 0.72
			)
				color = "#478a58";
			b.add(px, py, z + Math.abs(v) * 0.04, color, step + 0.5, step + 0.5, 6);
		}
	}
	// highlight along the sunward edge
	for (let u = -len * 0.35; u <= len * 0.35; u += step * 2) {
		const t = u / (len * 0.5);
		const half = wid * 0.5 * Math.max(0, 1 - t * t) ** 0.62;
		b.add(
			x + ca * u - sa * (half - 2),
			y + sa * u + ca * (half - 2),
			z + 2,
			"#68a963",
			5,
			5,
			5,
		);
	}
}

function drawFern(b, spec) {
	const { x, y, scale, z, seed, angle } = spec;
	const n = 7;
	for (let i = 0; i < n; i++) {
		const a = angle + (i / (n - 1) - 0.5) * 2.3;
		const len = (92 + h01(i, seed, 1) * 40) * scale;
		const wid = (22 + h01(i, seed, 2) * 12) * scale;
		drawLeaf(b, {
			x: x + Math.cos(a) * len * 0.42,
			y: y + Math.sin(a) * len * 0.42,
			angle: a,
			len,
			wid,
			z: z + i * 2,
			seed: seed + i,
		});
	}
	// little flowers at the base
	for (let i = 0; i < 4; i++) {
		b.add(
			x + (h01(i, seed, 3) - 0.5) * 60 * scale,
			y - 12 - h01(i, seed, 4) * 40,
			z + 26,
			i % 2 ? "#f49bb8" : "#ffd2e0",
			5,
			5,
			5,
		);
	}
}

function drawPlanter(b, spec) {
	const { x, y, w, z, seed } = spec;
	const st = STYLES.stone;
	b.add(x, y, z, "#7f5446", w, 22, 22);
	b.add(x, y - 8, z + 4, "#9b6a50", w + 6, 6, 24);
	b.add(x, y - 13, z + 6, "#e4c99b", w + 10, 4, 24);
	b.add(x, y - 2, z + 12, "#f7c85f", w - 10, 2, 2);
	// soil and bushes
	b.add(x, y - 16, z + 8, "#7f5446", w - 8, 5, 18);
	const n = Math.max(3, Math.floor(w / 34));
	for (let i = 0; i < n; i++) {
		const px = x - w * 0.4 + ((i + 0.5) * (w * 0.8)) / n;
		const r = 14 + h01(i, seed, 1) * 14;
		for (let yy = -r; yy <= r; yy += VOX) {
			for (let xx = -r; xx <= r; xx += VOX) {
				if (xx * xx + yy * yy > r * r) continue;
				const c = pick(
					["#2f6c4d", "#478a58", "#68a963", "#235342"],
					h01(xx, yy, i, seed),
				);
				b.add(px + xx, y - 20 + yy, z + 16, c, VOX, VOX, VOX);
			}
		}
		if (h01(i, seed, 2) < 0.8) {
			b.add(px - 6, y - 34, z + 18, "#f49bb8", 4, 4, 4);
			b.add(px + 7, y - 37, z + 18, "#ffd2e0", 4, 4, 4);
		}
		drawVine(b, px, y + 4, z + 18, 30 + h01(i, seed, 3) * 40, seed + i);
	}
}

function drawForegroundRoof(b, spec) {
	const { x0, x1, y, z, seed } = spec;
	const w = x1 - x0;
	// The near layer carries the darkest values in the picture: a foreground
	// parapet, not another cream building.
	b.add((x0 + x1) / 2, y + 12, z, "#7f5446", w, 24, 20);
	b.add((x0 + x1) / 2, y, z + 4, "#9b6a50", w + 6, 6, 22);
	b.add((x0 + x1) / 2, y - 4, z + 8, "#c9852f", w + 2, 3, 18);
	// parapet posts
	for (let x = x0 + 8; x < x1 - 4; x += 34) {
		b.add(x, y - 11, z + 12, "#b9855e", 4, 14, 4);
	}
	// bushes along the top
	for (let i = 0; i < Math.max(2, Math.floor(w / 70)); i++) {
		const px = x0 + 30 + i * 68;
		const r = 16 + h01(i, seed, 1) * 12;
		for (let yy = -r; yy <= r; yy += VOX) {
			for (let xx = -r; xx <= r; xx += VOX) {
				if (xx * xx + yy * yy > r * r) continue;
				const c = pick(
					["#235342", "#2f6c4d", "#478a58", "#2f6c4d"],
					h01(xx, yy, i, seed),
				);
				b.add(px + xx, y - 18 + yy, z + 18, c, VOX, VOX, VOX);
			}
		}
		if (h01(i, seed, 2) < 0.6) b.add(px, y - 34, z + 20, "#f49bb8", 5, 5, 5);
		drawVine(b, px + 10, y + 2, z + 20, 26, seed + i);
	}
}

function drawRailing(b, spec) {
	const { x0, x1, y, z, seed } = spec;
	const w = x1 - x0;
	b.add((x0 + x1) / 2, y, z, "#7f5446", w, 6, 8);
	b.add((x0 + x1) / 2, y - 4, z + 2, "#9b6a50", w, 4, 9);
	for (let x = x0 + 8; x < x1 - 4; x += 32) {
		b.add(x, y - 13, z + 4, "#b9855e", 4, 22, 4);
		b.add(x, y - 23, z + 6, "#f3e0bb", 7, 4, 5);
	}
	for (let x = x0 + 24; x < x1 - 20; x += 96) {
		drawVine(b, x, y + 2, z + 7, 24 + h01(x, seed, 1) * 34, seed + x);
		if (h01(x, seed, 2) < 0.6) b.add(x + 4, y - 28, z + 7, "#f49bb8", 5, 5, 5);
	}
}

function drawLantern(b, spec) {
	const { x, y, z, seed } = spec;
	b.add(x, y, z, "#9b6a50", 4, 30, 4);
	b.add(x, y - 17, z + 2, "#f7c85f", 12, 4, 8);
	b.add(x, y - 8, z + 4, "#ffe08a", 10, 12, 10);
	b.add(x, y - 2, z + 4, "#e4a73f", 8, 3, 8);
	b.add(x + 8, y - 18, z, "#478a58", 6, 6, 6);
	if (h01(seed, 1, 2) < 0.8) drawVine(b, x + 12, y - 14, z + 2, 22, seed);
}

function drawWaterwheel(b, spec) {
	const { x, y, r, z, seed } = spec;
	// support beam from the bridge into the hub
	b.add(x + 20, y + 2, z - 6, "#7f5446", 42, 6, 6, -0.45);
	b.add(x + 34, y + 20, z - 6, "#9b6a50", 9, 34, 9);
	// rim
	for (let i = 0; i < 30; i++) {
		const a = (i / 30) * Math.PI * 2;
		const px = x + Math.cos(a) * r;
		const py = y + Math.sin(a) * r;
		const under = Math.sin(a) > 0.25;
		b.add(
			px,
			py,
			z,
			under ? "#2f8ba8" : i % 3 === 0 ? "#f7c85f" : "#b9855e",
			5,
			5,
			6,
		);
	}
	// spokes
	for (let k = 0; k < 6; k++) {
		const a = (k / 6) * Math.PI * 2 + 0.3;
		b.add(
			x + Math.cos(a) * r * 0.45,
			y + Math.sin(a) * r * 0.45,
			z + 1,
			"#9b6a50",
			4,
			r * 0.85,
			4,
			a - Math.PI / 2,
		);
	}
	// paddles
	for (let k = 0; k < 8; k++) {
		const a = (k / 8) * Math.PI * 2;
		b.add(
			x + Math.cos(a) * (r + 3),
			y + Math.sin(a) * (r + 3),
			z + 2,
			Math.sin(a) > 0.3 ? "#2f6c4d" : "#f3e0bb",
			12,
			6,
			5,
			a + Math.PI / 2,
		);
	}
	// hub + foam
	b.add(x, y, z + 6, "#f7c85f", 9, 9, 6);
	b.add(x, y, z + 9, "#e4a73f", 4, 4, 4);
	for (let i = 0; i < 6; i++) {
		b.add(
			x - 14 + h01(i, seed, 1) * 30,
			y + r - 4 + h01(i, seed, 2) * 8,
			z + 8,
			i % 2 ? "#effff4" : "#c8f7ec",
			4,
			3,
			4,
		);
	}
}

// ---------------------------------------------------------------------------
// layer assembly

export function buildLayer(name, layout) {
	const b = new Builder(name);
	if (name === "sky") {
		drawPlanet(b, layout.sky.planet);
		drawMoon(b, layout.sky.moon);
		drawSun(b, layout.sky.sun);
		for (const c of layout.sky.clouds) drawCloud(b, c);
		for (const a of layout.sky.airships) drawAirship(b, a);
		for (const f of layout.sky.flocks) drawFlock(b, f);
	} else if (name === "far") {
		for (const t of layout.far.towers) drawFarTower(b, t);
		for (const d of layout.far.domes) drawFarDome(b, d);
		for (const a of layout.far.aqueducts) drawFarAqueduct(b, a);
	} else if (name === "mid") {
		for (const t of layout.mid.towers) drawTower(b, t);
		for (const t of layout.mid.pavilions) drawPavilion(b, t);
		for (const t of layout.mid.trees) drawTree(b, t);
		for (const a of layout.mid.aqueducts) drawAqueduct(b, a);
		for (const br of layout.mid.bridges) drawBridge(b, br);
		for (const p of layout.mid.pools) drawPool(b, p);
		for (const w of layout.mid.waterwheels) drawWaterwheel(b, w);
		for (const c of layout.mid.canals) drawCanal(b, c);
		for (const s of layout.mid.solar) drawSolarArray(b, s);
		for (const t of layout.mid.turbines) drawTurbine(b, t.x, t.y, t.h, t.r, t.z, t.seed);
	} else if (name === "near") {
		for (const f of layout.near.ferns) drawFern(b, f);
		for (const l of layout.near.leaves) drawLeaf(b, l);
		for (const p of layout.near.planters) drawPlanter(b, p);
		for (const r of layout.near.rooftops) drawForegroundRoof(b, r);
		for (const r of layout.near.rails) drawRailing(b, r);
		for (const l of layout.near.lanterns) drawLantern(b, l);
	} else {
		throw new Error(`unknown skybox layer ${name}`);
	}
	return b.finish();
}

export function fallsSpec() {
	return FALLS;
}
