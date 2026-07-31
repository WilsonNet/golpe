/**
 * The Esc menu, and the controls dialog behind it.
 *
 * **It does not pause anything.** The server is authoritative and fifteen other
 * fighters are still swinging; a client that stopped simulating would be a client
 * that rubber-bands back into a fight it stopped watching. What it does is take
 * the *keyboard* away from the game — `input-suspended` on the EventBus — so
 * choosing a key for block does not walk the fighter into a wall while the player
 * is choosing it.
 *
 * The rebind captures the key that is pressed rather than asking anyone to type
 * `ShiftLeft`. That is the whole point of a remapper: a player knows where their
 * finger goes, not what the DOM calls the key underneath it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import {
	ACTION_LABELS,
	ACTIONS,
	type Action,
	bindings,
	codeLabel,
	mouseCode,
	RESERVED_CODES,
	SLOT_NAMES,
} from "../game/input/Bindings";
import { HUD_CSS } from "./hudStyles";

type View = "menu" | "controls";

/** Which slot of which action is waiting for a button. */
interface Capture {
	action: Action;
	slot: number;
}

export function PauseMenu() {
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>("menu");
	const [capture, setCapture] = useState<Capture | null>(null);
	const [note, setNote] = useState("");
	// Re-render on every change to the store. The store is deliberately not React
	// state — `Input` reads it every frame from outside React entirely — so the
	// dialog subscribes to it the same way anything else would.
	const [, bump] = useState(0);
	// The name prompt is a modal of its own. Opening this one over it would put
	// two dialogs on screen and take the keyboard away from the field the player
	// is typing into.
	const naming = useRef(false);
	const captureRef = useRef<Capture | null>(null);
	captureRef.current = capture;
	const openRef = useRef(false);
	openRef.current = open;

	useEffect(() => bindings.subscribe(() => bump((n) => n + 1)), []);

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

	// Escape toggles the menu — except while a rebind is listening, where it is
	// the cancel key for the rebind and nothing else.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Escape") return;
			if (naming.current) return;
			if (captureRef.current) return;
			e.preventDefault();
			setOpen(!openRef.current);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// The game learns about the menu here and only here.
	useEffect(() => {
		EventBus.emit("input-suspended", open);
		if (!open) {
			setView("menu");
			setCapture(null);
			setNote("");
		}
	}, [open]);

	// Release the keyboard if this component ever goes away with the menu up.
	useEffect(() => () => EventBus.emit("input-suspended", false), []);

	const assign = useCallback((action: Action, slot: number, code: string) => {
		if (RESERVED_CODES.has(code)) {
			setNote(`${codeLabel(code)} is reserved by the menu.`);
			setCapture(null);
			return;
		}
		const displaced = bindings.bind(action, slot, code);
		setNote(
			displaced
				? `${codeLabel(code)} taken from ${ACTION_LABELS[displaced]}.`
				: "",
		);
		setCapture(null);
	}, []);

	// Listening for the next button. Both listeners are in the capture phase and
	// swallow the event, so the press that rebinds a key never also performs the
	// action it is being bound to.
	useEffect(() => {
		if (!capture) return;
		const { action, slot } = capture;

		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.repeat) return;
			if (e.code === "Escape") {
				setCapture(null);
				return;
			}
			assign(action, slot, e.code);
		};
		const onPointer = (e: PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			assign(action, slot, mouseCode(e.button));
		};
		// Right-click is a legitimate binding, so the browser menu cannot have it.
		const onContext = (e: Event) => e.preventDefault();

		window.addEventListener("keydown", onKey, true);
		window.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("contextmenu", onContext, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("contextmenu", onContext, true);
		};
	}, [capture, assign]);

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
						</div>
					</>
				) : (
					<>
						<h2 className="vd-title">Controls</h2>
						<p className="vd-sub">
							Click a slot, then press the key or mouse button you want.
							<strong> Esc</strong> cancels. Double-tapping{" "}
							<strong>{firstLabel("left")}</strong> or{" "}
							<strong>{firstLabel("right")}</strong> dashes, so the dash follows
							whatever those two are bound to.
						</p>
						<table className="vd-bind-table">
							<tbody>
								{ACTIONS.map((action) => (
									<tr key={action}>
										<th>{ACTION_LABELS[action]}</th>
										{SLOT_NAMES.map((name, slot) => {
											const code = bindings.codesFor(action)[slot];
											const listening =
												capture?.action === action && capture.slot === slot;
											return (
												<td key={name}>
													<button
														type="button"
														className={`vd-slot${listening ? " vd-slot-live" : ""}${code ? "" : " vd-slot-empty"}`}
														onClick={() => {
															setNote("");
															setCapture({ action, slot });
														}}
														onContextMenu={(e) => {
															// Right-click clears, which is the only way to
															// leave an action deliberately unbound.
															e.preventDefault();
															if (code) bindings.clear(action, slot);
														}}
													>
														{listening
															? "press a button…"
															: code
																? codeLabel(code)
																: "—"}
													</button>
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
						<div className="vd-note">
							{note || "Right-click a slot to clear it."}
						</div>
						<div className="vd-row-actions">
							<button
								className="vd-btn"
								type="button"
								disabled={bindings.isDefault}
								onClick={() => {
									bindings.reset();
									setNote("Defaults restored.");
								}}
							>
								Reset to defaults
							</button>
							<button
								className="vd-btn"
								type="button"
								onClick={() => setView("menu")}
							>
								Back
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

/** How a hint should name an action: its primary binding, or that it has none. */
function firstLabel(action: Action): string {
	const code = bindings.codesFor(action)[0];
	return code ? codeLabel(code) : "nothing";
}
