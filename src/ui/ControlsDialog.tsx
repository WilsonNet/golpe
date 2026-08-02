/**
 * The controls dialog: aiming scheme, on-screen gamepad, and the binding table.
 *
 * Shared by the Esc menu and the main menu. The game's input layer reads the
 * binding and scheme stores every frame, so this dialog is not stateful about
 * them — it subscribes, like anything else. The one piece of state it owns is
 * the capture: "which slot is waiting for a button", because that is purely a
 * UI concern and only one dialog is open at a time.
 *
 * The rebind captures the key that is pressed rather than asking anyone to type
 * `ShiftLeft`. That is the whole point of a remapper: a player knows where their
 * finger goes, not what the DOM calls the key underneath it.
 */

import { useCallback, useEffect, useState } from "react";
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
import { readPads } from "../game/input/Gamepad";
import {
	type AimScheme,
	type DeckSetting,
	inputSettings,
} from "../game/input/Scheme";

/** The aiming schemes, as a player chooses between them. */
const SCHEMES: { value: AimScheme; label: string; hint: string }[] = [
	{
		value: "mouse",
		label: "Mouse",
		hint: "You face the cursor. Point at a place and the shot goes there.",
	},
	{
		value: "controller",
		label: "Controller",
		hint: "Eight directions from the d-pad, full 360° from the right stick — or from sliding the mouse, for a trackpad.",
	},
];

/** When the on-screen gamepad is drawn. */
const DECKS: { value: DeckSetting; label: string }[] = [
	{ value: "auto", label: "Auto" },
	{ value: "on", label: "On" },
	{ value: "off", label: "Off" },
];

/** Which slot of which action is waiting for a button. */
interface Capture {
	action: Action;
	slot: number;
}

export function ControlsDialog({ onClose }: { onClose: () => void }) {
	const [capture, setCapture] = useState<Capture | null>(null);
	const [note, setNote] = useState("");
	// Re-render on every change to the stores. They are deliberately not React
	// state — `Input` reads them every frame from outside React entirely — so
	// the dialog subscribes to them the same way anything else would.
	const [, bump] = useState(0);

	useEffect(() => bindings.subscribe(() => bump((n) => n + 1)), []);
	// The scheme store is not React state either — `Input` reads it every frame
	// from outside React entirely — so it is subscribed to the same way.
	useEffect(() => inputSettings.subscribe(() => bump((n) => n + 1)), []);

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

		// A gamepad has no button events, so the one device that cannot announce
		// itself is polled for as long as the dialog is listening. Without this the
		// third slot would be labelled "gamepad" and be the only one a gamepad
		// could not be bound to.
		//
		// Seeded from the *current* state rather than from nothing, so a trigger
		// still held from opening the dialog does not immediately bind itself.
		let held = new Set(readPadCodes());
		const poll = window.setInterval(() => {
			const now = new Set(readPadCodes());
			for (const code of now) {
				if (held.has(code)) continue;
				assign(action, slot, code);
				return;
			}
			held = now;
		}, 50);

		window.addEventListener("keydown", onKey, true);
		window.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("contextmenu", onContext, true);
		return () => {
			window.clearInterval(poll);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("contextmenu", onContext, true);
		};
	}, [capture, assign]);

	return (
		<>
			<div className="vd-setting">
				<div className="vd-setting-head">
					<span>Aiming</span>
					<div className="vd-choice">
						{SCHEMES.map((s) => (
							<button
								key={s.value}
								type="button"
								className={`vd-chip${inputSettings.scheme === s.value ? " vd-chip-on" : ""}`}
								onClick={() => inputSettings.setScheme(s.value)}
							>
								{s.label}
							</button>
						))}
					</div>
				</div>
				<p className="vd-setting-hint">
					{SCHEMES.find((s) => s.value === inputSettings.scheme)?.hint}{" "}
					Switching is safe mid-match — the simulation is handed an angle and
					never learns which device made it.
				</p>
			</div>

			<div className="vd-setting">
				<div className="vd-setting-head">
					<span>On-screen gamepad</span>
					<div className="vd-choice">
						{DECKS.map((d) => (
							<button
								key={d.value}
								type="button"
								className={`vd-chip${inputSettings.deck === d.value ? " vd-chip-on" : ""}`}
								onClick={() => inputSettings.setDeck(d.value)}
							>
								{d.label}
							</button>
						))}
					</div>
				</div>
				<p className="vd-setting-hint">
					<strong>Auto</strong> draws it when a finger is the pointer and aiming
					is set to Controller. Pair a keyboard to a phone and turn it{" "}
					<strong>Off</strong>.
				</p>
			</div>

			<p className="vd-sub">
				Click a slot, then press the key, mouse button or gamepad button you
				want. <strong>Esc</strong> cancels. Double-tapping{" "}
				<strong>{firstLabel("left")}</strong> or{" "}
				<strong>{firstLabel("right")}</strong> dashes, so the dash follows
				whatever those two are bound to. <strong>Aim up</strong> and{" "}
				<strong>aim down</strong> do nothing in Mouse aiming — the cursor
				answers both axes there.
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
			<div className="vd-note">{note || "Right-click a slot to clear it."}</div>
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
				<button className="vd-btn" type="button" onClick={onClose}>
					Back
				</button>
			</div>
		</>
	);
}

/** Every gamepad code held right now, in the shared binding namespace. */
function readPadCodes(): string[] {
	if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
	return [...readPads(navigator.getGamepads()).down];
}

/** How a hint should name an action: its primary binding, or that it has none. */
function firstLabel(action: Action): string {
	const code = bindings.codesFor(action)[0];
	return code ? codeLabel(code) : "nothing";
}
