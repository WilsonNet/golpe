import { randomUUID } from "node:crypto";
import http from "node:http";
import geckos, { type ServerChannel } from "@geckos.io/server";
import { GAME_SERVER_PORT, RELIABLE } from "../src/game/online/types.js";
import { MAX_SCREENS } from "../src/game/simulation/Arena.js";
import {
	type MatchMode,
	TDM_MIN_SCREENS,
} from "../src/game/simulation/Teams.js";
import { ULT_MAX_CHARGE } from "../src/game/simulation/Ultimate.js";
import { MS_PER_SECOND } from "../src/game/simulation/units.js";
import { GameRoom } from "./GameRoom.js";

const io = geckos({ iceServers: [] });

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
	 * Ultimate charge every fighter starts and respawns with, 0..100.
	 *
	 * The same argument as the shortened rules, for the same reason: the ultimate
	 * takes ~285s of passive charge to arm, which is the right pace to play and the
	 * wrong pace to measure — a probe that has to wait out the meter is a probe
	 * nobody runs. `?ultCharge=100` makes the cast testable in seconds, and it is
	 * how somebody practises the throw without earning it thirty times.
	 *
	 * **Creator-only**, like everything else in this block. It is a property of
	 * the room, and a latecomer must not be able to hand everybody an ultimate.
	 */
	ultCharge?: number;
	/**
	 * Which ruleset the room plays: `"tdm"` for team deathmatch, anything else
	 * for the free-for-all.
	 *
	 * **Creator-only**, like the rest of this block, and more so: the mode decides
	 * how big the arena is, how many people are on your side, and what a point
	 * even means. A latecomer switching it would be reshaping a match in progress.
	 */
	mode?: string;
	/**
	 * Freezetime in **seconds**, for a team room. Creator-only like the rest.
	 *
	 * Ten seconds is what the mode is designed around and what a player gets. A
	 * probe that had to sit through ten of them per round is a probe nobody waits
	 * for — this is the same argument as the shortened score and time limits, and
	 * it is honoured on the same terms.
	 */
	freezeTime?: number;
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

/** A `?ultCharge` value, clamped to the meter the simulation owns. */
function clampUltCharge(value: unknown): number {
	return clamp(value, 0, ULT_MAX_CHARGE, 0);
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
	return raw === "tdm" || raw === "team" ? "tdm" : "ffa";
}

/**
 * How wide the room's arena is, honouring the mode's floor.
 *
 * Team deathmatch is played on **at least three screens** — wipe-out rounds need
 * ground to give and take, and on one screen the two sides start inside each
 * other's reach. See `TDM_MIN_SCREENS`. A bigger `?screen=` is still honoured;
 * only the floor is imposed.
 */
function roomScreens(msg: JoinMsg, mode: MatchMode): number {
	const asked =
		msg.screens === undefined ? 1 : clamp(msg.screens, 1, MAX_SCREENS, 1);
	return mode === "tdm" ? Math.max(asked, TDM_MIN_SCREENS) : asked;
}

/** Create a room and register it. Its rules and size are fixed here, for good. */
function createRoom(
	id: string,
	rules: {
		scoreLimit?: number;
		timeLimitMs?: number;
		fillTarget?: number;
		screens?: number;
		startUltCharge?: number;
		mode?: MatchMode;
		freezeTimeMs?: number;
	},
): GameRoom {
	const room = new GameRoom(id, rules);
	rooms.set(id, room);
	console.log(
		`[MATCH] Created room ${id} (${room.mode}, fill ${room.fillTarget}, ${room.world.screens} screens)`,
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
			room.addPlayer(channel, name);
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
				...(msg.ultCharge === undefined
					? {}
					: { startUltCharge: clampUltCharge(msg.ultCharge) }),
			});
		}

		if (room.addPlayer(channel, name)) {
			// Back to the size the room was created at, never the size this client
			// asked for — a latecomer must not be able to resize a match in progress.
			room.rebalanceBots(room.fillTarget);
			console.log(
				`[MATCH] Player ${channel.id} joined ${room.id} (${room.playerCount} fighters, ${room.humanCount} human)`,
			);
			seated(room, channel);
			return;
		}

		console.log(`[MATCH] Room ${room.id} is full — ${channel.id} turned away`);
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
	setTimeout(() => loop(performance.now()), ROOM_LOOP_MS);
}

const PORT = GAME_SERVER_PORT;

/**
 * The game server's own HTTP endpoint, for the root menu's status line.
 *
 * Geckos owns `/.wrtc/*` and forwards everything else to listeners registered
 * before it — so the `/health` handler is registered on a server we create and
 * hand over via `addServer`, and the WebRTC signalling paths are untouched.
 * The `Access-Control-Allow-Origin` header is the whole point: the page is
 * served from :8080, and without it a fetch from there could not read the
 * answer. The menu uses this to say "game server online/offline" instead of
 * letting the first match sit on "Connecting..." forever.
 */
const httpServer = http.createServer();
httpServer.on("request", (req, res) => {
	if (
		req.method === "GET" &&
		(req.url === "/health" || req.url === "/health/")
	) {
		res.writeHead(HTTP_OK, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		});
		res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
		return;
	}
	res.writeHead(HTTP_NOT_FOUND);
	res.end();
});

io.addServer(httpServer);
httpServer.listen(PORT);
console.log(`[SERVER] Vento Aureo server listening on port ${PORT}`);
console.log(
	"[SERVER] rooms are addressed by id — share the link to share a room",
);
loop(performance.now());
