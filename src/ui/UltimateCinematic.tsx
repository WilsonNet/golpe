/**
 * The ultimate's cutscene: who cast it, and what.
 *
 * A dialog with a portrait in it, so it lives in the DOM overlay rather than
 * the canvas — see the `pixi-text-and-ui` skill on the split. Text, a clipped
 * frame, a nameplate and a timer are all things CSS does better than a
 * `Graphics` call, and none of them need to be inside the camera.
 *
 * **It does not decide anything.** The freeze is the server's, announced in the
 * snapshot and obeyed by `Match`; this component is told a cast happened and
 * puts a picture up for as long as the server said. If it never mounted, the
 * game would still freeze and unfreeze identically — which is the property that
 * keeps a cosmetic overlay from ever being able to desync a match.
 *
 * **It is deliberately not gated on `input-suspended`.** That event exists for
 * DOM that takes the keyboard away from the canvas, and this takes nothing: it
 * is `pointer-events: none` throughout, and the fighter is already frozen by
 * the simulation rather than by an absence of input. Suspending input here
 * would release every held key mid-fight and hand the player back a dead
 * controller when the freeze lifted.
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { ULTIMATE_CSS } from "./ultimateStyles";

interface CastEvent {
	casterId: string;
	casterName: string;
	/** The caster's hero — the portrait card draws their own sheet. */
	hero: "lia" | "anands";
	/** True when this client is the one casting, for the "YOU" marker. */
	mine: boolean;
	/** The freeze length the server declared. Drives the timer bar. */
	durationMs: number;
}

/**
 * A stable hue per fighter, so two casters in one match are not the same
 * portrait.
 *
 * Every fighter uses the same sprite sheet — there is one character — so
 * without this the cutscene would be identical whoever cast it, and the one
 * question it exists to answer ("who") would be left entirely to the nameplate.
 * Hashed from the server id rather than the name, because the id is what is
 * stable: a name can be deduplicated into `Wilson (2)` after the fact.
 */
function hueFor(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	return h % 360;
}

/** Accent colour to match the portrait's hue, so the frame and the name agree. */
function accentFor(hue: number): string {
	// The base accent is a violet at ~268deg; rotating the portrait by `hue`
	// rotates this with it, which keeps the whole card one colour scheme.
	return `hsl(${(268 + hue) % 360} 100% 74%)`;
}

export function UltimateCinematic() {
	const [cast, setCast] = useState<CastEvent | null>(null);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => {
		const clear = () => {
			window.clearTimeout(timer.current);
			timer.current = undefined;
			setCast(null);
		};

		const offCast = EventBus.on("ultimate-cast", ((e: CastEvent) => {
			window.clearTimeout(timer.current);
			setCast(e);
			// Taken down on a local timer rather than by watching `frozen` go false.
			//
			// Not laziness: the overlay is presentation and must never depend on a
			// datagram arriving. If the snapshot that clears the cinematic is lost,
			// the game unfreezes on the next one 50ms later — but a portrait that
			// waited for a message it never got would sit over a live fight forever.
			// A timer that is a little wrong is strictly better than one that hangs.
			timer.current = window.setTimeout(
				clear,
				Math.max(200, e.durationMs) + 120,
			);
		}) as never);

		// A match reset takes it down immediately, whatever the timer says.
		const offClear = EventBus.on("ultimate-clear", clear as never);

		return () => {
			offCast();
			offClear();
			window.clearTimeout(timer.current);
		};
	}, []);

	if (!cast) return null;

	const hue = hueFor(cast.casterId);
	const style = {
		"--vu-ms": `${Math.max(200, cast.durationMs)}ms`,
		"--vu-hue": `${hue}deg`,
		"--vu-accent": accentFor(hue),
	} as React.CSSProperties;

	return (
		<div className="vu-root" style={style} aria-live="polite">
			<style>{ULTIMATE_CSS}</style>
			<div className="vu-void" />
			<div className="vu-bar top" />
			<div className="vu-bar bottom" />

			{/* The collapsing star, behind the card: three counter-rotating rings
			    closing on a dark core. Same idea as the in-world accretion disk,
			    restated at UI scale, so what is about to arrive is legible before
			    it does. */}
			<div className="vu-star">
				<div className="vu-ring a" />
				<div className="vu-ring b" />
				<div className="vu-ring c" />
				<div className="vu-core" />
			</div>

			<div className="vu-card">
				<div className="vu-frame">
					<div className="vu-well">
						<div className="vu-sweep" />
						{/* The caster's own character sheet, face-on frame, six times up
						    with nearest-neighbour. Real art beats drawn art here because
						    it can never disagree with the fighter standing on the field. */}
						<div
							className={`vu-sprite vu-sprite-${cast.hero}`}
							role="img"
							aria-label={cast.casterName}
						/>
					</div>
				</div>

				<div className="vu-plate">
					<div className="vu-name">{cast.casterName}</div>
					{cast.mine && <span className="vu-you">Your ultimate</span>}
				</div>

				<div className="vu-ability">
					<div className="vu-ability-name">
						{cast.hero === "anands" ? "Dragon Thrust" : "Black Hole"}
					</div>
					<div className="vu-ability-sub">
						{cast.hero === "anands"
							? "Nothing stops a line"
							: "Gravity has a winner"}
					</div>
				</div>

				{/* Empties over exactly the freeze the server declared. The only thing
				    on screen that says how long the player is not in control. */}
				<div className="vu-timer">
					<i />
				</div>
			</div>
		</div>
	);
}
