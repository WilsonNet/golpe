/**
 * The parallax skybox: layered panoramas behind the arena.
 *
 * A layer is a 1600px-wide strip drawn at world scale and shifted by a
 * **fraction** of the camera's scroll. Two copies are placed a panorama apart,
 * so the wrap is explicit and there is never a moment where the tile has run
 * off the edge — the alternative, a TilingSprite, repeats vertically too, and
 * a city repeated above the sky reads as a bug.
 *
 * The skybox lives inside the camera (`Stage.background`), which is deliberate:
 * it scales and shakes with the world, and a Play of the Game push-in keeps it
 * under the fighters rather than sliding a fixed card behind them.
 *
 * The waterfalls are a strip of frames, not a shader: the source of truth is
 * a pre-rendered pixel sheet, and every fall item names its texture coordinate
 * in the city layer so it cannot drift away from its aqueduct.
 */

import { Container, Graphics, Sprite } from "pixi.js";
import { TEX, tex } from "./assets";
import {
	type LoadedSkyboxLayer,
	layerFactor,
	loadedSkybox,
	type SkyChoice,
	skyboxChoice,
} from "./skyboxAssets";

/** What the probe reads. */
export interface SkyboxDebugState {
	variant: SkyChoice;
	loaded: boolean;
	layers: number;
	animatedFalls: number;
	frame: number;
	elapsedMs: number;
	/** The first image layer's current offset, in panorama pixels. */
	shift: number;
	/** The camera the layers were last positioned against. */
	cameraX: number;
	/** The panorama width used for wrapping, in texture pixels. */
	panoramaWidth: number;
	/** The manifest's art-directed haze multiplier. */
	haze: number;
	/** The first image layer's drawn width and scale, for the probe. */
	imageWidth: number;
	imageScale: number;
	/** Every layer in draw order, with the factor it followed this frame. */
	order: {
		id: string;
		kind: "image" | "strip";
		factor: number;
		shift: number;
		drift: number;
	}[];
}

interface ImageView {
	def: LoadedSkyboxLayer;
	order: number;
	factor: number;
	drift: number;
	shift: number;
	copies: Sprite[];
	width: number;
	height: number;
}

interface FallItem {
	u: number;
	v: number;
	copies: [Sprite, Sprite];
}

interface StripView {
	def: LoadedSkyboxLayer;
	order: number;
	factor: number;
	items: FallItem[];
	lastFrame: number;
}

const IMAGE_COPIES = 3;
/**
 * A thin atmospheric grade over the backdrop.
 *
 * Two different jobs, deliberately separated:
 *
 * - The **top scrim** is a normal dark band behind the HUD. It is the only
 *   place the background is darkened.
 * - The **haze** is a pale `screen` gradient through the combat band. Screen
 *   blend lifts the darks more than the lights, which is exactly atmospheric
 *   perspective and exactly what separates a mid-tone fighter from dark
 *   foliage. The arena and the fighters are drawn *above* this layer, so the
 *   haze can push the world back without touching the body the player is
 *   tracking.
 *
 * This is the measurable fix, not a mood choice: the old flat sky put the
 * background at L*≈80 against a fighter at L*≈48. The first painted city put
 * it at ≈58, and a grayscale screenshot lost the body. The haze raises the
 * background back into the sky's value band.
 */
const TOP_SCRIM_COLOR = 0x071823;
/** The HUD scrim fades out instead of ending on a hard band across the sky. */
const TOP_SCRIM_FADE: readonly [y: number, h: number, alpha: number][] = [
	[0, 20, 0.16],
	[20, 20, 0.15],
	[40, 20, 0.14],
	[60, 20, 0.12],
	[80, 20, 0.1],
	[100, 20, 0.07],
	[120, 20, 0.04],
	[140, 20, 0.02],
];
/** [y, h, alpha] bands of the pale screen haze; alpha grows toward the floor. */
const HAZE_BANDS: readonly [y: number, h: number, alpha: number][] = [
	[0, 130, 0.0],
	[130, 40, 0.03],
	[170, 40, 0.05],
	[210, 40, 0.07],
	[250, 40, 0.1],
	[290, 40, 0.14],
	[330, 40, 0.18],
	[370, 40, 0.23],
	[410, 40, 0.28],
	[450, 40, 0.34],
	[490, 40, 0.4],
	[530, 40, 0.44],
	[570, 30, 0.46],
];
const HAZE_COLOR = 0xc8ece4;

export class Skybox {
	private readonly root = new Container();
	private readonly images: ImageView[] = [];
	private readonly strips: StripView[] = [];
	private readonly fallback: Sprite | null = null;
	private readonly scrim: Graphics | null = null;
	private readonly hazeOverlay: Graphics | null = null;
	private readonly panoramaW: number;
	private readonly panoramaH: number;
	private readonly haze: number;
	private elapsedMs = 0;
	private fallFrame = 0;
	private cameraX = 0;

	constructor(
		private readonly parent: Container,
		view: { width: number; height: number },
	) {
		const loaded = loadedSkybox();
		this.panoramaW = loaded?.manifest.width ?? view.width;
		this.panoramaH = loaded?.manifest.height ?? view.height;
		this.haze = Math.max(0, Math.min(2, loaded?.manifest.haze ?? 1));
		parent.addChild(this.root);

		if (!loaded) {
			// The old gradient, still a real backdrop: a missing art package
			// should cost the parallax, not the game.
			const gradient = new Sprite(tex(TEX.sky));
			gradient.width = view.width;
			gradient.height = this.panoramaH;
			this.fallback = gradient;
			this.root.addChild(gradient);
			this.update(0, 0, 0, view.width, view.height);
			return;
		}

		for (const def of loaded.layers) {
			if (def.type === "strip") {
				const frames = def.slices;
				if (!frames?.length) continue;
				const strip: StripView = {
					def,
					order: this.images.length + this.strips.length,
					factor: layerFactor(loaded.manifest, def),
					items: [],
					lastFrame: -1,
				};
				for (const item of def.items ?? []) {
					const a = new Sprite(frames[0]);
					const b = new Sprite(frames[0]);
					for (const s of [a, b]) {
						s.anchor.set(0);
						s.alpha = def.alpha ?? 1;
						this.root.addChild(s);
					}
					strip.items.push({ u: item.u, v: item.v, copies: [a, b] });
				}
				this.strips.push(strip);
				continue;
			}

			const texture = def.texture;
			if (!texture) continue;
			const layer: ImageView = {
				def,
				order: this.images.length + this.strips.length,
				factor: layerFactor(loaded.manifest, def),
				drift: 0,
				shift: 0,
				copies: [],
				width: this.panoramaW,
				height: this.panoramaH,
			};
			for (let i = 0; i < IMAGE_COPIES; i++) {
				const sprite = new Sprite(texture);
				sprite.anchor.set(0);
				sprite.width = layer.width;
				sprite.height = layer.height;
				sprite.alpha = def.alpha ?? 1;
				this.root.addChild(sprite);
				layer.copies.push(sprite);
			}
			this.images.push(layer);
		}

		// Above every layer, below the arena. The pale screen haze carries the
		// atmospheric grade through the combat band; the dark top scrim is the
		// HUD's own backdrop. Both follow the camera and scale to the view, so
		// they never repeat with the art.
		const haze = this.haze;
		const hazeOverlay = new Graphics();
		hazeOverlay.blendMode = "screen";
		for (const [y, h, alpha] of HAZE_BANDS) {
			hazeOverlay
				.rect(0, y, 1, h)
				.fill({ color: HAZE_COLOR, alpha: Math.min(0.7, alpha * haze) });
		}
		this.hazeOverlay = hazeOverlay;
		this.root.addChild(hazeOverlay);

		const scrim = new Graphics();
		for (const [y, h, alpha] of TOP_SCRIM_FADE) {
			scrim.rect(0, y, 1, h).fill({ color: TOP_SCRIM_COLOR, alpha });
		}
		this.scrim = scrim;
		this.root.addChild(scrim);

		this.update(0, 0, 0, view.width, view.height);
	}

	/**
	 * Move the layers for this frame.
	 *
	 * `cameraX`/`cameraY` are the same world-space camera the arena uses;
	 * `viewW`/`viewH` are its visible world size, which changes when the
	 * preview camera zooms. The skybox is a child of the scroll container, so
	 * a world-space offset is all it needs.
	 */
	update(
		cameraX: number,
		cameraY: number,
		dtMs: number,
		viewW: number,
		viewH: number,
	) {
		this.elapsedMs += dtMs;
		this.cameraX = cameraX;
		const dt = dtMs / 1000;

		if (this.fallback) {
			this.fallback.x = cameraX;
			this.fallback.y = 0;
			this.fallback.width = Math.max(viewW, this.fallback.texture.width);
			this.fallback.height = Math.max(this.panoramaH, viewH);
			return;
		}

		if (this.scrim) {
			this.scrim.x = cameraX;
			this.scrim.y = 0;
			this.scrim.scale.x = viewW;
		}
		if (this.hazeOverlay) {
			this.hazeOverlay.x = cameraX;
			this.hazeOverlay.y = 0;
			this.hazeOverlay.scale.x = viewW;
		}

		const W = this.panoramaW;
		for (const layer of this.images) {
			layer.drift += (layer.def.driftX ?? 0) * dt;
			const shift = wrap(cameraX * layer.factor + layer.drift, W);
			layer.shift = shift;
			for (let i = 0; i < layer.copies.length; i++) {
				const sprite = layer.copies[i];
				if (!sprite) continue;
				const x = cameraX - shift + i * W;
				sprite.x = x;
				sprite.y = 0;
				// A copy is visible only while its panorama intersects the
				// viewport. The third copy exists for the pathological case
				// (a preview zoomed far enough out to see more than one tile).
				sprite.visible = x + W > cameraX && x < cameraX + viewW;
			}
		}

		for (const strip of this.strips) {
			const frames = strip.def.slices;
			if (!frames?.length) continue;
			const fps = strip.def.fps ?? 8;
			const frame = Math.floor(this.elapsedMs / (1000 / fps)) % frames.length;
			const frameTexture = frames[frame];
			if (!frameTexture) continue;
			if (frame !== strip.lastFrame) {
				strip.lastFrame = frame;
				if (strip === this.strips[0]) this.fallFrame = frame;
				for (const item of strip.items) {
					const [a, b] = item.copies;
					a.texture = frameTexture;
					b.texture = frameTexture;
				}
			}

			const shift = wrap(cameraX * strip.factor, W);
			const y = cameraY * (1 - strip.factor);
			for (const item of strip.items) {
				// The item names its position in the city's texture space, so
				// its wrap is the panorama's wrap, not the screen's.
				const screenX = wrap(item.u - shift, W);
				const x0 = cameraX + screenX;
				const x1 = x0 - W;
				const w = strip.def.frameW ?? 0;
				const [a, b] = item.copies;
				a.x = x0;
				b.x = x1;
				a.y = y + item.v;
				b.y = y + item.v;
				a.visible = screenX + w > 0 && screenX < viewW;
				b.visible = screenX - W + w > 0 && screenX - W < viewW;
			}
		}
	}

	debugState(): SkyboxDebugState {
		const first = this.images[0];
		const order = [
			...this.images.map((v) => ({
				id: v.def.id,
				kind: "image" as const,
				factor: v.factor,
				shift: v.shift,
				drift: v.drift,
				order: v.order,
			})),
			...this.strips.map((v) => ({
				id: v.def.id,
				kind: "strip" as const,
				factor: v.factor,
				shift: 0,
				drift: 0,
				order: v.order,
			})),
		]
			.sort((a, b) => a.order - b.order)
			.map(({ id, kind, factor, shift, drift }) => ({
				id,
				kind,
				factor,
				shift,
				drift,
			}));
		return {
			variant: loadedSkybox()?.variant ?? skyboxChoice(),
			loaded: this.images.length > 0 || this.strips.length > 0,
			layers: this.images.length + this.strips.length,
			animatedFalls: this.strips.reduce((n, s) => n + s.items.length, 0),
			frame: this.fallFrame,
			elapsedMs: Math.round(this.elapsedMs),
			shift: first ? Math.round(first.shift) : 0,
			cameraX: Math.round(this.cameraX),
			panoramaWidth: this.panoramaW,
			haze: this.haze,
			imageWidth: first?.copies[0]?.width ?? 0,
			imageScale: first?.copies[0]?.scale.x ?? 0,
			order,
		};
	}

	destroy() {
		if (this.root.destroyed) return;
		this.parent.removeChild(this.root);
		// Textures are shared, loaded once and reused by the next arena build;
		// the sprites are the only per-stage cost.
		this.root.destroy({ children: true });
	}
}

function wrap(value: number, period: number): number {
	return ((value % period) + period) % period;
}
