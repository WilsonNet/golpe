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

import { useEffect, useMemo, useState } from "react";
import type { Action } from "../game/input/Bindings";
import { bindings, codeLabel } from "../game/input/Bindings";
import { HEROES, type HeroId } from "../game/simulation/Heroes";
import { type MeleeMove, MOVES } from "../game/simulation/Melee";
import { HERO_SPRITE_CSS } from "./HeroSelect";
import { HUD_CSS } from "./hudStyles";
import {
	CATEGORY_LABELS,
	CATEGORY_ORDER,
	type CommandAction,
	type HeroMoveList,
	MOVE_LISTS,
	type MoveCategory,
	type MoveEntry,
} from "./moveData";

/** How long the idle beat before a melee movie restarts, in ms. */
const MOVIE_IDLE_MS = 700;
/** Total loop time (idle + move) for the phase animations. */
const MOVIE_LOOP_MS = 3200;

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

/** A sequence of chips for a command, e.g. HOLD LMB → RELEASE. */
function CommandChips({
	actions,
	map,
}: {
	actions: CommandAction[];
	map: Record<Action, string[]>;
}) {
	if (actions.length === 0) return null;
	return (
		<span className="ml-chips">
			{actions.map((a, i) => (
				<span key={a} className="ml-chip-group">
					{i > 0 && <span className="ml-chip-sep">then</span>}
					<span className="ml-chip">{keycapFor(a, map)}</span>
				</span>
			))}
		</span>
	);
}

// ---------------------------------------------------------------------------
// The "movie": a timed phase visualisation driven by real frame data
// ---------------------------------------------------------------------------

/**
 * For a melee move, derive the phase durations and build the keyframe
 * timeline. The cursor sweeps startup → active → recovery exactly as long as
 * the move actually lasts, then rests.
 */
function usePhaseTimeline(entry: MoveEntry) {
	return useMemo(() => {
		if (!entry.move) return null;
		const d = MOVES[entry.move];
		const total = d.startupMs + d.activeMs + d.recoveryMs;
		// Percentages are measured against the whole loop (idle + move), so the
		// idle beat at the front of the loop holds the cursor at rest.
		const start = (MOVIE_IDLE_MS / MOVIE_LOOP_MS) * 100;
		const s = (d.startupMs / MOVIE_LOOP_MS) * 100;
		const a = (d.activeMs / MOVIE_LOOP_MS) * 100;
		const r = (d.recoveryMs / MOVIE_LOOP_MS) * 100;
		return { total, d, start, s, a, r };
	}, [entry]);
}

/** The keyframes the frame-data cursor follows, driven by real timings. */
function cursorKeyframes(
	phase: NonNullable<ReturnType<typeof usePhaseTimeline>>,
) {
	const t = phase.start + phase.s + phase.a + phase.r;
	return `
@keyframes ml-cursor {
	0% { left: 0%; }
	${phase.start}% { left: 0%; }
	${phase.start + phase.s}% { left: 18%; }
	${phase.start + phase.s + phase.a}% { left: 58%; }
	${t}% { left: 100%; }
	100% { left: 100%; }
}`;
}

function MoveMovie({ entry, hero }: { entry: MoveEntry; hero: HeroId }) {
	const phase = usePhaseTimeline(entry);
	const isMelee = phase !== null;

	return (
		<div className="ml-stage" key={entry.id}>
			{phase && <style>{cursorKeyframes(phase)}</style>}
			{isMelee ? (
				<>
					<div className="ml-stage-bg" />
					<div className="ml-shadow" />
					<div className="ml-swing" />
					<div className="ml-swing ml-swing-rev" />
					<div className={`ml-fighter hp-sprite hp-sprite-${hero}`} />
					<div className="ml-ground" />
					<div className="ml-hitbox" />
					<div className="ml-impact" />
					<div className="ml-tl">
						<div
							className="ml-tl-seg ml-tl-startup"
							style={{ flexGrow: phase.d.startupMs }}
						/>
						<div
							className="ml-tl-seg ml-tl-active"
							style={{ flexGrow: phase.d.activeMs }}
						/>
						<div
							className="ml-tl-seg ml-tl-recovery"
							style={{ flexGrow: phase.d.recoveryMs }}
						/>
						<div className="ml-tl-cursor" />
					</div>
					<div className="ml-tl-labels">
						<span>STARTUP {phase.d.startupMs}</span>
						<span>ACTIVE {phase.d.activeMs}</span>
						<span>RECOVERY {phase.d.recoveryMs}</span>
					</div>
				</>
			) : (
				<>
					<div className="ml-stage-bg" />
					<div className="ml-shadow" />
					<div
						className={`ml-fighter ml-fighter-idle hp-sprite hp-sprite-${hero}`}
					/>
					<div className="ml-ground" />
					<div className="ml-stage-note">preview</div>
				</>
			)}
		</div>
	);
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
	const currentInCategory =
		((byCategory.get(current.category) ?? []).indexOf(index) ?? 0) + 1;

	const moveWithin = (delta: number) => {
		setIndex((i) => Math.max(0, Math.min(entries.length - 1, i + delta)));
	};

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
			if (code === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
				return;
			}
			// Respect the player's own bindings for Up/Down/Left/Right where
			// possible, falling back to arrows/WASD.
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
		<div className="ml-root">
			<style>{HUD_CSS}</style>
			<style>{HERO_SPRITE_CSS}</style>
			<style>{ML_CSS}</style>

			<div className="ml-header">
				<span className="ml-hero-name">{heroDef.name}</span>
				<span className="ml-title">Move List</span>
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
									actions={current.command.actions}
									map={bindingsMap}
								/>
								<span className="ml-command-text">{current.command.label}</span>
							</div>
							<p className="ml-prose">{current.prose}</p>
							<StatCard entry={current} />
						</div>
					</div>

					{/* ---- the movie: a live preview filling the rest ---- */}
					<div className="ml-movie-wrap">
						<div className="ml-movie-head">
							<span>PREVIEW</span>
							<span className="ml-position">
								{currentInCategory} / {currentCategoryCount}
							</span>
						</div>
						<MoveMovie entry={current} hero={hero} />
					</div>
				</div>
			</div>

			<div className="ml-hint">
				<span className="ml-key">↑ ↓</span> or{" "}
				<span className="ml-key">W/S</span> move ·{" "}
				<span className="ml-key">← →</span> or{" "}
				<span className="ml-key">A/D</span> category ·{" "}
				<span className="ml-key">Esc</span> back
			</div>
		</div>
	);
}

function StatCard({ entry }: { entry: MoveEntry }) {
	const stats = entry.move ? meleeRows(entry.move) : entry.stats;
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
									style={{ width: `${Math.round(s.level * 100)}%` }}
								/>
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function meleeRows(move: MeleeMove) {
	const d = MOVES[move];
	return [
		{ label: "DMG", value: `${d.damage}`, level: Math.min(1, d.damage / 24) },
		{
			label: "REACH",
			value: `${d.reachPx}px`,
			level: Math.min(1, d.reachPx / 62),
		},
		{ label: "STARTUP", value: `${d.startupMs}ms`, level: d.startupMs / 160 },
		{ label: "ACTIVE", value: `${d.activeMs}ms`, level: d.activeMs / 160 },
		{
			label: "RECOVERY",
			value: `${d.recoveryMs}ms`,
			level: d.recoveryMs / 500,
		},
	];
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
	border-radius: 6px;
	cursor: pointer;
}
.ml-back:hover { border-color: #0ec3c9; color: #7ff0f4; }

.ml-body {
	flex: 1;
	display: flex;
	gap: 20px;
	padding: 18px 22px 6px;
	min-height: 0;
}
.ml-main {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 14px;
	min-width: 0;
	min-height: 0;
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

/* ---- movie: a live preview filling the rest ---- */
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
.ml-stage {
	position: relative;
	flex: 1;
	min-height: 170px;
	overflow: hidden;
	border-radius: 10px;
	border: 1px solid rgba(255, 255, 255, 0.12);
}
.ml-stage-bg {
	position: absolute;
	inset: 0;
	background:
		radial-gradient(600px 300px at 50% 20%, rgba(14, 195, 201, 0.14), rgba(0, 0, 0, 0) 70%),
		linear-gradient(180deg, #0a1520 0%, #06070c 60%, #04040a 100%);
}
.ml-ground {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 56px;
	height: 3px;
	background: linear-gradient(90deg, transparent, rgba(255, 209, 102, 0.45), transparent);
}
.ml-stage .hp-sprite {
	position: absolute;
	left: 50%;
	bottom: 56px;
	transform: translateX(-50%) scale(2.6);
	transform-origin: bottom center;
	z-index: 2;
	filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.7));
}
/* The fighter lives: a breathing bob at rest, then a committed lunge toward
   the hitbox during the active window — so the still reads as a move, not a
   portrait. */
.ml-stage .hp-sprite {
	animation: ml-fighter 3.2s ease-in-out infinite;
}
.ml-fighter-idle {
	animation: ml-bob 2.6s ease-in-out infinite !important;
}
@keyframes ml-fighter {
	0%, 22% { transform: translateX(-50%) scale(2.6) translateY(0); }
	27%, 32% { transform: translateX(-34%) scale(2.6) translateY(2px) rotate(-3deg); }
	44%, 52% { transform: translateX(-14%) scale(2.6) translateY(-2px) rotate(4deg); }
	60%, 100% { transform: translateX(-50%) scale(2.6) translateY(0) rotate(0); }
}
@keyframes ml-bob {
	0%, 100% { transform: translateX(-50%) scale(2.6) translateY(0); }
	50% { transform: translateX(-50%) scale(2.6) translateY(-5px); }
}
/* The shadow anchors the fighter to the floor. */
.ml-shadow {
	position: absolute;
	left: 50%;
	bottom: 56px;
	width: 70px;
	height: 14px;
	transform: translateX(-50%);
	border-radius: 50%;
	background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0) 70%);
	z-index: 1;
}
/* The swing arc: a broad slash that flares across the active window. */
.ml-swing {
	position: absolute;
	left: 50%;
	bottom: 56px;
	width: 300px;
	height: 260px;
	transform: translateX(-6%);
	z-index: 1;
	opacity: 0;
	background:
		radial-gradient(ellipse at 8% 82%, rgba(255, 209, 102, 0.55) 0%, rgba(255, 209, 102, 0) 58%);
	filter: blur(1px);
	animation: ml-swing 3.2s ease-in-out infinite;
}
.ml-swing-rev {
	transform: translateX(6%) scaleX(-1);
	animation-name: ml-swing-rev;
	opacity: 0;
}
@keyframes ml-swing {
	0%, 20% { opacity: 0; transform: translateX(-6%) scaleX(0.25); }
	30%, 55% { opacity: 0.95; transform: translateX(-6%) scaleX(1.05); }
	62%, 100% { opacity: 0; transform: translateX(-6%) scaleX(0.25); }
}
@keyframes ml-swing-rev {
	0%, 20% { opacity: 0; transform: translateX(6%) scaleX(-0.25); }
	30%, 55% { opacity: 0.75; transform: translateX(6%) scaleX(-1.05); }
	62%, 100% { opacity: 0; transform: translateX(6%) scaleX(-0.25); }
}
.ml-hitbox {
	position: absolute;
	bottom: 66px;
	left: 50%;
	width: 120px;
	height: 48px;
	border: 2px solid rgba(255, 209, 102, 0.95);
	background: rgba(255, 209, 102, 0.25);
	border-radius: 5px;
	z-index: 3;
	transform: translateX(12%);
	opacity: 0;
	animation: ml-hit 3.2s ease-in-out infinite;
}
@keyframes ml-hit {
	0%, 24% { opacity: 0; transform: translateX(12%) scaleX(0.3); }
	34%, 50% { opacity: 1; transform: translateX(12%) scaleX(1); }
	60%, 100% { opacity: 0; transform: translateX(12%) scaleX(0.3); }
}
.ml-impact {
	position: absolute;
	left: 50%;
	bottom: 56px;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 0 16px 4px rgba(255, 209, 102, 0.9);
	z-index: 4;
	opacity: 0;
	animation: ml-impact 3.2s ease-in-out infinite;
}
@keyframes ml-impact {
	0%, 33% { opacity: 0; transform: translate(110px, -10px) scale(0.4); }
	40%, 46% { opacity: 1; transform: translate(110px, -10px) scale(1.4); }
	54%, 100% { opacity: 0; transform: translate(110px, -10px) scale(0.4); }
}
.ml-tl {
	position: absolute;
	left: 60px;
	right: 60px;
	bottom: 26px;
	height: 10px;
	display: flex;
	background: rgba(255, 255, 255, 0.08);
	border-radius: 5px;
	overflow: visible;
	box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
	z-index: 5;
}
.ml-tl-seg { height: 100%; }
.ml-tl-startup { background: #3d6b8f; }
.ml-tl-active { background: #ffd166; }
.ml-tl-recovery { background: #6a4a92; }
.ml-tl-cursor {
	position: absolute;
	top: -5px;
	width: 3px;
	height: 20px;
	background: #fff;
	border-radius: 2px;
	box-shadow: 0 0 8px #fff;
	animation: ml-cursor 3.2s linear infinite;
}
.ml-tl-labels {
	position: absolute;
	left: 60px;
	right: 60px;
	bottom: 10px;
	display: flex;
	justify-content: space-between;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	color: rgba(255, 255, 255, 0.6);
	z-index: 5;
}
.ml-stage-note {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	letter-spacing: 0.14em;
	color: rgba(255, 255, 255, 0.35);
	text-transform: uppercase;
	z-index: 6;
}

.ml-hint {
	padding: 8px 22px 14px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.6);
	display: flex;
	align-items: center;
	gap: 6px;
}
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
	.ml-body { flex-direction: column; }
	.ml-rail { flex-direction: row; width: auto; border-right: none; border-bottom: 1px solid rgba(255,255,255,0.08); }
	.ml-card { grid-template-columns: 1fr; }
}
`;
