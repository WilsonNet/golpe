/**
 * The training room's menu.
 *
 * **DOM, not Pixi text.** Canvas text has to be laid out by hand and cannot be
 * selected, scrolled or focused; a control panel is exactly the case the
 * canvas/DOM split exists for — see the `pixi-text-and-ui` skill.
 *
 * It is a *client* of `window.__training`, not a second way in. Everything it
 * does, an agent can do with the same call, and everything it shows comes from
 * the server's echoed config rather than from its own optimistic copy — a menu
 * that believed itself would drift from the room it is supposed to be
 * describing.
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import type { TrainingState } from "../game/training/report";
import type {
	DummyBehaviour,
	TrainingConfigPatch,
} from "../game/training/types";

const STORAGE_KEY = "golpe.training.panel";

/** How often the live readout is refreshed. Fast enough to watch a beat advance. */
const POLL_MS = 100;

const BEHAVIOURS: { value: DummyBehaviour; label: string; hint: string }[] = [
	{ value: "idle", label: "Idle", hint: "Stands still. Never acts." },
	{ value: "blockAll", label: "Block all", hint: "Holds block, front only." },
	{
		value: "blockAfterFirstHit",
		label: "Block after first hit",
		hint: "Idle until hit, then guards for the block duration.",
	},
	{ value: "jump", label: "Jump", hint: "Full-height jump on a period." },
	{ value: "walk", label: "Walk", hint: "Paces between the walk bounds." },
	{ value: "slash", label: "Slash", hint: "One slash per period." },
	{ value: "uppercut", label: "Uppercut", hint: "One uppercut per period." },
	{
		value: "massive",
		label: "Massive Strike",
		hint: "Charges 420ms and releases, per period.",
	},
	{
		value: "butterfly",
		label: "Butterfly",
		hint: "Slash cancelled into block, repeatedly.",
	},
	{
		value: "combo",
		label: "Combo",
		hint: "The three-hit ground chain, ending in a knockdown.",
	},
	{
		value: "counterAttack",
		label: "Counter-attack",
		hint: "Swings delayMs after your move goes active.",
	},
	{
		value: "mirror",
		label: "Mirror",
		hint: "Repeats your input from mirrorDelayMs ago.",
	},
	{ value: "record", label: "Recording…", hint: "Captures your input stream." },
	{ value: "playback", label: "Playback", hint: "Loops the recording." },
	{ value: "script", label: "Script", hint: "Runs an explicit beat list." },
];

/** The numeric behaviour parameters, as they appear in the panel. */
const TIMINGS = [
	{ key: "periodMs", label: "Period", hint: "Gap between repetitions" },
	{
		key: "delayMs",
		label: "Counter delay",
		hint: "After your move goes active",
	},
	{ key: "blockMs", label: "Block for", hint: "Guard duration after a hit" },
	{ key: "walkLeftX", label: "Walk left x", hint: "World pixels" },
	{ key: "walkRightX", label: "Walk right x", hint: "World pixels" },
	{ key: "mirrorDelayMs", label: "Mirror delay", hint: "How far behind you" },
] as const;

const TOGGLES = [
	{ key: "playerInvincible", label: "Player invincible" },
	{ key: "dummyInvincible", label: "Dummy invincible" },
	{ key: "disableRoundReset", label: "No round reset" },
] as const;

const CSS = `
.gt-panel {
	position: absolute; top: 8px; left: 8px; z-index: 20;
	width: 300px; max-height: calc(100% - 16px); overflow-y: auto;
	background: rgba(12, 14, 22, 0.92); color: #e8e8f0;
	font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5;
	border: 1px solid #3a3f55; border-radius: 6px;
}
.gt-head {
	display: flex; align-items: center; justify-content: space-between;
	width: 100%; padding: 6px 10px; cursor: pointer;
	background: rgba(255,255,255,0.05); color: inherit;
	border: 0; border-radius: 6px 6px 0 0; font: inherit;
	font-weight: bold; letter-spacing: 0.5px; text-align: left;
}
.gt-body { padding: 8px 10px 12px; display: grid; gap: 10px; }
.gt-section { display: grid; gap: 4px; }
.gt-legend { color: #8a90ad; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
.gt-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gt-row label { color: #b9bed4; }
.gt-panel select, .gt-panel input[type="number"] {
	background: #1b1f2e; color: #e8e8f0; border: 1px solid #3a3f55;
	border-radius: 3px; padding: 2px 4px; font: inherit; width: 96px;
}
.gt-panel select { width: 100%; }
.gt-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
.gt-panel button {
	background: #262b3d; color: #e8e8f0; border: 1px solid #3a3f55;
	border-radius: 3px; padding: 3px 8px; font: inherit; cursor: pointer;
}
.gt-panel button:hover { background: #333a52; }
.gt-panel button.gt-live { background: #6b2530; border-color: #a33; }
.gt-hint { color: #7b8099; font-size: 10px; }
.gt-readout { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.gt-readout dt { color: #8a90ad; }
.gt-readout dd { margin: 0; }
.gt-warn { color: #ffb454; }
.gt-ok { color: #8fd694; }
.gt-frame { border-top: 1px solid #2a2f42; padding-top: 6px; }
`;

interface PanelPrefs {
	collapsed: boolean;
}

function loadPrefs(): PanelPrefs {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return { collapsed: false, ...JSON.parse(raw) };
	} catch {
		// A corrupt preference is not worth a broken panel.
	}
	return { collapsed: false };
}

const ms = (n: number) => `${Math.round(n)}ms`;

/**
 * Phase timings for the last exchange, measured against the frame data table.
 *
 * The single most useful thing in the panel: "what did that move actually do,
 * and what did the server make of it" is otherwise only answerable by reading a
 * diagnostic JSON blob after the fact.
 */
function FrameData({ state }: { state: TrainingState }) {
	const x = state.lastExchange;
	if (!x) return <div className="gt-hint">No exchange yet.</div>;

	const rows = [
		["startup", x.measured.startupMs, x.declared.startupMs],
		["active", x.measured.activeMs, x.declared.activeMs],
		["recovery", x.measured.recoveryMs, x.declared.recoveryMs],
	] as const;

	return (
		<div className="gt-frame">
			<div className="gt-row">
				<strong>{x.move}</strong>
				<span className={x.outcome ? "gt-ok" : "gt-hint"}>
					{x.outcome ?? "whiff"}
					{x.damage > 0 ? ` · ${x.damage} dmg` : ""}
				</span>
			</div>
			<dl className="gt-readout">
				{rows.map(([label, measured, declared]) => (
					<Fragmented
						key={label}
						label={label}
						value={`${ms(measured)} / ${ms(declared)}`}
						warn={Math.abs(measured - declared) > 40}
					/>
				))}
			</dl>
		</div>
	);
}

function Fragmented({
	label,
	value,
	warn,
}: {
	label: string;
	value: string;
	warn?: boolean;
}) {
	return (
		<>
			<dt>{label}</dt>
			<dd className={warn ? "gt-warn" : undefined}>{value}</dd>
		</>
	);
}

export function TrainingPanel() {
	const [state, setState] = useState<TrainingState | null>(null);
	const [collapsed, setCollapsed] = useState(() => loadPrefs().collapsed);
	/** Numbers being typed. Committed on blur or Enter, never on every keystroke. */
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const draftsRef = useRef(drafts);
	draftsRef.current = drafts;

	// Poll rather than rely on `training-state` alone: config changes arrive as
	// events, but the dummy's live position and the last exchange come from the
	// snapshot and the local simulation, which have no event of their own.
	useEffect(() => {
		const tick = () => setState(window.__training?.state() ?? null);
		tick();
		const id = setInterval(tick, POLL_MS);
		const off = EventBus.on("training-state", tick);
		return () => {
			clearInterval(id);
			off();
		};
	}, []);

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed }));
	}, [collapsed]);

	/**
	 * Give the canvas the keyboard back on any click into the game.
	 *
	 * A panel that keeps focus swallows WASD into whichever number field was last
	 * touched, and the mode becomes unusable — which is the one failure a
	 * practice UI cannot afford.
	 */
	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.closest(".gt-panel")) return;
			(document.activeElement as HTMLElement | null)?.blur();
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, []);

	const apply = (patch: TrainingConfigPatch) => {
		void window.__training?.set(patch);
	};

	const config = state?.config;
	const behaviourHint =
		BEHAVIOURS.find((b) => b.value === config?.behaviour)?.hint ?? "";

	if (!state || !config) {
		return (
			<div className="gt-panel">
				<style>{CSS}</style>
				<div className="gt-head">TRAINING</div>
				<div className="gt-body gt-hint">Connecting to the training room…</div>
			</div>
		);
	}

	const commitTiming = (key: string) => {
		const raw = draftsRef.current[key];
		if (raw === undefined) return;
		const value = Number(raw);
		setDrafts((d) => {
			const next = { ...d };
			delete next[key];
			return next;
		});
		if (Number.isFinite(value)) apply({ timing: { [key]: value } });
	};

	const recording = config.behaviour === "record";

	return (
		<div className="gt-panel">
			<style>{CSS}</style>
			<button
				type="button"
				className="gt-head"
				onClick={() => setCollapsed((c) => !c)}
			>
				<span>TRAINING ROOM</span>
				<span className={state.connected ? "gt-ok" : "gt-warn"}>
					{state.connected ? "●" : "○"} {collapsed ? "+" : "−"}
				</span>
			</button>

			{collapsed ? null : (
				<div className="gt-body">
					<div className="gt-section">
						<div className="gt-legend">Dummy</div>
						<select
							value={config.behaviour}
							onChange={(e) =>
								apply({ behaviour: e.target.value as DummyBehaviour })
							}
						>
							{BEHAVIOURS.map((b) => (
								<option key={b.value} value={b.value}>
									{b.label}
								</option>
							))}
						</select>
						<div className="gt-hint">{behaviourHint}</div>
						<div className="gt-row">
							<label htmlFor="gt-facing">Facing</label>
							<select
								id="gt-facing"
								value={config.facing}
								onChange={(e) =>
									apply({
										facing: e.target.value as typeof config.facing,
									})
								}
							>
								<option value="foe">towards you</option>
								<option value="away">away from you</option>
								<option value="left">left</option>
								<option value="right">right</option>
							</select>
						</div>
						<div className="gt-row">
							<label htmlFor="gt-stance">Stance</label>
							<select
								id="gt-stance"
								value={config.dummyStance}
								onChange={(e) =>
									apply({
										dummyStance: e.target.value as "sword" | "gun",
									})
								}
							>
								<option value="sword">sword</option>
								<option value="gun">gun</option>
							</select>
						</div>
					</div>

					<div className="gt-section">
						<div className="gt-legend">Timing</div>
						{TIMINGS.map((t) => (
							<div className="gt-row" key={t.key}>
								<label htmlFor={`gt-${t.key}`} title={t.hint}>
									{t.label}
								</label>
								<input
									id={`gt-${t.key}`}
									type="number"
									value={drafts[t.key] ?? String(config.timing[t.key])}
									onChange={(e) =>
										setDrafts((d) => ({ ...d, [t.key]: e.target.value }))
									}
									onBlur={() => commitTiming(t.key)}
									onKeyDown={(e) => {
										if (e.key === "Enter") commitTiming(t.key);
									}}
								/>
							</div>
						))}
					</div>

					<div className="gt-section">
						<div className="gt-legend">Rules</div>
						{TOGGLES.map((t) => (
							<div className="gt-row" key={t.key}>
								<label htmlFor={`gt-${t.key}`}>{t.label}</label>
								<input
									id={`gt-${t.key}`}
									type="checkbox"
									checked={config[t.key]}
									onChange={(e) => apply({ [t.key]: e.target.checked })}
								/>
							</div>
						))}
					</div>

					<div className="gt-section">
						<div className="gt-legend">Recording</div>
						<div className="gt-buttons">
							<button
								type="button"
								className={recording ? "gt-live" : undefined}
								onClick={() => apply({ behaviour: "record" })}
							>
								{recording ? "recording…" : "record"}
							</button>
							<button
								type="button"
								onClick={() => apply({ behaviour: "idle" })}
							>
								stop
							</button>
							<button
								type="button"
								onClick={() => apply({ behaviour: "playback" })}
							>
								play
							</button>
							<button
								type="button"
								onClick={() => void window.__training?.clearRecording()}
							>
								clear
							</button>
						</div>
						<div className="gt-hint">
							{state.status.recordedFrames} frames ·{" "}
							{ms(state.status.recordedMs)}
							{state.status.playing
								? ` · playing @${state.status.playbackIndex}`
								: ""}
						</div>
					</div>

					<div className="gt-section">
						<div className="gt-legend">Positions</div>
						<div className="gt-buttons">
							<button type="button" onClick={() => window.__training?.reset()}>
								reset
							</button>
							<button
								type="button"
								onClick={() =>
									apply({
										spawn: {
											player: { ...config.spawn.dummy },
											dummy: { ...config.spawn.player },
										},
									})
								}
							>
								swap sides
							</button>
						</div>
					</div>

					<div className="gt-section">
						<div className="gt-legend">Live</div>
						<dl className="gt-readout">
							<Fragmented
								label="behaviour"
								value={
									state.status.beatCount > 0
										? `${state.status.behaviour} · beat ${state.status.beatIndex + 1}/${state.status.beatCount}`
										: state.status.behaviour
								}
							/>
							<Fragmented
								label="dummy"
								value={`${state.dummy.meleeAction}/${state.dummy.phase}${
									state.dummy.blocking ? " · blocking" : ""
								}${state.dummy.stunned ? " · stunned" : ""}`}
							/>
							<Fragmented
								label="at"
								value={`${Math.round(state.dummy.x)},${Math.round(state.dummy.y)} facing ${state.dummy.facing > 0 ? "→" : "←"}`}
							/>
							<Fragmented
								label="you"
								value={`${state.local.meleeAction}/${state.local.phase}${
									state.local.massiveReady ? " · MASSIVE READY" : ""
								}`}
							/>
							<Fragmented
								label="damage"
								value={`dealt ${state.stats.player.damageDealt} · taken ${state.stats.player.damageTaken}`}
							/>
						</dl>
					</div>

					<div className="gt-section">
						<div className="gt-legend">Last exchange</div>
						<FrameData state={state} />
					</div>
				</div>
			)}
		</div>
	);
}
