/**
 * The sprite workshop: an in-browser atlas slicer for raw art boards.
 *
 * Gemini and reference paintings are not production sheets — they are
 * labelled collages on baked backgrounds. This screen (`?slicer=true`) turns
 * them into the game's strip format live in the dev server:
 *
 *   1. **Pick a board** — every image in `unprocessed-sprites/` appears here
 *      automatically (the Vite middleware in `vite/config.dev.ts` lists it),
 *      and a board that is re-saved on disk hot-reloads itself.
 *   2. **Carve cells** — a uniform grid, or hand-drawn rects around each pose.
 *      An eyedropper erases a baked background colour to transparency.
 *   3. **Trim & pad** — each cell is cropped to its opaque content and
 *      re-centred in a uniform frame, which drops the panel borders and grid
 *      lines that sit *between* poses.
 *   4. **Curate** — name clips over the frames, play them on a stage at the
 *      game's own scale, flip through frames, and inspect any one magnified.
 *   5. **Export** — a clean horizontal strip of uniform cells (`<name>.png`)
 *      plus a small atlas JSON (`<name>.atlas.json`). The strip imports
 *      directly into Aseprite (Import Sprite Sheet, grid = cellW×cellH) for
 *      the pixel-level cleanup, and the JSON is what
 *      `src/game/render/assets.ts` accepts for a shipped sheet.
 *
 * This is a plain DOM screen on purpose: no Pixi, no match, no server — the
 * workshop is a tool, not part of the game loop.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../game/simulation/Arena";
import { HUD_CSS } from "./hudStyles";
import {
	atlasJson,
	cellRects,
	composeStrip,
	downloadCanvas,
	downloadJson,
	eraseColor,
	loadImage,
	processFrames,
	sheetName,
} from "./slicer/processing";
import type {
	BoardEntry,
	ClipDef,
	Rect,
	SliceMode,
	SliceSpec,
} from "./slicer/types";
import { DEFAULT_SPEC } from "./slicer/types";
import { SLICER_CSS } from "./slicerStyles";

const GRID = "rgba(255, 209, 102, 0.5)";
const HOVER = "rgba(14, 195, 201, 0.32)";
const SELECTED = "rgba(255, 209, 102, 0.25)";
const PICK = "rgba(255, 143, 107, 0.4)";

/** Clamp a number between two bounds. */
function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

/** A drag the sheet canvas is mid-way through. */
type SheetDrag =
	| {
			type: "pan";
			sx: number;
			sy: number;
			view: { scale: number; ox: number; oy: number };
	  }
	| { type: "draw"; ax: number; ay: number }
	| { type: "move"; index: number; gx: number; gy: number }
	| { type: "resize"; index: number };

export function SpriteSlicer() {
	const [boards, setBoards] = useState<BoardEntry[]>([]);
	const [boardEntry, setBoardEntry] = useState<BoardEntry | null>(null);
	const [boardImage, setBoardImage] = useState<HTMLImageElement | null>(null);
	const [spec, setSpec] = useState<SliceSpec>(DEFAULT_SPEC);
	const [clips, setClips] = useState<ClipDef[]>([]);
	const [activeClip, setActiveClip] = useState<number | null>(null);
	const [framesText, setFramesText] = useState("");
	const [framesError, setFramesError] = useState("");
	const [playing, setPlaying] = useState(false);
	const [playIdx, setPlayIdx] = useState(0);
	const [selected, setSelected] = useState<number[]>([]);
	const [hoverCell, setHoverCell] = useState<number | null>(null);
	const [selRect, setSelRect] = useState<number | null>(null);
	const [dragRect, setDragRect] = useState<Rect | null>(null);
	const [view, setView] = useState({ scale: 1, ox: 0, oy: 0 });
	const [tool, setTool] = useState<"slice" | "pick">("slice");
	const [spaceDown, setSpaceDown] = useState(false);
	const [stageZoom, setStageZoom] = useState(2);
	const [mirror, setMirror] = useState(false);
	const [sheetOut, setSheetOut] = useState("sheet");
	const [status, setStatus] = useState("");
	const [stageAssets, setStageAssets] = useState<{
		sky: HTMLImageElement;
		platform: HTMLImageElement;
	} | null>(null);

	const sheetRef = useRef<HTMLCanvasElement>(null);
	const filmRef = useRef<HTMLCanvasElement>(null);
	const stageRef = useRef<HTMLCanvasElement>(null);
	const detailRef = useRef<HTMLCanvasElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const dragRef = useRef<SheetDrag | null>(null);
	const filmGeo = useRef({ cellW: 40, total: 0 });

	const imgW = boardImage?.naturalWidth ?? 0;
	const imgH = boardImage?.naturalHeight ?? 0;

	// The erase pass is a full-image pixel loop with real DOM allocation — the
	// one computation here that must not re-run on every render.
	const working = useMemo(() => {
		if (!boardImage || !spec.erase?.enabled) return boardImage;
		return eraseColor(boardImage, imgW, imgH, spec.erase);
	}, [boardImage, spec.erase, imgW, imgH]);

	const cells = useMemo(
		() => (boardImage ? cellRects(spec, imgW, imgH) : []),
		[boardImage, spec, imgW, imgH],
	);

	const processed = useMemo(() => {
		if (!boardImage || !working) return { frames: [], cellW: 0, cellH: 0 };
		return processFrames(working, imgW, imgH, cells, spec);
	}, [boardImage, working, imgW, imgH, cells, spec]);

	const strip = useMemo(
		() =>
			processed.frames.length > 0
				? composeStrip(processed.frames, processed.cellW, processed.cellH)
				: null,
		[processed],
	);

	const atlas = useMemo(
		() => atlasJson(sheetOut, cells, processed, clips),
		[sheetOut, cells, processed, clips],
	);

	// The cells that still exist after a slice change (deleting a rect must
	// not leave a selection or clip pointing at nothing).
	const liveCells = useMemo(() => new Set(cells.map((_, i) => i)), [cells]);
	const liveSelected = selected.filter((i) => liveCells.has(i));
	const mag = hoverCell ?? liveSelected[liveSelected.length - 1] ?? null;

	// ---- boards: poll the folder, load, hot-reload ----
	useEffect(() => {
		let alive = true;
		const poll = async () => {
			try {
				const res = await fetch("/unprocessed/list.json");
				if (!res.ok) return;
				const list: BoardEntry[] = await res.json();
				if (alive) setBoards(list);
			} catch {
				// The dev middleware is absent (prod build, plain static host) —
				// the file picker still works.
			}
		};
		poll();
		const timer = setInterval(poll, 2000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, []);

	// A board that changed on disk reloads itself — save from Gemini, come
	// back a moment later and the workshop is already showing the new art.
	// biome-ignore lint/correctness/useExhaustiveDependencies(loadBoard): reloading a changed board is an intent, not a dep — loadBoard always reads the latest state.
	useEffect(() => {
		if (!boardEntry) return;
		const fresh = boards.find((b) => b.name === boardEntry.name);
		if (!fresh) return;
		// Either side changing means the file was rewritten — a re-save can
		// leave the byte size identical, so mtime alone must be enough.
		if (fresh.mtime === boardEntry.mtime && fresh.size === boardEntry.size) {
			return;
		}
		void loadBoard(fresh);
		// biome-ignore lint/correctness/useExhaustiveDependencies(loadBoard): reloading a changed board is an intent, not a dep — loadBoard always reads the latest state.
	}, [boards, boardEntry]);

	// The stage backdrop: the game's own sky and platform textures, so the
	// preview reads like the real arena.
	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				const [sky, platform] = await Promise.all([
					loadImage("assets/sky.png"),
					loadImage("assets/platform.png"),
				]);
				if (alive) setStageAssets({ sky, platform });
			} catch {
				if (alive) setStageAssets(null);
			}
		})();
		return () => {
			alive = false;
		};
	}, []);

	// The workspace survives a refresh: per-board slice spec, clips and the
	// active clip ride along in localStorage.
	useEffect(() => {
		if (!boardEntry) return;
		try {
			localStorage.setItem(
				`vsw:${boardEntry.name}`,
				JSON.stringify({ spec, clips, activeClip }),
			);
		} catch {
			// Full storage — the workshop still works, it just forgets.
		}
	}, [boardEntry, spec, clips, activeClip]);

	// ---- loading ----
	function loadBoard(entry: BoardEntry) {
		setStatus(`loading ${entry.name}…`);
		void loadImage(
			`/unprocessed/${encodeURIComponent(entry.name)}?t=${Date.now()}`,
		)
			.then((img) => {
				setBoardImage(img);
				setBoardEntry(entry);
				setSheetOut(sheetName(entry.name));
				setSelected([]);
				setSelRect(null);
				setPlaying(false);
				setPlayIdx(0);
				const saved = localStorage.getItem(`vsw:${entry.name}`);
				if (saved) {
					try {
						const ws = JSON.parse(saved) as {
							spec?: Partial<SliceSpec>;
							clips?: ClipDef[];
							activeClip?: number | null;
						};
						setSpec({ ...DEFAULT_SPEC, ...ws.spec });
						setClips(ws.clips ?? []);
						setActiveClip(ws.activeClip ?? null);
					} catch {
						setSpec(DEFAULT_SPEC);
						setClips([]);
						setActiveClip(null);
					}
				} else {
					setSpec(DEFAULT_SPEC);
					setClips([]);
					setActiveClip(null);
				}
				setStatus(`${entry.name} · ${img.naturalWidth}×${img.naturalHeight}`);
			})
			.catch((err: unknown) => {
				setStatus(
					err instanceof Error ? err.message : `could not load ${entry.name}`,
				);
			});
	}

	async function loadFile(file: File) {
		try {
			const url = URL.createObjectURL(file);
			const img = await loadImage(url);
			setBoardImage(img);
			setBoardEntry({ name: file.name, size: file.size, mtime: 0 });
			setSheetOut(sheetName(file.name));
			setSelected([]);
			setSelRect(null);
			setPlaying(false);
			setPlayIdx(0);
			const saved = localStorage.getItem(`vsw:${file.name}`);
			if (saved) {
				try {
					const ws = JSON.parse(saved) as {
						spec?: Partial<SliceSpec>;
						clips?: ClipDef[];
						activeClip?: number | null;
					};
					setSpec({ ...DEFAULT_SPEC, ...ws.spec });
					setClips(ws.clips ?? []);
					setActiveClip(ws.activeClip ?? null);
				} catch {
					setSpec(DEFAULT_SPEC);
					setClips([]);
					setActiveClip(null);
				}
			} else {
				setSpec(DEFAULT_SPEC);
				setClips([]);
				setActiveClip(null);
			}
			setStatus(
				`${file.name} (picked) · ${img.naturalWidth}×${img.naturalHeight}`,
			);
		} catch {
			setStatus(`could not read ${file.name}`);
		}
	}

	// Fit a newly loaded board into the viewport.
	useEffect(() => {
		if (!boardImage) return;
		const host = sheetRef.current?.parentElement;
		const W = host?.clientWidth ?? 800;
		const H = host?.clientHeight ?? 500;
		const scale = Math.min(2, Math.min((W - 48) / imgW, (H - 48) / imgH));
		setView({
			scale: Math.max(0.05, scale),
			ox: (W - imgW * scale) / 2,
			oy: (H - imgH * scale) / 2,
		});
	}, [boardImage, imgW, imgH]);

	// ---- playback ----
	useEffect(() => {
		if (activeClip !== null) setPlayIdx(0);
	}, [activeClip]);

	useEffect(() => {
		if (!playing) return;
		const clip = activeClip !== null ? clips[activeClip] : null;
		if (!clip || clip.frames.length < 2) {
			setPlaying(false);
			return;
		}
		let raf = 0;
		let last = performance.now();
		const loop = (t: number) => {
			const dt = t - last;
			last = t;
			setPlayIdx((i) => {
				const next = i + (dt / 1000) * clip.fps;
				if (next >= clip.frames.length) {
					return clip.loop ? next % clip.frames.length : clip.frames.length - 1;
				}
				return next;
			});
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [playing, activeClip, clips]);

	// A clip being edited types into its own buffer; the frames only commit on
	// blur, so a half-typed range does not fight the re-render.
	useEffect(() => {
		if (activeClip === null) {
			setFramesText("");
			return;
		}
		setFramesText(clips[activeClip]?.frames.join(", ") ?? "");
	}, [activeClip, clips]);

	// ---- helpers ----
	const updateActiveClip = (fn: (c: ClipDef) => ClipDef) => {
		if (activeClip === null) return;
		setClips((prev) => prev.map((c, i) => (i === activeClip ? fn(c) : c)));
	};

	const setRect = (index: number, r: Rect) => {
		setSpec((s) => ({
			...s,
			rects: s.rects.map((x, j) => (j === index ? r : x)),
		}));
	};

	const setSpecField = <K extends keyof SliceSpec>(
		key: K,
		value: SliceSpec[K],
	) => setSpec((s) => ({ ...s, [key]: value }));

	const toggleSelect = (i: number) => {
		setSelected((prev) =>
			prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
		);
	};

	const commitFrames = () => {
		const parsed = parseFrames(framesText);
		if (parsed) {
			updateActiveClip((c) => ({ ...c, frames: parsed }));
			setFramesError("");
		} else {
			setFramesError("bad frame list — try 0-3, 5, 8");
		}
	};

	// ---- the sheet canvas ----
	const offset = (e: React.PointerEvent<HTMLCanvasElement>) => ({
		x: e.nativeEvent.offsetX,
		y: e.nativeEvent.offsetY,
	});

	const sheetToImage = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const o = offset(e);
		return {
			x: (o.x - view.ox) / view.scale,
			y: (o.y - view.oy) / view.scale,
		};
	};

	const cellAt = (p: { x: number; y: number }): number | null => {
		for (let i = cells.length - 1; i >= 0; i--) {
			const r = cells[i];
			if (!r) continue;
			if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
				return i;
			}
		}
		return null;
	};

	const onSheetPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const canvas = sheetRef.current;
		if (!canvas) return;
		canvas.setPointerCapture(e.pointerId);
		const p = sheetToImage(e);

		if (tool === "pick") {
			// Sample the *raw* board, not the erased copy: the colour being
			// removed is the one that is still there.
			if (!boardImage) return;
			const c = document.createElement("canvas");
			c.width = imgW;
			c.height = imgH;
			const cx = c.getContext("2d", { willReadFrequently: true });
			if (!cx) return;
			cx.drawImage(boardImage, 0, 0);
			const d = cx.getImageData(
				clamp(Math.round(p.x), 0, imgW - 1),
				clamp(Math.round(p.y), 0, imgH - 1),
				1,
				1,
			).data;
			const r = d[0] ?? 0;
			const g = d[1] ?? 0;
			const b = d[2] ?? 0;
			setSpec((s) => ({
				...s,
				erase: {
					r,
					g,
					b,
					tolerance: s.erase?.tolerance ?? 32,
					enabled: true,
				},
			}));
			setTool("slice");
			setStatus(
				`erasing #${hex(r)}${hex(g)}${hex(b)} (tol ${spec.erase?.tolerance ?? 32})`,
			);
			return;
		}

		const pan = spaceDown || e.button === 1;
		if (pan || spec.mode === "grid") {
			const o = offset(e);
			dragRef.current = { type: "pan", sx: o.x, sy: o.y, view };
			return;
		}
		// Rects mode: a selected rect's corner handle resizes it, a body
		// moves it, empty space draws a new one.
		const o = offset(e);
		const selected = selRect;
		const handle = selected !== null ? handleRect(cells[selected], view) : null;
		if (
			handle &&
			selected !== null &&
			o.x >= handle.x &&
			o.x <= handle.x + handle.w &&
			o.y >= handle.y &&
			o.y <= handle.y + handle.h
		) {
			dragRef.current = { type: "resize", index: selected };
			return;
		}
		const hit = cellAt(p);
		if (hit !== null) {
			const r = cells[hit];
			if (!r) return;
			dragRef.current = {
				type: "move",
				index: hit,
				gx: p.x - r.x,
				gy: p.y - r.y,
			};
			return;
		}
		dragRef.current = { type: "draw", ax: p.x, ay: p.y };
		setDragRect({ x: p.x, y: p.y, w: 0, h: 0 });
	};

	const onSheetPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const p = sheetToImage(e);
		setHoverCell(tool === "slice" ? cellAt(p) : null);

		const drag = dragRef.current;
		if (!drag) return;
		if (drag.type === "pan") {
			const o = offset(e);
			setView({
				...drag.view,
				ox: drag.view.ox + (o.x - drag.sx),
				oy: drag.view.oy + (o.y - drag.sy),
			});
		} else if (drag.type === "draw") {
			const r = normalizeRect(drag.ax, drag.ay, p.x, p.y);
			if (r) setDragRect(r);
		} else if (drag.type === "move") {
			const r = cells[drag.index];
			if (!r) return;
			setRect(drag.index, {
				x: Math.round(p.x - drag.gx),
				y: Math.round(p.y - drag.gy),
				w: r.w,
				h: r.h,
			});
		} else if (drag.type === "resize") {
			const r = cells[drag.index];
			if (!r) return;
			setRect(drag.index, {
				x: r.x,
				y: r.y,
				w: Math.max(2, Math.round(p.x - r.x)),
				h: Math.max(2, Math.round(p.y - r.y)),
			});
		}
	};

	const onSheetPointerUp = () => {
		const drag = dragRef.current;
		dragRef.current = null;
		if (
			drag?.type === "draw" &&
			dragRect &&
			dragRect.w >= 2 &&
			dragRect.h >= 2
		) {
			setSpec((s) => {
				const rects = [...s.rects, dragRect];
				return { ...s, rects, mode: "rects" };
			});
			setSelRect(cells.length);
		}
		setDragRect(null);
	};

	const zoomAt = (factor: number, cx: number, cy: number) => {
		setView((v) => {
			const scale = clamp(v.scale * factor, 0.05, 24);
			const wx = (cx - v.ox) / v.scale;
			const wy = (cy - v.oy) / v.scale;
			return { scale, ox: cx - wx * scale, oy: cy - wy * scale };
		});
	};

	const fitView = () => {
		const host = sheetRef.current?.parentElement;
		const W = host?.clientWidth ?? 800;
		const H = host?.clientHeight ?? 500;
		const scale = Math.min(2, Math.min((W - 48) / imgW, (H - 48) / imgH));
		setView({
			scale: Math.max(0.05, scale),
			ox: (W - imgW * scale) / 2,
			oy: (H - imgH * scale) / 2,
		});
	};

	// Wheel zoom has to be non-passive to preventDefault the page scroll.
	// biome-ignore lint/correctness/useExhaustiveDependencies(zoomAt): zoomAt closes over setters only — the compiler memoises it stably.
	useEffect(() => {
		const canvas = sheetRef.current;
		if (!canvas) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
			zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
		};
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", onWheel);
	}, []);

	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
			if (e.code === "Space") {
				e.preventDefault();
				setSpaceDown(true);
			} else if (e.key === "Escape") {
				// Abort a rect being drawn; the half-drawn outline disappears.
				dragRef.current = null;
				setDragRect(null);
			} else if (e.key === "Delete" && selRect !== null) {
				setSpec((s) => {
					if (s.mode !== "rects") return s;
					return { ...s, rects: s.rects.filter((_, j) => j !== selRect) };
				});
				setSelRect(null);
			}
		};
		const up = (e: KeyboardEvent) => {
			if (e.code === "Space") setSpaceDown(false);
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
		};
	}, [selRect]);

	// ---- drawing ----
	useEffect(() => {
		const canvas = sheetRef.current;
		const host = canvas?.parentElement;
		if (!canvas || !host) return;
		const dpr = window.devicePixelRatio || 1;
		const W = host.clientWidth;
		const H = host.clientHeight;
		if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
			canvas.width = W * dpr;
			canvas.height = H * dpr;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = "#0a0a0d";
		ctx.fillRect(0, 0, W, H);
		if (!boardImage) {
			ctx.fillStyle = "rgba(255,255,255,0.25)";
			ctx.font = "16px monospace";
			ctx.textAlign = "center";
			ctx.fillText(
				"drop a board here, or open one from the list",
				W / 2,
				H / 2,
			);
			return;
		}
		if (!working) return;
		const { scale, ox, oy } = view;
		checker(ctx, ox, oy, imgW * scale, imgH * scale, scale);
		ctx.drawImage(working, ox, oy, imgW * scale, imgH * scale);
		drawCells(
			ctx,
			cells,
			view,
			hoverCell,
			liveSelected,
			selRect,
			dragRect,
			tool,
			spec.mode,
		);
	}, [
		boardImage,
		working,
		view,
		cells,
		hoverCell,
		liveSelected,
		selRect,
		dragRect,
		tool,
		spec.mode,
		imgW,
		imgH,
	]);

	useEffect(() => {
		const canvas = filmRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
		ctx.fillStyle = "#0a0a0d";
		ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
		// Cells are pixel art; downscaling them with smoothing on reads as a
		// blur, which is exactly what the game avoids with its renderer.
		ctx.imageSmoothingEnabled = false;
		const geo = filmGeometry(processed);
		filmGeo.current = geo;
		canvas.width = dpr * Math.max(1, Math.ceil(geo.total));
		canvas.height = dpr * geo.H;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const clip = activeClip !== null ? clips[activeClip] : null;
		const playingIndex = clip && playing ? Math.floor(playIdx) : null;
		processed.frames.forEach((f, i) => {
			const x = 4 + i * (geo.cellW + 4);
			ctx.drawImage(f.canvas, x, 4, geo.cellW, geo.H - 8);
			if (liveSelected.includes(i)) {
				ctx.strokeStyle = SELECTED;
				ctx.lineWidth = 2;
				ctx.strokeRect(x + 1, 4, geo.cellW - 2, geo.H - 8);
			}
			if (playingIndex === i) {
				ctx.strokeStyle = "#0ec3c9";
				ctx.lineWidth = 2;
				ctx.strokeRect(x, 3, geo.cellW, geo.H - 6);
			}
		});
		if (processed.frames.length <= 48) {
			ctx.fillStyle = "rgba(255,255,255,0.5)";
			ctx.font = "10px monospace";
			ctx.textAlign = "center";
			processed.frames.forEach((_, i) => {
				const x = 4 + i * (geo.cellW + 4);
				ctx.fillText(String(i), x + geo.cellW / 2, geo.H - 1);
			});
		}
	}, [processed, liveSelected, activeClip, playing, playIdx, clips]);

	useEffect(() => {
		const canvas = detailRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const S = 4;
		canvas.width = dpr * 132;
		canvas.height = dpr * 132;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = "#17171c";
		ctx.fillRect(0, 0, 132, 132);
		const frame = mag !== null ? processed.frames[mag] : null;
		if (!frame) return;
		const cw = frame.canvas.width * S;
		const ch = frame.canvas.height * S;
		const ox = (132 - cw) / 2;
		const oy = (132 - ch) / 2;
		ctx.drawImage(frame.canvas, ox, oy, cw, ch);
		if (frame.content && S >= 4) {
			ctx.strokeStyle = "rgba(255, 209, 102, 0.8)";
			ctx.lineWidth = 1;
			ctx.strokeRect(
				ox + frame.content.x * S,
				oy + frame.content.y * S,
				frame.content.w * S,
				frame.content.h * S,
			);
		}
		ctx.strokeStyle = "rgba(255,255,255,0.2)";
		ctx.strokeRect(0.5, 0.5, 131, 131);
	}, [processed, mag]);

	useEffect(() => {
		const canvas = stageRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const W = canvas.clientWidth;
		const H = canvas.clientHeight;
		if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
			canvas.width = W * dpr;
			canvas.height = H * dpr;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		if (stageAssets) {
			ctx.drawImage(stageAssets.sky, 0, 0, W, H);
		} else {
			const g = ctx.createLinearGradient(0, 0, 0, H);
			g.addColorStop(0, "#cfeefc");
			g.addColorStop(1, "#9fd8ea");
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, W, H);
		}
		const groundY = H - Math.max(28, H * 0.16);
		if (stageAssets) {
			ctx.drawImage(stageAssets.platform, 0, groundY, W, H - groundY);
		} else {
			ctx.fillStyle = "#b98a4e";
			ctx.fillRect(0, groundY, W, H - groundY);
		}
		const clip = activeClip !== null ? clips[activeClip] : null;
		const frameIndex =
			clip && clip.frames.length > 0 && playing
				? clip.frames[Math.floor(playIdx) % clip.frames.length]
				: clip && clip.frames.length > 0
					? clip.frames[0]
					: null;
		const frame = frameIndex != null ? processed.frames[frameIndex] : null;
		const s = (PLAYER_HEIGHT * stageZoom) / processed.cellH;
		const cx = W / 2;
		if (frame) {
			ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
			ctx.beginPath();
			ctx.ellipse(
				cx,
				groundY + 3,
				18 * stageZoom * 0.5,
				4 * stageZoom * 0.5,
				0,
				0,
				Math.PI * 2,
			);
			ctx.fill();
			ctx.save();
			ctx.translate(cx, groundY);
			if (mirror) ctx.scale(-1, 1);
			ctx.drawImage(
				frame.canvas,
				(-frame.canvas.width * s) / 2,
				-frame.canvas.height * s,
				frame.canvas.width * s,
				frame.canvas.height * s,
			);
			ctx.restore();
		}
		// The collider: the fighter's real size in the game, drawn where the
		// sprite's feet are — what the art has to fit inside. Two strokes: a
		// soft halo so the box reads over the bright sky, then the line itself.
		ctx.setLineDash([4, 3]);
		ctx.lineWidth = 3;
		ctx.strokeStyle = "rgba(14, 195, 201, 0.25)";
		ctx.strokeRect(
			cx - (PLAYER_WIDTH * stageZoom) / 2,
			groundY - PLAYER_HEIGHT * stageZoom,
			PLAYER_WIDTH * stageZoom,
			PLAYER_HEIGHT * stageZoom,
		);
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = "#0ec3c9";
		ctx.strokeRect(
			cx - (PLAYER_WIDTH * stageZoom) / 2,
			groundY - PLAYER_HEIGHT * stageZoom,
			PLAYER_WIDTH * stageZoom,
			PLAYER_HEIGHT * stageZoom,
		);
		ctx.setLineDash([]);
		if (frameIndex !== null) {
			ctx.fillStyle = "rgba(255,255,255,0.75)";
			ctx.font = "11px monospace";
			ctx.textAlign = "right";
			ctx.fillText(`frame ${frameIndex}`, W - 6, 14);
		}
	}, [
		processed,
		activeClip,
		clips,
		playing,
		playIdx,
		mirror,
		stageZoom,
		stageAssets,
	]);

	// ---- export ----
	const exportStrip = () => {
		if (!strip) return;
		downloadCanvas(strip, `${sheetOut}.png`);
	};

	const exportJson = () => {
		downloadJson(atlas, `${sheetOut}.atlas.json`);
	};

	const copyJson = async () => {
		try {
			await navigator.clipboard.writeText(JSON.stringify(atlas, null, "\t"));
			setStatus("atlas JSON copied");
		} catch {
			setStatus("clipboard unavailable");
		}
	};

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (file) void loadFile(file);
	};

	// ---- render ----
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the whole workshop is a drop target by design — drag a board anywhere onto the window.
		<div
			className="vsw-root"
			onDragOver={(e) => e.preventDefault()}
			onDrop={onDrop}
		>
			<style>{HUD_CSS}</style>
			<style>{SLICER_CSS}</style>

			<header className="vsw-bar">
				<span className="vsw-logo">SPRITE WORKSHOP</span>
				<label className="vsw-board-label" htmlFor="vsw-board">
					board
				</label>
				<select
					id="vsw-board"
					className="vsw-select"
					value={boardEntry?.name ?? ""}
					onChange={(e) => {
						const entry = boards.find((b) => b.name === e.target.value);
						if (entry) loadBoard(entry);
					}}
				>
					<option value="">— none —</option>
					{boards.map((b) => (
						<option key={b.name} value={b.name}>
							{b.name}
						</option>
					))}
				</select>
				<button
					type="button"
					className="vd-btn vsw-btn"
					onClick={() => fileRef.current?.click()}
				>
					open…
				</button>
				<input
					ref={fileRef}
					type="file"
					accept="image/png,image/jpeg,image/webp"
					style={{ display: "none" }}
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) void loadFile(f);
						e.target.value = "";
					}}
				/>
				{boardEntry && (
					<button
						type="button"
						className="vd-btn vsw-btn"
						onClick={() => loadBoard(boardEntry)}
					>
						reload
					</button>
				)}
				<a className="vd-btn vsw-btn vsw-back" href=".">
					← menu
				</a>
				<span className="vsw-status">{status}</span>
			</header>

			<div className="vsw-body">
				<section className="vsw-workspace">
					<div className="vsw-viewport">
						<canvas
							ref={sheetRef}
							className="vsw-sheet"
							style={{ cursor: sheetCursor(tool, spec.mode, spaceDown) }}
							onPointerDown={onSheetPointerDown}
							onPointerMove={onSheetPointerMove}
							onPointerUp={onSheetPointerUp}
							onPointerLeave={() => setHoverCell(null)}
						/>
					</div>
					<div className="vsw-readout">
						<span>
							{mag !== null && hoverCell !== null
								? cellReadout(cells[mag])
								: "\u00a0"}
						</span>
						<span className="vsw-zoom">
							<button
								type="button"
								className="vd-btn vsw-mini"
								onClick={() => zoomAt(0.8, 300, 200)}
							>
								−
							</button>
							<span className="vsw-zoom-num">
								{Math.round(view.scale * 100)}%
							</span>
							<button
								type="button"
								className="vd-btn vsw-mini"
								onClick={() => zoomAt(1.25, 300, 200)}
							>
								+
							</button>
							<button
								type="button"
								className="vd-btn vsw-mini"
								onClick={fitView}
							>
								fit
							</button>
						</span>
					</div>
					<div className="vsw-film-wrap">
						<canvas
							ref={filmRef}
							className="vsw-film"
							onPointerDown={(e) => {
								const i = Math.floor(
									(e.nativeEvent.offsetX - 4) / (filmGeo.current.cellW + 4),
								);
								if (i >= 0 && i < processed.frames.length) toggleSelect(i);
							}}
						/>
					</div>
				</section>

				<aside className="vsw-side">
					<section className="vsw-panel">
						<h2 className="vsw-head">Slice</h2>
						<div className="vd-choice vsw-chips">
							<button
								type="button"
								className={`vd-chip ${spec.mode === "grid" ? "vd-chip-on" : ""}`}
								onClick={() => setSpecField("mode", "grid")}
							>
								grid
							</button>
							<button
								type="button"
								className={`vd-chip ${spec.mode === "rects" ? "vd-chip-on" : ""}`}
								onClick={() => setSpecField("mode", "rects")}
							>
								rects
							</button>
							<button
								type="button"
								className={`vd-chip ${tool === "pick" ? "vd-chip-on" : ""}`}
								onClick={() => setTool(tool === "pick" ? "slice" : "pick")}
							>
								{tool === "pick" ? "click a colour…" : "erase colour"}
							</button>
						</div>
						{spec.erase && (
							<div className="vsw-row">
								<span
									className="vsw-swatch"
									style={{
										background: `rgb(${spec.erase.r},${spec.erase.g},${spec.erase.b})`,
									}}
								/>
								<label className="vsw-check">
									<input
										type="checkbox"
										checked={spec.erase.enabled}
										onChange={(e) =>
											setSpec((s) =>
												s.erase
													? {
															...s,
															erase: { ...s.erase, enabled: e.target.checked },
														}
													: s,
											)
										}
									/>
									erase to transparent
								</label>
								<label className="vsw-inline-num">
									tol
									<input
										type="number"
										min={0}
										max={200}
										value={spec.erase.tolerance}
										onChange={(e) =>
											setSpec((s) =>
												s.erase
													? {
															...s,
															erase: {
																...s.erase,
																tolerance: Number(e.target.value),
															},
														}
													: s,
											)
										}
									/>
								</label>
							</div>
						)}

						{spec.mode === "grid" ? (
							<div className="vsw-grid">
								<label className="vsw-num">
									cols
									<input
										type="number"
										min={1}
										max={128}
										value={spec.cols}
										onChange={(e) =>
											setSpecField(
												"cols",
												clamp(Number(e.target.value) || 1, 1, 128),
											)
										}
									/>
								</label>
								<label className="vsw-num">
									rows
									<input
										type="number"
										min={1}
										max={128}
										value={spec.rows}
										onChange={(e) =>
											setSpecField(
												"rows",
												clamp(Number(e.target.value) || 1, 1, 128),
											)
										}
									/>
								</label>
								<label className="vsw-num">
									cell W
									<input
										type="number"
										min={0}
										value={spec.cellW}
										onChange={(e) =>
											setSpecField(
												"cellW",
												clamp(Number(e.target.value) || 0, 0, 4096),
											)
										}
									/>
								</label>
								<label className="vsw-num">
									cell H
									<input
										type="number"
										min={0}
										value={spec.cellH}
										onChange={(e) =>
											setSpecField(
												"cellH",
												clamp(Number(e.target.value) || 0, 0, 4096),
											)
										}
									/>
								</label>
								<label className="vsw-num">
									off X
									<input
										type="number"
										value={spec.offX}
										onChange={(e) =>
											setSpecField("offX", Number(e.target.value))
										}
									/>
								</label>
								<label className="vsw-num">
									off Y
									<input
										type="number"
										value={spec.offY}
										onChange={(e) =>
											setSpecField("offY", Number(e.target.value))
										}
									/>
								</label>
								<label className="vsw-num">
									gap X
									<input
										type="number"
										min={0}
										value={spec.gapX}
										onChange={(e) =>
											setSpecField("gapX", Math.max(0, Number(e.target.value)))
										}
									/>
								</label>
								<label className="vsw-num">
									gap Y
									<input
										type="number"
										min={0}
										value={spec.gapY}
										onChange={(e) =>
											setSpecField("gapY", Math.max(0, Number(e.target.value)))
										}
									/>
								</label>
								<p className="vsw-hint">
									cell W/H = 0 means "fit the board". Drag pans · wheel zooms.
								</p>
							</div>
						) : (
							<div className="vsw-rects">
								<p className="vsw-hint">
									Drag on the board to draw a cell, drag a cell to move it, its
									corner dot resizes it. Click selects; Delete removes.
								</p>
								<ul className="vsw-rect-list">
									{spec.rects.map((r, i) => (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: rects append and filter, never reorder — the index is the cell's own index.
											key={i}
											className={i === selRect ? "vsw-rect-on" : ""}
											onPointerDown={() => setSelRect(i)}
										>
											<span>
												#{i} · {Math.round(r.x)},{Math.round(r.y)} ·{" "}
												{Math.round(r.w)}×{Math.round(r.h)}
											</span>
											<button
												type="button"
												className="vd-btn vsw-mini vsw-del"
												onClick={(e) => {
													e.stopPropagation();
													setSpec((s) => ({
														...s,
														rects: s.rects.filter((_, j) => j !== i),
													}));
													setSelRect(null);
												}}
											>
												✕
											</button>
										</li>
									))}
								</ul>
								<button
									type="button"
									className="vd-btn vsw-btn"
									disabled={spec.rects.length === 0}
									onClick={() => {
										setSpecField("rects", []);
										setSelRect(null);
									}}
								>
									clear all
								</button>
							</div>
						)}

						<div className="vsw-row">
							<label className="vsw-check">
								<input
									type="checkbox"
									checked={spec.trim}
									onChange={(e) => setSpecField("trim", e.target.checked)}
								/>
								trim to content
							</label>
							<label className="vsw-inline-num">
								margin
								<input
									type="number"
									min={0}
									max={64}
									value={spec.margin}
									onChange={(e) =>
										setSpecField(
											"margin",
											clamp(Number(e.target.value) || 0, 0, 64),
										)
									}
								/>
							</label>
						</div>
						<div className="vsw-row">
							<label className="vsw-inline-num">
								frame W (0=auto)
								<input
									type="number"
									min={0}
									value={spec.padW}
									onChange={(e) =>
										setSpecField(
											"padW",
											clamp(Number(e.target.value) || 0, 0, 2048),
										)
									}
								/>
							</label>
							<label className="vsw-inline-num">
								frame H (0=auto)
								<input
									type="number"
									min={0}
									value={spec.padH}
									onChange={(e) =>
										setSpecField(
											"padH",
											clamp(Number(e.target.value) || 0, 0, 2048),
										)
									}
								/>
							</label>
						</div>
						<div className="vd-choice vsw-chips">
							{(["bottom", "center", "top"] as const).map((a) => (
								<button
									key={a}
									type="button"
									className={`vd-chip ${spec.align === a ? "vd-chip-on" : ""}`}
									onClick={() => setSpecField("align", a)}
								>
									{a}
								</button>
							))}
						</div>
					</section>

					<section className="vsw-panel">
						<h2 className="vsw-head">Frames</h2>
						<p className="vsw-hint">
							{processed.frames.length} frames · {processed.cellW}×
							{processed.cellH} cells · strip{" "}
							{processed.frames.length * processed.cellW}px wide
						</p>
						<div className="vsw-detail">
							<canvas ref={detailRef} />
							<span className="vsw-detail-note">
								{mag !== null ? `frame ${mag}` : "hover a frame"}
							</span>
						</div>
					</section>

					<section className="vsw-panel">
						<h2 className="vsw-head">Clips</h2>
						<div className="vd-choice vsw-chips">
							<button
								type="button"
								className="vd-chip"
								onClick={() => {
									setClips((prev) => [
										...prev,
										{
											name: `clip ${prev.length + 1}`,
											frames: liveSelected,
											fps: 10,
											loop: true,
										},
									]);
									setActiveClip(clips.length);
									setPlaying(false);
								}}
							>
								+ new
							</button>
							{clips.map((c, i) => (
								<button
									// biome-ignore lint/suspicious/noArrayIndexKey: clips append and filter, never reorder — the index is the clip's identity in the list.
									key={i}
									type="button"
									className={`vd-chip ${i === activeClip ? "vd-chip-on" : ""}`}
									onClick={() => {
										setActiveClip(i);
										setPlaying(false);
									}}
								>
									{c.name}
								</button>
							))}
						</div>
						{activeClip !== null && (
							<div className="vsw-clip-edit">
								<div className="vsw-row">
									<label className="vsw-inline-num vsw-name">
										name
										<input
											type="text"
											value={clips[activeClip]?.name ?? ""}
											onChange={(e) =>
												updateActiveClip((c) => ({
													...c,
													name: e.target.value,
												}))
											}
										/>
									</label>
									<label className="vsw-inline-num">
										fps
										<input
											type="number"
											min={1}
											max={60}
											value={clips[activeClip]?.fps ?? 10}
											onChange={(e) =>
												updateActiveClip((c) => ({
													...c,
													fps: clamp(Number(e.target.value) || 10, 1, 60),
												}))
											}
										/>
									</label>
								</div>
								<label className="vsw-label">
									frames
									<input
										type="text"
										value={framesText}
										onChange={(e) => setFramesText(e.target.value)}
										onBlur={commitFrames}
										onKeyDown={(e) => {
											if (e.key === "Enter") commitFrames();
										}}
									/>
								</label>
								<p className="vsw-err">{framesError}</p>
								<div className="vsw-row">
									<label className="vsw-check">
										<input
											type="checkbox"
											checked={clips[activeClip]?.loop ?? true}
											onChange={(e) =>
												updateActiveClip((c) => ({
													...c,
													loop: e.target.checked,
												}))
											}
										/>
										loop
									</label>
									<label className="vsw-check">
										<input
											type="checkbox"
											checked={mirror}
											onChange={(e) => setMirror(e.target.checked)}
										/>
										mirror
									</label>
								</div>
								<div className="vd-row-actions">
									<button
										type="button"
										className="vd-btn"
										onClick={() => {
											const clip = clips[activeClip];
											if (!clip) return;
											if (clip.frames.length === 0) {
												updateActiveClip((c) => ({
													...c,
													frames: [...liveSelected],
												}));
											} else {
												updateActiveClip((c) => ({
													...c,
													frames: [
														...c.frames,
														...liveSelected.filter(
															(i) => !c.frames.includes(i),
														),
													],
												}));
											}
										}}
										disabled={liveSelected.length === 0}
									>
										use selected ({liveSelected.length})
									</button>
									<button
										type="button"
										className="vd-btn"
										disabled={!playing}
										onClick={() => setPlaying(false)}
									>
										⏸
									</button>
									<button
										type="button"
										className="vd-btn"
										onClick={() => {
											const clip = clips[activeClip];
											if (!clip) {
												return;
											}
											if (clip.frames.length === 0) {
												setStatus(
													"this clip has no frames — click frames on the strip first",
												);
												return;
											}
											setPlaying(true);
										}}
									>
										▶
									</button>
									<button
										type="button"
										className="vd-btn vsw-del"
										onClick={() => {
											setClips((prev) =>
												prev.filter((_, i) => i !== activeClip),
											);
											setActiveClip(null);
											setPlaying(false);
										}}
									>
										✕
									</button>
								</div>
								<div className="vsw-stage-wrap">
									<canvas ref={stageRef} className="vsw-stage" />
									<div className="vsw-row vsw-stage-zoom">
										<span className="vsw-hint">game scale</span>
										{([1, 2, 3] as const).map((z) => (
											<button
												key={z}
												type="button"
												className={`vd-chip ${stageZoom === z ? "vd-chip-on" : ""}`}
												onClick={() => setStageZoom(z)}
											>
												×{z}
											</button>
										))}
									</div>
								</div>
							</div>
						)}
						{clips.length === 0 && (
							<p className="vsw-hint">
								Click frames on the strip (or cells on the board) to select
								them, then add a clip.
							</p>
						)}
					</section>

					<section className="vsw-panel">
						<h2 className="vsw-head">Export</h2>
						<label className="vsw-label">
							sheet name
							<input
								type="text"
								value={sheetOut}
								onChange={(e) => setSheetOut(sheetName(e.target.value))}
							/>
						</label>
						<div className="vd-row-actions">
							<button
								type="button"
								className="vd-btn"
								disabled={!strip}
								onClick={exportStrip}
							>
								sheet PNG
							</button>
							<button
								type="button"
								className="vd-btn"
								disabled={!strip}
								onClick={exportJson}
							>
								atlas JSON
							</button>
							<button
								type="button"
								className="vd-btn"
								disabled={!strip}
								onClick={copyJson}
							>
								copy JSON
							</button>
						</div>
						<p className="vsw-hint">
							The sheet is a clean horizontal strip of {processed.cellW}×
							{processed.cellH} cells — Aseprite:{" "}
							<b>
								File → Import Sprite Sheet…, grid {processed.cellW}×
								{processed.cellH}, no padding
							</b>
							. Curate there, re-export, and the same JSON drops the art into
							the game via the atlas registry in{" "}
							<code>src/game/render/assets.ts</code>.
						</p>
						<pre className="vsw-json">{JSON.stringify(atlas, null, "\t")}</pre>
					</section>
				</aside>
			</div>
		</div>
	);
}

/** The filmstrip's geometry, shared between drawing and click hit-testing. */
function filmGeometry(processed: {
	frames: unknown[];
	cellW: number;
	cellH: number;
}) {
	const H = 56;
	let cellW = processed.cellW * (H / processed.cellH);
	let total =
		processed.frames.length * cellW + (processed.frames.length - 1) * 4;
	const MAX = 1100;
	if (total > MAX) {
		const k = MAX / total;
		cellW *= k;
		total *= k;
	}
	return { H, cellW, total };
}

/** The selected rect's resize handle, in view space. */
function handleRect(
	r: Rect | undefined,
	view: { scale: number; ox: number; oy: number },
) {
	if (!r) return null;
	const SIZE = 9;
	return {
		x: view.ox + (r.x + r.w) * view.scale - SIZE,
		y: view.oy + (r.y + r.h) * view.scale - SIZE,
		w: SIZE,
		h: SIZE,
	};
}

/** Normalise a drag into a positive rect. */
function normalizeRect(
	ax: number,
	ay: number,
	bx: number,
	by: number,
): Rect | null {
	return {
		x: Math.min(ax, bx),
		y: Math.min(ay, by),
		w: Math.abs(bx - ax),
		h: Math.abs(by - ay),
	};
}

function checker(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	scale: number,
) {
	const tile = Math.max(3, 8 * scale);
	ctx.fillStyle = "#17171c";
	ctx.fillRect(x, y, w, h);
	ctx.fillStyle = "#1f1f26";
	for (let i = 0; i * tile < w; i++) {
		for (let j = 0; j * tile < h; j++) {
			if ((i + j) % 2 === 0)
				ctx.fillRect(x + i * tile, y + j * tile, tile, tile);
		}
	}
}

function drawCells(
	ctx: CanvasRenderingContext2D,
	cells: Rect[],
	view: { scale: number; ox: number; oy: number },
	hover: number | null,
	selected: number[],
	selRect: number | null,
	dragRect: Rect | null,
	tool: "slice" | "pick",
	mode: SliceMode,
) {
	const { scale, ox, oy } = view;
	// Hand-drawn rects are the working unit in rects mode — they must read
	// clearly over the board, so they get a heavier, brighter stroke than the
	// grid's guides.
	ctx.lineWidth = mode === "rects" ? 2 : 1;
	cells.forEach((r, i) => {
		const x = ox + r.x * scale;
		const y = oy + r.y * scale;
		const w = r.w * scale;
		const h = r.h * scale;
		if (i === hover) {
			ctx.fillStyle = HOVER;
			ctx.fillRect(x, y, w, h);
		} else if (selected.includes(i)) {
			ctx.fillStyle = SELECTED;
			ctx.fillRect(x, y, w, h);
		}
		ctx.strokeStyle = mode === "rects" ? "rgba(255, 209, 102, 0.95)" : GRID;
		ctx.strokeRect(x, y, w, h);
	});
	if (hover !== null && cells[hover]) {
		ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
		ctx.font = "11px monospace";
		ctx.fillText(
			`#${hover}`,
			ox + cells[hover].x * scale + 3,
			oy + cells[hover].y * scale + 11,
		);
	}
	if (selRect !== null && cells[selRect]) {
		const handle = handleRect(cells[selRect], view);
		if (handle) {
			ctx.fillStyle = "#ffd166";
			ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
		}
	}
	if (dragRect) {
		const x = ox + dragRect.x * scale;
		const y = oy + dragRect.y * scale;
		ctx.strokeStyle = PICK;
		ctx.setLineDash([4, 3]);
		ctx.strokeRect(x, y, dragRect.w * scale, dragRect.h * scale);
		ctx.setLineDash([]);
	}
	if (tool === "pick") {
		ctx.fillStyle = PICK;
		ctx.fillRect(0, 0, 99999, 3);
		ctx.fillStyle = "rgba(255,255,255,0.85)";
		ctx.font = "11px monospace";
		ctx.fillText("click a colour to erase", 8, 16);
	}
}

function cellReadout(r: Rect | undefined): string {
	if (!r) return "\u00a0";
	return `cell ${Math.round(r.x)},${Math.round(r.y)} → ${Math.round(r.w)}×${Math.round(r.h)}`;
}

function sheetCursor(
	tool: "slice" | "pick",
	mode: SliceMode,
	spaceDown: boolean,
): string {
	if (tool === "pick") return "copy";
	if (spaceDown) return "grab";
	return mode === "rects" ? "crosshair" : "default";
}

/** A frame list in the game's own notation: "0-3, 5, 8". */
function parseFrames(text: string): number[] | null {
	const out: number[] = [];
	for (const token of text.split(/[\s,]+/)) {
		if (!token) continue;
		const range = /^(\d+)-(\d+)$/.exec(token);
		if (range) {
			const a = Number(range[1]);
			const b = Number(range[2]);
			if (b < a) return null;
			for (let i = a; i <= b; i++) out.push(i);
		} else if (/^\d+$/.test(token)) {
			out.push(Number(token));
		} else {
			return null;
		}
	}
	return out;
}

/** Two-digit lowercase hex, for the status line's colour readout. */
function hex(n: number): string {
	return n.toString(16).padStart(2, "0");
}
