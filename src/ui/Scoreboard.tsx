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
	usePings,
	useRoomId,
} from "./useMatch";

/** Where a ping stops reading as healthy and starts costing reactions, ms. */
const PING_WARN_MS = 100;
/** Where the link is visibly fighting the input, ms. */
const PING_BAD_MS = 200;

/**
 * The scoreboard's ping cell, or a dash for somebody there is no link to.
 *
 * Bots and the training dummy are server-hosted — they have no WebRTC channel,
 * so they have no round trip, and showing `0ms` would be a lie dressed as a
 * good connection.
 */
function PingCell({
	ping,
	bot,
}: {
	ping: number | undefined;
	bot: boolean;
}) {
	if (ping === undefined) {
		return (
			<td
				className="gd-num gd-ping gd-ping-none"
				title={
					bot
						? "Server-hosted — no network link to measure"
						: "Waiting for the first round trip"
				}
			>
				—
			</td>
		);
	}
	const tone =
		ping > PING_BAD_MS
			? " gd-ping-bad"
			: ping > PING_WARN_MS
				? " gd-ping-warn"
				: "";
	return (
		<td
			className={`gd-num gd-ping${tone}`}
			title="Round-trip time to the game server"
		>
			{ping}
		</td>
	);
}

export function Scoreboard() {
	const match = useMatch();
	const over = useMatchOver();
	const held = useKeyHeld("Tab");
	const roomId = useRoomId();
	const pings = usePings();

	if (!match) return null;
	// The podium is already a scoreboard, and a bigger one. Leaving the hint up
	// under it put "hold Tab for scores" through the veil at the bottom of the
	// winner screen.
	if (over) return null;
	if (!held) return null;

	const { status, standings, myId } = match;
	const teams = status.teams;
	return (
		<div className="gd-board">
			<style>{HUD_CSS}</style>
			<div className="gd-board-card">
				<div className="gd-board-head">
					<span>
						{teams
							? `Teams — round ${teams.round}, first to ${status.scoreLimit}`
							: `Deathmatch — first to ${status.scoreLimit}`}
						{/* Which room, so a player can tell whether the friend who said
						    "I'm in" is actually in this one. Shortened: a full uuid is
						    unreadable and the address bar has the whole thing. */}
						{roomId ? (
							<span className="gd-room"> · room {roomId.slice(0, 8)}</span>
						) : null}
					</span>
					<span>{formatClock(status.timeLimitMs - status.elapsedMs)}</span>
				</div>
				{teams ? (
					<TeamTables
						standings={standings}
						myId={myId}
						teams={teams}
						pings={pings}
					/>
				) : (
					<ScoreTable standings={standings} myId={myId} pings={pings} />
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
	pings,
}: {
	standings: Standing[];
	myId: string;
	teams: NonNullable<MatchStatus["teams"]>;
	pings: Record<string, number>;
}) {
	return (
		<>
			{Array.from({ length: TEAM_COUNT }, (_, t) => t as TeamId).map((team) => {
				const rows = standings.filter((s) => s.team === team);
				return (
					<div
						key={team}
						className="gd-team-block"
						style={{ color: teamCss(team) }}
					>
						<div className="gd-team-head">
							<span>{TEAM_NAMES[team]}</span>
							<span className="gd-team-alive">
								{teams.alive[team] ?? 0} of {teams.seated[team] ?? 0} standing
							</span>
							<span className="gd-team-rounds">{teams.scores[team] ?? 0}</span>
						</div>
						{rows.length > 0 ? (
							<ScoreTable standings={rows} myId={myId} pings={pings} />
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
	pings,
}: {
	standings: Standing[];
	myId: string;
	/** Skip the places already shown on a podium. */
	from?: number;
	/**
	 * Server-measured round trips, by fighter id. Omitted on the podium: the
	 * winner screen is about the match, not the link, and the last reading of a
	 * match that is already over is not worth a column.
	 */
	pings?: Record<string, number>;
}) {
	const rows = standings.filter((s) => s.place >= from);
	return (
		<table className="gd-table">
			<thead>
				<tr>
					<th style={{ width: "3em" }}>#</th>
					<th>Fighter</th>
					{pings ? (
						<th className="gd-num" title="Round-trip time to the game server">
							Ping
						</th>
					) : null}
					<th className="gd-num">Frags</th>
					<th className="gd-num">Deaths</th>
					<th className="gd-num" title="Damage dealt">
						DMG
					</th>
					<th className="gd-num" title="Ultimates taken away">
						Denies
					</th>
					<th className="gd-num" title="Damage the guard turned away">
						Blocked
					</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((s) => (
					<tr key={s.id} className={s.id === myId ? "gd-me" : undefined}>
						<td className="gd-num">{s.place}</td>
						<td>
							{s.name}
							{s.bot ? <span className="gd-tag">BOT</span> : null}
						</td>
						{pings ? <PingCell ping={pings[s.id]} bot={s.bot} /> : null}
						<td className="gd-num">{s.kills}</td>
						<td className="gd-num">{s.deaths}</td>
						<td className="gd-num">{s.damage}</td>
						<td className="gd-num">{s.denies}</td>
						<td className="gd-num">{s.blocked}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
