/**
 * The map maker's canvas: pointer and wheel in, edits out.
 *
 * It owns the *view* (zoom and pan) and the in-flight gesture (a drag, a
 * resize, a rectangle being drawn); it owns no map state. Every edit leaves
 * through `onPreview` (a drag's intermediate frames — no undo entry) and
 * `onCommit` (the finished edit, with the map as it was before the gesture,
 * so one drag is one undo step).
 *
 * Tools, Figma/Tiled-style: Select (drag to move, handles to resize, empty
 * space to pan), Platform (drag a rectangle; a click drops a standard ledge),
 * Spawn and Prop (click to place; both drop onto the surface under the cursor),
 * Erase (click or sweep). Space-drag, the middle button and the wheel pan;
 * Ctrl/⌘-wheel and pinch-zoom zoom about the cursor.
 */

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MapIssue } from "../../game/maps/checks";
import type { Rect } from "../../game/simulation/Arena";
import { artReady, loadArt } from "./art2d";
import {
	addPlatform,
	addProp,
	addSpawn,
	boundsOf,
	clampRect,
	type EditorMap,
	GRID,
	inRect,
	MAP_H,
	mapWidth,
	moveRect,
	propAt,
	propRect,
	rectFrom,
	removeObject,
	type Selection,
	snap,
	spawnAt,
	spawnRect,
	updateObject,
} from "./model";
import {
	drawScene,
	type Ghost,
	type Handle,
	handles,
	type View,
} from "./scene";

export type Tool = "select" | "platform" | "spawn" | "prop" | "erase" | "pan";

/** A click without a drag drops a ledge this size — the classic arena's. */
const DEFAULT_LEDGE = { w: 128, h: 24 };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
/** Pointer travel (CSS px) before a press becomes a drag. */
const DRAG_SLOP = 3;

export interface CanvasApi {
	/** Fit the whole map into view. */
	fit(): void;
	/** Centre the view on a rect, zooming in if it is small. */
	frame(r: Rect): void;
	zoomBy(factor: number): void;
	view(): View;
	setPan(panX: number): void;
}

interface Props {
	map: EditorMap;
	tool: Tool;
	propType: string;
	selection: Selection | null;
	issues: readonly MapIssue[];
	grid: boolean;
	reach: boolean;
	flat: boolean;
	focus: Rect | null;
	onSelect: (sel: Selection | null) => void;
	onPreview: (map: EditorMap) => void;
	onCommit: (map: EditorMap, before: EditorMap, sel?: Selection | null) => void;
	onCursor: (p: { x: number; y: number } | null) => void;
	onView: (v: View) => void;
	apiRef: React.Ref<CanvasApi>;
}

type Gesture =
	| { kind: "none" }
	| { kind: "pan"; sx: number; sy: number; panX: number; panY: number }
	| {
			kind: "draw";
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			moved: boolean;
	  }
	| {
			kind: "move";
			sel: Selection;
			before: EditorMap;
			wx: number;
			wy: number;
			start: Rect;
			moved: boolean;
			sx: number;
			sy: number;
	  }
	| {
			kind: "resize";
			sel: Selection;
			before: EditorMap;
			handle: Handle;
			start: Rect;
	  }
	| { kind: "erase"; before: EditorMap; map: EditorMap };

/** The topmost object under a world point: spawns over props over platforms. */
function hitTest(
	map: EditorMap,
	x: number,
	y: number,
	pad = 0,
): Selection | null {
	for (let i = map.spawns.length - 1; i >= 0; i--) {
		const s = map.spawns[i];
		if (s && inRect(x, y, spawnRect(s), pad))
			return { kind: "spawn", id: s.id };
	}
	for (let i = map.props.length - 1; i >= 0; i--) {
		const p = map.props[i];
		if (p && inRect(x, y, propRect(p), pad)) return { kind: "prop", id: p.id };
	}
	for (let i = map.platforms.length - 1; i >= 0; i--) {
		const p = map.platforms[i];
		if (p && inRect(x, y, p, pad)) return { kind: "platform", id: p.id };
	}
	return null;
}

function resized(start: Rect, handle: Handle, x: number, y: number): Rect {
	let x0 = start.x;
	let y0 = start.y;
	let x1 = start.x + start.w;
	let y1 = start.y + start.h;
	if (handle.includes("w")) x0 = Math.min(snap(x), x1 - GRID);
	if (handle.includes("e")) x1 = Math.max(snap(x), x0 + GRID);
	if (handle.startsWith("n")) y0 = Math.min(snap(y), y1 - GRID);
	if (handle.startsWith("s")) y1 = Math.max(snap(y), y0 + GRID);
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const CURSORS: Record<Handle, string> = {
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
};

export function EditorCanvas(props: Props) {
	const {
		map,
		tool,
		propType,
		selection,
		issues,
		grid,
		reach,
		flat,
		focus,
		onSelect,
		onPreview,
		onCommit,
		onCursor,
		onView,
		apiRef,
	} = props;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const [view, setView] = useState<View>({
		zoom: 1,
		panX: 0,
		panY: 0,
		width: 800,
		height: 600,
	});
	const gesture = useRef<Gesture>({ kind: "none" });
	const [ghost, setGhost] = useState<Ghost | null>(null);
	const [hover, setHover] = useState<Selection | null>(null);
	const [cursor, setCursor] = useState("default");
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [artTick, setArtTick] = useState(0);
	/**
	 * Has the player moved the view? Until they do, every resize refits — the
	 * first layout settles over several frames (fonts, the tips strip
	 * wrapping), and a fit taken on the first one crops the map.
	 */
	const userMoved = useRef(false);
	const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
	const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

	// The theme's art arrives asynchronously; redraw once it has.
	useEffect(() => {
		if (artReady(map.theme)) return;
		let alive = true;
		loadArt(map.theme).then(() => {
			if (alive) setArtTick((t) => t + 1);
		});
		return () => {
			alive = false;
		};
	}, [map.theme]);

	const clampView = (v: View): View => {
		const W = mapWidth(map);
		const marginX = v.width / v.zoom / 2;
		const marginY = v.height / v.zoom / 2;
		return {
			...v,
			zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom)),
			panX: Math.max(-marginX, Math.min(W - marginX, v.panX)),
			panY: Math.max(-marginY, Math.min(MAP_H - marginY, v.panY)),
		};
	};

	const fitView = (v: View): View => {
		const W = mapWidth(map);
		// Fit the height first — a map is one screen tall — unless that leaves
		// a one-screen map wider than the canvas.
		const zoom = Math.min(
			(v.height - 24) / MAP_H,
			(v.width - 24) / Math.min(W, SCREEN_FIT_W),
		);
		return {
			...v,
			zoom,
			panX: W <= v.width / zoom ? -(v.width / zoom - W) / 2 : 0,
			panY: -(v.height / zoom - MAP_H) / 2,
		};
	};

	// Track the canvas's size; fit the map on first layout.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the first fit only — later fits are the toolbar's.
	useEffect(() => {
		const wrap = wrapRef.current;
		if (!wrap) return;
		const ro = new ResizeObserver(() => {
			const r = wrap.getBoundingClientRect();
			setView((v) => {
				const sized = {
					...v,
					width: Math.max(1, r.width),
					height: Math.max(1, r.height),
				};
				if (!userMoved.current) return fitView(sized);
				return sized;
			});
		});
		ro.observe(wrap);
		return () => ro.disconnect();
	}, []);

	// A new map (opened from the library, or a new template) is fitted afresh.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the map's identity and width, not its every edit.
	useEffect(() => {
		userMoved.current = false;
		setView((v) => fitView(v));
	}, [map.localId, map.screens]);

	useEffect(() => {
		onView(view);
	}, [view, onView]);

	// Draw.
	// biome-ignore lint/correctness/useExhaustiveDependencies(artTick): a redraw trigger, read for its change only.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.round(view.width * dpr);
		const h = Math.round(view.height * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawScene(ctx, map, view, {
			grid,
			reach,
			flat,
			issues,
			selection,
			hover,
			ghost,
			labels: true,
			focus,
		});
	}, [
		map,
		view,
		grid,
		reach,
		flat,
		issues,
		selection,
		hover,
		ghost,
		focus,
		artTick,
	]);

	useImperativeHandle(apiRef, () => ({
		fit: () => {
			userMoved.current = false;
			setView((v) => fitView(v));
		},
		frame: (r: Rect) => {
			userMoved.current = true;
			setView((v) => {
				const zoom = Math.max(
					v.zoom,
					Math.min(2.5, (v.height * 0.5) / Math.max(r.h, 48)),
				);
				return clampView({
					...v,
					zoom,
					panX: r.x + r.w / 2 - v.width / zoom / 2,
					panY: r.y + r.h / 2 - v.height / zoom / 2,
				});
			});
		},
		zoomBy: (f: number) => {
			userMoved.current = true;
			setView((v) => {
				const cx = v.panX + v.width / v.zoom / 2;
				const cy = v.panY + v.height / v.zoom / 2;
				const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * f));
				return clampView({
					...v,
					zoom,
					panX: cx - v.width / zoom / 2,
					panY: cy - v.height / zoom / 2,
				});
			});
		},
		view: () => view,
		setPan: (panX: number) => {
			userMoved.current = true;
			setView((v) => clampView({ ...v, panX }));
		},
	}));

	// Space held = temporary hand tool, like every drawing program.
	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.code === "Space" && !isTyping(e.target)) {
				e.preventDefault();
				setSpaceHeld(true);
			}
		};
		const up = (e: KeyboardEvent) => {
			if (e.code === "Space") setSpaceHeld(false);
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
		};
	}, []);

	const toWorld = (e: { clientX: number; clientY: number }) => {
		const r = canvasRef.current?.getBoundingClientRect();
		const sx = e.clientX - (r?.left ?? 0);
		const sy = e.clientY - (r?.top ?? 0);
		return {
			sx,
			sy,
			x: view.panX + sx / view.zoom,
			y: view.panY + sy / view.zoom,
		};
	};

	const handleAt = (x: number, y: number): Handle | null => {
		if (selection?.kind !== "platform") return null;
		const b = boundsOf(map, selection);
		if (!b) return null;
		const tol = 8 / view.zoom;
		for (const h of handles(b)) {
			if (Math.abs(h.x - x) <= tol && Math.abs(h.y - y) <= tol) return h.id;
		}
		return null;
	};

	const placementGhost = (x: number, y: number): Ghost | null => {
		if (x < 0 || x > mapWidth(map) || y < 0 || y > MAP_H) return null;
		if (tool === "spawn") {
			const s = spawnAt(map, x, y);
			return { kind: "spawn", x: s.x, y: s.y, facing: s.facing };
		}
		if (tool === "prop") {
			const p = propAt(map, propType, x, y);
			return { kind: "prop", type: p.type, x: p.x, y: p.y };
		}
		if (tool === "platform") {
			return {
				kind: "rect",
				rect: clampRect(
					{
						x: snap(x - DEFAULT_LEDGE.w / 2),
						y: snap(y - DEFAULT_LEDGE.h / 2),
						...DEFAULT_LEDGE,
					},
					map,
				),
			};
		}
		if (tool === "erase") return { kind: "erase", x, y };
		return null;
	};

	const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.setPointerCapture(e.pointerId);
		if (e.pointerType === "touch") {
			pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch.current.size === 2) {
				const [a, b] = [...pinch.current.values()];
				if (a && b)
					pinchStart.current = {
						dist: Math.hypot(a.x - b.x, a.y - b.y),
						zoom: view.zoom,
					};
				gesture.current = { kind: "none" };
				return;
			}
		}
		const { sx, sy, x, y } = toWorld(e);
		if (e.button === 1 || tool === "pan" || spaceHeld) {
			gesture.current = {
				kind: "pan",
				sx,
				sy,
				panX: view.panX,
				panY: view.panY,
			};
			setCursor("grabbing");
			return;
		}
		if (e.button !== 0) return;

		if (tool === "select") {
			const h = handleAt(x, y);
			const b = boundsOf(map, selection);
			if (h && selection && b) {
				gesture.current = {
					kind: "resize",
					sel: selection,
					before: map,
					handle: h,
					start: b,
				};
				return;
			}
			const hit = hitTest(map, x, y, 2 / view.zoom);
			if (hit) {
				onSelect(hit);
				const start = boundsOf(map, hit);
				if (start)
					gesture.current = {
						kind: "move",
						sel: hit,
						before: map,
						wx: x,
						wy: y,
						start,
						moved: false,
						sx,
						sy,
					};
				return;
			}
			onSelect(null);
			// Empty space pans: the most common thing a click on nothing means.
			gesture.current = {
				kind: "pan",
				sx,
				sy,
				panX: view.panX,
				panY: view.panY,
			};
			setCursor("grabbing");
			return;
		}
		if (tool === "platform") {
			const px = snap(x);
			const py = snap(y);
			gesture.current = {
				kind: "draw",
				x0: px,
				y0: py,
				x1: px,
				y1: py,
				moved: false,
			};
			return;
		}
		if (tool === "spawn") {
			if (x < 0 || x > mapWidth(map)) return;
			const r = addSpawn(map, spawnAt(map, x, y));
			if (r.id) onCommit(r.map, map, { kind: "spawn", id: r.id });
			return;
		}
		if (tool === "prop") {
			if (x < 0 || x > mapWidth(map)) return;
			const r = addProp(map, propAt(map, propType, x, y));
			if (r.id) onCommit(r.map, map, { kind: "prop", id: r.id });
			return;
		}
		if (tool === "erase") {
			const hit = hitTest(map, x, y, 2 / view.zoom);
			const next = hit ? removeObject(map, hit) : map;
			gesture.current = { kind: "erase", before: map, map: next };
			if (hit) onPreview(next);
		}
	};

	const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (e.pointerType === "touch" && pinch.current.has(e.pointerId)) {
			pinch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch.current.size === 2 && pinchStart.current) {
				const [a, b] = [...pinch.current.values()];
				if (a && b) {
					const dist = Math.hypot(a.x - b.x, a.y - b.y);
					zoomAbout(
						(a.x + b.x) / 2,
						(a.y + b.y) / 2,
						(pinchStart.current.zoom * dist) / pinchStart.current.dist,
					);
				}
				return;
			}
		}
		const { sx, sy, x, y } = toWorld(e);
		onCursor({ x: Math.round(x), y: Math.round(y) });
		const g = gesture.current;
		if (g.kind === "pan") {
			setView((v) =>
				clampView({
					...v,
					panX: g.panX - (sx - g.sx) / v.zoom,
					panY: g.panY - (sy - g.sy) / v.zoom,
				}),
			);
			return;
		}
		if (g.kind === "draw") {
			const x1 = snap(x);
			const y1 = snap(y);
			const moved =
				g.moved || Math.abs(x1 - g.x0) >= GRID || Math.abs(y1 - g.y0) >= GRID;
			gesture.current = { ...g, x1, y1, moved };
			setGhost(
				moved
					? { kind: "rect", rect: clampRect(rectFrom(g.x0, g.y0, x1, y1), map) }
					: placementGhost(x, y),
			);
			return;
		}
		if (g.kind === "move") {
			const moved = g.moved || Math.hypot(sx - g.sx, sy - g.sy) > DRAG_SLOP;
			if (!moved) return;
			gesture.current = { ...g, moved };
			const dx = x - g.wx;
			const dy = y - g.wy;
			if (g.sel.kind === "platform") {
				const r = moveRect(g.start, dx, dy, g.before);
				onPreview(updateObject(g.before, g.sel, r));
			} else if (g.sel.kind === "spawn") {
				// A spawn follows the cursor and drops onto what is under it.
				const s = spawnAt(
					g.before,
					g.start.x + g.start.w / 2 + dx,
					g.start.y + dy,
				);
				onPreview(updateObject(g.before, g.sel, { x: s.x, y: s.y }));
			} else {
				onPreview(
					updateObject(g.before, g.sel, {
						x: Math.round(g.start.x + dx),
						y: Math.round(g.start.y + dy),
					}),
				);
			}
			return;
		}
		if (g.kind === "resize") {
			onPreview(
				updateObject(g.before, g.sel, resized(g.start, g.handle, x, y)),
			);
			return;
		}
		if (g.kind === "erase") {
			const hit = hitTest(g.map, x, y, 2 / view.zoom);
			if (hit) {
				const next = removeObject(g.map, hit);
				gesture.current = { ...g, map: next };
				onPreview(next);
			}
			setGhost({ kind: "erase", x, y });
			return;
		}

		// Hover feedback only.
		if (tool === "select") {
			const h = handleAt(x, y);
			if (h) {
				setCursor(CURSORS[h]);
				setHover(null);
				return;
			}
			const hit = hitTest(map, x, y, 2 / view.zoom);
			setHover(hit);
			setCursor(spaceHeld ? "grab" : hit ? "move" : "default");
			setGhost(null);
			return;
		}
		setHover(tool === "erase" ? hitTest(map, x, y, 2 / view.zoom) : null);
		setCursor(spaceHeld || tool === "pan" ? "grab" : "crosshair");
		setGhost(placementGhost(x, y));
	};

	const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
		pinch.current.delete(e.pointerId);
		if (pinch.current.size < 2) pinchStart.current = null;
		const g = gesture.current;
		gesture.current = { kind: "none" };
		if (g.kind === "pan") {
			setCursor(spaceHeld || tool === "pan" ? "grab" : "default");
			return;
		}
		if (g.kind === "draw") {
			const { x, y } = toWorld(e);
			const rect = g.moved
				? clampRect(rectFrom(g.x0, g.y0, g.x1, g.y1), map)
				: clampRect(
						{
							x: snap(x - DEFAULT_LEDGE.w / 2),
							y: snap(y - DEFAULT_LEDGE.h / 2),
							...DEFAULT_LEDGE,
						},
						map,
					);
			const r = addPlatform(map, rect);
			if (r.id) onCommit(r.map, map, { kind: "platform", id: r.id });
			setGhost(placementGhost(x, y));
			return;
		}
		if (g.kind === "move") {
			if (g.moved) onCommit(map, g.before, g.sel);
			return;
		}
		if (g.kind === "resize") {
			onCommit(map, g.before, g.sel);
			return;
		}
		if (g.kind === "erase" && g.map !== g.before)
			onCommit(g.map, g.before, null);
	};

	const zoomAbout = (clientX: number, clientY: number, nextZoom: number) => {
		userMoved.current = true;
		const r = canvasRef.current?.getBoundingClientRect();
		const sx = clientX - (r?.left ?? 0);
		const sy = clientY - (r?.top ?? 0);
		setView((v) => {
			const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
			const wx = v.panX + sx / v.zoom;
			const wy = v.panY + sy / v.zoom;
			return clampView({
				...v,
				zoom,
				panX: wx - sx / zoom,
				panY: wy - sy / zoom,
			});
		});
	};

	// Wheel: a non-passive listener, because React's onWheel cannot cancel the
	// page's own scroll/zoom.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			userMoved.current = true;
			if (e.ctrlKey || e.metaKey) {
				const factor = Math.exp(-e.deltaY * 0.01);
				setView((v) => {
					const r = canvas.getBoundingClientRect();
					const sx = e.clientX - r.left;
					const sy = e.clientY - r.top;
					const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
					const wx = v.panX + sx / v.zoom;
					const wy = v.panY + sy / v.zoom;
					return clampView({
						...v,
						zoom,
						panX: wx - sx / zoom,
						panY: wy - sy / zoom,
					});
				});
				return;
			}
			// A map is wide, not tall: a plain wheel scrolls sideways.
			const dx = e.shiftKey ? e.deltaY : e.deltaX + e.deltaY;
			const dy = e.shiftKey ? e.deltaX : 0;
			setView((v) =>
				clampView({
					...v,
					panX: v.panX + dx / v.zoom,
					panY: v.panY + dy / v.zoom,
				}),
			);
		};
		canvas.addEventListener("wheel", wheel, { passive: false });
		return () => canvas.removeEventListener("wheel", wheel);
	});

	return (
		<div className="mm-canvas-wrap" ref={wrapRef}>
			<canvas
				ref={canvasRef}
				className="mm-canvas"
				data-testid="mapmaker-canvas"
				style={{
					cursor:
						spaceHeld && gesture.current.kind === "none" ? "grab" : cursor,
				}}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onPointerLeave={() => {
					setGhost(null);
					setHover(null);
					onCursor(null);
				}}
				onContextMenu={(e) => e.preventDefault()}
			/>
		</div>
	);
}

/** Fit a wide map to roughly one and a half screens, not to a sliver. */
const SCREEN_FIT_W = 1200;

export function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		el.isContentEditable
	);
}
