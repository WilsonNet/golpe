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
 * The home screen is **two columns, one decision each**, because eleven buttons
 * of equal weight made every choice look like every other choice — Hick's law
 * applied literally: fewer things to weigh, and nothing sharing a row.
 *
 * - **Play (left)** — Quick match (gold, the primary action), then Host, Join
 *   and the Map maker as quiet entries. Starting a fight is the job.
 * - **Your fighter (right)** — the name field, then the hero picker, the
 *   selected hero's blurb, and **Play <hero> Tutorial**: the course teaches
 *   this kit, so it belongs under the choice of kit rather than in a generic
 *   menu. Most players never need it; the one who does finds it where the
 *   choice is.
 * - **More** — a disclosure holding the rest: Practice, How to play, the Move
 *   list, Options, Graphics and Sound. Secondary by design: progressive
 *   disclosure is what keeps one short list from becoming a catalogue.
 * - **The first-time card** — one dialog, once per browser, offering the
 *   tutorial to a player with no lesson finished. The course is the card's
 *   biggest target because the player who needs it will not go looking; Skip
 *   is one click beneath it. Answering the card is remembered in
 *   `localStorage` (never the wire), so it cannot become a nag.
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
import { LIBRARY } from "../game/maps/library";
import type { LaunchParams } from "../game/online/launch";
import { setPendingPassword } from "../game/online/passwordStore";
import { httpBaseFor, resolveGameEndpoint } from "../game/online/regions";
import { ROOM_ID_RE } from "../game/online/room";
import { MAX_PASSWORD_LENGTH } from "../game/online/types";
import { MAX_NAME, readStoredName, storeName } from "../game/playerName";
import { HERO_IDS, HEROES, type HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";
import { mapScreens } from "../game/simulation/Tilemap";
import {
	dismissTutorialPromptForever,
	tutorialPromptDismissed,
} from "../game/tutorialPrompt";
import { CP_SCREENS } from "../tweakables/control";
import { ULT_MAX_CAP } from "../tweakables/ultimate";
import { ControlsDialog } from "./ControlsDialog";
import { GraphicsSettings } from "./GraphicsSettings";
import { HUD_CSS } from "./hudStyles";
import { MoveList } from "./MoveList";
import { MENU_CSS } from "./menuStyles";
import { RepoLink } from "./RepoLink";
import { ServerBrowser } from "./ServerBrowser";
import { SoundMixer } from "./SoundMixer";

/** The requested room's defaults, as the server would create them. */
const SCORE_LIMIT_FFA = 21;
const SCORE_LIMIT_TDM = 15;
/** Full-line captures to win a control match. */
const SCORE_LIMIT_CP = 3;
const TIME_LIMIT_SEC = 300;
const FREEZE_TIME_SEC = 4;

type View =
	| "home"
	| "host"
	| "join"
	| "howto"
	| "controls"
	| "graphics"
	| "moves"
	| "sound";

interface HostSettings {
	mode: MatchMode;
	/** Arena width in 800px screens. A team room floors this at 3. */
	screens: number;
	/** A library map's id (`maps/<id>/`), or null for the classic arena. */
	map: string | null;
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
	map: null,
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
	server: null,
	region: null,
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
	capTime: undefined,
	screens: undefined,
	map: null,
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
	// The home page's one disclosure. Closed by default: the front page is a
	// short list of ways to *play*, and everything else is a detour a player
	// asks for rather than reads past.
	const [showMore, setShowMore] = useState(false);
	// How much of this hero's course is done. Snapshotted into state rather than
	// read off `localStorage` during the render, exactly like the bindings: a
	// compiled component memoises the values a render *reads*, and a store it
	// cannot see would freeze at whatever the first render happened to find.
	// Re-read when the hero changes, because the courses are per-hero — and the
	// menu remounts on the way back from a match, which is when the count moves.
	const [tutorialProgress, setTutorialProgress] = useState(() =>
		progressOf(lessonsOf(tutorialFor(hero)).map((l) => l.id)),
	);
	// The first-time card: offered once, to a browser that has not answered it
	// and has no lesson finished. Skipping it lasts the session; *Don't show
	// this again* and *Play the tutorial* are both remembered. The course is
	// the large target — the player who needs it is the one who would not look
	// for it — and Skip waits one click beneath.
	const [promptOpen, setPromptOpen] = useState(
		() => !tutorialPromptDismissed() && tutorialProgress.done === 0,
	);
	useEffect(() => {
		setTutorialProgress(
			progressOf(lessonsOf(tutorialFor(hero)).map((l) => l.id)),
		);
	}, [hero]);

	const startTutorial = () => {
		// Accepting the offer answers it: the card has introduced the course,
		// and *More* keeps it reachable for the rest of this browser's life.
		dismissTutorialPromptForever();
		onLaunch({ ...NOTHING, tutorial: true, hero });
	};

	const answerPromptForever = () => {
		dismissTutorialPromptForever();
		setPromptOpen(false);
	};

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

	// Esc closes the first-time card first, then steps back through the menu;
	// on the home view with no card it does nothing. There is no game under this
	// screen, so there is nothing else for it to mean.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Escape") return;
			if (promptOpen) {
				setPromptOpen(false);
				return;
			}
			setView((v) => (v === "home" ? v : "home"));
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [promptOpen]);

	return (
		<div className="gd-menu-page">
			<style>{HUD_CSS}</style>
			<style>{MENU_CSS}</style>
			<div className={`gd-card${view === "home" ? " gd-card-home" : ""}`}>
				<div className="gd-menu-head">
					<div>
						<h1 className="gd-title">golpe</h1>
						<p className="gd-sub">
							A 2D swordfight, online first — the link is the invitation.
						</p>
					</div>
					<RepoLink />
				</div>

				{view === "home" ? (
					// Two columns, and each one is a column: starting a fight on the
					// left, who you are on the right. Every action inside a column is
					// full-width and stacked, so nothing reads as an equal-weight pair
					// — the overload this screen used to have. See `.gd-home` in
					// menuStyles.
					<div className="gd-home">
						<div className="gd-home-main">
							<button
								className="gd-play-item gd-play-item-primary"
								type="button"
								onClick={quickMatch}
							>
								<strong>Quick match</strong>
								<span>
									{quickBusy
										? "Finding an open room…"
										: "Join an open room, or start a duel against a bot."}
								</span>
							</button>

							<button
								className="gd-play-item gd-play-item-compact"
								type="button"
								onClick={() => setView("host")}
							>
								<strong>Host a match</strong>
								<span>Mode, arena and rules — then share the link.</span>
							</button>
							<button
								className="gd-play-item gd-play-item-compact"
								type="button"
								onClick={() => setView("join")}
							>
								<strong>Join a match</strong>
								<span>A room id, or a link someone sent you.</span>
							</button>
							{/* Building an arena is still play, so the map maker stays on
							    the front page rather than in the disclosure. It is a link,
							    not a launch: the editor is its own page. */}
							<a
								className="gd-play-item gd-play-item-compact"
								href="?mapmaker=true"
								data-testid="menu-mapmaker"
							>
								<strong>Map maker</strong>
								<span>Build an arena and send it as a pull request.</span>
							</a>
						</div>

						{/* Who you are: the name first, then the fighter. Naming comes
						    before picking because the name is the one field a returning
						    player edits, and a hero shooter should show its heroes —
						    four chips, one choice, above the fold. */}
						<div className="gd-home-fighter">
							<div className="gd-section">
								<div className="gd-section-head">Your fighter</div>
								<div className="gd-name-row">
									<label htmlFor="gd-name">Name</label>
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
											</span>
										</button>
									))}
								</div>
								<p className="gd-hero-blurb">{HEROES[hero].blurb}</p>
								{/* The course belongs to the fighter, not to a generic
								    menu: it teaches *this* kit, so it sits under the
								    picker and names the hero. Most players never need
								    it; the one who does finds it where the choice is. */}
								<button
									className="gd-play-item gd-play-item-tutorial gd-play-item-compact"
									type="button"
									onClick={() => onLaunch({ ...NOTHING, tutorial: true, hero })}
								>
									<strong>
										Play {HEROES[hero].name} Tutorial
										{tutorialProgress.done > 0 ? (
											<span className="gd-badge">
												{tutorialProgress.done}/{tutorialProgress.total}
											</span>
										) : null}
									</strong>
									<span>
										One lesson at a time, against a live opponent.
									</span>
								</button>
							</div>
						</div>

						{/* The disclosure is the page's, not the play column's: it spans
						    both columns beside each other, so opening it never leaves
						    one column long and the other one blank. Its label names
						    what is inside — practice and settings are one click away
						    and never in a newcomer's way. */}
						<div className="gd-more">
							<button
								className="gd-more-toggle"
								type="button"
								aria-expanded={showMore}
								onClick={() => setShowMore(!showMore)}
							>
								{showMore ? "▾" : "▸"} More — practice and settings
							</button>
							{showMore ? (
								<div className="gd-more-body">
									<div className="gd-section">
										<div className="gd-section-head">More ways to play</div>
										<button
											className="gd-play-item gd-play-item-compact"
											type="button"
											onClick={() =>
												onLaunch({ ...NOTHING, training: true, hero })
											}
										>
											<strong>Practice</strong>
											<span>A scriptable dummy and its menu.</span>
										</button>
									</div>

									<div className="gd-section">
										<div className="gd-section-head">Learn</div>
										<button
											className="gd-play-item gd-play-item-compact"
											type="button"
											onClick={() => setView("howto")}
										>
											<strong>How to play</strong>
											<span>Movement, the sword chain, and the ultimate.</span>
										</button>
										<button
											className="gd-play-item gd-play-item-compact"
											type="button"
											onClick={() => setView("moves")}
										>
											<strong>Move list</strong>
											<span>
												Every command for {HEROES[hero].name} — stats and a
												live preview.
											</span>
										</button>
									</div>

									<div className="gd-section">
										<div className="gd-section-head">Settings</div>
										<button
											className="gd-play-item gd-play-item-compact"
											type="button"
											onClick={() => setView("controls")}
										>
											<strong>Options</strong>
											<span>Aiming scheme, gamepad, rebinding.</span>
										</button>
										<button
											className="gd-play-item gd-play-item-compact"
											type="button"
											onClick={() => setView("graphics")}
										>
											<strong>Graphics</strong>
											<span>Skybox on or off — the low-distraction setting.</span>
										</button>
										<button
											className="gd-play-item gd-play-item-compact"
											type="button"
											onClick={() => setView("sound")}
										>
											<strong>Sound</strong>
											<span>Master, music and effects.</span>
										</button>
									</div>
								</div>
							) : null}
						</div>
					</div>
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

				{view === "graphics" ? (
					<>
						<h2 className="gd-title">Graphics</h2>
						<p className="gd-sub">
							Visual comfort. Sky and platform choices apply immediately in a
							match.
						</p>
						<GraphicsSettings onClose={() => setView("home")} />
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

			{view === "home" && promptOpen ? (
				// The one interruption the menu allows itself, and only ever once
				// per browser. A dialog because it is a question, not a section:
				// it is about this player, and the menu behind it is what they
				// came for. The course is the biggest thing in it — the player
				// who needs it would never go looking — and Skip waits below.
				<div
					className="gd-prompt-backdrop"
					role="presentation"
					onClick={(e) => {
						if (e.target === e.currentTarget) setPromptOpen(false);
					}}
				>
					<div
						className="gd-prompt"
						role="dialog"
						aria-modal="true"
						aria-labelledby="gd-prompt-title"
					>
						<h2 className="gd-prompt-title" id="gd-prompt-title">
							First time?
						</h2>
						<p className="gd-prompt-body">
							Learn the moves that aren't on the buttons.
						</p>
						<div className="gd-prompt-actions">
							{/* The course is the biggest thing in the card: the player
							    who needs it is the one who would never go looking for
							    it. Skipping stays one click and one line below. */}
							<button
								className="gd-play-item gd-play-item-tutorial gd-prompt-play"
								type="button"
								autoFocus
								onClick={startTutorial}
							>
								<strong>Play {HEROES[hero].name} Tutorial</strong>
							</button>
							<button
								className="gd-btn gd-prompt-skip"
								type="button"
								onClick={() => setPromptOpen(false)}
							>
								Skip for now
							</button>
						</div>
						<button
							className="gd-prompt-never"
							type="button"
							onClick={answerPromptForever}
						>
							Don't show this again
						</button>
					</div>
				</div>
			) : null}

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
	// that would silently come back wider than it was asked for. A control room
	// is not a width at all: five screens, one point per screen, is the map.
	const isControl = settings.mode === "5cp";
	const minScreens = settings.mode === "tdm" ? 3 : 1;
	// A library map is its own width; one too narrow for teams cannot be
	// widened, so picking team deathmatch drops it back to the classic arena.
	const libraryMap = isControl
		? null
		: (LIBRARY.find(
				(m) =>
					m.id === settings.map &&
					(settings.mode !== "tdm" || mapScreens(m.spec) >= minScreens),
			) ?? null);
	const screens = isControl
		? CP_SCREENS
		: libraryMap
			? mapScreens(libraryMap.spec)
			: Math.max(minScreens, Math.min(settings.screens, 8));

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
			screens: libraryMap ? undefined : screens,
			map: libraryMap?.id ?? null,
			bots: settings.bots,
			fill: settings.fill > 0 ? settings.fill : undefined,
			scoreLimit: settings.scoreLimit,
			timeLimitSec: settings.timeLimitSec,
			freezeTime: settings.mode === "ffa" ? undefined : settings.freezeTime,
			ultCharge: settings.ultCharge > 0 ? settings.ultCharge : undefined,
			password: shareInUrl ? password : null,
			isPrivate,
		});
	};

	const isPrivate = settings.isPrivate || settings.password.trim() !== "";

	const summary = isControl
		? `5 control points · first side to ${settings.scoreLimit} captures · ${formatMinutes(settings.timeLimitSec)}${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}${isPrivate ? " · private" : ""}${settings.password.trim() !== "" ? " · passworded" : ""}`
		: settings.mode === "tdm"
			? `Team deathmatch · ${screens} screens · first side to ${settings.scoreLimit} rounds · ${settings.timeLimitSec}s of play per round fight, ${settings.freezeTime}s freezetime${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}${isPrivate ? " · private" : ""}${settings.password.trim() !== "" ? " · passworded" : ""}`
			: `Deathmatch · ${libraryMap ? `${libraryMap.spec.meta?.name} · ` : ""}${screens} ${screens === 1 ? "screen" : "screens"} · first to ${settings.scoreLimit} frags, or best score in ${formatMinutes(settings.timeLimitSec)}${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}${isPrivate ? " · private" : ""}${settings.password.trim() !== "" ? " · passworded" : ""}`;

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
					<button
						type="button"
						className={`gd-chip${isControl ? " gd-chip-on" : ""}`}
						onClick={() => {
							set({ mode: "5cp", scoreLimit: SCORE_LIMIT_CP });
						}}
					>
						5 Control Points
					</button>
				</div>
			</div>
			<p className="gd-field-note">
				{isControl
					? `Five points in a line between two bases. Stand on a pad to take it; a round is won at the enemy's last point. First side to ${settings.scoreLimit} captures.`
					: settings.mode === "tdm"
						? "Two sides, no friendly fire, wipe-out rounds. A team room always plays on at least three screens."
						: "Everyone for themselves. First to 21 frags or the best score in five minutes."}
			</p>

			{isControl || LIBRARY.length === 0 ? null : (
				<div className="gd-field">
					<span className="gd-field-label">Arena</span>
					<div className="gd-choice">
						<button
							type="button"
							className={`gd-chip${libraryMap ? "" : " gd-chip-on"}`}
							onClick={() => set({ map: null })}
						>
							Classic
						</button>
						{LIBRARY.map((m) => {
							const tooNarrow =
								settings.mode === "tdm" && mapScreens(m.spec) < minScreens;
							return (
								<button
									key={m.id}
									type="button"
									disabled={tooNarrow}
									title={
										tooNarrow
											? "Too narrow for team deathmatch"
											: (m.spec.meta?.description ?? "")
									}
									className={`gd-chip${libraryMap?.id === m.id ? " gd-chip-on" : ""}`}
									onClick={() => set({ map: m.id })}
								>
									{m.spec.meta?.name ?? m.id}
								</button>
							);
						})}
					</div>
				</div>
			)}

			{isControl ? (
				<p className="gd-field-note">
					The control arena is five screens — one point per screen — so the
					width is the map, not a setting.
				</p>
			) : libraryMap ? (
				<p className="gd-field-note">
					{libraryMap.spec.meta?.description ?? ""} {screens}{" "}
					{screens === 1 ? "screen" : "screens"} wide
					{libraryMap.spec.meta?.author
						? ` · by ${libraryMap.spec.meta.author}`
						: ""}
					.
				</p>
			) : (
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
			)}
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
					{isControl
						? "Captures to win"
						: settings.mode === "tdm"
							? "Rounds to win"
							: "Frags to win"}
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
						{settings.mode !== "ffa" ? (
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
								Ultimate charge floor (0–{ULT_MAX_CAP})
							</span>
							<input
								type="number"
								min={0}
								max={ULT_MAX_CAP}
								value={settings.ultCharge}
								onChange={(e) => {
									const n = Number.parseInt(e.target.value, 10);
									set({
										ultCharge: Number.isFinite(n)
											? Math.max(0, Math.min(ULT_MAX_CAP, n))
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
 * The game server the menu should ask.
 *
 * `?server=` when a link named one, otherwise the page's own host on the page's
 * own protocol. Hardcoding `http://` made every check mixed content on the
 * deployed HTTPS site, so a perfectly healthy server read as offline and quick
 * match silently skipped its room lookup. The match itself already derives its
 * endpoint this way (`resolveGameEndpoint` + `httpBaseFor`); the menu must ask
 * the same question or the two disagree about what is running.
 */
function gameServerBase(): string {
	return httpBaseFor(
		resolveGameEndpoint(window.location.search, window.location.hostname),
		window.location.protocol,
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
				const res = await fetch(`${gameServerBase()}/health`, {
					signal: ctrl.signal,
				});
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
		const res = await fetch(`${gameServerBase()}/rooms`, {
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
