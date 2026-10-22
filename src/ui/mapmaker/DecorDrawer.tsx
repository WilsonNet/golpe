/**
 * The Decor tool's drawer: a hundred-odd props, findable.
 *
 * Seven props fit in a floating strip; a catalogue does not. The drawer docks
 * beside the tool rail while Decor is the tool — the canvas stays fully
 * visible — and is built like an asset browser (Tiled's tileset panel,
 * Mario Maker's parts palette):
 *
 * - **Search first.** A name you know is faster than any browsing; `/` focuses
 *   the field, and the search spans every category.
 * - **Categories as tabs**, with counts, so the shape of the catalogue is
 *   visible before anything is opened.
 * - **Recently used** sits on top, because a map is dressed with a handful of
 *   props used many times.
 * - **Every thumbnail is the real art in the map's theme**, scaled to fit its
 *   cell in whole pixels — a 32px tree and an 8px flower are both legible,
 *   and an animated prop says so with a dot.
 * - **The brush is a mode, not a hidden gesture**: Stamp, Row, Scatter, with
 *   what each does written underneath.
 *
 * See specs/map-maker.md.
 */

import { useEffect, useRef, useState } from "react";
import {
	PROP_CATALOG,
	PROP_CATEGORIES,
	type PropAttach,
	type PropDef,
	propDef,
} from "../../game/maps/props";
import type { MapTheme } from "../../game/simulation/Tilemap";
import { drawPropArt, loadArt } from "./art2d";
import type { Brush } from "./EditorCanvas";

const RECENT_KEY = "golpe:mapmaker:recentProps";
const RECENT_MAX = 8;
const THUMB = 40;

export const ATTACH_HINT: Record<PropAttach, string> = {
	stand: "stands on the surface below",
	hang: "hangs from the ceiling above",
	wall: "mounts on the platform under the cursor",
	air: "floats exactly where you click",
};

const BRUSHES: { id: Brush; label: string; hint: string }[] = [
	{ id: "stamp", label: "Stamp", hint: "Click to place one" },
	{ id: "row", label: "Row", hint: "Drag to lay a tidy row, edge to edge" },
	{
		id: "scatter",
		label: "Scatter",
		hint: "Drag to sprinkle the whole category, loosely",
	},
];

function readRecent(): string[] {
	try {
		const raw = window.localStorage.getItem(RECENT_KEY);
		const list = raw ? (JSON.parse(raw) as unknown) : [];
		return Array.isArray(list)
			? list.filter((t): t is string => typeof t === "string" && !!propDef(t))
			: [];
	} catch {
		return [];
	}
}

function writeRecent(list: string[]) {
	try {
		window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
	} catch {
		// Private mode: recents are a convenience.
	}
}

/** The props a category tab (or a search) shows, in catalogue order. */
export function visibleProps(category: string, query: string): PropDef[] {
	const q = query.trim().toLowerCase();
	return PROP_CATALOG.filter((p) =>
		q
			? p.label.toLowerCase().includes(q) ||
				p.type.toLowerCase().includes(q) ||
				p.category.includes(q)
			: category === "all" || p.category === category,
	);
}

export function DecorDrawer({
	theme,
	propType,
	onPick,
	brush,
	onBrush,
	category,
	onCategory,
}: {
	theme: MapTheme;
	propType: string;
	onPick: (type: string) => void;
	brush: Brush;
	onBrush: (b: Brush) => void;
	category: string;
	onCategory: (c: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [recent, setRecent] = useState(readRecent);
	const search = useRef<HTMLInputElement>(null);
	const shown = visibleProps(category, query);
	const current = propDef(propType);

	const pick = (type: string) => {
		onPick(type);
		const next = [type, ...recent.filter((t) => t !== type)].slice(
			0,
			RECENT_MAX,
		);
		setRecent(next);
		writeRecent(next);
	};

	// `/` jumps to the search, like every asset browser.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "/" || e.target instanceof HTMLInputElement) return;
			e.preventDefault();
			search.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<aside
			className="mm-drawer"
			aria-label="Decorations"
			data-testid="mapmaker-decor"
		>
			<div className="mm-drawer-head">
				<input
					ref={search}
					type="search"
					className="mm-drawer-search"
					placeholder={`Search ${PROP_CATALOG.length} props…  /`}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setQuery("");
							e.currentTarget.blur();
						} else if (e.key === "Enter" && shown[0]) pick(shown[0].type);
					}}
					aria-label="Search decorations"
					data-testid="mapmaker-decor-search"
				/>
				<div className="mm-cats" role="tablist" aria-label="Categories">
					{[{ id: "all", label: "All" }, ...PROP_CATEGORIES].map((c) => (
						<button
							key={c.id}
							type="button"
							role="tab"
							aria-selected={!query && category === c.id}
							className={`mm-cat ${!query && category === c.id ? "on" : ""}`}
							onClick={() => {
								setQuery("");
								onCategory(c.id);
							}}
							data-testid={`decor-cat-${c.id}`}
						>
							{c.label}
							<small>
								{c.id === "all"
									? PROP_CATALOG.length
									: PROP_CATALOG.filter((p) => p.category === c.id).length}
							</small>
						</button>
					))}
				</div>
			</div>

			<div className="mm-drawer-scroll">
				{recent.length > 0 && !query ? (
					<>
						<h4>Recent</h4>
						<div className="mm-prop-grid">
							{recent.map((t) => (
								<PropButton
									key={`r-${t}`}
									theme={theme}
									type={t}
									active={propType === t}
									onPick={() => pick(t)}
								/>
							))}
						</div>
					</>
				) : null}
				<h4>
					{query
						? `${shown.length} match${shown.length === 1 ? "" : "es"}`
						: (PROP_CATEGORIES.find((c) => c.id === category)?.label ??
							"Everything")}
				</h4>
				<div className="mm-prop-grid">
					{shown.map((p) => (
						<PropButton
							key={p.type}
							theme={theme}
							type={p.type}
							active={propType === p.type}
							onPick={() => pick(p.type)}
						/>
					))}
				</div>
				{shown.length === 0 ? (
					<p className="mm-muted small">Nothing called that. Try “bird”.</p>
				) : null}
			</div>

			<div className="mm-drawer-foot">
				{current ? (
					<p className="mm-drawer-current">
						<b>{current.label}</b>
						<span className="mm-muted small">
							{current.w}×{current.h} · {ATTACH_HINT[current.attach]}
							{current.frames ? " · animated" : ""}
						</span>
					</p>
				) : null}
				<div className="mm-seg" role="radiogroup" aria-label="Brush">
					{BRUSHES.map((b) => (
						<button
							key={b.id}
							type="button"
							role="radio"
							aria-checked={brush === b.id}
							className={brush === b.id ? "on" : ""}
							onClick={() => onBrush(b.id)}
							title={b.hint}
							data-testid={`decor-brush-${b.id}`}
						>
							{b.label}
						</button>
					))}
				</div>
				<p className="mm-muted small">
					{BRUSHES.find((b) => b.id === brush)?.hint}
					{brush === "scatter" && !query
						? ` — from ${PROP_CATEGORIES.find((c) => c.id === (current?.category ?? category))?.label ?? "this category"}`
						: ""}
					. <kbd>[</kbd> <kbd>]</kbd> step through props.
				</p>
			</div>
		</aside>
	);
}

/** One prop, drawn from the theme's atlas, scaled to its cell in whole pixels. */
function PropButton({
	theme,
	type,
	active,
	onPick,
}: {
	theme: MapTheme;
	type: string;
	active: boolean;
	onPick: () => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const [ready, setReady] = useState(false);
	const def = propDef(type);
	useEffect(() => {
		void loadArt(theme).then(() => setReady(true));
	}, [theme]);
	// biome-ignore lint/correctness/useExhaustiveDependencies(ready): redraw once the art has loaded.
	useEffect(() => {
		const ctx = ref.current?.getContext("2d");
		if (!ctx || !def) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, THUMB, THUMB);
		ctx.imageSmoothingEnabled = false;
		const scale = Math.max(
			1,
			Math.floor(Math.min(THUMB / def.w, THUMB / def.h, 4)),
		);
		const fit = Math.min(1, THUMB / (def.w * scale), THUMB / (def.h * scale));
		const s = scale * fit;
		ctx.setTransform(
			s,
			0,
			0,
			s,
			(THUMB - def.w * s) / 2,
			(THUMB - def.h * s) / 2,
		);
		drawPropArt(ctx, theme, type, 0, 0);
	}, [theme, type, ready, def]);
	return (
		<button
			type="button"
			className={`mm-prop ${active ? "on" : ""}`}
			onClick={onPick}
			title={def ? `${def.label} — ${ATTACH_HINT[def.attach]}` : type}
			aria-label={def?.label ?? type}
			aria-pressed={active}
			data-testid={`decor-${type}`}
		>
			<canvas ref={ref} width={THUMB} height={THUMB} />
			{def?.frames ? <i className="mm-prop-anim" aria-hidden="true" /> : null}
		</button>
	);
}
