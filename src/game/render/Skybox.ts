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

import {
	BlurFilter,
	CanvasSource,
	ColorMatrixFilter,
	Container,
	Graphics,
	Sprite,
	Texture,
} from "pixi.js";
import { TEX, tex } from "./assets";
import {
	type LoadedSkyboxLayer,
	layerFactor,
	loadedSkybox,
	type SkyboxAmbientDef,
	type SkyChoice,
	type SkyboxLoopsDef,
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
	/** Strip items with their own motion — birds, airships, boats. */
	movers: { id: string; x: number; y: number; speedX: number }[];
	/** The single background-animation programme, if the candidate has one. */
	ambient: { loopMs: number; groups: number; actors: number } | null;
	/** The fixed-position looping-vignette programme. */
	loops: { clockMs: number; groups: number; actors: number } | null;
	/** The first loop strip's current frame, for the probe. */
	loopFrame: number;
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

interface StripItem {
	u: number;
	v: number;
	speedX: number;
	bobAmp: number;
	bobFreq: number;
	phase: number;
	frameOffset: number;
	flip: boolean;
	copies: [Sprite, Sprite];
	/** Last drawn screen position, for the probe. */
	lastX: number;
	lastY: number;
}

interface StripView {
	def: LoadedSkyboxLayer;
	order: number;
	factor: number;
	items: StripItem[];
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
/** A whisper of HUD scrim; the background itself is not darkened here. */
const TOP_SCRIM_FADE: readonly [y: number, h: number, alpha: number][] = [
	[0, 20, 0.08],
	[20, 20, 0.07],
	[40, 20, 0.06],
	[60, 20, 0.05],
	[80, 20, 0.04],
	[100, 20, 0.03],
	[120, 20, 0.02],
	[140, 20, 0.01],
];
/** How far the background art is pushed behind the fight, at grade 1. */
const BACKGROUND_BLUR_PX = 1.1;
const BACKGROUND_DESATURATE = 0.38;
const BACKGROUND_DARKEN = 0.08;

export class Skybox {
	private readonly root = new Container();
	/** The painted world; the atmospheric grade and blur belong only to this. */
	private readonly art = new Container();
	/**
	 * The people and moving actors above the blurred scenery. They are the
	 * background's *life*, so they stay crisp while the city gives way to the
	 * atmospheric grade behind them.
	 */
	private readonly inhabitants = new Container();
	private readonly images: ImageView[] = [];
	private readonly strips: StripView[] = [];
	private readonly fallback: Sprite | null = null;
	private readonly scrim: Graphics | null = null;
	/** A static, screen-locked film grain over the scenery, under the people. */
	private grain: Sprite | null = null;
	private readonly panoramaW: number;
	private readonly panoramaH: number;
	private readonly haze: number;
	private readonly ambient: SkyboxAmbientDef | null;
	private readonly loops: SkyboxLoopsDef | null;
	private loopFrame = 0;
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
		this.ambient = loaded?.manifest.ambient ?? null;
		this.loops = loaded?.manifest.loops ?? null;
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

		this.root.addChild(this.art);
		// The inhabitants stay crisp, but they are still background: pull a
		// little chroma out so a bright boat or shirt behind a fighter cannot
		// out-saturate the fighter the player is tracking.
		const inhabitantGrade = new ColorMatrixFilter();
		inhabitantGrade.saturate(0.8, false);
		inhabitantGrade.brightness(0.98, true);
		this.inhabitants.filters = [inhabitantGrade];
		for (const def of loaded.layers) {
			if (def.type === "strip") {
				const frames = def.slices;
				if (!frames?.length) continue;
				const group = this.ambient?.groups.find((g) => g.layer === def.id);
				const loopGroup = this.loops?.groups.find((g) => g.layer === def.id);
				const strip: StripView = {
					def,
					order: this.images.length + this.strips.length,
					factor: layerFactor(loaded.manifest, def),
					items: [],
					lastFrame: -1,
				};
				for (const item of loopGroup?.actors ?? group?.actors ?? def.items ?? []) {
					const a = new Sprite(frames[0]);
					const b = new Sprite(frames[0]);
					for (const s of [a, b]) {
						s.anchor.set(0);
						s.alpha = def.alpha ?? 1;
						if (item.flip) s.scale.x = -1;
						if (group || loopGroup) this.inhabitants.addChild(s);
						else this.art.addChild(s);
					}
					strip.items.push({
						u: item.u,
						v: item.v,
						speedX: item.speedX ?? 0,
						bobAmp: item.bobAmp ?? 0,
						bobFreq: item.bobFreq ?? 0,
						phase: item.phase ?? 0,
						frameOffset: item.frameOffset ?? 0,
						flip: item.flip ?? false,
						copies: [a, b],
						lastX: 0,
						lastY: 0,
					});
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
				this.art.addChild(sprite);
				layer.copies.push(sprite);
			}
			this.images.push(layer);
		}

		// A screen-locked film grain sits above the blurred scenery and below
		// the inhabitants. It gives the graded backdrop texture without
		// sharpening it, and it never touches a fighter.
		this.grain = new Sprite(getGrainTexture());
		this.grain.alpha = 0.06;
		this.root.addChild(this.grain);
		this.root.addChild(this.inhabitants);

		// The grade lives behind the fight, not on it. Blur the painted world
		// and pull a little brightness/saturation out of it; the actors layer
		// is above this and gets a small brightness lift in Stage. The top
		// scrim is the only dark overlay, and it exists just for the HUD.
		const grade = new ColorMatrixFilter();
		grade.brightness(1 - BACKGROUND_DARKEN * this.haze, false);
		grade.saturate(1 - BACKGROUND_DESATURATE * this.haze, true);
		this.art.filters = [
			new BlurFilter({
				strength: BACKGROUND_BLUR_PX,
				quality: 2,
			}),
			grade,
		];

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
		if (this.grain) {
			// Screen-locked: the grain is the lens, not the world.
			this.grain.x = cameraX;
			this.grain.y = 0;
			this.grain.width = viewW;
			this.grain.height = viewH;
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
			// One plan, one clock: every actor in the ambient programme is
			// sampled at the same point in time, so a flock, an airship and a
			// boat cannot drift into unrelated timings. The panorama wrap is
			// the loop; forcing a separate loopMs reset would teleport a bird
			// whose speed does not divide the panorama.
			const clockMs = this.elapsedMs;
			const fps = strip.def.fps ?? 8;
			const baseFrame = Math.floor(clockMs / (1000 / fps)) % frames.length;
			if (baseFrame !== strip.lastFrame) {
				strip.lastFrame = baseFrame;
				if (strip.def.id === "falls") this.fallFrame = baseFrame;
				if (this.loops?.groups.some((g) => g.layer === strip.def.id))
					this.loopFrame = baseFrame;
				for (const item of strip.items) {
					const frame =
						(baseFrame + item.frameOffset + frames.length) % frames.length;
					const texture = frames[frame];
					if (!texture) continue;
					const [a, b] = item.copies;
					a.texture = texture;
					b.texture = texture;
				}
			}

			const shift = wrap(cameraX * strip.factor, W);
			const y = cameraY * (1 - strip.factor);
			const t = clockMs / 1000;
			for (const item of strip.items) {
				// The item names its position in the city's texture space, so
				// its wrap is the panorama's wrap, not the screen's. A mover
				// adds its own travel and bob on top of the layer's parallax.
				const moved = item.speedX * t;
				const screenX = wrap(item.u + moved - shift, W);
				const bob =
					item.bobAmp *
					Math.sin(t * item.bobFreq * Math.PI * 2 + item.phase);
				const w = strip.def.frameW ?? 0;
				const offset = item.flip ? w : 0;
				const x0 = cameraX + screenX + offset;
				const x1 = x0 - W;
				const [a, b] = item.copies;
				a.x = x0;
				b.x = x1;
				a.y = y + item.v + bob;
				b.y = y + item.v + bob;
				a.visible = screenX + w > 0 && screenX < viewW;
				b.visible = screenX - W + w > 0 && screenX - W < viewW;
				item.lastX = screenX;
				item.lastY = item.v + bob;
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
		const movers = this.strips.flatMap((s) =>
			s.items
				.filter((item) => item.speedX !== 0)
				.map((item) => ({
					id: s.def.id,
					x: Math.round(item.lastX),
					y: Math.round(item.lastY),
					speedX: item.speedX,
				})),
		);
		const ambient = this.ambient
			? {
					loopMs: this.ambient.loopMs,
					groups: this.ambient.groups.length,
					actors: this.ambient.groups.reduce(
						(n, group) => n + group.actors.length,
						0,
					),
				}
			: null;
		const loops = this.loops
			? {
					clockMs: this.loops.clockMs,
					groups: this.loops.groups.length,
					actors: this.loops.groups.reduce(
						(n, group) => n + group.actors.length,
						0,
					),
				}
			: null;
		return {
			variant: loadedSkybox()?.variant ?? skyboxChoice(),
			loaded: this.images.length > 0 || this.strips.length > 0,
			layers: this.images.length + this.strips.length,
			animatedFalls: this.strips
				.filter((s) => s.def.id === "falls")
				.reduce((n, s) => n + s.items.length, 0),
			frame: this.fallFrame,
			elapsedMs: Math.round(this.elapsedMs),
			shift: first ? Math.round(first.shift) : 0,
			cameraX: Math.round(this.cameraX),
			panoramaWidth: this.panoramaW,
			haze: this.haze,
			imageWidth: first?.copies[0]?.width ?? 0,
			imageScale: first?.copies[0]?.scale.x ?? 0,
			movers,
			ambient,
			loops,
			loopFrame: this.loopFrame,
			order,
		};
	}

	destroy() {
		if (this.root.destroyed) return;
		// Filters are GPU resources; the container tree does not own their
		// lifetime. A Graphics switch can rebuild the skybox often, so release
		// the blur and grade with it.
		for (const filter of this.art.filters ?? []) filter.destroy();
		this.art.filters = [];
		for (const filter of this.inhabitants.filters ?? []) filter.destroy();
		this.inhabitants.filters = [];
		this.parent.removeChild(this.root);
		// Textures are shared, loaded once and reused by the next arena build;
		// the sprites are the only per-stage cost.
		this.root.destroy({ children: true });
	}
}

function wrap(value: number, period: number): number {
	return ((value % period) + period) % period;
}

/** One cached 800x600 grain tile; the sprite is screen-locked and scaled. */
let grainTexture: Texture | null = null;
function getGrainTexture(): Texture {
	if (grainTexture) return grainTexture;
	const canvas = document.createElement("canvas");
	canvas.width = 800;
	canvas.height = 600;
	const ctx = canvas.getContext("2d");
	if (!ctx) return Texture.EMPTY;
	const image = ctx.createImageData(canvas.width, canvas.height);
	let seed = 0x9e3779b9;
	for (let i = 0; i < image.data.length; i += 4) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		const v = 96 + ((seed >>> 24) & 127);
		image.data[i] = v;
		image.data[i + 1] = v;
		image.data[i + 2] = v;
		image.data[i + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
	grainTexture = new Texture({
		source: new CanvasSource({ resource: canvas }),
	});
	grainTexture.source.scaleMode = "nearest";
	return grainTexture;
}
