/**
 * The victory card: the first thing the game says after the fight is over.
 *
 * The match ends and *nothing* is said for a few seconds — the arena holds
 * the last moment, which is the whole of the breathing — and then this lands:
 * one word, VICTORY or DEFEAT, the name of the fighter (or side) it belongs
 * to, and a line about how it was decided. It is the answer to the silence,
 * which is why the silence has to exist first: a card that cut straight in
 * on the winning blow would read as an interruption of the fight, not as a
 * verdict on it.
 *
 * **It is a card, not a screen.** It carries no buttons and decides nothing:
 * it paints the verdict and gets out of the way when the Play of the Game
 * curtain closes over it. The podium — the one screen that *does* carry
 * information — waits for the whole ceremony, exactly as it already waited
 * for the reel.
 *
 * The word itself is generated art, `potg-word-victory.png` — the same
 * condensed display face the Play of the Game wordmark uses, because the two
 * cards are the same family of moment and should look like it. Victory is
 * struck in the gold; defeat in a colder silver, so a losing player reads the
 * tone of the verdict from the colour before a word is legible.
 */

import { useEffect, useState } from "react";
import { EventBus } from "../game/EventBus";
import type { MatchOverMsg } from "../game/online/types";
import { mvpOf } from "../game/simulation/Deathmatch";
import type { TeamId } from "../game/simulation/Teams";
import { TEAM_NAMES } from "../game/simulation/Teams";
import { teamCss } from "../game/teamPalette";
import { POTG_CSS } from "./potgStyles";

/** What the card needs to say who won, bundled by the match. */
export interface VictoryInfo {
	/** The server's standings, or null when the card beat them onto the wire. */
	over: MatchOverMsg | null;
	/** The local fighter's id, for "you". */
	myId: string;
	/** The local fighter's side, so a team verdict can be personal. */
	myTeam: TeamId | null;
}

function verdictWord(info: VictoryInfo): "victory" | "defeat" | "draw" {
	const over = info.over;
	if (!over) return "draw";
	if (over.teamScores) {
		if (over.winnerTeam === null) return "draw";
		return info.myTeam === over.winnerTeam ? "victory" : "defeat";
	}
	if (over.winnerId === null) return "draw";
	return info.myId === over.winnerId ? "victory" : "defeat";
}

export function VictoryCard() {
	const [info, setInfo] = useState<VictoryInfo | null>(null);

	useEffect(() => {
		const show = EventBus.on("victory-show", ((msg: VictoryInfo) =>
			setInfo(msg)) as never);
		// The card leaves when the ceremony begins (the curtain covers it) or
		// when the window closes without one — the podium's turn either way.
		const done = EventBus.on("victory-done", (() => setInfo(null)) as never);
		const ceremony = EventBus.on("potg-begin", (() => setInfo(null)) as never);
		const reset = EventBus.on("match-reset", (() => setInfo(null)) as never);
		return () => {
			show();
			done();
			ceremony();
			reset();
		};
	}, []);

	if (!info) return null;

	const over = info.over;
	const word = verdictWord(info);
	const teamScores = over?.teamScores ?? null;
	const winnerTeam = over?.winnerTeam ?? null;
	const winner =
		(over?.standings.find((s) => s.id === over.winnerId) ?? null) || null;
	// A team match was won by a side; the MVP is who carried it, which is the
	// whole-match weighted score, not necessarily the cleanest fragger.
	const mvp = over ? mvpOf(over.standings) : null;

	// The line under the word: the fighter or side it belongs to. A team win is
	// tinted in the side's colour; a personal one in the card's own accent.
	let line = "";
	let lineColor: string | undefined;
	let sub = "";

	if (teamScores) {
		if (winnerTeam === null) {
			line = TEAM_NAMES.map((name, i) => `${name} ${teamScores[i] ?? 0}`).join(
				" · ",
			);
			sub = "Time ran out, nobody left standing.";
		} else {
			line = `${TEAM_NAMES[winnerTeam]} WIN`;
			lineColor = teamCss(winnerTeam);
			sub = mvp
				? `MVP: ${mvp.name}${mvp.id === info.myId ? " — you" : ""}`
				: "";
		}
	} else if (over && winner) {
		line = `${winner.name}${winner.id === info.myId ? " — you" : ""} wins`;
		sub =
			over.reason === "score"
				? `Frag limit, with ${winner.kills}.`
				: "Time. Highest score takes it.";
	} else {
		line = "Match over";
	}

	return (
		<div className="vv-root" aria-live="polite">
			<style>{POTG_CSS}</style>
			<div className="vv-veil" />
			<img
				className="vv-word"
				src={`assets/potg-word-${word}.png`}
				alt={word}
			/>
			<div
				className="vv-line"
				style={lineColor ? { color: lineColor } : undefined}
			>
				{line}
			</div>
			{sub ? <div className="vv-sub">{sub}</div> : null}
		</div>
	);
}
