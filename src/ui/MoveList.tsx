/**
 * The move list — a Guilty Gear-style command list for the current hero.
 *
 * Rendered as a full-screen panel over the Esc menu. One move at a time, in
 * the middle of the screen: the hero's portrait and the move's name and
 * command on the left, an expanded explanation and a live stat card on the
 * right, and a category rail up the left edge showing where you are.
 *
 * Navigation is keyboard-first, exactly like the game: **Up/Down** (or W/S)
 * walk the moves one at a time, **Left/Right** (or A/D) jump whole categories,
 * and **Esc** (or Back) returns to the menu. The keycaps are read from the
 * player's *actual* bindings — a rebind re-labels every command for free —
 * and the numbers on the cards are the real tuning constants from
 * `movelist.ts`, so a retune rewords the list without a hand edit.
 *
 * This is a DOM overlay and is intentionally not wired into the simulation:
 * it reads the bindings store (snapshotted into state, like `ControlsDialog`)
 * and never touches `tickPlayer`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Action } from "../game/input/Bindings";
import { bindings, codeLabel } from "../game/input/Bindings";
import { HEROES, type HeroId } from "../game/simulation/Heroes";
import { HERO_SPRITE_CSS } from "./HeroSelect";
import { HUD_CSS } from "./hudStyles";
import { MovePreview } from "./MovePreview";
import {
	CATEGORY_LABELS,
	CATEGORY_ORDER,
	commandGroups,
	type HeroMoveList,
	MOVE_LISTS,
	type MoveCategory,
	type MoveCommand,
	type MoveEntry,
} from "./moveData";

// ---------------------------------------------------------------------------
// Keycaps — a live binding rendered as a key-shaped chip
// ---------------------------------------------------------------------------

/** The primary keyboard-ish code for an action, for a keycap label. */
function keycapFor(action: Action, map: Record<Action, string[]>): string {
	const codes = map[action];
	if (!codes || codes.length === 0) return "—";
	// Prefer a keyboard or mouse label over a pad label for the big command row.
	const preferred = codes.find((c) => !c.startsWith("Pad"));
	if (preferred !== undefined) return codeLabel(preferred);
	const first = codes[0];
	return first !== undefined ? codeLabel(first) : "—";
}

/** A sequence of chips for a command, e.g. HOLD → RELEASE. */
function CommandChips({
	command,
	map,
}: {
	command: MoveCommand;
	map: Record<Action, string[]>;
}) {
	const groups = commandGroups(command);
	if (groups.length === 0) return null;
	const join = command.join ?? "then";
	return (
		<span className="ml-chips">
			{groups.map((group, gi) => (
				<span key={group.join("-")} className="ml-chip-group">
					{gi > 0 && <span className="ml-chip-sep">{join}</span>}
					{group.map((a, i) => (
						<span key={`${a}-${i}`} className="ml-chip-group">
							{i > 0 && <span className="ml-chip-sep">then</span>}
							<span className="ml-chip">{keycapFor(a, map)}</span>
						</span>
					))}
				</span>
			))}
		</span>
	);
}

/**
 * The prose is written with `**bold**` and `*italic*` for emphasis. It used to
 * be rendered as a raw text node, so every card printed its asterisks. This
 * renders the two emphases the content uses and nothing else — no HTML path,
 * because lesson prose comes from the content layer, not a CMS.
 */
function richText(text: string) {
	return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
		if (part.startsWith("**") && part.endsWith("**"))
			return <strong key={i}>{part.slice(2, -2)}</strong>;
		if (part.startsWith("*") && part.endsWith("*"))
			return <em key={i}>{part.slice(1, -1)}</em>;
		return <span key={i}>{part}</span>;
	});
}

// ---------------------------------------------------------------------------
// The main component
// ---------------------------------------------------------------------------

export function MoveList({
	hero,
	onClose,
}: {
	hero: HeroId;
	onClose: () => void;
}) {
	const list: HeroMoveList = MOVE_LISTS[hero];
	const heroDef = HEROES[hero];
	const [index, setIndex] = useState(0);
	const [bindingsMap, setBindingsMap] = useState(() => bindings.snapshot());

	// Snapshot the bindings so the React Compiler sees a value it memoises on.
	useEffect(() => {
		const off = bindings.subscribe(() => setBindingsMap(bindings.snapshot()));
		return off;
	}, []);

	const entries = list.entries;
	// The lists are non-empty compile-time constants.
	const current = (entries[index] ?? entries[0]) as MoveEntry;

	// Flatten the category ranges so Up/Down and Left/Right share one model.
	const byCategory = useMemo(() => {
		const map = new Map<MoveCategory, number[]>();
		CATEGORY_ORDER.forEach((cat) => {
			map.set(cat, []);
		});
		entries.forEach((e, i) => {
			map.get(e.category)?.push(i);
		});
		return map;
	}, [entries]);

	// Position within the current category, e.g. "2 / 5", so a player knows
	// which move of the set they are reading.
	const currentCategoryCount =
		(byCategory.get(current.category) ?? []).length || 0;
	const categoryIndex = (byCategory.get(current.category) ?? []).indexOf(index);
	const currentInCategory = (categoryIndex < 0 ? 0 : categoryIndex) + 1;

	const moveWithin = (delta: number) => {
		setIndex((i) => Math.max(0, Math.min(entries.length - 1, i + delta)));
	};

	const rootRef = useRef<HTMLDivElement>(null);

	// Focus the panel when it opens and give it back when it closes. The root
	// menu stays in the DOM behind an opaque panel, so without this Tab walks
	// into controls nobody can see.
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		rootRef.current?.querySelector<HTMLElement>(".ml-back")?.focus();
		return () => previous?.focus?.();
	}, []);

	const categoryStep = (dir: -1 | 1) => {
		setIndex((i) => {
			const cur = (entries[i] ?? entries[0]) as MoveEntry;
			const cats = CATEGORY_ORDER.filter(
				(c) => (byCategory.get(c) ?? []).length > 0,
			);
			const pos = cats.indexOf(cur.category);
			const next = cats[(pos + dir + cats.length) % cats.length];
			const first =
				next === undefined ? undefined : (byCategory.get(next) ?? [])[0];
			return first ?? i;
		});
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: closes over stable setters only — the React Compiler memoises them.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const code = e.code;
			if (code === "Tab") {
				const focusable = Array.from(
					rootRef.current?.querySelectorAll<HTMLElement>(
						'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
					) ?? [],
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (first === undefined || last === undefined) return;
				// Focus can be on <body> after a click on the panel's padding. Tab
				// would then walk into the menu mounted behind the opaque panel.
				if (!rootRef.current?.contains(document.activeElement)) {
					e.preventDefault();
					first.focus();
					return;
				}
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
				return;
			}
			if (code === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
				return;
			}
			// Arrows are the navigation language. WASD stays as a courtesy for a
			// left-hand player, but the hint no longer claims it — a rebound
			// movement key made that a lie.
			const isDown = code === "ArrowDown" || code === "KeyS";
			const isUp = code === "ArrowUp" || code === "KeyW";
			const isLeft = code === "ArrowLeft" || code === "KeyA";
			const isRight = code === "ArrowRight" || code === "KeyD";

			if (isDown) {
				e.preventDefault();
				moveWithin(1);
			} else if (isUp) {
				e.preventDefault();
				moveWithin(-1);
			} else if (isRight) {
				e.preventDefault();
				categoryStep(1);
			} else if (isLeft) {
				e.preventDefault();
				categoryStep(-1);
			}
		};
		// Capture phase so this sub-view's Esc (return to menu) fires before the
		// PauseMenu's own bubble-phase Esc (close the whole menu).
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);

	// The rail groups, in category order.
	const railGroups = CATEGORY_ORDER.map((cat) => ({
		cat,
		label: CATEGORY_LABELS[cat],
		items: entries.filter((e) => e.category === cat),
	})).filter((g) => g.items.length > 0);

	return (
		<div
			ref={rootRef}
			className="ml-root"
			role="dialog"
			aria-modal="true"
			aria-label="Move list"
		>
			<style>{HUD_CSS}</style>
			<style>{HERO_SPRITE_CSS}</style>
			<style>{ML_CSS}</style>

			<div className="ml-header">
				<span className="ml-hero-name">{heroDef.name}</span>
				<span className="ml-title">Move List</span>
				<div className="ml-nav">
					<button
						className="ml-nav-btn"
						type="button"
						aria-label="Previous move"
						onClick={() => moveWithin(-1)}
					>
						‹
					</button>
					<button
						className="ml-nav-btn"
						type="button"
						aria-label="Next move"
						onClick={() => moveWithin(1)}
					>
						›
					</button>
				</div>
				<button type="button" className="ml-back" onClick={onClose}>
					← Back
				</button>
			</div>

			<div className="ml-body">
				{/* ---- rail: categories up the left ---- */}
				<nav className="ml-rail" aria-label="Move categories">
					{railGroups.map((g) => {
						const active = g.items.some((e) => e.id === current.id);
						return (
							<div
								key={g.cat}
								className={`ml-rail-group${active ? " ml-rail-on" : ""}`}
							>
								<div className="ml-rail-head">
									<span className="ml-rail-cat">{g.label}</span>
									<span className="ml-rail-count">{g.items.length}</span>
								</div>
								<div className="ml-rail-dots">
									{g.items.map((e) => (
										<button
											key={e.id}
											type="button"
											className={`ml-dot${e.id === current.id ? " ml-dot-on" : ""}`}
											title={e.name}
											aria-label={e.name}
											aria-current={e.id === current.id ? "true" : undefined}
											onClick={() => setIndex(entries.indexOf(e))}
										/>
									))}
								</div>
							</div>
						);
					})}
				</nav>

				<div className="ml-main">
					{/* ---- the featured card ---- */}
					<div className="ml-card" key={current.id}>
						<div className="ml-card-left">
							<div className="ml-portrait">
								<div
									className={`ml-portrait-sprite hp-sprite hp-sprite-${hero}`}
								/>
								<div className="ml-cat-badge">
									{CATEGORY_LABELS[current.category]}
								</div>
							</div>
							<div className="ml-name">
								{current.move && (
									<span className="ml-move-id">{current.move}</span>
								)}
								<h2 className="ml-move-name">{current.name}</h2>
								{current.tags && (
									<div className="ml-tags">
										{current.tags.split(" · ").map((t) => (
											<span key={t}>{t}</span>
										))}
									</div>
								)}
							</div>
						</div>

						<div className="ml-card-right">
							<div className="ml-command-row">
								<span className="ml-command-label">COMMAND</span>
								<CommandChips
									command={current.command}
									map={bindingsMap}
								/>
								<span className="ml-command-text">{current.command.label}</span>
							</div>
							<p className="ml-prose">{richText(current.prose)}</p>
							<StatCard entry={current} />
						</div>
					</div>

					{/* ---- the preview: a live stage filling the rest ---- */}
					<div className="ml-movie-wrap">
						<div className="ml-movie-head">
							<span>PREVIEW</span>
							<span className="ml-position">
								{currentInCategory} / {currentCategoryCount}
							</span>
						</div>
						<MovePreview entry={current} hero={hero} />
					</div>
				</div>
			</div>

			<div className="ml-hint">
				<span className="ml-hint-keys">
					<span className="ml-key">↑ ↓</span> move ·{" "}
					<span className="ml-key">← →</span> category ·{" "}
					<span className="ml-key">Esc</span> back
				</span>
				<span className="ml-hint-touch">Tap a dot or use ‹ › to walk the list</span>
			</div>
		</div>
	);
}

function StatCard({ entry }: { entry: MoveEntry }) {
	const stats = entry.stats;
	if (!stats || stats.length === 0) return null;
	return (
		<div className="ml-stats">
			<div className="ml-stats-head">STATS</div>
			<div className="ml-stat-grid">
				{stats.map((s) => (
					<div key={s.label} className="ml-stat">
						<div className="ml-stat-label">{s.label}</div>
						<div className="ml-stat-value">{s.value}</div>
						{s.level !== undefined && (
							<div className="ml-stat-bar">
								<div
									className="ml-stat-bar-fill"
									style={{ width: `${Math.round(Math.min(1, s.level) * 100)}%` }}
								/>
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

const ML_CSS = `
.ml-root {
	position: fixed;
	inset: 0;
	z-index: 60;
	display: flex;
	flex-direction: column;
	background:
		radial-gradient(900px 500px at 20% 0%, rgba(14, 195, 201, 0.12), rgba(0, 0, 0, 0) 60%),
		radial-gradient(700px 500px at 90% 110%, rgba(255, 209, 102, 0.08), rgba(0, 0, 0, 0) 60%),
		#07060b;
	color: rgba(255, 255, 255, 0.92);
	font-family: monospace;
}
.ml-header {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 14px 22px;
	border-bottom: 1px solid rgba(255, 209, 102, 0.18);
}
.ml-hero-name {
	color: #ffd166;
	font-size: 15px;
	font-weight: 700;
	letter-spacing: 0.18em;
	text-transform: uppercase;
}
.ml-title {
	font-size: 13px;
	letter-spacing: 0.3em;
	text-transform: uppercase;
	opacity: 0.6;
}
.ml-back {
	margin-left: auto;
	background: rgba(255, 209, 102, 0.08);
	border: 1px solid rgba(255, 209, 102, 0.4);
	color: #ffe6a8;
	font: inherit;
	font-size: 13px;
	font-weight: 700;
	padding: 7px 16px;
	min-height: 44px;
	border-radius: 6px;
	cursor: pointer;
}
.ml-back:hover { border-color: #0ec3c9; color: #7ff0f4; }
.ml-nav {
	display: flex;
	gap: 6px;
	margin-left: auto;
}
.ml-nav-btn {
	min-width: 44px;
	min-height: 44px;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.2);
	color: #ffe6a8;
	font: inherit;
	font-size: 20px;
	line-height: 1;
	border-radius: 6px;
	cursor: pointer;
}
.ml-nav-btn:hover { border-color: #0ec3c9; color: #7ff0f4; }
.ml-nav + .ml-back { margin-left: 0; }

.ml-body {
	flex: 1;
	display: flex;
	gap: 20px;
	padding: 18px 22px 6px;
	min-height: 0;
	overflow-y: auto;
	overscroll-behavior: contain;
}
.ml-main {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 14px;
	min-width: 0;
	min-height: min-content;
}

/* ---- rail ---- */
.ml-rail {
	width: 148px;
	flex: 0 0 auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
	overflow-y: auto;
	border-right: 1px solid rgba(255, 255, 255, 0.08);
	padding-right: 14px;
}
.ml-rail-group {
	padding: 6px 8px;
	border-left: 2px solid rgba(255, 255, 255, 0.1);
	border-radius: 0 6px 6px 0;
	transition: background 120ms;
}
.ml-rail-group:hover { background: rgba(255, 255, 255, 0.03); }
.ml-rail-on { border-left-color: #ffd166; background: rgba(255, 209, 102, 0.06); }
.ml-rail-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 5px;
}
.ml-rail-cat {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: rgba(255, 209, 102, 0.65);
}
.ml-rail-on .ml-rail-cat { color: #ffd166; }
.ml-rail-count {
	font-size: 10px;
	color: rgba(255, 255, 255, 0.4);
	background: rgba(255, 255, 255, 0.08);
	border-radius: 8px;
	padding: 1px 6px;
}
.ml-rail-dots {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
}
.ml-dot {
	width: 11px;
	height: 11px;
	border-radius: 50%;
	border: 1.5px solid rgba(255, 255, 255, 0.55);
	background: rgba(255, 255, 255, 0.1);
	padding: 0;
	cursor: pointer;
	transition: background 120ms, border-color 120ms, transform 120ms;
}
.ml-dot:hover { border-color: #0ec3c9; transform: scale(1.2); }
.ml-dot-on {
	background: #ffd166;
	border-color: #ffd166;
	box-shadow: 0 0 8px rgba(255, 209, 102, 0.6);
}

/* ---- the featured card (content-sized) ---- */
.ml-card {
	display: grid;
	grid-template-columns: minmax(180px, 220px) 1fr;
	gap: 20px;
	background:
		linear-gradient(135deg, rgba(14, 195, 201, 0.06), rgba(0, 0, 0, 0) 40%),
		rgba(255, 255, 255, 0.035);
	border: 1px solid rgba(255, 209, 102, 0.22);
	border-radius: 12px;
	padding: 16px 18px;
	animation: ml-card-in 220ms ease-out;
}
@keyframes ml-card-in {
	from { opacity: 0; transform: translateY(8px); }
	to { opacity: 1; transform: translateY(0); }
}
.ml-card-left {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	gap: 10px;
}
.ml-portrait {
	position: relative;
	width: 148px;
	height: 148px;
	display: flex;
	align-items: center;
	justify-content: center;
	background:
		radial-gradient(circle at 50% 38%, rgba(14, 195, 201, 0.32), rgba(0, 0, 0, 0) 72%);
	border: 1px solid rgba(255, 209, 102, 0.3);
	border-radius: 12px;
	overflow: hidden;
	box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.5);
}
.ml-portrait .hp-sprite {
	transform: scale(2.2);
	transform-origin: center;
	filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.6));
}
.ml-cat-badge {
	position: absolute;
	bottom: 8px;
	left: 8px;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: #0ec3c9;
	background: rgba(0, 0, 0, 0.7);
	border: 1px solid rgba(14, 195, 201, 0.4);
	padding: 3px 8px;
	border-radius: 5px;
}
.ml-name { min-width: 0; }
.ml-move-id {
	font-size: 10px;
	letter-spacing: 0.14em;
	color: rgba(255, 255, 255, 0.4);
	text-transform: uppercase;
}
.ml-move-name {
	margin: 3px 0 8px;
	font-size: 30px;
	line-height: 1.05;
	color: #ffd166;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	text-shadow: 0 2px 12px rgba(255, 209, 102, 0.25);
}
.ml-tags {
	display: inline-flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 6px;
}
.ml-tags span {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: #7ff0f4;
	background: rgba(14, 195, 201, 0.12);
	border: 1px solid rgba(14, 195, 201, 0.35);
	border-radius: 999px;
	padding: 3px 9px;
	text-transform: uppercase;
}

.ml-card-right {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
}
.ml-command-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
}
.ml-command-label {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.16em;
	color: rgba(255, 209, 102, 0.6);
}
.ml-chips { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ml-chip-group { display: inline-flex; align-items: center; gap: 6px; }
.ml-chip {
	display: inline-block;
	min-width: 34px;
	text-align: center;
	background: rgba(255, 255, 255, 0.08);
	border: 1px solid rgba(255, 209, 102, 0.5);
	border-bottom-width: 2px;
	border-radius: 5px;
	padding: 5px 10px;
	font-size: 13px;
	font-weight: 700;
	color: #ffe6a8;
	box-shadow: 0 2px 0 rgba(0, 0, 0, 0.4);
}
.ml-chip-sep { font-size: 10px; color: rgba(255, 255, 255, 0.4); }
.ml-command-text { font-size: 12px; opacity: 0.7; }

.ml-prose {
	margin: 0;
	font-size: 13.5px;
	line-height: 1.6;
	opacity: 0.9;
	max-width: 58ch;
}

/* ---- stats ---- */
.ml-stats { margin-top: 2px; }
.ml-stats-head {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.18em;
	color: rgba(255, 209, 102, 0.6);
	margin-bottom: 8px;
}
.ml-stat-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
	gap: 9px;
}
.ml-stat {
	background: rgba(0, 0, 0, 0.45);
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: 7px;
	padding: 7px 9px 9px;
}
.ml-stat-label {
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.12em;
	color: rgba(255, 255, 255, 0.45);
}
.ml-stat-value {
	font-size: 15px;
	font-weight: 700;
	color: #ffe6a8;
	margin: 2px 0 6px;
}
.ml-stat-bar {
	height: 10px;
	background: rgba(255, 255, 255, 0.14);
	border-radius: 5px;
	overflow: hidden;
}
.ml-stat-bar-fill {
	height: 100%;
	background: linear-gradient(90deg, #0ec3c9, #ffd166);
	border-radius: 5px;
}

/* ---- preview: a live stage filling the rest ---- */
.ml-movie-wrap {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-height: 0;
}
.ml-movie-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.18em;
	color: rgba(255, 255, 255, 0.5);
	text-transform: uppercase;
}
.ml-position {
	color: #ffd166;
}

.ml-hint {
	padding: 8px 22px 14px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.6);
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
}
.ml-hint-touch { display: none; }
.ml-key {
	display: inline-block;
	background: rgba(255, 255, 255, 0.1);
	border: 1px solid rgba(255, 255, 255, 0.3);
	border-radius: 4px;
	padding: 2px 7px;
	font-size: 11px;
	font-weight: 700;
	color: #ffe6a8;
}

@media (max-width: 720px) {
	.ml-header { flex-wrap: wrap; padding: 10px 12px; }
	.ml-nav { margin-left: auto; }
	.ml-body {
		flex-direction: column;
		gap: 12px;
		padding: 12px 12px 6px;
	}
	.ml-rail {
		flex-direction: row;
		width: auto;
		border-right: none;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0 0 8px;
	}
	.ml-rail-group { flex: 0 0 auto; }
	.ml-card { grid-template-columns: 1fr; padding: 12px; }
	.ml-portrait { width: 96px; height: 96px; }
	.ml-portrait .hp-sprite { transform: scale(1.5); }
	.ml-move-name { font-size: 24px; }
	.ml-movie-wrap { flex: 0 0 auto; }
	.mp-stage { min-height: 220px; }
	.ml-hint-keys { display: none; }
	.ml-hint-touch { display: inline; }
	.ml-hint { padding: 8px 12px 12px; }
}

@media (max-height: 700px) and (min-width: 721px) {
	.ml-body { padding-top: 10px; }
	.ml-card { padding: 12px 16px; }
	.ml-movie-wrap { flex: 0 0 auto; }
	.mp-stage { min-height: 160px; }
}

@media (pointer: coarse) {
	.ml-dot { position: relative; width: 16px; height: 16px; }
	.ml-dot::after { content: ""; position: absolute; inset: -14px; }
}

@media (prefers-reduced-motion: reduce) {
	.ml-card { animation: none; }
	.ml-dot { transition: none; }
}
`;
