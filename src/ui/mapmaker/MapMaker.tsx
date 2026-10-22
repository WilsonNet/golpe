/**
 * The map maker: `?mapmaker=true`.
 *
 * A workbench in the shape every 2D editor converged on (Tiled, LDtk, Figma):
 * tools down the left, the canvas in the middle, what you selected and what
 * is wrong on the right, the whole map as a strip along the bottom. What makes
 * it a *game's* map maker is borrowed from Super Mario Maker: the play button
 * is the biggest thing on the screen, and it drops you into the real game on
 * the map you are building, against bots, in one click — then Esc brings you
 * back to exactly where you were.
 *
 * Decisions that are not obvious from the code:
 *
 * - **It starts with a map, not a form.** A first visit opens the classic
 *   arena in the castle theme, already playable, with a four-step strip that
 *   says what to do. A blank canvas and a "New map" dialog is the empty page.
 * - **Everything is checked live** (`game/maps/checks.ts`) and every issue is a
 *   place on the canvas: click it, the view frames it. Errors block publishing;
 *   warnings never do.
 * - **Themes are a swatch, not a setting.** The four themes recolour the same
 *   tiles, so switching is instant and never moves a collider.
 * - **Autosave, always.** Every edit is in `localStorage`; there is no save
 *   button to forget. "My maps" is the library.
 *
 * See specs/map-maker.md.
 */

import { useEffect, useRef, useState } from "react";
import { readStoredHero } from "../../game/heroPref";
import { checkMap, type MapIssue } from "../../game/maps/checks";
import { LIBRARY } from "../../game/maps/library";
import { THEME_SKY } from "../../game/render/ThemeSky";
import { PLAYER_WIDTH, type Rect } from "../../game/simulation/Arena";
import { HERO_IDS, HEROES } from "../../game/simulation/Heroes";
import { TDM_MIN_SCREENS } from "../../game/simulation/Teams";
import { MAP_THEMES, type MapTheme } from "../../game/simulation/Tilemap";
import { HUD_CSS } from "../hudStyles";
import { cssColor, drawPropArt, loadArt, platformArt } from "./art2d";
import {
	type CanvasApi,
	EditorCanvas,
	isTyping,
	type Tool,
} from "./EditorCanvas";
import { MAPMAKER_CSS } from "./mapmakerStyles";
import {
	boundsOf,
	commit,
	duplicateObject,
	type EditorMap,
	type EPlatform,
	type EProp,
	type ESpawn,
	findObject,
	fromSpec,
	type History,
	historyOf,
	mapWidth,
	mirrorLeftToRight,
	moveRect,
	newMap,
	PROP_TYPES,
	playableSpec,
	preview,
	redo,
	removeObject,
	resize,
	type Selection,
	TEMPLATES,
	THEME_LABELS,
	toSpec,
	undo,
	updateObject,
} from "./model";
import { Playtest, type PlaytestSettings } from "./Playtest";
import { Publish } from "./Publish";
import { renderOverview, type View } from "./scene";
import {
	currentMap,
	deleteMap,
	importMapFile,
	loadMaps,
	saveMap,
} from "./storage";

const TOOLS: {
	id: Tool;
	label: string;
	key: string;
	icon: string;
	hint: string;
}[] = [
	{
		id: "select",
		label: "Select",
		key: "V",
		icon: "➤",
		hint: "Click to select · drag to move · handles resize · drag empty space to pan",
	},
	{
		id: "platform",
		label: "Platform",
		key: "P",
		icon: "▭",
		hint: "Drag to draw a platform · click to drop a ledge",
	},
	{
		id: "spawn",
		label: "Spawn",
		key: "S",
		icon: "☺",
		hint: "Click to place a spawn — it drops onto the surface below",
	},
	{
		id: "prop",
		label: "Decor",
		key: "D",
		icon: "✿",
		hint: "Click to place decoration — vines hang, the rest stand",
	},
	{
		id: "erase",
		label: "Erase",
		key: "E",
		icon: "⌫",
		hint: "Click or sweep to delete",
	},
	{
		id: "pan",
		label: "Hand",
		key: "H",
		icon: "✋",
		hint: "Drag to move the view · hold Space anywhere for the same",
	},
];

const DEFAULT_TEST: PlaytestSettings = {
	bots: 3,
	mode: "ffa",
	hero: readStoredHero(),
	watch: false,
	record: true,
};

type Dialog = "none" | "new" | "library" | "test" | "publish" | "keys";

function startingMap(): EditorMap {
	return currentMap() ?? newMap("classic", "castle", 1, "My first map");
}

export function MapMaker() {
	const [history, setHistory] = useState<History>(() =>
		historyOf(startingMap()),
	);
	const map = history.present;
	const [selection, setSelection] = useState<Selection | null>(null);
	const [tool, setTool] = useState<Tool>("select");
	const [propType, setPropType] = useState(PROP_TYPES[0]?.type ?? "vine");
	const [grid, setGrid] = useState(true);
	const [reach, setReach] = useState(false);
	const [flat, setFlat] = useState(false);
	const [dialog, setDialog] = useState<Dialog>(() =>
		loadMaps().length === 0 ? "none" : "none",
	);
	const [testSettings, setTestSettings] =
		useState<PlaytestSettings>(DEFAULT_TEST);
	const [playing, setPlaying] = useState(false);
	const [returnTo, setReturnTo] = useState<Dialog>("none");
	const [mediaVersion, setMediaVersion] = useState(0);
	const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
	const [view, setView] = useState<View | null>(null);
	const [focus, setFocus] = useState<Rect | null>(null);
	const [tipsOpen, setTipsOpen] = useState(() => loadMaps().length <= 1);
	const canvas = useRef<CanvasApi>(null);

	const spec = playableSpec(map);
	const issues: MapIssue[] = spec ? checkMap(spec) : [];
	const errors = issues.filter((i) => i.level === "error").length;
	const warnings = issues.filter((i) => i.level === "warning").length;

	// Autosave: every committed edit, debounced to the end of a burst.
	useEffect(() => {
		const t = window.setTimeout(() => saveMap(map), 250);
		return () => window.clearTimeout(t);
	}, [map]);

	// Theme art loads ahead of the swatches that show it.
	useEffect(() => {
		for (const t of MAP_THEMES) void loadArt(t);
	}, []);

	const apply = (next: EditorMap, sel?: Selection | null) => {
		setHistory((h) => commit(h, next));
		if (sel !== undefined) setSelection(sel);
	};

	const onCommit = (
		next: EditorMap,
		before: EditorMap,
		sel?: Selection | null,
	) => {
		setHistory((h) => ({
			past: [...h.past, before].slice(-200),
			present: { ...next, updatedAt: Date.now() },
			future: [],
		}));
		if (sel !== undefined) setSelection(sel);
	};

	const patchMap = (patch: Partial<EditorMap>) => apply({ ...map, ...patch });

	const open = (m: EditorMap) => {
		saveMap(map);
		setHistory(historyOf(m));
		setSelection(null);
		setDialog("none");
	};

	const removeSelected = () => {
		if (!selection) return;
		apply(removeObject(map, selection), null);
	};

	const duplicate = () => {
		if (!selection) return;
		const r = duplicateObject(map, selection);
		apply(r.map, r.sel);
	};

	const flip = () => {
		if (!selection) return;
		const o = findObject(map, selection);
		if (selection.kind === "spawn" && o)
			apply(updateObject(map, selection, { facing: -(o as ESpawn).facing }));
		if (selection.kind === "prop" && o)
			apply(updateObject(map, selection, { flip: !(o as EProp).flip }));
	};

	const nudge = (dx: number, dy: number) => {
		if (!selection) return;
		const b = boundsOf(map, selection);
		if (!b) return;
		const r = moveRect(b, dx, dy, map);
		apply(updateObject(map, selection, { x: r.x, y: r.y }));
	};

	const play = () => {
		setReturnTo(dialog === "publish" ? "publish" : "none");
		setDialog("none");
		setPlaying(true);
	};

	// Keyboard: tools, edits, history. Never while typing in a field, and
	// never while the play-test frame has the keyboard (it is the game's).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (playing) return;
			// Esc closes a dialog even from inside one of its fields — the
			// Publish sheet is mostly fields, and focus is usually in one.
			if (e.key === "Escape" && dialog !== "none") {
				setDialog("none");
				return;
			}
			if (isTyping(e.target)) return;
			const mod = e.metaKey || e.ctrlKey;
			const key = e.key.toLowerCase();
			if (mod && key === "z") {
				e.preventDefault();
				setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
				return;
			}
			if (mod && key === "y") {
				e.preventDefault();
				setHistory(redo);
				return;
			}
			if (mod && key === "d") {
				e.preventDefault();
				duplicate();
				return;
			}
			if (dialog !== "none") {
				if (key === "escape") setDialog("none");
				return;
			}
			if (mod) return;
			const t = TOOLS.find((x) => x.key.toLowerCase() === key);
			if (t) {
				setTool(t.id);
				return;
			}
			if (key === "delete" || key === "backspace") {
				e.preventDefault();
				removeSelected();
			} else if (key === "escape") setSelection(null);
			else if (key === "f") flip();
			else if (key === "g") setGrid((g) => !g);
			else if (key === "r") setReach((r) => !r);
			else if (key === "t") setDialog("test");
			else if (key === "0") canvas.current?.fit();
			else if (key === "=" || key === "+") canvas.current?.zoomBy(1.25);
			else if (key === "-") canvas.current?.zoomBy(0.8);
			else if (key === "?") setDialog("keys");
			else if (e.key.startsWith("Arrow") && selection) {
				e.preventDefault();
				const step = e.shiftKey ? 32 : 8;
				nudge(
					e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
					e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
				);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// Hooks for probes and agents — the editor's state, without a screenshot.
	useEffect(() => {
		window.__mapmaker = {
			map: () => toSpec(map),
			playable: () => playableSpec(map),
			issues: () => issues,
			load: (raw: unknown) => {
				const m = importMapFile(JSON.stringify(raw));
				if (m) open(m);
				return m !== null;
			},
			overview: async () => {
				const blob = await renderOverview(map);
				return new Uint8Array(await blob.arrayBuffer());
			},
		};
	});

	const selected = findObject(map, selection);
	const activeTool = TOOLS.find((t) => t.id === tool);

	if (playing) {
		return (
			<div className="mm-root">
				<style>{HUD_CSS}</style>
				<style>{MAPMAKER_CSS}</style>
				<Playtest
					map={map}
					settings={testSettings}
					onMedia={() => setMediaVersion((v) => v + 1)}
					onClose={() => {
						setPlaying(false);
						setDialog(returnTo);
					}}
				/>
			</div>
		);
	}

	return (
		<div className="mm-root" data-testid="mapmaker">
			<style>{HUD_CSS}</style>
			<style>{MAPMAKER_CSS}</style>

			<header className="mm-bar">
				<a
					className="mm-logo"
					href={window.location.pathname}
					title="Back to the game menu"
				>
					◀ <span>Map maker</span>
				</a>
				<input
					className="mm-name"
					value={map.name}
					maxLength={60}
					aria-label="Map name"
					onChange={(e) => patchMap({ name: e.target.value })}
					data-testid="mapmaker-name"
				/>
				<fieldset className="mm-group" aria-label="Theme">
					{MAP_THEMES.map((t) => (
						<ThemeSwatch
							key={t}
							theme={t}
							active={map.theme === t}
							onPick={() => patchMap({ theme: t })}
						/>
					))}
				</fieldset>
				<fieldset className="mm-group mm-width" aria-label="Width in screens">
					<button
						type="button"
						className="mm-icon"
						disabled={map.screens <= 1}
						onClick={() => apply(resize(map, map.screens - 1))}
						title="Narrower"
					>
						−
					</button>
					<span data-testid="mapmaker-screens">
						{map.screens} screen{map.screens === 1 ? "" : "s"}
					</span>
					<button
						type="button"
						className="mm-icon"
						disabled={map.screens >= 8}
						onClick={() => apply(resize(map, map.screens + 1))}
						title="Wider"
					>
						+
					</button>
				</fieldset>
				<div className="mm-group">
					<button
						type="button"
						className="mm-icon"
						disabled={history.past.length === 0}
						onClick={() => setHistory(undo)}
						title="Undo (⌘Z)"
					>
						↶
					</button>
					<button
						type="button"
						className="mm-icon"
						disabled={history.future.length === 0}
						onClick={() => setHistory(redo)}
						title="Redo (⇧⌘Z)"
					>
						↷
					</button>
				</div>
				<span className="mm-spacer" />
				<button
					type="button"
					className="mm-btn"
					onClick={() => setDialog("library")}
					data-testid="mapmaker-library"
				>
					My maps
				</button>
				<button
					type="button"
					className="mm-btn"
					onClick={() => setDialog("new")}
				>
					New
				</button>
				<button
					type="button"
					className="mm-btn mm-play"
					onClick={() => setDialog("test")}
					disabled={!spec}
					data-testid="mapmaker-test"
				>
					▶ Test vs bots
				</button>
				<button
					type="button"
					className="mm-btn mm-btn-primary"
					onClick={() => setDialog("publish")}
					data-testid="mapmaker-publish-open"
				>
					⇪ Publish
				</button>
			</header>

			{tipsOpen ? (
				<div className="mm-tips">
					<span>
						<b>1</b> Draw platforms <kbd>P</kbd>
					</span>
					<span>
						<b>2</b> Drop spawn points <kbd>S</kbd>
					</span>
					<span>
						<b>3</b> Pick a theme above
					</span>
					<span>
						<b>4</b>{" "}
						<button
							type="button"
							className="mm-link"
							onClick={() => setDialog("test")}
						>
							▶ Test it against bots
						</button>
					</span>
					<span>
						<b>5</b>{" "}
						<button
							type="button"
							className="mm-link"
							onClick={() => setDialog("publish")}
						>
							Publish it as a pull request
						</button>
					</span>
					<button
						type="button"
						className="mm-x"
						onClick={() => setTipsOpen(false)}
						aria-label="Hide tips"
					>
						✕
					</button>
				</div>
			) : null}

			<div className="mm-body">
				<nav className="mm-rail" aria-label="Tools">
					{TOOLS.map((t) => (
						<button
							key={t.id}
							type="button"
							className={`mm-tool ${tool === t.id ? "on" : ""}`}
							onClick={() => setTool(t.id)}
							title={`${t.label} (${t.key}) — ${t.hint}`}
							aria-pressed={tool === t.id}
							data-testid={`tool-${t.id}`}
						>
							<span className="mm-tool-icon">{t.icon}</span>
							<span className="mm-tool-label">{t.label}</span>
							<kbd>{t.key}</kbd>
						</button>
					))}
					<span className="mm-rail-sep" />
					<button
						type="button"
						className={`mm-tool small ${grid ? "on" : ""}`}
						onClick={() => setGrid((g) => !g)}
						title="Grid (G)"
					>
						<span className="mm-tool-icon">#</span>
						<span className="mm-tool-label">Grid</span>
					</button>
					<button
						type="button"
						className={`mm-tool small ${reach ? "on" : ""}`}
						onClick={() => setReach((r) => !r)}
						title="Jump reach (R): how high a jump and a double jump rise from the selected platform"
					>
						<span className="mm-tool-icon">⤒</span>
						<span className="mm-tool-label">Reach</span>
					</button>
					<button
						type="button"
						className={`mm-tool small ${flat ? "on" : ""}`}
						onClick={() => setFlat((f) => !f)}
						title="Flat view: the competitive blocks, no art"
					>
						<span className="mm-tool-icon">▦</span>
						<span className="mm-tool-label">Flat</span>
					</button>
				</nav>

				<main className="mm-stage">
					{tool === "prop" ? (
						<div className="mm-palette" role="toolbar" aria-label="Decorations">
							{PROP_TYPES.map((p) => (
								<PropButton
									key={p.type}
									theme={map.theme}
									type={p.type}
									label={p.label}
									active={propType === p.type}
									onPick={() => setPropType(p.type)}
								/>
							))}
						</div>
					) : null}
					<EditorCanvas
						map={map}
						tool={tool}
						propType={propType}
						selection={selection}
						issues={issues}
						grid={grid}
						reach={reach}
						flat={flat}
						focus={focus}
						onSelect={setSelection}
						onPreview={(next) => setHistory((h) => preview(h, next))}
						onCommit={onCommit}
						onCursor={setCursor}
						onView={setView}
						apiRef={canvas}
					/>
					<div className="mm-status">
						<span>{activeTool?.hint}</span>
						<span className="mm-spacer" />
						{cursor ? (
							<span>
								x {cursor.x} · y {cursor.y}
							</span>
						) : null}
						{view ? <span>{Math.round(view.zoom * 100)}%</span> : null}
						<button
							type="button"
							className="mm-link"
							onClick={() => canvas.current?.fit()}
							title="Fit (0)"
						>
							fit
						</button>
						<button
							type="button"
							className="mm-link"
							onClick={() => setDialog("keys")}
							title="Shortcuts (?)"
						>
							keys
						</button>
					</div>
					<Minimap
						map={map}
						view={view}
						onPan={(x) => canvas.current?.setPan(x)}
					/>
				</main>

				<aside className="mm-side">
					<section className="mm-panel">
						<h3>
							{selection
								? `Selected ${selection.kind === "prop" ? "decoration" : selection.kind}`
								: "Map"}
						</h3>
						{selection && selected ? (
							<Inspector
								kind={selection.kind}
								object={selected}
								onPatch={(patch) => apply(updateObject(map, selection, patch))}
								onDelete={removeSelected}
								onDuplicate={duplicate}
								onFlip={flip}
							/>
						) : (
							<div className="mm-mapinfo">
								<p className="mm-muted">
									{mapWidth(map)}×600 · {map.platforms.length} platforms ·{" "}
									{map.spawns.length} spawns · {map.props.length} decorations
								</p>
								<button
									type="button"
									className="mm-btn"
									onClick={() => apply(mirrorLeftToRight(map))}
									title="Copy the left half onto the right, mirrored"
								>
									⇋ Make symmetric
								</button>
								<p className="mm-muted small">
									Competitive maps are mirror images, so neither side spawns
									with the better ground. This copies the left half onto the
									right.
								</p>
							</div>
						)}
					</section>

					<section className="mm-panel mm-checks" data-testid="mapmaker-checks">
						<h3>
							Checks
							<span
								className={`mm-badge ${errors ? "bad" : warnings ? "warn" : "ok"}`}
							>
								{errors
									? `${errors} error${errors === 1 ? "" : "s"}`
									: warnings
										? `${warnings} warning${warnings === 1 ? "" : "s"}`
										: "all good"}
							</span>
						</h3>
						{issues.length === 0 ? (
							<p className="mm-muted">
								Spawns, gaps, headroom and jump reach all check out.
							</p>
						) : null}
						<ul>
							{issues.map((i) => (
								<li
									key={`${i.code}:${i.at?.x},${i.at?.y}:${i.message}`}
									className={`mm-issue ${i.level}`}
								>
									<button
										type="button"
										disabled={!i.at}
										onClick={() => {
											if (!i.at) return;
											canvas.current?.frame(i.at);
											setFocus(i.at);
											window.setTimeout(() => setFocus(null), 1600);
										}}
									>
										<span className="mm-issue-icon">
											{i.level === "error"
												? "✖"
												: i.level === "warning"
													? "▲"
													: "ℹ"}
										</span>
										{i.message}
									</button>
								</li>
							))}
						</ul>
					</section>
				</aside>
			</div>

			{dialog === "new" ? (
				<NewMapDialog onCreate={open} onClose={() => setDialog("none")} />
			) : null}
			{dialog === "library" ? (
				<LibraryDialog
					current={map}
					onOpen={open}
					onClose={() => setDialog("none")}
				/>
			) : null}
			{dialog === "test" ? (
				<TestDialog
					map={map}
					settings={testSettings}
					onChange={setTestSettings}
					onStart={play}
					onClose={() => setDialog("none")}
				/>
			) : null}
			{dialog === "publish" ? (
				<Publish
					map={map}
					onChange={patchMap}
					onPlaytest={() => {
						setReturnTo("publish");
						setDialog("test");
					}}
					onClose={() => setDialog("none")}
					mediaVersion={mediaVersion}
				/>
			) : null}
			{dialog === "keys" ? (
				<KeysDialog onClose={() => setDialog("none")} />
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A theme as a tiny scene: its sky and a ledge of its tiles. */
function ThemeSwatch({
	theme,
	active,
	onPick,
}: {
	theme: MapTheme;
	active: boolean;
	onPick: () => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		void loadArt(theme).then(() => setReady(true));
	}, [theme]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: redraw once the art has loaded.
	useEffect(() => {
		const ctx = ref.current?.getContext("2d");
		if (!ctx) return;
		const sky = THEME_SKY[theme];
		const g = ctx.createLinearGradient(0, 0, 0, 32);
		sky.forEach((c, i) => {
			g.addColorStop(i / (sky.length - 1), cssColor(c));
		});
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 48, 32);
		const art = platformArt(theme, 40, 16);
		ctx.imageSmoothingEnabled = false;
		if (art) ctx.drawImage(art, 4, 16);
	}, [theme, ready]);
	return (
		<button
			type="button"
			aria-pressed={active}
			className={`mm-swatch ${active ? "on" : ""}`}
			onClick={onPick}
			title={THEME_LABELS[theme]}
			data-testid={`theme-${theme}`}
		>
			<canvas ref={ref} width={48} height={32} />
			<span>{THEME_LABELS[theme]}</span>
		</button>
	);
}

function PropButton({
	theme,
	type,
	label,
	active,
	onPick,
}: {
	theme: MapTheme;
	type: string;
	label: string;
	active: boolean;
	onPick: () => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		void loadArt(theme).then(() => setReady(true));
	}, [theme]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: redraw once the art has loaded.
	useEffect(() => {
		const ctx = ref.current?.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, 24, 24);
		ctx.imageSmoothingEnabled = false;
		drawPropArt(ctx, theme, type, 0, 0);
	}, [theme, type, ready]);
	return (
		<button
			type="button"
			className={`mm-prop ${active ? "on" : ""}`}
			onClick={onPick}
			title={label}
		>
			<canvas ref={ref} width={24} height={24} />
		</button>
	);
}

function Inspector({
	kind,
	object,
	onPatch,
	onDelete,
	onDuplicate,
	onFlip,
}: {
	kind: Selection["kind"];
	object: EPlatform | ESpawn | EProp;
	onPatch: (patch: Partial<EPlatform & ESpawn & EProp>) => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onFlip: () => void;
}) {
	const num = (key: "x" | "y" | "w" | "h", label: string, step = 8) => (
		<label>
			{label}
			<input
				type="number"
				step={step}
				value={(object as unknown as Record<string, number>)[key]}
				onChange={(e) => {
					const v = Number(e.target.value);
					if (Number.isFinite(v)) onPatch({ [key]: v });
				}}
			/>
		</label>
	);
	return (
		<div className="mm-inspector" data-testid="mapmaker-inspector">
			<div className="mm-fields">
				{num("x", "X")}
				{num("y", "Y")}
				{kind === "platform" ? (
					<>
						{num("w", "Width")}
						{num("h", "Height")}
					</>
				) : null}
			</div>
			{kind === "spawn" ? (
				<p className="mm-muted small">
					Faces {(object as ESpawn).facing > 0 ? "right →" : "← left"}. A
					fighter is {PLAYER_WIDTH}×48.
				</p>
			) : null}
			<div className="mm-row">
				{kind !== "platform" ? (
					<button
						type="button"
						className="mm-btn"
						onClick={onFlip}
						title="Flip (F)"
					>
						⇆ Flip
					</button>
				) : null}
				<button
					type="button"
					className="mm-btn"
					onClick={onDuplicate}
					title="Duplicate (⌘D)"
				>
					⧉ Duplicate
				</button>
				<button
					type="button"
					className="mm-btn mm-danger"
					onClick={onDelete}
					title="Delete (⌫)"
				>
					Delete
				</button>
			</div>
		</div>
	);
}

/** The whole map as a strip, with the view's window on it. Click to jump. */
function Minimap({
	map,
	view,
	onPan,
}: {
	map: EditorMap;
	view: View | null;
	onPan: (x: number) => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const W = mapWidth(map);
	useEffect(() => {
		const c = ref.current;
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return;
		const scale = c.width / W;
		const sky = THEME_SKY[map.theme];
		ctx.fillStyle = cssColor(sky[1] ?? 0);
		ctx.fillRect(0, 0, c.width, c.height);
		ctx.fillStyle = "#26402e";
		for (const p of map.platforms)
			ctx.fillRect(
				p.x * scale,
				p.y * scale,
				Math.max(1, p.w * scale),
				Math.max(1, p.h * scale),
			);
		ctx.fillStyle = "#ffd166";
		for (const s of map.spawns)
			ctx.fillRect(s.x * scale, s.y * scale, 32 * scale, 48 * scale);
		if (view) {
			ctx.strokeStyle = "#0ec3c9";
			ctx.lineWidth = 3;
			ctx.strokeRect(
				view.panX * scale,
				view.panY * scale,
				(view.width / view.zoom) * scale,
				(view.height / view.zoom) * scale,
			);
		}
	}, [map, view, W]);
	return (
		<canvas
			ref={ref}
			className="mm-minimap"
			width={Math.round((W / 600) * 128)}
			height={128}
			onPointerDown={(e) => {
				const r = e.currentTarget.getBoundingClientRect();
				const x = ((e.clientX - r.left) / r.width) * W;
				onPan(x - (view ? view.width / view.zoom / 2 : 400));
			}}
			title="Click to jump there"
		/>
	);
}

function Modal({
	title,
	onClose,
	children,
	wide,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
	wide?: boolean;
}) {
	return (
		<div
			className="mm-sheet-veil"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			onPointerDown={(e) => e.target === e.currentTarget && onClose()}
		>
			<div className={`mm-sheet ${wide ? "wide" : ""}`}>
				<header className="mm-sheet-head">
					<h2>{title}</h2>
					<button
						type="button"
						className="mm-x"
						onClick={onClose}
						aria-label="Close"
					>
						✕
					</button>
				</header>
				{children}
			</div>
		</div>
	);
}

function NewMapDialog({
	onCreate,
	onClose,
}: {
	onCreate: (m: EditorMap) => void;
	onClose: () => void;
}) {
	const [template, setTemplate] = useState("classic");
	const [theme, setTheme] = useState<MapTheme>("castle");
	const [screens, setScreens] = useState(1);
	const [name, setName] = useState("");
	return (
		<Modal title="New map" onClose={onClose} wide>
			<div className="mm-cards">
				{TEMPLATES.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`mm-card ${template === t.id ? "on" : ""}`}
						onClick={() => setTemplate(t.id)}
					>
						<TemplatePreview templateId={t.id} theme={theme} />
						<b>{t.label}</b>
						<span className="mm-muted">{t.blurb}</span>
					</button>
				))}
			</div>
			<div className="mm-form">
				<label>
					Name
					<input
						value={name}
						placeholder="Untitled map"
						maxLength={60}
						onChange={(e) => setName(e.target.value)}
					/>
				</label>
				<label>
					Theme
					<select
						value={theme}
						onChange={(e) => setTheme(e.target.value as MapTheme)}
					>
						{MAP_THEMES.map((t) => (
							<option key={t} value={t}>
								{THEME_LABELS[t]}
							</option>
						))}
					</select>
				</label>
				<label>
					Width
					<select
						value={screens}
						onChange={(e) => setScreens(Number(e.target.value))}
					>
						{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
							<option key={n} value={n}>
								{n} screen{n === 1 ? "" : "s"}
								{n >= TDM_MIN_SCREENS ? " · team deathmatch" : ""}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className="mm-row end">
				<button type="button" className="mm-btn" onClick={onClose}>
					Cancel
				</button>
				<button
					type="button"
					className="mm-btn mm-btn-primary"
					onClick={() =>
						onCreate(
							newMap(template, theme, screens, name.trim() || "Untitled map"),
						)
					}
				>
					Create
				</button>
			</div>
		</Modal>
	);
}

function TemplatePreview({
	templateId,
	theme,
}: {
	templateId: string;
	theme: MapTheme;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current;
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return;
		const m = newMap(templateId, theme, 1);
		const sky = THEME_SKY[theme];
		ctx.fillStyle = cssColor(sky[2] ?? 0);
		ctx.fillRect(0, 0, c.width, c.height);
		const s = c.width / 800;
		ctx.fillStyle = "#2f4a36";
		for (const p of m.platforms)
			ctx.fillRect(p.x * s, p.y * s, p.w * s, Math.max(1, p.h * s));
		ctx.fillStyle = "#ffd166";
		for (const sp of m.spawns) ctx.fillRect(sp.x * s, sp.y * s, 3, 4);
	}, [templateId, theme]);
	return (
		<canvas ref={ref} width={160} height={120} className="mm-card-preview" />
	);
}

function LibraryDialog({
	current,
	onOpen,
	onClose,
}: {
	current: EditorMap;
	onOpen: (m: EditorMap) => void;
	onClose: () => void;
}) {
	const [maps, setMaps] = useState(() => loadMaps());
	const [error, setError] = useState<string | null>(null);
	const importFile = async (file: File) => {
		const m = importMapFile(await file.text());
		if (m) onOpen(m);
		else setError(`${file.name} is not a golpe map`);
	};
	const exportCurrent = () => {
		const spec = playableSpec(current) ?? toSpec(current);
		const url = URL.createObjectURL(
			new Blob([`${JSON.stringify(spec, null, "\t")}\n`], {
				type: "application/json",
			}),
		);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${current.slug}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};
	return (
		<Modal title="My maps" onClose={onClose} wide>
			<ul className="mm-list" data-testid="mapmaker-mymaps">
				{maps.map((m) => (
					<li
						key={m.localId}
						className={m.localId === current.localId ? "on" : ""}
					>
						<button
							type="button"
							className="mm-list-main"
							onClick={() => onOpen(m)}
						>
							<b>{m.name}</b>
							<span className="mm-muted">
								{THEME_LABELS[m.theme]} · {m.screens} screen
								{m.screens === 1 ? "" : "s"} · edited{" "}
								{new Date(m.updatedAt).toLocaleString()}
							</span>
						</button>
						<button
							type="button"
							className="mm-link"
							onClick={() =>
								onOpen({
									...m,
									localId: `${m.localId}-copy-${Date.now().toString(36)}`,
									name: `${m.name} (copy)`,
								})
							}
						>
							duplicate
						</button>
						{m.localId !== current.localId ? (
							<button
								type="button"
								className="mm-link danger"
								onClick={() => {
									deleteMap(m.localId);
									setMaps(loadMaps());
								}}
							>
								delete
							</button>
						) : null}
					</li>
				))}
			</ul>
			{LIBRARY.length > 0 ? (
				<>
					<h3 className="mm-subhead">Remix a map from the game</h3>
					<div className="mm-cards">
						{LIBRARY.map((m) => (
							<button
								key={m.id}
								type="button"
								className="mm-card"
								onClick={() =>
									onOpen({
										...fromSpec(m.spec),
										name: `${m.spec.meta?.name ?? m.id} remix`,
										slug: `${m.id}-remix`,
										author: "",
									})
								}
							>
								{m.thumbnail ? (
									<img src={m.thumbnail} alt="" className="mm-card-preview" />
								) : null}
								<b>{m.spec.meta?.name ?? m.id}</b>
								<span className="mm-muted">
									{m.spec.meta?.description ?? ""}
								</span>
							</button>
						))}
					</div>
				</>
			) : null}
			<div className="mm-row">
				<label className="mm-btn">
					Import .json
					<input
						type="file"
						accept="application/json,.json"
						hidden
						onChange={(e) =>
							e.target.files?.[0] && void importFile(e.target.files[0])
						}
					/>
				</label>
				<button type="button" className="mm-btn" onClick={exportCurrent}>
					Export this map
				</button>
				{error ? <span className="mm-error">{error}</span> : null}
			</div>
		</Modal>
	);
}

function TestDialog({
	map,
	settings,
	onChange,
	onStart,
	onClose,
}: {
	map: EditorMap;
	settings: PlaytestSettings;
	onChange: (s: PlaytestSettings) => void;
	onStart: () => void;
	onClose: () => void;
}) {
	const tdmOk = map.screens >= TDM_MIN_SCREENS;
	return (
		<Modal title="Test against bots" onClose={onClose}>
			<div className="mm-form">
				<label className="mm-wide">
					Opponents: <b>{settings.bots}</b>
					<input
						type="range"
						min={1}
						max={15}
						value={settings.bots}
						onChange={(e) =>
							onChange({ ...settings, bots: Number(e.target.value) })
						}
						data-testid="test-bots"
					/>
				</label>
				<label>
					Mode
					<select
						value={settings.mode}
						onChange={(e) =>
							onChange({
								...settings,
								mode: e.target.value as PlaytestSettings["mode"],
							})
						}
					>
						<option value="ffa">Free-for-all</option>
						<option value="tdm" disabled={!tdmOk}>
							Team deathmatch
							{tdmOk ? "" : ` (needs ${TDM_MIN_SCREENS}+ screens)`}
						</option>
					</select>
				</label>
				<label>
					Your hero
					<select
						value={settings.hero}
						disabled={settings.watch}
						onChange={(e) =>
							onChange({
								...settings,
								hero: e.target.value as PlaytestSettings["hero"],
							})
						}
					>
						{HERO_IDS.map((h) => (
							<option key={h} value={h}>
								{HEROES[h].name}
							</option>
						))}
					</select>
				</label>
				<label className="mm-check mm-wide">
					<input
						type="checkbox"
						checked={settings.watch}
						onChange={(e) => onChange({ ...settings, watch: e.target.checked })}
						data-testid="test-watch"
					/>
					Just watch — AI vs AI{" "}
					<span className="mm-muted">(you are a bot too)</span>
				</label>
				<label className="mm-check mm-wide">
					<input
						type="checkbox"
						checked={settings.record}
						onChange={(e) =>
							onChange({ ...settings, record: e.target.checked })
						}
					/>
					Record a clip for the pull request{" "}
					<span className="mm-muted">(the first 20s, plus screenshots)</span>
				</label>
			</div>
			<p className="mm-muted small">
				The test is a real online match on your map — same server, same netcode,
				same bots. Esc → Exit, or the button at the top, brings you back.
			</p>
			<div className="mm-row end">
				<button type="button" className="mm-btn" onClick={onClose}>
					Cancel
				</button>
				<button
					type="button"
					className="mm-btn mm-play"
					onClick={onStart}
					data-testid="test-start"
				>
					▶ Play
				</button>
			</div>
		</Modal>
	);
}

function KeysDialog({ onClose }: { onClose: () => void }) {
	const rows: [string, string][] = [
		...TOOLS.map((t): [string, string] => [t.key, t.label]),
		["Space + drag", "Pan"],
		["Wheel / ⇧ Wheel", "Scroll sideways / up-down"],
		["⌘/Ctrl + Wheel, pinch", "Zoom"],
		["0 · + · −", "Fit · zoom in · zoom out"],
		["Arrows (⇧ ×4)", "Nudge selection 8px"],
		["⌫", "Delete selection"],
		["⌘D", "Duplicate"],
		["F", "Flip spawn / decoration"],
		["⌘Z · ⇧⌘Z", "Undo · redo"],
		["G · R", "Grid · jump reach"],
		["T", "Test vs bots"],
	];
	return (
		<Modal title="Shortcuts" onClose={onClose}>
			<table className="mm-keys">
				<tbody>
					{rows.map(([k, v]) => (
						<tr key={k}>
							<td>
								<kbd>{k}</kbd>
							</td>
							<td>{v}</td>
						</tr>
					))}
				</tbody>
			</table>
		</Modal>
	);
}
