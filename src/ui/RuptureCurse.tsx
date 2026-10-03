/**
 * Ibiriki's Rupture, as the cursed player sees it: a red vignette closing in
 * from the screen's edges, a heartbeat pulse, and DON'T MOVE. See
 * specs/ibiriki.md.
 *
 * Fed by the scene's `rupture-state` event every frame while it matters; it
 * says only whether *this* client's fighter is a victim and how long is left.
 * The bleed itself is the server's — this is the tension, not the damage.
 */

import { useEffect, useState } from "react";
import { EventBus } from "../game/EventBus";

interface RuptureState {
	active: boolean;
	msLeft: number;
	totalMs: number;
}

const CSS = `
.vr-curse {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 6;
	background: radial-gradient(ellipse at center,
		rgba(0, 0, 0, 0) 45%,
		rgba(120, 0, 12, 0.35) 72%,
		rgba(170, 0, 16, 0.72) 100%);
	animation: vr-beat 0.86s ease-in-out infinite;
}
@keyframes vr-beat {
	0%, 100% { opacity: 0.78; }
	12% { opacity: 1; }
	24% { opacity: 0.84; }
	36% { opacity: 0.98; }
}
.vr-warning {
	position: absolute;
	left: 50%;
	top: 22%;
	transform: translateX(-50%);
	font: 900 clamp(18px, 5.2cqw, 42px) / 1 "Impact", "Arial Black", sans-serif;
	letter-spacing: 0.08em;
	color: #ffe9e9;
	text-shadow: 0 0 10px #ff1a2e, 0 0 2px #000, 0 3px 0 #5a0008;
	animation: vr-shiver 0.12s steps(2) infinite;
}
.vr-timer {
	position: absolute;
	left: 50%;
	top: calc(22% + clamp(24px, 6cqw, 50px));
	transform: translateX(-50%);
	width: clamp(80px, 22cqw, 180px);
	height: 4px;
	background: rgba(40, 0, 6, 0.7);
	border: 1px solid rgba(255, 120, 120, 0.6);
}
.vr-timer > i {
	display: block;
	height: 100%;
	background: #ff2a3a;
	box-shadow: 0 0 8px #ff2a3a;
}
@keyframes vr-shiver {
	0% { margin-left: -1px; }
	100% { margin-left: 1px; }
}
`;

export function RuptureCurse() {
	const [state, setState] = useState<RuptureState>({
		active: false,
		msLeft: 0,
		totalMs: 0,
	});
	useEffect(
		() =>
			EventBus.on("rupture-state", ((s: RuptureState) => {
				// Only re-render on what the overlay draws: the on/off edge and the
				// timer's tenth-of-a-second steps.
				setState((prev) =>
					prev.active === s.active &&
					Math.round(prev.msLeft / 100) === Math.round(s.msLeft / 100)
						? prev
						: s,
				);
			}) as never),
		[],
	);
	if (!state.active) return null;
	const frac = state.totalMs > 0 ? state.msLeft / state.totalMs : 0;
	return (
		<>
			<style>{CSS}</style>
			<div className="vr-curse" />
			<div className="vr-warning">DON'T MOVE</div>
			<div className="vr-timer">
				<i style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} />
			</div>
		</>
	);
}
