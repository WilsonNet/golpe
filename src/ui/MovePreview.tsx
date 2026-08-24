/**
 * The move list's preview — a live `FighterStage` plus the frame-data timeline.
 *
 * The fighter on the stage is the real one: a scripted story (`stories.ts`)
 * played through the real simulation and animation systems on the hero's own
 * sheet. This component is only the shell around it — the stage host, the
 * startup/active/recovery timeline whose cursor tracks the story's real
 * attack window, and the phase chip.
 *
 * The cursor is written **directly to the DOM from the stage's frame
 * callback**, never through state: a 60Hz `setState` would re-render the
 * whole panel sixty times a second to move one 3px div.
 */

import { useEffect, useRef } from "react";
import { FighterStage } from "../game/preview/FighterStage";
import { EMPTY_STORY, type Story, storyFor } from "../game/preview/stories";
import type { HeroId } from "../game/simulation/Heroes";
import { MOVES } from "../game/simulation/Melee";
import type { MoveEntry } from "./moveData";

/** The first step that presses an attack-shaped button, for the timeline. */
function attackAtOf(story: Story | undefined): number | null {
	for (const step of story?.steps ?? []) {
		const i = step.input;
		if (i && (i.attack || i.uppercut || i.block)) return step.at;
	}
	return null;
}

export function MovePreview({
	entry,
	hero,
}: {
	entry: MoveEntry;
	hero: HeroId;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<FighterStage | null>(null);
	const cursorRef = useRef<HTMLDivElement>(null);
	const phaseRef = useRef<HTMLSpanElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);

	// The entry id *is* the story id; `preview` is an override for the melee
	// entries, which project the shared MOVES id instead of `melee-<move>`.
	const story = storyFor(entry.preview ?? entry.id);
	const frame = entry.move ? MOVES[entry.move] : null;
	const attackAt = attackAtOf(story);
	const totalMs = frame
		? frame.startupMs + frame.activeMs + frame.recoveryMs
		: 0;

	// The frame callback reads the *current* timeline through a ref, because
	// it is bound once at mount while the entry walks the list.
	const timelineRef = useRef({
		frame,
		attackAt,
		totalMs,
		loopMs: story?.loopMs ?? 0,
	});
	timelineRef.current = {
		frame,
		attackAt,
		totalMs,
		loopMs: story?.loopMs ?? 0,
	};
	const propsRef = useRef({ hero, story });
	propsRef.current = { hero, story };

	// One stage for the panel's lifetime; walking the list swaps the story on
	// it (`setStory`) instead of tearing the renderer down per move.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		let stage: FighterStage | null = null;
		let cancelled = false;
		FighterStage.create(host, {
			hero: propsRef.current.hero,
			story: propsRef.current.story ?? EMPTY_STORY,
			onFrame: ({ t }) => {
				const { frame, attackAt, totalMs, loopMs } = timelineRef.current;
				if (frame && attackAt !== null && totalMs > 0) {
					const p = Math.min(1, Math.max(0, (t - attackAt) / totalMs));
					const cursor = cursorRef.current;
					if (cursor) cursor.style.left = `${p * 100}%`;
					const chip = phaseRef.current;
					if (chip) {
						const s = frame.startupMs / totalMs;
						const a = (frame.startupMs + frame.activeMs) / totalMs;
						const next =
							t < attackAt
								? "READY"
								: p < s
									? "STARTUP"
									: p < a
										? "ACTIVE"
										: "RECOVERY";
						if (chip.textContent !== next) chip.textContent = next;
					}
				} else {
					const bar = progressRef.current;
					if (bar && loopMs > 0)
						bar.style.width = `${Math.min(100, (t / loopMs) * 100)}%`;
				}
			},
		}).then((s) => {
			if (cancelled) {
				s.destroy();
				return;
			}
			stage = s;
			stageRef.current = s;
			// Props may have changed while the renderer was booting.
			s.setStory({
				hero: propsRef.current.hero,
				story: propsRef.current.story ?? EMPTY_STORY,
			});
		});
		return () => {
			cancelled = true;
			stage?.destroy();
			stageRef.current = null;
		};
	}, []);

	useEffect(() => {
		stageRef.current?.setStory({ hero, story: story ?? EMPTY_STORY });
	}, [hero, story]);

	return (
		<div className="mp-root">
			<style>{MP_CSS}</style>
			<div className="mp-stage">
				<div ref={hostRef} className="mp-host" />
			</div>
			{frame && attackAt !== null ? (
				<div className="mp-tl-wrap">
					<div className="mp-tl-head">
						<span ref={phaseRef} className="mp-phase">
							READY
						</span>
						<span className="mp-tl-total">TOTAL {totalMs}ms</span>
					</div>
					<div className="mp-tl">
						<div
							className="mp-tl-seg mp-tl-startup"
							style={{ flexGrow: frame.startupMs }}
						/>
						<div
							className="mp-tl-seg mp-tl-active"
							style={{ flexGrow: frame.activeMs }}
						/>
						<div
							className="mp-tl-seg mp-tl-recovery"
							style={{ flexGrow: frame.recoveryMs }}
						/>
						<div ref={cursorRef} className="mp-tl-cursor" />
					</div>
					<div className="mp-tl-labels">
						<span>STARTUP {frame.startupMs}</span>
						<span>ACTIVE {frame.activeMs}</span>
						<span>RECOVERY {frame.recoveryMs}</span>
					</div>
				</div>
			) : (
				<div className="mp-progress">
					<div ref={progressRef} className="mp-progress-fill" />
				</div>
			)}
		</div>
	);
}

const MP_CSS = `
.mp-root {
	display: flex;
	flex-direction: column;
	gap: 8px;
	flex: 1;
	min-height: 0;
}
.mp-stage {
	position: relative;
	flex: 1;
	min-height: 170px;
	overflow: hidden;
	border-radius: 10px;
	border: 1px solid rgba(255, 255, 255, 0.12);
	background: #06070c;
}
.mp-host {
	position: absolute;
	inset: 0;
}
.mp-host canvas { display: block; }

/* ---- frame-data timeline (melee) ---- */
.mp-tl-wrap {
	display: flex;
	flex-direction: column;
	gap: 5px;
}
.mp-tl-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
}
.mp-phase {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.14em;
	color: #0ec3c9;
	background: rgba(14, 195, 201, 0.1);
	border: 1px solid rgba(14, 195, 201, 0.35);
	border-radius: 5px;
	padding: 2px 8px;
	min-width: 74px;
	text-align: center;
}
.mp-tl-total {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.12em;
	color: rgba(255, 255, 255, 0.45);
}
.mp-tl-labels {
	display: flex;
	justify-content: space-between;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	color: rgba(255, 255, 255, 0.6);
}
.mp-tl-labels span { white-space: nowrap; }
.mp-tl {
	position: relative;
	height: 10px;
	display: flex;
	background: rgba(255, 255, 255, 0.08);
	border-radius: 5px;
	overflow: visible;
	box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
}
.mp-tl-seg { height: 100%; }
.mp-tl-startup { background: #3d6b8f; border-radius: 5px 0 0 5px; }
.mp-tl-active { background: #ffd166; }
.mp-tl-recovery { background: #6a4a92; border-radius: 0 5px 5px 0; }
.mp-tl-cursor {
	position: absolute;
	top: -5px;
	left: 0;
	width: 3px;
	height: 20px;
	background: #fff;
	border-radius: 2px;
	box-shadow: 0 0 8px #fff;
	pointer-events: none;
}

/* ---- loop progress (everything else) ---- */
.mp-progress {
	height: 6px;
	background: rgba(255, 255, 255, 0.08);
	border-radius: 3px;
	overflow: hidden;
}
.mp-progress-fill {
	height: 100%;
	width: 0%;
	background: linear-gradient(90deg, #0ec3c9, #ffd166);
}
`;
