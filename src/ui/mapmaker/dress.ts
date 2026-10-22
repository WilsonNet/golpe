/**
 * Prettify: dress a platform with decorations in one click.
 *
 * A platform has three places a decoration can go — its **top** (things stand
 * on it: birds, bushes, lamps), its **face** (things are mounted on it:
 * windows, torches, ivy) and its **underside** (things hang from it: vines,
 * lanterns, bunting). A style writes some of those slots; dressing first clears
 * what is already in *those* slots of *that* platform, so styles compose
 * (windows, then birds) and pressing the same style again re-rolls it.
 *
 * Pure and deterministic: the same map, platform, style and seed always give
 * the same props, so the editor's undo and its tests see one answer. The
 * picks lean on the theme — gulls on the Waterfront, banners in the Castle,
 * snowmen in the Snow — and nothing here is ever simulated.
 *
 * See specs/map-maker.md.
 */

import { propDef } from "../../game/maps/props";
import type { Rect } from "../../game/simulation/Arena";
import { MAX_MAP_PROPS, type MapTheme } from "../../game/simulation/Tilemap";
import {
	type EditorMap,
	type EPlatform,
	type EProp,
	GRID,
	mapHeight,
	mapWidth,
	mountOnFace,
	propRect,
	uid,
} from "./model";

export type DressStyle =
	| "windows"
	| "critters"
	| "greenery"
	| "lights"
	| "festive"
	| "surprise";

type Slot = "top" | "face" | "under";

export const DRESS_STYLES: readonly {
	id: DressStyle;
	label: string;
	icon: string;
	hint: string;
}[] = [
	{
		id: "windows",
		label: "Windows",
		icon: "🪟",
		hint: "A row of windows along the face — a tall platform becomes a building",
	},
	{
		id: "critters",
		label: "Birds",
		icon: "🐦",
		hint: "Birds and critters perched on top",
	},
	{
		id: "greenery",
		label: "Greenery",
		icon: "🌿",
		hint: "Bushes and flowers on top, ivy on the face, vines underneath",
	},
	{
		id: "lights",
		label: "Lights",
		icon: "🏮",
		hint: "Lamps on top, torches on the face, lanterns underneath",
	},
	{
		id: "festive",
		label: "Festive",
		icon: "🎏",
		hint: "Bunting, banners and flags",
	},
	{
		id: "surprise",
		label: "Surprise me",
		icon: "✨",
		hint: "A bit of everything, picked for the theme — press again to re-roll",
	},
];

const SLOTS: Record<Exclude<DressStyle, "surprise">, readonly Slot[]> = {
	windows: ["face"],
	critters: ["top"],
	greenery: ["top", "face", "under"],
	lights: ["top", "face", "under"],
	festive: ["top", "under"],
};

/** The theme's flavour of each pick list; `any` is the shared pool. */
type Pool = Partial<Record<MapTheme | "any", readonly string[]>>;

const WINDOW_SETS: Pool = {
	any: ["windowLit", "windowDark", "windowShutters", "windowBox"],
	castle: ["windowArched", "windowBarred", "stainedGlass", "windowLit"],
	waterfront: ["windowRound", "windowLit", "windowShutters", "windowBox"],
	snow: ["windowLit", "windowArched", "windowDark"],
	meadow: ["windowShutters", "windowBox", "windowLit"],
};
const WALL_EXTRAS: Pool = {
	any: ["clock", "shopSign", "birdhouse", "poster", "awning"],
	castle: ["shield", "crest", "clock", "mosaic"],
	waterfront: ["shopSign", "awning", "poster", "pipe"],
	snow: ["clock", "birdhouse", "shield"],
	meadow: ["birdhouse", "awning", "ivy"],
};
const CRITTERS: Pool = {
	any: ["pigeon", "sparrow", "crow", "cat", "catSleeping"],
	waterfront: ["gull", "gull", "pigeon", "crab", "cat"],
	castle: ["crow", "crow", "owl", "rat", "pigeon"],
	meadow: ["sparrow", "rabbit", "chicken", "fox", "frog", "snail", "dog"],
	snow: ["penguin", "crow", "owl", "rabbit", "sparrow"],
};
const PLANTS: Pool = {
	any: ["bush", "bushFlower", "tallGrass", "flowersRed", "flowersBlue", "fern"],
	waterfront: [
		"planter",
		"flowerBox",
		"bushFlower",
		"pottedPlant",
		"tallGrass",
	],
	castle: ["bush", "fern", "mushroom", "tallGrass", "rock"],
	meadow: [
		"bushFlower",
		"flowersRed",
		"flowersBlue",
		"sunflower",
		"tallGrass",
		"mushrooms",
	],
	snow: ["rock", "bush", "snowman", "tallGrass"],
};
const TREES: Pool = {
	any: ["tree", "pine"],
	snow: ["pine", "pine", "deadTree"],
	castle: ["deadTree", "pine"],
};
const HANG_GREEN: Pool = {
	any: ["vine", "vineFlower", "roots", "hangingPlant"],
	snow: ["icicles", "icicles", "stalactite"],
	castle: ["vine", "cobweb", "chain", "roots"],
};
const WALL_GREEN: Pool = { any: ["ivy", "ivy", "crack", "bricks"] };
const TOP_LIGHTS: Pool = {
	any: ["lantern", "streetlamp", "candles"],
	castle: ["brazier", "candles", "brazier"],
	meadow: ["campfire", "lantern"],
};
const FACE_LIGHTS: Pool = {
	any: ["torch"],
	waterfront: ["torch", "neonHeart"],
};
const HANG_LIGHTS: Pool = {
	any: ["hangingLamp", "paperLantern", "stringLights"],
	castle: ["hangingLamp", "chain", "bell"],
};
const HANG_FESTIVE: Pool = {
	any: ["bunting", "stringLights", "bannerRed", "bannerBlue", "laundry"],
	castle: ["bannerRed", "bannerPurple", "bannerBlue", "bunting"],
	waterfront: ["bunting", "laundry", "stringLights", "bannerBlue"],
};
const TOP_FESTIVE: Pool = {
	any: ["flag", "balloonRed", "balloonBlue"],
	castle: ["flag", "flag", "weaponRack"],
};

/** Mulberry32: a tiny seeded generator, so a seed is a reproducible dressing. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pool(p: Pool, theme: MapTheme): readonly string[] {
	return p[theme] ?? p.any ?? [];
}

function pick<T>(list: readonly T[], rand: () => number): T | undefined {
	return list[Math.floor(rand() * list.length)];
}

function size(type: string): { w: number; h: number } {
	const def = propDef(type);
	return { w: def?.w ?? 8, h: def?.h ?? 8 };
}

function overlaps(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	);
}

/** Which of a platform's slots a prop occupies, if any. */
export function slotOf(p: EPlatform, prop: EProp): Slot | null {
	const r = propRect(prop);
	const spansX = r.x + r.w > p.x && r.x < p.x + p.w;
	if (!spansX) return null;
	if (r.y + r.h === p.y) return "top";
	if (r.y === p.y + p.h) return "under";
	if (
		r.x >= p.x &&
		r.x + r.w <= p.x + p.w &&
		r.y >= p.y &&
		r.y + r.h <= p.y + p.h
	)
		return "face";
	return null;
}

/**
 * Lay `count` props of the given widths evenly along a span, a margin in from
 * each end. Returns their left edges.
 */
function spread(
	x0: number,
	x1: number,
	widths: number[],
	margin: number,
): number[] {
	const span = x1 - x0 - margin * 2;
	const total = widths.reduce((a, b) => a + b, 0);
	if (widths.length === 0 || total > span) return [];
	const gap = widths.length > 1 ? (span - total) / (widths.length - 1) : 0;
	const out: number[] = [];
	let x = x0 + margin + (widths.length === 1 ? (span - total) / 2 : 0);
	for (const w of widths) {
		out.push(Math.round(x));
		x += w + gap;
	}
	return out;
}

interface Ctx {
	map: EditorMap;
	host: EPlatform;
	theme: MapTheme;
	rand: () => number;
	out: EProp[];
}

/** Is this rect free of every other solid, and inside the world? */
function clear(c: Ctx, r: Rect): boolean {
	if (r.x < 0 || r.y < 0) return false;
	if (r.x + r.w > mapWidth(c.map) || r.y + r.h > mapHeight(c.map)) return false;
	return !c.map.platforms.some((p) => p.id !== c.host.id && overlaps(r, p));
}

function place(c: Ctx, type: string, x: number, y: number, flip = false) {
	const { w, h } = size(type);
	if (!clear(c, { x, y, w, h })) return;
	if (c.out.some((o) => overlaps(propRect(o), { x, y, w, h }))) return;
	c.out.push({ id: uid("r"), type, x, y, ...(flip ? { flip: true } : {}) });
}

/** Stand props on the top surface, a few of them, never shoulder to shoulder. */
function dressTop(c: Ctx, list: readonly string[], density: number) {
	const p = c.host;
	const slots = Math.max(1, Math.floor(p.w / 48));
	const want = Math.max(1, Math.round(slots * density));
	const picks: string[] = [];
	for (let i = 0; i < want; i++) {
		const t = pick(list, c.rand);
		if (t) picks.push(t);
	}
	// Spread over the surface, then jitter inside each prop's share of it.
	const share = p.w / picks.length;
	picks.forEach((type, i) => {
		const { w, h } = size(type);
		if (w > p.w) return;
		const room = Math.max(0, share - w);
		const x = Math.round(
			Math.max(p.x, Math.min(p.x + p.w - w, p.x + i * share + c.rand() * room)),
		);
		place(c, type, x, p.y - h, c.rand() < 0.5);
	});
}

/** Hang props from the underside, at the ends and the middle. */
function dressUnder(c: Ctx, list: readonly string[]) {
	const p = c.host;
	if (p.y + p.h >= mapHeight(c.map)) return; // nothing hangs below the floor
	const type = pick(list, c.rand);
	if (!type) return;
	const { w } = size(type);
	// A wide garland is centred once; small things go in pairs at the ends.
	if (w >= p.w * 0.5 || w >= 40) {
		if (w <= p.w) place(c, type, Math.round(p.x + (p.w - w) / 2), p.y + p.h);
		return;
	}
	const n = Math.max(1, Math.min(4, Math.floor(p.w / 56)));
	const xs = spread(p.x, p.x + p.w, Array(n).fill(w), Math.min(12, p.w / 6));
	for (const x of xs) {
		const t = c.rand() < 0.75 ? type : (pick(list, c.rand) ?? type);
		place(c, t, x, p.y + p.h, c.rand() < 0.5);
	}
}

/** Mount props in rows across the face, below the walkable lip. */
function dressFace(c: Ctx, list: readonly string[], extras: readonly string[]) {
	const p = c.host;
	const type = pick(list, c.rand);
	if (!type) return;
	const { w, h } = size(type);
	const lip = GRID;
	const faceH = p.h - lip;
	if (faceH < h || p.w < w + 4) return;
	const gapY = 8;
	const rows = Math.max(1, Math.floor((faceH - 4 + gapY) / (h + gapY)));
	const pitch = w + Math.max(10, Math.round(w * 0.9));
	const cols = Math.max(1, Math.floor((p.w - 8 + (pitch - w)) / pitch));
	const xs = spread(
		p.x,
		p.x + p.w,
		Array(cols).fill(w),
		Math.max(4, Math.min(16, (p.w - cols * w) / 4)),
	);
	const usedH = rows * h + (rows - 1) * gapY;
	const y0 = p.y + lip + Math.max(0, Math.floor((faceH - usedH) / 2));
	// One feature (a clock, a sign) replaces a window on a wide building.
	const feature = cols >= 3 && extras.length > 0 && c.rand() < 0.6;
	const featureAt = Math.floor(cols / 2);
	for (let r = 0; r < rows; r++) {
		xs.forEach((x, i) => {
			const y = y0 + r * (h + gapY);
			if (feature && r === 0 && i === featureAt) {
				const extra = pick(extras, c.rand);
				if (extra) {
					const s = size(extra);
					const at = mountOnFace(p, s.w, s.h, x + w / 2, y + h / 2);
					place(c, extra, at.x, at.y);
					return;
				}
			}
			// Lit and dark windows of the same size mix: somebody is home.
			let t = type;
			if (type === "windowLit" || type === "windowDark")
				t = c.rand() < 0.65 ? "windowLit" : "windowDark";
			place(c, t, x, y);
		});
	}
}

/** Scatter a couple of wall props anywhere on the face (ivy, torches). */
function dressFaceSparse(c: Ctx, list: readonly string[]) {
	const p = c.host;
	const n = Math.max(1, Math.min(4, Math.floor(p.w / 72)));
	for (let i = 0; i < n; i++) {
		const type = pick(list, c.rand);
		if (!type) continue;
		const { w, h } = size(type);
		if (h > p.h || w > p.w) continue;
		const cx = p.x + ((i + 0.5) / n) * p.w;
		const at = mountOnFace(p, w, h, cx, p.y + p.h / 2);
		place(c, type, at.x, at.y);
	}
}

function dressWith(c: Ctx, style: Exclude<DressStyle, "surprise">) {
	const t = c.theme;
	switch (style) {
		case "windows":
			dressFace(c, pool(WINDOW_SETS, t), pool(WALL_EXTRAS, t));
			return;
		case "critters":
			dressTop(c, pool(CRITTERS, t), 0.6);
			return;
		case "greenery": {
			const tall = c.host.w >= 96 && c.rand() < 0.35;
			if (tall) dressTop(c, pool(TREES, t), 0.25);
			dressTop(c, pool(PLANTS, t), 0.9);
			dressUnder(c, pool(HANG_GREEN, t));
			if (c.host.h >= 32) dressFaceSparse(c, pool(WALL_GREEN, t));
			return;
		}
		case "lights":
			dressTop(c, pool(TOP_LIGHTS, t), 0.35);
			dressUnder(c, pool(HANG_LIGHTS, t));
			if (c.host.h >= 32) dressFaceSparse(c, pool(FACE_LIGHTS, t));
			return;
		case "festive":
			dressUnder(c, pool(HANG_FESTIVE, t));
			dressTop(c, pool(TOP_FESTIVE, t), 0.3);
	}
}

/** The styles "Surprise me" combines for a platform of this shape. */
function surprise(
	host: EPlatform,
	rand: () => number,
): Exclude<DressStyle, "surprise">[] {
	const out: Exclude<DressStyle, "surprise">[] = [];
	if (host.h >= 24 && rand() < (host.h >= 48 ? 0.95 : 0.55))
		out.push("windows");
	out.push(rand() < 0.6 ? "greenery" : rand() < 0.5 ? "lights" : "festive");
	if (rand() < 0.6) out.push("critters");
	return out;
}

/**
 * Dress one platform in a style. Clears the slots the style writes first, so
 * pressing the button again re-rolls instead of piling up.
 */
export function dressPlatform(
	map: EditorMap,
	platformId: string,
	style: DressStyle,
	seed: number,
): EditorMap {
	const host = map.platforms.find((p) => p.id === platformId);
	if (!host) return map;
	const rand = rng(seed ^ hash(platformId));
	const styles = style === "surprise" ? surprise(host, rand) : [style];
	const slots = new Set(
		style === "surprise" ? (["top", "face", "under"] as Slot[]) : SLOTS[style],
	);
	const kept = map.props.filter((p) => {
		const slot = slotOf(host, p);
		return slot === null || !slots.has(slot);
	});
	const c: Ctx = {
		map: { ...map, props: kept },
		host,
		theme: map.theme,
		rand,
		out: [],
	};
	for (const s of styles) dressWith(c, s);
	const room = MAX_MAP_PROPS - kept.length;
	return { ...map, props: [...kept, ...c.out.slice(0, Math.max(0, room))] };
}

/** Remove every decoration attached to a platform: top, face and underside. */
export function undressPlatform(map: EditorMap, platformId: string): EditorMap {
	const host = map.platforms.find((p) => p.id === platformId);
	if (!host) return map;
	return { ...map, props: map.props.filter((p) => slotOf(host, p) === null) };
}

/** How many decorations a platform wears. */
export function dressCount(map: EditorMap, platformId: string): number {
	const host = map.platforms.find((p) => p.id === platformId);
	return host ? map.props.filter((p) => slotOf(host, p) !== null).length : 0;
}

/**
 * Prettify the whole map: every platform gets "Surprise me", the open sky gets
 * a few birds and clouds. One undo step, a reproducible seed.
 */
export function dressMap(map: EditorMap, seed: number): EditorMap {
	let next = map;
	for (const p of map.platforms)
		next = dressPlatform(next, p.id, "surprise", seed);
	const rand = rng(seed ^ 0x5ca1ab1e);
	const sky = ["birdFlying", "flock", "gullGliding", "cloud", "birdFlying"];
	const W = mapWidth(map);
	const H = mapHeight(map);
	const extras: EProp[] = [];
	const count = Math.round((W / 800) * (H / 600) * 2);
	for (let i = 0; i < count; i++) {
		const type = pick(sky, rand) ?? "birdFlying";
		const { w, h } = size(type);
		const r = {
			x: Math.round(rand() * (W - w)),
			y: Math.round(40 + rand() * Math.max(0, H * 0.45 - h)),
			w,
			h,
		};
		if (next.platforms.some((p) => overlaps(r, p))) continue;
		extras.push({
			id: uid("r"),
			type,
			x: r.x,
			y: r.y,
			...(rand() < 0.5 ? { flip: true } : {}),
		});
	}
	const room = MAX_MAP_PROPS - next.props.length;
	return {
		...next,
		props: [...next.props, ...extras.slice(0, Math.max(0, room))],
	};
}

function hash(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++)
		h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}
