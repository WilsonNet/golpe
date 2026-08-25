/**
 * The fight HUD: Chrono Trigger's battle window, framed like a Fire Emblem
 * codex.
 *
 * Everything a player reads during an exchange lives here — self panel
 * top-left, foe panel top-right in a duel, the clock top-centre, the
 * ultimate meter bottom-centre, and a battle-message window for narration.
 * The Tab scoreboard and the podium stay where they were; this is the layer
 * that never asks the player to look away from the fight.
 *
 * **Why DOM and not canvas.** Ornate frames, subpixel text at any DPR and
 * CSS transitions are exactly what canvas text is bad at, and the HUD only
 * moves when the fight does — HP, charge and the clock — so it is event-
 * driven at snapshot cadence, not per-frame. See the `hud-design` skill for
 * the full split.
 *
 * **Sizing.** Everything is authored in container units against the HUD's
 * own box, which is the displayed canvas rectangle (800x600 authored, scaled
 * to fit): 1cqw = 8 logical px, 1cqh = 6 logical px, at every display size.
 * No JS measurement, no drift on a wide window or a portrait phone.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { HUD_EVENTS, type HudState } from "../game/hud";
import { bindings, codeLabel } from "../game/input/Bindings";
import { ULT_MAX_CHARGE } from "../game/simulation/Physics";
import { TEAM_COUNT, TEAM_NAMES } from "../game/simulation/Teams";
import { teamCss } from "../game/teamPalette";
import { FIGHT_HUD_CSS } from "./fightHudStyles";
import { KillFeed } from "./KillFeed";
import { useEndgameCeremony } from "./PlayOfTheGame";
import { formatClock, type MatchView, useMatch } from "./useMatch";

/** The live fight state, or null before the first snapshot. */
function useHudState(): HudState | null {
	const [hud, setHud] = useState<HudState | null>(null);
	useEffect(
		() =>
			EventBus.on(HUD_EVENTS.state, ((next: HudState) =>
				setHud(next)) as never),
		[],
	);
	return hud;
}

/** FE's HP states: green while healthy, amber hurt, red dying. */
function hpColor(frac: number): string {
	return frac > 0.66 ? "#6fcf6f" : frac > 0.33 ? "#ffd166" : "#ff5d5d";
}

/** A damage flash that re-arms itself, so two hits read as two hits. */
function useDamageFlash(value: number | undefined): boolean {
	const [flashing, setFlashing] = useState(false);
	const prev = useRef<number | undefined>(undefined);
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => {
		const before = prev.current;
		prev.current = value;
		if (before === undefined || value === undefined || value >= before) return;
		setFlashing(true);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setFlashing(false), 420);
	}, [value]);
	return flashing;
}

function FighterPanel({
	hud,
	foe,
	training,
}: {
	hud: HudState;
	foe: boolean;
	training: boolean;
}) {
	const hp = foe ? hud.foeHp : hud.hp;
	const frac = hud.maxHp > 0 ? Math.max(0, hp) / hud.maxHp : 0;
	const flashing = useDamageFlash(hp);
	const name = foe ? hud.foeName || "FOE" : hud.name || "YOU";

	// The panel wears its own side. One colour, on the one element a player never
	// has to search for — everything else they are asked to read in team colour is
	// read *relative* to this.
	const edge =
		hud.team === null ? undefined : { borderColor: teamCss(hud.team) };

	return (
		<section
			className={`vdh-panel${foe ? " vdh-foe" : " vdh-self"}${flashing ? " vdh-damaged" : ""}${training ? " vdh-beside-training" : ""}`}
			style={foe ? undefined : edge}
		>
			<div className="vdh-plaque">
				<span className="vdh-name">{name}</span>
				{foe ? (
					<span className="vdh-hero">
						{hud.foeHero === "anands"
							? "ANANDS"
							: hud.foeHero === "jeffs"
								? "JEFFS"
								: "LIA"}
					</span>
				) : (
					<span
						className={`vdh-stance${hud.stance === "gun" ? " vdh-stance-gun" : ""}${hud.massiveReady ? " vdh-massive" : ""}`}
					>
						{/* The badge names the actual weapon: Lia's sword and pistol,
						    Anands' dagger and machine gun, Jeffs' sword and shotgun.
						    The stance is the slot; the hero is the weapon in it. */}
						{hud.stance === "gun"
							? hud.hero === "anands"
								? "MACHINE GUN"
								: hud.hero === "jeffs"
									? "SHOTGUN"
									: "GUN"
							: hud.hero === "anands"
								? "DAGGER"
								: "SWORD"}
					</span>
				)}
			</div>
			<div className="vdh-hp-row">
				<div className="vdh-hp">
					{/* The FE ghost: it lags the fill by a beat, so a hit reads as
					    a white drain chasing the coloured bar down. */}
					<div className="vdh-hp-ghost" style={{ width: `${frac * 100}%` }} />
					<div
						className={`vdh-hp-fill${hp > 0 && frac <= 0.3 ? " vdh-low" : ""}`}
						style={{ width: `${frac * 100}%`, background: hpColor(frac) }}
					/>
					<div className="vdh-hp-ticks" />
				</div>
				<span className="vdh-hp-num">
					{Math.max(0, Math.ceil(hp))}/{hud.maxHp}
				</span>
			</div>
			<FragsRow foe={foe} />
		</section>
	);
}

/**
 * FRAGS counter, one per panel: your kills on the left, the foe's on the
 * right in a duel. The +1 rises off whichever counter just scored — a duel's
 * frags are both fighters' progress to the limit.
 */
function FragsRow({ foe }: { foe: boolean }) {
	const match = useMatch();
	const prev = useRef(0);
	// The counter first appears at zero; the popup is for a *kill*, so the
	// 0→1 transition must pop but the initial mount must not. `seen` tracks
	// "was the counter on screen", not "was it non-zero".
	const seen = useRef(false);
	const row = match?.standings.find((s) =>
		foe ? s.id !== match?.myId : s.id === match?.myId,
	);
	const frags = row?.kills ?? 0;
	const grew = seen.current && frags > prev.current;
	prev.current = frags;
	seen.current = true;
	// The popup must live its whole animation, not one render: `grew` is true
	// on exactly the render that sees the counter rise, and the very next
	// render would remove the span again. Latch it into state, keyed by the
	// frag count so a second kill restarts it, and let a timer unmount it.
	const [pop, setPop] = useState<number | null>(null);
	if (grew) setPop(frags);
	useEffect(() => {
		if (pop === null) return;
		const t = window.setTimeout(() => setPop(null), 1000);
		return () => window.clearTimeout(t);
	}, [pop]);
	if (!match) return null;
	return (
		<div className="vdh-frags">
			frags{" "}
			<b>
				{frags}/{match.status.scoreLimit}
			</b>
			{pop !== null ? (
				<span className="vdh-killpop" key={pop}>
					+1
				</span>
			) : null}
		</div>
	);
}

/**
 * Freezetime: the round number, a big countdown, and who is on which side.
 *
 * Read straight off `status.teams.freezeMs` rather than counted locally. It is
 * the same number every fighter is carrying in their own `freezeTimer`, so the
 * moment the HUD says zero is the moment they can actually move — a HUD clock
 * of its own would drift against the simulation and let somebody push on a "1"
 * that was really a "2".
 */
function FreezeTime({
	teams,
}: {
	teams: NonNullable<MatchView["status"]["teams"]>;
}) {
	const seconds = Math.ceil(teams.freezeMs / 1000);
	return (
		<div className="vdh-freeze">
			<div className="vdh-freeze-round">round {teams.round}</div>
			<div
				key={seconds}
				className={`vdh-freeze-count${seconds <= 3 ? " vdh-freeze-soon" : ""}`}
			>
				{seconds}
			</div>
			<div className="vdh-freeze-sides">
				<span style={{ color: teamCss(0) }}>
					{TEAM_NAMES[0]} {teams.seated[0] ?? 0}
				</span>
				<span style={{ opacity: 0.6 }}> vs </span>
				<span style={{ color: teamCss(1) }}>
					{TEAM_NAMES[1]} {teams.seated[1] ?? 0}
				</span>
			</div>
		</div>
	);
}

/**
 * The round score, the living count and which round this is.
 *
 * Replaces the clock's "FIRST TO N" line in a team match, rather than sitting
 * beside it: the HUD's rule is that nothing permanent may read as furniture, and
 * two subtitles under one clock is furniture. The frag limit is not interesting
 * in a mode where frags do not win anything — the round score is.
 */
function TeamScores({
	teams,
	limit,
}: {
	teams: NonNullable<MatchView["status"]["teams"]>;
	limit: number;
}) {
	// Which side's number just moved, so it can flare. Keyed on the score itself:
	// re-mounting the span is what restarts the animation, exactly as the frag
	// popup does it.
	const sides = Array.from({ length: TEAM_COUNT }, (_, t) => ({
		team: t,
		score: teams.scores[t] ?? 0,
		alive: teams.alive[t] ?? 0,
	}));

	return (
		<>
			<div className="vdh-teams">
				{sides.map((side, i) => (
					<Fragment key={side.team}>
						{i > 0 ? (
							<span
								className={`vdh-team-alive${
									sides.some((s) => s.alive === 1) ? " vdh-team-critical" : ""
								}`}
							>
								{`(${sides.map((s) => s.alive).join(" v ")})`}
							</span>
						) : null}
						<span
							key={`${side.team}:${side.score}`}
							className={`vdh-team-score${
								teams.lastRoundWinner === side.team && teams.resetInMs > 0
									? " vdh-team-won"
									: ""
							}`}
							style={{ color: teamCss(side.team as 0 | 1) }}
							title={TEAM_NAMES[side.team]}
						>
							{side.score}
						</span>
					</Fragment>
				))}
			</div>
			<div className="vdh-round">
				round {teams.round} · first to {limit}
			</div>
		</>
	);
}

/** The battle message window: CT's narration, told once and then gone. */
function useBattleMessage(): [
	message: string,
	announce: (text: string) => void,
] {
	const [message, setMessage] = useState("");
	const timer = useRef<number | undefined>(undefined);
	const announce = (text: string) => {
		window.clearTimeout(timer.current);
		setMessage(text);
		if (text) {
			timer.current = window.setTimeout(() => setMessage(""), 3500);
		}
	};
	useEffect(
		() => EventBus.on(HUD_EVENTS.status, announce as never),
		// biome-ignore lint/correctness/useExhaustiveDependencies(announce): closes over a ref and a setter only — the React Compiler memoises it with a stable identity.
		[announce],
	);
	return [message, announce];
}

export function FightHud({ training = false }: { training?: boolean }) {
	const hud = useHudState();
	const match = useMatch();
	const [message, announce] = useBattleMessage();
	const ceremony = useEndgameCeremony();

	// The clock, once the server says what the match is.
	const teams = match?.status.teams ?? null;
	const clock = match
		? {
				time: formatClock(match.status.timeLimitMs - match.status.elapsedMs),
				sub: `FIRST TO ${match.status.scoreLimit}`,
				danger: match.status.timeLimitMs - match.status.elapsedMs <= 10000,
			}
		: null;

	// The duel's foe panel is only true in a two-fighter room. In a deathmatch
	// there is no "the opponent" — the scoreboard owns the field.
	const duel = match
		? match.standings.length === 2
		: (hud?.fighterCount ?? 0) === 2;

	// A match starting is an announcement worth making: "FIGHT — FIRST TO 21",
	// or in a team match what the rounds are actually worth.
	const lastPhase = useRef<string | null>(null);
	useEffect(() => {
		const phase = match?.status.phase ?? null;
		if (phase === "live" && lastPhase.current !== "live" && match) {
			announce(
				match.status.mode === "tdm"
					? `TEAM DEATHMATCH — FIRST TO ${match.status.scoreLimit} ROUNDS`
					: `FIGHT — FIRST TO ${match.status.scoreLimit}`,
			);
		}
		lastPhase.current = phase;
	}, [match, announce]);

	// The ultimate meter's keycap shows the *actual* binding, and redraws when
	// the controls dialog changes it — a hint that lies about the button is
	// worse than no hint. The bindings are snapshotted into state rather than
	// read straight off the store, because the React Compiler only memoises
	// on values a render reads: a direct store read would freeze the keycaps
	// at mount, and the store's change events would arrive at a bump state
	// nothing in the JSX depended on.
	const [map, setMap] = useState(() => bindings.snapshot());
	useEffect(() => bindings.subscribe(() => setMap(bindings.snapshot())), []);
	const ultKey = codeLabel(map.ultimate[0] ?? "");
	const ultCap = hud?.ultCap ?? ULT_MAX_CHARGE;
	const ult = hud ? Math.max(0, Math.min(ultCap, hud.ult)) : 0;
	const ultReady = ult >= ultCap;
	const itemKey = codeLabel(map.item[0] ?? "");
	const item = hud?.itemCharges ?? 0;
	const itemMax = hud?.itemMaxCharges ?? 0;

	// The Play of the Game replay owns the whole frame. A live HP bar over
	// footage from a minute ago is not a HUD, it is a second fight the player
	// cannot tell from the one being replayed — and the local fighter it
	// describes is one of the people in the clip.
	if (ceremony) return null;

	return (
		<div className="vdh-hud">
			<style>{FIGHT_HUD_CSS}</style>
			{hud ? <FighterPanel hud={hud} foe={false} training={training} /> : null}
			{hud && duel ? <FighterPanel hud={hud} foe training={training} /> : null}

			{/* Whoever fights in the corner of the eye: the frags nobody saw. */}
			<KillFeed />

			{clock ? (
				<section
					className={`vdh-clock${clock.danger ? " vdh-clock-danger" : ""}`}
				>
					<div className="vdh-clock-time">{clock.time}</div>
					{teams ? (
						<TeamScores teams={teams} limit={match?.status.scoreLimit ?? 0} />
					) : (
						<div className="vdh-clock-sub">{clock.sub}</div>
					)}
				</section>
			) : null}

			{/* The magazine and the reload, bottom-right above the item: the
			    weapon's own resource beside the kit's. The count reads
			    "rounds loaded / rounds behind" — 12/36 at the start of a life
			    — so a player can see the gun run dry coming: a clip reload is
			    full magazine or nothing (the whole rack lands at once), the
			    shotgun fills one shell at a time, and when the reserve and the
			    magazine are both empty the count becomes DRY, flashing red. The
			    bar fills as the reload lands and a CSS glide smooths the 20Hz
			    snapshot steps. */}
			<section className="vdh-ammo">
				<span className="vdh-ammo-label">AMMO</span>
				{(hud?.ammo ?? 0) > 0 || (hud?.reserveRounds ?? 0) > 0 ? (
					<span className="vdh-ammo-count">
						{`${hud?.ammo ?? 0}/${hud?.reserveRounds ?? 0}`}
					</span>
				) : (
					<span className="vdh-ammo-count vdh-ammo-count-dry">DRY</span>
				)}
				<div className="vdh-ammo-track">
					<div
						className="vdh-ammo-fill"
						style={{ width: `${(hud?.reloadProgress ?? 0) * 100}%` }}
					/>
				</div>
			</section>

			{/* The item's charges, tucked beside the ultimate: a finite resource
			    next to the earned one, so the player can see at a glance what this
			    life has left to spend. Charged pips that grey out one by one. */}
			<section className="vdh-item">
				<span className="vdh-item-label">{hud?.itemLabel ?? "ITEM"}</span>
				<div className="vdh-item-pips">
					{Array.from({ length: itemMax }, (_, i) => (
						// The pips are a fixed, never-reordered row — the slot index
						// *is* the identity, so the index-key rule is a false positive.
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: static pip row.
							key={i}
							className={`vdh-item-pip${i < item ? "" : " vdh-item-pip-empty"}`}
						/>
					))}
				</div>
				{itemKey ? <span className="vdh-item-key">{itemKey}</span> : null}
			</section>

			<section className={`vdh-ult${ultReady ? " vdh-ult-ready" : ""}`}>
				<span className="vdh-ult-label">ULTIMATE</span>
				<div className="vdh-ult-track">
					<div
						className="vdh-ult-fill"
						style={{
							width: `${(ult / ultCap) * 100}%`,
							background: ultReady ? "#b06bff" : "#5a8fd0",
						}}
					/>
				</div>
				{/* The absolute value and its target: the blossom's smaller cap is the
				    whole of "this one charges faster", shown as a number, not a
				    percentage that would hide it. */}
				<span className="vdh-ult-pct">
					{ultReady ? "READY" : `${Math.round(ult)}/${Math.round(ultCap)}`}
				</span>
				{ultKey ? <span className="vdh-ult-key">{ultKey}</span> : null}
			</section>

			{teams && teams.freezeMs > 0 ? <FreezeTime teams={teams} /> : null}

			<div className={`vdh-frame vdh-msg${message ? " vdh-msg-show" : ""}`}>
				{message}
			</div>

			<div className="vdh-hint">hold Tab for scores · Esc for controls</div>
		</div>
	);
}
