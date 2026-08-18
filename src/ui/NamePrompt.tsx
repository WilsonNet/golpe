/**
 * The name prompt.
 *
 * Shown when the game says it needs a name, dismissed by answering. The gate
 * lives in `Match` rather than here — the *connection* is what needs a name, so
 * the connection is what waits for one, and a client running as AI (`?ai=true`,
 * which is how every probe runs) never asks and never blocks.
 *
 * Answering emits `player-name`, which is the same event `window.__setPlayerName`
 * fires. One path in, so an automated run exercises what a human does rather
 * than a bypass nobody plays.
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { roomLink } from "../game/online/room";
import { HUD_CSS } from "./hudStyles";
import { copyText, useRoomId } from "./useMatch";

/** Matches the server's cap, so nothing a player types is silently truncated. */
const MAX_NAME = 16;

export function NamePrompt() {
	const [asking, setAsking] = useState(false);
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	const [copied, setCopied] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const linkRef = useRef<HTMLInputElement>(null);
	const roomId = useRoomId();

	useEffect(() => {
		const off = EventBus.on("need-player-name", (() =>
			setAsking(true)) as never);
		// Close on the *event*, not only on this form's submit.
		//
		// `window.__setPlayerName` fires the same event, and is documented as taking
		// the path a player takes — which was not true while the modal only listened
		// to its own button. It stayed mounted over the game with its share-link field
		// still focused, and because `Input` ignores keystrokes aimed at an editable
		// element, every key a probe pressed afterwards was silently swallowed.
		const offAnswer = EventBus.on("player-name", (() =>
			setAsking(false)) as never);
		return () => {
			off();
			offAnswer();
		};
	}, []);

	// Hand the keyboard back to the canvas. A field left focused behind a dismissed
	// modal eats WASD, which reads as a dead game rather than a focus problem.
	useEffect(() => {
		if (!asking) (document.activeElement as HTMLElement | null)?.blur();
	}, [asking]);

	// Focus once the field exists. A modal a player has to click into before
	// typing is a modal they will type past.
	useEffect(() => {
		if (asking) inputRef.current?.focus();
	}, [asking]);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const name = value.trim().slice(0, MAX_NAME);
		if (name.length === 0) {
			setError("Pick something. Anything.");
			return;
		}
		EventBus.emit("player-name", name);
	};

	const share = async () => {
		const ok = await copyText(roomLink(roomId), linkRef.current);
		setCopied(ok ? "Link copied." : "Select it and press Ctrl+C.");
	};

	if (!asking) return null;

	return (
		<div className="gd-veil">
			<style>{HUD_CSS}</style>
			<form className="gd-card" onSubmit={submit}>
				<h2 className="gd-title">Golpe</h2>
				<p className="gd-sub">
					Deathmatch — first to 21 frags, or the best score in five minutes.
					<br />
					Hold <strong>Tab</strong> for the scoreboard.
				</p>
				<input
					ref={inputRef}
					className="gd-input"
					value={value}
					maxLength={MAX_NAME}
					placeholder="your name"
					autoComplete="off"
					spellCheck={false}
					onChange={(e) => {
						setValue(e.target.value);
						setError("");
					}}
				/>
				<div className="gd-row-actions">
					<button
						className="gd-btn"
						type="submit"
						disabled={value.trim() === ""}
					>
						Enter the arena
					</button>
				</div>
				<div className="gd-error">{error}</div>

				{/* Rooms are addressed, not matchmade, so this link *is* the invitation.
				    Shown before anything has connected, because a host wants to send it
				    while they are still typing their own name. */}
				{roomId ? (
					<div className="gd-share">
						<div className="gd-share-label">
							Send this link to play together
						</div>
						<div className="gd-share-row">
							<input
								ref={linkRef}
								className="gd-input gd-share-link"
								value={roomLink(roomId)}
								readOnly
								onFocus={(e) => e.target.select()}
							/>
							<button className="gd-btn gd-copy" type="button" onClick={share}>
								Copy
							</button>
						</div>
						<div className="gd-share-note">{copied}</div>
					</div>
				) : null}
			</form>
		</div>
	);
}
