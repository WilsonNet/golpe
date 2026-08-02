/**
 * The Esc menu.
 *
 * **It does not pause anything.** The server is authoritative and fifteen other
 * fighters are still swinging; a client that stopped simulating would be a client
 * that rubber-bands back into a fight it stopped watching. What it does is take
 * the *keyboard* away from the game — `input-suspended` on the EventBus — so
 * choosing a key for block does not walk the fighter into a wall while the player
 * is choosing it.
 *
 * The controls dialog behind it lives in `ControlsDialog`, shared with the main
 * menu so a player can rebind before their first match rather than during it.
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { ControlsDialog } from "./ControlsDialog";
import { HUD_CSS } from "./hudStyles";

type View = "menu" | "controls";

export function PauseMenu({
	onExitToMenu,
}: {
	/** Leave the match and return to the root menu. */
	onExitToMenu: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>("menu");
	const [confirmExit, setConfirmExit] = useState(false);
	// The name prompt is a modal of its own. Opening this one over it would put
	// two dialogs on screen and take the keyboard away from the field the player
	// is typing into.
	const naming = useRef(false);
	const openRef = useRef(false);
	openRef.current = open;

	useEffect(() => {
		const offNeed = EventBus.on("need-player-name", (() => {
			naming.current = true;
		}) as never);
		const offName = EventBus.on("player-name", (() => {
			naming.current = false;
		}) as never);
		return () => {
			offNeed();
			offName();
		};
	}, []);

	// Escape toggles the menu — except while the controls dialog is capturing a
	// button, where its own capture-phase listener takes the event first.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Escape") return;
			if (naming.current) return;
			e.preventDefault();
			setOpen(!openRef.current);
		};
		window.addEventListener("keydown", onKey);
		// A phone has no Escape key. The on-screen gamepad's menu button fires this
		// instead of synthesising a keystroke, because a synthetic keydown would
		// also have to be kept out of the rebind capture and out of the canvas.
		const offToggle = EventBus.on("menu-toggle", (() => {
			if (naming.current) return;
			setOpen(!openRef.current);
		}) as never);
		return () => {
			window.removeEventListener("keydown", onKey);
			offToggle();
		};
	}, []);

	// The game learns about the menu here and only here.
	useEffect(() => {
		EventBus.emit("input-suspended", open);
		if (!open) {
			setView("menu");
			setConfirmExit(false);
		}
	}, [open]);

	// Release the keyboard if this component ever goes away with the menu up.
	useEffect(() => () => EventBus.emit("input-suspended", false), []);

	if (!open) return null;

	return (
		<div className="vd-veil vd-menu-veil">
			<style>{HUD_CSS}</style>
			<div className="vd-card vd-menu-card">
				{view === "menu" ? (
					<>
						<h2 className="vd-title">Menu</h2>
						<p className="vd-sub">
							The match keeps running — the server is the judge, and stepping
							away from the keyboard does not stop the fight.
						</p>
						<div className="vd-menu-list">
							<button
								className="vd-btn"
								type="button"
								onClick={() => setOpen(false)}
							>
								Resume
							</button>
							<button
								className="vd-btn"
								type="button"
								onClick={() => setView("controls")}
							>
								Controls
							</button>
							{confirmExit ? (
								<>
									<p className="vd-sub vd-exit-note">
										Your fighter leaves the room — the match keeps running for
										everyone else.
									</p>
									<button
										className="vd-btn vd-exit-yes"
										type="button"
										onClick={onExitToMenu}
									>
										Exit to menu
									</button>
									<button
										className="vd-btn"
										type="button"
										onClick={() => setConfirmExit(false)}
									>
										Stay
									</button>
								</>
							) : (
								<button
									className="vd-btn"
									type="button"
									onClick={() => setConfirmExit(true)}
								>
									Exit to menu
								</button>
							)}
						</div>
					</>
				) : (
					<>
						<h2 className="vd-title">Controls</h2>
						<ControlsDialog onClose={() => setView("menu")} />
					</>
				)}
			</div>
		</div>
	);
}
