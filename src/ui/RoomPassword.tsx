/**
 * The locked-room prompt.
 *
 * Shown when the server answers a join with `room-locked`: this room has a
 * password and the attempt the client carried did not match. There is no
 * session to play — the connection will never be seated — so the answer is a
 * prompt for the key and a fresh boot with it, not a wait.
 *
 * The password is written into the URL (`?password=`) and the page reloads:
 * the URL is the authority, so the link with the key is exactly the invitation
 * a host could have shared, and a reload boots the whole stack cleanly rather
 * than threading a reconnect through a scene that already thought it was
 * connecting.
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { setPendingPassword } from "../game/online/passwordStore";
import { MAX_PASSWORD_LENGTH } from "../game/online/types";
import { HUD_CSS } from "./hudStyles";

export function RoomPassword() {
	const [locked, setLocked] = useState<{
		roomId: string;
		hadPassword: boolean;
	} | null>(null);
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const off = EventBus.on("room-locked", ((data: unknown) => {
			const m = data as { roomId?: unknown; hadPassword?: unknown } | null;
			setLocked({
				roomId: typeof m?.roomId === "string" ? m.roomId : "",
				hadPassword: m?.hadPassword === true,
			});
		}) as never);
		return off;
	}, []);

	useEffect(() => {
		if (locked) inputRef.current?.focus();
	}, [locked]);

	if (!locked) return null;

	const wrongAttempt = locked.hadPassword;

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			setError("Enter the room's password.");
			return;
		}
		// Keep the password out of the address bar by default — hand it off
		// via `sessionStorage` and reload the same URL. The next boot's `Match`
		// will pick it up from the store. A manually typed `?password=` still
		// works as a fallback for old share links.
		setPendingPassword(trimmed.slice(0, MAX_PASSWORD_LENGTH));
		const url = new URL(window.location.href);
		url.searchParams.delete("password");
		window.location.replace(url.toString());
	};

	const back = () => {
		// Drop the launch request and return to the menu rather than trapping
		// a player who followed a link they cannot open.
		window.location.replace(window.location.pathname);
	};

	return (
		<div className="gd-veil">
			<style>{HUD_CSS}</style>
			<form className="gd-card" onSubmit={submit}>
				<h2 className="gd-title">locked room</h2>
				<p className="gd-sub">
					{wrongAttempt
						? "Wrong password — try again, or go back to the menu."
						: "This room has a password. Enter it to join."}
					{locked.roomId ? (
						<>
							<br />
							<span className="gd-join-example">{locked.roomId}</span>
						</>
					) : null}
				</p>
				<input
					ref={inputRef}
					className="gd-input"
					type="password"
					value={value}
					maxLength={MAX_PASSWORD_LENGTH}
					placeholder="password"
					autoComplete="off"
					spellCheck={false}
					onChange={(e) => {
						setValue(e.target.value);
						setError("");
					}}
				/>
				<div className="gd-row-actions">
					<button
						className="gd-btn gd-btn-primary"
						type="submit"
						disabled={value.trim() === ""}
					>
						Join
					</button>
					<button className="gd-btn" type="button" onClick={back}>
						Back to menu
					</button>
				</div>
				<div className="gd-error">{error}</div>
			</form>
		</div>
	);
}
