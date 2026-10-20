/**
 * Loading the parallax skybox candidates.
 *
 * Two independently authored panoramas ship beside each other — a pre-rendered
 * voxel city and a hand-drawn pixel-art city — and the runtime picks one from
 * `?sky=` without knowing how it was made. The swap is a URL, not a setting
 * store, for the same reason the arena size is: a link can carry the look, and
 * a probe can measure it.
 *
 * The manifest is fetched uncached and names every PNG by a content hash, so a
 * re-render can never be paired with a browser-cached older layer. This is the
 * same trap the packed hero sheets hit: a new JSON beside a stale PNG crops
 * every frame at the wrong rect.
 */

import { Assets, Rectangle, Texture } from "pixi.js";
import { EventBus } from "../EventBus";

/** The style. `off` is the plain-gradient escape hatch. */
const SKY_VARIANTS = ["hand"] as const;
type SkyVariant = (typeof SKY_VARIANTS)[number];

/** What `?sky=off` means. */
export type SkyChoice = SkyVariant | "off";

const DEFAULT_VARIANT: SkyVariant = "hand";

interface SkyboxItemDef {
	u: number;
	v: number;
	/**
	 * Horizontal motion in texture pixels per second. A strip with a non-zero
	 * speed is a mover — birds, a zeppelin, a boat — not a waterfall. Positive
	 * moves right; wrap at the panorama edge.
	 */
	speedX?: number;
	/** Vertical bob amplitude in pixels. */
	bobAmp?: number;
	/** Bob frequency in Hz (cycles per second). */
	bobFreq?: number;
	/** Phase offset in radians, so a flock does not bob in lockstep. */
	phase?: number;
	/** Mirror the frame horizontally; use for art drawn facing right that moves left. */
	flip?: boolean;
	/** Start this actor's frame cycle this many frames later; for a varied crowd. */
	frameOffset?: number;
}

/**
 * The whole background motion programme, not one plan per element.
 *
 * A candidate has a single `ambient` plan: one loop length and one clock, with
 * every moving actor grouped by the strip layer it belongs to. The runtime
 * drives birds, airships, boats and glints from this one plan, so their timing
 * is composed rather than four independent clocks drifting apart.
 */
interface SkyboxAmbientGroupDef {
	/** The id of a `type: "strip"` layer whose frames draw this group. */
	layer: string;
	actors: SkyboxItemDef[];
}

export interface SkyboxAmbientDef {
	/** Master loop in milliseconds. All groups share this clock. */
	loopMs: number;
	groups: SkyboxAmbientGroupDef[];
}

/**
 * Fixed-position looping vignettes — people cheering, picnicking, dating,
 * sparring, playing a small match. This is the **looping layer**; the
 * `ambient` plan is the separate **moving layer** (walkers, birds, boats).
 * Both are sampled from the same elapsed clock, but they are authored as two
 * distinct programmes so a stationary vignette never drifts across the quay.
 */
export interface SkyboxLoopsDef {
	/** Intended programme length in milliseconds. */
	clockMs: number;
	groups: { layer: string; actors: SkyboxItemDef[] }[];
}

export interface SkyboxLayerDef {
	id: string;
	type?: "image" | "strip";
	src: string;
	/** First 12 hex chars of the PNG's SHA-256. Appended as `?v=`. */
	version?: string;
	/** Fraction of camera movement this layer follows. 0 = screen-locked. */
	factor: number;
	/** Ambient horizontal drift, px/s. Clouds only; never the city. */
	driftX?: number;
	alpha?: number;
	/** Strip only: the frame sheet's geometry. */
	frameW?: number;
	frameH?: number;
	frames?: number;
	fps?: number;
	/** Strip only: where the strip's top-left sits in texture space. */
	items?: SkyboxItemDef[];
	/**
	 * Strip only: the id of the image layer whose movement this strip shares.
	 * A waterfall cut into a layer's texture coordinates must follow that
	 * layer exactly or it peels away from its own aqueduct when the camera
	 * moves; the runtime resolves the factor through this, not `factor`.
	 */
	align?: string;
}

export interface SkyboxManifest {
	name: string;
	title?: string;
	width: number;
	height: number;
	/** Art-directed strength of the runtime atmospheric scrim. 1 = the default. */
	haze?: number;
	/** One programme for every moving background actor. */
	ambient?: SkyboxAmbientDef;
	/** One programme for every fixed-position looping vignette. */
	loops?: SkyboxLoopsDef;
	layers: SkyboxLayerDef[];
}

export interface LoadedSkyboxLayer extends SkyboxLayerDef {
	/** The full panorama for image layers. */
	texture?: Texture;
	/** The frame slices for strip layers. */
	slices?: Texture[];
}

export interface LoadedSkybox {
	variant: SkyVariant;
	manifest: SkyboxManifest;
	layers: LoadedSkyboxLayer[];
}

let choice: SkyChoice | null = null;
let loadPromise: Promise<LoadedSkybox | null> | null = null;
let loaded: LoadedSkybox | null = null;
let pendingChoice = false;

/** The player's own choice, kept beside the bindings and the mixer. */
const STORAGE_KEY = "golpe:skybox";

function isSkyChoice(value: string): value is SkyChoice {
	return value === "off" || (SKY_VARIANTS as readonly string[]).includes(value);
}

/** The stored choice, if any. */
function storedSkybox(): SkyChoice | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw && isSkyChoice(raw) ? raw : null;
	} catch {
		return null;
	}
}

/** Remember a choice, and make the next load honour it. */
export function storeSkybox(value: SkyChoice): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// Private mode is still a playable game.
	}
	// The menu launches by swapping React state, not by reloading the page.
	// Do **not** drop the current `loaded` candidate: a match already on screen
	// must keep its backdrop if it rebuilds before the new assets arrive. The
	// next `preloadSkyboxAssets` sees `pendingChoice` and loads the new one;
	// `applySkyboxChoice` then tells the match to swap it in place.
	choice = value;
	pendingChoice = true;
}

let applyToken = 0;

/**
 * Load the selected candidate and tell the live presentation to swap it in.
 *
 * The simulation never hears this event. A match keeps its tick, camera and
 * fighters; the `Skybox` is destroyed and rebuilt around the new textures.
 * Multiple quick clicks are tokenised so an older fetch cannot swap in after
 * a newer choice.
 */
export async function applySkyboxChoice(): Promise<void> {
	const token = ++applyToken;
	await preloadSkyboxAssets();
	if (token !== applyToken) return;
	EventBus.emit("skybox-changed");
}

/** `?sky=hand|off`; otherwise the stored choice; otherwise the default. */
export function skyboxChoice(): SkyChoice {
	if (choice) return choice;
	const raw =
		typeof window === "undefined"
			? ""
			: (
					new URLSearchParams(window.location.search).get("sky") ?? ""
				).toLowerCase();
	if (raw === "none" || raw === "0") choice = "off";
	else if (isSkyChoice(raw)) choice = raw;
	else choice = storedSkybox() ?? DEFAULT_VARIANT;
	return choice;
}

/** The loaded candidate, or null for `?sky=off` / a missing asset set. */
export function loadedSkybox(): LoadedSkybox | null {
	return loaded;
}

/**
 * Fetch and decode the chosen candidate once per page.
 *
 * Never throws: a missing manifest means the game falls back to its gradient,
 * exactly as the old sky did. A probe boot with no asset server still plays.
 */
export function preloadSkyboxAssets(): Promise<LoadedSkybox | null> {
	if (loadPromise && !pendingChoice) return loadPromise;
	pendingChoice = false;
	loadPromise = (async () => {
		const variant = skyboxChoice();
		if (variant === "off") {
			if (variant === skyboxChoice()) loaded = null;
			return null;
		}
		try {
			const res = await fetch(`assets/skybox/${variant}/manifest.json`, {
				cache: "no-cache",
			});
			if (!res.ok) throw new Error(`missing manifest (${res.status})`);
			const manifest = (await res.json()) as SkyboxManifest;
			if (!manifest.layers?.length) throw new Error("manifest has no layers");

			const layers = await Promise.all(
				manifest.layers.map((def) => loadLayer(variant, def)),
			);
			const result = { variant, manifest, layers };
			// A second change while the fetch was in flight wins; never let an
			// older response overwrite the choice the player is looking at.
			if (variant === skyboxChoice()) loaded = result;
			return result;
		} catch (err) {
			console.warn(
				`[skybox] ${variant} unavailable — drawing the gradient fallback`,
				err,
			);
			if (variant === skyboxChoice()) loaded = null;
			return null;
		}
	})();
	return loadPromise;
}

async function loadLayer(
	variant: SkyVariant,
	def: SkyboxLayerDef,
): Promise<LoadedSkyboxLayer> {
	const alias = `skybox:${variant}:${def.id}`;
	const src = def.version ? `${def.src}?v=${def.version}` : def.src;
	const texture = await Assets.load<Texture>({ alias, src, parser: "texture" });
	texture.source.scaleMode = "nearest";

	if (def.type !== "strip") return { ...def, texture };

	const frameW = def.frameW ?? 0;
	const frameH = def.frameH ?? 0;
	const count = def.frames ?? 0;
	if (!frameW || !frameH || !count)
		throw new Error(`strip "${def.id}" is missing its frame geometry`);
	const frames: Texture[] = [];
	for (let i = 0; i < count; i++) {
		const frame = new Texture({
			source: texture.source,
			frame: new Rectangle(i * frameW, 0, frameW, frameH),
		});
		frame.source.scaleMode = "nearest";
		frames.push(frame);
	}
	return { ...def, slices: frames };
}

/**
 * Resolve a strip's factor through its `align` layer.
 *
 * A waterfall is drawn in the same texture coordinates as the city it falls
 * out of, so it must follow that city's parallax. The contract lets the strip
 * name a factor of its own; this is where a mismatch is made impossible.
 */
export function layerFactor(
	manifest: SkyboxManifest,
	def: SkyboxLayerDef,
): number {
	if (!def.align) return def.factor;
	const anchor = manifest.layers.find((l) => l.id === def.align);
	if (!anchor) return def.factor;
	return layerFactor(manifest, anchor);
}
