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

import { useCallback, useEffect, useRef, useState } from "react";
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

	useEffect(
		() => EventBus.on("need-player-name", (() => setAsking(true)) as never),
		[],
	);

	// Focus once the field exists. A modal a player has to click into before
	// typing is a modal they will type past.
	useEffect(() => {
		if (asking) inputRef.current?.focus();
	}, [asking]);

	const submit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			const name = value.trim().slice(0, MAX_NAME);
			if (name.length === 0) {
				setError("Pick something. Anything.");
				return;
			}
			setAsking(false);
			EventBus.emit("player-name", name);
		},
		[value],
	);

	const share = useCallback(async () => {
		const ok = await copyText(roomLink(roomId), linkRef.current);
		setCopied(ok ? "Link copied." : "Select it and press Ctrl+C.");
	}, [roomId]);

	if (!asking) return null;

	return (
		<div className="vd-veil">
			<style>{HUD_CSS}</style>
			<form className="vd-card" onSubmit={submit}>
				<h2 className="vd-title">Vento Áureo</h2>
				<p className="vd-sub">
					Deathmatch — first to 21 frags, or the best score in five minutes.
					<br />
					Hold <strong>Tab</strong> for the scoreboard.
				</p>
				<input
					ref={inputRef}
					className="vd-input"
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
				<div className="vd-row-actions">
					<button
						className="vd-btn"
						type="submit"
						disabled={value.trim() === ""}
					>
						Enter the arena
					</button>
				</div>
				<div className="vd-error">{error}</div>

				{/* Rooms are addressed, not matchmade, so this link *is* the invitation.
				    Shown before anything has connected, because a host wants to send it
				    while they are still typing their own name. */}
				{roomId ? (
					<div className="vd-share">
						<div className="vd-share-label">
							Send this link to play together
						</div>
						<div className="vd-share-row">
							<input
								ref={linkRef}
								className="vd-input vd-share-link"
								value={roomLink(roomId)}
								readOnly
								onFocus={(e) => e.target.select()}
							/>
							<button className="vd-btn vd-copy" type="button" onClick={share}>
								Copy
							</button>
						</div>
						<div className="vd-share-note">{copied}</div>
					</div>
				) : null}
			</form>
		</div>
	);
}
