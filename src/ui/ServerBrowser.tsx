/**
 * Server browser: the discoverable face of `GET /rooms`, across regions and
 * across the LAN.
 *
 * Quick match is the one-click path, but a player who wants to choose needs a
 * listing — what rooms are open, how busy they are, what mode they play, and
 * how far away they feel. The browser reads the same endpoint quick match does
 * (`GameRoom.isOpen`), so discovery and the game cannot disagree about what is
 * joinable.
 *
 * **LAN rooms are the host pack's discovery, not the public site's.** A browser
 * cannot scan a LAN or browse mDNS, so the pack's server publishes the rooms it
 * found at `/lan/rooms` on its own origin. The page marks those rows `LAN`
 * because the endpoint is a validated private address — never because a query
 * parameter or a server field said so. Rows are pinned above internet rooms;
 * the chosen sort applies inside each group.
 *
 * Latency is approximated via HTTP rather than WebRTC: a `fetch` to `/rooms` is
 * timed and the result is shown as "ping". It is not a WebRTC round-trip, but it
 * is a useful ordering. Joining a room commits its server into the launch URL as
 * `?server=`, so the match boots where the room lives.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type BrowserRoom,
	type BrowserRoomEntry,
	canJoinBrowserBuild,
	hostPageForBrowserRoom,
	lanRoomToBrowserRoom,
	mergeBrowserRooms,
	sortBrowserRooms,
} from "../game/online/browser";
import {
	isPrivateHost,
	LAN_ROOMS_PATH,
	type LanRoomEntry,
} from "../game/online/lan";
import type { LaunchParams } from "../game/online/launch";
import {
	buildEndpointList,
	httpBaseFor,
	parseRegion,
	parseServerList,
	resolveGameEndpoint,
	type RegionEndpoint,
} from "../game/online/regions";
import { GAME_SERVER_PORT } from "../game/online/types";
import type { HeroId } from "../game/simulation/Heroes";
import type { MatchMode } from "../game/simulation/Teams";

interface RoomsResponse {
	rooms?: BrowserRoomEntry[] | LanRoomEntry[] | null;
	build?: string | null;
	protocol?: number | null;
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
	// Same question the menu's status line and quick match ask: `?server=` when
	// the URL names one, otherwise the page's own host on the game port. A pack
	// on a non-default port is only reachable at all because its launcher puts
	// `?server=` in the URL, and the browser must read it too.
	const endpoint = resolveGameEndpoint(
		window.location.search,
		window.location.hostname,
	);
	return { ...endpoint, region: "local" };
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

/** A room on the page's own game server, or a discovered LAN host. */
function isLanEndpoint(endpoint: RegionEndpoint): boolean {
	return isPrivateHost(endpoint.host);
}

async function fetchOne(
	endpoint: RegionEndpoint,
	server: string | null,
	source: "lan" | "internet",
): Promise<BrowserRoom[]> {
	const base = httpBaseFor(endpoint, window.location.protocol);
	const start = performance.now();
	try {
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 2500);
		const res = await fetch(`${base}/rooms`, { signal: ctrl.signal });
		const pingMs = Math.round(performance.now() - start);
		window.clearTimeout(timer);
		if (!res.ok) return [];
		const data = (await res.json()) as RoomsResponse;
		return (data.rooms ?? []).map((r) => ({
			...r,
			region: r.region ?? endpoint.region,
			pingMs,
			server,
			source,
			build: r.build ?? data.build ?? null,
			protocol: r.protocol ?? data.protocol ?? null,
		}));
	} catch {
		return [];
	}
}

/**
 * The rooms the host pack discovered on this LAN.
 *
 * Deliberately a soft failure: a hosted page has no `/lan/rooms`, and a page
 * served by a pack whose mDNS is blocked still has its own room in `/rooms`.
 * Neither is a reason to show the red "no server" error.
 */
async function fetchLanRooms(): Promise<BrowserRoom[]> {
	// The hosted site has no pack and Caddy's SPA fallback would answer
	// `/lan/rooms` with index.html every five seconds. Only a page served from a
	// private origin can have a local discovery endpoint worth asking.
	if (!isPrivateHost(window.location.hostname)) return [];
	try {
		const ctrl = new AbortController();
		const timer = window.setTimeout(() => ctrl.abort(), 1800);
		const res = await fetch(`${window.location.origin}${LAN_ROOMS_PATH}`, {
			signal: ctrl.signal,
		});
		window.clearTimeout(timer);
		if (!res.ok) return [];
		if (!res.headers.get("content-type")?.includes("application/json")) {
			// A dev server's SPA fallback answers `/lan/rooms` with index.html.
			return [];
		}
		const data = (await res.json()) as { rooms?: LanRoomEntry[] | null };
		return (data.rooms ?? [])
			.map((raw) => lanRoomToBrowserRoom(raw))
			.filter((room): room is BrowserRoom => room !== null);
	} catch {
		return [];
	}
}

function formatMode(mode: MatchMode): string {
	if (mode === "tdm") return "Team DM";
	if (mode === "5cp") return "5 CP";
	return "Deathmatch";
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
			source: isLanEndpoint(endpoint)
				? ("lan" as const)
				: ("internet" as const),
		}));
	}, []);
	const [rooms, setRooms] = useState<BrowserRoom[]>([]);
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
		const [internetLists, lanRooms] = await Promise.all([
			Promise.all(
				endpoints.map(({ endpoint, server, source }) =>
					fetchOne(endpoint, server, source),
				),
			),
			fetchLanRooms(),
		]);
		const fetched = mergeBrowserRooms(
			internetLists.flat(),
			lanRooms,
			localEndpoint(),
		);

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
		const out = rooms.filter((r) => {
			if (
				search.trim() !== "" &&
				!r.id.toLowerCase().includes(search.trim().toLowerCase())
			)
				return false;
			if (modeFilter !== "all" && r.mode !== modeFilter) return false;
			if (regionFilter !== "all" && r.region !== regionFilter) return false;
			return true;
		});
		return sortBrowserRooms(out, sortKey, sortDir);
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
				full rooms never appear. LAN rooms come from the host pack on this
				network and sit first.
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
					<button
						type="button"
						className={`gd-chip${modeFilter === "5cp" ? " gd-chip-on" : ""}`}
						onClick={() => setModeFilter("5cp")}
					>
						5 CP
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
							{reg === "all" ? "All regions" : reg === "lan" ? "LAN" : reg}
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
					{filtered.map((r) => {
						const compatible = canJoinBrowserBuild(r);
						const hostPage = compatible ? null : hostPageForBrowserRoom(r);
						return (
							<div
								key={`${r.source}:${r.server ?? "local"}:${r.id}`}
								className="gd-browser-row"
							>
								<div className="gd-browser-main">
									<span className="gd-browser-title">
										<span className="gd-browser-id" title={r.id}>
											{r.id.slice(0, 8)}…{r.id.slice(-4)}
										</span>
										{r.source === "lan" ? (
											<span className="gd-badge gd-badge-lan">LAN</span>
										) : null}
									</span>
									<span className="gd-browser-meta">
										{formatMode(r.mode)} · {r.humanCount}/{r.playerCount}{" "}
										players
										{r.humanCount !== r.playerCount
											? ` (${r.playerCount - r.humanCount} bots)`
											: ""}{" "}
										· {r.screens} screen{r.screens !== 1 ? "s" : ""} ·{" "}
										{r.hostName ?? r.region}
									</span>
								</div>
								<div className="gd-browser-side">
									<span
										className="gd-browser-ping"
										title={
											r.source === "lan"
												? "LAN host — this is the host pack's own latency to the room"
												: "HTTP latency to the game server hosting this room"
										}
									>
										{r.pingMs !== null ? `${r.pingMs}ms` : "—"}
									</span>
									{hostPage === null ? (
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
													capTime: undefined,
													screens: undefined,
													map: null,
													password: null,
													isPrivate: false,
												})
											}
										>
											Join
										</button>
									) : (
										<button
											className="gd-btn"
											type="button"
											title="This room runs a different build. Open the host's own page so its client matches its server."
											onClick={() => window.location.assign(hostPage)}
										>
											Open host
										</button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
