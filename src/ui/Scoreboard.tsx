/**
 * The Tab scoreboard.
 *
 * Held, not toggled: a scoreboard you have to press twice is a scoreboard you
 * leave open over a fight. `pointer-events: none` throughout, so it never eats a
 * click meant for the arena underneath.
 *
 * The rows come from `standings()`, which ranks with the same pure function the
 * server ranks with. Sorting here with anything of its own is how a live
 * scoreboard ends up disagreeing with the podium it turns into.
 */

import type { Standing } from "../game/simulation/Deathmatch";
import { HUD_CSS } from "./hudStyles";
import {
	formatClock,
	useKeyHeld,
	useMatch,
	useMatchOver,
	useRoomId,
} from "./useMatch";

export function Scoreboard() {
	const match = useMatch();
	const over = useMatchOver();
	const held = useKeyHeld("Tab");
	const roomId = useRoomId();

	if (!match) return null;
	// The podium is already a scoreboard, and a bigger one. Leaving the hint up
	// under it put "hold Tab for scores" through the veil at the bottom of the
	// winner screen.
	if (over) return null;
	if (!held) {
		return (
			<div className="vd-hint">
				<style>{HUD_CSS}</style>
				hold Tab for scores · Esc for controls
			</div>
		);
	}

	const { status, standings, myId } = match;
	return (
		<div className="vd-board">
			<style>{HUD_CSS}</style>
			<div className="vd-board-card">
				<div className="vd-board-head">
					<span>
						Deathmatch — first to {status.scoreLimit}
						{/* Which room, so a player can tell whether the friend who said
						    "I'm in" is actually in this one. Shortened: a full uuid is
						    unreadable and the address bar has the whole thing. */}
						{roomId ? (
							<span className="vd-room"> · room {roomId.slice(0, 8)}</span>
						) : null}
					</span>
					<span>{formatClock(status.timeLimitMs - status.elapsedMs)}</span>
				</div>
				<ScoreTable standings={standings} myId={myId} />
			</div>
		</div>
	);
}

export function ScoreTable({
	standings,
	myId,
	from = 1,
}: {
	standings: Standing[];
	myId: string;
	/** Skip the places already shown on a podium. */
	from?: number;
}) {
	const rows = standings.filter((s) => s.place >= from);
	return (
		<table className="vd-table">
			<thead>
				<tr>
					<th style={{ width: "3em" }}>#</th>
					<th>Fighter</th>
					<th className="vd-num">Frags</th>
					<th className="vd-num">Deaths</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((s) => (
					<tr key={s.id} className={s.id === myId ? "vd-me" : undefined}>
						<td className="vd-num">{s.place}</td>
						<td>
							{s.name}
							{s.bot ? <span className="vd-tag">BOT</span> : null}
						</td>
						<td className="vd-num">{s.kills}</td>
						<td className="vd-num">{s.deaths}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
