/**
 * The lost-connection prompt.
 *
 * A WebRTC seat that drops is gone — the server releases the fighter the
 * moment its channel closes, and nothing reconnects a data channel in place.
 * Before this, the match simply froze under a "Disconnected from server" line
 * with no way forward but knowing to press F5. The URL still names the room,
 * so the answer is the same one the locked-room prompt gives: boot again from
 * the URL, which seats a fresh fighter in the same match if it is still there.
 */

import { useEffect, useState } from "react";
import { EventBus } from "../game/EventBus";
import { HUD_CSS } from "./hudStyles";

export function ConnectionLost() {
	const [lost, setLost] = useState(false);

	useEffect(
		() => EventBus.on("connection-lost", (() => setLost(true)) as never),
		[],
	);

	if (!lost) return null;

	return (
		<div className="gd-veil">
			<style>{HUD_CSS}</style>
			<div className="gd-card" role="alertdialog" aria-labelledby="gd-lost">
				<h2 className="gd-title" id="gd-lost">
					connection lost
				</h2>
				<p className="gd-sub">
					The link to the game server dropped. Rejoin to jump back into this
					room, if the match is still running.
				</p>
				<div className="gd-row-actions">
					<button
						className="gd-btn gd-btn-primary"
						type="button"
						onClick={() => window.location.reload()}
					>
						Rejoin
					</button>
					<button
						className="gd-btn"
						type="button"
						onClick={() => window.location.replace(window.location.pathname)}
					>
						Back to menu
					</button>
				</div>
			</div>
		</div>
	);
}
