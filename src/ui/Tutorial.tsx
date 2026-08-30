/**
 * The tutorial overlay — the coach.
 *
 * It draws what the director reports and nothing else: this component holds no
 * lesson state, decides no objective, and cannot advance the course on its own.
 * Every button emits a `tutorial-command`, which is the *same* entry point
 * `window.__tutorial` calls — so a probe walking the course and a player
 * clicking through it exercise one path, exactly the bargain the training
 * panel makes with `window.__training`.
 *
 * The keycaps are read from the player's **live bindings**, so a rebound jump
 * re-labels every instruction that names it. A tutorial that told a player to
 * press a key their game does not use would be worse than no tutorial.
 *
 * **DOM, not Pixi.** Flowing paragraphs, scrollable prose, focusable buttons
 * and CSS transitions are the canvas/DOM split's whole reason to exist — see
 * the `pixi-text-and-ui` skill.
 */

import { useEffect, useState } from "react";
import type { TutorialObjectiveView, TutorialState } from "../game/campaign";
import { EventBus } from "../game/EventBus";
import { type Action, bindings, codeLabel } from "../game/input/Bindings";
import { TUTORIAL_CSS } from "./tutorialStyles";

/** Send a command to the director. The overlay never mutates course state. */
function command(
	action: "next" | "skip" | "retry" | "goto",
	lessonIndex?: number,
) {
	EventBus.emit("tutorial-command", {
		action,
		...(lessonIndex === undefined ? {} : { lessonIndex }),
	});
}

/** The live tutorial state, or null before the director has said anything. */
function useTutorialState(): TutorialState | null {
	const [state, setState] = useState<TutorialState | null>(null);
	useEffect(
		() =>
			EventBus.on("tutorial-state", ((next: TutorialState) =>
				setState(next)) as never),
		[],
	);
	return state;
}

/**
 * The keyboard-ish label for an action.
 *
 * A pad binding is skipped when a key exists, for the same reason the move
 * list skips it: the card is read by somebody at a keyboard, and the deck
 * draws its own buttons.
 */
function keycap(action: Action, map: Record<Action, string[]>): string {
	const codes = map[action] ?? [];
	const preferred = codes.find((c) => !c.startsWith("Pad")) ?? codes[0];
	return preferred === undefined ? "—" : codeLabel(preferred);
}

function Keycaps({
	keys,
	map,
}: {
	keys: string[];
	map: Record<Action, string[]>;
}) {
	if (keys.length === 0) return null;
	return (
		<span className="tut-keys">
			{keys.map((k) => (
				<span key={k} className="tut-key">
					{keycap(k as Action, map)}
				</span>
			))}
		</span>
	);
}

function ObjectiveRow({
	objective,
	map,
}: {
	objective: TutorialObjectiveView;
	map: Record<Action, string[]>;
}) {
	const frac =
		objective.target === 0
			? 1
			: Math.min(1, objective.count / objective.target);
	return (
		<div
			className={`tut-obj${objective.done ? " tut-obj-done" : ""}`}
			data-objective={objective.id}
			data-done={objective.done}
		>
			<div className="tut-obj-line">
				<span className="tut-tick">{objective.done ? "✔" : "□"}</span>
				<span className="tut-obj-text">
					{objective.text}
					<Keycaps keys={objective.keys} map={map} />
				</span>
				{objective.target > 1 ? (
					<span className="tut-obj-count">
						{objective.count}/{objective.target}
					</span>
				) : null}
			</div>
			{objective.target > 1 ? (
				<div className="tut-bar">
					<div className="tut-bar-fill" style={{ width: `${frac * 100}%` }} />
				</div>
			) : null}
			{!objective.done && objective.hint ? (
				<div className="tut-hint">{objective.hint}</div>
			) : null}
		</div>
	);
}

export function Tutorial({ onExitToMenu }: { onExitToMenu: () => void }) {
	const state = useTutorialState();
	// Snapshotted, not read live: a compiled component that read the bindings
	// store mid-render would memoise the first answer forever. See AGENTS.md.
	const [map, setMap] = useState(() => bindings.snapshot());
	useEffect(() => bindings.subscribe(() => setMap(bindings.snapshot())), []);

	// Enter is "continue" everywhere it means anything. Deliberately not Space:
	// Space is jump, and a chapter card that ate the jump key would teach the
	// player that jumping does nothing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Enter" && e.code !== "NumpadEnter") return;
			command("next");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (!state) return null;

	if (state.phase === "connecting") {
		return (
			<div className="tut-root">
				<style>{TUTORIAL_CSS}</style>
				<div className="tut-wait">Setting up the lesson…</div>
			</div>
		);
	}

	if (state.phase === "finished") {
		return (
			<div className="tut-root" data-phase="finished">
				<style>{TUTORIAL_CSS}</style>
				<div className="tut-curtain">
					<div className="tut-curtain-eyebrow">Course complete</div>
					<div className="tut-curtain-title">{state.moduleTitle}</div>
					<p className="tut-curtain-sub">
						Every move, every command. The rest of this game is other people —
						the link is the invitation.
					</p>
					<div className="tut-curtain-actions">
						<button
							className="tut-btn tut-btn-primary"
							type="button"
							onClick={onExitToMenu}
						>
							Back to the menu
						</button>
						<button
							className="tut-btn"
							type="button"
							onClick={() => command("goto", 0)}
						>
							Run it again
						</button>
					</div>
				</div>
			</div>
		);
	}

	if (state.phase === "chapter") {
		return (
			<div className="tut-root" data-phase="chapter">
				<style>{TUTORIAL_CSS}</style>
				<div className="tut-curtain">
					<div className="tut-curtain-eyebrow">
						Chapter {state.chapterIndex + 1} of {state.chapterCount}
					</div>
					<div className="tut-curtain-title">{state.chapterTitle}</div>
					<p className="tut-curtain-sub">{state.chapterSubtitle}</p>
					<div className="tut-curtain-actions">
						<button
							className="tut-btn tut-btn-primary"
							type="button"
							onClick={() => command("next")}
						>
							Begin
						</button>
					</div>
				</div>
			</div>
		);
	}

	const cleared = state.phase === "cleared";

	return (
		<div className="tut-root" data-phase={state.phase}>
			<style>{TUTORIAL_CSS}</style>
			<div
				className={`tut-card${cleared ? " tut-cleared" : ""}`}
				data-lesson={state.lessonId}
			>
				<div className="tut-eyebrow">
					<span>{state.chapterTitle}</span>
					<span>
						<b>{state.lessonIndex + 1}</b> / {state.lessonCount}
					</span>
				</div>
				<div className="tut-title">{state.title}</div>
				<p className="tut-brief">{state.brief}</p>
				<div className="tut-objectives">
					{state.objectives.map((objective) => (
						<ObjectiveRow key={objective.id} objective={objective} map={map} />
					))}
				</div>
				<div className="tut-foot">
					<div className="tut-progress">
						<div
							className="tut-progress-fill"
							style={{ width: `${state.moduleProgress * 100}%` }}
						/>
					</div>
					{cleared ? (
						<button
							className="tut-btn tut-btn-primary"
							type="button"
							onClick={() => command("next")}
						>
							Next
						</button>
					) : (
						<>
							<button
								className="tut-btn"
								type="button"
								onClick={() => command("retry")}
							>
								Reset
							</button>
							<button
								className="tut-btn"
								type="button"
								onClick={() => command("skip")}
							>
								Skip
							</button>
						</>
					)}
				</div>
			</div>

			{cleared ? (
				<div className="tut-stamp">
					<div className="tut-stamp-word">CLEARED</div>
					{state.outro ? <p className="tut-stamp-sub">{state.outro}</p> : null}
				</div>
			) : null}
		</div>
	);
}
