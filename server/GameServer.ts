/**
 * The one game server, created as a value.
 *
 * `server/index.ts` is the production entry: it reads the environment and calls
 * this. The LAN pack is the other caller — it needs the same rooms, the same
 * netcode and the same HTTP surface, but it also serves the client and
 * discovery from the same port. Keeping the server a factory is what makes the
 * LAN binary a *distribution* of the game rather than a second game: there is
 * no LAN copy of `tickPlayer`, no LAN copy of the wire, and no place for the
 * two to drift.
 */

import { randomUUID } from "node:crypto";
import http from "node:http";
import geckos, { type ServerChannel } from "@geckos.io/server";
import { buildMatches, PROTOCOL_VERSION } from "../src/game/online/protocol.js";
import { GAME_SERVER_PORT, RELIABLE } from "../src/game/online/types.js";
import { MAX_SCREENS } from "../src/game/simulation/Arena.js";
import {
	type MatchMode,
	TDM_MIN_SCREENS,
} from "../src/game/simulation/Teams.js";
import {
	mapScreens,
	sanitizeTilemap,
	type TilemapSpec,
} from "../src/game/simulation/Tilemap.js";
import { ULT_MAX_CAP } from "../src/game/simulation/Ultimate.js";
import { MS_PER_SECOND } from "../src/game/simulation/units.js";
import {
	CP_CAP_TIME_DEFAULT_S,
	CP_CAP_TIME_MAX_S,
	CP_CAP_TIME_MIN_S,
	CP_SCREENS,
} from "../src/tweakables/control.js";
import { GameRoom } from "./GameRoom.js";
import { handleGithub } from "./github.js";
import { cleanPassword } from "./RoomPassword.js";

export interface GameServerOptions {
	/** The TCP/HTTP + signalling port. `0` asks the OS for one. */
	port?: number;
	/** The region advertised in `/health` and `/rooms`. */
	region?: string;
	/** The build id reported to clients and compared by the LAN gate. */
	build?: string;
	/** The protocol version reported to clients. Defaults to the shared constant. */
	protocol?: number;
	/**
	 * Refuse a join whose build or protocol differs.
	 *
	 * LAN only. The hosted game serves its client and its server from one commit,
	 * so it has nothing to compare; the LAN pack can meet another build through a
	 * merged listing or a cached page, and a deterministic simulation cannot
	 * negotiate.
	 */
	strictBuild?: boolean;
	/** Yes: the geckos server already takes `iceServers`. */
	stun?: { urls: string }[];
	/** Pin the multiplexed ICE UDP socket, or null to let the OS choose. */
	icePort?: number | null;
	/** The map maker's GitHub relay (off for a LAN pack unless asked). */
	enableGithub?: boolean;
	/**
	 * A request hook registered before geckos wraps the HTTP server.
	 *
	 * Geckos captures the existing `request` listeners when `addServer` runs and
	 * forwards every non-`/.wrtc` path to them, so a listener added later is
	 * never called. This is the one insertion point that survives that ordering.
	 */
	routes?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
}

export interface GameServer {
	/** Start listening and start the room loop. Resolves with the bound port. */
	listen(): Promise<number>;
	/** Stop the loop and close the HTTP server (geckos cleans its connections). */
	close(): Promise<void>;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
	const region = options.region ?? "local";
	const build = options.build ?? "dev";
	const protocol = options.protocol ?? PROTOCOL_VERSION;
	const strictBuild = options.strictBuild === true;
	const boundPort = options.port ?? GAME_SERVER_PORT;
	const io = geckos({
		iceServers: options.stun ?? [],
		...(options.icePort === undefined || options.icePort === null
			? {}
			: { portRange: { min: options.icePort, max: options.icePort } }),
	});
	let loopTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Guardrails for the creator-only `?` URL parameters. Every value a player can
	 * put in a URL is clamped to its floor and ceiling here, so a typo (or a
	 * probe) cannot build a match nobody can play — `?freezeTime=600` would
	 * otherwise freeze a round for ten minutes.
	 */
	const FREEZE_TIME_MIN_S = 0;
	const FREEZE_TIME_MAX_S = 60;
	const FREEZE_TIME_DEFAULT_S = 4;
	const SCORE_LIMIT_MIN = 1;
	const SCORE_LIMIT_MAX = 999;
	const SCORE_LIMIT_DEFAULT = 21;
	const TIME_LIMIT_MIN_MS = 5_000;
	const TIME_LIMIT_MAX_MS = 3_600_000;
	const TIME_LIMIT_DEFAULT_MS = 300_000;
	/** One frame of a 60Hz clock — the room loop reconciles at the fight's cadence. */
	const ROOM_LOOP_MS = 16;
	/** HTTP answers the menu's health check can read without any client-side help. */
	const HTTP_OK = 200;
	const HTTP_NOT_FOUND = 404;

	/**
	 * Every live room, by id.
	 *
	 * **A room is identified, not searched for.** There is no matchmaking queue: a
	 * client names the room it wants and gets it, or creates it by being first. That
	 * replaced a shared waiting room, which meant everybody who opened the game
	 * landed in the same match whether they meant to or not — and made two probes
	 * running back to back interfere with each other, because the second one joined
	 * the room the first had not finished leaving.
	 */
	const rooms = new Map<string, GameRoom>();

	/**
	 * How long to wait for a client's `join` before placing it anyway.
	 * Keeps older clients that never send `join` working.
	 */
	const JOIN_GRACE_MS = 1500;

	/** A room's ceiling, and what `?fill` alone means. Matches `MAX_PLAYERS`. */
	const MAX_FILL = 16;

	/**
	 * What a room id may look like.
	 *
	 * It arrives from a client, becomes a `Map` key and is logged, so it is checked
	 * rather than trusted. Anything else is replaced with a fresh id — and the id the
	 * server actually used comes back in the `match` message, so the client can put
	 * the real one in its address bar rather than the one it asked for.
	 */
	const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

	interface JoinMsg {
		/**
		 * Which room to play in. Absent or malformed means "make me a new one".
		 *
		 * This is the whole of matchmaking: to play together, share the link.
		 */
		room?: string;
		/**
		 * Vestigial. Rooms are addressed by id now, so there is no "solo" placement
		 * left to choose — and bots are opt-in, so it no longer decides how a room is
		 * filled either. Still accepted so an older client keeps working.
		 */
		solo?: boolean;
		training?: boolean;
		name?: string;
		/**
		 * Which build and protocol this client runs.
		 *
		 * The hosted server ignores both: its client and server are deployed from
		 * the same commit. The LAN pack sets `strictBuild` and refuses a mismatch,
		 * because there is no deploy to keep the two sides honest.
		 */
		build?: unknown;
		protocol?: unknown;
		/**
		 * This client's own fighter is brain-driven (`?ai=true`).
		 *
		 * A probe's or spectator's tool, never a person. When it is the *creator*
		 * of a room, the room is marked as a probe room and quick match leaves it
		 * alone — see `GameRoom.probe`.
		 */
		ai?: boolean;
		/** Bots to play against. **Absent means none** — see `botFill`. */
		bots?: number;
		/** Fighters to keep the room topped up to with bots. Absent means none. */
		fill?: number;
		/**
		 * Shortened rules.
		 *
		 * A five-minute match is the right length to play and the wrong length to
		 * measure: a probe that has to wait out the clock to see a winner is a probe
		 * nobody runs. These make the win condition testable in seconds.
		 *
		 * **Honoured only by the client that creates the room.** Otherwise the last
		 * person through the door could shorten a match everybody else was already
		 * playing.
		 */
		scoreLimit?: number;
		timeLimitMs?: number;
		/**
		 * How many 800px screens wide the arena is. Also fixed by the room's
		 * creator: the arena's size is a property of the room, so a latecomer's
		 * `?screen=` is ignored like the shortened rules are.
		 */
		screens?: number;
		/**
		 * Ultimate charge every fighter starts and respawns with, 0..`ULT_MAX_CAP`.
		 *
		 * The same argument as the shortened rules, for the same reason: the ultimate
		 * takes ~285s of passive charge to arm, which is the right pace to play and the
		 * wrong pace to measure — a probe that has to wait out the meter is a probe
		 * nobody runs. `?ultCharge=100` makes a 100-cap cast testable in seconds (a
		 * Rupture asks for its own 150), and it is how somebody practises the throw
		 * without earning it thirty times.
		 *
		 * **Creator-only**, like everything else in this block. It is a property of
		 * the room, and a latecomer must not be able to hand everybody an ultimate.
		 */
		ultCharge?: number;
		/**
		 * Which ruleset the room plays: `"tdm"` for team deathmatch, `"5cp"` for
		 * five control points, anything else for the free-for-all.
		 *
		 * **Creator-only**, like the rest of this block, and more so: the mode decides
		 * how big the arena is, how many people are on your side, and what a point
		 * even means. A latecomer switching it would be reshaping a match in progress.
		 */
		mode?: string;
		/**
		 * The middle point's capture time in **seconds**, creator-only.
		 *
		 * The same argument as `?freezeTime`: five seconds a point is the right pace
		 * to play and the wrong pace to measure — a probe that wants to see a whole
		 * round captured can shorten the ladder here, exactly like a practice room
		 * shortens the ultimate's meter with `?ultCharge`.
		 */
		capTime?: number;
		/**
		 * Freezetime in **seconds**, for a team room. Creator-only like the rest.
		 *
		 * Ten seconds is what the mode is designed around and what a player gets. A
		 * probe that had to sit through ten of them per round is a probe nobody waits
		 * for — this is the same argument as the shortened score and time limits, and
		 * it is honoured on the same terms.
		 */
		freezeTime?: number;
		/**
		 * The hero this client's own fighter plays. **Per-client, not creator-only** —
		 * it is the answer to "who do you want to be", and the last person through the
		 * door still gets to pick. `?hero=anands` in the URL, or the Esc menu's hero
		 * select mid-match.
		 */
		hero?: unknown;
		/**
		 * The hero the room's bots play, when the creator asks for one.
		 *
		 * Creator-only, like the other room properties: a probe that wants sixteen
		 * daggers on the floor is the only caller, and `?botHero=` is its flag.
		 * Absent means random per bot.
		 */
		botHero?: unknown;
		/**
		 * The room's password.
		 *
		 * Two roles in one field, decided by whether the room exists yet. For the
		 * *creator* it is a room property like the rest — the door the room is
		 * created with, hashed before it is stored, and the room becomes unlisted
		 * with it. For everybody after, it is the key: the text is compared against
		 * the room's hash, and a wrong or missing one is turned away with
		 * `room-locked` rather than seated.
		 */
		password?: unknown;
		/**
		 * An unlisted room (`?private=true`).
		 *
		 * Creator-only, like the rest of the room properties: a latecomer cannot
		 * hide a match everybody else is already playing, and cannot unhide one
		 * either. Private rooms stay out of quick match and any future listing; the
		 * link remains the whole invitation. A passworded room is unlisted whether
		 * this flag says so or not.
		 */
		private?: unknown;
		/**
		 * An authored map from the map maker. **Creator-only and untrusted**: it is
		 * sanitised (`sanitizeTilemap`) before a world is built from it, and the
		 * sanitised copy — never the bytes that arrived — is what every client is
		 * sent back.
		 */
		map?: unknown;
	}

	function clamp(
		value: unknown,
		lo: number,
		hi: number,
		fallback: number,
	): number {
		const n =
			typeof value === "number" && Number.isFinite(value) ? value : fallback;
		return Math.max(lo, Math.min(hi, Math.round(n)));
	}

	/** A `?ultCharge` value, clamped to the largest cap any ultimate arms at. */
	function clampUltCharge(value: unknown): number {
		return clamp(value, 0, ULT_MAX_CAP, 0);
	}

	function roomId(raw: unknown): string {
		return typeof raw === "string" && ROOM_ID_RE.test(raw) ? raw : randomUUID();
	}

	/**
	 * How many fighters this room keeps topped up with bots. **Zero unless asked.**
	 *
	 * Bots are opt-in. A room is for the people in it, and seating fifteen strangers
	 * nobody asked for is a decision rather than a default — it also meant that
	 * opening the game to check something put you in a brawl you did not want, and
	 * that a probe measuring one fighter had to remember to say `bots=0`.
	 *
	 * Two ways to ask, because two questions get asked:
	 *
	 * - `?bots=N` — "give me N opponents". Total becomes `1 + N`.
	 * - `?fill=N` — "keep this room at N fighters", whoever they turn out to be. What
	 *   a sixteen-fighter test wants.
	 *
	 * Either way bots are ballast: `rebalanceBots` evicts them as humans arrive, so
	 * the target is a floor on activity, never a cap on people.
	 */
	function botFill(msg: JoinMsg): number {
		if (msg.fill !== undefined) return clamp(msg.fill, 1, MAX_FILL, MAX_FILL);
		if (msg.bots !== undefined) return 1 + clamp(msg.bots, 0, MAX_FILL - 1, 0);
		return 0;
	}

	/** Which ruleset the room asked for. Anything unrecognised is a deathmatch. */
	function matchMode(raw: unknown): MatchMode {
		if (raw === "tdm" || raw === "team") return "tdm";
		if (raw === "5cp" || raw === "cp" || raw === "control") return "5cp";
		return "ffa";
	}

	/**
	 * How wide the room's arena is, honouring the mode's floor.
	 *
	 * Team deathmatch is played on **at least three screens** — wipe-out rounds need
	 * ground to give and take, and on one screen the two sides start inside each
	 * other's reach. See `TDM_MIN_SCREENS`. A bigger `?screen=` is still honoured;
	 * only the floor is imposed.
	 *
	 * Control points is its own map at its own size: five screens, one per point.
	 * The width is not a preference there — it is where the points are.
	 */
	function roomScreens(msg: JoinMsg, mode: MatchMode): number {
		if (mode === "5cp") return CP_SCREENS;
		const asked =
			msg.screens === undefined ? 1 : clamp(msg.screens, 1, MAX_SCREENS, 1);
		return mode === "tdm" ? Math.max(asked, TDM_MIN_SCREENS) : asked;
	}

	/**
	 * The authored map a new room plays on, or null for the generated arena.
	 *
	 * Control points has its own map and ignores this. Team deathmatch needs its
	 * three-screen floor — two spawn screens and ground between them — and a map
	 * narrower than that cannot be widened without inventing geometry, so it is
	 * refused there and the room plays the classic arena instead.
	 */
	function roomMap(msg: JoinMsg, mode: MatchMode): TilemapSpec | null {
		if (mode === "5cp" || msg.map === undefined) return null;
		const map = sanitizeTilemap(msg.map);
		if (!map) {
			console.log("[MATCH] Ignored an unreadable map");
			return null;
		}
		if (mode === "tdm" && mapScreens(map) < TDM_MIN_SCREENS) {
			console.log(
				`[MATCH] Map "${map.meta?.name}" is too narrow for team deathmatch`,
			);
			return null;
		}
		return map;
	}

	/** Create a room and register it. Its rules and size are fixed here, for good. */
	function createRoom(
		id: string,
		rules: {
			scoreLimit?: number;
			timeLimitMs?: number;
			fillTarget?: number;
			screens?: number;
			map?: TilemapSpec | null;
			startUltCharge?: number;
			mode?: MatchMode;
			freezeTimeMs?: number;
			capTimeMs?: number;
			botHero?: unknown;
			probe?: boolean;
			password?: string | null;
			unlisted?: boolean;
		},
	): GameRoom {
		const room = new GameRoom(id, rules);
		rooms.set(id, room);
		const privacy = room.hasPassword
			? ", passworded"
			: room.unlisted
				? ", private"
				: "";
		console.log(
			`[MATCH] Created room ${id} (${room.mode}, fill ${room.fillTarget}, ${room.world.screens} screens${privacy}${room.map ? `, map "${room.map.meta?.name}"` : ""})`,
		);
		return room;
	}

	/**
	 * Tell one client it is in. Per-channel rather than broadcast, because `youId`
	 * is the whole point of the message: a client that assumed its own channel id
	 * matched the id the server scores it under would read somebody else's row on
	 * the scoreboard the day those two ever differ.
	 *
	 * `roomId` is the id the server *used*, which is not always the one the client
	 * asked for — so the client rewrites its address bar from this rather than from
	 * what it proposed.
	 */
	function seated(room: GameRoom, channel: ServerChannel) {
		// Reliable: there is no second one. Lose it and the client never learns the id
		// the server scores it under — so it reads somebody else's scoreboard row — and
		// never puts the room in its address bar, so it cannot invite anybody.
		channel.emit(
			"match",
			{
				roomId: room.id,
				playerCount: room.playerCount,
				youId: String(channel.id),
				screens: room.world.screens,
				mode: room.mode,
				...(room.map ? { map: room.map } : {}),
			},
			RELIABLE,
		);
	}

	io.onConnection((channel) => {
		console.log(`[MATCH] New connection: ${channel.id}`);

		let placed = false;

		const place = (msg: JoinMsg) => {
			if (placed) return;
			placed = true;

			// The LAN gate. A mismatch is not a warning: the simulation is
			// deterministic, and two builds do not negotiate a middle world. The
			// client gets the two identities so its prompt can name what to update.
			if (
				strictBuild &&
				!buildMatches(msg.build, msg.protocol, build, protocol)
			) {
				console.log(
					`[MATCH] Build mismatch — ${channel.id} (${String(msg.build)}/${String(msg.protocol)}) vs ${build}/${protocol}`,
				);
				channel.emit(
					"build-mismatch",
					{
						serverBuild: build,
						serverProtocol: protocol,
						clientBuild: typeof msg.build === "string" ? msg.build : null,
						clientProtocol:
							typeof msg.protocol === "number" ? msg.protocol : null,
					},
					RELIABLE,
				);
				return;
			}

			const name = msg.name;

			/**
			 * A training room is single-human by construction.
			 *
			 * It always gets a fresh id and ignores the one it was given: it is created
			 * here, filled with a dummy immediately, and therefore already full. Seating
			 * a stranger in somebody's practice session would be a bug with no upside —
			 * the second slot is the thing under the practising player's control.
			 */
			if (msg.training) {
				// `?ultCharge` is honoured here too, and this is the room it was really
				// for: the training room is the practice room, and practising a throw
				// against a meter that takes 285s to fill is not practising.
				const room = createRoom(randomUUID(), {
					...(msg.ultCharge === undefined
						? {}
						: { startUltCharge: clampUltCharge(msg.ultCharge) }),
				});
				room.addPlayer(channel, name, msg.hero);
				room.addDummy();
				console.log(
					`[MATCH] Player ${channel.id} in training room ${room.id} vs dummy`,
				);
				seated(room, channel);
				return;
			}

			const id = roomId(msg.room);
			let room = rooms.get(id);
			if (!room) {
				// First one through the door sets the rules, the size and the mode.
				const mode = matchMode(msg.mode);
				// The door itself: a password to set it, and `?private=` to keep it
				// out of the listings. Both are the creator's alone — for everybody
				// after, the password field is the key, not a room property.
				const password = cleanPassword(msg.password);
				room = createRoom(id, {
					mode,
					...(msg.freezeTime === undefined
						? {}
						: {
								freezeTimeMs:
									clamp(
										msg.freezeTime,
										FREEZE_TIME_MIN_S,
										FREEZE_TIME_MAX_S,
										FREEZE_TIME_DEFAULT_S,
									) * MS_PER_SECOND,
							}),
					fillTarget: botFill(msg),
					...(msg.scoreLimit === undefined
						? {}
						: {
								scoreLimit: clamp(
									msg.scoreLimit,
									SCORE_LIMIT_MIN,
									SCORE_LIMIT_MAX,
									SCORE_LIMIT_DEFAULT,
								),
							}),
					...(msg.capTime === undefined
						? {}
						: {
								capTimeMs:
									clamp(
										msg.capTime,
										CP_CAP_TIME_MIN_S,
										CP_CAP_TIME_MAX_S,
										CP_CAP_TIME_DEFAULT_S,
									) * MS_PER_SECOND,
							}),
					...(msg.timeLimitMs === undefined
						? {}
						: {
								timeLimitMs: clamp(
									msg.timeLimitMs,
									TIME_LIMIT_MIN_MS,
									TIME_LIMIT_MAX_MS,
									TIME_LIMIT_DEFAULT_MS,
								),
							}),
					// Always passed, unlike the rest: a team room has a floor on its
					// arena, so "the client said nothing" is still a decision to make.
					screens: roomScreens(msg, mode),
					map: roomMap(msg, mode),
					...(msg.ultCharge === undefined
						? {}
						: { startUltCharge: clampUltCharge(msg.ultCharge) }),
					// The creator can pin every bot's hero (`?botHero=`); a probe
					// measuring the dagger at sixteen fighters is the only caller.
					...(msg.botHero === undefined ? {} : { botHero: msg.botHero }),
					// A room created by a brain-driven client is a probe room: quick
					// match must not land a stranger in the middle of a diagnostic.
					probe: Boolean(msg.ai),
					password,
					// A passworded room is unlisted either way; `GameRoom` enforces
					// the implication, so this only carries the creator's own ask.
					unlisted: msg.private === true,
				});
			} else if (!room.checkPassword(msg.password)) {
				// A locked room answers with the lock, not with a seat — and not with
				// the room's existence either: the message says "locked", never who is
				// inside or how full it is.
				console.log(
					`[MATCH] Room ${room.id} is locked — ${channel.id} turned away`,
				);
				// Reliable: losing this leaves a client connected, receiving nothing,
				// with no way to tell a locked room from a broken one.
				channel.emit("room-locked", { roomId: room.id }, RELIABLE);
				return;
			}

			if (room.addPlayer(channel, name, msg.hero)) {
				// Back to the size the room was created at, never the size this client
				// asked for — a latecomer must not be able to resize a match in progress.
				room.rebalanceBots(room.fillTarget);
				console.log(
					`[MATCH] Player ${channel.id} joined ${room.id} (${room.playerCount} fighters, ${room.humanCount} human)`,
				);
				seated(room, channel);
				return;
			}

			console.log(
				`[MATCH] Room ${room.id} is full — ${channel.id} turned away`,
			);
			// Reliable: losing this leaves a client connected, receiving nothing, with no
			// way to tell a full room from a broken one.
			channel.emit("room-full", { roomId: room.id }, RELIABLE);
		};

		channel.on("join", (data: unknown) => {
			place((data as JoinMsg | null) ?? {});
		});

		setTimeout(() => place({}), JOIN_GRACE_MS);
	});

	function loop(time: number) {
		for (const room of rooms.values()) {
			room.tick(time);
		}
		// Reap rooms once every human has left; a room of bots has no reason to run.
		// The id is released with it, so the same link creates a fresh room later.
		// Collected before deleting rather than deleted mid-iteration: that happens to
		// be defined for a Map and is still the sort of thing that stops being safe the
		// day somebody adds a second reason to remove a room.
		const dead: string[] = [];
		for (const [id, room] of rooms) {
			if (room.humanCount === 0) dead.push(id);
		}
		for (const id of dead) rooms.delete(id);
		// One frame of a 60Hz clock: rooms reconcile at the same cadence as a fight.
		loopTimer = setTimeout(() => loop(performance.now()), ROOM_LOOP_MS);
	}

	/**
	 * Resolve `GET /potg/<roomId>`, or `null` when this is not that request.
	 *
	 * The two failure modes are deliberately different shapes: a URL that is not a
	 * clip request falls through to the ordinary 404, while a *well-formed* request
	 * for a room with no reel gets a 404 of its own. The client treats both the
	 * same way — no replay, splash only — but the logs do not have to guess.
	 */
	function potgRequest(
		url: string | undefined,
	): { body: string | null } | null {
		const path = (url ?? "").split("?")[0] ?? "";
		if (!path.startsWith("/potg/")) return null;
		const id = decodeURIComponent(path.slice("/potg/".length));
		if (!ROOM_ID_RE.test(id)) return { body: null };
		const clip = rooms.get(id)?.playOfTheGame ?? null;
		return { body: clip === null ? null : JSON.stringify(clip) };
	}

	const httpServer = http.createServer();
	httpServer.on("request", (req, res) => {
		// The LAN pack's static files and `/lan/rooms` live here. Registered
		// before geckos wraps the server, so they survive the wrap; `false`
		// falls through to the game's own routes below.
		if (options.routes?.(req, res)) return;

		if (
			req.method === "GET" &&
			(req.url === "/health" || req.url === "/health/")
		) {
			res.writeHead(HTTP_OK, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			});
			res.end(
				JSON.stringify({
					ok: true,
					rooms: rooms.size,
					region,
					build,
					protocol,
				}),
			);
			return;
		}

		// The rooms quick match may send a stranger to.
		//
		// The menu is a URL generator, so this answers "which open room's id goes
		// in the URL" rather than doing any matchmaking itself: the server names the
		// rooms, the client picks one and joins it by link, exactly as if it had
		// been handed the link. `GameRoom.isOpen` is the whole rule — a human in the
		// room, a free seat, no probe, no practice session, no post-match ceremony —
		// so discovery and the game cannot disagree about what is joinable. Sorted
		// by how busy the room is, because a playtest wants the brawl, not the empty
		// arena. Same CORS as `/health`: the page is served from a different origin.
		if (
			req.method === "GET" &&
			(req.url === "/rooms" || req.url === "/rooms/")
		) {
			const open = [...rooms.values()]
				.filter((room) => room.isOpen)
				.map((room) => ({
					id: room.id,
					mode: room.mode,
					playerCount: room.playerCount,
					humanCount: room.humanCount,
					screens: room.world.screens,
					map: room.map?.meta?.name ?? null,
					region,
				}))
				.sort((a, b) => b.playerCount - a.playerCount);
			res.writeHead(HTTP_OK, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			});
			res.end(JSON.stringify({ ok: true, build, protocol, rooms: open }));
			return;
		}

		// The Play of the Game footage, on HTTP rather than on the game channel.
		//
		// A clip is a few hundred kilobytes of packed fighter state — three orders of
		// magnitude past what a datagram wants, and the same argument that made the
		// snapshot a packed array in the first place says a ten-second replay does
		// not belong on the realtime path at all. The *announcement* is a reliable
		// datagram and carries everything the splash card needs, so a client that
		// cannot reach this endpoint still gets the ceremony and simply skips the
		// replay. The id is validated with the same regex the rooms are keyed by, so
		// this cannot be used to probe for anything a room id is not.
		const clip = req.method === "GET" ? potgRequest(req.url) : null;
		if (clip !== null) {
			res.writeHead(clip.body === null ? HTTP_NOT_FOUND : HTTP_OK, {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			});
			res.end(clip.body ?? "");
			return;
		}

		// The map maker's GitHub sign-in relay. See `github.ts`.
		if (options.enableGithub !== false && handleGithub(req, res)) return;

		res.writeHead(HTTP_NOT_FOUND);
		res.end();
	});
	io.addServer(httpServer);

	function listen(): Promise<number> {
		return new Promise((resolve, reject) => {
			const onListening = () => {
				httpServer.off("error", onError);
				const address = httpServer.address();
				const actual =
					typeof address === "object" && address !== null
						? address.port
						: boundPort;
				loop(performance.now());
				resolve(actual);
			};
			const onError = (err: Error) => {
				httpServer.off("listening", onListening);
				reject(err);
			};
			httpServer.once("listening", onListening);
			httpServer.once("error", onError);
			httpServer.listen(boundPort);
		});
	}

	function close(): Promise<void> {
		if (loopTimer !== null) {
			clearTimeout(loopTimer);
			loopTimer = null;
		}
		return new Promise((resolve) => {
			if (!httpServer.listening) {
				resolve();
				return;
			}
			httpServer.close(() => resolve());
			httpServer.closeAllConnections();
		});
	}

	return { listen, close };
}
