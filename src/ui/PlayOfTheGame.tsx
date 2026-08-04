/**
 * The Play of the Game ceremony's overlay: the title, the name card, and the
 * way out of it.
 *
 * The camera work is in the canvas; everything legible is here, for the same
 * reason the ultimate's cutscene is — a tracked heading, a card that slides, a
 * progress bar and a button are all things CSS does better than a `Graphics`
 * call, and none of them belong inside the camera that is busy pushing in on a
 * fighter.
 *
 * **It decides nothing.** `Match` owns the replay; this is told what phase the
 * director is in and how far along the footage is, and paints it. If it never
 * mounted, the replay would play identically with no words on it — which is the
 * property that keeps a cosmetic overlay from ever being able to hold up a
 * match.
 *
 * The one thing it *does* own is the way out: the skip button asks the game to
 * end the ceremony, over the same event bus everything else uses.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import type { PotgShot } from "../game/potg/Director";
import type { PlayStats, PotgAnnounce } from "../game/potg/types";
import { teamCss } from "../game/teamPalette";
import { POTG_CSS } from "./potgStyles";

/**
 * How long a card-only ceremony stands before it takes itself down.
 *
 * Reached when the server scored a play but no footage survived to go with it —
 * a play in the opening seconds of a match has almost no lead-in to cut from.
 * Long enough for the whole card — words, byline, stat line — to arrive and
 * hold, and no longer: there is nothing else on screen.
 */
const CARD_ONLY_MS = 5000;

/**
 * The stat line: "3 KILLS · 1,240 DMG · 2 DENIES · 310 BLOCKED".
 *
 * Only the buckets with anything in them are shown, so a double kill reads
 * "2 KILLS · 640 DMG" and not as a wall of zeroes. Order is fixed and matches
 * the stylesheet's argument: frags first, then the damage rows, absorbed last.
 */
function statParts(stats: PlayStats): string[] {
	const parts: string[] = [];
	if (stats.kills > 0)
		parts.push(`${stats.kills} KILL${stats.kills === 1 ? "" : "S"}`);
	if (stats.damage > 0) parts.push(`${stats.damage.toLocaleString()} DMG`);
	if (stats.denies > 0)
		parts.push(`${stats.denies} DENY${stats.denies === 1 ? "" : "S"}`);
	if (stats.absorbed > 0)
		parts.push(`${stats.absorbed.toLocaleString()} BLOCKED`);
	return parts;
}

export function PlayOfTheGame() {
	const [announce, setAnnounce] = useState<PotgAnnounce | null>(null);
	const [mine, setMine] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => {
		const clear = () => {
			window.clearTimeout(timer.current);
			timer.current = undefined;
			setAnnounce(null);
		};

		const offBegin = EventBus.on("potg-begin", ((msg: PotgAnnounce) => {
			window.clearTimeout(timer.current);
			setAnnounce(msg);
			// "YOU" is answered from the live match's own id rather than carried in
			// the announcement: the message is broadcast to sixteen clients and is
			// byte for byte the same on all of them, and a server that stamped it
			// per-client would be sending sixteen different reels.
			setMine(msg.protagonistId === window.__matchState?.().myId);
		}) as never);

		// No footage. The card stands on its own and dismisses itself — through
		// the same skip event the button uses, so there is one way for the
		// ceremony to end rather than two that have to agree.
		const offCardOnly = EventBus.on("potg-cardonly", (() => {
			window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => {
				EventBus.emit("potg-skip", null);
			}, CARD_ONLY_MS);
		}) as never);

		// Per rendered frame, and deliberately **not** through React state.
		//
		// The director produces a new shot sixty times a second; re-rendering the
		// tree that often to move an opacity is work for nothing. The four numbers
		// the stylesheet reads are written straight onto the root as custom
		// properties, which is a style recalculation on one element and no
		// reconciliation at all.
		const offShot = EventBus.on("potg-shot", ((shot: PotgShot) => {
			const root = rootRef.current;
			if (!root) return;
			root.style.setProperty("--potg-bars", shot.letterbox.toFixed(3));
			root.style.setProperty("--potg-curtain", shot.curtain.toFixed(3));
			root.style.setProperty("--potg-title", shot.title.toFixed(3));
			root.style.setProperty("--potg-card", shot.card.toFixed(3));
			root.style.setProperty("--potg-progress", shot.progress.toFixed(4));
		}) as never);

		const offEnd = EventBus.on("potg-end", clear as never);

		return () => {
			offBegin();
			offCardOnly();
			offShot();
			offEnd();
			window.clearTimeout(timer.current);
		};
	}, []);

	if (!announce) return null;

	// Defensive against a stale server: the stats row is cosmetic, and a card
	// that crashes because the wire lagged behind the build is a card that lost
	// the ceremony for no reason.
	const stats: PlayStats = announce.stats ?? {
		kills: announce.kills,
		damage: 0,
		denies: 0,
		absorbed: 0,
	};
	const statLine = statParts(stats);

	const accent = announce.team === null ? undefined : teamCss(announce.team);
	const style = accent
		? ({ "--potg-accent": accent } as React.CSSProperties)
		: undefined;

	return (
		<div className="vp-root" ref={rootRef} style={style} aria-live="polite">
			<style>{POTG_CSS}</style>

			<div className="vp-vignette" />
			{/* Curtain *and* letterbox, in one pair of elements: closed over the
			    whole screen for the title card, then opened into the bars the rest
			    of the ceremony is framed by. See `potgStyles.ts`. */}
			<div className="vp-bar top" />
			<div className="vp-bar bottom" />

			{/* The title card. Everything in here is generated art or CSS: the
			    wordmark is four PNGs from `scripts/make-potg-art.py` because its
			    condensed uppercase face exists on no platform by default, and the
			    burst is a PNG rather than a conic gradient because a gradient's rays
			    stay hard-edged to the rim and read as a warning label. */}
			<div className="vp-splash">
				<div className="vp-streaks" />
				<div className="vp-burst" />
				<div className="vp-flash" />
				<div className="vp-emblem" role="img" aria-label="Play of the game" />
				<div className="vp-words" role="img" aria-label="Play of the game">
					<img className="vp-word w1" src="assets/potg-word-play.png" alt="" />
					<img
						className="vp-word w2 small"
						src="assets/potg-word-of.png"
						alt=""
					/>
					<img
						className="vp-word w3 small"
						src="assets/potg-word-the.png"
						alt=""
					/>
					<img className="vp-word w4" src="assets/potg-word-game.png" alt="" />
				</div>
				<div className="vp-sweep" />
				<div className="vp-byline">
					<span className="name">{announce.protagonistName}</span>
					<i className="dot" />
					<span className="deed">{announce.headline}</span>
				</div>
				<div className="vp-rule" />
				{/* The receipt, under the name of it. The stats travel in the
				    announcement, so a ceremony with no footage still gets them. */}
				{statLine.length > 0 ? (
					<div className="vp-stats" role="note">
						{statLine.map((part, i) => (
							<Fragment key={part}>
								{i > 0 ? <i className="sep" /> : null}
								<span>{part}</span>
							</Fragment>
						))}
					</div>
				) : null}
			</div>

			{/* Through the roll itself, when the title is gone: the one thing that
			    distinguishes a replay from a live match the player has lost control
			    of. */}
			<div className="vp-tag">Replay · {announce.protagonistName}</div>

			<div className="vp-card">
				<div className="vp-headline">{announce.headline}</div>
				<div className="vp-name">
					{announce.protagonistName}
					{mine ? <span className="vp-you">You</span> : null}
				</div>
				<div className="vp-sub">{announce.subtitle}</div>
			</div>

			<button
				type="button"
				className="vp-skip"
				onClick={() => EventBus.emit("potg-skip", null)}
			>
				Skip
			</button>
			<div className="vp-progress" />
		</div>
	);
}

/**
 * True while the endgame ceremony owns the screen.
 *
 * That is more than the Play of the Game: the victory card is a ceremony too,
 * and the podium must wait for both. The match ends with a beat of breathing,
 * then the victory card, then the reel — and the fight HUD and the podium hide
 * from the first beat to the last, or the winner screen would be up over the
 * card (and the card over the HUD) the moment the match ended. `potg-end`
 * releases everything; a match with no play releases at `victory-done`, which
 * is when the card takes itself down and the podium takes its turn.
 */
export function useEndgameCeremony(): boolean {
	const [active, setActive] = useState(false);
	useEffect(() => {
		const on = EventBus.on("potg-begin", (() => setActive(true)) as never);
		const off = EventBus.on("potg-end", (() => setActive(false)) as never);
		// The ceremony starts at the whistle, not at the reel: from the first
		// frame of the breathing, the HUD's numbers are a match that is already
		// over and the podium is five beats early.
		const over = EventBus.on("match-over", (() => setActive(true)) as never);
		// A match with no play hands the screen back when the card leaves.
		const cardDone = EventBus.on("victory-done", (() =>
			setActive(false)) as never);
		// A new match takes it down whatever else happened — the same belt-and-
		// braces the podium has, and for the same reason: an overlay that outlives
		// its match sits over a live fight forever.
		const reset = EventBus.on("match-reset", (() => setActive(false)) as never);
		return () => {
			on();
			off();
			over();
			cardDone();
			reset();
		};
	}, []);
	return active;
}
