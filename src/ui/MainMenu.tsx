/**
 * The root menu: the page a stranger lands on.
 *
 * The game's options are a query string — precise, scriptable, and invisible to
 * anybody who has not read the docs. This menu is the discoverable face of the
 * same language: every button here *is* a URL, written with the same parser the
 * match reads at boot (`online/launch.ts`), so a commit cannot silently
 * configure something the game will not honour. What the address bar says after
 * a commit is exactly the link that would boot that match if it were shared.
 *
 * The home screen is three sections in strict hierarchy, because seven buttons
 * of equal weight made every choice look like every other choice:
 *
 * - **Play** — starting a fight is the primary job, so it is first: the gold
 *   Quick match, then Host/Join as siblings, then Practice.
 * - **Your fighter** — who you bring. The hero picker lives here, on the home
 *   screen, beside the name field: a hero shooter should show its heroes, and
 *   the choice rides every match started here.
 * - **Learn & settings** — the detours: How to play full-width (the primary
 *   "how do I play" answer), then Move list and Options as siblings. The move
 *   list is a top-level destination, not a chapter of How to play — it answers
 *   "what does my fighter do" for the hero picked above, and it is a
 *   full-screen feature (live preview, stats) that would drown a reference
 *   page. The Esc menu's Moves item is the same module.
 *
 * The rules underneath stay the ones the whole screen is built on:
 *
 * - **The primary action is one click from the bare URL.** "Quick match" drops
 *   a stranger into a fight against a bot; everything else is a detour.
 * - **Hosting and joining are siblings, not parent and child.** They answer
 *   different questions ("set up a match" vs "enter a room that exists"), and
 *   one does not come before the other in any order that makes sense.
 * - **Options that exist for measuring stay behind a disclosure.** Arena size,
 *   score limits and ult charge are the language of probes; a host who wants
 *   them finds them, a player who does not never trips over them.
 *
 * Query parameters remain the authority. Any URL with a launch key boots
 * straight into the match it asks for, menu or no menu — which is how every
 * probe runs and how shared links behave.
 */

import { useEffect, useState } from "react";
import { readStoredHero, storeHero } from "../game/heroPref";
import { type Action, bindings, codeLabel } from "../game/input/Bindings";
import type { LaunchParams } from "../game/online/launch";
import { ROOM_ID_RE } from "../game/online/room";
import { MAX_NAME, readStoredName, storeName } from "../game/playerName";
import { HERO_IDS, HEROES, type HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";
import { ControlsDialog } from "./ControlsDialog";
import { HUD_CSS } from "./hudStyles";
import { MoveList } from "./MoveList";
import { MENU_CSS } from "./menuStyles";

/** The requested room's defaults, as the server would create them. */
const SCORE_LIMIT_FFA = 21;
const SCORE_LIMIT_TDM = 15;
const TIME_LIMIT_SEC = 300;
const FREEZE_TIME_SEC = 4;

type View = "home" | "host" | "join" | "howto" | "controls" | "moves";

interface HostSettings {
	mode: MatchMode;
	/** Arena width in 800px screens. A team room floors this at 3. */
	screens: number;
	/** Opponents to seat. */
	bots: number;
	/** Keep the room topped up to N fighters, bots as ballast. 0 = off. */
	fill: number;
	scoreLimit: number;
	timeLimitSec: number;
	/** A team round's countdown, seconds. Only sent in a team match. */
	freezeTime: number;
	/** Ultimate charge every fighter starts with, 0..100. 0 = off. */
	ultCharge: number;
}

const DEFAULT_SETTINGS: HostSettings = {
	mode: "ffa",
	screens: 1,
	bots: 0,
	fill: 0,
	scoreLimit: SCORE_LIMIT_FFA,
	timeLimitSec: TIME_LIMIT_SEC,
	freezeTime: FREEZE_TIME_SEC,
	ultCharge: 0,
};

/** The empty request — the base every menu choice adds one thing to. */
const NOTHING: LaunchParams = {
	room: null,
	ai: false,
	online: false,
	offline: false,
	training: false,
	hero: null,
	botHero: null,
	bots: undefined,
	fill: undefined,
	scoreLimit: undefined,
	timeLimitSec: undefined,
	ultCharge: undefined,
	mode: null,
	freezeTime: undefined,
	screens: undefined,
};

export function MainMenu({
	onLaunch,
}: {
	/** Commit a launch request: write the URL, then boot the match. */
	onLaunch: (params: LaunchParams) => void;
}) {
	const [view, setView] = useState<View>("home");
	const [name, setName] = useState(() => readStoredName() ?? "");
	// Who this player defaults to. The hero select writes it to localStorage
	// *and* into every launch request, so a commit and a preference agree.
	const [hero, setHero] = useState<HeroId>(() => readStoredHero());

	// Esc steps back through the menu; on the home view it does nothing. There
	// is no game under this screen, so there is nothing else for it to mean.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Escape") return;
			setView((v) => (v === "home" ? v : "home"));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="gd-menu-page">
			<style>{HUD_CSS}</style>
			<style>{MENU_CSS}</style>
			<div className="gd-card">
				<h1 className="gd-title">golpe</h1>
				<p className="gd-sub">
					A 2D swordfight, online first — the link is the invitation.
				</p>

				{view === "home" ? (
					<>
						<div className="gd-section">
							<div className="gd-section-head">Play</div>
							<button
								className="gd-play-item gd-play-item-primary"
								type="button"
								onClick={() => onLaunch({ ...NOTHING, bots: 1, hero })}
							>
								<strong>Quick match</strong>
								<span>
									Duel a server bot right now — your room link is ready to
									share.
								</span>
							</button>
							<div className="gd-two">
								<button
									className="gd-play-item"
									type="button"
									onClick={() => setView("host")}
								>
									<strong>Host a match</strong>
									<span>
										Choose the mode, arena and rules, then share the link.
									</span>
								</button>
								<button
									className="gd-play-item"
									type="button"
									onClick={() => setView("join")}
								>
									<strong>Join a match</strong>
									<span>Enter a room id or a link someone sent you.</span>
								</button>
							</div>
							<button
								className="gd-play-item"
								type="button"
								onClick={() => onLaunch({ ...NOTHING, training: true, hero })}
							>
								<strong>Practice</strong>
								<span>The training room: a scriptable dummy and its menu.</span>
							</button>
						</div>

						<div className="gd-section">
							<div className="gd-section-head">Your fighter</div>
							<div className="gd-hero-pick">
								{HERO_IDS.map((id) => (
									<button
										key={id}
										type="button"
										className={`gd-hero-chip${hero === id ? " gd-hero-chip-on" : ""}`}
										aria-pressed={hero === id}
										onClick={() => {
											setHero(id);
											storeHero(id);
										}}
									>
										<span
											className={`hp-sprite hp-sprite-${id}`}
											aria-hidden="true"
										/>
										<span className="gd-hero-chip-meta">
											<span className="gd-hero-chip-name">
												{HEROES[id].name}
											</span>
											<span className="gd-hero-chip-kit">
												{HEROES[id].melee.label} · {HEROES[id].ranged.label}
											</span>
										</span>
									</button>
								))}
							</div>
							<div className="gd-name-row">
								<label htmlFor="gd-name">Fighter name</label>
								<input
									id="gd-name"
									className="gd-input"
									value={name}
									maxLength={MAX_NAME}
									placeholder="your name"
									autoComplete="off"
									spellCheck={false}
									onChange={(e) => {
										setName(e.target.value);
										storeName(e.target.value.trim().slice(0, MAX_NAME));
									}}
								/>
							</div>
							<p className="gd-hero-blurb">{HEROES[hero].blurb}</p>
						</div>

						<div className="gd-section">
							<div className="gd-section-head">Learn &amp; settings</div>
							<button
								className="gd-play-item"
								type="button"
								onClick={() => setView("howto")}
							>
								<strong>How to play</strong>
								<span>Movement, the sword chain, and the ultimate.</span>
							</button>
							<div className="gd-two">
								<button
									className="gd-play-item"
									type="button"
									onClick={() => setView("moves")}
								>
									<strong>Move list</strong>
									<span>
										Every command for {HEROES[hero].name} — stats and a live
										preview.
									</span>
								</button>
								<button
									className="gd-play-item"
									type="button"
									onClick={() => setView("controls")}
								>
									<strong>Options</strong>
									<span>Aiming scheme, on-screen gamepad, rebinding.</span>
								</button>
							</div>
						</div>
					</>
				) : null}

				{view === "host" ? (
					<HostForm
						onLaunch={onLaunch}
						onBack={() => setView("home")}
						hero={hero}
					/>
				) : null}

				{view === "join" ? (
					<JoinForm
						onLaunch={onLaunch}
						onBack={() => setView("home")}
						hero={hero}
					/>
				) : null}

				{view === "howto" ? <HowToPlay onBack={() => setView("home")} /> : null}

				{view === "controls" ? (
					<>
						<h2 className="gd-title">Options</h2>
						<ControlsDialog onClose={() => setView("home")} />
					</>
				) : null}

				<ServerStatus />
			</div>
			{view === "moves" ? (
				<MoveList hero={hero} onClose={() => setView("home")} />
			) : null}
		</div>
	);
}

/**
 * The host form: every choice a room's creator can make, defaults first.
 *
 * The summary line beneath the fields is the contract: it says, in one line,
 * the match the button is about to create — so a host sees the gulf between
 * "what I asked for" and "what the server will make" (a team room's three-screen
 * floor, for example) before committing rather than after.
 */
function HostForm({
	onLaunch,
	onBack,
	hero,
}: {
	onLaunch: (params: LaunchParams) => void;
	onBack: () => void;
	hero: HeroId;
}) {
	const [settings, setSettings] = useState(DEFAULT_SETTINGS);
	const [showAdvanced, setShowAdvanced] = useState(false);

	const set = (patch: Partial<HostSettings>) =>
		setSettings((s) => ({ ...s, ...patch }));

	// A team room has a three-screen floor — wipe-out rounds need ground to give
	// and take. The constraint is enforced here so the form never commits a room
	// that would silently come back wider than it was asked for.
	const minScreens = settings.mode === "tdm" ? 3 : 1;
	const screens = Math.max(minScreens, Math.min(settings.screens, 8));

	const commit = () => {
		onLaunch({
			...NOTHING,
			hero,
			mode: settings.mode,
			screens,
			bots: settings.bots,
			fill: settings.fill > 0 ? settings.fill : undefined,
			scoreLimit: settings.scoreLimit,
			timeLimitSec: settings.timeLimitSec,
			freezeTime: settings.mode === "tdm" ? settings.freezeTime : undefined,
			ultCharge: settings.ultCharge > 0 ? settings.ultCharge : undefined,
		});
	};

	const summary =
		settings.mode === "tdm"
			? `Team deathmatch · ${screens} screens · first side to ${settings.scoreLimit} rounds · ${settings.timeLimitSec}s of play per round fight, ${settings.freezeTime}s freezetime${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}`
			: `Deathmatch · ${screens} ${screens === 1 ? "screen" : "screens"} · first to ${settings.scoreLimit} frags, or best score in ${formatMinutes(settings.timeLimitSec)}${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}`;

	return (
		<>
			<h2 className="gd-title">Host a match</h2>

			<div className="gd-field">
				<span className="gd-field-label">Mode</span>
				<div className="gd-choice">
					<button
						type="button"
						className={`gd-chip${settings.mode === "ffa" ? " gd-chip-on" : ""}`}
						onClick={() => {
							set({ mode: "ffa", scoreLimit: SCORE_LIMIT_FFA });
						}}
					>
						Deathmatch
					</button>
					<button
						type="button"
						className={`gd-chip${settings.mode === "tdm" ? " gd-chip-on" : ""}`}
						onClick={() => {
							set({
								mode: "tdm",
								scoreLimit: SCORE_LIMIT_TDM,
								screens: Math.max(3, settings.screens),
							});
						}}
					>
						Team deathmatch
					</button>
				</div>
			</div>
			<p className="gd-field-note">
				{settings.mode === "tdm"
					? "Two sides, no friendly fire, wipe-out rounds. A team room always plays on at least three screens."
					: "Everyone for themselves. First to 21 frags or the best score in five minutes."}
			</p>

			<div className="gd-field">
				<span className="gd-field-label">
					Arena width {settings.mode === "tdm" ? "(min 3 for teams)" : ""}
				</span>
				<input
					type="number"
					min={minScreens}
					max={8}
					value={screens}
					onChange={(e) => {
						const n = Number.parseInt(e.target.value, 10);
						set({ screens: Number.isFinite(n) ? n : minScreens });
					}}
				/>
			</div>
			<div className="gd-field">
				<span className="gd-field-label">Bots to fight</span>
				<input
					type="number"
					min={0}
					max={15}
					value={settings.bots}
					onChange={(e) => {
						const n = Number.parseInt(e.target.value, 10);
						set({ bots: Number.isFinite(n) ? Math.max(0, n) : 0 });
					}}
				/>
			</div>
			<div className="gd-field">
				<span className="gd-field-label">
					{settings.mode === "tdm" ? "Rounds to win" : "Frags to win"}
				</span>
				<input
					type="number"
					min={1}
					max={999}
					value={settings.scoreLimit}
					onChange={(e) => {
						const n = Number.parseInt(e.target.value, 10);
						set({ scoreLimit: Number.isFinite(n) ? Math.max(1, n) : 1 });
					}}
				/>
			</div>
			<div className="gd-field">
				<span className="gd-field-label">Match length (minutes)</span>
				<input
					type="number"
					min={1}
					max={60}
					value={Math.round(settings.timeLimitSec / 60)}
					onChange={(e) => {
						const n = Number.parseInt(e.target.value, 10);
						set({
							timeLimitSec: Number.isFinite(n) ? Math.max(1, n) * 60 : 60,
						});
					}}
				/>
			</div>

			<div className="gd-advanced">
				<button
					className="gd-advanced-toggle"
					type="button"
					onClick={() => setShowAdvanced(!showAdvanced)}
				>
					{showAdvanced ? "▾ Advanced" : "▸ Advanced"} — for practice and probes
				</button>
				{showAdvanced ? (
					<>
						<div className="gd-field">
							<span className="gd-field-label">
								Keep room filled to (0 = off)
							</span>
							<input
								type="number"
								min={0}
								max={16}
								value={settings.fill}
								onChange={(e) => {
									const n = Number.parseInt(e.target.value, 10);
									set({
										fill: Number.isFinite(n) ? Math.max(0, n) : 0,
									});
								}}
							/>
						</div>
						{settings.mode === "tdm" ? (
							<div className="gd-field">
								<span className="gd-field-label">Freezetime (seconds)</span>
								<input
									type="number"
									min={0}
									max={60}
									value={settings.freezeTime}
									onChange={(e) => {
										const n = Number.parseInt(e.target.value, 10);
										set({
											freezeTime: Number.isFinite(n) ? Math.max(0, n) : 0,
										});
									}}
								/>
							</div>
						) : null}
						<div className="gd-field">
							<span className="gd-field-label">
								Ultimate charge floor (0–100)
							</span>
							<input
								type="number"
								min={0}
								max={100}
								value={settings.ultCharge}
								onChange={(e) => {
									const n = Number.parseInt(e.target.value, 10);
									set({
										ultCharge: Number.isFinite(n)
											? Math.max(0, Math.min(100, n))
											: 0,
									});
								}}
							/>
						</div>
					</>
				) : null}
			</div>

			<p className="gd-summary">{summary}</p>

			<div className="gd-row-actions">
				<button
					className="gd-btn gd-btn-primary"
					type="button"
					onClick={commit}
				>
					Create match
				</button>
				<button className="gd-btn" type="button" onClick={onBack}>
					Back
				</button>
			</div>
		</>
	);
}

/**
 * The join form: one field for a room id or the whole link.
 *
 * Rooms are addressed, so "joining" is naming the room — a shareable link or
 * its bare id are the same thing, and accepting both is what keeps a player
 * who was handed a URL from having to understand it.
 */
function JoinForm({
	onLaunch,
	onBack,
	hero,
}: {
	onLaunch: (params: LaunchParams) => void;
	onBack: () => void;
	hero: HeroId;
}) {
	const [value, setValue] = useState("");
	const [error, setError] = useState("");

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const id = roomIdFromInput(value);
		if (id === null || !ROOM_ID_RE.test(id)) {
			setError(
				"Room ids are letters, numbers, dashes and underscores. Paste the full link if you have it.",
			);
			return;
		}
		onLaunch({ ...NOTHING, room: id, hero });
	};

	return (
		<>
			<h2 className="gd-title">Join a match</h2>
			<p className="gd-join-hint">
				A host's link looks like{" "}
				<span className="gd-join-example">…/?room=abc-123</span>. Paste it here,
				or just type the room id.
			</p>
			<form onSubmit={submit}>
				<input
					className="gd-input"
					value={value}
					placeholder="room id or link"
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
					<button className="gd-btn" type="button" onClick={onBack}>
						Back
					</button>
				</div>
				<div className="gd-error">{error}</div>
			</form>
		</>
	);
}

/**
 * The controls reference.
 *
 * Rows are grouped into three named sections — getting around, fighting, the
 * match — because an ungrouped wall of key rows reads as clutter. Every row is
 * one sentence at most, and the advanced tactics (the butterfly, the massive's
 * frame data, the parry window's numbers) live in the Move list, whose full
 * cards exist for each: this page is for what a stranger needs before the
 * first fight, not for the whole manual.
 *
 * The rows read the *live* bindings, so a player who has rebound something sees
 * their own layout, not the manual's — a hint that lies about the button is
 * worse than no hint, and this one is the same store the game plays by.
 */
function HowToPlay({ onBack }: { onBack: () => void }) {
	// A snapshot of the live bindings, kept as state for the same reason the
	// controls dialog does: the rows read what a player has actually rebound,
	// and a render that read the store straight off would freeze them under the
	// React Compiler, whose memoisation only sees values the render reads.
	const [map, setMap] = useState(() => bindings.snapshot());
	useEffect(() => bindings.subscribe(() => setMap(bindings.snapshot())), []);

	const key = (action: Action) => {
		const code = map[action][0];
		return code ? codeLabel(code) : "—";
	};

	return (
		<>
			<h2 className="gd-title">How to play</h2>

			<div className="gd-section">
				<div className="gd-section-head">Getting around</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("left")}</span>
					<span className="gd-key">{key("right")}</span>
					<span>
						Walk. Double-tap a direction to dash — a flat line that carries
						across gaps and holds even in the air. In gun stance the same
						gesture is a tumble.
					</span>
				</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("jump")}</span>
					<span>
						Jump, and again in the air for a double jump — it refills on
						landing. Jump off a wall to climb it.
					</span>
				</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("sword")}</span>
					<span className="gd-key">{key("gun")}</span>
					<span>
						Stance — which weapon is in your hand. Sword is the default.
					</span>
				</div>
			</div>

			<div className="gd-section">
				<div className="gd-section-head">Fighting</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("attack")}</span>
					<span>
						Slash — or the gun's trigger, in gun stance. Tap again as each hit
						lands for the three-hit chain; the finisher knocks down.
					</span>
				</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("block")}</span>
					<span>
						Block. A fresh block parries a sword swing for 140ms and
						guard-breaks the attacker — but only on the side you face.
					</span>
				</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("uppercut")}</span>
					<span>Uppercut — unblockable, launches the target.</span>
				</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("item")}</span>
					<span>Item — your hero's throwable; uses are per life.</span>
				</div>
			</div>

			<div className="gd-section">
				<div className="gd-section-head">The match</div>
				<div className="gd-how-row">
					<span className="gd-key">{key("ultimate")}</span>
					<span>Ultimate — hold to aim, release to cast.</span>
				</div>
				<div className="gd-how-row">
					<span className="gd-key">Tab</span>
					<span className="gd-key">Esc</span>
					<span>Scoreboard · menu — hero, moves, controls and the room.</span>
				</div>
			</div>

			<p className="gd-how-note">
				For the detail — the butterfly, the Massive Strike's window, the parry's
				frame data — open the <strong>Move list</strong> back on the home
				screen. Every card has stats and a live preview.
			</p>

			<div className="gd-how-actions">
				<button className="gd-btn" type="button" onClick={onBack}>
					Back
				</button>
			</div>
		</>
	);
}

/**
 * Whether the game server on :9208 answers.
 *
 * The one failure a new player can do nothing about is a game that loads with
 * no server behind it — every mode except the offline escape hatch needs it, so
 * the menu says so up front instead of letting the match sit on "Connecting…".
 * Polled gently; it is a LAN game, and a server can appear while the menu is
 * open.
 */
function ServerStatus() {
	const [status, setStatus] = useState<"checking" | "online" | "offline">(
		"checking",
	);

	useEffect(() => {
		let cancelled = false;
		const check = async () => {
			try {
				const ctrl = new AbortController();
				const timer = window.setTimeout(() => ctrl.abort(), 2500);
				// The game server binds every interface on 9208, so the address a
				// player loaded the page from is the address its traffic uses too —
				// exactly like the game client, which is why the same expression
				// works here.
				const res = await fetch(
					`http://${window.location.hostname}:9208/health`,
					{ signal: ctrl.signal },
				);
				window.clearTimeout(timer);
				if (!cancelled) setStatus(res.ok ? "online" : "offline");
			} catch {
				if (!cancelled) setStatus("offline");
			}
		};
		check();
		const id = window.setInterval(check, 5000);
		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
	}, []);

	return (
		<div className="gd-server">
			<span
				className={`gd-dot gd-dot-${status === "checking" ? "wait" : status === "online" ? "on" : "off"}`}
			/>
			<span>
				{status === "checking"
					? "Checking the game server…"
					: status === "online"
						? "Game server online"
						: "Game server offline — matches can't start until it is."}
			</span>
			<span className="gd-room">rooms are shared by link</span>
		</div>
	);
}

/** The room id a join input means, or null when it has nothing to offer. */
function roomIdFromInput(raw: string): string | null {
	const text = raw.trim();
	if (text === "") return null;
	try {
		// A full link: the room is the `room` parameter. Anything else — including
		// a link without one — is not a joinable id.
		const url = new URL(text, window.location.href);
		const room = url.searchParams.get("room");
		if (room !== null) return room;
	} catch {
		// Not a URL at all — treat it as a bare id.
	}
	return text;
}

/** 300 → "5 minutes". */
function formatMinutes(sec: number): string {
	const m = Math.round(sec / 60);
	return `${m} ${m === 1 ? "minute" : "minutes"}`;
}
