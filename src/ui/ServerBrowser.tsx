/**
 * Server browser: the discoverable face of `GET /rooms`.
 *
 * Quick match is the one-click path, but a player who wants to choose
 * needs a listing — what rooms are open, how busy they are, what mode
 * they play, and how far away they feel. The browser reads the same
 * endpoint quick match does (`GameRoom.isOpen`), so discovery and the
 * game cannot disagree about what is joinable.
 *
 * Latency is approximated via HTTP rather than WebRTC: a `fetch` to
 * `/health` is timed and the result is shown as "ping". It is not a
 * WebRTC round-trip, but it is a useful ordering — a room on the far
 * side of the planet will still take longer to answer a health check.
 * The measurement is taken once per refresh and applied to every room
 * from that server, because all rooms currently live on one `geckos`
 * host. The UI is ready for the day there are more.
 */

import { useEffect, useMemo, useState } from "react";
import type { LaunchParams } from "../game/online/launch";
import type { HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";

interface RoomEntry {
	id: string;
	mode: MatchMode;
	playerCount: number;
	humanCount: number;
	screens: number;
}

interface RoomWithMeta extends RoomEntry {
	region: string;
	pingMs: number | null;
}

type ModeFilter = "all" | MatchMode;
type RegionFilter = "all" | string;
type SortKey = "ping" | "players" | "mode";

function serverBase(): string {
	return `http://${window.location.hostname}:9208`;
}

async function fetchWithPing(): Promise<{
	rooms: RoomEntry[];
	pingMs: number | null;
}> {
	const url = `${serverBase()}/rooms`;
	const start = performance.now();
	try {
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 2500);
		const res = await fetch(url, { signal: ctrl.signal });
		const pingMs = Math.round(performance.now() - start);
		window.clearTimeout(timer);
		if (!res.ok) return { rooms: [], pingMs: null };
		const data = (await res.json()) as { rooms?: RoomEntry[] | null };
		return { rooms: (data.rooms ?? []) as RoomEntry[], pingMs };
	} catch {
		return { rooms: [], pingMs: null };
	}
}

function formatMode(mode: MatchMode): string {
	return mode === "tdm" ? "Team DM" : "Deathmatch";
}

function regionFor(_room: RoomEntry): string {
	// All rooms currently live on the single geckos host the page was
	// served from — so the region is the host itself. A future multi-host
	// listing can branch here without changing the browser's shape.
	return "Local";
}

export function ServerBrowser({
	onJoin,
	hero,
}: {
	onJoin: (params: LaunchParams) => void;
	hero: HeroId;
}) {
	const [rooms, setRooms] = useState<RoomWithMeta[]>([]);
	const [pingMs, setPingMs] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [search, setSearch] = useState("");
	const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
	const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");
	const [sortKey, setSortKey] = useState<SortKey>("ping");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

	const refresh = async () => {
		setLoading(true);
		setError(null);
		const { rooms: fetched, pingMs: ping } = await fetchWithPing();
		// `GET /rooms` already filters to `isOpen`; a network failure is
		// the only case where an empty list is not "no rooms" but "unknown".
		if (ping === null && fetched.length === 0) {
			// Distinguish "no rooms" from "could not reach server" by
			// probing health once more — if that fails, the server is down.
			try {
				const ctrl = new AbortController();
				const t = window.setTimeout(() => ctrl.abort(), 2000);
				const r = await fetch(`${serverBase()}/health`, {
					signal: ctrl.signal,
				});
				window.clearTimeout(t);
				if (!r.ok) setError("Game server is offline — cannot list rooms.");
			} catch {
				setError("Could not reach game server — is it running?");
			}
		}
		setPingMs(ping);
		setRooms(
			fetched.map((r) => ({
				...r,
				region: regionFor(r),
				pingMs: ping,
			})),
		);
		setLoading(false);
	};

	useEffect(() => {
		refresh();
		const id = window.setInterval(refresh, 5000);
		return () => window.clearInterval(id);
	}, []);

	const regions = useMemo(() => {
		const s = new Set(rooms.map((r) => r.region));
		return ["all", ...s] as RegionFilter[];
	}, [rooms]);

	const filtered = useMemo(() => {
		let out = rooms.filter((r) => {
			if (
				search.trim() !== "" &&
				!r.id.toLowerCase().includes(search.trim().toLowerCase())
			)
				return false;
			if (modeFilter !== "all" && r.mode !== modeFilter) return false;
			if (regionFilter !== "all" && r.region !== regionFilter) return false;
			return true;
		});
		out = [...out].sort((a, b) => {
			let cmp = 0;
			if (sortKey === "ping") {
				const ap = a.pingMs ?? 9999;
				const bp = b.pingMs ?? 9999;
				cmp = ap - bp;
			} else if (sortKey === "players") {
				cmp = a.playerCount - b.playerCount;
			} else if (sortKey === "mode") {
				cmp = a.mode.localeCompare(b.mode);
			}
			return sortDir === "asc" ? cmp : -cmp;
		});
		return out;
	}, [rooms, search, modeFilter, regionFilter, sortKey, sortDir]);

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		else {
			setSortKey(key);
			setSortDir("asc");
		}
	};

	return (
		<div className="gd-server-browser">
			<div className="gd-section-head">Server browser</div>
			<p className="gd-field-note">
				Open rooms from the same server quick match uses — private, probe and
				full rooms never appear. {pingMs !== null ? `Ping ~${pingMs}ms.` : ""}
			</p>

			<div className="gd-browser-filters">
				<input
					className="gd-input"
					placeholder="Search room id…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					autoComplete="off"
					spellCheck={false}
				/>
				<div className="gd-choice">
					<button
						type="button"
						className={`gd-chip${modeFilter === "all" ? " gd-chip-on" : ""}`}
						onClick={() => setModeFilter("all")}
					>
						All modes
					</button>
					<button
						type="button"
						className={`gd-chip${modeFilter === "ffa" ? " gd-chip-on" : ""}`}
						onClick={() => setModeFilter("ffa")}
					>
						Deathmatch
					</button>
					<button
						type="button"
						className={`gd-chip${modeFilter === "tdm" ? " gd-chip-on" : ""}`}
						onClick={() => setModeFilter("tdm")}
					>
						Team DM
					</button>
				</div>
				<div className="gd-choice">
					{regions.map((reg) => (
						<button
							key={reg}
							type="button"
							className={`gd-chip${regionFilter === reg ? " gd-chip-on" : ""}`}
							onClick={() => setRegionFilter(reg)}
						>
							{reg === "all" ? "All regions" : reg}
						</button>
					))}
				</div>
				<div className="gd-browser-sorts">
					<span className="gd-field-label">Sort by</span>
					<button
						type="button"
						className={`gd-chip${sortKey === "ping" ? " gd-chip-on" : ""}`}
						onClick={() => toggleSort("ping")}
					>
						Ping {sortKey === "ping" ? (sortDir === "asc" ? "↑" : "↓") : ""}
					</button>
					<button
						type="button"
						className={`gd-chip${sortKey === "players" ? " gd-chip-on" : ""}`}
						onClick={() => toggleSort("players")}
					>
						Players{" "}
						{sortKey === "players" ? (sortDir === "asc" ? "↑" : "↓") : ""}
					</button>
					<button
						type="button"
						className={`gd-chip${sortKey === "mode" ? " gd-chip-on" : ""}`}
						onClick={() => toggleSort("mode")}
					>
						Mode {sortKey === "mode" ? (sortDir === "asc" ? "↑" : "↓") : ""}
					</button>
				</div>
				<button className="gd-btn" type="button" onClick={refresh}>
					Refresh
				</button>
			</div>

			{loading && rooms.length === 0 ? (
				<p className="gd-field-note">Loading rooms…</p>
			) : error ? (
				<div className="gd-error">{error}</div>
			) : filtered.length === 0 ? (
				<p className="gd-field-note">
					{rooms.length === 0
						? "No open rooms right now — host one or try quick match."
						: "No rooms match those filters."}
				</p>
			) : (
				<div className="gd-browser-list">
					{filtered.map((r) => (
						<div key={r.id} className="gd-browser-row">
							<div className="gd-browser-main">
								<span className="gd-browser-id" title={r.id}>
									{r.id.slice(0, 8)}…{r.id.slice(-4)}
								</span>
								<span className="gd-browser-meta">
									{formatMode(r.mode)} · {r.humanCount}/{r.playerCount} players
									{r.humanCount !== r.playerCount
										? ` (${r.playerCount - r.humanCount} bots)`
										: ""}{" "}
									· {r.screens} screen{r.screens !== 1 ? "s" : ""} · {r.region}
								</span>
							</div>
							<div className="gd-browser-side">
								<span
									className="gd-browser-ping"
									title="HTTP latency to the game server"
								>
									{r.pingMs !== null ? `${r.pingMs}ms` : "—"}
								</span>
								<button
									className="gd-btn gd-btn-primary"
									type="button"
									onClick={() =>
										onJoin({
											room: r.id,
											ai: false,
											online: false,
											offline: false,
											training: false,
											tutorial: false,
											hero,
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
										})
									}
								>
									Join
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
