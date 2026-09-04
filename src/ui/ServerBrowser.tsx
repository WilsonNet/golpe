/**
 * Server browser: the discoverable face of `GET /rooms`, across regions.
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
 * The measurement is taken once per refresh and per game server, because
 * rooms now live on more than one host: the page's own server first, then
 * every fleet entry the operator configured in `VITE_GOLPE_SERVERS`
 * (`region=host:port,...`). Joining a room commits its server into the
 * launch URL as `?server=`, so the match boots where the room lives.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LaunchParams } from "../game/online/launch";
import {
	buildEndpointList,
	httpBaseFor,
	parseRegion,
	parseServerList,
	type RegionEndpoint,
} from "../game/online/regions";
import { GAME_SERVER_PORT } from "../game/online/types";
import type { HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";

interface RoomEntry {
	id: string;
	mode: MatchMode;
	playerCount: number;
	humanCount: number;
	screens: number;
	/** The region the serving game server reported. Absent from older builds. */
	region?: string;
}

interface RoomWithMeta extends RoomEntry {
	region: string;
	pingMs: number | null;
	/**
	 * The `?server=` value that boots this room's match — null when it lives
	 * on the page's own server and needs no address in the URL.
	 */
	server: string | null;
}

type ModeFilter = "all" | MatchMode;
type RegionFilter = "all" | string;
type SortKey = "ping" | "players" | "mode";

/** The env key carrying the operator's fleet (`region=host:port,...`). */
const FLEET_ENV_KEY = "VITE_GOLPE_SERVERS";

/** The fleet the operator configured, if any — empty in a bare dev setup. */
function configuredEndpoints(): RegionEndpoint[] {
	try {
		const env = (
			import.meta as unknown as {
				env?: Record<string, string | undefined>;
			}
		).env;
		return parseServerList(env?.[FLEET_ENV_KEY]);
	} catch {
		return [];
	}
}

function localEndpoint(): RegionEndpoint {
	return {
		region: "local",
		host: window.location.hostname,
		port: GAME_SERVER_PORT,
	};
}

/** `?region=` preselects the browser's filter — a hint, never an address. */
function initialRegionFilter(): RegionFilter {
	return (
		parseRegion(new URLSearchParams(window.location.search).get("region")) ??
		"all"
	);
}

/** The `?server=` value for an endpoint: null when it is the local server. */
function serverParamFor(
	endpoint: RegionEndpoint,
	local: RegionEndpoint,
): string | null {
	if (endpoint.host === local.host && endpoint.port === local.port) {
		return null;
	}
	return endpoint.port === GAME_SERVER_PORT
		? endpoint.host
		: `${endpoint.host}:${endpoint.port}`;
}

async function fetchOne(
	endpoint: RegionEndpoint,
	server: string | null,
): Promise<RoomWithMeta[]> {
	const base = httpBaseFor(endpoint, window.location.protocol);
	const start = performance.now();
	try {
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 2500);
		const res = await fetch(`${base}/rooms`, { signal: ctrl.signal });
		const pingMs = Math.round(performance.now() - start);
		window.clearTimeout(timer);
		if (!res.ok) return [];
		const data = (await res.json()) as { rooms?: RoomEntry[] | null };
		return (data.rooms ?? []).map((r) => ({
			...r,
			region: r.region ?? endpoint.region,
			pingMs,
			server,
		}));
	} catch {
		return [];
	}
}

function formatMode(mode: MatchMode): string {
	return mode === "tdm" ? "Team DM" : "Deathmatch";
}

export function ServerBrowser({
	onJoin,
	hero,
}: {
	onJoin: (params: LaunchParams) => void;
	hero: HeroId;
}) {
	const endpoints = useMemo(() => {
		const local = localEndpoint();
		return buildEndpointList(local, configuredEndpoints()).map((endpoint) => ({
			endpoint,
			server: serverParamFor(endpoint, local),
		}));
	}, []);
	const [rooms, setRooms] = useState<RoomWithMeta[]>([]);
	const [reachable, setReachable] = useState(true);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [search, setSearch] = useState("");
	const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
	const [regionFilter, setRegionFilter] = useState<RegionFilter>(() =>
		initialRegionFilter(),
	);
	const [sortKey, setSortKey] = useState<SortKey>("ping");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		const lists = await Promise.all(
			endpoints.map(({ endpoint, server }) => fetchOne(endpoint, server)),
		);
		const fetched = lists.flat();
		// `GET /rooms` already filters to `isOpen`; an empty list from every
		// server is "no rooms", but nothing answering at all is "unknown" —
		// and worth saying out loud rather than showing an empty browser.
		if (fetched.length === 0) {
			let anyAlive = false;
			for (const { endpoint } of endpoints) {
				try {
					const ctrl = new AbortController();
					const t = window.setTimeout(() => ctrl.abort(), 2000);
					const r = await fetch(
						`${httpBaseFor(endpoint, window.location.protocol)}/health`,
						{ signal: ctrl.signal },
					);
					window.clearTimeout(t);
					if (r.ok) {
						anyAlive = true;
						break;
					}
				} catch {
					// This server is down; the next one may not be.
				}
			}
			setReachable(anyAlive);
			if (!anyAlive)
				setError("Could not reach any game server — is one running?");
		} else {
			setReachable(true);
		}
		setRooms(fetched);
		setLoading(false);
	}, [endpoints]);

	useEffect(() => {
		void refresh();
		const id = window.setInterval(() => void refresh(), 5000);
		return () => window.clearInterval(id);
	}, [refresh]);

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
				Open rooms from the same servers quick match uses — private, probe and
				full rooms never appear.
				{endpoints.length > 1 ? ` ${endpoints.length} regions.` : ""}
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
					{rooms.length === 0 && reachable
						? "No open rooms right now — host one or try quick match."
						: "No rooms match those filters."}
				</p>
			) : (
				<div className="gd-browser-list">
					{filtered.map((r) => (
						<div key={`${r.region}:${r.id}`} className="gd-browser-row">
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
									title="HTTP latency to the game server hosting this room"
								>
									{r.pingMs !== null ? `${r.pingMs}ms` : "—"}
								</span>
								<button
									className="gd-btn gd-btn-primary"
									type="button"
									onClick={() =>
										onJoin({
											room: r.id,
											server: r.server,
											region: r.region,
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
