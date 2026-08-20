/**
 * The Esc menu.
 *
 * **It does not pause anything.** The server is authoritative and fifteen other
 * fighters are still swinging; a client that stopped simulating would be a client
 * that rubber-bands back into a fight it stopped watching. What it does is take
 * the *keyboard* away from the game — `input-suspended` on the EventBus — so
 * choosing a key for block does not walk the fighter into a wall while the player
 * is choosing it.
 *
 * The controls dialog behind it lives in `ControlsDialog`, shared with the main
 * menu so a player can rebind before their first match rather than during it.
 */

import { useEffect, useRef, useState } from "react";
import { EventBus } from "../game/EventBus";
import { readStoredHero, storeHero } from "../game/heroPref";
import type { RosterEntry } from "../game/online/types";
import type { HeroId } from "../game/simulation/Heroes";
import { TEAM_NAMES, type TeamId } from "../game/simulation/Teams";
import { teamCss } from "../game/teamPalette";
import { ControlsDialog } from "./ControlsDialog";
import { HeroSelect } from "./HeroSelect";
import { HUD_CSS } from "./hudStyles";
import { MoveList } from "./MoveList";
import { useMatch } from "./useMatch";

type View = "menu" | "controls" | "heroes" | "room" | "moves";

// Cache last roster so a menu opened after the last broadcast still has data.
// Updated by the single global listener below — no component needs to request it.
let cachedRoster: RosterEntry[] = [];
let rosterListenerInstalled = false;
function installRosterCache() {
	if (rosterListenerInstalled) return;
	rosterListenerInstalled = true;
	EventBus.on("roster", ((entries: RosterEntry[]) => {
		cachedRoster = entries;
	}) as never);
}
installRosterCache();

function useRoster(): RosterEntry[] {
	const [roster, setRoster] = useState<RosterEntry[]>(() => cachedRoster);
	useEffect(() => {
		const off = EventBus.on("roster", ((entries: RosterEntry[]) => {
			cachedRoster = entries;
			setRoster([...entries]);
		}) as never);
		return off;
	}, []);
	return roster;
}

export function PauseMenu({
	onExitToMenu,
}: {
	/** Leave the match and return to the root menu. */
	onExitToMenu: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>("menu");
	const [confirmExit, setConfirmExit] = useState(false);
	// The name prompt is a modal of its own. Opening this one over it would put
	// two dialogs on screen and take the keyboard away from the field the player
	// is typing into.
	const naming = useRef(false);
	const openRef = useRef(false);
	openRef.current = open;

	useEffect(() => {
		const offNeed = EventBus.on("need-player-name", (() => {
			naming.current = true;
		}) as never);
		const offName = EventBus.on("player-name", (() => {
			naming.current = false;
		}) as never);
		return () => {
			offNeed();
			offName();
		};
	}, []);

	// Escape toggles the menu — except while the controls dialog is capturing a
	// button, where its own capture-phase listener takes the event first.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Escape") return;
			if (naming.current) return;
			e.preventDefault();
			setOpen(!openRef.current);
		};
		window.addEventListener("keydown", onKey);
		// A phone has no Escape key. The on-screen gamepad's menu button fires this
		// instead of synthesising a keystroke, because a synthetic keydown would
		// also have to be kept out of the rebind capture and out of the canvas.
		const offToggle = EventBus.on("menu-toggle", (() => {
			if (naming.current) return;
			setOpen(!openRef.current);
		}) as never);
		return () => {
			window.removeEventListener("keydown", onKey);
			offToggle();
		};
	}, []);

	// The game learns about the menu here and only here.
	useEffect(() => {
		EventBus.emit("input-suspended", open);
		if (!open) {
			setView("menu");
			setConfirmExit(false);
		}
	}, [open]);

	// Release the keyboard if this component ever goes away with the menu up.
	useEffect(() => () => EventBus.emit("input-suspended", false), []);

	if (!open) return null;

	return (
		<div className="gd-veil gd-menu-veil">
			<style>{HUD_CSS}</style>
			<div className="gd-card gd-menu-card">
				{view === "menu" ? (
					<MainMenuView
						onResume={() => setOpen(false)}
						onHeroes={() => setView("heroes")}
						onMoves={() => setView("moves")}
						onControls={() => setView("controls")}
						onRoom={() => setView("room")}
						onExit={onExitToMenu}
						confirmExit={confirmExit}
						setConfirmExit={setConfirmExit}
					/>
				) : view === "moves" ? (
					<MoveList hero={readStoredHero()} onClose={() => setView("menu")} />
				) : view === "heroes" ? (
					<>
						<h2 className="gd-title">Heroes</h2>
						<p className="gd-sub">
							Changing hero applies on the server's next snapshot — the ultimate
							meter resets with it.
						</p>
						<HeroSelect
							current={readStoredHero()}
							onPick={(hero: HeroId) => {
								storeHero(hero);
								// The match hears the change and asks the server; the
								// echo comes home in the next snapshot's `hero` field.
								EventBus.emit("hero-select", hero);
								setView("menu");
							}}
						/>
						<button
							className="gd-btn"
							type="button"
							onClick={() => setView("menu")}
						>
							Back
						</button>
					</>
				) : view === "room" ? (
					<RoomView onBack={() => setView("menu")} />
				) : (
					<>
						<h2 className="gd-title">Controls</h2>
						<ControlsDialog onClose={() => setView("menu")} />
					</>
				)}
			</div>
		</div>
	);
}

function MainMenuView({
	onResume,
	onHeroes,
	onMoves,
	onControls,
	onRoom,
	onExit,
	confirmExit,
	setConfirmExit,
}: {
	onResume: () => void;
	onHeroes: () => void;
	onMoves: () => void;
	onControls: () => void;
	onRoom: () => void;
	onExit: () => void;
	confirmExit: boolean;
	setConfirmExit: (v: boolean) => void;
}) {
	const match = useMatch();
	const isTdm = match?.status.mode === "tdm";
	return (
		<>
			<h2 className="gd-title">Menu</h2>
			<p className="gd-sub">
				The match keeps running — the server is the judge, and stepping away
				from the keyboard does not stop the fight.
			</p>
			<div className="gd-menu-list">
				<button className="gd-btn" type="button" onClick={onResume}>
					Resume
				</button>
				<button className="gd-btn" type="button" onClick={onHeroes}>
					Heroes
				</button>
				<button className="gd-btn" type="button" onClick={onMoves}>
					Moves
				</button>
				<button className="gd-btn" type="button" onClick={onRoom}>
					{isTdm ? "Teams & Bots" : "Room & Bots"}
				</button>
				<button className="gd-btn" type="button" onClick={onControls}>
					Controls
				</button>
				{confirmExit ? (
					<>
						<p className="gd-sub gd-exit-note">
							Your fighter leaves the room — the match keeps running for
							everyone else.
						</p>
						<button
							className="gd-btn gd-exit-yes"
							type="button"
							onClick={onExit}
						>
							Exit to menu
						</button>
						<button
							className="gd-btn"
							type="button"
							onClick={() => setConfirmExit(false)}
						>
							Stay
						</button>
					</>
				) : (
					<button
						className="gd-btn"
						type="button"
						onClick={() => setConfirmExit(true)}
					>
						Exit to menu
					</button>
				)}
			</div>
		</>
	);
}

function RoomView({ onBack }: { onBack: () => void }) {
	const match = useMatch();
	const roster = useRoster();
	const myId = match?.myId ?? "";
	const me = roster.find((r) => r.id === myId) ?? null;
	const isTdm = match?.status.mode === "tdm";
	const myTeam: TeamId | null = (me?.team as TeamId | null) ?? null;
	const isAdmin = me?.admin ?? false;
	const isCreator = me?.creator ?? false;

	const humans = roster.filter((r) => !r.bot);
	const bots = roster.filter((r) => r.bot);
	const azureCount = roster.filter((r) => r.team === 0).length;
	const emberCount = roster.filter((r) => r.team === 1).length;
	const azureBots = roster.filter((r) => r.bot && r.team === 0).length;
	const emberBots = roster.filter((r) => r.bot && r.team === 1).length;

	if (!match) {
		return (
			<>
				<h2 className="gd-title">{isTdm ? "Teams & Bots" : "Room"}</h2>
				<p className="gd-sub">
					Connecting — room info will appear on the next roster.
				</p>
				<button className="gd-btn" type="button" onClick={onBack}>
					Back
				</button>
			</>
		);
	}

	return (
		<>
			<h2 className="gd-title">{isTdm ? "Teams & Bots" : "Room & Bots"}</h2>
			<p className="gd-sub">
				{isTdm
					? "Switch sides, add bots for a Player vs Bots match, and delegate who can manage them."
					: "Add or remove bots without leaving the match. The host can delegate."}
			</p>

			{isTdm ? (
				<div className="gd-setting">
					<div className="gd-setting-head">
						<span>
							Your team —{" "}
							<span style={{ color: teamCss(myTeam), fontWeight: 700 }}>
								{myTeam === 0
									? TEAM_NAMES[0]
									: myTeam === 1
										? TEAM_NAMES[1]
										: "—"}
							</span>
							{isCreator ? <span className="gd-tag"> HOST</span> : null}
							{isAdmin && !isCreator ? (
								<span className="gd-tag"> ADMIN</span>
							) : null}
						</span>
						<span className="gd-team-alive">
							{azureCount} {TEAM_NAMES[0]} · {emberCount} {TEAM_NAMES[1]}
						</span>
					</div>
					<div className="gd-choice" style={{ marginTop: 10 }}>
						<button
							type="button"
							className={`gd-chip${myTeam === 0 ? " gd-chip-on" : ""}`}
							style={{
								borderColor: myTeam === 0 ? teamCss(0) : undefined,
								color: myTeam === 0 ? teamCss(0) : undefined,
							}}
							onClick={() => EventBus.emit("team-select", 0)}
						>
							{TEAM_NAMES[0]}
						</button>
						<button
							type="button"
							className={`gd-chip${myTeam === 1 ? " gd-chip-on" : ""}`}
							style={{
								borderColor: myTeam === 1 ? teamCss(1) : undefined,
								color: myTeam === 1 ? teamCss(1) : undefined,
							}}
							onClick={() => EventBus.emit("team-select", 1)}
						>
							{TEAM_NAMES[1]}
						</button>
					</div>
					<p className="gd-setting-hint">
						Switching teleports you to your new side's spawn with the same HP —
						use the freezetime between rounds to stack your side for Player vs
						Bots.
					</p>
				</div>
			) : (
				<div className="gd-setting">
					<div className="gd-setting-head">
						<span>
							Room — {humans.length} humans · {bots.length} bots
							{isCreator ? <span className="gd-tag"> HOST</span> : null}
							{isAdmin && !isCreator ? (
								<span className="gd-tag"> ADMIN</span>
							) : null}
						</span>
						<span className="gd-team-alive">{roster.length}/16 fighters</span>
					</div>
				</div>
			)}

			<div className="gd-setting">
				<div className="gd-setting-head">
					<span>
						Bots — {bots.length} total
						{bots.length > 0
							? ` · ${azureBots} ${TEAM_NAMES[0]} · ${emberBots} ${TEAM_NAMES[1]}`
							: ""}
					</span>
					<span className="gd-team-alive">
						{humans.length + bots.length}/16
					</span>
				</div>
				{isTdm ? (
					<>
						<div
							style={{
								display: "flex",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 10,
							}}
						>
							<button
								className="gd-btn"
								type="button"
								disabled={!isAdmin}
								title={
									!isAdmin ? "Only host/admins can manage bots" : undefined
								}
								onClick={() => EventBus.emit("bot-add", null)}
								style={{ flex: "1 1 110px" }}
							>
								+ Bot (auto)
							</button>
							<button
								className="gd-btn"
								type="button"
								disabled={!isAdmin || bots.length === 0}
								onClick={() => EventBus.emit("bot-remove", null)}
								style={{ flex: "1 1 110px" }}
							>
								− Bot
							</button>
						</div>
						<div
							style={{
								display: "flex",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 6,
							}}
						>
							<button
								className="gd-btn"
								type="button"
								disabled={!isAdmin}
								title={!isAdmin ? "Only host/admins" : undefined}
								onClick={() => EventBus.emit("bot-add", 0)}
								style={{ flex: "1 1 110px", borderColor: teamCss(0) }}
							>
								+ {TEAM_NAMES[0]}
							</button>
							<button
								className="gd-btn"
								type="button"
								disabled={!isAdmin}
								onClick={() => EventBus.emit("bot-add", 1)}
								style={{ flex: "1 1 110px", borderColor: teamCss(1) }}
							>
								+ {TEAM_NAMES[1]}
							</button>
							<button
								className="gd-btn"
								type="button"
								disabled={!isAdmin || azureBots === 0}
								onClick={() => EventBus.emit("bot-remove", 0)}
								style={{ flex: "1 1 110px" }}
							>
								− {TEAM_NAMES[0]}
							</button>
							<button
								className="gd-btn"
								type="button"
								disabled={!isAdmin || emberBots === 0}
								onClick={() => EventBus.emit("bot-remove", 1)}
								style={{ flex: "1 1 110px" }}
							>
								− {TEAM_NAMES[1]}
							</button>
						</div>
					</>
				) : (
					<div
						style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}
					>
						<button
							className="gd-btn"
							type="button"
							disabled={!isAdmin}
							onClick={() => EventBus.emit("bot-add", null)}
							style={{ flex: 1 }}
						>
							+ Add Bot
						</button>
						<button
							className="gd-btn"
							type="button"
							disabled={!isAdmin || bots.length === 0}
							onClick={() => EventBus.emit("bot-remove", null)}
							style={{ flex: 1 }}
						>
							− Remove Bot
						</button>
					</div>
				)}
				{!isAdmin ? (
					<p className="gd-setting-hint">
						Only the host and their admins can add or remove bots mid-match.
					</p>
				) : (
					<p className="gd-setting-hint">
						Bots fill the side you choose — stack your team first, then add the
						opposition for a Player vs Bots match.
					</p>
				)}
			</div>

			{isCreator ? (
				<div
					className="gd-setting"
					style={{ borderBottom: "none", paddingBottom: 0 }}
				>
					<div className="gd-setting-head">
						<span>Admins — who can manage bots</span>
						<span className="gd-team-alive">creator can promote/demote</span>
					</div>
					<div
						style={{
							marginTop: 10,
							display: "flex",
							flexDirection: "column",
							gap: 6,
						}}
					>
						{humans.map((p) => (
							<div
								key={p.id}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 8,
									padding: "6px 8px",
									borderRadius: 6,
									background:
										p.id === myId
											? "rgba(14,195,201,0.12)"
											: "rgba(255,255,255,0.04)",
									border: `1px solid ${p.team !== null ? teamCss(p.team as TeamId) : "rgba(255,255,255,0.08)"}`,
								}}
							>
								<span
									style={{
										fontSize: 13,
										color:
											p.team !== null ? teamCss(p.team as TeamId) : undefined,
									}}
								>
									{p.name}
									{p.creator ? <span className="gd-tag">HOST</span> : null}
									{p.admin && !p.creator ? (
										<span className="gd-tag">ADMIN</span>
									) : null}
									{p.id === myId ? <span className="gd-tag">YOU</span> : null}
									{p.team !== null ? (
										<span className="gd-tag">
											{TEAM_NAMES[p.team as TeamId]}
										</span>
									) : null}
								</span>
								<button
									type="button"
									className={`gd-chip${p.admin ? " gd-chip-on" : ""}`}
									disabled={p.creator}
									title={p.creator ? "Creator keeps admin" : undefined}
									onClick={() =>
										EventBus.emit("admin-toggle", {
											targetId: p.id,
											admin: !p.admin,
										})
									}
									style={{ fontSize: 11, padding: "4px 10px" }}
								>
									{p.admin ? "Admin ✓" : "Make admin"}
								</button>
							</div>
						))}
					</div>
					<p className="gd-setting-hint">
						Admins persist until they leave; a leaving host passes the crown to
						the next human.
					</p>
				</div>
			) : isAdmin ? (
				<div
					className="gd-setting"
					style={{ borderBottom: "none", paddingBottom: 0 }}
				>
					<div className="gd-setting-head">
						<span>Players</span>
						<span className="gd-team-alive">{humans.length} humans</span>
					</div>
					<div
						style={{
							marginTop: 8,
							display: "flex",
							flexDirection: "column",
							gap: 4,
						}}
					>
						{humans.map((p) => (
							<div
								key={p.id}
								style={{
									display: "flex",
									justifyContent: "space-between",
									fontSize: 13,
									opacity: p.id === myId ? 1 : 0.85,
									padding: "4px 6px",
									background:
										p.id === myId ? "rgba(14,195,201,0.08)" : undefined,
									borderRadius: 4,
								}}
							>
								<span>
									{p.name}
									{p.creator ? <span className="gd-tag">HOST</span> : null}
									{p.admin ? <span className="gd-tag">ADMIN</span> : null}
									{p.id === myId ? <span className="gd-tag">YOU</span> : null}
								</span>
								<span
									style={{
										color:
											p.team !== null ? teamCss(p.team as TeamId) : undefined,
									}}
								>
									{p.team !== null ? TEAM_NAMES[p.team as TeamId] : ""}
								</span>
							</div>
						))}
					</div>
				</div>
			) : null}

			<button
				className="gd-btn"
				type="button"
				onClick={onBack}
				style={{ marginTop: 14 }}
			>
				Back
			</button>
		</>
	);
}
