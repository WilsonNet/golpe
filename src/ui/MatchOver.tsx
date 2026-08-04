/**
 * The winner screen.
 *
 * Built from `match-over`, which the server sends once with the full standings
 * attached. The live scoreboard could rebuild the same ranking from the last
 * snapshot — and deliberately is not asked to: this is the one screen a player
 * will stare at, and it should not depend on a client having kept up with the
 * final datagram of a match.
 *
 * The podium sets first, second and third apart from the field. Second and third
 * are the places people argue about, so their names are set well above the rest
 * of the table rather than being three more rows in it.
 */

import { rankScores } from "../game/simulation/Deathmatch";
import { TEAM_NAMES } from "../game/simulation/Teams";
import { teamCss } from "../game/teamPalette";
import { HUD_CSS } from "./hudStyles";
import { useEndgameCeremony } from "./PlayOfTheGame";
import { ScoreTable } from "./Scoreboard";
import { formatClock, useMatch, useMatchOver } from "./useMatch";

const PLACE_LABEL = ["", "1ST", "2ND", "3RD"];

/** Left to right on screen, so the winner stands between the other two. */
const PODIUM_SLOTS = [
	{ slot: "left", place: 2 },
	{ slot: "centre", place: 1 },
	{ slot: "right", place: 3 },
] as const;

/**
 * Widest name a podium card fits at its full size, in characters.
 *
 * Derived rather than guessed, and deliberately conservative: the font is
 * monospace so a glyph is ~0.6em, and the narrowest card has ~147px of usable
 * width. Erring low costs a slightly smaller name; erring high wraps one
 * mid-word, which is what `HungryLla ma` was.
 */
const COMFORTABLE = 9;

/**
 * Shrink a long name to fit its card.
 *
 * Names run to sixteen characters, so a full-length one at the podium's heading
 * size wrapped mid-word and read as `HomelyHamste r`. CSS cannot measure text,
 * but React knows the string — so the size comes from the length. Shrinking beats
 * truncating: the one screen a player remembers should not be where their name
 * gets cut off.
 */
function nameStyle(place: number, name: string) {
	const base = place === 1 ? 28 : 24;
	if (name.length <= COMFORTABLE) return undefined;
	const scaled = Math.max(base * 0.6, base * (COMFORTABLE / name.length));
	return { fontSize: `${Math.round(scaled)}px` };
}

export function MatchOver() {
	const over = useMatchOver();
	const match = useMatch();
	// Play of the Game runs first. Both announcements arrive in the same breath —
	// the reel is sent immediately before the standings — so without this the
	// podium would be up over the replay of how it was won, which makes both of
	// them pointless. The podium is not cancelled, only deferred: `useMatchOver`
	// is still holding the result when the ceremony ends.
	const ceremony = useEndgameCeremony();
	if (!over || ceremony) return null;

	// Ranked here as well as on the server. Same function, so the answer is the
	// same — and the podium does not depend on the order the standings arrived in.
	const standings = rankScores(over.standings);
	const podium = standings.slice(0, 3);
	const myId = match?.myId ?? "";
	const winner = podium[0];
	const nextIn = match?.status.nextMatchInMs ?? 0;
	// A team match was won by a side. The MVP still gets the middle of the podium
	// — somebody carried it and that is worth showing — but the headline is the
	// side, because that is what everybody in the room was actually playing for.
	const team = over.winnerTeam ?? null;
	const teamScores = over.teamScores ?? null;

	return (
		<div className="vd-veil">
			<style>{HUD_CSS}</style>
			<div className="vd-card" style={{ minWidth: "min(560px, 92vw)" }}>
				{teamScores ? (
					<>
						<div
							className="vd-team-banner"
							style={{ color: team === null ? undefined : teamCss(team) }}
						>
							{team === null ? "DRAW" : `${TEAM_NAMES[team]} WIN`}
						</div>
						<div className="vd-team-final">
							{TEAM_NAMES.map(
								(name, i) => `${name} ${teamScores[i] ?? 0}`,
							).join("  ·  ")}
							{over.reason === "time" ? "  ·  time" : ""}
						</div>
						<p className="vd-sub">
							{winner ? `MVP: ${winner.name}, ${winner.kills} frags.` : ""}
						</p>
					</>
				) : (
					<>
						<h2 className="vd-title">
							{winner ? `${winner.name} wins` : "Match over"}
						</h2>
						<p className="vd-sub">
							{over.reason === "score"
								? `Reached the frag limit with ${winner?.kills ?? 0}.`
								: "Time. Highest score takes it."}
						</p>
					</>
				)}

				<div className="vd-podium">
					{/* Second, first, third — so the winner stands in the middle. The
					    slot, not the array index, is the key: a match can end with fewer
					    than three fighters, and an empty slot keeps the winner centred
					    instead of sliding it left. */}
					{PODIUM_SLOTS.map(({ slot, place }) => {
						const entry = podium[place - 1];
						if (!entry) {
							return (
								<div key={slot} className="vd-place" style={{ opacity: 0 }} />
							);
						}
						return (
							<div key={slot} className={`vd-place vd-place-${entry.place}`}>
								<div className="vd-place-rank">
									{PLACE_LABEL[entry.place] ?? `#${entry.place}`}
								</div>
								<div
									className="vd-place-name"
									style={nameStyle(entry.place, entry.name)}
								>
									{entry.name}
									{entry.id === myId ? " (you)" : ""}
								</div>
								<div className="vd-place-frags">
									{entry.kills} frags · {entry.deaths} deaths
								</div>
							</div>
						);
					})}
				</div>

				{standings.length > 3 ? (
					<>
						<p className="vd-rest-head">The rest of the field</p>
						<ScoreTable standings={standings} myId={myId} from={4} />
					</>
				) : null}

				<div className="vd-next">
					{nextIn > 0
						? `Next match in ${formatClock(nextIn)}`
						: "Next match starting…"}
				</div>
			</div>
		</div>
	);
}
