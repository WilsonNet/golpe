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
 * The home screen is four sections in strict hierarchy, because seven buttons
 * of equal weight made every choice look like every other choice:
 *
 * - **Start here** — the Tutorial, first on the page. The good moves in this
 *   game are invisible to somebody who has only ever pressed attack, so the
 *   answer to the stranger's real question goes above everything else. It is
 *   deliberately not the gold button: Quick match keeps that, because the
 *   primary *action* of a game is playing it, and the course wears the aim
 *   beam's cyan so it reads as a different door rather than a competing one.
 * - **Play** — starting a fight is the primary job, so it is next: the gold
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
import { lessonsOf, progressOf, tutorialFor } from "../game/campaign";
import { readStoredHero, storeHero } from "../game/heroPref";
import { type Action, bindings, codeLabel } from "../game/input/Bindings";
import type { LaunchParams } from "../game/online/launch";
import { setPendingPassword } from "../game/online/passwordStore";
import { ROOM_ID_RE } from "../game/online/room";
import { MAX_PASSWORD_LENGTH } from "../game/online/types";
import { MAX_NAME, readStoredName, storeName } from "../game/playerName";
import { HERO_IDS, HEROES, type HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";
import { ControlsDialog } from "./ControlsDialog";
import { HUD_CSS } from "./hudStyles";
import { MoveList } from "./MoveList";
import { MENU_CSS } from "./menuStyles";
import { ServerBrowser } from "./ServerBrowser";
import { SoundMixer } from "./SoundMixer";

/** The requested room's defaults, as the server would create them. */
const SCORE_LIMIT_FFA = 21;
const SCORE_LIMIT_TDM = 15;
const TIME_LIMIT_SEC = 300;
const FREEZE_TIME_SEC = 4;

type View = "home" | "host" | "join" | "howto" | "controls" | "moves" | "sound";

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
	/** `?private=true` — an unlisted room, hidden from quick match. */
	isPrivate: boolean;
	/**
	 * `?password=` — the room's password.
	 *
	 * A password implies a private room, exactly like the server does: a
	 * locked room a stranger can discover from a listing is a lock that
	 * advertises itself. The converse is not true — private without a
	 * password is a valid room too, and then the link is the whole invitation.
	 */
	password: string;
	/**
	 * Whether to put `?password=` in the invite link.
	 *
	 * Off by default — the password travels via `sessionStorage` so it never
	 * sits in history or a copied URL. A checked box opts into the old
	 * shareable-link shape for when the host *wants* the link to carry the
	 * key.
	 */
	sharePasswordInLink: boolean;
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
	isPrivate: false,
	password: "",
	sharePasswordInLink: false,
};

/** The empty request — the base every menu choice adds one thing to. */
const NOTHING: LaunchParams = {
	room: null,
	ai: false,
	online: false,
	offline: false,
	training: false,
	tutorial: false,
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
	password: null,
	isPrivate: false,
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
	// True while quick match is asking the server which room is open. The one
	// place the menu is asynchronous: the primary action has to learn the room
	// id before it can write it into the URL.
	const [quickBusy, setQuickBusy] = useState(false);
	// How much of this hero's course is done. Snapshotted into state rather than
	// read off `localStorage` during the render, exactly like the bindings: a
	// compiled component memoises the values a render *reads*, and a store it
	// cannot see would freeze at whatever the first render happened to find.
	// Re-read when the hero changes, because the courses are per-hero — and the
	// menu remounts on the way back from a match, which is when the count moves.
	const [tutorialProgress, setTutorialProgress] = useState(() =>
		progressOf(lessonsOf(tutorialFor(hero)).map((l) => l.id)),
	);
	useEffect(() => {
		setTutorialProgress(
			progressOf(lessonsOf(tutorialFor(hero)).map((l) => l.id)),
		);
	}, [hero]);

	const quickMatch = async () => {
		if (quickBusy) return;
		setQuickBusy(true);
		try {
			const room = await findOpenRoom();
			// An open room is joined by link, exactly as if it had been shared —
			// the URL carries `room=` and the game boots because the URL now
			// names one. With none open, the menu creates a fresh duel against a
			// single bot, which is itself an open room for the next player.
			onLaunch(
				room !== null
					? { ...NOTHING, room, hero }
					: { ...NOTHING, bots: 1, hero },
			);
		} finally {
			setQuickBusy(false);
		}
	};

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
						{/* First on the page, above Play, because it is the answer to the
						    only question a stranger actually has. Everything else on
						    this screen assumes you already know what a butterfly is. */}
						<div className="gd-section">
							<div className="gd-section-head">Start here</div>
							<button
								className="gd-play-item gd-play-item-tutorial"
								type="button"
								onClick={() => onLaunch({ ...NOTHING, tutorial: true, hero })}
							>
								<strong>
									Tutorial — learn {HEROES[hero].name}
									{tutorialProgress.done > 0 ? (
										<span className="gd-badge">
											{tutorialProgress.done}/{tutorialProgress.total}
										</span>
									) : null}
								</strong>
								<span>
									Play every move against a live opponent, one lesson at a time.
									{tutorialProgress.done > 0
										? " Your progress is remembered."
										: ""}
								</span>
							</button>
						</div>

						<div className="gd-section">
							<div className="gd-section-head">Play</div>
							<button
								className="gd-play-item gd-play-item-primary"
								type="button"
								onClick={quickMatch}
							>
								<strong>Quick match</strong>
								<span>
									{quickBusy
										? "Finding an open room…"
										: "Join an open room, or start a duel against a bot — your room link is ready to share."}
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
							<button
								className="gd-play-item"
								type="button"
								onClick={() => setView("sound")}
							>
								<strong>Sound</strong>
								<span>
									Master, music and effects — set the mix before you play.
								</span>
							</button>
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

				{view === "sound" ? (
					<>
						<h2 className="gd-title">Sound</h2>
						<p className="gd-sub">
							Set the mix now — it applies immediately and is remembered.
						</p>
						<SoundMixer />
						<div className="gd-row-actions">
							<button
								className="gd-btn"
								type="button"
								onClick={() => setView("home")}
							>
								Back
							</button>
						</div>
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
	const [showPassword, setShowPassword] = useState(false);

	const set = (patch: Partial<HostSettings>) =>
		setSettings((s) => ({ ...s, ...patch }));

	// A team room has a three-screen floor — wipe-out rounds need ground to give
	// and take. The constraint is enforced here so the form never commits a room
	// that would silently come back wider than it was asked for.
	const minScreens = settings.mode === "tdm" ? 3 : 1;
	const screens = Math.max(minScreens, Math.min(settings.screens, 8));

	const commit = () => {
		const password = settings.password.trim().slice(0, MAX_PASSWORD_LENGTH);
		const isPrivate = settings.isPrivate || password.length > 0;
		// By default the password never appears in the address bar — it is
		// handed off via `sessionStorage` so history and a copied link do not
		// leak it. The checkbox opts into the shareable `?password=` shape.
		const shareInUrl = settings.sharePasswordInLink && password.length > 0;
		if (password.length > 0 && !shareInUrl) setPendingPassword(password);
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
			password: shareInUrl ? password : null,
			isPrivate,
		});
	};

	const isPrivate = settings.isPrivate || settings.password.trim() !== "";

	const summary =
		settings.mode === "tdm"
			? `Team deathmatch · ${screens} screens · first side to ${settings.scoreLimit} rounds · ${settings.timeLimitSec}s of play per round fight, ${settings.freezeTime}s freezetime${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}${isPrivate ? " · private" : ""}${settings.password.trim() !== "" ? " · passworded" : ""}`
			: `Deathmatch · ${screens} ${screens === 1 ? "screen" : "screens"} · first to ${settings.scoreLimit} frags, or best score in ${formatMinutes(settings.timeLimitSec)}${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}${isPrivate ? " · private" : ""}${settings.password.trim() !== "" ? " · passworded" : ""}`;

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

			<div className="gd-field">
				<label className="gd-field-label" htmlFor="gd-private">
					<input
						id="gd-private"
						type="checkbox"
						checked={isPrivate}
						disabled={settings.password.trim() !== ""}
						onChange={(e) => set({ isPrivate: e.target.checked })}
					/>{" "}
					Private room — hidden from quick match
				</label>
				<p className="gd-field-note">
					{settings.password.trim() !== ""
						? "A password implies private, so this stays on while a password is set."
						: "Unlisted: friends can join by link, but strangers will not be sent here."}
				</p>
			</div>
			<div className="gd-field-stack">
				<div className="gd-password-row">
					<label className="gd-field-label" htmlFor="gd-password">
						Password <span className="gd-field-optional">(optional)</span>
					</label>
					<div className="gd-password-wrap">
						<input
							id="gd-password"
							className="gd-input gd-password-input"
							type={showPassword ? "text" : "password"}
							value={settings.password}
							maxLength={MAX_PASSWORD_LENGTH}
							placeholder={
								isPrivate ? "set a password" : "make the room private first"
							}
							autoComplete="new-password"
							spellCheck={false}
							disabled={!isPrivate}
							title={
								isPrivate ? undefined : "Only a private room takes a password"
							}
							onChange={(e) => set({ password: e.target.value })}
						/>
						{settings.password !== "" ? (
							<button
								className="gd-password-toggle"
								type="button"
								aria-pressed={showPassword}
								aria-label={showPassword ? "Hide password" : "Show password"}
								onClick={() => setShowPassword(!showPassword)}
							>
								{showPassword ? "Hide" : "Show"}
							</button>
						) : null}
					</div>
				</div>
				{settings.password.trim() !== "" ? (
					<label className="gd-field-label" htmlFor="gd-share-pw">
						<input
							id="gd-share-pw"
							type="checkbox"
							checked={settings.sharePasswordInLink}
							onChange={(e) => set({ sharePasswordInLink: e.target.checked })}
						/>{" "}
						Include password in invite link
					</label>
				) : null}
				<p className="gd-field-note">
					{settings.password.trim() !== "" ? (
						settings.sharePasswordInLink ? (
							<>
								The link will carry `?password=` — anyone with the link can
								join.
							</>
						) : (
							<>
								Not shown in the link by default — share the password
								separately.
							</>
						)
					) : isPrivate ? (
						<>A passworded room is always private.</>
					) : (
						<>
							Only a private room takes a password — turn on Private room above
							to set one.
						</>
					)}
				</p>
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
 * The join form: one field for a room id or the whole link, plus the
 * server browser — the same `GET /rooms` quick match uses, but for
 * choosing rather than being chosen for.
 *
 * Rooms are addressed, so "joining" is naming the room — a shareable link or
 * its bare id are the same thing, and accepting both is what keeps a player
 * who was handed a URL from having to understand it. The browser is the
 * discoverable complement: what rooms are open, how busy they are, what mode
 * they play, and how far away they feel.
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
				or just type the room id. Or pick an open room below.
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

			<ServerBrowser onJoin={onLaunch} hero={hero} />
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

/**
 * The id of a room quick match should join, or null when there is none open.
 *
 * Asked of the game server on :9208 — the same address the status line checks,
 * so the answer and the health read agree about what is running. "Open" is the
 * server's own `GameRoom.isOpen`: a room with a human in it and a free seat
 * that is not a probe, not a practice session and not mid-ceremony. The list
 * is sorted busiest-first, because joining a fight already going beats joining
 * an empty arena. A failure to ask (server down, or a fetch that hangs) falls
 * back to null and the menu creates a fresh room, which is the safe answer:
 * a bot duel needs the same server anyway, and the status line says so.
 */
async function findOpenRoom(): Promise<string | null> {
	try {
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 2500);
		const res = await fetch(`http://${window.location.hostname}:9208/rooms`, {
			signal: ctrl.signal,
		});
		window.clearTimeout(timer);
		if (!res.ok) return null;
		const data = (await res.json()) as { rooms?: { id?: string }[] | null };
		return data.rooms?.find((r) => typeof r?.id === "string")?.id ?? null;
	} catch {
		return null;
	}
}
