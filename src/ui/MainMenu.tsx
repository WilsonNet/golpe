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
 * The nesting follows three rules, which are the whole UX of this screen:
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredHero, storeHero } from "../game/heroPref";
import { bindings, codeLabel } from "../game/input/Bindings";
import type { LaunchParams } from "../game/online/launch";
import { ROOM_ID_RE } from "../game/online/room";
import { MAX_NAME, readStoredName, storeName } from "../game/playerName";
import { HEROES, type HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";
import { ControlsDialog } from "./ControlsDialog";
import { HeroSelect } from "./HeroSelect";
import { HUD_CSS } from "./hudStyles";
import { MENU_CSS } from "./menuStyles";

/** The requested room's defaults, as the server would create them. */
const SCORE_LIMIT_FFA = 21;
const SCORE_LIMIT_TDM = 15;
const TIME_LIMIT_SEC = 300;
const FREEZE_TIME_SEC = 4;

type View = "home" | "heroes" | "host" | "join" | "howto" | "controls";

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
		<div className="vd-menu-page">
			<style>{HUD_CSS}</style>
			<style>{MENU_CSS}</style>
			<div className="vd-card">
				<h1 className="vd-title">Vento Áureo</h1>
				<p className="vd-sub">
					A 2D swordfight, online first. Rooms are addressed, not matchmade —
					the link <em>is</em> the invitation.
				</p>

				{view === "home" ? (
					<>
						<div className="vd-name-row">
							<label htmlFor="vd-name">Fighter name</label>
							<input
								id="vd-name"
								className="vd-input"
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
						<div className="vd-menu-list">
							<button
								className="vd-play-item vd-play-item-primary"
								type="button"
								onClick={() => onLaunch({ ...NOTHING, bots: 1, hero })}
							>
								<strong>Quick match</strong>
								<span>
									A duel against a server bot, right now. Your room link is
									ready to share.
								</span>
							</button>
							<button
								className="vd-play-item"
								type="button"
								onClick={() => setView("heroes")}
							>
								<strong>Heroes — {HEROES[hero].name}</strong>
								<span>
									{hero === "lia"
										? "Sword and pistol: reads, guards and the black hole."
										: "Dagger and machine gun: a storm of stabs and a dragon."}
								</span>
							</button>
							<button
								className="vd-play-item"
								type="button"
								onClick={() => setView("host")}
							>
								<strong>Host a match</strong>
								<span>
									Choose the mode, the arena and the rules — then share the
									link.
								</span>
							</button>
							<button
								className="vd-play-item"
								type="button"
								onClick={() => setView("join")}
							>
								<strong>Join a match</strong>
								<span>Enter the room id or the link someone sent you.</span>
							</button>
							<button
								className="vd-play-item"
								type="button"
								onClick={() => onLaunch({ ...NOTHING, training: true, hero })}
							>
								<strong>Practice</strong>
								<span>The training room: a scriptable dummy and its menu.</span>
							</button>
							<button
								className="vd-play-item"
								type="button"
								onClick={() => setView("howto")}
							>
								<strong>How to play</strong>
								<span>Movement, the sword chain, and the ultimate.</span>
							</button>
							<button
								className="vd-play-item"
								type="button"
								onClick={() => setView("controls")}
							>
								<strong>Options</strong>
								<span>Aiming scheme, on-screen gamepad, and rebinding.</span>
							</button>
						</div>
					</>
				) : null}

				{view === "heroes" ? (
					<>
						<h2 className="vd-title">Heroes</h2>
						<p className="vd-sub">
							You face the cursor and read the other side's weapon. Pick who you
							bring — the default applies to every match you start here.
						</p>
						<HeroSelect
							current={hero}
							onPick={(picked) => {
								setHero(picked);
								storeHero(picked);
								setView("home");
							}}
						/>
						<button
							className="vd-btn"
							type="button"
							onClick={() => setView("home")}
						>
							Back
						</button>
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
						<h2 className="vd-title">Options</h2>
						<ControlsDialog onClose={() => setView("home")} />
					</>
				) : null}

				<ServerStatus />
			</div>
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

	const set = useCallback(
		(patch: Partial<HostSettings>) => setSettings((s) => ({ ...s, ...patch })),
		[],
	);

	// A team room has a three-screen floor — wipe-out rounds need ground to give
	// and take. The constraint is enforced here so the form never commits a room
	// that would silently come back wider than it was asked for.
	const minScreens = settings.mode === "tdm" ? 3 : 1;
	const screens = Math.max(minScreens, Math.min(settings.screens, 8));

	const commit = useCallback(() => {
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
	}, [onLaunch, settings, screens, hero]);

	const summary = useMemo(() => {
		if (settings.mode === "tdm") {
			return `Team deathmatch · ${screens} screens · first side to ${settings.scoreLimit} rounds · ${settings.timeLimitSec}s of play per round fight, ${settings.freezeTime}s freezetime${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}`;
		}
		return `Deathmatch · ${screens} ${screens === 1 ? "screen" : "screens"} · first to ${settings.scoreLimit} frags, or best score in ${formatMinutes(settings.timeLimitSec)}${settings.bots > 0 ? ` · ${settings.bots} bots` : ""}`;
	}, [settings, screens]);

	return (
		<>
			<h2 className="vd-title">Host a match</h2>

			<div className="vd-field">
				<span className="vd-field-label">Mode</span>
				<div className="vd-choice">
					<button
						type="button"
						className={`vd-chip${settings.mode === "ffa" ? " vd-chip-on" : ""}`}
						onClick={() => {
							set({ mode: "ffa", scoreLimit: SCORE_LIMIT_FFA });
						}}
					>
						Deathmatch
					</button>
					<button
						type="button"
						className={`vd-chip${settings.mode === "tdm" ? " vd-chip-on" : ""}`}
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
			<p className="vd-field-note">
				{settings.mode === "tdm"
					? "Two sides, no friendly fire, wipe-out rounds. A team room always plays on at least three screens."
					: "Everyone for themselves. First to 21 frags or the best score in five minutes."}
			</p>

			<div className="vd-field">
				<span className="vd-field-label">
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
			<div className="vd-field">
				<span className="vd-field-label">Bots to fight</span>
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
			<div className="vd-field">
				<span className="vd-field-label">
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
			<div className="vd-field">
				<span className="vd-field-label">Match length (minutes)</span>
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

			<div className="vd-advanced">
				<button
					className="vd-advanced-toggle"
					type="button"
					onClick={() => setShowAdvanced(!showAdvanced)}
				>
					{showAdvanced ? "▾ Advanced" : "▸ Advanced"} — for practice and probes
				</button>
				{showAdvanced ? (
					<>
						<div className="vd-field">
							<span className="vd-field-label">
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
							<div className="vd-field">
								<span className="vd-field-label">Freezetime (seconds)</span>
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
						<div className="vd-field">
							<span className="vd-field-label">
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

			<p className="vd-summary">{summary}</p>

			<div className="vd-row-actions">
				<button className="vd-btn" type="button" onClick={commit}>
					Create match
				</button>
				<button className="vd-btn" type="button" onClick={onBack}>
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

	const submit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			const id = roomIdFromInput(value);
			if (id === null || !ROOM_ID_RE.test(id)) {
				setError(
					"Room ids are letters, numbers, dashes and underscores. Paste the full link if you have it.",
				);
				return;
			}
			onLaunch({ ...NOTHING, room: id, hero });
		},
		[value, onLaunch, hero],
	);

	return (
		<>
			<h2 className="vd-title">Join a match</h2>
			<p className="vd-join-hint">
				A host's link looks like{" "}
				<span className="vd-join-example">…/?room=abc-123</span>. Paste it here,
				or just type the room id.
			</p>
			<form onSubmit={submit}>
				<input
					className="vd-input"
					value={value}
					placeholder="room id or link"
					autoComplete="off"
					spellCheck={false}
					onChange={(e) => {
						setValue(e.target.value);
						setError("");
					}}
				/>
				<div className="vd-row-actions">
					<button
						className="vd-btn"
						type="submit"
						disabled={value.trim() === ""}
					>
						Join
					</button>
					<button className="vd-btn" type="button" onClick={onBack}>
						Back
					</button>
				</div>
				<div className="vd-error">{error}</div>
			</form>
		</>
	);
}

/**
 * The controls reference.
 *
 * The rows read the *live* bindings, so a player who has rebound something sees
 * their own layout, not the manual's — a hint that lies about the button is
 * worse than no hint, and this one is the same store the game plays by.
 */
function HowToPlay({ onBack }: { onBack: () => void }) {
	const [, bump] = useState(0);
	useEffect(() => bindings.subscribe(() => bump((n) => n + 1)), []);

	const key = (
		action:
			| "left"
			| "right"
			| "jump"
			| "attack"
			| "block"
			| "uppercut"
			| "ultimate"
			| "sword"
			| "gun",
	) => {
		const code = bindings.codesFor(action)[0];
		return code ? codeLabel(code) : "—";
	};

	return (
		<>
			<h2 className="vd-title">How to play</h2>
			<div className="vd-how-row">
				<span className="vd-key">{key("left")}</span>
				<span className="vd-key">{key("right")}</span>
				<span>
					Move. Double-tap either to dash — a flat line, even in the air.
				</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">{key("jump")}</span>
				<span>
					Jump. Again in the air: double jump. Jump off a wall to climb it.
				</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">{key("attack")}</span>
				<span>
					Sword slash — or gunshot, in gun stance. Tap again as each swing lands
					for the three-hit chain (finisher knocks down).
				</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">{key("block")}</span>
				<span>
					Block. The first 140ms of a fresh block is a parry — absorb a swing
					inside it and the attacker is yours.
				</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">{key("uppercut")}</span>
				<span>Uppercut: unblockable, launches the target.</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">{key("sword")}</span>
				<span className="vd-key">{key("gun")}</span>
				<span>Stances — sword is the default. Q and E by default.</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">{key("ultimate")}</span>
				<span>
					The black hole: hold to aim, release to cast. 707px is as far as it
					can be thrown.
				</span>
			</div>
			<div className="vd-how-row">
				<span className="vd-key">Tab</span>
				<span className="vd-key">Esc</span>
				<span>Scoreboard · menu (rebinding lives there).</span>
			</div>
			<p className="vd-how-note">
				Hold the slash about 420ms and release for a Massive Strike. Cancel a
				slash into a block to guard between swings — that's the butterfly. A
				guard only covers the side you face.
			</p>
			<div className="vd-row-actions">
				<button className="vd-btn" type="button" onClick={onBack}>
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
		<div className="vd-server">
			<span
				className={`vd-dot vd-dot-${status === "checking" ? "wait" : status === "online" ? "on" : "off"}`}
			/>
			<span>
				{status === "checking"
					? "Checking the game server…"
					: status === "online"
						? "Game server online"
						: "Game server offline — matches can't start until it is."}
			</span>
			<span className="vd-room">rooms are shared by link</span>
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
