/**
 * The backdrop a themed map wears: a castle at dusk, open meadow, snowy peaks.
 *
 * The Waterfront is a hand-painted panorama; the map maker's other themes are
 * drawn here from code instead, because a theme has to exist the moment a
 * player picks it, and a painted panorama per theme is a commission rather
 * than a feature. Each theme is a sky gradient and two silhouette layers at
 * different parallax depths, plus one ambient motion (drifting clouds, falling
 * snow, the castle's stars). Same contract as `Skybox`: a child of
 * `Stage.background`, positioned against the camera every frame.
 *
 * **Readability is the same rule the Waterfront follows**: the backdrop is
 * desaturated, blurred and value-compressed toward the sky so the fighters and
 * the (saturated, dark) platforms are the high-contrast band. Silhouettes are
 * drawn in sky-adjacent colours — never darker than the platforms' faces.
 */

import { BlurFilter, ColorMatrixFilter, Container, Graphics } from "pixi.js";
import type { MapTheme } from "../simulation/Tilemap";
import { Skybox, type SkyboxDebugState } from "./Skybox";
import { skyboxChoice } from "./skyboxAssets";

/** One silhouette tile's width. Two copies wrap it, like the panorama. */
const TILE_W = 1600;
const SKY_H = 600;

interface ThemeLook {
	/** Top-to-bottom sky stops. */
	sky: readonly number[];
	far: {
		color: number;
		factor: number;
		draw: (g: Graphics, color: number) => void;
	};
	near: {
		color: number;
		factor: number;
		draw: (g: Graphics, color: number) => void;
	};
	ambient: "clouds" | "snow" | "stars";
}

/** A tiny deterministic generator, so every client draws the same hills. */
function seeded(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

function drawCastles(g: Graphics, color: number) {
	const rand = seeded(7);
	// A low curtain wall along the horizon, towers rising out of it.
	g.rect(0, 430, TILE_W, 170).fill(color);
	for (let x = 0; x < TILE_W; x += 24) g.rect(x, 418, 14, 12).fill(color);
	for (let x = 60; x < TILE_W; x += 260 + rand() * 120) {
		const w = 50 + rand() * 40;
		const h = 120 + rand() * 120;
		const top = 430 - h;
		g.rect(x, top, w, h).fill(color);
		for (let bx = x; bx < x + w; bx += 14)
			g.rect(bx, top - 10, 8, 10).fill(color);
		// A pointed roof on every other tower, a flag on the tallest.
		if (rand() > 0.5) {
			g.poly([
				x - 6,
				top,
				x + w / 2,
				top - 46 - rand() * 20,
				x + w + 6,
				top,
			]).fill(color);
		}
		if (h > 200) {
			g.rect(x + w / 2, top - 70, 2, 40).fill(color);
			g.poly([
				x + w / 2 + 2,
				top - 70,
				x + w / 2 + 22,
				top - 63,
				x + w / 2 + 2,
				top - 56,
			]).fill(color);
		}
	}
}

function drawRamparts(g: Graphics, color: number) {
	const rand = seeded(11);
	g.rect(0, 500, TILE_W, 100).fill(color);
	for (let x = 0; x < TILE_W; x += 32) g.rect(x, 486, 18, 14).fill(color);
	for (let x = 120; x < TILE_W; x += 420 + rand() * 160) {
		const w = 90;
		g.rect(x, 380, w, 120).fill(color);
		for (let bx = x - 6; bx < x + w + 6; bx += 18)
			g.rect(bx, 366, 10, 14).fill(color);
	}
}

function drawHills(g: Graphics, color: number) {
	const rand = seeded(3);
	g.rect(0, 470, TILE_W, 130).fill(color);
	for (let x = -100; x < TILE_W + 100; x += 220 + rand() * 120) {
		g.ellipse(x, 480, 200 + rand() * 120, 80 + rand() * 60).fill(color);
	}
}

function drawTrees(g: Graphics, color: number) {
	const rand = seeded(5);
	g.rect(0, 530, TILE_W, 70).fill(color);
	for (let x = -60; x < TILE_W + 60; x += 260 + rand() * 140) {
		g.ellipse(x, 540, 160 + rand() * 80, 50 + rand() * 30).fill(color);
	}
	for (let x = 40; x < TILE_W; x += 90 + rand() * 160) {
		const h = 50 + rand() * 50;
		g.rect(x - 3, 530 - h, 6, h).fill(color);
		g.circle(x, 530 - h, 22 + rand() * 14).fill(color);
		g.circle(x - 14, 530 - h + 10, 16).fill(color);
		g.circle(x + 14, 530 - h + 10, 16).fill(color);
	}
}

function drawPeaks(g: Graphics, color: number) {
	const rand = seeded(13);
	g.rect(0, 470, TILE_W, 130).fill(color);
	for (let x = -150; x < TILE_W + 150; x += 200 + rand() * 140) {
		const w = 200 + rand() * 160;
		const h = 170 + rand() * 150;
		g.poly([x - w / 2, 480, x, 480 - h, x + w / 2, 480]).fill(color);
		// The snow cap: a lighter tip, jagged at its lower edge.
		const cap = h * 0.32;
		g.poly([
			x - (w / 2) * (cap / h),
			480 - h + cap,
			x,
			480 - h,
			x + (w / 2) * (cap / h),
			480 - h + cap,
			x + 8,
			480 - h + cap - 10,
			x - 6,
			480 - h + cap + 2,
		]).fill(0xf4f8ff);
	}
}

function drawPines(g: Graphics, color: number) {
	const rand = seeded(17);
	g.rect(0, 540, TILE_W, 60).fill(color);
	for (let x = 20; x < TILE_W; x += 40 + rand() * 90) {
		const h = 70 + rand() * 70;
		const base = 545;
		for (let tier = 0; tier < 3; tier++) {
			const tw = (h / 2.2) * (1 - tier * 0.22);
			const ty = base - (h / 3) * tier;
			g.poly([x - tw / 2, ty, x, ty - h / 2.2, x + tw / 2, ty]).fill(color);
		}
		// Snow resting on the top tier.
		g.poly([
			x - 6,
			base - h / 1.5 + 4,
			x,
			base - h / 1.5 - h / 2.2 + 20,
			x + 6,
			base - h / 1.5 + 4,
		]).fill(0xe8f0fb);
	}
}

/**
 * Every theme's sky, top to bottom — the backdrop's base and what the map
 * maker paints behind its canvas. The Waterfront's is its panorama's sky.
 */
export const THEME_SKY: Record<MapTheme, readonly number[]> = {
	waterfront: [0x2f6b98, 0x3f88ad, 0x5aa6bd, 0x78c2c7, 0x9ad8cd],
	castle: [0x2d2a52, 0x4f3f72, 0x8a5a7e, 0xd98c78, 0xf2b98a],
	meadow: [0x4a9ad6, 0x6cb4e2, 0x94cdea, 0xc4e6ee, 0xe6f4ea],
	snow: [0x7b93b8, 0x96aecb, 0xb4c7dc, 0xd2dfec, 0xe8eff6],
};

const LOOKS: Record<Exclude<MapTheme, "waterfront">, ThemeLook> = {
	castle: {
		sky: THEME_SKY.castle,
		far: { color: 0x6f5f86, factor: 0.12, draw: drawCastles },
		near: { color: 0x58507a, factor: 0.3, draw: drawRamparts },
		ambient: "stars",
	},
	meadow: {
		sky: THEME_SKY.meadow,
		far: { color: 0x9cc7a8, factor: 0.12, draw: drawHills },
		near: { color: 0x7fb08a, factor: 0.3, draw: drawTrees },
		ambient: "clouds",
	},
	snow: {
		sky: THEME_SKY.snow,
		far: { color: 0x9fb0c9, factor: 0.12, draw: drawPeaks },
		near: { color: 0x8094b2, factor: 0.3, draw: drawPines },
		ambient: "snow",
	},
};

interface Layer {
	factor: number;
	copies: [Graphics, Graphics];
}

interface Mote {
	g: Graphics;
	x: number;
	y: number;
	speedX: number;
	speedY: number;
	phase: number;
}

const SNOW_FLAKES = 90;
const CLOUDS = 7;
const STARS = 60;

class ThemeSky {
	private readonly root = new Container();
	private readonly art = new Container();
	private readonly sky = new Graphics();
	private readonly layers: Layer[] = [];
	private readonly motes: Mote[] = [];
	private readonly look: ThemeLook;
	private elapsedMs = 0;
	private cameraX = 0;

	constructor(
		private readonly parent: Container,
		private readonly theme: Exclude<MapTheme, "waterfront">,
		view: { width: number; height: number },
	) {
		this.look = LOOKS[theme];
		parent.addChild(this.root);
		this.root.addChild(this.sky);
		this.root.addChild(this.art);

		// A banded gradient, one screen wide and screen-locked: a 1px-tall rect
		// per row would be 600 objects, so the bands are 8px — the tile grid —
		// which also gives the sky the same stepped pixel look as the tiles.
		const stops = this.look.sky;
		for (let y = 0; y < SKY_H; y += 8) {
			const t = (y / SKY_H) * (stops.length - 1);
			const i = Math.min(stops.length - 2, Math.floor(t));
			this.sky
				.rect(0, y, 1, 8)
				.fill(mix(stops[i] ?? 0, stops[i + 1] ?? 0, t - i));
		}

		if (this.look.ambient === "stars") this.addStars();
		for (const def of [this.look.far, this.look.near]) {
			const a = new Graphics();
			const b = new Graphics();
			def.draw(a, def.color);
			def.draw(b, def.color);
			this.art.addChild(a, b);
			this.layers.push({ factor: def.factor, copies: [a, b] });
		}
		if (this.look.ambient === "clouds") this.addClouds();

		// The same atmospheric push the Waterfront gets: the backdrop is behind
		// the fight, so it is a little soft and a little grey.
		const grade = new ColorMatrixFilter();
		grade.saturate(-0.25, false);
		this.art.filters = [new BlurFilter({ strength: 1.1, quality: 2 }), grade];

		if (this.look.ambient === "snow") this.addSnow();
		this.update(0, 0, 0, view.width, view.height);
	}

	private addStars() {
		const rand = seeded(23);
		for (let i = 0; i < STARS; i++) {
			const g = new Graphics()
				.rect(0, 0, 2, 2)
				.fill({ color: 0xfff3d0, alpha: 0.8 });
			this.root.addChild(g);
			this.motes.push({
				g,
				x: rand() * TILE_W,
				y: rand() * 260,
				speedX: 0,
				speedY: 0,
				phase: rand() * Math.PI * 2,
			});
		}
	}

	private addClouds() {
		const rand = seeded(29);
		for (let i = 0; i < CLOUDS; i++) {
			const g = new Graphics();
			const w = 90 + rand() * 90;
			g.ellipse(0, 0, w, 18).fill({ color: 0xffffff, alpha: 0.85 });
			g.ellipse(-w * 0.3, -12, w * 0.45, 20).fill({
				color: 0xffffff,
				alpha: 0.85,
			});
			g.ellipse(w * 0.25, -14, w * 0.4, 18).fill({
				color: 0xffffff,
				alpha: 0.85,
			});
			this.art.addChild(g);
			this.motes.push({
				g,
				x: rand() * TILE_W,
				y: 70 + rand() * 180,
				speedX: 8 + rand() * 10,
				speedY: 0,
				phase: 0,
			});
		}
	}

	private addSnow() {
		const rand = seeded(31);
		for (let i = 0; i < SNOW_FLAKES; i++) {
			const size = rand() > 0.7 ? 3 : 2;
			const g = new Graphics()
				.rect(0, 0, size, size)
				.fill({ color: 0xffffff, alpha: 0.75 });
			this.root.addChild(g);
			this.motes.push({
				g,
				x: rand() * TILE_W,
				y: rand() * SKY_H,
				speedX: -8 - rand() * 10,
				speedY: 28 + rand() * 30,
				phase: rand() * Math.PI * 2,
			});
		}
	}

	update(
		cameraX: number,
		cameraY: number,
		dtMs: number,
		viewW: number,
		viewH: number,
	) {
		this.elapsedMs += dtMs;
		this.cameraX = cameraX;
		const t = this.elapsedMs / 1000;
		// Locked to the screen vertically on a map taller than one, exactly
		// like the Waterfront: the backdrop is one screen tall.
		const lockY = Math.max(0, cameraY);
		this.root.y = lockY;

		this.sky.x = cameraX;
		this.sky.y = 0;
		this.sky.scale.x = viewW;
		this.sky.scale.y = Math.max(1, viewH / SKY_H);

		for (const layer of this.layers) {
			const shift = wrap(cameraX * layer.factor, TILE_W);
			layer.copies.forEach((g, i) => {
				g.x = cameraX - shift + i * TILE_W;
				g.visible = g.x + TILE_W > cameraX && g.x < cameraX + viewW;
			});
		}

		for (const m of this.motes) {
			if (this.look.ambient === "stars") {
				m.g.x = cameraX + wrap(m.x - cameraX * 0.05, TILE_W);
				m.g.y = m.y;
				m.g.alpha = 0.45 + 0.4 * Math.sin(t * 1.3 + m.phase);
				continue;
			}
			const x = m.x + m.speedX * t + Math.sin(t + m.phase) * (m.speedY ? 6 : 0);
			const y = m.speedY ? wrap(m.y + m.speedY * t, SKY_H) : m.y;
			const factor = m.speedY ? 0.6 : 0.08;
			m.g.x =
				cameraX +
				wrap(x - cameraX * factor, Math.max(viewW, TILE_W)) -
				(m.speedY ? 0 : 120);
			m.g.y = y;
		}
	}

	debugState(): SkyboxDebugState {
		return {
			variant: "hand",
			theme: this.theme,
			loaded: true,
			layers: this.layers.length + 1,
			animatedFalls: 0,
			frame: 0,
			elapsedMs: this.elapsedMs,
			shift: wrap(this.cameraX * (this.layers[0]?.factor ?? 0), TILE_W),
			cameraX: this.cameraX,
			panoramaWidth: TILE_W,
			haze: 1,
			imageWidth: TILE_W,
			imageScale: 1,
			order: this.layers.map((l, i) => ({
				id: i === 0 ? "far" : "near",
				kind: "image" as const,
				factor: l.factor,
				shift: wrap(this.cameraX * l.factor, TILE_W),
				drift: 0,
			})),
			movers: [],
			ambient: { loopMs: 0, groups: 1, actors: this.motes.length },
			loops: null,
			loopFrame: 0,
		};
	}

	destroy() {
		if (this.root.destroyed) return;
		for (const filter of this.art.filters ?? []) filter.destroy();
		this.art.filters = [];
		this.parent.removeChild(this.root);
		this.root.destroy({ children: true });
	}
}

function wrap(v: number, w: number): number {
	return ((v % w) + w) % w;
}

function mix(a: number, b: number, t: number): number {
	const ar = (a >> 16) & 0xff;
	const ag = (a >> 8) & 0xff;
	const ab = a & 0xff;
	const r = Math.round(ar + (((b >> 16) & 0xff) - ar) * t);
	const g = Math.round(ag + (((b >> 8) & 0xff) - ag) * t);
	const bl = Math.round(ab + ((b & 0xff) - ab) * t);
	return (r << 16) | (g << 8) | bl;
}

/** Whatever is behind the arena: the Waterfront panorama or a theme's sky. */
export type Backdrop = Skybox | ThemeSky;

/**
 * The backdrop for a map's theme. `?sky=off` (Graphics → Off) always wins: the
 * plain competitive gradient is a player's choice about distraction, and a
 * themed map does not get to overrule it.
 */
export function createBackdrop(
	parent: Container,
	view: { width: number; height: number },
	theme: MapTheme,
): Backdrop {
	if (theme !== "waterfront" && skyboxChoice() !== "off") {
		return new ThemeSky(parent, theme, view);
	}
	return new Skybox(parent, view);
}
