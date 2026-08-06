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

import type { MatchStatus } from "../game/online/types";
import type { Standing } from "../game/simulation/Deathmatch";
import { TEAM_COUNT, TEAM_NAMES, type TeamId } from "../game/simulation/Teams";
import { teamCss } from "../game/teamPalette";
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
	if (!held) return null;

	const { status, standings, myId } = match;
	const teams = status.teams;
	return (
		<div className="vd-board">
			<style>{HUD_CSS}</style>
			<div className="vd-board-card">
				<div className="vd-board-head">
					<span>
						{teams
							? `Teams — round ${teams.round}, first to ${status.scoreLimit}`
							: `Deathmatch — first to ${status.scoreLimit}`}
						{/* Which room, so a player can tell whether the friend who said
						    "I'm in" is actually in this one. Shortened: a full uuid is
						    unreadable and the address bar has the whole thing. */}
						{roomId ? (
							<span className="vd-room"> · room {roomId.slice(0, 8)}</span>
						) : null}
					</span>
					<span>{formatClock(status.timeLimitMs - status.elapsedMs)}</span>
				</div>
				{teams ? (
					<TeamTables standings={standings} myId={myId} teams={teams} />
				) : (
					<ScoreTable standings={standings} myId={myId} />
				)}
			</div>
		</div>
	);
}

/**
 * One block per side: the round score as the headline, then that side's
 * fighters in the same order a free-for-all would rank them.
 *
 * The order *within* a block is `rankScores`'s, untouched — the standings are
 * ranked once, by the same pure function the server uses, and this only filters
 * them. Re-sorting here is how a scoreboard ends up disagreeing with the podium
 * it turns into.
 */
function TeamTables({
	standings,
	myId,
	teams,
}: {
	standings: Standing[];
	myId: string;
	teams: NonNullable<MatchStatus["teams"]>;
}) {
	return (
		<>
			{Array.from({ length: TEAM_COUNT }, (_, t) => t as TeamId).map((team) => {
				const rows = standings.filter((s) => s.team === team);
				return (
					<div
						key={team}
						className="vd-team-block"
						style={{ color: teamCss(team) }}
					>
						<div className="vd-team-head">
							<span>{TEAM_NAMES[team]}</span>
							<span className="vd-team-alive">
								{teams.alive[team] ?? 0} of {teams.seated[team] ?? 0} standing
							</span>
							<span className="vd-team-rounds">{teams.scores[team] ?? 0}</span>
						</div>
						{rows.length > 0 ? (
							<ScoreTable standings={rows} myId={myId} />
						) : null}
					</div>
				);
			})}
		</>
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
					<th className="vd-num" title="Damage dealt">
						DMG
					</th>
					<th className="vd-num" title="Ultimates taken away">
						Denies
					</th>
					<th className="vd-num" title="Damage the guard turned away">
						Blocked
					</th>
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
						<td className="vd-num">{s.damage}</td>
						<td className="vd-num">{s.denies}</td>
						<td className="vd-num">{s.blocked}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
