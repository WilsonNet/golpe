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
import type { HeroId } from "../game/simulation/Heroes";
import { MOTIF_CHILDREN, ULTIMATE_CARDS } from "./ultimateCards";
import { ULTIMATE_CSS } from "./ultimateStyles";

interface CastEvent {
	casterId: string;
	casterName: string;
	/** The caster's hero — the portrait card draws their own sheet. */
	hero: HeroId;
	/** True when this client is the one casting, for the "YOU" marker. */
	mine: boolean;
	/** The freeze length the server declared. Drives the timer bar. */
	durationMs: number;
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
			//
			// The dragon clears at the freeze itself: its ride is a 1500px/s
			// streak that can be over in a blink, and a card that lingered a
			// hundred milliseconds past the freeze would cover the whole payoff.
			// The black hole keeps a beat of margin — its lob is slow enough to
			// watch. The storm keeps a margin too: its 2s channel is worth
			// seeing land.
			timer.current = window.setTimeout(
				clear,
				Math.max(200, e.durationMs) + (e.hero === "anands" ? 0 : 120),
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

	const card = ULTIMATE_CARDS[cast.hero];
	const style = {
		"--vu-ms": `${Math.max(200, cast.durationMs)}ms`,
	} as React.CSSProperties;

	return (
		<div
			className="vu-root"
			data-hero={cast.hero}
			style={style}
			aria-live="polite"
		>
			<style>{ULTIMATE_CSS}</style>
			<div className="vu-void" />

			{/* The hero's own backdrop, drawn in CSS: a collapsing star, a dash
			    line, a six-petal blast or a bleeding wound. It sits before the
			    letterbox bars on purpose — Ibiriki's drips read as leaking out
			    from under the top bar rather than painted on top of it. */}
			<div
				className={`vu-motif vu-motif-${card.motif}`}
				aria-hidden="true"
			>
				<div className="vu-motif-inner">
					{Array.from({ length: MOTIF_CHILDREN[card.motif] }, (_, i) => (
						<i key={i} />
					))}
				</div>
			</div>

			<div className="vu-bar top" />
			<div className="vu-bar bottom" />

			<div className="vu-card">
				<div className="vu-frame">
					<div className="vu-well">
						<div className="vu-sweep" />
						{/* The caster's own character sheet, face-on frame, four times up
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
					<div className="vu-role">{card.role}</div>
					<div className="vu-flavor">{card.flavor}</div>
					<div className="vu-ability-name">{card.shout}</div>
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
